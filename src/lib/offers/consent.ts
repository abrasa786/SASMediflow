import { sendViaCloudApi, waLink, whatsappConfigured, whatsappPhone } from "@/lib/booking/notify";

export type AskResult = { status: "sent" } | { status: "link"; link: string } | { status: "failed"; error: string; link: string } | { status: "skipped"; reason: "opted_in" | "opted_out" | "no_phone" | "not_found" | "no_template" };

/**
 * Asks a patient on WhatsApp if they want tips and offers (they reply START). Never asks someone who already agreed or who said STOP.
 * With `autoOnly`, it only sends when WhatsApp and the consent template are set up (so a new patient is asked automatically, with no tapping).
 */
export async function requestOffersConsent(db: any, clinicId: string, patientId: string, autoOnly = false): Promise<AskResult> {
  const { data: p, error } = await db.from("clinic_patients").select("name, phone, marketing_opt_in, marketing_opt_out_at").eq("id", patientId).eq("clinic_id", clinicId).maybeSingle();
  if (error) throw new Error(/marketing_opt/.test(error.message) ? "Run migration 020 (offers consent) first." : error.message);
  if (!p) return { status: "skipped", reason: "not_found" };
  if (p.marketing_opt_in) return { status: "skipped", reason: "opted_in" };
  if (p.marketing_opt_out_at) return { status: "skipped", reason: "opted_out" };
  const phone = whatsappPhone(p.phone);
  if (!phone) return { status: "skipped", reason: "no_phone" };
  const tpl = process.env.WHATSAPP_TEMPLATE_CONSENT;
  if (autoOnly && (!whatsappConfigured() || !tpl)) return { status: "skipped", reason: "no_template" };

  const { data: c } = await db.from("clinics").select("name, brand_name, settings").eq("id", clinicId).maybeSingle();
  if (autoOnly && c?.settings?.auto_ask_offers === false) return { status: "skipped", reason: "no_template" };
  const clinic = c?.brand_name ?? c?.name ?? "our clinic";
  const first = String(p.name ?? "").split(" ")[0] || "there";
  const text = `Hi ${first}, ${clinic} would like to send you occasional dental tips and offers on WhatsApp. Reply START to agree. You can reply STOP at any time.`;
  const link = waLink(phone, text);
  if (!whatsappConfigured()) return { status: "link", link };
  try { await sendViaCloudApi(phone, text, tpl ? { name: tpl, params: [first, clinic] } : undefined); return { status: "sent" }; }
  catch (e: any) { return { status: "failed", error: e.message, link }; }
}
