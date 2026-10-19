/**
 * WhatsApp helpers — calls our internal API route
 * which uses Meta Cloud API (not Twilio)
 */

import { getActiveClinicId, getSession } from "./auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

/** The send route requires a signed-in clinic member, so attach the session token and clinic. */
async function postWhatsApp(payload: Record<string, unknown>) {
  const session = await getSession();
  return fetch(`${APP_URL}/api/whatsapp/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ clinicId: getActiveClinicId(), ...payload }),
  }).then(r => r.json());
}

export async function sendAppointmentReminder({
  to,
  patientName,
  doctorName,
  date,
  time,
  clinicName,
  clinicAddress,
}: {
  to: string;
  patientName: string;
  doctorName?: string;
  date: string;
  time: string;
  clinicName: string;
  clinicAddress?: string;
}) {
  const message = `Hi ${patientName}! 👋\n\nThis is a reminder for your appointment at *${clinicName}*.\n\n📅 Date: ${date}\n🕐 Time: ${time}${doctorName ? `\n👨‍⚕️ Doctor: ${doctorName}` : ""}${clinicAddress ? `\n📍 ${clinicAddress}` : ""}\n\nPlease arrive 10 minutes early. Reply CANCEL to cancel.\n\nSee you soon! 🏥`;

  return postWhatsApp({ type: "text", to, message });
}

export async function sendBookingConfirmation({
  to,
  patientName,
  doctorName,
  date,
  time,
  clinicName,
  mode,
  invoiceNumber,
  fee,
}: {
  to: string;
  patientName: string;
  doctorName?: string;
  date: string;
  time: string;
  clinicName: string;
  mode?: "in_clinic" | "video";
  invoiceNumber?: string;
  fee?: number;
}) {
  const modeText = mode === "video" ? "📹 Video Consultation" : "🏥 In-clinic Visit";
  const message = `✅ *Appointment Confirmed!*\n\nHi ${patientName}, your appointment has been booked.\n\n📅 ${date} at ${time}${doctorName ? `\n👨‍⚕️ ${doctorName}` : ""}\n${modeText}\n🏥 ${clinicName}${fee ? `\n💰 Fee: ₹${fee}` : ""}${invoiceNumber ? `\n📄 Invoice: ${invoiceNumber}` : ""}\n\nFor any changes, please call us. See you soon! 😊`;

  return postWhatsApp({ type: "text", to, message });
}

export async function sendInvoiceLink({
  to,
  patientName,
  invoiceNumber,
  total,
  clinicName,
}: {
  to: string;
  patientName: string;
  invoiceNumber: string;
  total: number;
  clinicName: string;
}) {
  const message = `🧾 *Invoice from ${clinicName}*\n\nHi ${patientName},\n\nYour invoice ${invoiceNumber} for ₹${total.toLocaleString("en-IN")} has been generated.\n\nThank you for choosing ${clinicName}! 💙`;

  return postWhatsApp({ type: "text", to, message });
}
