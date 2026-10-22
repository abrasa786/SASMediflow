"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import Modal from "@/components/Modal";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { getMyRoleInClinic } from "@/lib/clinic";
import type { ClinicRole } from "@/types";
import { inr, todayIso, dayLabel as day } from "@/lib/format";
import { inputCls as inp, labelCls as lbl } from "@/components/ui";

const supabase = sb as any;
const STATUS: Record<string, string> = { ordered: "bg-sky-100 text-sky-700", partially_received: "bg-amber-100 text-amber-800", received: "bg-emerald-100 text-emerald-700", cancelled: "bg-slate-100 text-slate-500", draft: "bg-slate-100 text-slate-600", unpaid: "bg-red-100 text-red-700", partial: "bg-amber-100 text-amber-800", paid: "bg-emerald-100 text-emerald-700" };

interface Supplier { id: string; name: string; contact_name?: string; phone?: string; email?: string; address?: string; gstin?: string; payment_terms_days: number; notes?: string }
interface Item { id: string; po_id: string; stock_item_id: string | null; name: string; unit: string; qty_ordered: number; qty_received: number; unit_price: number; gst_percent: number }
interface PO { id: string; po_number: string; status: string; order_date: string; expected_date?: string; total: number; subtotal: number; gst_amount: number; suppliers?: { name: string }; purchase_order_items: Item[] }
interface Bill { id: string; bill_number?: string; bill_date: string; due_date?: string; amount: number; paid_amount: number; status: string; suppliers?: { name: string }; purchase_orders?: { po_number: string } | null }
interface Stock { id: string; name: string; unit: string; quantity: number; min_quantity: number; unit_price: number }

