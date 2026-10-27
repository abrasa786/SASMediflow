import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { sendViaCloudApi, whatsappConfigured, whatsappPhone, waLink } from "@/lib/booking/notify";
import { classify, OFFER_BATCH, OFFER_GAP_DAYS } from "@/lib/offers/eligibility";

export const maxDuration = 60;

/**
 * Send one treatment explainer to the patients the clinic picked. The server decides who is allowed:
 * only patients with offers switched ON, with a phone, and not messaged in the last 30 days. Everyone else is skipped, whatever the page sent.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor"]);
    const ids: string[] = Array.isArray(b.patientIds) ? Array.from(new Set(b.patientIds.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)))) as string[] : [];
    if (!ids.length) throw new HttpError(400, "Choose at least one patient.");
    if (ids.length > OFFER_BATCH) throw new HttpError(400, `Send to at most ${OFFER_BATCH} patients at a time.`);
    if (typeof b.treatmentId !== "string") throw new HttpError(400, "Choose a treatment.");

    const { data: t } = await db.from("treatment_info").select("id, name, summary, is_published").eq("id", b.treatmentId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!t) throw new HttpError(404, "Treatment not found.");
    if (!t.is_published) throw new HttpError(400, "Publish this treatment first, so the patient's link works.");
    const { data: clinic } = await db.from("clinics").select("name, brand_name").eq("id", b.clinicId).maybeSingle();
    const clinicName = clinic?.brand_name ?? clinic?.name ?? "our clinic";

    const { data: pts, error } = await db.from("clinic_patients").select("id, name, phone, marketing_opt_in").eq("clinic_id", b.clinicId).in("id", ids);
    if (error) throw new HttpError(400, error.message.includes("marketing_opt_in") ? "Run migration 020 first (offers consent)." : error.message);
    const since = new Date(Date.now() - OFFER_GAP_DAYS * 86400_000).toISOString();
    const { data: recent } = await db.from("offer_sends").select("patient_id").eq("clinic_id", b.clinicId).in("status", ["sent", "link"]).gte("created_at", since).in("patient_id", ids);
    const recentSet = new Set((recent ?? []).map((r: any) => r.patient_id));

    const base = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const link = `${base}/t/${t.id}`;
    const custom = typeof b.message === "string" ? b.message.trim().slice(0, 400) : "";
    const tpl = process.env.WHATSAPP_TEMPLATE_OFFER;
    const results: { patientId: string; name: string; status: "sent" | "skipped" | "failed" | "link"; reason?: string; link?: string }[] = [];

    for (const p of pts ?? []) {
      const elig = classify(p, recentSet.has(p.id));
      if (elig !== "ok") { results.push({ patientId: p.id, name: p.name, status: "skipped", reason: elig }); continue; }
      const phone = whatsappPhone(p.phone);
      if (!phone) { results.push({ patientId: p.id, name: p.name, status: "skipped", reason: "no_phone" }); continue; }
      const first = String(p.name ?? "").split(" ")[0] || "there";
      const text = `Hi ${first}, a note from ${clinicName}: ${custom || t.summary || t.name}\nRead more: ${link}\nReply STOP to stop these messages.`;
      let status: "sent" | "failed" | "link" = "sent", err: string | null = null, wa: string | undefined;
      try {
        if (!whatsappConfigured()) { status = "link"; wa = waLink(phone, text); }
        else await sendViaCloudApi(phone, text, tpl ? { name: tpl, params: [first, t.name, clinicName, link] } : undefined);
      } catch (e: any) { status = "failed"; err = e.message; wa = waLink(phone, text); }
      try { await db.from("offer_sends").insert({ clinic_id: b.clinicId, patient_id: p.id, treatment_id: t.id, phone, status, error: err }); } catch { /* the log must never block */ }
      results.push({ patientId: p.id, name: p.name, status, reason: err ?? undefined, link: wa });
    }
    for (const id of ids) if (!results.some((r) => r.patientId === id)) results.push({ patientId: id, name: "", status: "skipped", reason: "not_found" });
    return { results, templateUsed: !!tpl };
  });
}
