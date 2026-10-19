"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import BuilderTabs from "@/components/BuilderTabs";
import { getActiveClinicId, getSession } from "@/lib/auth";
import type { Plan, Schema } from "@/lib/builder/types";

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  plan?: Plan | null;
  lines?: string[];
  prompt?: string;
  state?: "pending" | "applied" | "discarded";
  source?: string;
}
interface Changeset { id: string; prompt: string | null; status: string; error: string | null; created_at: string; plan: Plan }

const EXAMPLES = [
  "Create a Laboratory app with Lab Test and Lab Order",
  "Create an Inpatient app with Ward, Bed and Admission",
  "Recommend fields for surgery",
  "Add fields insurance provider and emergency contact to admission",
];

async function api(path: string, body?: unknown) {
  const session = await getSession();
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function BuilderPage() {
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([{
    id: 0, role: "assistant",
    text: "Hi! Tell me what you want to set up and I'll prepare the change for your approval. I can create apps and new tables (objects), add or hide fields, and recommend fields for common hospital needs.",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [schema, setSchema] = useState<Schema>({ objects: [], apps: [] });
  const [history, setHistory] = useState<Changeset[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [tab, setTab] = useState<"schema" | "history">("schema");
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  const refresh = useCallback(async (cid: string) => {
    try {
      const d = await api(`/api/builder/schema?clinicId=${cid}`);
      setSchema(d.schema); setHistory(d.changesets); setLoadErr("");
    } catch (e: any) { setLoadErr(e.message); }
  }, []);

  useEffect(() => {
    const cid = getActiveClinicId();
    setClinicId(cid);
    if (cid) refresh(cid);
  }, [refresh]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  const push = (m: Omit<Msg, "id">) => setMsgs((x) => [...x, { ...m, id: nextId.current++ }]);

  async function send(text?: string) {
    const prompt = (text ?? input).trim();
    if (!prompt || busy || !clinicId) return;
    setInput("");
    const history = msgs.slice(-6).map((m) => ({ role: m.role, content: m.text }));
    push({ role: "user", text: prompt });
    setBusy(true);
    try {
      const r = await api("/api/builder/plan", { clinicId, prompt, history });
      push({ role: "assistant", text: r.message, plan: r.plan, lines: r.lines, prompt, state: r.plan ? "pending" : undefined, source: r.source });
    } catch (e: any) {
      push({ role: "assistant", text: e.message });
    }
    setBusy(false);
  }

  async function apply(m: Msg) {
    if (!clinicId || !m.plan) return;
    setBusy(true);
    try {
      const r = await api("/api/builder/apply", { clinicId, prompt: m.prompt, plan: m.plan });
      setSchema(r.schema);
      setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, state: "applied" } : y)));
      push({ role: "assistant", text: "Done. Everything was applied together and is saved in your change history, so you can undo it. Want to add anything else?" });
      refresh(clinicId);
    } catch (e: any) {
      push({ role: "assistant", text: e.message });
    }
    setBusy(false);
  }

  async function undo(id: string) {
    if (!clinicId || busy) return;
    setBusy(true);
    try {
      const r = await api("/api/builder/rollback", { clinicId, changesetId: id });
      setSchema(r.schema);
      const kept = r.result?.kept ?? 0;
      push({ role: "assistant", text: `Change undone.${kept ? ` ${kept} item${kept > 1 ? "s" : ""} already held data, so they were archived or hidden instead of deleted.` : ""}` });
      refresh(clinicId);
    } catch (e: any) { push({ role: "assistant", text: e.message }); }
    setBusy(false);
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>AI Builder</h1>
          <p className="text-sm text-gray-500">Describe an app, table or field in plain words. You approve every change before it runs.</p>
        </div>

        <BuilderTabs isAdmin />

        {loadErr && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{loadErr}</div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
          {/* Chat */}
          <div className="bg-white rounded-2xl border border-gray-200 flex flex-col min-w-0" style={{ height: "calc(100vh - 190px)", minHeight: 420 }}>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {msgs.map((m) => (
                <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex"}>
                  <div className={`max-w-[92%] rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-gray-100 text-gray-800"}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.plan && m.lines && (
                      <div className="mt-3 rounded-xl bg-white text-gray-800 border border-gray-200 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Proposed changes</p>
                        <ol className="space-y-1.5 list-decimal pl-5 text-[13px]">
                          {m.lines.map((l, i) => <li key={i}>{l}</li>)}
                        </ol>
                        {m.state === "pending" && (
                          <div className="mt-3 flex gap-2">
                            <button disabled={busy} onClick={() => apply(m)} className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 text-white text-xs font-semibold disabled:opacity-60">Approve &amp; apply</button>
                            <button disabled={busy} onClick={() => setMsgs((x) => x.map((y) => (y.id === m.id ? { ...y, state: "discarded" } : y)))} className="px-3.5 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600">Discard</button>
                          </div>
                        )}
                        {m.state === "applied" && <p className="mt-3 text-xs font-semibold text-emerald-600">✓ Applied</p>}
                        {m.state === "discarded" && <p className="mt-3 text-xs text-gray-400">Discarded. Nothing was changed.</p>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && <div className="text-xs text-gray-400 pl-1">Working…</div>}
              <div ref={endRef} />
            </div>

            {msgs.length <= 2 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {EXAMPLES.map((x) => (
                  <button key={x} onClick={() => send(x)} className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 hover:border-blue-300 text-gray-600">{x}</button>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="p-3 border-t border-gray-100 flex gap-2">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. Create a Pharmacy app with Medicine and Supplier"
                className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button disabled={busy || !input.trim()} className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white text-sm font-semibold disabled:opacity-50">Send</button>
            </form>
          </div>

          {/* Side panel */}
          <div className="bg-white rounded-2xl border border-gray-200 min-w-0 overflow-hidden" style={{ maxHeight: "calc(100vh - 190px)" }}>
            <div className="flex border-b border-gray-100 text-sm">
              {(["schema", "history"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 font-semibold ${tab === t ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-400"}`}>
                  {t === "schema" ? "Your apps & tables" : "Change history"}
                </button>
              ))}
            </div>
            <div className="p-3 overflow-y-auto text-sm" style={{ maxHeight: "calc(100vh - 250px)" }}>
              {tab === "schema" ? (
                <>
                  {schema.apps.map((a) => (
                    <div key={a.api_name} className="mb-3 rounded-xl bg-blue-50 p-3">
                      <p className="font-semibold text-gray-800">{a.icon} {a.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Tabs: {a.tabs.map((t) => t.label).join(", ") || "none"}</p>
                    </div>
                  ))}
                  {schema.objects.map((o) => (
                    <details key={o.api_name} className="mb-2 rounded-xl border border-gray-100 p-2.5">
                      <summary className="cursor-pointer font-medium text-gray-800">{o.icon ?? "📄"} {o.label} <span className="text-xs text-gray-400">({o.fields.length} fields)</span></summary>
                      <ul className="mt-2 space-y-1 text-xs text-gray-600">
                        {o.fields.map((f) => (
                          <li key={f.api_name} className="flex justify-between gap-2"><span>{f.label}{f.required ? " *" : ""}</span><span className="text-gray-400">{f.data_type}</span></li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  {!schema.objects.length && !schema.apps.length && <p className="text-gray-400 text-sm">Nothing built yet. Ask the builder to create your first app.</p>}
                </>
              ) : (
                <>
                  {history.map((h) => (
                    <div key={h.id} className="mb-2 rounded-xl border border-gray-100 p-2.5">
                      <p className="text-gray-800 line-clamp-2">{h.prompt || h.plan?.summary}</p>
                      <div className="flex items-center justify-between mt-1.5 text-xs">
                        <span className={h.status === "applied" ? "text-emerald-600" : h.status === "failed" ? "text-red-500" : "text-gray-400"}>
                          {h.status} · {new Date(h.created_at).toLocaleString()}
                        </span>
                        {h.status === "applied" && <button onClick={() => undo(h.id)} disabled={busy} className="font-semibold text-blue-600 disabled:opacity-50">Undo</button>}
                      </div>
                      {h.error && <p className="text-xs text-red-500 mt-1">{h.error}</p>}
                    </div>
                  ))}
                  {!history.length && <p className="text-gray-400 text-sm">No changes yet.</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
