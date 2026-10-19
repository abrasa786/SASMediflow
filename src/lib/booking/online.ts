/** Patient-facing online booking: find the clinic, settings, and the "payment done" step shared by the browser and the webhook. */
import { HttpError } from "@/lib/server/http";
import { parseEngineError, friendlyEngineMessage, suggestSlots } from "./engine";
import { notifyAppointment } from "./notify";
import { processFlowsSoon } from "@/lib/flows/engine";
import { gatewayFor, refundPayment, type Gateway } from "@/lib/payments/razorpay";

export interface OnlineSettings { enabled: boolean; fee: number; hold_minutes: number; advance_days: number; notice: string }
export const onlineSettings = (settings: any): OnlineSettings => {
  const s = settings?.online_booking ?? {};
  return {
    enabled: s.enabled === true, fee: Math.max(0, Number(s.fee) || 0), hold_minutes: Math.min(30, Math.max(3, Number(s.hold_minutes) || 10)),
    advance_days: Math.min(180, Math.max(1, Number(s.advance_days) || 30)), notice: typeof s.notice === "string" ? s.notice.slice(0, 400) : "",
  };
};

/** The clinic for a web address: ?clinic=<slug>, or the visitor's own domain (?host=). Returns the private row; callers choose what to expose. */
export async function findClinic(db: any, ref: { slug?: string | null; host?: string | null }) {
  const slug = (ref.slug ?? "").toLowerCase(), host = (ref.host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]{0,253}$/.test(slug + host) || (!slug && !host)) throw new HttpError(404, "Clinic not found.");
  const cols = "id, slug, name, brand_name, tagline, logo_url, primary_color, address, city, phone, email, specialty, settings, is_active, custom_domain, domain_verified";
  let q: any = null;
  if (slug && slug !== "_host") q = (await db.from("clinics").select(cols).eq("slug", slug).maybeSingle()).data;
  else {
    const bare = host.replace(/^www\./, "");
    for (const h of Array.from(new Set([host, bare, "www." + bare]))) {
      q = (await db.from("clinics").select(cols).eq("custom_domain", h).eq("domain_verified", true).maybeSingle()).data;
      if (q) break;
    }
    const root = (process.env.ROOT_DOMAIN ?? "").toLowerCase();
    if (!q && root && bare.endsWith("." + root)) q = (await db.from("clinics").select(cols).eq("slug", bare.slice(0, -root.length - 1)).maybeSingle()).data;
  }
  if (!q || q.is_active === false) throw new HttpError(404, "Clinic not found.");
  return q;
}

export function requireOpen(clinic: any): { s: OnlineSettings; gw: Gateway | null } {
  const s = onlineSettings(clinic.settings);
  if (!s.enabled) throw new HttpError(403, "This clinic is not taking online bookings right now. Please call the clinic.");
  const gw = gatewayFor(clinic.settings);
  if (s.fee > 0 && !gw) throw new HttpError(503, "Online payment is not set up for this clinic yet. Please call the clinic to book.");
  return { s, gw };
}

/** What the patient sees after booking. Only their own booking, nothing else. */
export function summary(d: any) {
  const a = d.appointment, c = d.clinic ?? {};
  return {
    id: String(a.id).slice(0, 8).toUpperCase(), date: a.date, time: a.time, duration: a.duration_minutes ?? null,
    doctor: d.doctor?.name ?? null, patient: d.patient?.name ?? null, advancePaid: Number(d.advance_paid ?? 0), fee: Number(a.fee ?? 0),
    clinic: { name: c.name ?? "", address: c.address ?? "", phone: c.phone ?? "" },
  };
}

/** Payment is done (checkout success or webhook): make the appointment, message the patient, or refund if the slot was lost. Safe to call twice. */
export async function finalizeBooking(db: any, clinic: any, gw: Gateway | null, a: { holdId: string; orderId: string | null; paymentId: string | null }) {
  const { data, error } = await db.rpc("online_confirm", { p_hold: a.holdId, p_order: a.orderId, p_payment: a.paymentId });
  if (!error) {
    if (!data?.already) {
      try { await notifyAppointment(db, clinic.id, data, "confirmation"); } catch { /* the booking is saved; messaging is best effort */ }
      await processFlowsSoon(db, clinic.id).catch(() => {});
    }
    return { details: data };
  }
  const { code } = parseEngineError(error.message);
  if (code === "SLOT_LOST" || code === "HOLD_GONE") {
    // The patient paid but the slot is gone: give the money back automatically.
    let refunded = false, refundId = "";
    const { data: h } = await db.from("booking_holds").select("amount").eq("id", a.holdId).maybeSingle();
    const amount = Number(h?.amount ?? onlineSettings(clinic.settings).fee);
    if (gw && a.paymentId && a.orderId && amount > 0) {
      try { refundId = await refundPayment(gw, a.paymentId, amount); refunded = true; } catch { /* recorded below */ }
      await db.rpc("online_note_refund", { p_clinic: clinic.id, p_order: a.orderId, p_payment: a.paymentId, p_amount: amount, p_refund: refundId || null, p_ok: refunded, p_note: "Slot was taken before the payment completed" });
    }
    await db.from("booking_holds").delete().eq("id", a.holdId);
    let suggestions: any[] = [];
    try { suggestions = await suggestSlots(db, clinic.id, new Date().toISOString().slice(0, 10), { max: 6 }); } catch { /* optional */ }
    throw new HttpError(409, refunded ? "Sorry, that time was just taken. Your payment has been refunded; please pick another time." : "Sorry, that time was just taken. The clinic will refund your payment; please call the clinic.", { code, refunded, suggestions });
  }
  throw new HttpError(code === "ERROR" ? 500 : 400, friendlyEngineMessage(code, error.message));
}
