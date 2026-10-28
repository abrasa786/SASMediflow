"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { searchClinicPatients } from "@/lib/clinic";
import { toast } from "@/lib/toast";
import { inr, planBadge, planTotals } from "@/lib/treatments";
import EquipmentPicker, { type Mat, type StockOpt } from "@/components/EquipmentPicker";

const supabase = sb as any;
const field = "w-full px-3 py-3 rounded-xl border border-slate-300 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white disabled:bg-slate-50";
const lab = "text-sm font-medium text-slate-700 block mb-1";

/**
 * Add a sitting: pick the patient's open treatment (or start a new one with its estimate), name the sitting, set what THIS sitting costs, list the equipment used.
 * Each sitting is billed on its own, so paying today's 2,000 does not touch the rest of a 40,000 treatment.
 */
export default function SittingForm({ clinicId, patientId, appointmentId, planId, onDone, onCancel, submitLabel }: {
  clinicId: string; patientId?: string; appointmentId?: string; planId?: string; onDone: (r: any) => void; onCancel?: () => void; submitLabel?: string;
}) {
  const [patient, setPatient] = useState<{ id: string; name: string; phone?: string } | null>(null);
  const [search, setSearch] = useState("");
  const [found, setFound] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [stock, setStock] = useState<StockOpt[]>([]);
  const [choice, setChoice] = useState<string>(planId ?? "");           // an open treatment's id, or "new"
  const [title, setTitle] = useState(""); const [estimate, setEstimate] = useState("");
  const [label, setLabel] = useState(""); const [price, setPrice] = useState("");
  const [mats, setMats] = useState<Mat[]>([]);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pid = patientId ?? patient?.id ?? "";

  // patient: given, or searched for
  useEffect(() => {
    if (patientId || search.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => searchClinicPatients(clinicId, search).then(setFound), 250);
    return () => clearTimeout(t);
  }, [search, patientId, clinicId]);

  const loadPlans = useCallback(async () => {
    if (!pid) { setPlans([]); return; }
    const r = await supabase.from("treatment_plans").select("id, title, status, payment_status, total_amount, discount, template_id, treatment_sittings(id, seq, due_amount, paid_amount, status)")
      .eq("clinic_id", clinicId).eq("clinic_patient_id", pid).neq("status", "cancelled").order("created_at", { ascending: false });
    const list = r.data ?? [];
    setPlans(list);
    setChoice((c) => c || (list.find((p: any) => p.status === "active") ? list.find((p: any) => p.status === "active").id : "new"));
  }, [clinicId, pid]);
  useEffect(() => { loadPlans(); }, [loadPlans]);

  useEffect(() => {
    supabase.from("stock_items").select("name, quantity, unit").eq("clinic_id", clinicId).order("name").limit(500).then(({ data }: any) => setStock(data ?? []));
    supabase.from("treatment_templates").select("id, name, total_amount, sittings").eq("clinic_id", clinicId).eq("is_active", true).order("name").then(({ data }: any) => setTemplates(data ?? []));
  }, [clinicId]);

  // suggestion for the next sitting from the treatment's template (the name, price and equipment can all be changed)
  const plan = plans.find((p) => p.id === choice);
  useEffect(() => {
    if (!plan?.template_id) return;
    const t = templates.find((x) => x.id === plan.template_id); if (!t || !Array.isArray(t.sittings)) return;
    const n = (plan.treatment_sittings ?? []).length, s = t.sittings[n]; if (!s) return;
    setLabel((x) => x || s.label || ""); setMats((m) => (m.length ? m : (Array.isArray(s.consumables) ? s.consumables : []).map((c: any) => ({ item: String(c.item ?? ""), qty: String(c.qty ?? 1) }))));
    setPrice((x) => x || String(Math.round(Number(t.total_amount) * (Number(s.share) || 100 / t.sittings.length) / 100)));
  }, [plan, templates]);

  function pickTemplate(name: string) {
    setTitle(name);
    const t = templates.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!t) return;
    setEstimate((e) => e || String(t.total_amount ?? ""));
    const s = Array.isArray(t.sittings) ? t.sittings[0] : null;
    if (s) {
      setLabel((x) => x || s.label || "");
      setMats((m) => (m.length ? m : (Array.isArray(s.consumables) ? s.consumables : []).map((c: any) => ({ item: String(c.item ?? ""), qty: String(c.qty ?? 1) }))));
      setPrice((x) => x || String(Math.round(Number(t.total_amount) * (Number(s.share) || 100 / t.sittings.length) / 100)));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!pid) return setErr("Choose the patient first.");
    const isNew = choice === "new" || !choice;
    if (isNew && title.trim().length < 2) return setErr("Name the treatment, for example “Dental implant”.");
    if (isNew && estimate !== "" && (!Number.isFinite(Number(estimate)) || Number(estimate) < 0)) return setErr("The treatment estimate must be a number, 0 or more.");
    if (label.trim().length < 2) return setErr("Name this sitting, for example “Tooth removal”.");
    if (price === "" || !Number.isFinite(Number(price)) || Number(price) < 0) return setErr("Enter what this sitting costs. This is the amount that will be billed now.");
    setBusy(true);
    try {
      const t = templates.find((x) => x.name.toLowerCase() === title.trim().toLowerCase());
      const r = await authFetch("/api/treatments/sitting", { body: {
        clinicId, action: "add", patientId: pid, appointmentId: appointmentId || undefined, planId: isNew ? undefined : choice,
        title: isNew ? title.trim() : undefined, estimatedTotal: isNew ? Number(estimate || 0) : undefined, templateId: isNew ? t?.id : undefined,
        label: label.trim(), price: Number(price), date: date || undefined, materials: mats.filter((m) => m.item.trim()).map((m) => ({ item: m.item.trim(), qty: Number(m.qty) || 1 })),
      } });
      toast(`Sitting ${r.seq} added to ${r.title}`);
      onDone(r);
    } catch (x: any) { setErr(x.message || "That did not save. Please try again."); }
    setBusy(false);
  }

  const isNew = choice === "new" || !choice;
  const tot = plan ? planTotals(plan) : null;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {!patientId && (
        <div>
          <label htmlFor="sf-pat" className={lab}>Patient *</label>
          {patient ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
              <div><p className="font-semibold text-sky-900">{patient.name}</p><p className="text-xs text-sky-700">{patient.phone}</p></div>
              <button type="button" onClick={() => { setPatient(null); setChoice(""); setPlans([]); }} aria-label="Change patient" className="text-sky-700 text-xl px-2">×</button>
            </div>
          ) : (<>
            <input id="sf-pat" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or phone" className={field} autoComplete="off" />
            <ul className="mt-1 max-h-48 overflow-y-auto">{found.map((p) => (
              <li key={p.id}><button type="button" onClick={() => { setPatient(p); setFound([]); setSearch(""); }} className="w-full flex justify-between gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-sky-50"><span className="font-medium">{p.name}</span><span className="text-xs text-slate-500">{p.phone}</span></button></li>
            ))}</ul>
          </>)}
        </div>
      )}

      {pid && (
        <div>
          <label htmlFor="sf-plan" className={lab}>Treatment</label>
          <select id="sf-plan" value={choice} onChange={(e) => { setChoice(e.target.value); setLabel(""); setPrice(""); setMats([]); }} className={field} disabled={!!planId}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.title} · {planBadge(p).text}{p.status === "completed" ? " (adding a sitting reopens it)" : ""}</option>)}
            <option value="new">+ Start a new treatment</option>
          </select>
          {tot && <p className="mt-1.5 text-xs text-slate-500">Estimate {inr(tot.estimate)} · billed so far {inr(tot.billed)} · paid {inr(tot.paid)}{tot.due > 0 ? ` · ${inr(tot.due)} still due` : ""}</p>}
        </div>
      )}

      {pid && isNew && (
        <div className="grid sm:grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
          <div className="sm:col-span-2"><label htmlFor="sf-title" className={lab}>Treatment name *</label>
            <input id="sf-title" list="sf-tpls" value={title} onChange={(e) => pickTemplate(e.target.value)} placeholder="e.g. Dental implant" className={field} />
            <datalist id="sf-tpls">{templates.map((t) => <option key={t.id} value={t.name} />)}</datalist></div>
          <div><label htmlFor="sf-est" className={lab}>Estimated total cost (₹)</label>
            <input id="sf-est" type="number" inputMode="numeric" min={0} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="e.g. 40000" className={field} />
            <p className="mt-1 text-xs text-slate-500">The whole treatment. You only bill each sitting as it happens.</p></div>
        </div>
      )}

      {pid && (<>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label htmlFor="sf-label" className={lab}>This sitting *</label>
            <input id="sf-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Tooth removal" className={field} /></div>
          <div><label htmlFor="sf-price" className={lab}>Cost of this sitting (₹) *</label>
            <input id="sf-price" type="number" inputMode="numeric" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 2000" className={field} />
            <p className="mt-1 text-xs text-slate-500">Only this amount is billed now. You can still change it on the invoice.</p></div>
          {!appointmentId && <div><label htmlFor="sf-date" className={lab}>Date <span className="font-normal text-slate-400">(optional)</span></label>
            <input id="sf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></div>}
        </div>
        <EquipmentPicker stock={stock} value={mats} onChange={setMats} />
      </>)}

      {err && <div role="alert" className="flex gap-2 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3.5 py-3"><span aria-hidden>⚠️</span><span>{err}</span></div>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="px-5 py-3 rounded-xl border border-slate-300 font-medium text-slate-800">Cancel</button>}
        <button disabled={busy || !pid} className="px-5 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-semibold">{busy ? "Saving…" : submitLabel ?? "Save sitting"}</button>
      </div>
    </form>
  );
}
