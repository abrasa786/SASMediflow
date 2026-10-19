"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";

const REASON: Record<string, string> = { treatment_pending: "Treatment open, nothing booked", lapsed: "Hasn't visited in a while" };

/** Patients who are due a nudge, with one-tap WhatsApp. Opted-out patients and people nudged in the last 30 days never show here. */
export default function RecallPage() {
  const router = useRouter();
  const [cid, setCid] = useState("");
  const [d, setD] = useState<any>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [res, setRes] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  const load = useCallback((c: string) => authFetch(`/api/recall?clinicId=${c}`).then((r) => { setD(r); setPick([]); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setCid(c); load(c); }, [router, load]);

  async function send(ids: string[]) {
    if (!ids.length) return; setBusy(true); setErr("");
    try { const r = await authFetch("/api/recall", { body: { clinicId: cid, patientIds: ids } }); setRes(r.results); await load(cid); } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function setting(p: Record<string, unknown>) { try { await authFetch("/api/recall", { body: { clinicId: cid, action: "settings", ...p } }); await load(cid); } catch (e: any) { setErr(e.message); } }
  const toggle = (id: string) => setPick((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Recall</h1>
        <p className="text-slate-500 text-sm mb-5">Patients who are due a nudge: an open treatment with nothing booked, or no visit for a long time. Each message invites them to reply <b>book</b> and the assistant finds them a time on WhatsApp.</p>
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        {d && !d.whatsapp && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 mb-4">WhatsApp sending isn&apos;t connected, so each message opens WhatsApp with the text filled in and you press send. To send automatically, add the WhatsApp variables in Vercel (see docs/HOSTING.md).</p>}
        {d && (
          <>
            <div className="bg-white border border-slate-100 rounded-xl p-4 mb-5 flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium text-slate-900">Automatic recall</span>
              {d.role === "admin" ? (
                <>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={d.settings.auto} disabled={!d.whatsapp} onChange={(e) => setting({ auto: e.target.checked })} /> Send daily (up to {d.settings.daily_limit} a day)</label>
                  <label className="flex items-center gap-2">“Not visited” after <select value={d.settings.days} onChange={(e) => setting({ days: Number(e.target.value) })} className="border border-slate-200 rounded px-2 py-1">{[90, 180, 365].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
                </>
              ) : <span className="text-slate-500">{d.settings.auto ? "On" : "Off"} (set by the admin)</span>}
              <span className="text-xs text-slate-400">{d.chatReady ? "Patients can reply on WhatsApp to book." : "Two-way chat is not set up yet."}</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold text-slate-900">{d.candidates.length} due</h2>
              <div className="flex gap-2">
                <button disabled={busy || !pick.length} onClick={() => send(pick)} className="text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-40">Send to selected ({pick.length})</button>
                <button disabled={busy || !d.candidates.length} onClick={() => send(d.candidates.slice(0, 50).map((c: any) => c.patient_id))} className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40">Send to all (max 50)</button>
              </div>
            </div>
            {res.length > 0 && (
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 mb-3 text-sm space-y-1">
                {res.map((r) => <p key={r.patient_id}>{r.name || "Patient"}: {r.status === "sent" ? "✅ sent" : r.status === "link" ? <a className="text-sky-700 underline" href={r.link} target="_blank" rel="noreferrer">open WhatsApp</a> : r.status === "failed" ? <>⚠️ {r.error} {r.link && <a className="text-sky-700 underline" href={r.link} target="_blank" rel="noreferrer">send manually</a>}</> : `skipped: ${r.error}`}</p>)}
              </div>
            )}
            {!d.candidates.length ? <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-5">Nobody is due right now. 🎉</p> : (
              <ul className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
                {d.candidates.map((c: any) => (
                  <li key={c.patient_id} className="flex items-center gap-3 px-4 py-3">
                    <input type="checkbox" aria-label={`Select ${c.name}`} checked={pick.includes(c.patient_id)} onChange={() => toggle(c.patient_id)} />
                    <div className="min-w-0 flex-1"><p className="font-medium text-slate-900 truncate">{c.name}</p><p className="text-xs text-slate-500 truncate">{REASON[c.reason]} · {c.detail}</p></div>
                    <button disabled={busy} onClick={() => send([c.patient_id])} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-sky-300 shrink-0">WhatsApp</button>
                  </li>
                ))}
              </ul>
            )}
            {d.log.length > 0 && (<><h2 className="font-semibold text-slate-900 mt-6 mb-2 text-sm">Recently sent</h2>
              <ul className="text-sm text-slate-600 space-y-1">{d.log.map((l: any) => <li key={l.id}>{new Date(l.created_at).toLocaleDateString("en-IN")} · {l.clinic_patients?.name ?? "Patient"} · {l.status}{l.auto ? " · automatic" : ""}</li>)}</ul></>)}
          </>
        )}
      </div>
    </AppShell>
  );
}
