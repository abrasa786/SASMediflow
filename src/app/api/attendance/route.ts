import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId, role } = await requireClinicMember(req, b.clinicId);
    if (b.action === "check_in" || b.action === "check_out") {
      const { data, error } = await db.rpc(b.action === "check_in" ? "att_check_in" : "att_check_out", { p_clinic: b.clinicId, p_user: userId });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "correct") {
      if (role !== "admin") throw new HttpError(403, "Only the admin can correct attendance.");
      const t = /^\d{2}:\d{2}$/;
      if ((b.checkIn && !t.test(b.checkIn)) || (b.checkOut && !t.test(b.checkOut))) throw new HttpError(400, "Use HH:MM times.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.workDate ?? "")) throw new HttpError(400, "Choose a date.");
      const { data, error } = await db.rpc("att_correct", { p: { clinic_id: b.clinicId, user_id: b.userId, work_date: b.workDate, check_in: b.checkIn, check_out: b.checkOut, note: b.note } });
      if (error) throwRpc(error);
      return data;
    }
    throw new HttpError(400, "Unknown action.");
  });
}
