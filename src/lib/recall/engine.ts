/**
 * Recall: nudge patients who are due, without anyone having to remember who.
 *   treatment_pending  a treatment plan is open and nothing is booked
 *   lapsed             no visit for a long time and nothing is booked
 * Only people the database lists as eligible can be messaged (phone on file, not opted out, not nudged lately).
 */
import { sendViaCloudApi, waLink, whatsappConfigured, whatsappPhone } from "@/lib/booking/notify";

export interface RecallCandidate { patient_id: string; name: string; phone: string; reason: "treatment_pending" | "lapsed"; detail: string; last_visit: string | null; days_since: number | null }
export interface RecallSettings { auto: boolean; days: number; daily_limit: number }
export const DEFAULT_RECALL: RecallSettings = { auto: false, days: 180, daily_limit: 20 };

export const recallSettings = (clinicSettings: any): RecallSettings => {
  const r = clinicSettings?.recall ?? {};
  return { auto: r.auto === true, days: Math.min(Math.max(Number(r.days) || DEFAULT_RECALL.days, 30), 730), daily_limit: Math.min(Math.max(Number(r.daily_limit) || DEFAULT_RECALL.daily_limit, 1), 100) };
};

export function recallText(c: { name: string; reason: string; detail: string }, clinic: string): string {
  const first = c.name.trim().split(/\s+/)[0] || "there";
  const body = c.reason === "treatment_pending"
    ? `your treatment (${c.detail}) is still in progress and your next visit isn't booked yet.`
    : `it's been a while since your last visit. A regular check-up helps catch problems early.`;
  return `Hi ${first}, this is ${clinic}: ${body} Reply *book* and I'll find you a time. Reply *stop* to stop these messages.`;
}

export async function loadCandidates(db: any, clinicId: string, days = DEFAULT_RECALL.days): Promise<RecallCandidate[]> {
  const { data, error } = await db.rpc("recall_candidates", { p_clinic: clinicId, p_days: days, p_cooldown: 30 });
  if (error) throw new Error(error.message);
  return (data ?? []) as RecallCandidate[];
}

export interface RecallResult { patient_id: string; name: string; status: "sent" | "link" | "failed" | "skipped"; link?: string; error?: string }

export async function sendRecall(db: any, clinicId: string, patientIds: string[], opts: { actor?: string | null; auto?: boolean; days?: number } = {}): Promise<RecallResult[]> {
  const { data: cl } = await db.from("clinics").select("name, brand_name").eq("id", clinicId).maybeSingle();
  const clinic = cl?.brand_name || cl?.name || "the clinic";
  const eligible = new Map((await loadCandidates(db, clinicId, opts.days)).map((c) => [c.patient_id, c]));
  const out: RecallResult[] = [];
  for (const id of Array.from(new Set(patientIds)).slice(0, 50)) {
    const c = eligible.get(id);
    if (!c) { out.push({ patient_id: id, name: "", status: "skipped", error: "Not due, opted out, no phone, or contacted recently" }); continue; }
    const phone = whatsappPhone(c.phone);
    const text = recallText(c, clinic);
    let r: RecallResult = { patient_id: id, name: c.name, status: "skipped", error: "No valid phone number" };
    if (phone) {
      if (!whatsappConfigured()) r = { patient_id: id, name: c.name, status: "link", link: waLink(phone, text) };
      else {
        try {
          const tpl = process.env.WHATSAPP_TEMPLATE_RECALL_PATIENT;
          await sendViaCloudApi(phone, text, tpl ? { name: tpl, params: [c.name.split(" ")[0], clinic, c.detail] } : undefined);
          r = { patient_id: id, name: c.name, status: "sent" };
        } catch (e: any) { r = { patient_id: id, name: c.name, status: "failed", error: e.message, link: waLink(phone, text) }; }
      }
    }
    if (r.status !== "skipped") {
      try { await db.from("recall_log").insert({ clinic_id: clinicId, patient_id: id, reason: c.reason, channel: r.status === "sent" ? "whatsapp" : "link", status: r.status, link: r.link ?? null, error: r.error ?? null, sent_by: opts.actor ?? null, auto: !!opts.auto }); } catch { /* the log never blocks sending */ }
    }
    out.push(r);
  }
  return out;
}

/** The daily job: clinics that switched on automatic recall get up to their daily limit of messages. Needs WhatsApp connected. */
export async function runRecallDaily(db: any): Promise<{ clinics: number; sent: number }> {
  if (!whatsappConfigured()) return { clinics: 0, sent: 0 };
  const { data: clinics } = await db.from("clinics").select("id, settings").eq("is_active", true).filter("settings->recall->>auto", "eq", "true").limit(500);
  let sent = 0, n = 0;
  for (const c of clinics ?? []) {
    const s = recallSettings(c.settings); if (!s.auto) continue;
    n++;
    try {
      const cands = await loadCandidates(db, c.id, s.days);
      const res = await sendRecall(db, c.id, cands.slice(0, s.daily_limit).map((x) => x.patient_id), { auto: true, days: s.days });
      sent += res.filter((r) => r.status === "sent").length;
    } catch (e) { console.error("recall failed for a clinic:", e instanceof Error ? e.message : e); }
  }
  return { clinics: n, sent };
}
