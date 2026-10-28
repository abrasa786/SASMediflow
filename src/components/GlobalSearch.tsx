"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase as sb } from "@/lib/supabase";
import { getActiveClinicId } from "@/lib/auth";
import { NAV } from "./layout/Sidebar";
import type { ClinicRole } from "@/types";

const supabase = sb as any;
interface Hit { group: string; icon: string; title: string; sub?: string; href: string }

/** One search box for the whole app: screens, your apps, patients, bills, doctors, stock, treatments and tasks. Ctrl/⌘+K or "/" opens it. */
export default function GlobalSearch({ role }: { role?: ClinicRole }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [cur, setCur] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const openIt = () => { setOpen(true); setQ(""); setData([]); setCur(0); };
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement | null)?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openIt(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); openIt(); }
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", key); window.addEventListener("mf:search", openIt);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("mf:search", openIt); };
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30); }, [open]);

  // screens and your own apps: matched instantly, no server call
  const screens = useMemo<Hit[]>(() => {
    if (!open) return [];
    const out: Hit[] = NAV.filter((n: any) => !n.roles || (role && n.roles.includes(role))).map((n: any) => ({ group: "Screens", icon: n.icon, title: n.label, href: n.href }));
    try {
      const id = getActiveClinicId();
      const c = JSON.parse(sessionStorage.getItem("mf_apps_" + id) ?? "null");
      for (const a of c?.apps ?? []) {
        out.push({ group: "Your apps", icon: a.icon || "🧩", title: a.label, sub: "App", href: `/apps/${a.api_name}` });
        for (const t of a.tabs ?? []) out.push({ group: "Your apps", icon: a.icon || "🧩", title: t.label, sub: a.label, href: t.path || (t.kind === "object" && t.object ? `/builder/data?table=${t.object}` : `/apps/${a.api_name}`) });
      }
    } catch { /* optional */ }
    return out;
  }, [open, role]);

  const term = q.trim().toLowerCase();
  const local = useMemo(() => (term ? screens.filter((h) => (h.title + " " + (h.sub ?? "")).toLowerCase().includes(term)).slice(0, 8) : screens.filter((h) => h.group === "Screens").slice(0, 8)), [screens, term]);

  const run = useCallback(async (text: string) => {
    const clinicId = getActiveClinicId();
    const my = ++seq.current;
    if (!clinicId || text.length < 2) { setData([]); setBusy(false); return; }
    setBusy(true);
    const like = `%${text.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
    const digits = text.replace(/\D/g, "");
    const safe = async (p: any) => { try { const r = await p; return r.error ? [] : (r.data ?? []); } catch { return []; } };      // a table you may not read (or that is not set up yet) is skipped
    const [pt, ph, inv, doc, stk, tpl, tsk, sit] = await Promise.all([
      safe(supabase.from("clinic_patients").select("id, name, phone").eq("clinic_id", clinicId).ilike("name", like).limit(6)),
      digits.length >= 4 ? safe(supabase.from("clinic_patients").select("id, name, phone").eq("clinic_id", clinicId).ilike("phone_norm", `%${digits}%`).limit(6)) : Promise.resolve([]),
      safe(supabase.from("invoices").select("id, invoice_number, total, status").eq("clinic_id", clinicId).ilike("invoice_number", like).limit(5)),
      safe(supabase.from("doctors").select("id, name, specialty").eq("clinic_id", clinicId).ilike("name", like).limit(4)),
      safe(supabase.from("stock_items").select("id, name, quantity").eq("clinic_id", clinicId).ilike("name", like).limit(5)),
      safe(supabase.from("treatment_templates").select("id, name").eq("clinic_id", clinicId).ilike("name", like).limit(4)),
      safe(supabase.from("clinic_tasks").select("id, title, status").eq("clinic_id", clinicId).ilike("title", like).limit(4)),
      safe(supabase.from("treatment_sittings").select("id, label, status, due_amount, clinic_patients(name)").eq("clinic_id", clinicId).ilike("label", like).limit(5)),
    ]);
    if (my !== seq.current) return;      // an older search finishing late must not overwrite a newer one
    const seen = new Set<string>(); const people: any[] = [];
    for (const p of [...pt, ...ph]) if (!seen.has(p.id)) { seen.add(p.id); people.push(p); }
    setData([
      ...people.map((p) => ({ group: "Patients", icon: "👥", title: p.name, sub: p.phone ?? undefined, href: `/patients/${p.id}` })),
      ...inv.map((i: any) => ({ group: "Bills", icon: "🧾", title: i.invoice_number, sub: `₹${i.total ?? 0} · ${String(i.status ?? "").replace("_", " ")}`, href: `/billing/${i.id}` })),
      ...doc.map((d: any) => ({ group: "Doctors", icon: "🩺", title: d.name, sub: d.specialty ?? undefined, href: "/staff" })),
      ...stk.map((s: any) => ({ group: "Stock", icon: "💊", title: s.name, sub: `${s.quantity ?? 0} in stock`, href: "/stock" })),
      ...tpl.map((t: any) => ({ group: "Treatments", icon: "🦷", title: t.name, href: "/treatments" })),
      ...tsk.map((t: any) => ({ group: "Tasks", icon: "✅", title: t.title, sub: String(t.status ?? "").replace("_", " "), href: "/tasks" })),
      ...sit.map((t: any) => ({ group: "Sittings", icon: "🪥", title: t.label, sub: `${t.clinic_patients?.name ?? ""} · ₹${t.due_amount ?? 0}`, href: "/lists/sittings" })),
    ]);
    setBusy(false);
  }, []);
  useEffect(() => { if (!open) return; const t = setTimeout(() => run(q.trim()), 220); return () => clearTimeout(t); }, [q, open, run]);

  const all = useMemo(() => [...data, ...local], [data, local]);
  useEffect(() => setCur(0), [q]);
  const go = (h?: Hit) => { if (!h) return; setOpen(false); router.push(h.href); };
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(c + 1, all.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); go(all[cur]); }
  }

  if (!open) return null;
  let last = "";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center p-3 pt-[10vh] bg-slate-900/50" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} role="dialog" aria-modal="true" aria-label="Search">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-slate-100">
          <span aria-hidden>🔍</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search patients, phone, bills, screens, apps, stock…" aria-label="Search everything" className="flex-1 min-w-0 py-3.5 text-sm outline-none bg-transparent" />
          <button onClick={() => setOpen(false)} className="text-xs text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">Esc</button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" role="listbox">
          {all.map((h, i) => {
            const head = h.group !== last; last = h.group;
            return (
              <li key={h.group + h.href + h.title + i} role="option" aria-selected={i === cur}>
                {head && <p className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h.group}</p>}
                <button onClick={() => go(h)} onMouseEnter={() => setCur(i)} className={`w-full text-left px-4 py-2 flex items-center gap-3 ${i === cur ? "bg-sky-50" : ""}`}>
                  <span className="w-6 text-center" aria-hidden>{h.icon}</span>
                  <span className="flex-1 min-w-0"><span className="block text-sm text-slate-900 truncate">{h.title}</span>{h.sub && <span className="block text-xs text-slate-500 truncate">{h.sub}</span>}</span>
                </button>
              </li>
            );
          })}
          {!all.length && <li className="px-4 py-8 text-center text-sm text-slate-500">{busy ? "Searching…" : term.length < 2 ? "Type at least 2 letters or digits." : "Nothing found. Try a name, a phone number or a bill number."}</li>}
        </ul>
        <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">↑↓ to move · Enter to open · Ctrl+K or / to search from anywhere</p>
      </div>
    </div>
  );
}
