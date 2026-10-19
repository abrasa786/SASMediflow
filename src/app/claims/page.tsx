"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import Modal from "@/components/Modal";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { inr, todayIso, dayLabel } from "@/lib/format";
import { inputCls as inp, labelCls as lbl } from "@/components/ui";
import { STAGES, STATUS_LABEL, DEDUCTION_CATEGORIES, slaState, nextActions, type ClaimStatus } from "@/lib/claims/sla";

interface Payer { id: string; name: string; kind: string; portal_url?: string | null; phone?: string | null }
interface Doc { id?: string; stage: string; name?: string; required: boolean; received: boolean; note?: string | null }
interface Claim {
  id: string; claim_number: string; status: ClaimStatus; procedure: string; admission_date?: string | null; estimated_amount: number;
  approved_amount?: number | null; billed_amount?: number | null; settled_amount?: number | null; preauth_sent_at?: string | null; discharge_sent_at?: string | null;
  updated_at: string; clinic_patients?: { name: string } | null; insurance_payers?: { name: string } | null; claim_documents?: Doc[];
}
interface Summary { open: number; waiting_insurer: number; queries: number; preauth_overdue: number; discharge_overdue: number; billed: number; settled: number; deducted: number; recovered: number; disputable: number; rejected: number;
  by_category: { category: string; amount: number }[]; by_payer: { payer: string; claims: number; billed: number; settled: number; deducted: number; avg_preauth_minutes: number | null }[] }

const PILL: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", preauth_sent: "bg-sky-100 text-sky-700", query: "bg-amber-100 text-amber-800", approved: "bg-indigo-100 text-indigo-700",
  discharge_sent: "bg-violet-100 text-violet-700", settled: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", cancelled: "bg-slate-100 text-slate-500",
};
const missingFor = (c: Claim) => {
  const stage = c.status === "approved" || c.status === "discharge_sent" ? "discharge" : "preauth";
  return (c.claim_documents ?? []).filter((d) => d.stage === stage && d.required && !d.received).length;
};

