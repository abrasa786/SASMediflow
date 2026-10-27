"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { toast } from "@/lib/toast";

const supabase = sb as any;
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50";
interface Mat { item: string; qty: string }

/**
 * The treatment given at this visit. Pick the template; the price and the materials fill in from it and can be changed for this sitting.
 * A treatment with several sittings carries on from the patient's earlier visit. Completing the sitting raises the bill and uses the stock.
 */
export default function TreatmentFromVisit({ clinicId, appointmentId, patientId, canEdit, onChange }: { clinicId: string; appointmentId: string; patientId: string; canEdit: boolean; onChange?: () => void }) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [stockNames, setStockNames] = useState<string[]>([]);
  const [sitting, setSitting] = useState<any | null>(null);          // the sitting this visit already belongs to
  const [tplId, setTplId] = useState("");
  const [price, setPrice] = useState("");
  const [mats, setMats] = useState<Mat[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ invoiceId: string; stock: any[] } | null>(null);

  const matsFrom = (c: any) => (Array.isArray(c) ? c : []).map((m: any) => ({ item: String(m.item ?? ""), qty: String(m.qty ?? "") }));

  const load = useCallback(async () => {
    const [t, s, st] = await Promise.all([
      supabase.from("treatment_templates").select("id, name, total_amount, sittings").eq("clinic_id", clinicId).eq("is_active", true).order("name"),
      supabase.from("stock_items").select("name").eq("clinic_id", clinicId).order("name").limit(500),
      supabase.from("treatment_sittings").select("id, seq, label, status, due_amount, consumables, invoice_id, plan_id, treatment_plans(title, template_id)").eq("clinic_id", clinicId).eq("appointment_id", appointmentId).order("seq").limit(1),
    ]);
    setTemplates(t.data ?? []); setStockNames((s.data ?? []).map((x: any) => x.name));
    const cur = st.data?.[0];
    if (cur) { setSitting(cur); setTplId(cur.treatment_plans?.template_id ?? ""); setPrice(String(cur.due_amount ?? "")); setMats(matsFrom(cur.consumables)); setLabel(cur.label ?? ""); }
  }, [clinicId, appointmentId]);
  useEffect(() => { if (clinicId && appointmentId) load(); }, [clinicId, appointmentId, load]);

  // choosing a template fills the price and materials: the patient's next open sitting if they are part-way through it, otherwise the first sitting
  async function pick(id: string) {
    setTplId(id); setErr(""); setDone(null);
    const t = templates.find((x) => x.id === id);
    if (!t) { setPrice(""); setMats([]); setLabel(""); return; }
    const r = await supabase.from("treatment_plans").select("id, treatment_sittings(seq, label, due_amount, consumables, status, appointment_id)")
      .eq("clinic_id", clinicId).eq("clinic_patient_id", patientId).eq("template_id", id).eq("status", "active");
    const next = (r.data ?? []).flatMap((p: any) => p.treatment_sittings ?? []).filter((x: any) => x.status === "pending" && !x.appointment_id).sort((a: any, b: any) => a.seq - b.seq)[0];
    if (next) { setPrice(String(next.due_amount)); setMats(matsFrom(next.consumables)); setLabel(next.label); return; }
    const first = (Array.isArray(t.sittings) && t.sittings[0]) || {};
    const n = Math.max(1, Array.isArray(t.sittings) ? t.sittings.length : 1);
    setPrice(String(Math.round(Number(t.total_amount) * (Number(first.share) || 100 / n) / 100)));
    setMats(matsFrom(first.consumables)); setLabel(first.label ?? "");
  }

  async function save() {
    if (!tplId) return setErr("Choose the treatment first.");
    setBusy(true); setErr("");
    try {
      const r: any = await authFetch("/api/visits/treatment", { body: { clinicId, appointmentId, templateId: tplId, price: price === "" ? null : Number(price), materials: mats.filter((m) => m.item.trim()).map((m) => ({ item: m.item.trim(), qty: Number(m.qty) || 1 })) } });
      toast(`Saved: ${r.title}, sitting ${r.seq} of ${r.of}`);
      await load(); onChange?.();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function complete() {
    if (!sitting) return;
    if (!confirm("Complete this sitting? The bill is created and the materials are taken off the stock.")) return;
    setBusy(true); setErr("");
    try {
      const r: any = await authFetch("/api/treatments/complete", { body: { clinicId, sittingId: sitting.id } });
      setDone({ invoiceId: r.invoice_id, stock: r.stock ?? [] });
      toast("Sitting completed and bill created");
      await load(); onChange?.();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const locked = !canEdit || (sitting && sitting.status !== "pending");
  const setMat = (i: number, k: keyof Mat, v: string) => setMats((p) => p.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  if (!templates.length && !sitting) return null;       // no templates yet: nothing to pick (set them up under Treatments)
  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Treatment at this visit">
      <h2 className="font-semibold text-slate-900 text-sm">Treatment at this visit</h2>
      {sitting && <p className="text-xs text-slate-500 mt-1">{sitting.treatment_plans?.title} · sitting {sitting.seq}{sitting.label ? ` (${sitting.label})` : ""} · {sitting.status === "done" ? "completed" : "not completed yet"}</p>}
      <div className="mt-3 grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label htmlFor="tv-tpl" className="text-xs font-medium text-slate-600 block mb-1">Treatment (from your templates)</label>
          <select id="tv-tpl" disabled={locked || !!sitting} value={tplId} onChange={(e) => pick(e.target.value)} className={inp}>
            <option value="">Choose…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!sitting && tplId && label && <p className="text-xs text-slate-400 mt-1">This visit will be: {label}.</p>}</div>
        <div><label htmlFor="tv-price" className="text-xs font-medium text-slate-600 block mb-1">Price for this sitting (₹)</label>
          <input id="tv-price" type="number" min={0} disabled={locked} value={price} onChange={(e) => setPrice(e.target.value)} className={inp} />
          <p className="text-xs text-slate-400 mt-1">Comes from the template. Change it if this visit costs differently.</p></div>
      </div>
      <div className="mt-3">
        <p className="text-xs font-medium text-slate-600">Materials used <span className="font-normal text-slate-400">· taken off the stock when you complete the sitting · not shown on the invoice</span></p>
        <datalist id="tv-stock">{stockNames.map((n) => <option key={n} value={n} />)}</datalist>
        <div className="mt-2 space-y-2">
          {mats.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <input list="tv-stock" aria-label="Material" disabled={locked} value={m.item} onChange={(e) => setMat(i, "item", e.target.value)} placeholder="Item" className={`${inp} flex-1 min-w-0`} />
              <input aria-label="Quantity" type="number" min={1} disabled={locked} value={m.qty} onChange={(e) => setMat(i, "qty", e.target.value)} className={`${inp} w-20 shrink-0`} />
              {!locked && <button type="button" aria-label="Remove" onClick={() => setMats((p) => p.filter((_, j) => j !== i))} className="text-red-500 text-lg px-1">×</button>}
            </div>
          ))}
          {!mats.length && <p className="text-xs text-slate-400">None listed.</p>}
          {!locked && <button type="button" onClick={() => setMats((p) => [...p, { item: "", qty: "1" }])} className="text-xs text-sky-700 font-medium">+ Add material</button>}
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
      {done && (
        <div className="mt-3 text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">
          Bill created. <Link href={`/billing/${done.invoiceId}`} className="underline font-medium">Open invoice</Link>
          {done.stock.map((s: any, i: number) => <p key={i} className="text-xs mt-1">{s.missing ? `${s.name}: not in your stock list, nothing deducted` : `${s.name}: ${s.used} used, ${s.left} left${s.low ? " (running low)" : ""}`}</p>)}
        </div>
      )}
      {canEdit && !locked && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={save} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : sitting ? "Save changes" : "Add to this visit"}</button>
          {sitting && <button type="button" disabled={busy} onClick={complete} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold">Complete sitting &amp; create bill</button>}
        </div>
      )}
      {sitting?.status === "done" && sitting.invoice_id && !done && <p className="mt-3 text-xs"><Link href={`/billing/${sitting.invoice_id}`} className="text-sky-700 underline">Open the invoice for this sitting</Link></p>}
    </section>
  );
}
