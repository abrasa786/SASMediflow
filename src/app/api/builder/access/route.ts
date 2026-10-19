import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
const API = /^[a-z][a-z0-9_]{0,40}$/;
const BUILTIN = ["appointments", "invoices", "patients", "stock"];

/** Admin: permission sets, who has them, and the tables they can cover. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db } = await requireClinicMember(req, clinicId, ["admin"]);
    const [sets, objs, users, staff, tables] = await Promise.all([
      db.from("permission_sets").select("*").eq("clinic_id", clinicId).order("name"),
      db.from("permission_set_objects").select("*").eq("clinic_id", clinicId),
      db.from("permission_set_users").select("set_id,user_id").eq("clinic_id", clinicId),
      db.from("clinic_staff").select("user_id,name,role,is_active").eq("clinic_id", clinicId).eq("is_active", true),
      db.from("builder_objects").select("api_name,label,plural_label,icon").eq("clinic_id", clinicId).eq("status", "active").eq("is_system", false),
    ]);
    const bad = [sets, objs, users, staff, tables].find((r: any) => r.error);
    if (bad) throw new HttpError(500, /does not exist|schema cache/i.test(bad.error.message) ? "Access control is not installed yet. Run supabase/migrations/008_builder_access_and_reports.sql in the Supabase SQL editor." : bad.error.message);
    return {
      sets: (sets.data ?? []).map((s: any) => ({ ...s, objects: (objs.data ?? []).filter((o: any) => o.set_id === s.id), user_ids: (users.data ?? []).filter((u: any) => u.set_id === s.id).map((u: any) => u.user_id) })),
      staff: (staff.data ?? []).filter((s: any) => s.role !== "admin"),
      tables: tables.data ?? [],
    };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);

    if (b.action === "save_set") {
      const name = String(b.name ?? "").trim();
      if (name.length < 2 || name.length > 60) throw new HttpError(400, "Give the permission set a name (2 to 60 characters).");
      const objects: any[] = Array.isArray(b.objects) ? b.objects : [];
      if (objects.length > 60) throw new HttpError(400, "Too many tables in one permission set.");
      const { data: known } = await db.from("builder_objects").select("api_name").eq("clinic_id", b.clinicId).eq("status", "active").eq("is_system", false);
      const valid = new Set<string>([...(known ?? []).map((k: any) => k.api_name), ...BUILTIN]);
      const rows = objects.map((o) => {
        if (!API.test(o.object ?? "") || !valid.has(o.object)) throw new HttpError(400, `"${o.object}" is not a table in this clinic.`);
        const builtin = BUILTIN.includes(o.object);
        return { object_api_name: o.object, can_read: !!o.read, can_create: builtin ? false : !!o.create, can_edit: builtin ? false : !!o.edit, can_delete: builtin ? false : !!o.delete,
                 read_scope: o.read_scope === "own" ? "own" : "all", edit_scope: o.edit_scope === "all" ? "all" : "own" };
      }).filter((r) => r.can_read || r.can_create || r.can_edit || r.can_delete);
      let id = b.id as string | undefined;
      if (id) {
        const { data: ex } = await db.from("permission_sets").select("id").eq("id", id).eq("clinic_id", b.clinicId).maybeSingle();
        if (!ex) throw new HttpError(404, "That permission set no longer exists.");
        const { error } = await db.from("permission_sets").update({ name, description: b.description ?? null }).eq("id", id);
        if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "A permission set with that name already exists." : error.message);
        await db.from("permission_set_objects").delete().eq("set_id", id).eq("clinic_id", b.clinicId);
      } else {
        const { data, error } = await db.from("permission_sets").insert({ clinic_id: b.clinicId, name, description: b.description ?? null, created_by: userId }).select("id").single();
        if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "A permission set with that name already exists." : error.message);
        id = data.id;
      }
      if (rows.length) { const { error } = await db.from("permission_set_objects").insert(rows.map((r) => ({ ...r, clinic_id: b.clinicId, set_id: id }))); if (error) throw new HttpError(400, error.message); }
      return { id };
    }
    if (b.action === "assign") {
      const ids: string[] = Array.isArray(b.userIds) ? b.userIds.filter((x: unknown) => typeof x === "string") : [];
      const { data: ex } = await db.from("permission_sets").select("id").eq("id", b.setId).eq("clinic_id", b.clinicId).maybeSingle();
      if (!ex) throw new HttpError(404, "That permission set no longer exists.");
      if (ids.length) {
        const { data: ok } = await db.from("clinic_staff").select("user_id").eq("clinic_id", b.clinicId).eq("is_active", true).in("user_id", ids);
        if ((ok ?? []).length !== new Set(ids).size) throw new HttpError(400, "One of the people is not an active member of this clinic.");
      }
      await db.from("permission_set_users").delete().eq("set_id", b.setId).eq("clinic_id", b.clinicId);
      if (ids.length) { const { error } = await db.from("permission_set_users").insert(Array.from(new Set(ids)).map((u) => ({ clinic_id: b.clinicId, set_id: b.setId, user_id: u, assigned_by: userId }))); if (error) throw new HttpError(400, error.message); }
      return { ok: true };
    }
    if (b.action === "delete_set") {
      const { error } = await db.from("permission_sets").delete().eq("id", b.setId).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }
    throw new HttpError(400, "Unknown action.");
  });
}
