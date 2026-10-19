import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember, type Role } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

/** Everyone on the claims desk can look; doctors only read. */
const READERS: Role[] = ["admin", "doctor", "nurse", "receptionist"];
const DESK: Role[] = ["admin", "nurse", "receptionist"];
const UUID = /^[0-9a-f-]{36}$/i;
const NOT_INSTALLED = "Insurance claims are not installed yet. Run supabase/migrations/016_insurance_claims.sql in the Supabase SQL editor.";
const missingTable = (m: string) => /insurance_payers|claims|claims_summary|does not exist|schema cache|Could not find/i.test(m);

/**
 * GET ?clinicId                  → claims list, payers, desk numbers, caller's role
 * GET ?clinicId&claimId          → one claim with papers, timeline and deductions
 * GET ?clinicId&patients=<text>  → patients matching a name or phone, with their policies
 */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const clinicId = q.get("clinicId");
    const { db, role } = await requireClinicMember(req, clinicId, READERS);

    const claimId = q.get("claimId");
    if (claimId) {
      if (!UUID.test(claimId)) throw new HttpError(400, "claimId is invalid.");
      const { data, error } = await db.from("claims")
        .select("*, clinic_patients(name, phone), insurance_payers(name, kind, portal_url, phone), patient_policies(policy_number, member_id, sum_insured, valid_to, abha_id, insurance_payers!patient_policies_payer_id_fkey(name)), claim_documents(*), claim_events(*), claim_deductions(*)")
        .eq("clinic_id", clinicId).eq("id", claimId).maybeSingle();
      if (error) throw new HttpError(missingTable(error.message) ? 500 : 400, missingTable(error.message) ? NOT_INSTALLED : error.message);
      if (!data) throw new HttpError(404, "Claim not found.");
      data.claim_documents?.sort((a: any, b: any) => a.stage.localeCompare(b.stage) * -1 || a.sort_order - b.sort_order);
      data.claim_events?.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1));
      return { claim: data, role };
    }

    const term = q.get("patients");
    if (term !== null) {
      const t = term.trim().slice(0, 40).replace(/[%,()]/g, "");
      let pq = db.from("clinic_patients").select("id, name, phone, patient_policies(id, policy_number, sum_insured, valid_to, is_active, payer:insurance_payers!patient_policies_payer_id_fkey(name), tpa:insurance_payers!patient_policies_tpa_id_fkey(name))")
        .eq("clinic_id", clinicId).order("name").limit(15);
      if (t) pq = pq.or(`name.ilike.%${t}%,phone.ilike.%${t}%`);
      const { data, error } = await pq;
      if (error) throw new HttpError(missingTable(error.message) ? 500 : 400, missingTable(error.message) ? NOT_INSTALLED : error.message);
      return { patients: (data ?? []).map((p: any) => ({ ...p, patient_policies: (p.patient_policies ?? []).filter((x: any) => x.is_active) })) };
    }

    const [claims, payers, summary] = await Promise.all([
      db.from("claims").select("id, claim_number, status, procedure, admission_date, estimated_amount, approved_amount, billed_amount, settled_amount, preauth_sent_at, discharge_sent_at, updated_at, created_at, clinic_patients(name), insurance_payers(name), claim_documents(stage, required, received)")
        .eq("clinic_id", clinicId).neq("status", "cancelled").order("updated_at", { ascending: false }).limit(300),
      db.from("insurance_payers").select("*").eq("clinic_id", clinicId).eq("is_active", true).order("name"),
      db.rpc("claims_summary", { p_clinic: clinicId, p_from: null, p_to: null }),
    ]);
    const first = [claims, payers, summary].find((r) => r.error);
    if (first?.error) throw new HttpError(500, missingTable(first.error.message) ? NOT_INSTALLED : first.error.message);
    return { claims: claims.data ?? [], payers: payers.data ?? [], summary: summary.data, role };
  });
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
const amount = (v: unknown, what: string) => {
  const n = num(v);
  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 1e9)) throw new HttpError(400, `Enter a valid ${what}.`);
  return n;
};
const needId = (v: unknown, what = "claimId") => { if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, `${what} is required.`); return v; };

