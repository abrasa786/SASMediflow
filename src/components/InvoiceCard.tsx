"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { createInvoice } from "@/lib/clinic";

interface Line { name: string; qty: number; unit_price: number; amount: number }
export interface InvoiceForm { patientId: string; patientName: string; phone: string | null; appointmentId: string | null; items: Line[]; creditIds: string[] }

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** The invoice form, right inside the assistant chat. Same rules as the Billing page: item lookup, discount, GST, send on WhatsApp. */
export default function InvoiceCard({ clinicId, form, accent }: { clinicId: string; form: InvoiceForm; accent: string }) {
  const [items, setItems] = useState<Line[]>(form.items.length ? form.items : [{ name: "", qty: 1, unit_price: 0, amount: 0 }]);
  const [gst, setGst] = useState(18);
  const [disc, setDisc] = useState(0);
  const [pct, setPct] = useState(false);
  const [paid, setPaid] = useState(false);
  const [catalog, setCatalog] = useState<{ name: string; price: number; kind: string }[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ number: string; total: number; note: string; link?: string } | null>(null);

  useEffect(() => {
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
  }, [clinicId]);

  const sugg = (q: string) => { const t = q.trim().toLowerCase(); return t ? catalog.filter((c) => c.name.toLowerCase().includes(t) && c.name.toLowerCase() !== t).slice(0, 5) : []; };
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

  async function create(send: boolean) {
    if (items.some((i) => !i.name.trim())) { setErr("Fill every item name."); return; }
    setBusy(true); setErr("");
    try {
      const base = {
        clinic_id: clinicId, clinic_patient_id: form.patientId,
        ...(form.appointmentId ? { appointment_id: form.appointmentId } : {}),
        items, subtotal, discount, gst_percent: gst, gst_amount: gstAmt, total,
        status: paid ? "paid" : "sent", paid_amount: paid ? total : 0,
      };
      let { data: made, error } = await createInvoice({ ...base, payment_method: "physical" } as any);
      if (error && /payment_method/.test(error.message)) ({ data: made, error } = await createInvoice({ ...base, payment_method: "cash" } as any));
      if (error || !made) throw new Error(error?.message ?? "Could not create the invoice.");
      if (form.creditIds.length && items.some((i) => i.name.startsWith("Less: online booking fee"))) {
        await supabase.from("appointments").update({ advance_invoice: made.id }).in("id", form.creditIds);
      }
      let note = "";
      let link: string | undefined;
      if (paid) {
        await authFetch("/api/payments/complete", { body: { clinicId, invoiceId: made.id, method: "physical" } }).catch(() => null);
        note = "Marked paid, and the visit is closed.";
      }
      if (send) {
        const r = await authFetch<{ status: string; error?: string; link?: string }>("/api/invoices/send", { body: { clinicId, invoiceId: made.id } }).catch((e: any) => ({ status: "failed", error: e.message, link: undefined }));
        note += `${note ? " " : ""}${r.status === "sent" ? "✅ Sent to the patient on WhatsApp." : r.status === "link" ? "WhatsApp isn't automatic yet; use the button below." : r.status === "skipped" ? "No phone number, so nothing was sent." : `⚠️ WhatsApp failed (${r.error ?? "unknown error"}).`}`;
        link = r.link;
      }
      authFetch("/api/flows/process", { body: { clinicId } }).catch(() => null);
      setDone({ number: made.invoice_number ?? "", total, note, link });
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
        <p className="font-semibold">✅ Invoice {done.number} created · {inr(done.total)}</p>
        {done.note && <p className="mt-1">{done.note}</p>}
        {done.link && <a href={done.link} target="_blank" rel="noreferrer" className="inline-block mt-2 px-2.5 py-1 rounded-lg bg-white border border-emerald-300">Send on WhatsApp</a>}
        <a href="/billing" className="inline-block mt-2 ml-2 underline">Open Billing</a>
      </div>
    );
  }

  const field = "border border-slate-200 rounded-lg px-2 py-1 text-xs w-full bg-white text-slate-800";
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 space-y-2">
      <p className="font-semibold text-slate-900">{form.patientName}{form.phone ? <span className="font-normal text-slate-500"> · {form.phone}</span> : null}</p>
      {items.map((it, i) => (
        <div key={i} className="relative space-y-1">
          <div className="flex gap-1">
            <input value={it.name} placeholder="Item or service" onFocus={() => setActive(i)} onBlur={() => setTimeout(() => setActive((a) => (a === i ? null : a)), 150)} onChange={(e) => { edit(i, "name", e.target.value); setActive(i); }} className={field} />
            {items.length > 1 && <button type="button" aria-label="Remove item" onClick={() => setItems((p) => p.filter((_, k) => k !== i))} className="px-1 text-slate-400 hover:text-red-600">✕</button>}
          </div>
          {active === i && sugg(it.name).length > 0 && (
            <div className="absolute z-10 left-0 right-6 top-7 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
              {sugg(it.name).map((c) => (
                <button key={c.kind + c.name} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setItems((p) => p.map((x, k) => (k === i ? { ...x, name: c.name, unit_price: c.price, amount: Number(x.qty) * c.price } : x))); setActive(null); }} className="w-full flex justify-between px-2 py-1 text-left hover:bg-sky-50">
                  <span>{c.name} <span className="text-slate-400">{c.kind}</span></span><span>{inr(c.price)}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 items-center">
            <input type="number" min={1} value={it.qty} onChange={(e) => edit(i, "qty", Number(e.target.value))} className={`${field} !w-14`} aria-label="Quantity" />
            <span>×</span>
            <input type="number" value={it.unit_price} onChange={(e) => edit(i, "unit_price", Number(e.target.value))} className={`${field} !w-20`} aria-label="Price" />
            <span className="ml-auto font-medium">{inr(it.amount)}</span>
          </div>
        </div>
      ))}
      <button type="button" onClick={() => setItems((p) => [...p, { name: "", qty: 1, unit_price: 0, amount: 0 }])} className="text-sky-700 font-semibold">+ Add item</button>
      <div className="flex gap-2 items-center">
        <label className="flex items-center gap-1">Discount
          <input type="number" min={0} value={disc} onChange={(e) => setDisc(Number(e.target.value))} className={`${field} !w-16`} />
        </label>
        <select value={pct ? "p" : "a"} onChange={(e) => setPct(e.target.value === "p")} className={`${field} !w-14`}><option value="a">₹</option><option value="p">%</option></select>
        <label className="flex items-center gap-1 ml-auto">GST %
          <input type="number" min={0} value={gst} onChange={(e) => setGst(Number(e.target.value))} className={`${field} !w-12`} />
        </label>
      </div>
      <div className="text-right text-slate-600">
        {discount > 0 && <p>Discount −{inr(discount)}</p>}
        {gstAmt > 0 && <p>GST {inr(gstAmt)}</p>}
        <p className="text-sm font-bold text-slate-900">Total {inr(total)}</p>
      </div>
      <label className="flex items-center gap-1.5"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Already paid (physical): mark paid and close the visit</label>
      {err && <p className="text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => create(false)} className="flex-1 py-1.5 rounded-lg border border-slate-300 bg-white font-semibold disabled:opacity-60">Create</button>
        <button type="button" disabled={busy} onClick={() => create(true)} className="flex-1 py-1.5 rounded-lg text-white font-semibold disabled:opacity-60" style={{ background: accent }}>{busy ? "Saving…" : "Create & send"}</button>
      </div>
    </div>
  );
}
