"use client";

import { useMemo, useState } from "react";

export interface Mat { item: string; qty: string }
export interface StockOpt { name: string; quantity: number; unit?: string | null }

/** Equipment and materials used in a sitting: search the stock (gloves, injection…), pick it, set how many. Taken off the stock when the sitting is completed. */
export default function EquipmentPicker({ stock, value, onChange, disabled }: { stock: StockOpt[]; value: Mat[]; onChange: (m: Mat[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const byName = useMemo(() => new Map(stock.map((s) => [s.name.toLowerCase(), s])), [stock]);
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => (term ? stock.filter((s) => s.name.toLowerCase().includes(term) && !value.some((v) => v.item.toLowerCase() === s.name.toLowerCase())).slice(0, 8) : []), [stock, term, value]);
  const exact = term && stock.some((s) => s.name.toLowerCase() === term);

  function add(name: string) {
    if (!name.trim() || value.some((v) => v.item.toLowerCase() === name.trim().toLowerCase())) return;
    onChange([...value, { item: name.trim(), qty: "1" }]); setQ(""); setOpen(false);
  }
  const set = (i: number, qty: string) => onChange(value.map((m, j) => (j === i ? { ...m, qty } : m)));

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700"><span aria-hidden>🧰</span> Equipment used <span className="font-normal text-slate-400">· taken off the stock when the sitting is completed</span></p>
        {!disabled && <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="shrink-0 px-3 py-2 rounded-xl border border-sky-300 text-sky-800 text-sm font-semibold hover:bg-sky-50">+ Add equipment</button>}
      </div>

      {open && !disabled && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2">
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stock, e.g. gloves, injection" aria-label="Search equipment" className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <ul className="mt-1 max-h-56 overflow-y-auto" aria-label="Matching stock">
            {hits.map((s) => (
              <li key={s.name}><button type="button" onClick={() => add(s.name)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-sky-50">
                <span className="font-medium text-slate-800">{s.name}</span><span className={`text-xs ${s.quantity <= 0 ? "text-red-600" : "text-slate-500"}`}>{s.quantity} {s.unit ?? "in stock"}{s.unit ? " in stock" : ""}</span></button></li>
            ))}
            {term && !exact && <li><button type="button" onClick={() => add(q)} className="w-full px-3 py-2.5 rounded-lg text-left text-sm text-slate-600 hover:bg-slate-50">Add “{q.trim()}” (not in your stock list)</button></li>}
            {!term && <li className="px-3 py-2 text-xs text-slate-400">Type to search your stock.</li>}
            {term && !hits.length && exact && <li className="px-3 py-2 text-xs text-slate-400">Already added.</li>}
          </ul>
        </div>
      )}

      <ul className="mt-2 space-y-2">
        {value.map((m, i) => {
          const s = byName.get(m.item.toLowerCase()), n = Number(m.qty) || 0, short = s && n > s.quantity;
          return (
            <li key={m.item + i} className="flex items-center gap-2">
              <span aria-hidden className="w-9 h-9 shrink-0 rounded-lg bg-sky-50 flex items-center justify-center">🧤</span>
              <span className="flex-1 min-w-0"><span className="block font-medium text-slate-800 truncate">{m.item}</span>
                {short ? <span className="block text-xs text-amber-700">Only {s!.quantity} in stock</span> : !s ? <span className="block text-xs text-slate-400">Not in your stock list</span> : <span className="block text-xs text-slate-400">{s.quantity} in stock</span>}</span>
              <input aria-label={`Quantity of ${m.item}`} type="number" min={1} inputMode="numeric" disabled={disabled} value={m.qty} onChange={(e) => set(i, e.target.value)} className="w-20 shrink-0 px-3 py-2.5 rounded-xl border border-slate-200 text-base sm:text-sm" />
              {!disabled && <button type="button" aria-label={`Remove ${m.item}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="w-10 h-10 shrink-0 text-red-500 text-xl rounded-lg hover:bg-red-50">×</button>}
            </li>
          );
        })}
        {!value.length && <li className="text-xs text-slate-400">None added.</li>}
      </ul>
    </div>
  );
}
