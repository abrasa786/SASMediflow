"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PrintDoc, { inr } from "@/components/PrintDoc";
import { getActiveClinicId } from "@/lib/auth";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;

function Inner() {
  const id = useSearchParams().get("id");
  const [inv, setInv] = useState<any>(null); const [clinic, setClinic] = useState<any>(null); const [err, setErr] = useState("");
  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid || !id) { setErr("Invoice not found."); return; }
    Promise.all([
      supabase.from("invoices").select("*, clinic_patients(name, phone, email, address)").eq("clinic_id", cid).eq("id", id).maybeSingle(),
      supabase.from("clinics").select("*").eq("id", cid).maybeSingle(),
    ]).then(([i, c]) => { if (i.error || !i.data) setErr("Invoice not found."); else { setInv(i.data); setClinic(c.data); } });
  }, [id]);
  if (err) return <p className="p-8 text-slate-600">{err}</p>;
  if (!inv) return <p className="p-8 text-slate-400">Loading…</p>;
  const p = inv.clinic_patients ?? {};
  const items: any[] = Array.isArray(inv.items) ? inv.items : [];
  const due = Math.max(0, Number(inv.total || 0) - Number(inv.paid_amount || 0));
  const dt = inv.created_at ? new Date(inv.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–";
  return (
    <PrintDoc showStamp clinic={clinic} title="Tax invoice" number={inv.invoice_number ?? "–"} meta={[["Date", dt], ["Status", String(inv.status ?? "").replace("_", " ")]]}>
      <div className="py-4 border-b border-slate-200">
        <p className="text-xs uppercase tracking-wide text-slate-400">Billed to</p>
        <p className="font-semibold">{p.name ?? "–"}</p>
        <p className="text-slate-500">{[p.phone, p.email].filter(Boolean).join(" · ")}</p>
        {p.address && <p className="text-slate-500">{p.address}</p>}
      </div>
      <table className="w-full mt-4">
        <thead><tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200"><th className="py-2">#</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{items.map((i, n) => <tr key={n} className="border-b border-slate-100"><td className="py-2">{n + 1}</td><td>{i.name ?? i.description}</td><td className="text-right tabular-nums">{i.qty ?? 1}</td><td className="text-right tabular-nums">{inr(i.unit_price ?? i.price)}</td><td className="text-right tabular-nums">{inr(i.amount ?? i.qty * i.unit_price)}</td></tr>)}</tbody>
      </table>
      <div className="mt-4 ml-auto w-64 space-y-1 tabular-nums">
        <p className="flex justify-between"><span>Subtotal</span><span>{inr(inv.subtotal)}</span></p>
        {Number(inv.discount) > 0 && <p className="flex justify-between"><span>Discount</span><span>−{inr(inv.discount)}</span></p>}
        {Number(inv.gst_amount) > 0 && <>
          <p className="flex justify-between"><span>CGST ({(inv.gst_percent ?? 0) / 2}%)</span><span>{inr(inv.gst_amount / 2)}</span></p>
          <p className="flex justify-between"><span>SGST ({(inv.gst_percent ?? 0) / 2}%)</span><span>{inr(inv.gst_amount / 2)}</span></p></>}
        <p className="flex justify-between font-bold border-t border-slate-300 pt-1"><span>Total</span><span>{inr(inv.total)}</span></p>
        <p className="flex justify-between"><span>Paid{inv.payment_method ? ` (${inv.payment_method})` : ""}</span><span>{inr(inv.paid_amount)}</span></p>
        {due > 0 && <p className="flex justify-between font-semibold text-red-700"><span>Balance due</span><span>{inr(due)}</span></p>}
      </div>
      <p className="mt-10 text-xs text-slate-400">Thank you for visiting {clinic?.brand_name || clinic?.name}. This is a computer-generated invoice.</p>
    </PrintDoc>
  );
}
export default function Page() { return <Suspense><Inner /></Suspense>; }
