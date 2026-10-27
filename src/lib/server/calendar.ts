import { createHmac, timingSafeEqual } from "crypto";

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.WHATSAPP_APP_SECRET || "dev-secret";
const token = (id: string) => createHmac("sha256", secret()).update("appt-ics:" + id).digest("hex").slice(0, 32);
export function validCalendarToken(id: string, t: string): boolean {
  const a = Buffer.from(token(id)), b = Buffer.from(String(t ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
/** A link the patient taps to put the appointment, with two reminders, in their phone's calendar. Empty when the app address is not set. */
export function calendarUrl(apptId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return base ? `${base}/api/appointments/calendar?id=${apptId}&t=${token(apptId)}` : "";
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (date: string, time: string, addMin = 0) => {
  const [h, m] = (time || "09:00").split(":").map(Number);
  const d = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h || 0, (m || 0) + addMin));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
};

/** An .ics file for one appointment: an alert a day before and another two hours before. */
export function appointmentIcs(d: any, tz = "Asia/Kolkata"): string {
  const a = d.appointment, c = d.clinic ?? {}, doc = d.doctor;
  const title = `Appointment at ${c.name ?? "the clinic"}`;
  const desc = [doc?.name ? `With ${/^dr\.?\s/i.test(doc.name) ? doc.name : "Dr. " + doc.name}` : "", c.phone ? `Clinic: ${c.phone}` : ""].filter(Boolean).join("\n");
  const alarm = (trigger: string, text: string) => ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(text)}`, `TRIGGER:${trigger}`, "END:VALARM"];
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mediflow//Appointments//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${a.id}@mediflow`, `DTSTAMP:${stamp(new Date().toISOString().slice(0, 10), "00:00")}Z`,
    `DTSTART;TZID=${tz}:${stamp(String(a.date).slice(0, 10), String(a.time).slice(0, 5))}`,
    `DTEND;TZID=${tz}:${stamp(String(a.date).slice(0, 10), String(a.time).slice(0, 5), Number(a.duration_minutes) || 30)}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`, ...(c.address ? [`LOCATION:${esc(c.address)}`] : []),
    ...alarm("-P1D", `Tomorrow: ${title}`), ...alarm("-PT2H", `In 2 hours: ${title}`),
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}