export default function PurchasingPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [role, setRole] = useState<ClinicRole | null>(null);
  const [tab, setTab] = useState<"orders" | "suppliers" | "bills">(() => { try { const t = new URLSearchParams(window.location.search).get("tab"); return t === "suppliers" || t === "bills" ? t : "orders"; } catch { return "orders"; } });
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<PO[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState<string[] | null>(null);
  const [newPo, setNewPo] = useState<{ prefill?: boolean } | null>(null);
  const [recv, setRecv] = useState<PO | null>(null);
  const [supEdit, setSupEdit] = useState<Partial<Supplier> | null>(null);
  const [pay, setPay] = useState<Bill | null>(null);

  const load = useCallback(async (id: string) => {
    const [s, o, b, st] = await Promise.all([
      supabase.from("suppliers").select("*").eq("clinic_id", id).eq("is_active", true).order("name"),
      supabase.from("purchase_orders").select("*, suppliers(name), purchase_order_items(*)").eq("clinic_id", id).order("created_at", { ascending: false }).limit(100),
      supabase.from("supplier_bills").select("*, suppliers(name), purchase_orders(po_number)").eq("clinic_id", id).order("bill_date", { ascending: false }).limit(200),
      supabase.from("stock_items").select("id,name,unit,quantity,min_quantity,unit_price").eq("clinic_id", id).order("name"),
    ]);
    const first = [s, o, b, st].find((r) => r.error);
    if (first) setErr(/relation .* does not exist|schema cache/i.test(first.error.message) ? "Purchasing tables are not installed yet. Run supabase/migrations/006_purchasing_attendance_leave.sql in the Supabase SQL editor." : first.error.message);
    setSuppliers(s.data ?? []); setOrders(o.data ?? []); setBills(b.data ?? []); setStock(st.data ?? []); setLoading(false);
  }, []);

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    getMyRoleInClinic(id).then((r) => setRole(r as ClinicRole));
    load(id);
  }, [router, load]);

  const payable = bills.reduce((n, b) => n + (Number(b.amount) - Number(b.paid_amount)), 0);
  const overdue = bills.filter((b) => b.status !== "paid" && b.due_date && b.due_date < todayIso());
  const open = orders.filter((o) => o.status === "ordered" || o.status === "partially_received").length;
  const low = stock.filter((s) => s.quantity < s.min_quantity).length;
  const canBuy = role === "admin" || role === "nurse" || role === "receptionist";

  if (role && !canBuy) return <AppShell><div className="p-6"><p className="text-slate-600">Purchasing is available to the admin, nurses and receptionists.</p></div></AppShell>;

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <p className="text-sm"><Link href="/stock" className="text-sky-700 hover:underline">← Stock</Link></p>
            <h1 className="text-2xl font-bold text-slate-900">Purchasing</h1>
            <p className="text-slate-500 text-sm mt-1">Order from suppliers, receive stock, and keep track of what you owe.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setNewPo({})} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">+ New purchase order</button>
          </div>
        </div>
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[["Open orders", String(open)], ["Items below minimum", String(low)], ["You owe suppliers", inr(payable)], ["Overdue bills", String(overdue.length)]].map(([k, v], i) => (
            <div key={k} className={`rounded-xl border p-4 ${i === 3 && overdue.length ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
              <p className="text-xs text-slate-500">{k}</p><p className="text-xl font-bold text-slate-900 mt-0.5 tabular-nums">{v}</p>
            </div>
          ))}
        </div>

        {notice && <div className="mb-5 rounded-xl px-4 py-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-900" role="status">{notice.map((l, i) => <p key={i}>{l}</p>)}<button className="mt-1.5 text-xs underline" onClick={() => setNotice(null)}>Dismiss</button></div>}

        <div className="flex gap-1 border-b border-slate-200 mb-5" role="tablist">
          {([["orders", `Orders (${orders.length})`], ["suppliers", `Suppliers (${suppliers.length})`], ["bills", `Bills (${bills.length})`]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === k ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{l}</button>
          ))}
        </div>

        {loading ? <p className="text-sm text-slate-400">Loading…</p> : tab === "orders" ? (
          orders.length === 0 ? <Empty icon="📦" title="No purchase orders yet" text={suppliers.length ? "Create one to order stock. When it arrives, receive it and your stock goes up automatically." : "Add a supplier first, then create your first order."} action={suppliers.length ? "Create an order" : "Add a supplier"} onAction={() => suppliers.length ? setNewPo({}) : (setTab("suppliers"), setSupEdit({}))} />
          : <div className="space-y-3">{orders.map((o) => (
            <div key={o.id} onClick={(e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("button, a, input, select")) return; router.push(`/purchasing/orders/${o.id}`); }} className="bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:border-sky-300">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-semibold text-slate-900">{o.po_number} <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${STATUS[o.status]}`}>{o.status.replace("_", " ")}</span></p>
                  <p className="text-sm text-slate-500">{o.suppliers?.name} · ordered {day(o.order_date)}{o.expected_date ? ` · expected ${day(o.expected_date)}` : ""}</p></div>
                <p className="font-semibold tabular-nums">{inr(o.total)}</p>
              </div>
              <ul className="mt-2 text-sm text-slate-600 grid sm:grid-cols-2 gap-x-6">{o.purchase_order_items.map((i) => <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{i.name}</span><span className="tabular-nums text-slate-500">{i.qty_received}/{i.qty_ordered} {i.unit}</span></li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {(o.status === "ordered" || o.status === "partially_received") && <button onClick={() => setRecv(o)} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold">Receive goods</button>}
                <Link href={`/purchasing/print?id=${o.id}`} target="_blank" className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold">Print / PDF</Link>
                {o.status === "ordered" && o.purchase_order_items.every((i) => i.qty_received === 0) && <button onClick={async () => { try { await authFetch("/api/purchasing/order", { body: { clinicId, action: "cancel", poId: o.id } }); load(clinicId!); } catch (e: any) { setErr(e.message); } }} className="px-3 py-1.5 rounded-lg text-red-600 hover:bg-red-50 text-xs font-semibold">Cancel order</button>}
              </div>
            </div>))}</div>
        ) : tab === "suppliers" ? (
          <div>
            <button onClick={() => setSupEdit({})} className="mb-4 px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold hover:bg-slate-50">+ Add supplier</button>
            {suppliers.length === 0 ? <Empty icon="🏷️" title="No suppliers yet" text="Add the companies you buy from, with their GSTIN and payment terms." /> :
              <div className="grid md:grid-cols-2 gap-3">{suppliers.map((s) => (
                <div key={s.id} onClick={(e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("button, a, input, select")) return; router.push(`/purchasing/suppliers/${s.id}`); }} className="bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:border-sky-300">
                  <p className="font-semibold text-slate-900">{s.name}</p>
                  <p className="text-sm text-slate-500">{[s.contact_name, s.phone].filter(Boolean).join(" · ") || "No contact yet"}</p>
                  <p className="text-xs text-slate-400 mt-1">{s.gstin ? `GSTIN ${s.gstin} · ` : ""}{s.payment_terms_days ? `Pay within ${s.payment_terms_days} days` : "Pay on delivery"}</p>
                  <button onClick={() => setSupEdit(s)} className="mt-2 text-sm text-sky-700 hover:underline">Edit</button>
                </div>))}</div>}
          </div>
        ) : (
          bills.length === 0 ? <Empty icon="🧾" title="No supplier bills yet" text="A bill is created each time you receive goods against an order." /> :
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50"><th className="px-4 py-2 font-medium">Supplier</th><th className="px-2 py-2 font-medium">Bill / PO</th><th className="px-2 py-2 font-medium">Due</th><th className="px-2 py-2 font-medium text-right">Amount</th><th className="px-2 py-2 font-medium text-right">Paid</th><th className="px-2 py-2 font-medium">Status</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{bills.map((b) => { const late = b.status !== "paid" && b.due_date && b.due_date < todayIso(); return (
              <tr key={b.id} onClick={(e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("button, a, input, select")) return; router.push(`/purchasing/bills/${b.id}`); }} className="cursor-pointer hover:bg-slate-50"><td className="px-4 py-3 font-medium text-slate-800">{b.suppliers?.name}</td>
                <td className="px-2 py-3 text-slate-600">{b.bill_number || "–"}<span className="block text-xs text-slate-400">{b.purchase_orders?.po_number}</span></td>
                <td className={`px-2 py-3 ${late ? "text-red-700 font-medium" : "text-slate-600"}`}>{day(b.due_date)}{late ? " · overdue" : ""}</td>
                <td className="px-2 py-3 text-right tabular-nums">{inr(b.amount)}</td><td className="px-2 py-3 text-right tabular-nums">{inr(b.paid_amount)}</td>
                <td className="px-2 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[b.status]}`}>{b.status}</span></td>
                <td className="px-4 py-3 text-right">{b.status !== "paid" && role === "admin" && <button onClick={() => setPay(b)} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold">Pay</button>}</td></tr>); })}</tbody></table></div>
        )}
      </div>

      {newPo && clinicId && <NewPoModal clinicId={clinicId} suppliers={suppliers} stock={stock} onClose={() => setNewPo(null)} onAddSupplier={() => { setNewPo(null); setTab("suppliers"); setSupEdit({}); }}
        onDone={(l) => { setNewPo(null); setNotice(l); load(clinicId); }} />}
      {recv && clinicId && <ReceiveModal clinicId={clinicId} po={recv} onClose={() => setRecv(null)} onDone={(l) => { setRecv(null); setNotice(l); load(clinicId); }} />}
      {supEdit && clinicId && <SupplierModal clinicId={clinicId} s={supEdit} onClose={() => setSupEdit(null)} onDone={() => { setSupEdit(null); load(clinicId); }} />}
      {pay && clinicId && <PayBillModal clinicId={clinicId} b={pay} onClose={() => setPay(null)} onDone={(l) => { setPay(null); setNotice(l); load(clinicId); }} />}
    </AppShell>
  );
}

