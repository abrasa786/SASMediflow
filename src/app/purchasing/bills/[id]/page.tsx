"use client";

import SimpleRecord, { type SField } from "@/components/SimpleRecord";

const FIELDS: SField[] = [
  { key: "bill_number", label: "Supplier's bill number" }, { key: "bill_date", label: "Bill date", type: "date" },
  { key: "due_date", label: "Due date", type: "date" }, { key: "notes", label: "Notes", type: "textarea" },
];
const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function BillRecord({ params }: { params: { id: string } }) {
  return <SimpleRecord table="supplier_bills" select="*, suppliers(name), purchase_orders(po_number)" id={params.id} fields={FIELDS} backHref="/purchasing" backLabel="Purchasing" endpoint="/api/purchasing/bill"
    title={(r) => `Bill ${r.bill_number || ""}`.trim()} subtitle={(r) => `${r.suppliers?.name ?? ""} · ${inr(r.amount)} · paid ${inr(r.paid_amount)} · ${r.status}${r.purchase_orders?.po_number ? ` · ${r.purchase_orders.po_number}` : ""}`}
    buildRequest={(clinicId, row, f) => ({ clinicId, action: "edit", billId: row.id, billNumber: f.bill_number, billDate: f.bill_date, dueDate: f.due_date, notes: f.notes })} />;
}
