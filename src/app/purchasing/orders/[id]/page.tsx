"use client";

import Link from "next/link";
import SimpleRecord, { type SField } from "@/components/SimpleRecord";

const FIELDS: SField[] = [
  { key: "po_number", label: "Order number", readOnly: true }, { key: "order_date", label: "Order date", type: "date" },
  { key: "expected_date", label: "Expected on", type: "date" }, { key: "notes", label: "Notes", type: "textarea" },
];
const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function OrderRecord({ params }: { params: { id: string } }) {
  return <SimpleRecord table="purchase_orders" select="*, suppliers(id, name), purchase_order_items(*)" id={params.id} fields={FIELDS} backHref="/purchasing" backLabel="Purchasing" endpoint="/api/purchasing/order"
    title={(r) => `Order ${r.po_number}`} subtitle={(r) => `${r.suppliers?.name ?? ""} · ${String(r.status).replace("_", " ")} · ${inr(r.total)}`}
    buildRequest={(clinicId, row, f) => ({ clinicId, action: "update", poId: row.id, orderDate: f.order_date, expectedDate: f.expected_date, notes: f.notes })}>
    {(r) => (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 mt-5">
        <h2 className="font-semibold text-slate-900 text-sm mb-2">Items</h2>
        {(r.purchase_order_items ?? []).map((i: any) => <div key={i.id} className="flex justify-between text-sm py-1.5 border-b border-slate-50 last:border-0"><span>{i.name}</span><span className="text-slate-500 tabular-nums">{i.qty_received}/{i.qty_ordered} {i.unit} · {inr(i.unit_price)}</span></div>)}
        <p className="text-xs text-slate-400 mt-3">Items and quantities change when you receive goods, so stock and supplier bills stay correct. <Link href="/purchasing" className="text-sky-700 underline">Receive goods</Link> from the orders list.</p>
      </div>
    )}
  </SimpleRecord>;
}
