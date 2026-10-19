"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { authFetch } from "@/lib/api";
import { getActiveClinicId } from "@/lib/auth";

interface Msg { role: "user" | "assistant"; content: string; actions?: { label: string; url: string }[]; slots?: string[] }
const KEY = "mf_assistant_";
const read = (cid: string): { msgs: Msg[]; draft: any; sid?: string; open: boolean } => { try { return JSON.parse(sessionStorage.getItem(KEY + cid) ?? "") ; } catch { return { msgs: [], draft: null, open: false }; } };

/** The assistant, on every screen: a button in the bottom-right corner that opens a chat. The conversation follows you between pages. */
export default function AssistantWidget({ botName, color }: { botName: string; color?: string | null }) {
  const path = usePathname();
  const [cid, setCid] = useState("");
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = useRef<any>(null);
  const sid = useRef<string | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = getActiveClinicId(); if (!id) return;
    setCid(id); const s = read(id);
    setMsgs(s.msgs ?? []); draft.current = s.draft ?? null; sid.current = s.sid; setOpen(!!s.open);
  }, []);
  useEffect(() => { if (cid) try { sessionStorage.setItem(KEY + cid, JSON.stringify({ msgs: msgs.slice(-30), draft: draft.current, sid: sid.current, open })); } catch { /* storage may be blocked */ } }, [msgs, open, cid]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open, busy]);

  if (!cid || path === "/chatbot") return null;     // the full-page assistant already exists
  const accent = color || "#0284c7";

  async function send(text?: string) {
    const m = (text ?? input).trim(); if (!m || busy) return;
    setInput(""); setMsgs((x) => [...x, { role: "user", content: m }]); setBusy(true);
    try {
      const history = msgs.slice(-8).map((x) => ({ role: x.role, content: x.content }));
      const r = await authFetch("/api/chatbot", { body: { clinicId: cid, message: m, history, draft: draft.current, sessionId: sid.current } });
      sid.current = r.sessionId ?? sid.current; draft.current = r.draft ?? null;
      setMsgs((x) => [...x, { role: "assistant", content: r.reply, actions: r.actions, slots: r.slots }]);
    } catch (e: any) { setMsgs((x) => [...x, { role: "assistant", content: `Sorry, something went wrong: ${e.message}` }]); }
    setBusy(false);
  }

  const hints = ["What's on today?", "Free slots tomorrow", "Show appointments by doctor", "Low stock?"];
  return (
    <>
      {open && (
        <section aria-label={`${botName} chat`} className="fixed z-50 bottom-24 right-5 w-[min(380px,calc(100vw-2rem))] h-[min(560px,calc(100vh-8rem))] bg-white border border-slate-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <header className="px-4 py-3 text-white flex items-center justify-between" style={{ background: accent }}>
            <div className="min-w-0"><p className="font-semibold text-sm truncate">🤖 {botName}</p><p className="text-[11px] opacity-80">Calendar, records and reports, by chat</p></div>
            <div className="flex items-center gap-1">
              <button onClick={() => { setMsgs([]); draft.current = null; sid.current = undefined; }} className="text-xs px-2 py-1 rounded hover:bg-white/20" aria-label="Start a new chat">New</button>
              <button onClick={() => setOpen(false)} className="px-2 py-1 rounded hover:bg-white/20" aria-label="Close chat">✕</button>
            </div>
          </header>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50 text-sm">
            {!msgs.length && (
              <div className="text-slate-500">
                <p className="mb-2">Hi! I&apos;m {botName}. Ask me about your clinic, or tell me what to do.</p>
                <div className="flex flex-wrap gap-1.5">{hints.map((h) => <button key={h} onClick={() => send(h)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:border-sky-300">{h}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 whitespace-pre-line ${m.role === "user" ? "text-white rounded-br-sm" : "bg-white border border-slate-100 text-slate-800 rounded-bl-sm"}`} style={m.role === "user" ? { background: accent } : undefined}>
                  {m.content}
                  {m.slots && i === msgs.length - 1 && <div className="flex flex-wrap gap-1 mt-2">{m.slots.map((t) => <button key={t} onClick={() => send(t)} className="text-xs px-2 py-0.5 rounded-full border border-sky-200 bg-sky-50 text-sky-700">{t}</button>)}</div>}
                  {m.actions?.map((a) => <a key={a.url} href={a.url} className="block mt-2 text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">{a.label}</a>)}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs text-slate-400">{botName} is typing…</p>}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="p-2 border-t border-slate-100 flex gap-2 bg-white">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a request…" aria-label="Message" className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
            <button disabled={busy || !input.trim()} className="px-3 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-50" style={{ background: accent }}>Send</button>
          </form>
        </section>
      )}
      <button onClick={() => setOpen((o) => !o)} aria-label={open ? `Close ${botName}` : `Open ${botName}`} aria-expanded={open}
        className="fixed z-50 bottom-5 right-5 w-14 h-14 rounded-full text-white text-2xl shadow-xl hover:scale-105 transition-transform" style={{ background: accent }}>{open ? "✕" : "🤖"}</button>
    </>
  );
}