function Empty({ icon, title, text, action, onAction }: { icon: string; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center"><p className="text-3xl mb-2">{icon}</p><p className="font-semibold text-slate-800">{title}</p><p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{text}</p>{action && <button onClick={onAction} className="mt-4 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">{action}</button>}</div>;
}

interface Line { stock_item_id: string; name: string; unit: string; qty: string; unit_price: string; gst_percent: string }
const blank = (): Line => ({ stock_item_id: "", name: "", unit: "pcs", qty: "", unit_price: "", gst_percent: "12" });

function NewPoModal({ clinicId, suppliers, stock, onClose, onDone, onAddSupplier }: { clinicId: string; suppliers: Supplier[]; stock: Stock[]; onClose: () => void; onDone: (l: string[]) => void; onAddSupplier: () => void }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [expected, setExpected] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
  function pick(i: number, id: string) {
    const s = stock.find((x) => x.id === id);
    setLines(lines.map((l, j) => j === i ? (s ? { ...l, stock_item_id: id, name: s.name, unit: s.unit ?? "pcs", unit_price: l.unit_price || String(s.unit_price || "") } : { ...l, stock_item_id: "" }) : l));
  }
  function suggest() {
    const need = stock.filter((s) => s.quantity < s.min_quantity).map((s) => ({ stock_item_id: s.id, name: s.name, unit: s.unit ?? "pcs", qty: String(Math.max(s.min_quantity * 2 - s.quantity, 1)), unit_price: String(s.unit_price || ""), gst_percent: "12" }));
    if (need.length) setLines(need); else setErr("Nothing is below its minimum right now.");
  }
  const totals = useMemo(() => lines.reduce((t, l) => { const q = Number(l.qty) || 0, p = Number(l.unit_price) || 0, g = Number(l.gst_percent) || 0; return { sub: t.sub + q * p, gst: t.gst + q * p * g / 100 }; }, { sub: 0, gst: 0 }), [lines]);
  async function submit() {
    setErr("");
    if (!supplierId) return setErr("Choose a supplier.");
    const used = lines.filter((l) => l.name.trim() || l.qty);
    if (!used.length) return setErr("Add at least one item.");
    for (const l of used) { if (!l.name.trim()) return setErr("Every line needs an item name."); if (!(Number(l.qty) >= 1) || !Number.isInteger(Number(l.qty))) return setErr(`Quantity for “${l.name}” must be a whole number, 1 or more.`); if (l.unit_price !== "" && Number(l.unit_price) < 0) return setErr("Prices cannot be negative."); }
    setBusy(true);
    try {
      const r = await authFetch("/api/purchasing/order", { body: { clinicId, action: "create", supplierId, expectedDate: expected || null, notes, items: used.map((l) => ({ stock_item_id: l.stock_item_id || null, name: l.name.trim(), unit: l.unit, qty: Number(l.qty), unit_price: Number(l.unit_price) || 0, gst_percent: Number(l.gst_percent) || 0 })) } });
      onDone([`${r.po_number} created for ${inr(r.total)} (${r.lines} item${r.lines > 1 ? "s" : ""}).`, "Open Print / PDF on the order to send it to the supplier."]);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={lbl}>Supplier</label>
            {suppliers.length ? <select className={inp} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              : <button type="button" onClick={onAddSupplier} className="text-sm text-sky-700 underline">Add a supplier first</button>}</div>
          <div><label className={lbl}>Expected delivery (optional)</label><input type="date" className={inp} min={todayIso()} value={expected} onChange={(e) => setExpected(e.target.value)} /></div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1"><label className={lbl}>Items</label><button type="button" onClick={suggest} className="text-xs text-sky-700 hover:underline">Fill with low-stock items</button></div>
          <div className="space-y-2">{lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_64px_28px] gap-2 items-center">
              <div><input list="stock-items" className={inp} placeholder="Item name" value={l.name} onChange={(e) => { const m = stock.find((s) => s.name.toLowerCase() === e.target.value.toLowerCase()); set(i, "name", e.target.value); if (m) pick(i, m.id); else set(i, "stock_item_id", ""); }} aria-label="Item" /></div>
              <input className={inp} inputMode="numeric" placeholder="Qty" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} aria-label="Quantity" />
              <input className={inp} inputMode="decimal" placeholder="₹ each" value={l.unit_price} onChange={(e) => set(i, "unit_price", e.target.value)} aria-label="Unit price" />
              <input className={inp} inputMode="decimal" placeholder="GST%" value={l.gst_percent} onChange={(e) => set(i, "gst_percent", e.target.value)} aria-label="GST percent" />
              <button type="button" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blank()])} className="text-slate-400 hover:text-red-600" aria-label="Remove line">×</button>
            </div>))}</div>
          <datalist id="stock-items">{stock.map((s) => <option key={s.id} value={s.name} />)}</datalist>
          <button type="button" onClick={() => setLines([...lines, blank()])} className="mt-2 text-sm text-sky-700 hover:underline">+ Add line</button>
          <p className="text-xs text-slate-400 mt-1">Pick an existing item to top up its stock, or type a new name and it will be added to your shelves when received.</p>
        </div>
        <div><label className={lbl}>Notes for the supplier (optional)</label><input className={inp} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm tabular-nums flex flex-wrap gap-x-6 gap-y-1 justify-end"><span>Subtotal {inr(totals.sub)}</span><span>GST {inr(totals.gst)}</span><span className="font-semibold">Total {inr(totals.sub + totals.gst)}</span></div>
        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={submit} disabled={busy} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Creating…" : "Create order"}</button></div>
      </div>
    </Modal>
  );
}

