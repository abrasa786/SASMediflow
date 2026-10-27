/**
 * Appointment notifications over WhatsApp.
 *  - If WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set, messages go out through Meta's Cloud API.
 *  - Otherwise (or on failure) a click-to-send wa.me link is returned so staff can send it in one tap.
 * Every attempt is logged in appointment_notifications. Notifying never throws: the booking is already saved.
 *
 * Meta rule: free-form text only reaches a patient who messaged the clinic in the last 24 hours.
 * For first contact, create approved templates and set WHATSAPP_TEMPLATE_<KIND>_<RECIPIENT>
 * (e.g. WHATSAPP_TEMPLATE_CONFIRMATION_PATIENT). Template body variables, in order:
 *   {{1}} patient name, {{2}} date, {{3}} time, {{4}} doctor, {{5}} clinic
 */
import { formatDateNice } from "./parse";
import { emailConfigured, sendEmail } from "../email";
import { calendarUrl } from "../server/calendar";

export type NotifyKind = "confirmation" | "reschedule" | "cancellation" | "reminder" | "no_show";
export interface NotificationResult {
  recipient: "patient" | "doctor";
  phone: string | null;
  status: "sent" | "failed" | "link" | "skipped";
  channel: "whatsapp" | "link";
  link?: string;
  error?: string;
}

const SUBJECT: Record<NotifyKind, string> = { confirmation: "Your appointment is booked", reschedule: "Your appointment was moved", cancellation: "Your appointment was cancelled", reminder: "Appointment reminder", no_show: "We missed you today" };
const drName = (n?: string | null) => (!n ? "your doctor" : /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`);
const rupees = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export function whatsappPhone(raw?: string | null): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length > 10 && d.length <= 15) return d;
  return null;
}
export const waLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export function buildMessages(d: any, kind: NotifyKind): { patient: string; doctor: string } {
  const a = d.appointment, p = d.patient ?? {}, doc = d.doctor, c = d.clinic ?? {};
  const when = `${formatDateNice(a.date)} at ${a.time}`;
  const mode = a.mode === "video" ? "📹 Video consultation" : "🏥 In-clinic visit";
  const contact = c.phone ? `\nFor any change please call ${c.phone}.` : "";
  const cal = a.id ? calendarUrl(a.id) : "";
  const addCal = cal ? `\n\n📲 Add a reminder to your phone: ${cal}` : "";
  const prev = d.previous ? `${formatDateNice(d.previous.date)} at ${d.previous.time}` : "";

  if (kind === "confirmation") return {
    patient: `✅ *Appointment confirmed*\n\nHi ${p.name}, your appointment at *${c.name}* is booked.\n\n📅 ${when}\n👨‍⚕️ ${drName(doc?.name)}\n${mode}${a.fee ? `\n💰 Fee: ${rupees(a.fee)}` : ""}${c.address ? `\n📍 ${c.address}` : ""}\n\nPlease arrive 10 minutes early.${addCal}${contact}`,
    doctor: `📋 *New appointment*\n\n${p.name}${p.phone ? ` (${p.phone})` : ""}${d.patient_created ? " · new patient" : ""}\n📅 ${when}\n${mode}${a.symptoms ? `\n📝 ${a.symptoms}` : ""}`,
  };
  if (kind === "reschedule") return {
    patient: `🔁 *Appointment rescheduled*\n\nHi ${p.name}, your appointment at *${c.name}* has moved.\n\n❌ Was: ${prev}\n✅ Now: ${when}\n👨‍⚕️ ${drName(doc?.name)}${addCal}${contact}`,
    doctor: `🔁 *Appointment rescheduled*\n\n${p.name}\n❌ Was: ${prev}\n✅ Now: ${when}`,
  };
  if (kind === "cancellation") return {
    patient: `❌ *Appointment cancelled*\n\nHi ${p.name}, your appointment at *${c.name}* on ${when} has been cancelled.${a.cancel_reason ? `\nReason: ${a.cancel_reason}` : ""}\n\nReply here or call us to book a new time.${contact}`,
    doctor: `❌ *Appointment cancelled*\n\n${p.name} · ${when}${a.cancel_reason ? `\nReason: ${a.cancel_reason}` : ""}`,
  };
  return {
    patient: `⏰ *Appointment reminder*\n\nHi ${p.name}, this is a reminder of your appointment at *${c.name}*.\n\n📅 ${when}\n👨‍⚕️ ${drName(doc?.name)}${c.address ? `\n📍 ${c.address}` : ""}\n\nReply CANCEL if you cannot make it.${contact}`,
    doctor: `⏰ *Reminder*\n\n${p.name} · ${when}`,
  };
}

export async function sendViaCloudApi(phone: string, text: string, template?: { name: string; params: string[] }) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, token = process.env.WHATSAPP_ACCESS_TOKEN;
  const ver = process.env.WHATSAPP_API_VERSION || "v21.0";
  const body = template
    ? { messaging_product: "whatsapp", to: phone, type: "template", template: { name: template.name, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components: [{ type: "body", parameters: template.params.map((t) => ({ type: "text", text: t })) }] } }
    : { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text, preview_url: false } };
  const res = await fetch(`https://graph.facebook.com/${ver}/${id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = j?.error?.code;
    const hint = code === 131047 || code === 131026
      ? " (WhatsApp only allows free text within 24 hours of the patient's last message. Set up an approved template for first contact.)" : "";
    throw new Error((j?.error?.message ?? `WhatsApp error ${res.status}`) + hint);
  }
  return j?.messages?.[0]?.id as string | undefined;
}

