"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";
const EMPTY = { name: "", category: "", summary: "", why_needed: "", steps: "", duration_text: "", pain_text: "", aftercare: "", delay_risk: "", price_from: "", price_to: "", emi_note: "", faqs: "", offer_text: "", is_published: false };

/** One treatment explainer: every field is editable. Steps are one per line; questions are "question | answer" per line. */
export default function TreatmentRecord({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isNew = params.id === "new";
  const [clinicId, setClinicId] = useState("");
  const [f, setF] = useState<Record<string, any>>(EMPTY);
  const [state, setState] = useState<"loading" | "ready" | "missing">(isNew ? "ready" : "loading");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setClinicId(c);
    if (isNew) return;
    supabase.from("treatment_info").select("*").eq("id", params.id).eq("clinic_id", c).maybeSingle().then(({ data }: any) => {
      if (!data) { setState("missing"); return; }
      setF({ ...EMPTY, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v ?? ""])),
        steps: (data.steps ?? []).join("\n"), faqs: (data.faqs ?? []).map((x: any) => `${x.q} | ${x.a}`).join("\n"), is_published: !!data.is_published });
      setState("ready");
    });
  }, [router, params.id, isNew]);

  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));
  const fields = () => ({
    ...f, steps: String(f.steps).split("\n").map((s) => s.trim()).filter(Boolean),
    faqs: String(f.faqs).split("\n").map((l) => { const [q, ...a] = l.split("|"); return { q: q?.trim(), a: a.join("|").trim() }; }).filter((x) => x.q && x.a),
  });

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try {
      const r = await authFetch<{ id: string }>("/api/treatments/info", { body: { clinicId, action: isNew ? "create" : "update", id: isNew ? undefined : params.id, fields: fields() } });
      if (isNew) router.replace(`/treatments/library/${r.id}`); else setMsg("Saved.");
    } catch (x: any) { setErr(x.message); }
    setBusy(false);
  }
  async function remove() {
    if (!confirm("Delete this treatment? The patient link will stop working.")) return;
    try { await authFetch("/api/treatments/info", { body: { clinicId, action: "delete", id: params.id } }); router.push("/treatments/library"); } catch (x: any) { setErr(x.message); }
  }

  const T = (k: string, label: string, rows = 3, hint?: string) => (
    <div className="sm:col-span-2"><label htmlFor={`f-${k}`} className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      <textarea id={`f-${k}`} rows={rows} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={inp} />{hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}</div>);
  const I = (k: string, label: string, type = "text") => (
    <div><label htmlFor={`f-${k}`} className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      <input id={`f-${k}`} type={type} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} className={inp} /></div>);

  if (state === "loading") return <AppShell><div className="p-10 text-center text-slate-400 text-sm">Loading…</div></AppShell>;
  if (state === "missing") return <AppShell><div className="p-10 text-center"><p className="text-slate-600 mb-3">We couldn&apos;t find that treatment in this clinic.</p><Link href="/treatments/library" className="text-sky-600 underline text-sm">← Treatment library</Link></div></AppShell>;
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <Link href="/treatments/library" className="text-sm text-slate-500 hover:text-sky-700">← Treatment library</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">{isNew ? "New treatment" : f.name || "Treatment"}</h1>
        {!isNew && f.is_published && <p className="text-sm mt-1"><a className="text-sky-700 underline" href={`/t/${params.id}`} target="_blank" rel="noreferrer">See what the patient sees</a></p>}
        <form onSubmit={save} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mt-5 grid sm:grid-cols-2 gap-4">
          {I("name", "Treatment name")}{I("category", "Category")}
          {T("summary", "One friendly line", 2)}
          {T("why_needed", "Why the dentist advises it")}
          {T("steps", "What happens (one step per line)", 4)}
          {I("duration_text", "How long it takes")}{I("pain_text", "Will it hurt?")}
          {T("delay_risk", "If it is put off", 2)}
          {T("aftercare", "Aftercare", 3)}
          {I("price_from", "Price from (₹)", "number")}{I("price_to", "Price up to (₹)", "number")}
          {I("emi_note", "Payment options (optional)")}{I("offer_text", "Offer line for posters (optional)")}
          {T("faqs", "Common questions (one per line, as: question | answer)", 4)}
          <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.is_published} onChange={(e) => set("is_published", e.target.checked)} /> Published (patients can open the link)</label>
          <p className="sm:col-span-2 text-xs text-slate-400">Please read this as the dentist before publishing. It is general information, not a diagnosis.</p>
          {err && <p className="sm:col-span-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          {msg && <p className="sm:col-span-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</p>}
          <div className="sm:col-span-2 flex gap-2">
            <button disabled={busy} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : isNew ? "Create" : "Save changes"}</button>
            {!isNew && <Link href={`/treatments/library/${params.id}/poster`} className="px-5 py-2.5 rounded-xl border border-sky-200 text-sm font-semibold text-sky-800 bg-sky-50">Make a poster</Link>}
            <Link href="/treatments/library" className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Close</Link>
            {!isNew && <button type="button" onClick={remove} aria-label="Delete this treatment" title="Delete this treatment" className="ml-auto w-11 h-11 flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-lg">🗑</button>}
          </div>
        </form>
      </div>
    </AppShell>
  );
}
