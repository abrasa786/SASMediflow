"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getInvoices, createInvoice, updateInvoice, searchClinicPatients } from "@/lib/clinic";
import type { Invoice, ClinicPatient, InvoiceStatus, PaymentMethod } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  draft:          "bg-gray-100 text-gray-600",
  sent:           "bg-sky-100 text-sky-700",
  paid:           "bg-emerald-100 text-emerald-700",
  partially_paid: "bg-amber-100 text-amber-700",
  cancelled:      "bg-red-100 text-red-700",
};

interface LineItem { name: string; qty: number; unit_price: number; amount: number }

export default function BillingPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicId] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<ClinicPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<ClinicPatient | null>(null);
  const [items, setItems] = useState<LineItem[]>([{ name: "", qty: 1, unit_price: 0, amount: 0 }]);
  const [gst, setGst] = useState(18);
  const [discount, setDiscount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [status, setStatus] = useState<InvoiceStatus>("paid");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState(() => { try { const f = new URLSearchParams(window.location.search).get("filter"); return f && ["pending", "paid", "draft", "sent", "partially_paid", "cancelled"].includes(f) ? f : "all"; } catch { return "all"; } });

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    load(id);
  }, [router]);

  async function load(id: string) {
    setLoading(true);
    const data = await getInvoices(id, 100);
    setInvoices(data);
    setLoading(false);
  }

  async function handleSearch(q: string) {
    setPatientSearch(q);
    if (q.length < 2) { setPatientResults([]); return; }
    const r = await searchClinicPatients(clinicId, q);
    setPatientResults(r);
  }

  function updateItem(i: number, field: keyof LineItem, val: string | number) {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: val };
      if (field === "qty" || field === "unit_price") {
        updated.amount = Number(updated.qty) * Number(updated.unit_price);
      }
      return updated;
    }));
  }

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const gstAmt = Math.round(subtotal * gst / 100);
  const total = subtotal - discount + gstAmt;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient) { setErr("Select a patient"); return; }
    if (items.some(i => !i.name.trim())) { setErr("Fill all item names"); return; }
    setSaving(true); setErr("");
    const { error } = await createInvoice({
      clinic_id: clinicId,
      clinic_patient_id: selectedPatient.id,
      items, subtotal, discount, gst_percent: gst, gst_amount: gstAmt, total,
      status, paid_amount: status === "paid" ? total : status === "partially_paid" ? Math.round(total / 2) : 0,
      payment_method: payMethod,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setShowNew(false);
    resetForm();
    runFlows();
    load(clinicId);
  }

  function resetForm() {
    setSelectedPatient(null); setPatientSearch(""); setPatientResults([]);
    setItems([{ name: "", qty: 1, unit_price: 0, amount: 0 }]);
    setGst(18); setDiscount(0); setPayMethod("cash"); setStatus("paid"); setErr("");
  }

  async function markPaid(inv: Invoice) {
    await updateInvoice(inv.id, { status: "paid", paid_amount: inv.total });
    runFlows();
    load(clinicId);
  }

  /** Tell the server a payment happened so any flow waiting for it (a thank-you, a task) runs now. */
  function runFlows() { authFetch("/api/flows/process", { body: { clinicId } }).catch(() => null); }

  const filtered = filter === "all" ? invoices : filter === "pending" ? invoices.filter(i => ["sent", "partially_paid", "draft"].includes(i.status ?? "")) : invoices.filter(i => i.status === filter);
  const totalRevenue = invoices.filter(i => ["paid", "partially_paid"].includes(i.status ?? "")).reduce((s, i) => s + (i.total ?? 0), 0);

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Billing</h1>
            <p className="text-slate-500 text-sm mt-1">Total collected: <strong className="text-emerald-600">₹{totalRevenue.toLocaleString("en-IN")}</strong></p>
          </div>
          <button onClick={() => setShowNew(true)} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            + New Invoice
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
          {["all","pending","draft","sent","paid","partially_paid","cancelled"].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filter === f ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "all" ? "All" : f.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase())}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm"><div className="text-4xl mb-3">🧾</div>No invoices</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">Invoice #</th>
                    <th className="px-5 py-3 text-left font-medium">Patient</th>
                    <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Date</th>
                    <th className="px-5 py-3 text-right font-medium">Total</th>
                    <th className="px-5 py-3 text-left font-medium">Status</th>
                    <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Method</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">{inv.invoice_number ?? "—"}</td>
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{(inv as any).clinic_patients?.name ?? inv.patient?.name ?? "—"}</p>
                        <p className="text-xs text-slate-400">{(inv as any).clinic_patients?.phone ?? inv.patient?.phone ?? ""}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-500 hidden md:table-cell text-xs">{inv.created_at ? new Date(inv.created_at).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="px-5 py-3 text-right font-semibold text-slate-900">₹{(inv.total ?? 0).toLocaleString("en-IN")}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[inv.status ?? "draft"]}`}>
                          {(inv.status ?? "draft").replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-xs hidden md:table-cell capitalize">{inv.payment_method ?? "—"}</td>
                      <td className="px-5 py-3">
                        <a href={`/billing/print?id=${inv.id}`} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline font-medium mr-3">Print</a>
                        {inv.status !== "paid" && inv.status !== "cancelled" && (
                          <button onClick={() => markPaid(inv)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Mark paid</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New invoice modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => { setShowNew(false); resetForm(); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl my-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-900">New Invoice</h2>
              <button onClick={() => { setShowNew(false); resetForm(); }} className="text-slate-400 text-xl">×</button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Patient */}
              <div className="relative">
                <label className="text-xs font-medium text-slate-600 block mb-1">Patient *</label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
                    <div><p className="text-sm font-medium text-sky-800">{selectedPatient.name}</p><p className="text-xs text-sky-600">{selectedPatient.phone}</p></div>
                    <button type="button" onClick={() => { setSelectedPatient(null); setPatientSearch(""); }} className="text-sky-400 hover:text-red-500">×</button>
                  </div>
                ) : (
                  <>
                    <input value={patientSearch} onChange={e => handleSearch(e.target.value)} placeholder="Search patient…" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    {patientResults.length > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                        {patientResults.map(p => (
                          <button key={p.id} type="button" onClick={() => { setSelectedPatient(p); setPatientResults([]); }} className="w-full text-left px-4 py-3 text-sm hover:bg-sky-50 border-b border-slate-50 last:border-0">
                            <p className="font-medium">{p.name}</p><p className="text-xs text-slate-500">{p.phone}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Line items */}
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Items *</label>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1.5">
                      <input value={item.name} onChange={e => updateItem(i, "name", e.target.value)} placeholder="Description" className="col-span-5 px-2 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      <input type="number" value={item.qty} onChange={e => updateItem(i, "qty", Number(e.target.value))} min={1} className="col-span-2 px-2 py-2 rounded-lg border border-slate-200 text-xs text-center focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      <input type="number" value={item.unit_price} onChange={e => updateItem(i, "unit_price", Number(e.target.value))} placeholder="Price" className="col-span-3 px-2 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      <div className="col-span-1 flex items-center justify-center text-xs text-slate-500 font-medium">₹{item.amount}</div>
                      <button type="button" onClick={() => setItems(p => p.filter((_, idx) => idx !== i))} className="col-span-1 text-red-400 hover:text-red-600 text-sm">×</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setItems(p => [...p, { name: "", qty: 1, unit_price: 0, amount: 0 }])} className="mt-2 text-xs text-sky-600 hover:text-sky-800 font-medium">+ Add item</button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div><label className="text-xs font-medium text-slate-600 block mb-1">GST %</label><input type="number" value={gst} onChange={e => setGst(Number(e.target.value))} min={0} max={28} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div><label className="text-xs font-medium text-slate-600 block mb-1">Discount ₹</label><input type="number" value={discount} onChange={e => setDiscount(Number(e.target.value))} min={0} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div className="flex flex-col justify-end"><div className="bg-slate-50 rounded-xl px-3 py-2 text-right"><p className="text-xs text-slate-500">Total</p><p className="font-bold text-slate-900">₹{total.toLocaleString("en-IN")}</p></div></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value as InvoiceStatus)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="paid">Paid</option><option value="draft">Draft</option><option value="sent">Sent</option><option value="partially_paid">Partially Paid</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Payment Method</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value as PaymentMethod)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="insurance">Insurance</option><option value="other">Other</option>
                  </select>
                </div>
              </div>

              {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              <button type="submit" disabled={saving} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                {saving ? "Creating…" : `Create Invoice — ₹${total.toLocaleString("en-IN")}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
