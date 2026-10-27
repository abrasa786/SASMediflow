import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

/**
 * Link the treatment sittings an invoice bills for. One invoice may cover several sittings, and a sitting may be billed over several invoices
 * (the amounts say how much of each). Everything is checked against the clinic and the patient.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "receptionist"]);
    if (typeof b.invoiceId !== "string" || !Array.isArray(b.links) || !b.links.length || b.links.length > 30) throw new HttpError(400, "Choose the sittings to bill.");
    const { data: inv } = await db.from("invoices").select("id, clinic_patient_id").eq("id", b.invoiceId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!inv) throw new HttpError(404, "Invoice not found in this clinic.");
    const ids = b.links.map((l: any) => String(l.sittingId));
    const { data: sits } = await db.from("treatment_sittings").select("id, plan_id, invoice_id, treatment_plans!inner(clinic_patient_id)").in("id", ids).eq("clinic_id", b.clinicId);
    if (!sits || sits.length !== new Set(ids).size) throw new HttpError(400, "A sitting was not found in this clinic.");
    if (sits.some((s: any) => s.treatment_plans?.clinic_patient_id !== inv.clinic_patient_id)) throw new HttpError(400, "Those sittings belong to a different patient.");
    const rows = b.links.map((l: any) => {
      const amount = Number(l.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, "Enter a valid amount for each sitting.");
      return { clinic_id: b.clinicId, invoice_id: b.invoiceId, sitting_id: String(l.sittingId), amount };
    });
    const { error } = await db.from("invoice_sittings").upsert(rows, { onConflict: "invoice_id,sitting_id" });
    if (error) throw new HttpError(400, /invoice_sittings/.test(error.message) ? "Run migration 025 (treatment invoices) in Supabase first." : error.message);
    const plans = Array.from(new Set(sits.map((s: any) => s.plan_id)));
    if (plans.length === 1) await db.from("invoices").update({ treatment_plan_id: plans[0] }).eq("id", b.invoiceId).eq("clinic_id", b.clinicId);
    for (const s of sits as any[]) if (!s.invoice_id) await db.from("treatment_sittings").update({ invoice_id: b.invoiceId }).eq("id", s.id).eq("clinic_id", b.clinicId).is("invoice_id", null);
    return { ok: true };
  });
}
