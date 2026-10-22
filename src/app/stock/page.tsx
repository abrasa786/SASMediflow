"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { getStockItems, upsertStockItem } from "@/lib/clinic";
import type { StockItem, StockCategory } from "@/types";

const CATEGORIES: StockCategory[] = ["medicine", "consumable", "equipment", "lab_supply", "other"];

const CATEGORY_COLORS: Record<string, string> = {
  medicine:   "bg-blue-100 text-blue-700",
  consumable: "bg-purple-100 text-purple-700",
  equipment:  "bg-indigo-100 text-indigo-700",
  lab_supply: "bg-teal-100 text-teal-700",
  other:      "bg-gray-100 text-gray-600",
};

const EMPTY: Partial<StockItem> = {
  name: "", category: "medicine", quantity: 0, min_quantity: 5, unit: "pcs",
  unit_price: 0, supplier: "", expiry_date: "",
};

export default function StockPage() {
  const router = useRouter();
  const [items, setItems] = useState<StockItem[]>([]);
  const [filtered, setFiltered] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicId] = useState("");
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Partial<StockItem>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    load(id);
  }, [router]);

  async function load(id: string) {
    setLoading(true);
    const data = await getStockItems(id);
    setItems(data);
    setLoading(false);
  }

  useEffect(() => {
    let result = items;
    if (search) result = result.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
    if (catFilter !== "all") result = result.filter(i => i.category === catFilter);
    if (showLowOnly) result = result.filter(i => i.quantity <= (i.min_quantity ?? 0));
    setFiltered(result);
  }, [items, search, catFilter, showLowOnly]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing.name?.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr("");
    const { error } = await upsertStockItem(clinicId, editing);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setShowForm(false);
    setEditing(EMPTY);
    load(clinicId);
  }

  const lowCount = items.filter(i => i.quantity <= (i.min_quantity ?? 0)).length;
  const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Stock</h1>
            <p className="text-slate-500 text-sm mt-1">{items.length} items tracked</p>
          </div>
          <div className="flex gap-2">
          <a href="/purchasing" className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-300 hover:bg-slate-50">Purchase orders</a>
          <button onClick={() => { setEditing(EMPTY); setShowForm(true); setErr(""); }} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            + Add Item
          </button>
          </div>
        </div>

        {/* Low stock alert */}
        {lowCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-amber-600">⚠️</span>
              <p className="text-amber-800 text-sm font-medium">{lowCount} item{lowCount > 1 ? "s" : ""} running low or out of stock</p>
            </div>
            <button onClick={() => setShowLowOnly(!showLowOnly)} className={`text-xs font-semibold px-3 py-1 rounded-lg ${showLowOnly ? "bg-amber-600 text-white" : "border border-amber-400 text-amber-700"}`}>
              {showLowOnly ? "Show All" : "Show Low"}
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <div className="flex gap-2 overflow-x-auto">
            {["all", ...CATEGORIES].map(c => (
              <button key={c} onClick={() => setCatFilter(c)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${catFilter === c ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
                {c === "all" ? "All" : c.replace("_", " ").replace(/\b\w/g, ch => ch.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm"><div className="text-4xl mb-3">📦</div>No items found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Item</th>
                    <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Category</th>
                    <th className="px-5 py-3 text-right font-medium">Stock</th>
                    <th className="px-5 py-3 text-right font-medium hidden md:table-cell">Min</th>
                    <th className="px-5 py-3 text-left font-medium hidden lg:table-cell">Supplier</th>
                    <th className="px-5 py-3 text-left font-medium hidden lg:table-cell">Expiry</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map(item => {
                    const low = item.quantity <= (item.min_quantity ?? 0);
                    const out = item.quantity === 0;
                    return (
                      <tr key={item.id} onClick={(e) => { if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return; router.push(`/stock/${item.id}`); }} className={`hover:bg-slate-50 cursor-pointer ${low ? "bg-amber-50/50" : ""}`}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-400">{item.unit}</p>
                        </td>
                        <td className="px-5 py-3 hidden md:table-cell">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${CATEGORY_COLORS[item.category ?? "other"]}`}>{(item.category ?? "other").replace("_", " ")}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className={`font-bold text-sm ${out ? "text-red-600" : low ? "text-amber-600" : "text-slate-900"}`}>{item.quantity}</span>
                          {out && <span className="ml-1 text-xs text-red-500 font-medium">OUT</span>}
                          {!out && low && <span className="ml-1 text-xs text-amber-500 font-medium">LOW</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-slate-500 text-xs hidden md:table-cell">{item.min_quantity}</td>
                        <td className="px-5 py-3 text-slate-500 text-xs hidden lg:table-cell">{item.supplier || "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-xs hidden lg:table-cell">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString("en-IN") : "—"}</td>
                        <td className="px-5 py-3">
                          <button onClick={() => { setEditing(item); setShowForm(true); setErr(""); }} className="text-sky-500 hover:text-sky-700 text-xs font-medium">Edit</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Stock form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl my-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-900">{editing.id ? "Edit Stock Item" : "Add Stock Item"}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 text-xl">×</button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Name *</label>
                <input value={editing.name ?? ""} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} className={inp} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Category</label>
                  <select value={editing.category ?? "medicine"} onChange={e => setEditing(p => ({ ...p, category: e.target.value as StockCategory }))} className={inp}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Unit</label>
                  <input value={editing.unit ?? ""} onChange={e => setEditing(p => ({ ...p, unit: e.target.value }))} className={inp} placeholder="e.g. pcs, ml, box" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Current Qty *</label>
                  <input type="number" value={editing.quantity ?? 0} onChange={e => setEditing(p => ({ ...p, quantity: Number(e.target.value) }))} className={inp} min={0} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Min Qty</label>
                  <input type="number" value={editing.min_quantity ?? 5} onChange={e => setEditing(p => ({ ...p, min_quantity: Number(e.target.value) }))} className={inp} min={0} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Unit Price ₹</label>
                  <input type="number" value={editing.unit_price ?? 0} onChange={e => setEditing(p => ({ ...p, unit_price: Number(e.target.value) }))} className={inp} min={0} step={0.01} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Expiry Date</label>
                  <input type="date" value={editing.expiry_date ?? ""} onChange={e => setEditing(p => ({ ...p, expiry_date: e.target.value }))} className={inp} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Supplier</label>
                <input value={editing.supplier ?? ""} onChange={e => setEditing(p => ({ ...p, supplier: e.target.value }))} className={inp} placeholder="Supplier name" />
              </div>
              {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              <button type="submit" disabled={saving} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                {saving ? "Saving…" : "Save Item"}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
