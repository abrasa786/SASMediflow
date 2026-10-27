import type { Schema, SchemaObject } from "./types";

/**
 * The built-in record types. The Builder cannot add real columns to them (they are the core of the app), so a field the clinic adds
 * is described in custom_field_defs and its value is kept in the record's `custom` column. They show up on the record page.
 */
export const BUILTIN_RECORDS: Record<string, { table: string; label: string; plural: string; base: string[]; alias: RegExp }> = {
  patients:     { table: "clinic_patients", label: "Patient", plural: "Patients", alias: /^(clinic )?(patients?|patient records?)$/,
    base: ["name", "phone", "email", "dob", "gender", "blood_group", "allergies", "conditions", "medications", "address", "emergency_contact_name", "emergency_contact_phone", "notes"] },
  appointments: { table: "appointments", label: "Appointment", plural: "Appointments", alias: /^(appointments?|bookings?)$/,
    base: ["appointment_date", "appointment_time", "status", "mode", "symptoms", "notes", "consultation_fee", "source"] },
  invoices:     { table: "invoices", label: "Invoice", plural: "Invoices", alias: /^(invoices?|bills?|billing)$/,
    base: ["invoice_number", "items", "subtotal", "discount", "gst_percent", "gst_amount", "total", "paid_amount", "status", "payment_method", "notes"] },
  stock:        { table: "stock_items", label: "Stock item", plural: "Stock", alias: /^(stock|stock items?|inventory|medicines?|items?)$/,
    base: ["name", "category", "quantity", "min_quantity", "unit", "unit_price", "supplier", "expiry_date", "notes"] },
  tasks:        { table: "clinic_tasks", label: "Task", plural: "Tasks", alias: /^(tasks?|to-?dos?)$/,
    base: ["title", "description", "status", "priority", "assigned_to", "due_date"] },
  doctors:      { table: "doctors", label: "Doctor", plural: "Doctors", alias: /^(doctors?|dentists?|physicians?)$/,
    base: ["name", "speciality", "specialty", "phone", "email", "is_active"] },
};
export const isBuiltinName = (n: string) => Object.prototype.hasOwnProperty.call(BUILTIN_RECORDS, n);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** The normal schema plus the built-in record types (with the custom fields already added to each). Used only by the Builder's plan and apply. */
export async function loadSchemaWithBuiltins(db: any, clinicId: string, base: Schema): Promise<Schema> {
  let defs: any[] = [];
  try {
    const { data } = await db.from("custom_field_defs").select("entity, api_name, label, data_type, required, picklist_values").eq("clinic_id", clinicId).eq("status", "active").order("sort_order");
    defs = data ?? [];
  } catch { /* migration 024 not run yet: built-ins simply have no custom fields */ }
  const taken = new Set(base.objects.map((o) => o.api_name));
  const extra: SchemaObject[] = Object.entries(BUILTIN_RECORDS).filter(([api]) => !taken.has(api)).map(([api, b]) => ({
    api_name: api, label: b.label, plural_label: b.plural, is_system: true, builtin: true,
    fields: [
      ...b.base.map((f) => ({ api_name: f, label: titleCase(f), data_type: "text" as const })),
      ...defs.filter((d) => d.entity === api).map((d) => ({ api_name: d.api_name, label: d.label, data_type: d.data_type, required: d.required, picklist_values: d.picklist_values, custom: true })),
    ],
  }));
  return { ...base, objects: [...base.objects, ...extra] };
}