/** Sends a PDF (by public link) as a WhatsApp document with a short caption. Same 24-hour rule as free text. */
export async function sendDocumentViaCloudApi(phone: string, link: string, filename: string, caption: string) {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID, token = process.env.WHATSAPP_ACCESS_TOKEN;
  const ver = process.env.WHATSAPP_API_VERSION || "v21.0";
  const res = await fetch(`https://graph.facebook.com/${ver}/${id}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, type: "document", document: { link, filename, caption: caption.slice(0, 1000) } }),
    signal: AbortSignal.timeout(10000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = j?.error?.code;
    const hint = code === 131047 || code === 131026 ? " (WhatsApp only allows free messages within 24 hours of the patient's last message. Set up an approved template for first contact.)" : "";
    throw new Error((j?.error?.message ?? `WhatsApp error ${res.status}`) + hint);
  }
  return j?.messages?.[0]?.id as string | undefined;
}

export const whatsappConfigured = () => !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);

async function deliver(
  db: any, ctx: { clinicId: string; appointmentId: string }, recipient: "patient" | "doctor",
  rawPhone: string | null | undefined, kind: NotifyKind, text: string, d: any,
): Promise<NotificationResult> {
  const phone = whatsappPhone(rawPhone);
  let r: NotificationResult;
  let providerId: string | undefined;
  if (!phone) {
    r = { recipient, phone: rawPhone ?? null, status: "skipped", channel: "link", error: recipient === "patient" ? "No valid phone number on file" : "Doctor has no phone number saved" };
  } else if (!whatsappConfigured()) {
    r = { recipient, phone, status: "link", channel: "link", link: waLink(phone, text) };
  } else {
    try {
      const tplName = process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}_${recipient.toUpperCase()}`];
      const params = [d.patient?.name ?? "", formatDateNice(d.appointment.date), d.appointment.time, drName(d.doctor?.name), d.clinic?.name ?? ""];
      providerId = await sendViaCloudApi(phone, text, tplName ? { name: tplName, params } : undefined);
      r = { recipient, phone, status: "sent", channel: "whatsapp" };
    } catch (e: any) {
      r = { recipient, phone, status: "failed", channel: "whatsapp", error: e.message, link: waLink(phone, text) };
    }
  }
  try {
    await db.from("appointment_notifications").insert({
      clinic_id: ctx.clinicId, appointment_id: ctx.appointmentId, recipient, phone: r.phone, kind,
      channel: r.channel, status: r.status, provider_message_id: providerId ?? null, link: r.link ?? null, error: r.error ?? null,
    });
  } catch { /* logging must never break the flow */ }
  return r;
}

/** Notify the patient and the doctor about an appointment event. `details` is the output of appt_details()/appt_book(). */
export async function notifyAppointment(
  db: any, clinicId: string, details: any, kind: NotifyKind, only?: Array<"patient" | "doctor">,
): Promise<NotificationResult[]> {
  const msgs = buildMessages(details, kind);
  const ctx = { clinicId, appointmentId: details.appointment.id };
  const jobs: Promise<NotificationResult>[] = [];
  if (!only || only.includes("patient")) {
    jobs.push(deliver(db, ctx, "patient", details.patient?.phone, kind, msgs.patient, details));
    // the same message by email too, when the patient has an email address and email is set up (best effort, never blocks the booking)
    if (emailConfigured() && details.patient?.id) {
      jobs.push((async (): Promise<NotificationResult | null> => {
        try {
          const { data: pt } = await db.from("clinic_patients").select("email").eq("id", details.patient.id).maybeSingle();
          const { data: cl } = await db.from("clinics").select("email").eq("id", details.appointment.clinic_id).maybeSingle();
          if (pt?.email) await sendEmail(pt.email, `${SUBJECT[kind]} · ${details.clinic?.name ?? "your clinic"}`, msgs.patient.replace(/\n\nReply (CANCEL|STOP)[^\n]*/g, ""), { fromName: details.clinic?.name, replyTo: cl?.email });
        } catch { /* optional */ }
        return null;
      })() as Promise<NotificationResult>);
    }
  }
  if ((!only || only.includes("doctor")) && details.doctor) jobs.push(deliver(db, ctx, "doctor", details.doctor.phone, kind, msgs.doctor, details));
  return (await Promise.all(jobs)).filter(Boolean);
}
