"use client";

import RecordForm, { type Field } from "@/components/RecordForm";

const FIELDS: Field[] = [
  { key: "name", label: "Item name", required: true },
  { key: "category", label: "Category", type: "select", required: true, options: [["medicine", "Medicine"], ["consumable", "Consumable"], ["equipment", "Equipment"], ["lab_supply", "Lab supply"], ["other", "Other"]].map(([value, label]) => ({ value, label })) },
  { key: "quantity", label: "Quantity in stock", type: "number", required: true, min: 0 }, { key: "min_quantity", label: "Reorder level", type: "number", required: true, min: 0, help: "You are warned when the quantity falls to this." },
  { key: "unit", label: "Unit" }, { key: "unit_price", label: "Price per unit (₹)", type: "number", min: 0 },
  { key: "supplier", label: "Supplier" }, { key: "expiry_date", label: "Expiry date", type: "date" },
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function StockRecord({ params }: { params: { id: string } }) {
  return <RecordForm table="stock_items" id={params.id} fields={FIELDS} backHref="/stock" backLabel="Stock"
    title={(r) => r.name} subtitle={(r) => `${r.quantity} ${r.unit ?? ""} in stock`}
    clean={(p) => ({ ...p, updated_at: new Date().toISOString() })} />;
}
