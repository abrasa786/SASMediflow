import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { handle, HttpError } from "@/lib/server/http";
import { findClinic, onlineSettings } from "@/lib/booking/online";
import { addDays, todayInTz } from "@/lib/booking/parse";

export const dynamic = "force-dynamic";

/** How many free times each coming day has (for the calendar strip). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const db = createAdminClient();
    const c = await findClinic(db, { slug: q.get("clinic"), host: q.get("host") });
    const s = onlineSettings(c.settings);
    if (!s.enabled) throw new HttpError(403, "Online booking is off.");
    const doctorId = q.get("doctorId");
    if (doctorId && !/^[0-9a-f-]{36}$/i.test(doctorId)) throw new HttpError(400, "Invalid doctor.");
    const today = todayInTz();
    const n = Math.min(s.advance_days, 28);
    const days = await Promise.all(Array.from({ length: n + 1 }, async (_, i) => {
      const date = addDays(today, i);
      const { data } = await db.rpc("appt_slots", { p_clinic: c.id, p_date: date, p_doctor: doctorId || null, p_dur: null });
      return { date, free: new Set((data ?? []).map((r: any) => r.s_time)).size };
    }));
    return { days };
  });
}
