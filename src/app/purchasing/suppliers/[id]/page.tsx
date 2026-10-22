"use client";

import SimpleRecord, { type SField } from "@/components/SimpleRecord";

const FIELDS: SField[] = [
  { key: "name", label: "Supplier name" }, { key: "contact_name", label: "Contact person" }, { key: "phone", label: "Phone", type: "tel" }, { key: "email", label: "Email", type: "email" },
  { key: "gstin", label: "GSTIN" }, { key: "payment_terms_days", label: "Pay within (days)", type: "number" },
  { key: "address", label: "Address", type: "textarea" }, { key: "notes", label: "Notes", type: "textarea" },
];

export default function SupplierRecord({ params }: { params: { id: string } }) {
  return <SimpleRecord table="suppliers" id={params.id} fields={FIELDS} backHref="/purchasing" backLabel="Purchasing" endpoint="/api/purchasing/supplier"
    title={(r) => r.name} subtitle={(r) => (r.payment_terms_days ? `Pay within ${r.payment_terms_days} days` : "Pay on delivery")}
    buildRequest={(clinicId, row, f) => ({ clinicId, id: row.id, supplier: { ...f, payment_terms_days: Number(f.payment_terms_days || 0) } })} />;
}
