"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api";

interface Item { id: string; session_id: string; module: string; question: string; answer: string; source: string; created_at: string }

/** The AI's only memory is our database. This lists what you asked it and lets you delete it, which makes it forget. */
export default function AiHistoryPanel({ clinicId, module, botName, refreshKey }: { clinicId: string; module: "assistant" | "builder"; botName: string; refreshKey?: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const d = await authFetch(`/api/ai/history?clinicId=${clinicId}&module=${module}`); setItems(d.items); setErr(""); }
    catch (e: any) { setErr(e.message); }
  }, [clinicId, module]);
  useEffect(() => { if (open) load(); }, [open, load, refreshKey]);

  async function del(body: Record<string, unknown>) {
    setBusy(true);
    try { await authFetch("/api/ai/history", { method: "DELETE", body: { clinicId, ...body } }); await load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="border-t border-slate-100 bg-white">
      <button onClick={() => setOpen(!open)} className="w-full px-6 py-2 text-left text-xs font-semibold text-slate-500 hover:text-slate-800">
        {open ? "▾" : "▸"} What {botName} remembers about you
      </button>
      {open && (
        <div className="px-6 pb-4 max-h-64 overflow-y-auto">
          {err && <p className="text-xs text-red-600 mb-2">{err}</p>}
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Stored only in your clinic&apos;s database. Delete an item and {botName} no longer has it.</p>
            {items.length > 0 && <button disabled={busy} onClick={() => del({ scope: "mine" })} className="text-xs font-semibold text-red-600 hover:text-red-800 whitespace-nowrap ml-3">Delete all mine</button>}
          </div>
          {items.length === 0 ? <p className="text-xs text-slate-400">Nothing stored.</p> : (
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.id} className="rounded-lg border border-slate-100 p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <p className="font-medium text-slate-800 break-words min-w-0">{i.question}</p>
                    <button disabled={busy} onClick={() => del({ scope: "one", id: i.id })} className="text-red-600 hover:text-red-800 font-semibold shrink-0">Delete</button>
                  </div>
                  <p className="text-slate-500 mt-1 break-words">{i.answer.slice(0, 160)}{i.answer.length > 160 ? "…" : ""}</p>
                  <p className="text-slate-300 mt-1">{new Date(i.created_at).toLocaleString("en-IN")} · {i.source === "external" ? "AI service (de-identified)" : "answered inside our system"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
