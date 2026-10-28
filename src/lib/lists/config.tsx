import Link from "next/link";
import type { ReactNode } from "react";

export interface Col { key: string; label: string; sort?: string; defaultOn: boolean; render: (r: any) => ReactNode }
export interface Fil { key: string; label: string; column: string; kind: "select" | "doctor" | "from" | "to"; options?: [string, string][] }
export interface ListConfig {
  entity: string; title: string; subtitle?: string; table: string; select: string;
  searchCols: string[]; order: { col: string; asc: boolean }; cols: Col[]; filters: Fil[];
  href?: (r: any) => string; newHref?: string; newLabel?: string;
  /** extra search: returns PostgREST "or" parts that reach related tables (patient name, bill number…) */
  extraSearch?: (db: any, clinicId: string, term: string) => Promise<string[]>;
  /** adds data from other tables to the loaded rows (e.g. the bill numbers) */
  enrich?: (db: any, clinicId: string, rows: any[]) => Promise<any[]>;
}

const date = (d?: string) => { try { return d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"; } catch { return d ?? "—"; } };
const inr = (n: any) => `₹${Number(n ?? 0).toLocaleString("en-IN")}`;
const dash = <span className="text-slate-400">—</span>;
function pill(map: Record<string, string>) {
  return function renderPill(v: string) { return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${map[v] ?? "bg-gray-100 text-gray-500"}`}>{String(v ?? "").replace(/_/g, " ")}</span>; };
}
const clean = (s: string) => s.replace(/[,()%\\]/g, " ").trim();
const BILL: Record<string, string> = { invoiced: "Invoiced", part_paid: "Part paid", paid: "Paid & settled" };
const apptStatus = pill({ confirmed: "bg-sky-100 text-sky-700", completed: "bg-emerald-100 text-emerald-700", cancelled: "bg-red-100 text-red-600", no_show: "bg-amber-100 text-amber-700" });
const invStatus = pill({ draft: "bg-slate-100 text-slate-600", sent: "bg-sky-100 text-sky-700", paid: "bg-emerald-100 text-emerald-700", partially_paid: "bg-amber-100 text-amber-700", cancelled: "bg-red-100 text-red-600" });
const link = (href: string, text: ReactNode) => <Link href={href} onClick={(e) => e.stopPropagation()} className="font-medium text-sky-700 hover:underline">{text}</Link>;

export const LISTS: Record<string, ListConfig> = {
  appointments: {
    entity: "appointments", title: "All appointments", subtitle: "Newest bookings first", table: "appointments",
    select: "id, appt_no, appointment_date, appointment_time, status, billing_status, symptoms, created_at, doctor_id, clinic_patients(id, name, phone), doctors(name)",
    searchCols: ["symptoms", "appt_no"], order: { col: "created_at", asc: false }, href: (r) => `/appointments/${r.id}`, newHref: "/appointments?new=1", newLabel: "+ Book",
    cols: [
      { key: "no", label: "Appointment", sort: "appt_no", defaultOn: true, render: (r) => link(`/appointments/${r.id}`, r.appt_no ?? String(r.id).slice(0, 8)) },
      { key: "patient", label: "Patient", defaultOn: true, render: (r) => <><p className="font-medium text-slate-900">{r.clinic_patients?.name ?? "—"}</p><p className="text-xs text-slate-500">{r.clinic_patients?.phone ?? ""}</p></> },
      { key: "when", label: "Date & time", sort: "appointment_date", defaultOn: true, render: (r) => `${date(r.appointment_date)}, ${r.appointment_time}` },
      { key: "doctor", label: "Doctor", defaultOn: true, render: (r) => r.doctors?.name ?? "Duty doctor" },
      { key: "invoice", label: "Invoice", defaultOn: true, render: (r) => (r.invoices?.length ? r.invoices.map((v: any) => <span key={v.id} className="block">{link(`/billing/${v.id}`, v.invoice_number)}</span>) : dash) },
      { key: "issue", label: "Issue", defaultOn: true, render: (r) => <span className="block max-w-[260px] truncate" title={r.symptoms ?? ""}>{r.symptoms || dash}</span> },
      { key: "status", label: "Status", sort: "status", defaultOn: true, render: (r) => apptStatus(r.status) },
      { key: "next", label: "Next", defaultOn: true, render: (r) => {
        // the step this appointment is waiting at: treatment, then the bill, then done
        const btn = "inline-block px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold whitespace-nowrap";
        if (r.status === "cancelled" || r.status === "no_show") return dash;
        if (r.billing_status === "paid" || r.status === "completed") return <span className="text-emerald-700 text-xs font-semibold whitespace-nowrap">✓ Done</span>;
        const inv = r.invoices?.[0];
        if (inv) return <Link href={`/billing/${inv.id}`} onClick={(e) => e.stopPropagation()} className={btn}>Bill →</Link>;
        return <Link href={`/appointments/${r.id}`} onClick={(e) => e.stopPropagation()} className={btn}>Treatment →</Link>;
      } },
      { key: "billing", label: "Billing", sort: "billing_status", defaultOn: false, render: (r) => BILL[r.billing_status] ?? "Not billed" },
      { key: "booked", label: "Booked on", sort: "created_at", defaultOn: false, render: (r) => date(r.created_at) },
    ],
    filters: [
      { key: "status", label: "Status", column: "status", kind: "select", options: [["confirmed", "Confirmed"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["no_show", "No-show"]] },
      { key: "doctor", label: "Doctor", column: "doctor_id", kind: "doctor" },
      { key: "billing", label: "Billing", column: "billing_status", kind: "select", options: [["none", "Not billed"], ["invoiced", "Invoiced"], ["part_paid", "Part paid"], ["paid", "Paid & settled"]] },
      { key: "from", label: "Appointment from", column: "appointment_date", kind: "from" },
      { key: "to", label: "Appointment to", column: "appointment_date", kind: "to" },
    ],
    extraSearch: async (db, clinicId, term) => {
      const t = clean(term), like = `%${t}%`, digits = t.replace(/\D/g, "");
      const [p, i] = await Promise.all([
        db.from("clinic_patients").select("id").eq("clinic_id", clinicId).or(digits.length >= 4 ? `name.ilike.${like},phone_norm.ilike.%${digits}%` : `name.ilike.${like}`).limit(200),
        db.from("invoices").select("appointment_id").eq("clinic_id", clinicId).ilike("invoice_number", like).not("appointment_id", "is", null).limit(200),
      ]);
      const pids = (p.data ?? []).map((x: any) => x.id), aids = (i.data ?? []).map((x: any) => x.appointment_id);
      return [...(pids.length ? [`clinic_patient_id.in.(${pids.join(",")})`] : []), ...(aids.length ? [`id.in.(${aids.join(",")})`] : [])];
    },
    enrich: async (db, clinicId, rows) => {
      if (!rows.length) return rows;
      const inv = await db.from("invoices").select("id, appointment_id, invoice_number").eq("clinic_id", clinicId).in("appointment_id", rows.map((a) => a.id)).neq("status", "cancelled");
      const by: Record<string, any[]> = {};
      for (const v of inv.data ?? []) (by[v.appointment_id] ??= []).push(v);
      return rows.map((a) => ({ ...a, invoices: by[a.id] ?? [] }));
    },
  },
  patients: {
    entity: "patients", title: "All patients", subtitle: "Newest first", table: "clinic_patients",
    select: "id, name, phone, email, gender, blood_group, allergies, conditions, created_at",
    searchCols: ["name", "phone", "email"], order: { col: "created_at", asc: false }, href: (r) => `/patients/${r.id}`, newHref: "/patients", newLabel: "Patients screen",
    cols: [
      { key: "name", label: "Patient", sort: "name", defaultOn: true, render: (r) => link(`/patients/${r.id}`, r.name) },
      { key: "phone", label: "Phone", sort: "phone", defaultOn: true, render: (r) => r.phone ?? dash },
      { key: "email", label: "Email", sort: "email", defaultOn: false, render: (r) => r.email ?? dash },
      { key: "gender", label: "Gender", sort: "gender", defaultOn: true, render: (r) => r.gender ?? dash },
      { key: "blood", label: "Blood group", defaultOn: false, render: (r) => r.blood_group ?? dash },
      { key: "allergies", label: "Allergies", defaultOn: true, render: (r) => <span className="block max-w-[220px] truncate">{r.allergies || dash}</span> },
      { key: "conditions", label: "Conditions", defaultOn: false, render: (r) => <span className="block max-w-[220px] truncate">{r.conditions || dash}</span> },
      { key: "added", label: "Added on", sort: "created_at", defaultOn: true, render: (r) => date(r.created_at) },
    ],
    filters: [
      { key: "gender", label: "Gender", column: "gender", kind: "select", options: [["male", "Male"], ["female", "Female"], ["other", "Other"]] },
      { key: "from", label: "Added from", column: "created_at", kind: "from" }, { key: "to", label: "Added to", column: "created_at", kind: "to" },
    ],
  },
  invoices: {
    entity: "invoices", title: "All bills", subtitle: "Newest first", table: "invoices",
    select: "id, invoice_number, status, total, paid_amount, created_at, clinic_patients(name, phone)",
    searchCols: ["invoice_number"], order: { col: "created_at", asc: false }, href: (r) => `/billing/${r.id}`, newHref: "/billing", newLabel: "Billing screen",
    cols: [
      { key: "no", label: "Bill", sort: "invoice_number", defaultOn: true, render: (r) => link(`/billing/${r.id}`, r.invoice_number) },
      { key: "patient", label: "Patient", defaultOn: true, render: (r) => <><p className="font-medium text-slate-900">{r.clinic_patients?.name ?? "—"}</p><p className="text-xs text-slate-500">{r.clinic_patients?.phone ?? ""}</p></> },
      { key: "total", label: "Total", sort: "total", defaultOn: true, render: (r) => inr(r.total) },
      { key: "paid", label: "Paid", sort: "paid_amount", defaultOn: true, render: (r) => inr(r.paid_amount) },
      { key: "due", label: "Due", defaultOn: true, render: (r) => inr(Number(r.total ?? 0) - Number(r.paid_amount ?? 0)) },
      { key: "status", label: "Status", sort: "status", defaultOn: true, render: (r) => invStatus(r.status) },
      { key: "date", label: "Date", sort: "created_at", defaultOn: true, render: (r) => date(r.created_at) },
    ],
    filters: [
      { key: "status", label: "Status", column: "status", kind: "select", options: [["draft", "Draft"], ["sent", "Sent"], ["partially_paid", "Part paid"], ["paid", "Paid"], ["cancelled", "Cancelled"]] },
      { key: "from", label: "Date from", column: "created_at", kind: "from" }, { key: "to", label: "Date to", column: "created_at", kind: "to" },
    ],
    extraSearch: async (db, clinicId, term) => {
      const t = clean(term), like = `%${t}%`, digits = t.replace(/\D/g, "");
      const p = await db.from("clinic_patients").select("id").eq("clinic_id", clinicId).or(digits.length >= 4 ? `name.ilike.${like},phone_norm.ilike.%${digits}%` : `name.ilike.${like}`).limit(200);
      const ids = (p.data ?? []).map((x: any) => x.id);
      return ids.length ? [`clinic_patient_id.in.(${ids.join(",")})`] : [];
    },
  },
  stock: {
    entity: "stock", title: "All stock", subtitle: "A to Z", table: "stock_items",
    select: "id, name, category, quantity, min_quantity, unit, unit_price, supplier, expiry_date, created_at",
    searchCols: ["name", "supplier"], order: { col: "name", asc: true }, href: () => "/stock", newHref: "/stock", newLabel: "Stock screen",
    cols: [
      { key: "name", label: "Item", sort: "name", defaultOn: true, render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
      { key: "category", label: "Category", sort: "category", defaultOn: true, render: (r) => String(r.category ?? "").replace("_", " ") },
      { key: "qty", label: "In stock", sort: "quantity", defaultOn: true, render: (r) => <span className={r.quantity <= r.min_quantity ? "text-red-600 font-semibold" : ""}>{r.quantity} {r.unit}</span> },
      { key: "min", label: "Minimum", sort: "min_quantity", defaultOn: false, render: (r) => r.min_quantity },
      { key: "price", label: "Unit price", sort: "unit_price", defaultOn: true, render: (r) => inr(r.unit_price) },
      { key: "supplier", label: "Supplier", sort: "supplier", defaultOn: true, render: (r) => r.supplier ?? dash },
      { key: "expiry", label: "Expiry", sort: "expiry_date", defaultOn: true, render: (r) => date(r.expiry_date) },
    ],
    filters: [{ key: "category", label: "Category", column: "category", kind: "select", options: [["medicine", "Medicine"], ["consumable", "Consumable"], ["equipment", "Equipment"], ["lab_supply", "Lab supply"], ["other", "Other"]] }],
  },
  tasks: {
    entity: "tasks", title: "All tasks", subtitle: "Newest first", table: "clinic_tasks",
    select: "id, title, status, priority, assigned_to, due_date, created_at",
    searchCols: ["title", "description", "assigned_to"], order: { col: "created_at", asc: false }, href: () => "/tasks", newHref: "/tasks", newLabel: "Tasks board",
    cols: [
      { key: "title", label: "Task", sort: "title", defaultOn: true, render: (r) => <span className="font-medium text-slate-900">{r.title}</span> },
      { key: "status", label: "Status", sort: "status", defaultOn: true, render: (r) => pill({ todo: "bg-slate-100 text-slate-600", in_progress: "bg-sky-100 text-sky-700", done: "bg-emerald-100 text-emerald-700" })(r.status) },
      { key: "priority", label: "Priority", sort: "priority", defaultOn: true, render: (r) => pill({ high: "bg-red-100 text-red-600", medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600" })(r.priority) },
      { key: "assigned", label: "Assigned to", sort: "assigned_to", defaultOn: true, render: (r) => r.assigned_to ?? dash },
      { key: "due", label: "Due", sort: "due_date", defaultOn: true, render: (r) => date(r.due_date) },
      { key: "created", label: "Created", sort: "created_at", defaultOn: false, render: (r) => date(r.created_at) },
    ],
    filters: [
      { key: "status", label: "Status", column: "status", kind: "select", options: [["todo", "To do"], ["in_progress", "In progress"], ["done", "Done"]] },
      { key: "priority", label: "Priority", column: "priority", kind: "select", options: [["high", "High"], ["medium", "Medium"], ["low", "Low"]] },
    ],
  },
  sittings: {
    entity: "sittings", title: "All sittings", subtitle: "Newest first. Each sitting is billed and paid on its own", table: "treatment_sittings",
    select: "id, seq, label, status, due_amount, paid_amount, target_date, created_at, invoice_id, appointment_id, plan_id, treatment_plans(id, title, status, payment_status, total_amount, clinic_patients(id, name, phone))",
    searchCols: ["label"], order: { col: "created_at", asc: false }, href: (r) => (r.appointment_id ? `/appointments/${r.appointment_id}` : r.plan_id ? `/treatments` : "/sittings"), newHref: "/sittings?new=1", newLabel: "+ New sitting",
    cols: [
      { key: "sitting", label: "Sitting", sort: "label", defaultOn: true, render: (r) => <><p className="font-medium text-slate-900">{r.seq}. {r.label}</p><p className="text-xs text-slate-500">{r.treatment_plans?.title ?? "—"}</p></> },
      { key: "patient", label: "Patient", defaultOn: true, render: (r) => (r.treatment_plans?.clinic_patients ? link(`/patients/${r.treatment_plans.clinic_patients.id}`, r.treatment_plans.clinic_patients.name) : dash) },
      { key: "when", label: "Date", sort: "target_date", defaultOn: true, render: (r) => date(r.target_date) },
      { key: "cost", label: "Cost", sort: "due_amount", defaultOn: true, render: (r) => inr(r.due_amount) },
      { key: "paid", label: "Paid", sort: "paid_amount", defaultOn: true, render: (r) => inr(r.paid_amount) },
      { key: "pay", label: "Payment", defaultOn: true, render: (r) => { const d = Number(r.due_amount || 0), p = Number(r.paid_amount || 0); const v = d > 0 && p >= d ? "paid" : p > 0 ? "part_paid" : "unpaid"; return pill({ paid: "bg-emerald-100 text-emerald-700", part_paid: "bg-amber-100 text-amber-700", unpaid: "bg-slate-100 text-slate-600" })(v); } },
      { key: "status", label: "Status", sort: "status", defaultOn: true, render: (r) => pill({ pending: "bg-sky-100 text-sky-700", done: "bg-emerald-100 text-emerald-700", missed: "bg-amber-100 text-amber-700", cancelled: "bg-red-100 text-red-600" })(r.status) },
      { key: "invoice", label: "Invoice", defaultOn: true, render: (r) => (r.invoice_id ? link(`/billing/${r.invoice_id}`, "Open") : dash) },
      { key: "treatment", label: "Treatment status", defaultOn: false, render: (r) => String(r.treatment_plans?.payment_status ?? "").replace("_", " ") || "—" },
    ],
    filters: [
      { key: "status", label: "Status", column: "status", kind: "select", options: [["pending", "Pending"], ["done", "Done"], ["missed", "Missed"], ["cancelled", "Cancelled"]] },
      { key: "from", label: "Date from", column: "target_date", kind: "from" },
      { key: "to", label: "Date to", column: "target_date", kind: "to" },
    ],
    extraSearch: async (db, clinicId, term) => {
      const t = clean(term), like = `%${t}%`, digits = t.replace(/\D/g, "");
      const pats = await db.from("clinic_patients").select("id").eq("clinic_id", clinicId).or(digits.length >= 4 ? `name.ilike.${like},phone_norm.ilike.%${digits}%` : `name.ilike.${like}`).limit(200);
      const pids = (pats.data ?? []).map((x: any) => x.id);
      const [byPatient, byTitle] = await Promise.all([
        pids.length ? db.from("treatment_plans").select("id").eq("clinic_id", clinicId).in("clinic_patient_id", pids).limit(300) : Promise.resolve({ data: [] }),
        db.from("treatment_plans").select("id").eq("clinic_id", clinicId).ilike("title", like).limit(300),
      ]);
      const ids = Array.from(new Set([...(byPatient.data ?? []), ...(byTitle.data ?? [])].map((x: any) => x.id)));
      return ids.length ? [`plan_id.in.(${ids.join(",")})`] : [];
    },
  },
  treatments: {
    entity: "treatments", title: "Treatment templates", subtitle: "A to Z", table: "treatment_templates",
    select: "id, name, description, total_amount, sittings, is_active, created_at",
    searchCols: ["name", "description"], order: { col: "name", asc: true }, href: (r) => `/treatments/library/${r.id}`, newHref: "/treatments", newLabel: "Treatments screen",
    cols: [
      { key: "name", label: "Treatment", sort: "name", defaultOn: true, render: (r) => link(`/treatments/library/${r.id}`, r.name) },
      { key: "price", label: "Total price", sort: "total_amount", defaultOn: true, render: (r) => inr(r.total_amount) },
      { key: "sittings", label: "Sittings", defaultOn: true, render: (r) => (Array.isArray(r.sittings) ? r.sittings.length : 0) },
      { key: "active", label: "Active", sort: "is_active", defaultOn: true, render: (r) => (r.is_active ? "Yes" : "No") },
      { key: "desc", label: "Description", defaultOn: false, render: (r) => <span className="block max-w-[260px] truncate">{r.description || dash}</span> },
    ],
    filters: [{ key: "active", label: "Active", column: "is_active", kind: "select", options: [["true", "Active"], ["false", "Not active"]] }],
  },
};
