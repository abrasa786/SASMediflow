import { notifyAppointment, whatsappConfigured } from "./notify";

const dayIn = (tz: string, offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + offset * 86400000));

/**
 * Every clinic gets day-before appointment reminders on WhatsApp without setting anything up. Runs in the daily job.
 * Each appointment is reminded once (a reminder already sent is never repeated). A clinic can switch it off with settings.auto_reminders = false.
 */
export async function runDayBeforeReminders(db: any): Promise<{ reminded: number }> {
  if (!whatsappConfigured()) return { reminded: 0 };
  let reminded = 0;
  const { data: clinics } = await db.from("clinics").select("id, settings").limit(2000);
  for (const c of clinics ?? []) {
    try {
      if (c.settings?.auto_reminders === false) continue;
      const tomorrow = dayIn(c.settings?.booking?.timezone || "Asia/Kolkata", 1);
      const { data: appts } = await db.from("appointments").select("id").eq("clinic_id", c.id).eq("appointment_date", tomorrow).eq("status", "confirmed").limit(500);
      const ids = (appts ?? []).map((a: any) => a.id);
      if (!ids.length) continue;
      const { data: done } = await db.from("appointment_notifications").select("appointment_id").in("appointment_id", ids).eq("kind", "reminder").eq("recipient", "patient").eq("status", "sent");
      const already = new Set((done ?? []).map((d: any) => d.appointment_id));
      for (const id of ids) {
        if (already.has(id)) continue;
        const { data: details } = await db.rpc("appt_details", { p_appt: id });
        if (!details) continue;
        await notifyAppointment(db, c.id, details, "reminder", ["patient"]);
        reminded++;
      }
    } catch { /* carry on with the next clinic */ }
  }
  return { reminded };
}
