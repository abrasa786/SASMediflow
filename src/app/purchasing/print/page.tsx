"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PrintDoc, { inr } from "@/components/PrintDoc";
import { getActiveClinicId } from "@/lib/auth";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;
const d = (s?: string | null) => s ? new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";

function Inner() {
  const id = useSearchParams().get("id");
  const [po, setPo] = useState<any>(null); const [clinic, setClinic] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid || !id) { setErr("Order not found."); return; }
    Promise.all([
      supabase.from("purchase_orders").select("*, suppliers(*), purchase_order_items(*)").eq("clinic_id", cid).eq("id", id).maybeSingle(),
      supabase.from("clinics").select("*").eq("id", cid).maybeSingle(),
    ]).then(([p, c]) => { if (p.error || !p.data) setErr("Order not found."); else { setPo(p.data); setClinic(c.data); } });
  }, [id]);
  if (err) return <p className="p-8 text-slate-600">{err}</p>;
  if (!po) return <p className="p-8 text-slate-400">Loading…</p>;
  const s = po.suppliers ?? {};
  return (
    <PrintDoc clinic={clinic} title="Purchase order" number={po.po_number} meta={[["Date", d(po.order_date)], ["Expected", d(po.expected_date)]]}>
      <div className="py-4 border-b border-slate-200">
        <p className="text-xs uppercase tracking-wide text-slate-400">Supplier</p>
        <p className="font-semibold">{s.name}</p>
        {s.address && <p className="text-slate-500">{s.address}</p>}
        <p className="text-slate-500">{[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ")}</p>
        {s.gstin && <p className="text-slate-500">GSTIN {s.gstin}</p>}
      </div>
      <table className="w-full mt-4">
        <thead><tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200"><th className="py-2">#</th><th>Item</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{po.purchase_order_items.map((i: any, n: number) => { const base = i.qty_ordered * i.unit_price; return (
          <tr key={i.id} className="border-b border-slate-100"><td className="py-2">{n + 1}</td><td>{i.name}</td><td className="text-right tabular-nums">{i.qty_ordered} {i.unit}</td><td className="text-right tabular-nums">{inr(i.unit_price)}</td><td className="text-right tabular-nums">{i.gst_percent}%</td><td className="text-right tabular-nums">{inr(base * (1 + i.gst_percent / 100))}</td></tr>); })}</tbody>
      </table>
      <div className="mt-4 ml-auto w-64 space-y-1 tabular-nums">
        <p className="flex justify-between"><span>Subtotal</span><span>{inr(po.subtotal)}</span></p>
        <p className="flex justify-between"><span>GST</span><span>{inr(po.gst_amount)}</span></p>
        <p className="flex justify-between font-bold border-t border-slate-300 pt-1"><span>Total</span><span>{inr(po.total)}</span></p>
      </div>
      {po.notes && <p className="mt-6 text-slate-600"><b>Notes:</b> {po.notes}</p>}
      <p className="mt-10 text-xs text-slate-400">Payment terms: {s.payment_terms_days ? `${s.payment_terms_days} days from invoice` : "on delivery"}. Please quote {po.po_number} on your invoice.</p>
    </PrintDoc>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
