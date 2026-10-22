"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getClinic } from "@/lib/clinic";
import AiHistoryPanel from "@/components/AiHistoryPanel";
import InvoiceCard, { type InvoiceForm } from "@/components/InvoiceCard";

interface Action { label: string; url: string }
interface Message { role: "user" | "assistant"; content: string; ts: Date; actions?: Action[]; slots?: string[]; form?: InvoiceForm }

const QUICK_PROMPTS = [
  "Book Priya Sharma 9876543210 tomorrow 10am",
  "How many appointments today?",
  "Which stock items are running low?",
  "Show today's revenue",
];

export default function ChatbotPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [botName, setBotName] = useState("Assistant");
  const [turns, setTurns] = useState(0);
  const sessionRef = useRef<string | undefined>(undefined);
  const draftRef = useRef<any>(null); // the booking/cancel request being filled in across messages

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    getClinic(id).then((c) => {
      const n = c?.ai_name || "Assistant";
      setBotName(n);
      setMessages((m) => m.length === 1 && m[0].content.startsWith("Hi!") ? [{ ...m[0], content: m[0].content.replace("Hi! I can", `Hi! I'm ${n}. I can`) }] : m);
    }).catch(() => null);
    setMessages([{
      role: "assistant",
      content: "Hi! I can book, cancel and reschedule appointments for you. I check doctor availability, create the patient record if they're new, and prepare WhatsApp confirmations.\nTry: Book Anita Rao 9876543210 tomorrow 4pm\nI can also answer questions about today's appointments, revenue and stock.",
      ts: new Date(),
    }]);
  }, [router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    const userMsg: Message = { role: "user", content: msg, ts: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const data = await authFetch("/api/chatbot", { body: { clinicId, message: msg, history, draft: draftRef.current, sessionId: sessionRef.current } });
      sessionRef.current = data.sessionId ?? sessionRef.current;
      setTurns((n) => n + 1);
      draftRef.current = data.draft ?? null;
      setMessages(prev => [...prev, { role: "assistant", content: data.reply, ts: new Date(), actions: data.actions, slots: data.slots, form: data.form }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Sorry, I ran into an error: ${e.message}`, ts: new Date() }]);
    } finally {
      setLoading(false);
    }
  }

  function formatTime(d: Date) {
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  }

  function renderContent(text: string) {
    // Simple markdown-like formatting
    return text
      .split("\n")
      .map((line, i) => {
        if (line.startsWith("**") && line.endsWith("**")) {
          return <p key={i} className="font-semibold">{line.slice(2, -2)}</p>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return <li key={i} className="ml-3">{line.slice(2)}</li>;
        }
        if (line.trim() === "") return <br key={i} />;
        return <p key={i}>{line}</p>;
      });
  }

  return (
    <AppShell>
      <div className="flex flex-col h-screen" style={{ height: "calc(100vh - 0px)" }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-sky-700 rounded-xl flex items-center justify-center text-white text-lg">🤖</div>
            <div>
              <h1 className="font-bold text-slate-900">{botName}</h1>
              <p className="text-xs text-emerald-600 font-medium">● Books appointments · Live clinic data</p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-slate-50">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
              <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm font-bold ${msg.role === "user" ? "bg-sky-500 text-white" : "bg-white border border-slate-200 text-xl"}`}>
                {msg.role === "user" ? "U" : "🤖"}
              </div>
              <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "user" ? "bg-sky-500 text-white rounded-tr-sm" : "bg-white border border-slate-100 shadow-sm text-slate-800 rounded-tl-sm"}`}>
                <div className="space-y-1">{renderContent(msg.content)}</div>
                {msg.slots && msg.slots.length > 0 && i === messages.length - 1 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.slots.map(t => <button key={t} onClick={() => send(t)} className="text-xs px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-full border border-sky-200">{t}</button>)}
                  </div>
                )}
                {msg.form && <InvoiceCard clinicId={clinicId} form={msg.form} accent="#0ea5e9" />}
                {msg.actions && msg.actions.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-2">
                    {msg.actions.map(a => <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 font-medium">{a.label} ↗</a>)}
                  </div>
                )}
                <p className={`text-xs mt-1.5 ${msg.role === "user" ? "text-sky-200" : "text-slate-400"}`}>{formatTime(msg.ts)}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-lg shrink-0">🤖</div>
              <div className="bg-white border border-slate-100 shadow-sm rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1.5 items-center">
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick prompts */}
        {messages.length <= 1 && (
          <div className="px-6 py-3 bg-white border-t border-slate-100 shrink-0">
            <p className="text-xs text-slate-400 mb-2 font-medium">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map(q => (
                <button key={q} onClick={() => send(q)} className="text-xs px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-full border border-sky-200 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {clinicId && <AiHistoryPanel clinicId={clinicId} module="assistant" botName={botName} refreshKey={turns} />}

        {/* Input */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 shrink-0">
          <form onSubmit={e => { e.preventDefault(); send(); }} className="flex gap-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Book, cancel, reschedule, or ask about today…"
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold transition-colors"
            >
              ↑
            </button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
