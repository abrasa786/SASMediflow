"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import { toast } from "@/lib/toast";

/** Settings card (admin): external AI on/off, how long history is kept, and clearing everything. */
export default function AiPrivacyCard({ clinicId }: { clinicId: string }) {
  const [raw, setS] = useState<any>(null);
  // a reply without the expected parts is treated as "off, 30 days" instead of crashing the page
  const s = raw && { ...raw, policy: { external_enabled: false, retention_days: 30, ...(raw.policy ?? {}) } };
  const [days, setDays] = useState(30);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    authFetch(`/api/ai/settings?clinicId=${clinicId}`).then((d) => { setS(d); setDays(d.policy?.retention_days ?? 30); }).catch((e) => setErr(e.message));
  }, [clinicId]);

  async function save(patch: Record<string, unknown>, ok: string) {
    setBusy(true); setErr(""); setMsg("");
    try { const d = await authFetch("/api/ai/settings", { body: { clinicId, ...patch } }); setS(d); setDays(d.policy?.retention_days ?? 30); setMsg(ok); toast(ok); }
    catch (e: any) { setErr(e.message); toast(e.message, false); } finally { setBusy(false); }
  }
  async function clearAll() {
    setBusy(true); setErr(""); setMsg("");
    try { const d = await authFetch("/api/ai/history", { method: "DELETE", body: { clinicId, scope: "all" } }); { const t = `Deleted ${d.deleted} stored question${d.deleted === 1 ? "" : "s"}.`; setMsg(t); toast(t); } }
    catch (e: any) { setErr(e.message); toast(e.message, false); } finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mt-6" aria-labelledby="aip-h">
      <h2 id="aip-h" className="font-semibold text-sm uppercase tracking-wide text-slate-500 mb-4">AI &amp; privacy</h2>
      {!s ? <p className="text-sm text-slate-400">{err || "Loading…"}</p> : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">Everything your team types to the assistant and the builder is stored in your clinic&apos;s database, and only there. Common questions are answered inside our system without any outside call.</p>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-slate-800">External AI service</span>
              {s.provider_configured ? (
                <button type="button" role="switch" aria-checked={!!s.policy.external_enabled} disabled={busy}
                  onClick={() => save({ external_enabled: !s.policy.external_enabled }, !s.policy.external_enabled ? "External AI is on. Names, phone numbers and IDs are removed before anything is sent." : "External AI is off. Nothing leaves our system.")}
                  className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${s.policy.external_enabled ? "bg-sky-600" : "bg-slate-300"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${s.policy.external_enabled ? "translate-x-5" : ""}`} />
                </button>
              ) : <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 shrink-0">Not available</span>}
            </div>
            <p className="text-slate-500 mt-2">Lets the assistant answer open-ended questions. Only de-identified text is sent (patients become “Patient A”; phones, emails, Aadhaar and PAN are removed). Currently <b>{s.policy.external_enabled ? "on" : "off"}</b>.</p>
            {!s.provider_configured && <p className="mt-2 text-amber-800 bg-amber-50 rounded-lg px-3 py-2">This is not available yet, so there is nothing to switch. Everything the assistant does today works inside Mediflow without it.</p>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Keep questions for (days, 0 = keep nothing)</label>
              <input type="number" min={0} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>
            <button disabled={busy} onClick={() => save({ retention_days: days }, "Saved. Older questions are deleted automatically every day.")} className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">Save</button>
            <button disabled={busy} onClick={clearAll} className="px-4 py-2 rounded-xl border border-red-300 text-red-700 text-sm font-semibold hover:bg-red-50 disabled:opacity-60">Delete all stored questions</button>
          </div>
          <p className="text-xs text-slate-400">Stored text is {s.encrypted_at_rest ? "encrypted at rest" : "not yet encrypted (set AI_DATA_KEY on the server to encrypt it)"}.</p>
          {msg && <p className="text-emerald-700">{msg}</p>}
          {err && <p className="text-red-600">{err}</p>}
        </div>
      )}
    </section>
  );
}
