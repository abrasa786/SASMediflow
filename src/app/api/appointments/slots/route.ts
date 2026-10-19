import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const clinicId = q.get("clinicId");
    const { db } = await requireClinicMember(req, clinicId);
    const date = q.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date is required (YYYY-MM-DD).");
    const doctorId = q.get("doctorId") || null;
    const dur = q.get("duration") ? Number(q.get("duration")) : null;

    const { data, error } = await db.rpc("appt_slots", { p_clinic: clinicId, p_date: date, p_doctor: doctorId, p_dur: dur });
    if (error) throw new HttpError(500, error.message);
    const rows = (data ?? []) as any[];

    // per-doctor lists, plus a merged list of distinct times (used by "auto-assign")
    const byDoctor: Record<string, { doctorId: string; doctorName: string; times: string[] }> = {};
    const anyTimes: string[] = [];
    for (const r of rows) {
      (byDoctor[r.s_doctor_id] ??= { doctorId: r.s_doctor_id, doctorName: r.s_doctor_name, times: [] }).times.push(r.s_time);
      if (!anyTimes.includes(r.s_time)) anyTimes.push(r.s_time);
    }
    return { date, doctors: Object.values(byDoctor), anyTimes };
  });
}
