"use client";

import { useEffect, useState } from "react";
import { supabase as sb } from "@/lib/supabase";
import { planBadge, planTotals } from "@/lib/treatments";

const supabase = sb as any;
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/** The treatment(s) an invoice bills for: every sitting of the plan with its price, the ones on this invoice marked. Shows nothing for an invoice with no treatment. */
export default function InvoiceTreatments({ clinicId, invoiceId }: { clinicId: string; invoiceId: string }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [onThis, setOnThis] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!clinicId || !invoiceId) return;
    (async () => {
      const l = await supabase.from("invoice_sittings").select("sitting_id, amount, treatment_sittings(plan_id)").eq("clinic_id", clinicId).eq("invoice_id", invoiceId);
      if (l.error || !l.data?.length) return;                                            // no treatment on this invoice, or migration 025 not run
      setOnThis(Object.fromEntries(l.data.map((x: any) => [x.sitting_id, Number(x.amount)])));
      const planIds = Array.from(new Set(l.data.map((x: any) => x.treatment_sittings?.plan_id).filter(Boolean)));
      const p = await supabase.from("treatment_plans").select("id, title, total_amount, discount, status, payment_status, mode, treatment_sittings(id, seq, label, due_amount, paid_amount, status, appointment_id)").eq("clinic_id", clinicId).in("id", planIds);
      setPlans(p.data ?? []);
    })();
  }, [clinicId, invoiceId]);

  if (!plans.length) return null;
  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Treatments on this invoice">
      <h2 className="font-semibold text-slate-900 text-sm">Treatments</h2>
      {plans.map((p) => (
        <div key={p.id} className="mt-3">
          <p className="text-sm font-medium text-slate-800">{p.title} <span className="text-xs font-normal text-slate-500">· {p.mode === "flexible" ? `estimate ${inr(p.total_amount - p.discount)}` : `total ${inr(p.total_amount - p.discount)}`}</span>
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${planBadge(p).cls}`}>{planBadge(p).text}</span></p>
          {p.mode === "flexible" && (() => { const t = planTotals({ ...p, total_amount: 0 }); return <p className="text-xs text-slate-500">Billed so far {inr(t.billed)} · paid {inr(t.paid)}{t.due > 0 ? ` · ${inr(t.due)} due` : ""}. Only the sittings on an invoice are charged. You can change a sitting&apos;s price on the invoice.</p>; })()}
          <ul className="mt-1 divide-y divide-slate-50">
            {(p.treatment_sittings ?? []).sort((a: any, b: any) => a.seq - b.seq).map((t: any) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="min-w-0"><span className={onThis[t.id] !== undefined ? "font-semibold text-slate-900" : "text-slate-600"}>Sitting {t.seq}{t.label ? ` · ${t.label}` : ""}</span>
                  <span className="block text-xs text-slate-500">{t.status === "done" ? "Done" : t.status}{onThis[t.id] !== undefined ? " · on this invoice" : " · on another invoice or not billed yet"}</span></span>
                <span className="text-right shrink-0">{inr(t.due_amount)}<span className="block text-xs text-slate-500">paid {inr(t.paid_amount)}</span></span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
