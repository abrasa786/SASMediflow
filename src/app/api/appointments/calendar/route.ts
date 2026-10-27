import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { appointmentIcs, validCalendarToken } from "@/lib/server/calendar";

export const dynamic = "force-dynamic";

/** Opened from the WhatsApp or email link: adds the appointment and its reminders to the patient's phone calendar. The link is signed, so no login is needed. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "", t = req.nextUrl.searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !validCalendarToken(id, t)) return new NextResponse("Not found", { status: 404 });
  const { data } = await createAdminClient().rpc("appt_details", { p_appt: id });
  if (!data?.appointment) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(appointmentIcs(data), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="appointment.ics"', "Cache-Control": "private, max-age=60" },
  });
}
