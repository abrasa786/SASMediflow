import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { handle, HttpError } from "@/lib/server/http";
import { clientIp, tooMany } from "@/lib/server/ratelimit";
import { num, specialtyPattern } from "@/lib/booking/patient-search";
import { addDays, todayInTz } from "@/lib/booking/parse";

export const dynamic = "force-dynamic";

/**
 * For the Mediflow patient app: clinics near a point, within a fee limit, that chose to be listed.
 *   ?lat=&lng=&radiusKm=25&maxFee=500&specialty=Dental&q=text&includeUnknownFee=1&limit=20
 * Public facts only. For clinics that take online bookings it also shows the next free time.
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    if (tooMany("search:" + clientIp(req), 60, 60_000)) throw new HttpError(429, "Too many searches. Please wait a moment.");
    const q = req.nextUrl.searchParams;
    const lat = num(q.get("lat"), -90, 90), lng = num(q.get("lng"), -180, 180);
    if ((lat === null) !== (lng === null)) throw new HttpError(400, "Send both lat and lng, or neither.");
    const text = (q.get("q") ?? "").trim().slice(0, 60).replace(/[%_\\]/g, "");
    const db = createAdminClient();
    const { data, error } = await db.rpc("public_clinic_search", {
      p_lat: lat, p_lng: lng, p_radius_km: num(q.get("radiusKm"), 1, 500) ?? 25, p_max_fee: num(q.get("maxFee"), 0, 100000),
      p_specialty: specialtyPattern(q.get("specialty")), p_q: text || null, p_include_unknown: q.get("includeUnknownFee") !== "0",
      p_limit: Math.round(num(q.get("limit"), 1, 50) ?? 20),
    });
    if (error) throw new HttpError(500, "Search is not available right now.");
    const list = (data ?? []) as any[];

    // next free time for the clinics a patient can book right now (first 10 only, to keep this quick)
    const today = todayInTz();
    const { data: ids } = await db.from("clinics").select("id, slug").in("slug", list.filter((c) => c.online_booking).slice(0, 10).map((c) => c.slug));
    const idBySlug = new Map<string, string>((ids ?? []).map((c: any) => [c.slug, c.id]));
    await Promise.all(list.slice(0, 10).map(async (c) => {
      const id = idBySlug.get(c.slug); if (!id) return;
      for (let i = 0; i < 4; i++) {
        const date = addDays(today, i);
        const { data: s } = await db.rpc("appt_slots", { p_clinic: id, p_date: date, p_doctor: null, p_dur: null });
        const first = (s ?? []).slice().sort((a: any, b: any) => String(a.s_start).localeCompare(String(b.s_start)))[0];
        if (first) { c.next_free = { date, time: first.s_time }; return; }
      }
    }));
    return { clinics: list.map((c) => ({ ...c, book_url: c.online_booking ? `/c/${c.slug}/book` : null })) };
  });
}
