"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

interface Line { name: string; qty: number; unit_price: number; amount: number }
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50";
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const STATUS = [["draft", "Draft"], ["sent", "Not paid yet"], ["partially_paid", "Part paid"], ["paid", "Paid"], ["cancelled", "Cancelled"]];
const METHODS = [["physical", "Physical (at the desk)"], ["qr", "QR"], ["upi", "UPI"], ["online", "Online (payment link)"], ["cash", "Cash"], ["card", "Card"], ["insurance", "Insurance"], ["other", "Other"]];
const ENABLED = new Set(["physical", "cash", "card", "insurance", "other"]);   // QR, UPI and online links come later

/** One invoice: every part of it editable, with PDF, WhatsApp and payment received. */
export default function InvoiceRecord({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [inv, setInv] = useState<any | null | undefined>(undefined);
  const [items, setItems] = useState<Line[]>([]);
  const [gst, setGst] = useState(18);
  const [disc, setDisc] = useState(0);
  const [pct, setPct] = useState(false);
  const [status, setStatus] = useState("sent");
  const [paidAmt, setPaidAmt] = useState(0);
  const [method, setMethod] = useState("physical");
  const [notes, setNotes] = useState("");
  const [catalog, setCatalog] = useState<{ name: string; price: number; kind: string }[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async (cid: string) => {
    const { data } = await supabase.from("invoices").select("*, clinic_patients(id, name, phone)").eq("id", params.id).eq("clinic_id", cid).maybeSingle();
    if (!data) { setInv(null); return; }
    setInv(data);
    setItems(Array.isArray(data.items) && data.items.length ? data.items.map((i: any) => ({ name: String(i.name ?? ""), qty: Number(i.qty || 1), unit_price: Number(i.unit_price || 0), amount: Number(i.amount || 0) })) : [{ name: "", qty: 1, unit_price: 0, amount: 0 }]);
    setGst(Number(data.gst_percent ?? 18)); setDisc(Number(data.discount || 0)); setPct(false);
    setStatus(data.status ?? "sent"); setPaidAmt(Number(data.paid_amount || 0)); setMethod(data.payment_method ?? "physical"); setNotes(data.notes ?? "");
  }, [params.id]);

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid); load(cid);
    (async () => {
      const [pl, st] = await Promise.all([
        supabase.from("price_list").select("name, price").eq("clinic_id", cid).eq("is_active", true).limit(500),
        supabase.from("stock_items").select("name, unit_price").eq("clinic_id", cid).limit(500),
      ]);
      setCatalog([...((pl.data ?? []) as any[]).map((r) => ({ name: r.name, price: Number(r.price || 0), kind: "Service" })), ...((st.data ?? []) as any[]).map((r) => ({ name: r.name, price: Number(r.unit_price || 0), kind: "Stock" }))]);
    })();
  }, [router, load]);

  const sugg = (q: string) => { const t = q.trim().toLowerCase(); return t ? catalog.filter((c) => c.name.toLowerCase().includes(t) && c.name.toLowerCase() !== t).slice(0, 6) : []; };
  const edit = (i: number, f: keyof Line, v: string | number) => setItems((p) => p.map((it, k) => {
    if (k !== i) return it;
    const n = { ...it, [f]: v } as Line;
    if (f === "qty" || f === "unit_price") n.amount = Number(n.qty) * Number(n.unit_price);
    return n;
  }));

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const discount = Math.max(0, Math.min(Math.max(subtotal, 0), pct ? Math.round(subtotal * Math.min(disc, 100) / 100) : disc));
  const gstAmt = Math.round(subtotal * gst / 100);
  const total = subtotal - discount + gstAmt;

  async function save(e?: React.FormEvent) {
    e?.preventDefault(); setErr(""); setMsg("");
    if (items.some((i) => !i.name.trim())) return setErr("Fill every item name.");
    if (paidAmt < 0 || paidAmt > total) return setErr(`Amount paid must be between ₹0 and ${inr(total)}.`);
    setBusy("save");
    const becomingPaid = status === "paid" && inv.status !== "paid";
    const { error } = await supabase.from("invoices").update({
      items, subtotal, discount, gst_percent: gst, gst_amount: gstAmt, total, notes: notes.trim() || null, payment_method: ENABLED.has(method) ? method : inv.payment_method,
      // "paid" goes through the payment step below so the visit is closed too
      status: becomingPaid ? inv.status : status, paid_amount: status === "paid" ? total : status === "sent" || status === "draft" ? 0 : paidAmt,
    }).eq("id", inv.id).eq("clinic_id", clinicId);
    if (error && /payment_method/.test(error.message)) { setBusy(""); return setErr("Run the payment-method SQL in Supabase first (see the setup notes), then save again."); }
    if (error) { setBusy(""); return setErr(error.message); }
    if (becomingPaid) {
      try { const r = await authFetch<{ appointmentId: string | null }>("/api/payments/complete", { body: { clinicId, invoiceId: inv.id, method: "physical" } }); setMsg(r.appointmentId ? "Saved. Marked paid and the visit is closed." : "Saved. Marked paid."); }
      catch (e2: any) { setBusy(""); return setErr(e2.message); }
    } else setMsg("Saved.");
    setBusy(""); await load(clinicId);
  }

  async function pdf() {
    try { const r = await authFetch<{ pdfUrl: string }>("/api/invoices/send", { body: { clinicId, invoiceId: inv.id, linkOnly: true } }); window.open(r.pdfUrl, "_blank"); } catch (e: any) { setErr(e.message); }
  }
  async function whatsapp() {
    setBusy("wa"); setErr(""); setMsg("");
    try {
      const r = await authFetch<{ status: string; error?: string; link?: string }>("/api/invoices/send", { body: { clinicId, invoiceId: inv.id } });
      if (r.status === "sent") setMsg("✅ Sent to the patient on WhatsApp as a PDF.");
      else if (r.link && confirm(`${r.error ?? "Could not send automatically."}\n\nOpen WhatsApp to send it yourself?`)) window.open(r.link, "_blank");
      else setErr(r.error ?? "Could not send.");
    } catch (e: any) { setErr(e.message); }
    setBusy("");
  }
  async function received() {
    setBusy("pay"); setErr("");
    try {
      const r = await authFetch<{ appointmentId: string | null; appointmentDate: string | null }>("/api/payments/complete", { body: { clinicId, invoiceId: inv.id, method: "physical" } });
      if (r.appointmentId) { router.push(`/appointments/${r.appointmentId}`); return; }
      setMsg("Marked paid."); await load(clinicId);
    } catch (e: any) { setErr(e.message); }
    setBusy("");
  }

  if (inv === undefined) return <AppShell><div className="p-10 text-center text-slate-400 text-sm">Loading…</div></AppShell>;
  if (inv === null) return <AppShell><div className="p-10 text-center"><p className="text-slate-600 mb-3">We couldn&apos;t find that invoice in this clinic.</p><Link href="/billing" className="text-sky-600 underline text-sm">← Billing</Link></div></AppShell>;
  const p = inv.clinic_patients;
  const due = Math.max(0, total - (status === "paid" ? total : paidAmt));

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <Link href="/billing" className="text-sm text-slate-500 hover:text-sky-700">← Billing</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Invoice {inv.invoice_number}</h1>
            <p className="text-slate-500 text-sm mt-1">{p ? <Link href={`/patients/${p.id}`} className="text-sky-700 hover:underline">{p.name}</Link> : "—"}{p?.phone ? ` · ${p.phone}` : ""} · {new Date(inv.created_at).toLocaleDateString("en-IN")}
              {inv.appointment_id && <> · <Link href={`/appointments/${inv.appointment_id}`} className="text-sky-700 hover:underline">Appointment</Link></>}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={pdf} className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">PDF</button>
            <button type="button" disabled={busy !== ""} onClick={whatsapp} className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold">{busy === "wa" ? "Sending…" : "Send on WhatsApp"}</button>
            {inv.status !== "paid" && inv.status !== "cancelled" && <button type="button" disabled={busy !== ""} onClick={received} className="px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy === "pay" ? "Saving…" : "Payment received"}</button>}
          </div>
        </div>

        <form onSubmit={save} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mt-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-slate-600 mb-1">Items</p>
            {items.map((it, i) => (
              <div key={i} className="relative grid grid-cols-12 gap-2 mb-2">
                <input aria-label="Item" value={it.name} placeholder="Item or service" onFocus={() => setActive(i)} onBlur={() => setTimeout(() => setActive((a) => (a === i ? null : a)), 150)} onChange={(e) => { edit(i, "name", e.target.value); setActive(i); }} className={`${inp} col-span-12 sm:col-span-6`} />
                <input aria-label="Quantity" type="number" min={1} value={it.qty} onChange={(e) => edit(i, "qty", Number(e.target.value))} className={`${inp} col-span-3 sm:col-span-2`} />
                <input aria-label="Price" type="number" value={it.unit_price} onChange={(e) => edit(i, "unit_price", Number(e.target.value))} className={`${inp} col-span-5 sm:col-span-3`} />
                <button type="button" aria-label="Remove item" onClick={() => setItems((q) => q.filter((_, k) => k !== i))} disabled={items.length === 1} className="col-span-1 text-slate-400 hover:text-red-600 disabled:opacity-30">✕</button>
                {active === i && sugg(it.name).length > 0 && (
                  <div className="absolute z-10 left-0 top-11 w-full sm:w-1/2 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
                    {sugg(it.name).map((c) => <button key={c.kind + c.name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setItems((q) => q.map((x, k) => (k === i ? { ...x, name: c.name, unit_price: c.price, amount: Number(x.qty) * c.price } : x))); setActive(null); }} className="w-full flex justify-between px-3 py-1.5 text-sm text-left hover:bg-sky-50"><span>{c.name} <span className="text-slate-400 text-xs">{c.kind}</span></span><span>{inr(c.price)}</span></button>)}
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setItems((q) => [...q, { name: "", qty: 1, unit_price: 0, amount: 0 }])} className="text-sm text-sky-700 font-semibold">+ Add item</button>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className="text-xs font-medium text-slate-600 block mb-1">Discount</label><div className="flex gap-2"><input type="number" min={0} value={disc} onChange={(e) => setDisc(Number(e.target.value))} className={inp} /><select value={pct ? "p" : "a"} onChange={(e) => setPct(e.target.value === "p")} className={`${inp} !w-20`}><option value="a">₹</option><option value="p">%</option></select></div></div>
            <div><label className="text-xs font-medium text-slate-600 block mb-1">GST %</label><input type="number" min={0} value={gst} onChange={(e) => setGst(Number(e.target.value))} className={inp} /></div>
            <div className="text-right self-end text-sm text-slate-600"><p>Subtotal {inr(subtotal)}</p>{discount > 0 && <p>Discount −{inr(discount)}</p>}<p>GST {inr(gstAmt)}</p><p className="text-lg font-bold text-slate-900">Total {inr(total)}</p></div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label htmlFor="inv-status" className="text-xs font-medium text-slate-600 block mb-1">Payment</label>
              <select id="inv-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div><label className="text-xs font-medium text-slate-600 block mb-1">Amount paid (₹)</label><input type="number" min={0} disabled={status !== "partially_paid"} value={status === "paid" ? total : status === "partially_paid" ? paidAmt : 0} onChange={(e) => setPaidAmt(Number(e.target.value))} className={inp} /></div>
            <div><label htmlFor="inv-method" className="text-xs font-medium text-slate-600 block mb-1">Method of payment</label>
              <select id="inv-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>{METHODS.map(([v, l]) => <option key={v} value={v} disabled={!ENABLED.has(v)}>{l}{ENABLED.has(v) ? "" : " (coming soon)"}</option>)}</select></div>
          </div>
          {due > 0 && status !== "cancelled" && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Balance due: <strong>{inr(due)}</strong></p>}
          <div><label className="text-xs font-medium text-slate-600 block mb-1">Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} /></div>
          {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          {msg && <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</p>}
          <div className="flex gap-2"><button disabled={busy !== ""} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy === "save" ? "Saving…" : "Save changes"}</button><Link href="/billing" className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Close</Link></div>
        </form>
      </div>
    </AppShell>
  );
}
