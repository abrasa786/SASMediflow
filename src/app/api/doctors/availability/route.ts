import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { parseEngineError, friendlyEngineMessage } from "@/lib/booking/engine";

export const dynamic = "force-dynamic";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Admins manage everyone; a doctor may manage only their own schedule. */
async function assertCanManage(db: any, clinicId: string, doctorId: string, userId: string, role: string) {
  const { data: doc } = await db.from("doctors").select("id, user_id").eq("id", doctorId).eq("clinic_id", clinicId).maybeSingle();
  if (!doc) throw new HttpError(404, "Doctor not found.");
  if (role !== "admin" && !(role === "doctor" && doc.user_id === userId)) throw new HttpError(403, "You can only manage your own availability.");
}

export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const [docs, sched, leaves] = await Promise.all([
      db.from("doctors").select("id, name, speciality, specialty, phone, consultation_fee, slot_minutes, user_id, is_active").eq("clinic_id", clinicId).order("name"),
      db.from("doctor_schedules").select("id, doctor_id, weekday, start_time, end_time, break_start, break_end, slot_minutes, is_active").eq("clinic_id", clinicId).order("weekday").order("start_time"),
      db.from("doctor_leaves").select("id, doctor_id, from_date, to_date, reason").eq("clinic_id", clinicId).gte("to_date", new Date().toISOString().slice(0, 10)).order("from_date"),
    ]);
    for (const r of [docs, sched, leaves]) if (r.error) throw new HttpError(500, r.error.message.includes("doctor_schedules") || r.error.message.includes("doctor_leaves")
      ? "Availability tables are not installed yet. Run supabase/migrations/004_appointment_flow.sql in the Supabase SQL editor." : r.error.message);
    return { role, userId, doctors: docs.data ?? [], schedules: sched.data ?? [], leaves: leaves.data ?? [] };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId, role } = await requireClinicMember(req, b.clinicId, ["admin", "doctor"]);
    const action = b.action;

    if (action === "set_schedule") {
      await assertCanManage(db, b.clinicId, b.doctorId, userId, role);
      const { data, error } = await db.rpc("appt_set_schedule", { p_clinic: b.clinicId, p_doctor: b.doctorId, p_rows: Array.isArray(b.rows) ? b.rows : [] });
      if (error) { const e = parseEngineError(error.message); throw new HttpError(400, friendlyEngineMessage(e.code, e.detail)); }
      return { saved: data };
    }
    if (action === "add_leave") {
      await assertCanManage(db, b.clinicId, b.doctorId, userId, role);
      if (!ISO.test(b.fromDate ?? "") || !ISO.test(b.toDate ?? "") || b.toDate < b.fromDate) throw new HttpError(400, "Choose a valid date range.");
      const { data: clash } = await db.from("appointments").select("id", { count: "exact", head: false })
        .eq("clinic_id", b.clinicId).eq("doctor_id", b.doctorId).eq("status", "confirmed").gte("appointment_date", b.fromDate).lte("appointment_date", b.toDate);
      const { error } = await db.from("doctor_leaves").insert({ clinic_id: b.clinicId, doctor_id: b.doctorId, from_date: b.fromDate, to_date: b.toDate, reason: typeof b.reason === "string" ? b.reason.slice(0, 200) : null, created_by: userId });
      if (error) throw new HttpError(400, error.message);
      return { saved: true, affectedAppointments: (clash ?? []).length };
    }
    if (action === "remove_leave") {
      const { data: l } = await db.from("doctor_leaves").select("id, doctor_id").eq("id", b.leaveId).eq("clinic_id", b.clinicId).maybeSingle();
      if (!l) throw new HttpError(404, "Leave not found.");
      await assertCanManage(db, b.clinicId, l.doctor_id, userId, role);
      const { error } = await db.from("doctor_leaves").delete().eq("id", b.leaveId);
      if (error) throw new HttpError(400, error.message);
      return { removed: true };
    }
    if (action === "update_doctor") {
      await assertCanManage(db, b.clinicId, b.doctorId, userId, role);
      const patch: Record<string, unknown> = {};
      if (b.consultation_fee !== undefined) { const f = Number(b.consultation_fee); if (!Number.isFinite(f) || f < 0) throw new HttpError(400, "Invalid fee."); patch.consultation_fee = f; }
      if (b.slot_minutes !== undefined) { const s = b.slot_minutes === null || b.slot_minutes === "" ? null : Number(b.slot_minutes); if (s !== null && (!Number.isInteger(s) || s < 5 || s > 120)) throw new HttpError(400, "Slot length must be 5-120 minutes."); patch.slot_minutes = s; }
      if (b.phone !== undefined) patch.phone = typeof b.phone === "string" ? b.phone.slice(0, 20) : null;
      if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to update.");
      const { error } = await db.from("doctors").update(patch).eq("id", b.doctorId).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { updated: true };
    }
    throw new HttpError(400, "Unknown action.");
  });
}
