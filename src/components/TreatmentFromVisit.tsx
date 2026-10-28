"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { toast } from "@/lib/toast";
import { inr, planBadge, planTotals, sittingPay } from "@/lib/treatments";
import EquipmentPicker, { type Mat, type StockOpt } from "@/components/EquipmentPicker";
import SittingForm from "@/components/SittingForm";

const supabase = sb as any;
const inp = "w-full px-3 py-3 rounded-xl border border-slate-300 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50";
const KINDS: [string, string, string][] = [["enquiry", "Enquiry", "Just asking about a treatment or price"], ["consultation", "Consultation", "Examined, advised, no treatment today"], ["treatment", "Treatment", "A sitting of a treatment today"]];

/**
 * What happened at this visit. An enquiry or a consultation needs nothing more. A treatment visit adds a sitting:
 * the treatment (new, or one the patient already has), what THIS sitting costs, the equipment used. Then Next: complete the sitting and bill it.
 */
export default function TreatmentFromVisit({ clinicId, appointmentId, patientId, canEdit, onChange }: { clinicId: string; appointmentId: string; patientId: string; canEdit: boolean; onChange?: () => void }) {
  const router = useRouter();
  const [kind, setKind] = useState("consultation");
  const [sitting, setSitting] = useState<any | null>(null);
  const [plan, setPlan] = useState<any | null>(null);
  const [stock, setStock] = useState<StockOpt[]>([]);
  const [label, setLabel] = useState(""); const [price, setPrice] = useState(""); const [mats, setMats] = useState<Mat[]>([]);
  const [wantsTreatment, setWantsTreatment] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ invoiceId: string; stock: any[] } | null>(null);

  const matsFrom = (c: any) => (Array.isArray(c) ? c : []).map((m: any) => ({ item: String(m.item ?? m.name ?? ""), qty: String(m.qty ?? m.quantity ?? "") }));

  const load = useCallback(async () => {
    const [a, s, st] = await Promise.all([
      supabase.from("appointments").select("visit_kind").eq("id", appointmentId).eq("clinic_id", clinicId).maybeSingle(),
      supabase.from("treatment_sittings").select("id, seq, label, status, due_amount, paid_amount, consumables, invoice_id, plan_id").eq("clinic_id", clinicId).eq("appointment_id", appointmentId).order("seq").limit(1),
      supabase.from("stock_items").select("name, quantity, unit").eq("clinic_id", clinicId).order("name").limit(500),
    ]);
    setStock(st.data ?? []);
    if (a.data?.visit_kind) setKind(a.data.visit_kind);
    const cur = s.data?.[0];
    if (!cur) { setSitting(null); setPlan(null); return; }
    const p = await supabase.from("treatment_plans").select("id, title, status, payment_status, total_amount, discount, mode, finish_requested, treatment_sittings(id, seq, label, status, due_amount, paid_amount, invoice_id, appointment_id)").eq("clinic_id", clinicId).eq("id", cur.plan_id).maybeSingle();
    setSitting(cur); setPlan(p.data ?? null); setKind("treatment");
    setLabel(cur.label ?? ""); setPrice(String(cur.due_amount ?? "")); setMats(matsFrom(cur.consumables));
  }, [clinicId, appointmentId]);
  useEffect(() => { if (clinicId && appointmentId) load(); }, [clinicId, appointmentId, load]);

  async function chooseKind(k: string) {
    setErr("");
    if (k === "treatment") { setWantsTreatment(true); setKind("treatment"); return; }
    setWantsTreatment(false); setKind(k);
    const { error } = await supabase.from("appointments").update({ visit_kind: k }).eq("id", appointmentId).eq("clinic_id", clinicId);
    if (error) return setErr("Could not save that. " + error.message);
    toast(k === "enquiry" ? "Marked as an enquiry" : "Marked as a consultation"); onChange?.();
  }

  async function saveChanges() {
    if (!sitting) return;
    if (label.trim().length < 2) return setErr("Name this sitting, for example “Tooth removal”.");
    setBusy(true); setErr("");
    try {
      await authFetch("/api/treatments/sitting", { body: { clinicId, action: "update", sittingId: sitting.id, label: label.trim(), ...(sitting.invoice_id ? {} : { price: Number(price) }), materials: mats.filter((m) => m.item.trim()).map((m) => ({ item: m.item.trim(), qty: Number(m.qty) || 1 })) } });
      toast("Sitting saved"); await load(); onChange?.();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function complete() {
    if (!sitting) return;
    if (!confirm("Complete this sitting? The bill for this sitting is created and the equipment is taken off the stock.")) return;
    setBusy(true); setErr("");
    try {
      const r: any = await authFetch("/api/treatments/complete", { body: { clinicId, sittingId: sitting.id } });
      setDone({ invoiceId: r.invoice_id, stock: r.stock ?? [] });
      toast("Sitting completed and bill created");
      await load(); onChange?.();
      if (r.invoice_id) router.push(`/billing/${r.invoice_id}`);      // next step: the bill
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function finish(v: boolean) {
    if (!plan) return;
    setBusy(true); setErr("");
    try {
      const r: any = await authFetch("/api/treatments/sitting", { body: { clinicId, action: "finish", planId: plan.id, finish: v } });
      toast(v ? (r.status === "completed" ? "Treatment finished. Fully paid and closed." : "Marked as finished. It closes by itself once everything is paid.") : "Treatment reopened");
      await load(); onChange?.();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const locked = !canEdit || (sitting && sitting.status !== "pending");
  const billed = !!sitting?.invoice_id;
  const tot = plan ? planTotals(plan) : null;
  const badge = plan ? planBadge(plan) : null;

  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5" aria-label="Treatment at this visit">
      <h2 className="font-semibold text-slate-900">What happened at this visit?</h2>

      {!sitting && (
        <>
          <div className="mt-3 grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Visit type">
            {KINDS.map(([k, name, hint]) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k || (k === "treatment" && wantsTreatment)} disabled={!canEdit} onClick={() => chooseKind(k)}
                className={`text-left rounded-xl border px-3.5 py-3 ${(kind === k && k !== "treatment") || (k === "treatment" && wantsTreatment) ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500" : "border-slate-200 hover:bg-slate-50"}`}>
                <span className="block font-semibold text-slate-900">{name}</span><span className="block text-xs text-slate-500 mt-0.5">{hint}</span></button>
            ))}
          </div>
          {wantsTreatment && canEdit && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <SittingForm clinicId={clinicId} patientId={patientId} appointmentId={appointmentId} submitLabel="Next: save this sitting →" onCancel={() => { setWantsTreatment(false); setKind("consultation"); }} onDone={async () => { setWantsTreatment(false); await load(); onChange?.(); }} />
            </div>
          )}
          {!wantsTreatment && <p className="mt-3 text-xs text-slate-500">{kind === "enquiry" ? "An enquiry needs nothing more. Create a bill only if you charged something." : "A consultation needs nothing more. Add the consultation fee below and bill it, or choose Treatment to add a sitting."}</p>}
        </>
      )}

      {sitting && plan && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{plan.title}</p>
            {badge && <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>{badge.text}</span>}
            <Link href="/treatments" className="ml-auto text-xs text-sky-700 underline">Open in Treatments</Link>
          </div>
          {tot && <p className="mt-1 text-sm text-slate-600">Estimate {inr(tot.estimate)} · billed {inr(tot.billed)} · paid {inr(tot.paid)}{tot.due > 0 ? ` · ${inr(tot.due)} due` : ""}</p>}

          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Sittings">
            {[...(plan.treatment_sittings ?? [])].sort((x: any, y: any) => x.seq - y.seq).map((x: any) => {
              const pay = sittingPay(x.due_amount, x.paid_amount), here = x.id === sitting.id;
              return <span key={x.id} className={`text-xs px-2.5 py-1 rounded-full border ${here ? "bg-sky-600 border-sky-600 text-white font-semibold" : "bg-white border-slate-200 text-slate-600"}`}>{x.seq}. {x.label} · {inr(x.due_amount)}{here ? "" : ` · ${pay.text}`}</span>;
            })}
          </div>

          <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-3 sm:p-4 space-y-3">
            <p className="text-sm font-semibold text-sky-900">Sitting {sitting.seq}, today</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label htmlFor="tv-label" className="text-sm font-medium text-slate-700 block mb-1">Sitting name</label>
                <input id="tv-label" disabled={!!locked} value={label} onChange={(e) => setLabel(e.target.value)} className={inp} /></div>
              <div><label htmlFor="tv-price" className="text-sm font-medium text-slate-700 block mb-1">Cost of this sitting (₹)</label>
                <input id="tv-price" type="number" inputMode="numeric" min={0} disabled={!!locked || billed} value={price} onChange={(e) => setPrice(e.target.value)} className={inp} />
                <p className="mt-1 text-xs text-slate-500">{billed ? "Already billed. Change the price on the invoice." : "Only this amount is billed for today."}</p></div>
            </div>
            <EquipmentPicker stock={stock} value={mats} onChange={setMats} disabled={!!locked} />
            {sitting.status === "done" && <p className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">Done{billed && <> · <Link href={`/billing/${sitting.invoice_id}`} className="underline font-medium">open the invoice</Link></>}</p>}
          </div>

          {canEdit && (
            <div className="mt-4 flex flex-col sm:flex-row flex-wrap gap-2">
              {!locked && <button type="button" disabled={busy} onClick={saveChanges} className="px-4 py-3 rounded-xl border border-slate-300 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60">{busy ? "Saving…" : "Save changes"}</button>}
              {sitting.status === "pending" && <button type="button" disabled={busy} onClick={complete} className="px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold">Next: complete this sitting and bill it →</button>}
              {sitting.status === "done" && <button type="button" onClick={() => setMore((m) => !m)} className="px-4 py-3 rounded-xl border border-sky-300 text-sky-800 font-semibold hover:bg-sky-50">+ Add the next sitting</button>}
              {plan.status !== "cancelled" && plan.mode === "flexible" && (plan.finish_requested || plan.status === "completed"
                ? <button type="button" disabled={busy} onClick={() => finish(false)} className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60">Reopen treatment</button>
                : <button type="button" disabled={busy} onClick={() => finish(true)} className="px-4 py-3 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60">This was the last sitting</button>)}
            </div>
          )}
          {more && <div className="mt-4 border-t border-slate-100 pt-4"><SittingForm clinicId={clinicId} patientId={patientId} planId={plan.id} submitLabel="Save next sitting" onCancel={() => setMore(false)} onDone={async () => { setMore(false); await load(); onChange?.(); }} /></div>}
        </div>
      )}

      {err && <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3" role="alert">{err}</p>}
      {done && (
        <div className="mt-3 text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">
          Bill created. <Link href={`/billing/${done.invoiceId}`} className="underline font-medium">Open invoice</Link>
          {done.stock.map((s: any, i: number) => <p key={i} className="text-xs mt-1">{s.missing ? `${s.name}: not in your stock list, nothing deducted` : `${s.name}: ${s.used} used, ${s.left} left${s.low ? " (running low)" : ""}`}</p>)}
        </div>
      )}
    </section>
  );
}