function ReceiveModal({ clinicId, po, onClose, onDone }: { clinicId: string; po: PO; onClose: () => void; onDone: (l: string[]) => void }) {
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(po.purchase_order_items.map((i) => [i.id, String(i.qty_ordered - i.qty_received)])));
  const [billNo, setBillNo] = useState(""); const [billDate, setBillDate] = useState(todayIso()); const [due, setDue] = useState("");
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function submit() {
    setErr("");
    const lines = po.purchase_order_items.map((i) => ({ item_id: i.id, qty: Number(qty[i.id] || 0), max: i.qty_ordered - i.qty_received, name: i.name }));
    const bad = lines.find((l) => !Number.isInteger(l.qty) || l.qty < 0 || l.qty > l.max);
    if (bad) return setErr(`“${bad.name}”: enter a whole number from 0 to ${bad.max}.`);
    if (!lines.some((l) => l.qty > 0)) return setErr("Enter the quantities that arrived.");
    setBusy(true);
    try {
      const r = await authFetch("/api/purchasing/order", { body: { clinicId, action: "receive", poId: po.id, lines: lines.map(({ item_id, qty }) => ({ item_id, qty })), billNumber: billNo, billDate, dueDate: due || null } });
      onDone([`Stock updated: ${r.stock.map((s: any) => `${s.name} +${s.added} (now ${s.now})`).join(", ")}.`, `Supplier bill of ${inr(r.bill_amount)} recorded. ${r.po_status === "received" ? "Order fully received." : "Some items are still to come."}`]);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={`Receive goods · ${po.po_number}`} onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">Enter what actually arrived. Stock goes up by those amounts. If only part came, receive the rest later.</p>
      <div className="space-y-2">{po.purchase_order_items.map((i) => (
        <div key={i.id} className="flex items-center gap-3"><span className="flex-1 min-w-0 truncate text-sm">{i.name}<span className="text-xs text-slate-400 ml-1">({i.qty_received}/{i.qty_ordered} so far)</span></span>
          <input className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm text-right" inputMode="numeric" value={qty[i.id]} disabled={i.qty_received >= i.qty_ordered} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Received ${i.name}`} /></div>))}</div>
      <div className="grid sm:grid-cols-3 gap-3 mt-4">
        <div><label className={lbl}>Supplier invoice no.</label><input className={inp} value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder="optional" /></div>
        <div><label className={lbl}>Invoice date</label><input type="date" className={inp} value={billDate} max={todayIso()} onChange={(e) => setBillDate(e.target.value)} /></div>
        <div><label className={lbl}>Due date</label><input type="date" className={inp} value={due} onChange={(e) => setDue(e.target.value)} /></div>
      </div>
      <p className="text-xs text-slate-400 mt-1">Leave the due date empty to use the supplier&apos;s payment terms.</p>
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-3" role="alert">{err}</p>}
      <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={submit} disabled={busy} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Saving…" : "Add to stock"}</button></div>
    </Modal>
  );
}

function SupplierModal({ clinicId, s, onClose, onDone }: { clinicId: string; s: Partial<Supplier>; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: s.name ?? "", contact_name: s.contact_name ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", gstin: s.gstin ?? "", payment_terms_days: String(s.payment_terms_days ?? 0), notes: s.notes ?? "" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const k = (key: keyof typeof f) => ({ value: f[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [key]: e.target.value }), className: inp });
  async function save() { setErr(""); setBusy(true); try { await authFetch("/api/purchasing/supplier", { body: { clinicId, id: s.id, supplier: { ...f, payment_terms_days: Number(f.payment_terms_days) } } }); onDone(); } catch (e: any) { setErr(e.message); setBusy(false); } }
  async function archive() { setBusy(true); try { await authFetch("/api/purchasing/supplier", { body: { clinicId, id: s.id, action: "archive" } }); onDone(); } catch (e: any) { setErr(e.message); setBusy(false); } }
  return (
    <Modal title={s.id ? "Edit supplier" : "Add supplier"} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={lbl}>Company name *</label><input {...k("name")} /></div>
        <div><label className={lbl}>Contact person</label><input {...k("contact_name")} /></div>
        <div><label className={lbl}>Phone</label><input {...k("phone")} inputMode="tel" /></div>
        <div><label className={lbl}>Email</label><input {...k("email")} type="email" /></div>
        <div><label className={lbl}>GSTIN</label><input {...k("gstin")} placeholder="22ABCDE1234F1Z5" /></div>
        <div className="sm:col-span-2"><label className={lbl}>Address</label><input {...k("address")} /></div>
        <div><label className={lbl}>Payment terms (days)</label><input {...k("payment_terms_days")} inputMode="numeric" /></div>
        <div><label className={lbl}>Notes</label><input {...k("notes")} /></div>
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-3" role="alert">{err}</p>}
      <div className="flex justify-between gap-2 mt-4"><div>{s.id && <button onClick={archive} className="text-sm text-red-600 hover:underline">Remove supplier</button>}</div>
        <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">Save</button></div></div>
    </Modal>
  );
}

function PayBillModal({ clinicId, b, onClose, onDone }: { clinicId: string; b: Bill; onClose: () => void; onDone: (l: string[]) => void }) {
  const bal = Number(b.amount) - Number(b.paid_amount);
  const [amount, setAmount] = useState(String(bal)); const [method, setMethod] = useState("bank"); const [ref, setRef] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function pay() {
    setErr(""); const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setErr("Enter an amount above zero.");
    if (n > bal + 0.001) return setErr(`That is more than the balance (${inr(bal)}).`);
    setBusy(true);
    try { const r = await authFetch("/api/purchasing/bill", { body: { clinicId, billId: b.id, amount: n, method, reference: ref } }); onDone([`${inr(r.paid_now)} paid to ${b.suppliers?.name}. Balance ${inr(r.balance)}.`]); } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={`Pay ${b.suppliers?.name}`} onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">Balance on this bill: <b>{inr(bal)}</b>. You can pay part now.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Amount (₹)</label><input className={inp} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className={lbl}>Method</label><select className={inp} value={method} onChange={(e) => setMethod(e.target.value)}>{["bank", "upi", "cash", "cheque", "card", "other"].map((m) => <option key={m}>{m}</option>)}</select></div>
        <div className="col-span-2"><label className={lbl}>Reference (UTR / cheque no.)</label><input className={inp} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-3" role="alert">{err}</p>}
      <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={pay} disabled={busy} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Saving…" : "Record payment"}</button></div>
    </Modal>
  );
}
