import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

/** GET: everyone in this clinic (any member can see the list). Users are unique to the clinic: a clinic never sees another's. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const { data: rows, error } = await db.from("clinic_staff").select("user_id, role, name, specialty, is_active, created_at").eq("clinic_id", clinicId).order("created_at");
    if (error) throw new HttpError(400, error.message);
    const users = await Promise.all((rows ?? []).map(async (r: any) => {
      let email: string | null = null, lastSignIn: string | null = null;
      const { data } = await db.auth.admin.getUserById(r.user_id);
      if (data?.user) { email = data.user.email ?? null; lastSignIn = data.user.last_sign_in_at ?? null; }
      return { userId: r.user_id, name: r.name, role: r.role, specialty: r.specialty, active: r.is_active !== false, joined: r.created_at, email, lastSignIn, isMe: r.user_id === userId };
    }));
    return { users, canDelete: role === "admin" };
  });
}

/** DELETE: admin only. The database re-checks everything (admin, not yourself, never the last admin). */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    if (typeof b.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.userId)) throw new HttpError(400, "userId is required.");
    const { data, error } = await db.rpc("users_remove", { p_clinic: b.clinicId, p_actor: userId, p_user: b.userId });
    if (error) throwRpc(error);
    return { success: true, ...data };
  });
}

/** PATCH: admin only. Sets a new temporary password for another member of this clinic (no email is sent). */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    if (typeof b.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.userId)) throw new HttpError(400, "userId is required.");
    if (typeof b.password !== "string" || b.password.length < 8) throw new HttpError(400, "The new password must be at least 8 characters.");
    if (b.userId === userId) throw new HttpError(400, "Change your own password from My profile.");
    const { data: row } = await db.from("clinic_staff").select("role").eq("clinic_id", b.clinicId).eq("user_id", b.userId).maybeSingle();
    if (!row) throw new HttpError(404, "That user is not in this clinic.");
    if (row.role === "admin") throw new HttpError(403, "You can't reset another admin's password.");
    const { error } = await db.auth.admin.updateUserById(b.userId, { password: b.password });
    if (error) throw new HttpError(400, error.message);
    return { success: true };
  });
}
