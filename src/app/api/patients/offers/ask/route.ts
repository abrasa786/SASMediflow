import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { sendViaCloudApi, waLink, whatsappConfigured, whatsappPhone } from "@/lib/booking/notify";

/**
 * Front desk: send the patient a WhatsApp message asking if they want tips and offers. They answer START (handled by the WhatsApp webhook) or ignore it.
 * Nothing is sent to a patient who already agreed or who switched offers off. For first contact WhatsApp needs an approved template: set WHATSAPP_TEMPLATE_CONSENT
 * (body variables: {{1}} first name, {{2}} clinic name). Without WhatsApp set up, a ready-to-send link is returned instead.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.patientId !== "string") throw new HttpError(400, "Which patient?");
    const { data: p, error } = await db.from("clinic_patients").select("name, phone, marketing_opt_in, marketing_opt_out_at").eq("id", b.patientId).eq("clinic_id", b.clinicId).maybeSingle();
    if (error) throw new HttpError(400, /marketing_opt/.test(error.message) ? "Run migration 020 (offers consent) first." : error.message);
    if (!p) throw new HttpError(404, "Patient not found in this clinic.");
    if (p.marketing_opt_in) throw new HttpError(409, "This patient has already agreed to get offers.");
    if (p.marketing_opt_out_at) throw new HttpError(409, "This patient switched offers off, so they will not be asked again. If they want them back, tick the box when they tell you.");
    const phone = whatsappPhone(p.phone);
    if (!phone) throw new HttpError(400, "This patient has no valid mobile number.");

    const { data: c } = await db.from("clinics").select("name, brand_name").eq("id", b.clinicId).maybeSingle();
    const clinic = c?.brand_name ?? c?.name ?? "our clinic";
    const first = String(p.name ?? "").split(" ")[0] || "there";
    const text = `Hi ${first}, ${clinic} would like to send you occasional dental tips and offers on WhatsApp. Reply START to agree. You can reply STOP at any time.`;
    const link = waLink(phone, text);
    if (!whatsappConfigured()) return { status: "link", link };
    try {
      const tpl = process.env.WHATSAPP_TEMPLATE_CONSENT;
      await sendViaCloudApi(phone, text, tpl ? { name: tpl, params: [first, clinic] } : undefined);
      return { status: "sent" };
    } catch (e: any) { return { status: "failed", error: e.message, link }; }
  });
}