/** The cashless claims desk: every insurance claim from papers to payment, with the IRDAI clocks and the money insurers cut. */
export default function ClaimsPage() {
  const router = useRouter();
  const [cid, setCid] = useState("");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [payers, setPayers] = useState<Payer[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [role, setRole] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newClaim, setNewClaim] = useState(false);
  const [showPayers, setShowPayers] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async (c: string) => {
    try { const r = await authFetch(`/api/claims?clinicId=${c}`); setClaims(r.claims); setPayers(r.payers); setSum(r.summary); setRole(r.role); setErr(""); }
    catch (e: any) { setErr(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setCid(c); load(c); }, [router, load]);
  // the IRDAI clocks move: refresh the labels every 30 seconds
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const canEdit = role === "admin" || role === "nurse" || role === "receptionist";
  const counts = useMemo(() => { const m: Record<string, number> = {}; for (const c of claims) m[c.status] = (m[c.status] ?? 0) + 1; return m; }, [claims]);
  const shown = useMemo(() => {
    const open = ["draft", "preauth_sent", "query", "approved", "discharge_sent"];
    const list = filter === "open" ? claims.filter((c) => open.includes(c.status)) : filter === "late" ? claims.filter((c) => slaState(c)?.overdue) : claims.filter((c) => c.status === filter);
    // late first, then queries, then the rest by last change
    const rank = (c: Claim) => (slaState(c)?.overdue ? 0 : c.status === "query" ? 1 : 2);
    return [...list].sort((a, b) => rank(a) - rank(b) || (a.updated_at < b.updated_at ? 1 : -1));
  }, [claims, filter]);
  const late = claims.filter((c) => slaState(c)?.overdue).length;
  const lost = sum ? Number(sum.deducted) - Number(sum.recovered) : 0;

  const chips: [string, string, number][] = [
    ["open", "All open", sum?.open ?? 0], ["late", "⏰ Insurer late", late],
    ...STAGES.map((s) => [s.key, s.label, counts[s.key] ?? 0] as [string, string, number]), ["rejected", "Rejected", counts.rejected ?? 0],
  ];

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Insurance claims</h1>
            <p className="text-slate-500 text-sm mt-1 max-w-xl">Cashless claims from papers to payment. Insurers must decide a pre-auth within 1 hour and a discharge within 3 hours (IRDAI); late ones are flagged.</p>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              <button onClick={() => setShowPayers(true)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium">Insurers & TPAs</button>
              <button onClick={() => (payers.length ? setNewClaim(true) : setShowPayers(true))} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">+ New claim</button>
            </div>
          )}
        </div>
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {!loading && !err && !payers.length && canEdit && (
          <p className="mb-4 text-sm bg-sky-50 border border-sky-100 text-sky-900 rounded-xl p-3">Start by adding the insurers and TPAs you work with (for example Star Health, HDFC ERGO, Medi Assist). Then create a claim for an insured patient.</p>
        )}

        {sum && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <Tile k="Open claims" v={String(sum.open)} sub={`${sum.waiting_insurer} waiting on insurer`} />
            <Tile k="Insurer late" v={String(late)} sub="past the IRDAI limit" alert={late > 0} />
            <Tile k="Open queries" v={String(sum.queries)} sub="answer to restart the clock" alert={sum.queries > 0} warn />
            <Tile k="Lost to deductions" v={inr(lost)} sub={sum.disputable > 0 ? `${inr(sum.disputable)} can still be disputed` : `${inr(sum.recovered)} won back`} alert={lost > 0} />
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter claims">
          {chips.map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={`shrink-0 text-sm px-3 py-1.5 rounded-full border ${filter === k ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-700"}`}>
              {label} <span className="opacity-60 tabular-nums">{n}</span>
            </button>
          ))}
          <button onClick={() => setFilter("settled")} className={`shrink-0 text-sm px-3 py-1.5 rounded-full border ${filter === "settled" ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-700"}`}>Settled <span className="opacity-60">{counts.settled ?? 0}</span></button>
        </div>

        {loading ? <p className="text-sm text-slate-500">Loading…</p> : !shown.length ? (
          <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-5">No claims here.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => { const s = slaState(c); const miss = missingFor(c); return (
              <li key={c.id}>
                <button onClick={() => setOpenId(c.id)} className={`w-full text-left bg-white border rounded-xl p-4 hover:border-sky-300 ${s?.overdue ? "border-red-300" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PILL[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    {s && <span className={`text-xs font-semibold tabular-nums ${s.overdue ? "text-red-600" : s.leftMinutes <= 15 ? "text-amber-700" : "text-slate-500"}`}>⏱ {s.label}</span>}
                  </div>
                  <p className="font-semibold text-slate-900 mt-2 truncate">{c.clinic_patients?.name ?? "Patient"}</p>
                  <p className="text-sm text-slate-600 truncate">{c.procedure}</p>
                  <p className="text-xs text-slate-500 mt-1 truncate">{c.claim_number} · {c.insurance_payers?.name}{c.admission_date ? ` · ${dayLabel(c.admission_date, false)}` : ""}</p>
                  <div className="flex items-center justify-between mt-3 text-sm">
                    <span className="tabular-nums text-slate-900">{inr(c.settled_amount ?? c.billed_amount ?? c.approved_amount ?? c.estimated_amount)}</span>
                    {miss > 0 && c.status !== "settled" && c.status !== "rejected" && <span className="text-xs text-amber-700">📄 {miss} paper{miss > 1 ? "s" : ""} missing</span>}
                  </div>
                </button>
              </li>
            ); })}
          </ul>
        )}

        {sum && (sum.by_payer.length > 0 || sum.by_category.length > 0) && (
          <div className="grid lg:grid-cols-2 gap-4 mt-8">
            {sum.by_payer.length > 0 && (
              <section className="bg-white border border-slate-100 rounded-xl p-4 overflow-x-auto">
                <h2 className="font-semibold text-slate-900 mb-3 text-sm">By insurer / TPA</h2>
                <table className="w-full text-sm min-w-[420px]">
                  <thead><tr className="text-left text-xs text-slate-500"><th className="font-medium pb-2">Payer</th><th className="font-medium pb-2 text-right">Claims</th><th className="font-medium pb-2 text-right">Paid of billed</th><th className="font-medium pb-2 text-right">Cut</th><th className="font-medium pb-2 text-right">Avg pre-auth</th></tr></thead>
                  <tbody className="divide-y divide-slate-50">{sum.by_payer.map((p) => (
                    <tr key={p.payer}><td className="py-2">{p.payer}</td><td className="text-right tabular-nums">{p.claims}</td>
                      <td className="text-right tabular-nums">{Number(p.billed) > 0 ? `${Math.round((Number(p.settled) / Number(p.billed)) * 100)}%` : "–"}</td>
                      <td className="text-right tabular-nums">{inr(p.deducted)}</td>
                      <td className={`text-right tabular-nums ${(p.avg_preauth_minutes ?? 0) > 60 ? "text-red-600" : ""}`}>{p.avg_preauth_minutes == null ? "–" : `${p.avg_preauth_minutes}m`}</td></tr>
                  ))}</tbody>
                </table>
              </section>
            )}
            {sum.by_category.length > 0 && (
              <section className="bg-white border border-slate-100 rounded-xl p-4">
                <h2 className="font-semibold text-slate-900 mb-3 text-sm">Why money was cut</h2>
                <ul className="space-y-2">{sum.by_category.map((x) => { const pct = Number(sum.deducted) ? (Number(x.amount) / Number(sum.deducted)) * 100 : 0; return (
                  <li key={x.category} className="text-sm">
                    <div className="flex justify-between"><span>{DEDUCTION_CATEGORIES[x.category] ?? x.category}</span><span className="tabular-nums">{inr(x.amount)}</span></div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-1"><div className="h-1.5 bg-red-400 rounded-full" style={{ width: `${pct}%` }} /></div>
                  </li>
                ); })}</ul>
              </section>
            )}
          </div>
        )}
      </div>

      {openId && <ClaimDetail clinicId={cid} id={openId} canEdit={canEdit} onClose={() => setOpenId(null)} onChanged={() => load(cid)} />}
      {newClaim && <NewClaim clinicId={cid} payers={payers} onClose={() => setNewClaim(false)} onCreated={(id) => { setNewClaim(false); load(cid); setOpenId(id); }} />}
      {showPayers && <Payers clinicId={cid} payers={payers} onClose={() => setShowPayers(false)} onChanged={() => load(cid)} />}
    </AppShell>
  );
}

function Tile({ k, v, sub, alert, warn }: { k: string; v: string; sub?: string; alert?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${alert ? (warn ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50") : "border-slate-200 bg-white"}`}>
      <p className="text-xs text-slate-500">{k}</p>
      <p className="text-xl font-bold text-slate-900 mt-0.5 tabular-nums">{v}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── one claim ───────────────────────────────────────────────
function ClaimDetail({ clinicId, id, canEdit, onClose, onChanged }: { clinicId: string; id: string; canEdit: boolean; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const [act, setAct] = useState<{ to: string; label: string; needs?: string } | null>(null);
  const [val, setVal] = useState(""); const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [newDoc, setNewDoc] = useState(""); const [ded, setDed] = useState({ category: "non_payable", reason: "", amount: "" });

  const load = useCallback(async () => {
    try { const r = await authFetch(`/api/claims?clinicId=${clinicId}&claimId=${id}`); setC(r.claim); } catch (e: any) { setErr(e.message); }
  }, [clinicId, id]);
  useEffect(() => { load(); }, [load]);

  async function call(body: Record<string, unknown>) {
    setBusy(true); setErr("");
    try { await authFetch("/api/claims", { body: { clinicId, claimId: id, ...body } }); await load(); onChanged(); setBusy(false); return true; }
    catch (e: any) { setErr(e.message); setBusy(false); return false; }
  }
  async function doAction() {
    if (!act) return;
    const b: Record<string, unknown> = act.to === "query" ? { action: "query", message: val } : act.to === "reply" ? { action: "reply", message: val } : { action: "advance", to: act.to, insurerRef: ref };
    if (act.needs === "approved_amount") b.approvedAmount = val;
    if (act.needs === "billed_amount") b.billedAmount = val;
    if (act.needs === "settled_amount") b.settledAmount = val;
    if (act.needs === "note") b.note = val;
    if (await call(b)) { setAct(null); setVal(""); setRef(""); }
  }

  if (!c) return <Modal title="Claim" onClose={onClose}>{err ? <p className="text-sm text-red-600">{err}</p> : <p className="text-sm text-slate-500">Loading…</p>}</Modal>;
  const s = slaState(c);
  const closed = c.status === "settled" || c.status === "cancelled";
  const docs: Doc[] = c.claim_documents ?? [];
  const deds: any[] = c.claim_deductions ?? [];
  const gap = c.status === "settled" ? Number(c.billed_amount) - Number(c.settled_amount) - deds.reduce((n, d) => n + Number(d.amount), 0) : 0;
  const stageOf = c.status === "approved" || c.status === "discharge_sent" || c.status === "settled" ? "discharge" : "preauth";

  return (
    <Modal title={`${c.claim_number} · ${c.clinic_patients?.name ?? "Patient"}`} onClose={onClose} wide>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${PILL[c.status]}`}>{STATUS_LABEL[c.status as ClaimStatus]}</span>
          {s && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.overdue ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}`}>⏱ {s.label} (limit {s.limitMinutes / 60}h)</span>}
          {c.insurer_ref && <span className="text-xs text-slate-500">Insurer ref {c.insurer_ref}</span>}
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["Procedure", c.procedure], ["Payer", c.insurance_payers?.name], ["Policy", c.patient_policies?.policy_number], ["Sum insured", c.patient_policies?.sum_insured != null ? inr(c.patient_policies.sum_insured) : "–"],
            ["Estimate", inr(c.estimated_amount)], ["Approved", c.approved_amount != null ? inr(c.approved_amount) : "–"], ["Final bill", c.billed_amount != null ? inr(c.billed_amount) : "–"], ["Paid", c.settled_amount != null ? inr(c.settled_amount) : "–"]]
            .map(([k, v]) => <div key={k as string}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium text-slate-900 truncate">{v ?? "–"}</dd></div>)}
        </dl>
        {c.insurance_payers?.portal_url && <p className="text-xs"><a href={c.insurance_payers.portal_url} target="_blank" rel="noreferrer" className="text-sky-700 underline">Open {c.insurance_payers.name} portal ↗</a>{c.insurance_payers.phone ? ` · ${c.insurance_payers.phone}` : ""}</p>}
        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}

        {canEdit && nextActions(c.status).length > 0 && (
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs font-medium text-slate-600 mb-2">What happened?</p>
            <div className="flex flex-wrap gap-2">
              {nextActions(c.status).map((a) => (
                <button key={a.to} disabled={busy} onClick={() => { setAct(a); setVal(""); }}
                  className={`text-sm px-3 py-1.5 rounded-lg border ${act?.to === a.to ? "bg-slate-900 text-white border-slate-900" : a.to === "rejected" || a.to === "cancelled" ? "bg-white border-red-200 text-red-700" : "bg-white border-slate-200"}`}>{a.label}</button>
              ))}
            </div>
            {act && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {act.needs && (
                  <label className="flex-1 min-w-[180px]"><span className={lbl}>{act.needs === "message" ? (act.to === "reply" ? "What you sent back" : "What the insurer asked") : act.needs === "note" ? "Reason the insurer gave" : act.needs === "approved_amount" ? "Amount approved (₹)" : act.needs === "billed_amount" ? "Final bill (₹)" : "Amount paid by insurer (₹)"}</span>
                    <input autoFocus className={inp} value={val} inputMode={/amount/.test(act.needs) ? "decimal" : "text"} onChange={(e) => setVal(e.target.value)} /></label>
                )}
                {(act.to === "preauth_sent" || act.to === "approved") && (
                  <label className="w-44"><span className={lbl}>Insurer ref (optional)</span><input className={inp} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
                )}
                <button disabled={busy || (!!act.needs && !val.trim())} onClick={doAction} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold disabled:opacity-40">{act.needs ? "Save" : `Confirm: ${act.label}`}</button>
                <button onClick={() => setAct(null)} className="px-3 py-2.5 text-sm text-slate-500">Cancel</button>
              </div>
            )}
          </div>
        )}

        <section>
          <h3 className="font-semibold text-slate-900 mb-2">Papers</h3>
          {(["preauth", "discharge"] as const).map((stg) => { const list = docs.filter((d) => d.stage === stg); const got = list.filter((d) => d.received).length; return (
            <div key={stg} className={`mb-3 ${stg !== stageOf && stg === "discharge" && stageOf === "preauth" ? "opacity-60" : ""}`}>
              <p className="text-xs font-medium text-slate-500 mb-1">{stg === "preauth" ? "For pre-authorisation" : "For discharge"} · {got}/{list.length}</p>
              <ul className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
                {list.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked={d.received} disabled={!canEdit || closed || busy} aria-label={d.name} onChange={(e) => call({ action: "doc", docId: d.id, received: e.target.checked })} />
                    <span className={`flex-1 ${d.received ? "text-slate-500 line-through" : "text-slate-900"}`}>{d.name}{!d.required && <span className="text-xs text-slate-400"> (if any)</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          ); })}
          {canEdit && !closed && (
            <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (newDoc.trim() && await call({ action: "doc", stage: stageOf, name: newDoc })) setNewDoc(""); }}>
              <input className={inp} placeholder="Insurer asked for another paper? Add it" value={newDoc} onChange={(e) => setNewDoc(e.target.value)} />
              <button disabled={busy || !newDoc.trim()} className="px-3 rounded-xl border border-slate-200 text-sm disabled:opacity-40">Add</button>
            </form>
          )}
        </section>

        {["approved", "discharge_sent", "query", "settled"].includes(c.status) && (
          <section>
            <h3 className="font-semibold text-slate-900 mb-1">Deductions</h3>
            <p className="text-xs text-slate-500 mb-2">Money the insurer did not pay. Record each cut with its reason, then dispute it or accept it.</p>
            {gap > 0 && <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 mb-2">{inr(gap)} of the bill is not explained yet. Add the deductions from the settlement letter.</p>}
            {deds.length > 0 && (
              <ul className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50 mb-2">
                {deds.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="flex-1 min-w-[160px]"><p className="text-slate-900">{d.reason}</p><p className="text-xs text-slate-500">{DEDUCTION_CATEGORIES[d.category]}{d.outcome === "recovered" ? ` · won back ${inr(d.recovered_amount)}` : ""}</p></div>
                    <span className="tabular-nums font-medium">{inr(d.amount)}</span>
                    <select aria-label="Outcome" disabled={!canEdit || busy} value={d.outcome} onChange={(e) => call({ action: "deduction", deductionId: d.id, outcome: e.target.value })} className="border border-slate-200 rounded-lg px-2 py-1 text-xs">
                      <option value="open">Not checked</option><option value="disputed">Disputed</option><option value="recovered">Won back</option><option value="accepted">Accepted</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <form className="grid grid-cols-2 sm:grid-cols-[1fr_2fr_1fr_auto] gap-2" onSubmit={async (e) => { e.preventDefault(); if (await call({ action: "deduction", ...ded })) setDed({ category: ded.category, reason: "", amount: "" }); }}>
                <select className={inp} value={ded.category} onChange={(e) => setDed({ ...ded, category: e.target.value })} aria-label="Reason type">
                  {Object.entries(DEDUCTION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input className={inp} placeholder="Reason in the letter" value={ded.reason} onChange={(e) => setDed({ ...ded, reason: e.target.value })} />
                <input className={inp} placeholder="₹" inputMode="decimal" value={ded.amount} onChange={(e) => setDed({ ...ded, amount: e.target.value })} />
                <button disabled={busy || !ded.reason.trim() || !ded.amount} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm disabled:opacity-40">Add</button>
              </form>
            )}
          </section>
        )}

        <section>
          <h3 className="font-semibold text-slate-900 mb-2">Timeline</h3>
          {canEdit && (
            <form className="flex gap-2 mb-2" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && await call({ action: "note", message: note })) setNote(""); }}>
              <input className={inp} placeholder="Add a note (call with TPA, follow-up…)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button disabled={busy || !note.trim()} className="px-3 rounded-xl border border-slate-200 text-sm disabled:opacity-40">Add</button>
            </form>
          )}
          <ol className="space-y-2">
            {(c.claim_events ?? []).map((e: any) => (
              <li key={e.id} className="flex gap-3">
                <span className="text-xs text-slate-400 w-28 shrink-0 tabular-nums">{new Date(e.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                <span className="text-slate-700">
                  {e.kind === "status" ? <>→ <b>{STATUS_LABEL[e.to_status as ClaimStatus] ?? e.to_status}</b>{e.amount != null ? ` · ${inr(e.amount)}` : ""}</> : e.kind === "query" ? <b className="text-amber-700">Insurer query</b> : e.kind === "reply" ? <b>Replied</b> : e.kind === "deduction" ? <b>Deduction{e.to_status ? `: ${e.to_status}` : ""}{e.amount != null ? ` · ${inr(e.amount)}` : ""}</b> : e.kind === "created" ? <b>Claim opened</b> : <b>Note</b>}
                  {e.message ? <> — {e.message}</> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Modal>
  );
}

// ─── a new claim ─────────────────────────────────────────────
function NewClaim({ clinicId, payers, onClose, onCreated }: { clinicId: string; payers: Payer[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState(""); const [found, setFound] = useState<any[]>([]);
  const [pat, setPat] = useState<any>(null); const [policyId, setPolicyId] = useState("");
  const [pol, setPol] = useState({ payerId: "", tpaId: "", policyNumber: "", sumInsured: "", validTo: "", abhaId: "" });
  const [f, setF] = useState({ procedure: "", admissionDate: todayIso(), estimatedAmount: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const insurers = payers.filter((p) => p.kind !== "tpa"); const tpas = payers.filter((p) => p.kind === "tpa");

  useEffect(() => {
    const t = setTimeout(() => { authFetch(`/api/claims?clinicId=${clinicId}&patients=${encodeURIComponent(q)}`).then((r) => setFound(r.patients)).catch((e) => setErr(e.message)); }, 250);
    return () => clearTimeout(t);
  }, [q, clinicId]);

  async function create() {
    setBusy(true); setErr("");
    try {
      let pid = policyId;
      if (!pid) pid = (await authFetch("/api/claims", { body: { clinicId, action: "policy", patientId: pat.id, ...pol } })).id;
      const r = await authFetch("/api/claims", { body: { clinicId, action: "create", policyId: pid, ...f } });
      onCreated(r.claim_id);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="New insurance claim" onClose={onClose}>
      <div className="space-y-4 text-sm">
        {!pat ? (
          <>
            <label className="block"><span className={lbl}>Find the patient</span><input autoFocus className={inp} placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <ul className="border border-slate-100 rounded-xl divide-y divide-slate-50 max-h-72 overflow-y-auto">
              {found.map((p) => (
                <li key={p.id}><button className="w-full text-left px-3 py-2 hover:bg-slate-50" onClick={() => { setPat(p); setPolicyId(p.patient_policies?.[0]?.id ?? ""); }}>
                  <span className="font-medium text-slate-900">{p.name}</span> <span className="text-slate-500">{p.phone}</span>
                  {p.patient_policies?.length > 0 && <span className="block text-xs text-sky-700">{p.patient_policies.length} polic{p.patient_policies.length > 1 ? "ies" : "y"} on file</span>}
                </button></li>
              ))}
              {!found.length && <li className="px-3 py-3 text-slate-500">No patients found. Add them in Patients first.</li>}
            </ul>
          </>
        ) : (
          <>
            <p className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"><span><b>{pat.name}</b> {pat.phone}</span><button className="text-xs text-sky-700" onClick={() => setPat(null)}>Change</button></p>
            <fieldset>
              <legend className={lbl}>Policy</legend>
              <div className="space-y-1">
                {(pat.patient_policies ?? []).map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2"><input type="radio" name="pol" checked={policyId === p.id} onChange={() => setPolicyId(p.id)} />
                    {p.payer?.name} · {p.policy_number}{p.tpa?.name ? ` · via ${p.tpa.name}` : ""}{p.valid_to && p.valid_to < todayIso() ? <span className="text-red-600"> (expired)</span> : null}</label>
                ))}
                <label className="flex items-center gap-2"><input type="radio" name="pol" checked={!policyId} onChange={() => setPolicyId("")} /> Add a new policy</label>
              </div>
            </fieldset>
            {!policyId && (
              <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-xl p-3">
                <label><span className={lbl}>Insurer</span><select className={inp} value={pol.payerId} onChange={(e) => setPol({ ...pol, payerId: e.target.value })}><option value="">Choose…</option>{insurers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label><span className={lbl}>TPA (if any)</span><select className={inp} value={pol.tpaId} onChange={(e) => setPol({ ...pol, tpaId: e.target.value })}><option value="">None</option>{tpas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label><span className={lbl}>Policy number</span><input className={inp} value={pol.policyNumber} onChange={(e) => setPol({ ...pol, policyNumber: e.target.value })} /></label>
                <label><span className={lbl}>Sum insured (₹)</span><input className={inp} inputMode="decimal" value={pol.sumInsured} onChange={(e) => setPol({ ...pol, sumInsured: e.target.value })} /></label>
                <label><span className={lbl}>Valid till</span><input type="date" className={inp} value={pol.validTo} onChange={(e) => setPol({ ...pol, validTo: e.target.value })} /></label>
                <label><span className={lbl}>ABHA (optional)</span><input className={inp} placeholder="14 digits or name@abdm" value={pol.abhaId} onChange={(e) => setPol({ ...pol, abhaId: e.target.value })} /></label>
              </div>
            )}
            <label className="block"><span className={lbl}>Treatment / procedure</span><input className={inp} placeholder="e.g. Cataract surgery, right eye" value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label><span className={lbl}>Admission date</span><input type="date" className={inp} value={f.admissionDate} onChange={(e) => setF({ ...f, admissionDate: e.target.value })} /></label>
              <label><span className={lbl}>Estimated cost (₹)</span><input className={inp} inputMode="decimal" value={f.estimatedAmount} onChange={(e) => setF({ ...f, estimatedAmount: e.target.value })} /></label>
            </div>
            {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
            <button disabled={busy || !f.procedure.trim() || (!policyId && (!pol.payerId || !pol.policyNumber.trim()))} onClick={create}
              className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold disabled:opacity-40">Open claim and get the paper checklist</button>
          </>
        )}
        {err && !pat && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

// ─── insurers & TPAs ─────────────────────────────────────────
function Payers({ clinicId, payers, onClose, onChanged }: { clinicId: string; payers: Payer[]; onClose: () => void; onChanged: () => void }) {
  const [f, setF] = useState({ name: "", kind: "insurer", portal_url: "", phone: "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function call(body: Record<string, unknown>) {
    setBusy(true); setErr("");
    try { await authFetch("/api/claims", { body: { clinicId, ...body } }); onChanged(); setBusy(false); return true; } catch (e: any) { setErr(e.message); setBusy(false); return false; }
  }
  const KIND: Record<string, string> = { insurer: "Insurer", tpa: "TPA", government: "Govt scheme", corporate: "Corporate" };
  return (
    <Modal title="Insurers & TPAs" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <ul className="border border-slate-100 rounded-xl divide-y divide-slate-50">
          {payers.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1"><b className="font-medium text-slate-900">{p.name}</b> <span className="text-xs text-slate-500">{KIND[p.kind]}</span></span>
              <button disabled={busy} onClick={() => call({ action: "payer_archive", id: p.id })} className="text-xs text-slate-500 hover:text-red-600">Remove</button>
            </li>
          ))}
          {!payers.length && <li className="px-3 py-3 text-slate-500">None yet.</li>}
        </ul>
        <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => { e.preventDefault(); if (await call({ action: "payer", ...f })) setF({ name: "", kind: f.kind, portal_url: "", phone: "" }); }}>
          <label className="col-span-2 sm:col-span-1"><span className={lbl}>Name</span><input className={inp} placeholder="e.g. Star Health" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="col-span-2 sm:col-span-1"><span className={lbl}>Type</span><select className={inp} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label><span className={lbl}>Portal link (optional)</span><input className={inp} placeholder="https://" value={f.portal_url} onChange={(e) => setF({ ...f, portal_url: e.target.value })} /></label>
          <label><span className={lbl}>Helpdesk phone</span><input className={inp} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          {err && <p className="col-span-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          <button disabled={busy || f.name.trim().length < 2} className="col-span-2 py-2.5 rounded-xl bg-sky-600 text-white font-semibold disabled:opacity-40">Add</button>
        </form>
        <p className="text-xs text-slate-400">Policies that go through a TPA are tracked against the TPA, since they decide the claim.</p>
      </div>
    </Modal>
  );
}
