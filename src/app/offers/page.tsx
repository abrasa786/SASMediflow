"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { classify, OFFER_BATCH, OFFER_GAP_DAYS, REASON, type Eligibility } from "@/lib/offers/eligibility";

const supabase = sb as any;
interface Pt { id: string; name: string; phone: string | null; marketing_opt_in: boolean | null }
interface Tr { id: string; name: string; summary: string | null }
interface Res { patientId: string; name: string; status: "sent" | "skipped" | "failed" | "link"; reason?: string; link?: string }

/** Send a treatment explainer to chosen patients. Patients who switched offers off can never be selected. */
export default function OffersPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [patients, setPatients] = useState<Pt[]>([]);
  const [treatments, setTreatments] = useState<Tr[]>([]);
  const [recent, setRecent] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [treatmentId, setTreatmentId] = useState("");
  const [message, setMessage] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Res[]>([]);

  const load = useCallback(async (cid: string) => {
    const [p, t, r] = await Promise.all([
      supabase.from("clinic_patients").select("id, name, phone, marketing_opt_in").eq("clinic_id", cid).order("name").limit(3000),
      supabase.from("treatment_info").select("id, name, summary").eq("clinic_id", cid).eq("is_published", true).order("name"),
      supabase.from("offer_sends").select("patient_id").eq("clinic_id", cid).in("status", ["sent", "link"]).gte("created_at", new Date(Date.now() - OFFER_GAP_DAYS * 86400_000).toISOString()),
    ]);
    if (p.error) setErr(/marketing_opt_in/.test(p.error.message) ? "Run migration 020 (offers consent) in Supabase first, then reload." : p.error.message);
    setPatients(p.data ?? []);
    if (t.error) setErr((x) => x || (/treatment_info/.test(t.error.message) ? "Run migration 019 (treatments) in Supabase first, then reload." : t.error.message));
    setTreatments(t.data ?? []);
    setRecent(new Set(((r.data ?? []) as any[]).map((x) => x.patient_id)));       // if migration 021 is missing this is simply empty
    setLoading(false);
  }, []);
  useEffect(() => { const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setClinicId(c); load(c); }, [router, load]);

  const rows = useMemo(() => patients.map((p) => ({ p, e: classify(p, recent.has(p.id)) as Eligibility })), [patients, recent]);
  const shown = rows.filter(({ p }) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || (p.phone ?? "").includes(q.trim()));
  const eligible = rows.filter((r) => r.e === "ok");
  const count = (e: Eligibility) => rows.filter((r) => r.e === e).length;
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = () => setPicked(new Set(shown.filter((r) => r.e === "ok").map((r) => r.p.id)));   // switched-off patients are never added

  async function send() {
    const ids = Array.from(picked).filter((id) => rows.find((r) => r.p.id === id)?.e === "ok");
    if (!treatmentId || !ids.length) return;
    if (!confirm(`Send this to ${ids.length} patient${ids.length === 1 ? "" : "s"} on WhatsApp?`)) return;
    setBusy(true); setErr(""); setResults([]);
    const all: Res[] = [];
    try {
      for (let i = 0; i < ids.length; i += OFFER_BATCH) {
        setProgress(`Sending ${Math.min(i + OFFER_BATCH, ids.length)} of ${ids.length}…`);
        const r = await authFetch<{ results: Res[] }>("/api/offers/send", { body: { clinicId, treatmentId, message, patientIds: ids.slice(i, i + OFFER_BATCH) } });
        all.push(...r.results); setResults([...all]);
      }
      setPicked(new Set()); await load(clinicId);
    } catch (e: any) { setErr(e.message); }
    setProgress(""); setBusy(false);
  }

  const sent = results.filter((r) => r.status === "sent").length, links = results.filter((r) => r.status === "link" || r.status === "failed");
  const field = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white";

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Offers</h1>
        <p className="text-slate-500 text-sm mt-1">Send a treatment explainer to patients who said yes to updates. Patients who switched them off are left out automatically.</p>
        {err && <p className="mt-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {loading ? <p className="mt-6 text-slate-400 text-sm">Loading…</p> : (<>
          {treatments.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">No published treatment yet. <Link href="/treatments/library" className="text-sky-700 underline">Open the treatment library</Link>, review one and publish it.</p>
          ) : (
            <div className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-5 grid gap-4">
              <div>
                <label htmlFor="o-t" className="text-xs font-medium text-slate-600 block mb-1">Treatment to send</label>
                <select id="o-t" value={treatmentId} onChange={(e) => setTreatmentId(e.target.value)} className={field}>
                  <option value="">Choose…</option>
                  {treatments.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="o-m" className="text-xs font-medium text-slate-600 block mb-1">Your note (optional)</label>
                <textarea id="o-m" rows={2} maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} className={field} placeholder="e.g. Free polishing check this month. Book a visit to know more." />
                <p className="text-xs text-slate-400 mt-1">The patient gets your note, a link to the explainer, and a line saying they can reply STOP.</p>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700">{eligible.length} can be sent</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{count("off")} switched off</span>
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{count("recent")} messaged in the last {OFFER_GAP_DAYS} days</span>
            {count("no_phone") > 0 && <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{count("no_phone")} without a phone</span>}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className={`${field} !w-64`} aria-label="Search patients" />
            <button type="button" onClick={selectAll} className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium">Select all who can be sent</button>
            <button type="button" onClick={() => setPicked(new Set())} className="px-3 py-2 text-sm text-slate-500 underline">Clear</button>
            <span className="text-sm text-slate-500 ml-auto">{picked.size} selected</span>
          </div>

          <div className="mt-3 bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
            {shown.length === 0 && <p className="p-6 text-sm text-slate-400 text-center">No patients found.</p>}
            {shown.map(({ p, e }) => (
              <label key={p.id} className={`flex items-center gap-3 px-4 py-2.5 text-sm ${e === "ok" ? "cursor-pointer hover:bg-slate-50" : "opacity-60"}`}>
                <input type="checkbox" disabled={e !== "ok"} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="font-medium text-slate-800">{p.name}</span>
                <span className="text-slate-400">{p.phone ?? ""}</span>
                <span className={`ml-auto text-xs ${e === "ok" ? "text-emerald-700" : "text-slate-500"}`}>{REASON[e]}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button type="button" disabled={busy || !treatmentId || picked.size === 0} onClick={send} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-semibold">
              {busy ? "Sending…" : `Send to ${picked.size} patient${picked.size === 1 ? "" : "s"}`}
            </button>
            {progress && <span className="text-sm text-slate-500">{progress}</span>}
          </div>

          {results.length > 0 && (
            <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm" role="status">
              <p className="font-semibold text-slate-900">{sent} sent, {results.filter((r) => r.status === "skipped").length} skipped, {links.length} need a manual send</p>
              {links.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {links.map((r) => (
                    <li key={r.patientId} className="flex gap-2 items-center">
                      <span>{r.name}</span>
                      {r.link && <a href={r.link} target="_blank" rel="noreferrer" className="text-sky-700 underline">Open in WhatsApp</a>}
                      {r.reason && <span className="text-xs text-slate-400 truncate">{r.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>)}
      </div>
    </AppShell>
  );
}
