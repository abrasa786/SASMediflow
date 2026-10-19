import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

/** My leave balances for the year. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const year = Number(req.nextUrl.searchParams.get("year")) || undefined;
    const { data, error } = await db.rpc("leave_balance", { p_clinic: clinicId, p_user: userId, p_year: year ?? null });
    if (error) throwRpc(error);
    return { balance: data, role };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);
    if (b.action === "request") {
      const { data, error } = await db.rpc("leave_request", { p: { clinic_id: b.clinicId, user_id: userId, leave_type: b.leaveType, from_date: b.fromDate, to_date: b.toDate, half_day: !!b.halfDay, reason: b.reason } });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "decide" || b.action === "cancel") {
      if (typeof b.leaveId !== "string") throw new HttpError(400, "leaveId is required.");
      const status = b.action === "cancel" ? "cancelled" : b.status;
      const { data, error } = await db.rpc("leave_decide", { p_clinic: b.clinicId, p_actor: userId, p_leave: b.leaveId, p_status: status, p_note: b.note ?? null });
      if (error) throwRpc(error);
      return data;
    }
    throw new HttpError(400, "Unknown action.");
  });
}
