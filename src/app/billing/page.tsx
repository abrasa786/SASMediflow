"use client";

import { toast } from "@/lib/toast";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { getInvoices, createInvoice, searchClinicPatients } from "@/lib/clinic";
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
  // Booking fees this patient already paid online: taken off the bill as a "Less:" line
  const [credits, setCredits] = useState<{ id: string; advance_paid: number; appointment_date: string }[]>([]);
  useEffect(() => {
    setCredits([]);
    if (!selectedPatient) return;
    supabase.from("appointments").select("id, advance_paid, appointment_date").eq("clinic_patient_id", selectedPatient.id)
      .eq("source", "online").gt("advance_paid", 0).is("advance_invoice", null).neq("status", "cancelled").order("appointment_date")
      .then(({ data }: any) => {
        const list = data ?? []; setCredits(list);
        if (list.length) setItems((prev) => [...prev.filter((i) => !i.name.startsWith("Less: online booking fee")),
          ...list.map((c: any) => ({ name: `Less: online booking fee paid (${c.appointment_date})`, qty: 1, unit_price: -Number(c.advance_paid), amount: -Number(c.advance_paid) }))]);
      });
  }, [selectedPatient]);
  const [items, setItems] = useState<LineItem[]>([{ name: "", qty: 1, unit_price: 0, amount: 0 }]);
  // The patient's treatment sittings (e.g. root canal: 5500, 4000, 1000): tick the ones this invoice bills, or bill one sitting per invoice
  const [sittings, setSittings] = useState<{ id: string; plan: string; seq: number; label: string; due: number; paid: number; status: string; billed: number }[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  useEffect(() => {
    setSittings([]); setPicked({});
    if (!selectedPatient || !clinicId) return;
    (async () => {
      const { data: plans } = await supabase.from("treatment_plans").select("id, title, treatment_sittings(id, seq, label, due_amount, paid_amount, status)").eq("clinic_id", clinicId).eq("clinic_patient_id", selectedPatient.id).eq("status", "active");
      const sit = ((plans ?? []) as any[]).flatMap((p) => (p.treatment_sittings ?? []).map((t: any) => ({ id: t.id, plan: p.title, seq: t.seq, label: t.label, due: Number(t.due_amount), paid: Number(t.paid_amount), status: t.status })));
      if (!sit.length) return;
      const { data: links } = await supabase.from("invoice_sittings").select("sitting_id, amount").in("sitting_id", sit.map((x) => x.id));
      const billed = new Map<string, number>();
      for (const l of (links ?? []) as any[]) billed.set(l.sitting_id, (billed.get(l.sitting_id) ?? 0) + Number(l.amount));
      setSittings(sit.sort((a, b) => a.plan.localeCompare(b.plan) || a.seq - b.seq).map((x) => ({ ...x, billed: billed.get(x.id) ?? 0 })));
    })();
  }, [selectedPatient, clinicId]);
  function togglePicked(t: { id: string; plan: string; seq: number; label: string; due: number; billed: number }) {
    const left = Math.max(0, t.due - t.billed);
    const on = picked[t.id] === undefined;
    setPicked((p) => { const n = { ...p }; if (on) n[t.id] = left; else delete n[t.id]; return n; });
    const name = `${t.plan} — sitting ${t.seq}${t.label ? ` (${t.label})` : ""}`;
    setItems((prev) => {
      const rest = prev.filter((i) => i.name !== name && (i.name.trim() || i.unit_price));
      return on ? [...rest, { name, qty: 1, unit_price: left, amount: left }] : rest.length ? rest : [{ name: "", qty: 1, unit_price: 0, amount: 0 }];
    });
  }
  const [gst, setGst] = useState(18);
  const [discountVal, setDiscountVal] = useState(0);
  const [discMode, setDiscMode] = useState<"amount" | "percent">("amount");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("physical");
  const [status, setStatus] = useState<InvoiceStatus>("sent");
  const [fromAppt, setFromAppt] = useState<{ id: string; date: string; doctor: string } | null>(null);
  const [created, setCreated] = useState<{ id: string; number: string; total: number; whatsapp?: { status: string; error?: string; link?: string } } | null>(null);
  const [busyAct, setBusyAct] = useState("");
  const [waFail, setWaFail] = useState<{ error: string; link?: string } | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(t); }, [notice]);
  const [catalog, setCatalog] = useState<{ name: string; price: number; kind: string }[]>([]);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState(() => { try { const f = new URLSearchParams(window.location.search).get("filter"); return f && ["pending", "paid", "draft", "sent", "partially_paid", "cancelled"].includes(f) ? f : "all"; } catch { return "all"; } });

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    load(id);
    // Coming from "Complete" on an appointment: open the invoice for that visit, patient and fee filled in
    try {
      const apptId = new URLSearchParams(window.location.search).get("appointment");
      if (apptId) openForAppointment(id, apptId);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function openForAppointment(cid: string, apptId: string) {
    const { data: a } = await supabase.from("appointments").select("id, appointment_date, consultation_fee, advance_paid, clinic_patient_id, clinic_patients(id, name, phone), doctors(name)").eq("id", apptId).eq("clinic_id", cid).maybeSingle();
    if (!a) return;
    const { data: existing } = await supabase.from("invoices").select("id, invoice_number, total, status").eq("clinic_id", cid).eq("appointment_id", apptId).neq("status", "cancelled").limit(1);
    const doctor = (a as any).doctors?.name ?? "";
    setFromAppt({ id: a.id, date: a.appointment_date, doctor });
    if (existing?.length) { setCreated({ id: existing[0].id, number: existing[0].invoice_number ?? "", total: Number(existing[0].total) }); setShowNew(true); return; }
    const p = (a as any).clinic_patients;
    if (p) setSelectedPatient(p as ClinicPatient);
    const fee = Number(a.consultation_fee || 0);
    setItems([{ name: `Consultation${doctor ? ` — ${/^dr\.?\s/i.test(doctor) ? doctor : "Dr. " + doctor}` : ""}`, qty: 1, unit_price: fee, amount: fee }]);
    setShowNew(true);
  }

  // item suggestions while typing: the clinic's price list and its stock
  useEffect(() => {
    if (!showNew || !clinicId) return;
    (async () => {
      const [pl, st] = await Promise.all([
        supabase.from("price_list").select("name, price").eq("clinic_id", clinicId).eq("is_active", true).limit(500),
        supabase.from("stock_items").select("name, unit_price").eq("clinic_id", clinicId).limit(500),
      ]);
      setCatalog([
        ...((pl.data ?? []) as any[]).map((r) => ({ name: r.name, price: Number(r.price || 0), kind: "Service" })),
        ...((st.data ?? []) as any[]).map((r) => ({ name: r.name, price: Number(r.unit_price || 0), kind: "Stock" })),
      ]);
    })();
  }, [showNew, clinicId]);
  const suggestions = (q: string) => { const t = q.trim().toLowerCase(); if (!t) return []; return catalog.filter((c) => c.name.toLowerCase().includes(t) && c.name.toLowerCase() !== t).slice(0, 6); };
  function pickItem(i: number, c: { name: string; price: number }) {
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, name: c.name, unit_price: c.price, amount: Number(it.qty) * c.price } : it));
    setActiveRow(null);
  }

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
  const discount = Math.max(0, Math.min(Math.max(subtotal, 0), discMode === "percent" ? Math.round(subtotal * Math.min(discountVal, 100) / 100) : discountVal));
  const gstAmt = Math.round(subtotal * gst / 100);
  const total = subtotal - discount + gstAmt;

  async function sendOnWhatsApp(invoiceId: string): Promise<{ status: string; error?: string; link?: string }> {
    try { return await authFetch<{ status: string; error?: string; link?: string }>("/api/invoices/send", { body: { clinicId, invoiceId } }); }
    catch (e: any) { return { status: "failed", error: e.message }; }
  }

  async function openPdf(invoiceId: string) {
    try { const r = await authFetch<{ pdfUrl: string }>("/api/invoices/send", { body: { clinicId, invoiceId, linkOnly: true } }); window.open(r.pdfUrl, "_blank"); }
    catch (e: any) { alert(e.message); }
  }

  async function handleCreate(e: React.FormEvent, alsoSend = false) {
    e.preventDefault();
    if (!selectedPatient) { setErr("Select a patient"); return; }
    if (items.some(i => !i.name.trim())) { setErr("Fill all item names"); return; }
    setSaving(true); setErr("");
    const base = {
      clinic_id: clinicId,
      clinic_patient_id: selectedPatient.id,
      ...(fromAppt ? { appointment_id: fromAppt.id } : {}),
      items, subtotal, discount, gst_percent: gst, gst_amount: gstAmt, total,
      status, paid_amount: status === "paid" ? total : 0,
    };
    let { data: made, error } = await createInvoice({ ...base, payment_method: payMethod } as any);
    // the database hasn't had migration 018 yet: record the desk payment as cash instead
    if (error && /payment_method/.test(error.message)) ({ data: made, error } = await createInvoice({ ...base, payment_method: "cash" } as any));
    if (error || !made) { setSaving(false); setErr(error?.message ?? "Could not create the invoice."); return; }
    if (credits.length && items.some((i) => i.name.startsWith("Less: online booking fee"))) {
      await supabase.from("appointments").update({ advance_invoice: made.id }).in("id", credits.map((c) => c.id));
    }
    const links = Object.entries(picked).map(([sittingId, amount]) => ({ sittingId, amount }));
    if (links.length) { try { await authFetch("/api/invoices/sittings", { body: { clinicId, invoiceId: made.id, links } }); } catch (x: any) { setErr(`Invoice made, but the sittings could not be linked: ${x.message}`); } }
    runFlows();
    let whatsapp: { status: string; error?: string; link?: string } | undefined;
    if (alsoSend) whatsapp = await sendOnWhatsApp(made.id);
    // paid on the spot: close the visit and go back to the appointments straight away
    if (status === "paid") { await finishPayment(made.id); return; }
    setSaving(false);
    toast(`Invoice ${made.invoice_number ?? ""} created successfully`);
    // created and already on the patient's WhatsApp: nothing left to do here, so back to the home page
    if (alsoSend && whatsapp?.status === "sent") { router.push("/dashboard"); return; }
    await load(clinicId);
    setCreated({ id: made.id, number: made.invoice_number ?? "", total, whatsapp });
  }

  /** Payment received: invoice -> paid, appointment -> completed, then back to the appointment. */
  async function finishPayment(invoiceId: string) {
    setBusyAct("pay"); setErr("");
    try {
      await authFetch<{ appointmentId: string | null; appointmentDate: string | null }>("/api/payments/complete", { body: { clinicId, invoiceId, method: "physical" } });
      toast("Paid in full. The visit is closed.");
      router.push("/dashboard"); return;          // the bill is done: back to the home page
    } catch (e: any) { setErr(e.message); }
    finally { setBusyAct(""); setSaving(false); }
  }

  function resetForm() {
    setSelectedPatient(null); setPatientSearch(""); setPatientResults([]);
    setItems([{ name: "", qty: 1, unit_price: 0, amount: 0 }]);
    setGst(18); setDiscountVal(0); setDiscMode("amount"); setPayMethod("physical"); setStatus("sent"); setErr(""); setFromAppt(null); setCreated(null); setActiveRow(null);
  }

  async function markPaid(inv: Invoice) {
    try { await authFetch("/api/payments/complete", { body: { clinicId, invoiceId: inv.id, method: "physical" } }); } catch (e: any) { alert(e.message); }
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

        {notice && <p className={`mb-4 text-sm rounded-xl px-4 py-3 ${notice.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"}`} role="status">{notice.text}</p>}
        {waFail && <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3" role="alert"><p>{waFail.error}</p><div className="mt-2 flex gap-3">{waFail.link && <a href={waFail.link} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-emerald-500 text-white font-semibold">Open WhatsApp and send it myself</a>}<button onClick={() => setWaFail(null)} className="text-slate-500">Dismiss</button></div></div>}
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
                    <tr key={inv.id} onClick={(e) => { if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return; router.push(`/billing/${inv.id}`); }} className="hover:bg-slate-50 cursor-pointer">
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
                        <button onClick={() => openPdf(inv.id)} className="text-xs text-sky-700 hover:underline font-medium mr-3">PDF</button>
                        <button onClick={async () => { const r = await sendOnWhatsApp(inv.id); if (r.status === "sent") toast("Invoice sent on WhatsApp."); else setWaFail({ error: r.error ?? "Could not send automatically.", link: r.link }); }} className="text-xs text-emerald-700 hover:underline font-medium mr-3">Send</button>
                        {inv.status !== "paid" && inv.status !== "cancelled" && (
                          <button onClick={() => markPaid(inv)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Payment received</button>
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
            {created ? (
              <div className="space-y-4">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <p className="font-semibold text-emerald-800">Invoice {created.number} ready · ₹{created.total.toLocaleString("en-IN")}</p>
                  {created.whatsapp?.status === "sent" && <p className="text-xs text-emerald-700 mt-1">✅ Sent to the patient on WhatsApp.</p>}
                  {created.whatsapp && created.whatsapp.status !== "sent" && (
                    <p className="text-xs text-amber-700 mt-1">⚠️ {created.whatsapp.error ?? "Could not send on WhatsApp."} {created.whatsapp.link && <a href={created.whatsapp.link} target="_blank" rel="noreferrer" className="underline font-medium">Send it from my WhatsApp</a>}</p>
                  )}
                </div>
                {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
                <div className="grid grid-cols-1 gap-2">
                  <button type="button" onClick={() => openPdf(created.id)} className="py-3 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700">Download invoice PDF</button>
                  <button type="button" disabled={busyAct !== ""} onClick={async () => { setBusyAct("send"); const w = await sendOnWhatsApp(created.id); setCreated({ ...created, whatsapp: w }); setBusyAct(""); }} className="py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">{busyAct === "send" ? "Sending…" : created.whatsapp?.status === "sent" ? "Send again on WhatsApp" : "Send invoice on WhatsApp"}</button>
                  <button type="button" disabled={busyAct !== ""} onClick={() => finishPayment(created.id)} className="py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">{busyAct === "pay" ? "Saving…" : "Payment received (physical)"}</button>
                  <a href={`/billing/print?id=${created.id}`} target="_blank" rel="noreferrer" className="text-center py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-slate-50">Print invoice</a>
                  <button type="button" onClick={() => { setShowNew(false); resetForm(); router.push("/dashboard"); }} className="text-xs text-slate-500 hover:underline">Pay later: go to home</button>
                </div>
              </div>
            ) : (
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
                {sittings.length > 0 && (
                  <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
                    <p className="text-xs font-semibold text-sky-900">Treatment sittings for this patient</p>
                    <p className="text-xs text-sky-800/80 mb-2">Tick the sittings to bill on this invoice: all of them for one invoice, or just one for a separate invoice.</p>
                    <ul className="space-y-1">
                      {sittings.map((t) => {
                        const left = Math.max(0, t.due - t.billed);
                        return (
                          <li key={t.id}><label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={picked[t.id] !== undefined} disabled={left <= 0 && picked[t.id] === undefined} onChange={() => togglePicked(t)} />
                            <span className="min-w-0 flex-1"><span className="font-medium text-slate-800">{t.plan} · sitting {t.seq}</span>
                              <span className="block text-xs text-slate-500">₹{t.due.toLocaleString("en-IN")}{t.billed > 0 ? ` · ₹${t.billed.toLocaleString("en-IN")} already invoiced` : ""} · {t.status === "done" ? "done" : t.status}</span></span>
                          </label></li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <label className="text-xs font-medium text-slate-600 block mb-1">Items *</label>
                <div className="space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1.5">
                      <div className="col-span-5 relative">
                        <input value={item.name} onChange={e => { updateItem(i, "name", e.target.value); setActiveRow(i); }} onFocus={() => setActiveRow(i)} onBlur={() => setTimeout(() => setActiveRow((r) => (r === i ? null : r)), 150)} placeholder="Type to search services & stock" autoComplete="off" className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500" />
                        {activeRow === i && suggestions(item.name).length > 0 && (
                          <div className="absolute z-20 top-full left-0 right-[-120px] mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                            {suggestions(item.name).map((c) => (
                              <button key={c.kind + c.name} type="button" onMouseDown={(e) => { e.preventDefault(); pickItem(i, c); }} className="w-full text-left px-3 py-2 text-xs hover:bg-sky-50 border-b border-slate-50 last:border-0 flex justify-between gap-3">
                                <span className="truncate">{c.name} <span className="text-slate-400">· {c.kind}</span></span><span className="text-slate-500 shrink-0">₹{c.price}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input type="number" value={item.qty} onChange={e => updateItem(i, "qty", Number(e.target.value))} min={1} className="col-span-2 px-2 py-2 rounded-lg border border-slate-200 text-xs text-center focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      <input type="number" value={item.unit_price} onChange={e => updateItem(i, "unit_price", Number(e.target.value))} placeholder="Price" className="col-span-3 px-2 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500" />
                      <div className="col-span-1 flex items-center justify-center text-xs text-slate-500 font-medium">₹{item.amount}</div>
                      <button type="button" onClick={() => setItems(p => p.filter((_, idx) => idx !== i))} className="col-span-1 text-red-400 hover:text-red-600 text-sm">×</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setItems(p => [...p, { name: "", qty: 1, unit_price: 0, amount: 0 }])} className="mt-2 text-xs text-sky-600 hover:text-sky-800 font-medium">+ Add item</button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-600 block mb-1">GST %</label><input type="number" value={gst} onChange={e => setGst(Number(e.target.value))} min={0} max={28} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Discount</label>
                  <div className="flex gap-1.5">
                    <input type="number" value={discountVal} onChange={e => setDiscountVal(Number(e.target.value))} min={0} className="w-full min-w-0 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                    <select value={discMode} onChange={e => setDiscMode(e.target.value as "amount" | "percent")} aria-label="Discount type" className="px-2 rounded-xl border border-slate-200 text-sm bg-white"><option value="amount">₹</option><option value="percent">%</option></select>
                  </div>
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>₹{subtotal.toLocaleString("en-IN")}</span></div>
                {discount > 0 && <div className="flex justify-between text-emerald-700"><span>Discount{discMode === "percent" ? ` (${discountVal}%)` : ""}</span><span>−₹{discount.toLocaleString("en-IN")}</span></div>}
                <div className="flex justify-between text-slate-500"><span>GST ({gst}%)</span><span>₹{gstAmt.toLocaleString("en-IN")}</span></div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-200"><span>Total</span><span>₹{total.toLocaleString("en-IN")}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Payment</label>
                  <select value={status} onChange={e => setStatus(e.target.value as InvoiceStatus)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="sent">Not paid yet</option><option value="paid">Paid now</option><option value="draft">Draft</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Method of payment</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value as PaymentMethod)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="physical">Physical (at the desk)</option>
                    <option value="qr" disabled>QR code (coming soon)</option>
                    <option value="upi" disabled>UPI (coming soon)</option>
                    <option value="online" disabled>Online payment link (coming soon)</option>
                  </select>
                </div>
              </div>

              {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              <div className="grid grid-cols-2 gap-2">
                <button type="submit" disabled={saving} className="py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                  {saving ? "Creating…" : "Create invoice"}
                </button>
                <button type="button" disabled={saving} onClick={(e) => handleCreate(e as unknown as React.FormEvent, true)} className="py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                  Create &amp; send on WhatsApp
                </button>
              </div>
              {fromAppt && <button type="button" disabled={saving} onClick={async () => { await authFetch("/api/appointments/status", { body: { clinicId, appointmentId: fromAppt.id, status: "completed" } }).catch(() => null); router.push(`/appointments?date=${fromAppt.date}`); }} className="w-full text-xs text-slate-500 hover:underline">No bill needed: just mark the appointment done</button>}
            </form>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
