"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";

/** Settings card (admin): external AI on/off, how long history is kept, and clearing everything. */
export default function AiPrivacyCard({ clinicId }: { clinicId: string }) {
  const [s, setS] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    authFetch(`/api/ai/settings?clinicId=${clinicId}`).then((d) => { setS(d); setDays(d.policy.retention_days); }).catch((e) => setErr(e.message));
  }, [clinicId]);

  async function save(patch: Record<string, unknown>, ok: string) {
    setBusy(true); setErr(""); setMsg("");
    try { const d = await authFetch("/api/ai/settings", { body: { clinicId, ...patch } }); setS(d); setDays(d.policy.retention_days); setMsg(ok); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function clearAll() {
    setBusy(true); setErr(""); setMsg("");
    try { const d = await authFetch("/api/ai/history", { method: "DELETE", body: { clinicId, scope: "all" } }); setMsg(`Deleted ${d.deleted} stored question${d.deleted === 1 ? "" : "s"}.`); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mt-6" aria-labelledby="aip-h">
      <h2 id="aip-h" className="font-semibold text-sm uppercase tracking-wide text-slate-500 mb-4">AI &amp; privacy</h2>
      {!s ? <p className="text-sm text-slate-400">{err || "Loading…"}</p> : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">Everything your team types to the assistant and the builder is stored in your clinic&apos;s database, and only there. Common questions are answered inside our system without any outside call.</p>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={!!s.policy.external_enabled} disabled={busy || !s.provider_configured} onChange={(e) => save({ external_enabled: e.target.checked }, e.target.checked ? "External AI is on. Names, phone numbers and IDs are removed before anything is sent." : "External AI is off. Nothing leaves our system.")} />
            <span><span className="font-semibold text-slate-800">Allow open-ended answers from an external AI service</span><br />
              <span className="text-slate-500">Off by default. When on, only de-identified text is sent (patients become “Patient A”; phones, emails, Aadhaar and PAN are removed), and nothing is kept on our side by the provider call itself.{!s.provider_configured && " No AI provider key is configured on the server, so this cannot be switched on."}</span></span>
          </label>
          <div className="flex items-end gap-3">
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
