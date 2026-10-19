import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { handle, HttpError } from "@/lib/server/http";
import { findClinic, onlineSettings } from "@/lib/booking/online";

export const dynamic = "force-dynamic";

/** Free times for one day. With no doctor chosen each time is shown once, with the first doctor free then. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const db = createAdminClient();
    const c = await findClinic(db, { slug: q.get("clinic"), host: q.get("host") });
    if (!onlineSettings(c.settings).enabled) throw new HttpError(403, "Online booking is off.");
    const date = q.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "date is required.");
    const doctorId = q.get("doctorId");
    if (doctorId && !/^[0-9a-f-]{36}$/i.test(doctorId)) throw new HttpError(400, "Invalid doctor.");
    const { data, error } = await db.rpc("appt_slots", { p_clinic: c.id, p_date: date, p_doctor: doctorId || null, p_dur: null });
    if (error) throw new HttpError(500, "Could not load times.");
    const seen = new Set<string>(); const rows: { start: string; time: string; doctorId: string; doctorName: string }[] = [];
    for (const r of (data ?? []) as any[]) { if (seen.has(r.s_time)) continue; seen.add(r.s_time); rows.push({ start: String(r.s_start), time: r.s_time, doctorId: r.s_doctor_id, doctorName: r.s_doctor_name }); }
    rows.sort((a, b) => a.start.localeCompare(b.start));
    return { date, slots: rows.map((r) => ({ time: r.time, doctorId: r.doctorId, doctorName: r.doctorName })) };
  });
}
