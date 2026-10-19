"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setSetupFlag } from "@/lib/setup";

interface Row { id: string; name: string; category: string; price: number; is_active: boolean }

/** The clinic's own price list. Starts with defaults for the chosen specialty; admins edit it freely. */
export default function PriceListEditor({ clinicId, canEdit }: { clinicId: string | null; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (!clinicId) return;
    const { data } = await supabase.from("price_list").select("id,name,category,price,is_active").eq("clinic_id", clinicId).order("category").order("name");
    setRows((data as Row[]) ?? []);
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  async function savePrice(r: Row, v: string) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) { setErr("Enter a price of zero or more."); load(); return; }
    setErr("");
    const { error } = await supabase.from("price_list").update({ price: n }).eq("id", r.id);
    if (error) setErr(error.message); else if (clinicId) setSetupFlag(clinicId, "prices_reviewed", true);
    load();
  }
  async function add() {
    if (!clinicId || !name.trim()) return setErr("Give the item a name.");
    const n = Number(price);
    if (!Number.isFinite(n) || n < 0) return setErr("Enter a price of zero or more.");
    setErr("");
    const { error } = await supabase.from("price_list").insert({ clinic_id: clinicId, name: name.trim(), price: n, category: "procedure" });
    if (error) return setErr(error.code === "23505" ? "That item already exists." : error.message);
    setName(""); setPrice(""); load();
  }
  async function remove(r: Row) { await supabase.from("price_list").delete().eq("id", r.id); load(); }

  if (!clinicId) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mt-6">
      <h2 className="font-semibold mb-1 text-sm uppercase tracking-wide text-slate-500">Price list</h2>
      <p className="text-xs text-slate-500 mb-4">Used when you build invoices and treatment plans. Edit a price and press Tab or click away to save.</p>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 py-2">
            <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{r.name}</span>
            <span className="text-slate-400 text-sm">₹</span>
            <input aria-label={`Price for ${r.name}`} defaultValue={r.price} disabled={!canEdit} inputMode="decimal"
              onBlur={(e) => Number(e.target.value) !== Number(r.price) && savePrice(r, e.target.value)}
              className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-right tabular-nums disabled:bg-slate-50" />
            {canEdit && <button onClick={() => remove(r)} className="text-xs text-red-600 hover:underline" aria-label={`Remove ${r.name}`}>Remove</button>}
          </div>
        ))}
        {rows.length === 0 && <p className="text-sm text-slate-500 py-3">No items yet.</p>}
      </div>
      {canEdit && (
        <div className="mt-4 flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New item, e.g. Teeth whitening" className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price" inputMode="decimal" className="w-28 px-3 py-2 rounded-lg border border-slate-200 text-sm" />
          <button onClick={add} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">Add</button>
        </div>
      )}
      {err && <p className="text-xs text-red-600 mt-2" role="alert">{err}</p>}
    </div>
  );
}