/** Every change to a claim. Admin, nurses and receptionists run the desk. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, DESK);
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) { if (/Could not find the function|function .* does not exist/i.test(error.message)) throw new HttpError(500, NOT_INSTALLED); throwRpc(error); }
      return data ?? { ok: true };
    };
    const base = { p_clinic: b.clinicId, p_actor: userId };

    switch (b.action) {
      case "payer":
        return rpc("payer_save", { p: { clinic_id: b.clinicId, id: b.id ?? null, name: str(b.name, 100), kind: str(b.kind, 20) || "insurer",
          portal_url: str(b.portal_url), phone: str(b.phone, 20), email: str(b.email, 120), notes: str(b.notes) } });
      case "payer_archive": {
        const { error } = await db.from("insurance_payers").update({ is_active: false }).eq("id", needId(b.id, "id")).eq("clinic_id", b.clinicId);
        if (error) throw new HttpError(400, error.message);
        return { archived: true };
      }
      case "policy":
        return rpc("policy_save", { p: { clinic_id: b.clinicId, patient_id: needId(b.patientId, "patientId"), payer_id: b.payerId ?? null, tpa_id: b.tpaId || null,
          policy_number: str(b.policyNumber, 60), member_id: str(b.memberId, 60), holder_name: str(b.holderName, 100), sum_insured: amount(b.sumInsured, "sum insured"),
          valid_from: str(b.validFrom, 10) || null, valid_to: str(b.validTo, 10) || null, abha_id: str(b.abhaId, 60) } });
      case "create":
        return rpc("claim_create", { p: { clinic_id: b.clinicId, actor: userId, policy_id: needId(b.policyId, "policyId"), procedure: str(b.procedure, 200),
          admission_date: str(b.admissionDate, 10) || null, estimated_amount: amount(b.estimatedAmount, "estimate"), invoice_id: b.invoiceId || null, notes: str(b.notes, 1000) } });
      case "advance":
        if (typeof b.to !== "string") throw new HttpError(400, "Choose what happened.");
        return rpc("claim_advance", { ...base, p_claim: needId(b.claimId), p_to: b.to, p: {
          approved_amount: amount(b.approvedAmount, "approved amount"), billed_amount: amount(b.billedAmount, "bill amount"), settled_amount: amount(b.settledAmount, "paid amount"),
          insurer_ref: str(b.insurerRef, 60), discharge_date: str(b.dischargeDate, 10), note: str(b.note, 1000) } });
      case "query":
        return rpc("claim_query", { ...base, p_claim: needId(b.claimId), p_message: str(b.message, 1000) });
      case "reply":
        return rpc("claim_reply", { ...base, p_claim: needId(b.claimId), p_message: str(b.message, 1000) });
      case "note":
        await rpc("claim_note", { ...base, p_claim: needId(b.claimId), p_message: str(b.message, 1000) });
        return { ok: true };
      case "doc":
        return rpc("claim_doc_set", { p_clinic: b.clinicId, p_claim: needId(b.claimId), p: { doc_id: b.docId || null, received: b.received ?? true,
          stage: str(b.stage, 10) || null, name: str(b.name, 150), required: b.required ?? true, note: str(b.note) } });
      case "deduction":
        return rpc("claim_deduction_save", { ...base, p_claim: needId(b.claimId), p: { deduction_id: b.deductionId || null, category: str(b.category, 20) || null,
          reason: str(b.reason), amount: amount(b.amount, "amount"), outcome: str(b.outcome, 20) || null, recovered_amount: amount(b.recoveredAmount, "recovered amount") } });
      default:
        throw new HttpError(400, "Unknown action.");
    }
  });
}
