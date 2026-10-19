/**
 * Agent tools beyond schema building. Two surfaces, one rule each:
 *   BUILDER (admin):   booking rules, permission sets, flows            (applied through builder_apply_plan)
 *   ASSISTANT (anyone): reports and dashboards over data you can read   (applied through assistant_apply)
 * The person says it in plain words; a planner turns it into these steps; they approve; the database applies it in one
 * transaction (migration 013) and it can be undone. Nothing here writes SQL.
 */
import type { Schema } from "./types";

export interface ReportSpec {
  object: string; kind?: "number"; columns?: string[];
  filters?: { field: string; op: string; value?: string }[];
  group_by?: string; bucket?: "day" | "month"; aggregate?: "count" | "sum" | "avg" | "min" | "max"; agg_field?: string; limit?: number;
}
export interface PermObject { object: string; read?: boolean; create?: boolean; edit?: boolean; delete?: boolean; read_scope?: "all" | "own"; edit_scope?: "all" | "own" }

export type AgentStep =
  | { tool: "create_report"; args: { name: string; description?: string; chart?: "table" | "bar" | "pie" | "number"; spec: ReportSpec } }
  | { tool: "create_dashboard"; args: { name: string; description?: string; reports: string[] } }
  | { tool: "set_booking_rule"; args: { doctor_rule?: "usual_then_free" | "least_loaded" | "ask"; slot_minutes?: number } }
  | { tool: "create_permission_set"; args: { name: string; description?: string; objects: PermObject[]; assign_to?: string[]; assign_roles?: string[] } }
  | { tool: "create_flow"; args: { name: string; description?: string; trigger: FlowTrigger; conditions?: FlowCondition[]; actions: FlowAction[] } }
  | { tool: "set_flow_active"; args: { name: string; active: boolean } }
  | { tool: "configure_app"; args: { app: string; tab?: string; roles?: string[]; permission_sets?: string[]; everyone?: boolean; home_dashboard?: string } };

export const FLOW_EVENTS = ["appointment_booked", "appointment_cancelled", "appointment_completed", "appointment_no_show", "invoice_paid", "record_created", "record_updated", "stock_low", "day_before_appointment", "daily"] as const;
export type FlowEvent = (typeof FLOW_EVENTS)[number];
export interface FlowTrigger { event: FlowEvent; object?: string }
export interface FlowCondition { field: string; op: "eq" | "neq" | "gt" | "lt" | "contains"; value: string }
export type FlowAction =
  | { type: "send_whatsapp"; to?: "patient" | "doctor" | "admin"; template?: "confirmation" | "reminder" | "cancellation" | "thanks"; text?: string }
  | { type: "create_task"; title: string; priority?: "low" | "medium" | "high"; assigned_to?: string };
export const FLOW_EVENT_LABEL: Record<FlowEvent, string> = {
  appointment_booked: "an appointment is booked", appointment_cancelled: "an appointment is cancelled", appointment_completed: "an appointment is completed",
  appointment_no_show: "a patient does not show up", invoice_paid: "an invoice is paid", record_created: "a record is added", record_updated: "a record is changed",
  stock_low: "stock runs low", day_before_appointment: "it is the day before an appointment", daily: "every morning",
};

export type Surface = "builder" | "assistant";
const ASSISTANT_TOOLS = ["create_report", "create_dashboard"];

/** The built-in sources a report can read (kept in step with builder_src in migration 008). */
export const BUILTIN: Record<string, { label: string; dateField: string; fields: Record<string, "text" | "number" | "currency" | "date" | "datetime"> }> = {
  appointments: { label: "Appointments", dateField: "appointment_date", fields: { appointment_date: "date", status: "text", mode: "text", source: "text", doctor: "text", patient: "text", consultation_fee: "currency", created_at: "datetime" } },
  invoices: { label: "Invoices", dateField: "created_at", fields: { invoice_number: "text", patient: "text", status: "text", payment_method: "text", subtotal: "currency", gst_amount: "currency", total: "currency", paid_amount: "currency", created_at: "datetime" } },
  patients: { label: "Patients", dateField: "created_at", fields: { name: "text", phone: "text", gender: "text", blood_group: "text", created_at: "datetime" } },
  stock: { label: "Stock", dateField: "created_at", fields: { name: "text", category: "text", quantity: "number", min_quantity: "number", unit_price: "currency", supplier: "text", expiry_date: "date", created_at: "datetime" } },
};
export const DOCTOR_RULES = ["usual_then_free", "least_loaded", "ask"] as const;
const ROLES = ["doctor", "intern", "nurse", "receptionist"];
export const VIS_ROLES = ["admin", "doctor", "nurse", "receptionist", "intern"];
export const SYSTEM_APPS: { api: string; label: string; tabs: string[] }[] = [
  { api: "sys_booking", label: "Booking", tabs: ["Patients", "Appointments", "Calendar", "Availability"] },
  { api: "sys_clinical", label: "Clinical", tabs: ["Treatments", "Tasks"] },
  { api: "sys_payments", label: "Payments", tabs: ["Invoices", "Pending payments", "Payment history"] },
  { api: "sys_inventory", label: "Inventory", tabs: ["Stock", "Purchase orders", "Distributors", "Supplier bills"] },
  { api: "sys_admin", label: "Administration", tabs: ["Users", "Staff", "Permissions", "Attendance", "Leave", "Settings"] },
  { api: "sys_builder", label: "Builder", tabs: ["Build with AI", "Data", "Reports & dashboards", "Automation flows"] },
];
const SOURCE_WORDS: [RegExp, string][] = [[/\bappointments?\b|\bvisits?\b|\bbookings?\b/, "appointments"], [/\binvoices?\b|\brevenue\b|\bbilling\b|\bcollections?\b|\bpayments?\b|\bsales\b|\bdues?\b/, "invoices"], [/\bpatients?\b/, "patients"], [/\bstock\b|\binventory\b|\bmedicines?\b/, "stock"]];

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const apiName = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 41);

/** Fields of a source, whether built in or built by the admin. */
export function fieldsOf(object: string, schema: Schema): Record<string, string> | null {
  if (BUILTIN[object]) return BUILTIN[object].fields;
  const o = schema.objects.find((x) => x.api_name === object);
  if (!o) return null;
  return Object.fromEntries([["name", "text"], ...o.fields.map((f) => [f.api_name, f.data_type] as [string, string])]);
}

/* ───────────────────────── validation ───────────────────────── */

export function normalizeAgentStep(s: any, schema: Schema, where: string, errors: string[], reports: Set<string>, surface: Surface = "builder"): AgentStep | null {
  const a = s?.args ?? {};
  if (surface === "builder" && ASSISTANT_TOOLS.includes(s?.tool)) { errors.push(`${where}: reports and dashboards are made in the AI Assistant chat (everyone can use it), not in the Builder`); return null; }
  if (surface === "assistant" && !ASSISTANT_TOOLS.includes(s?.tool)) { errors.push(`${where}: the assistant can only save reports and dashboards. Ask an admin to use the Builder for that`); return null; }
  switch (s?.tool) {
    case "create_report": {
      const name = String(a.name ?? "").trim();
      if (name.length < 2 || name.length > 80) { errors.push(`${where}: give the report a name`); return null; }
      const sp = a.spec ?? {};
      const object = String(sp.object ?? "");
      const fields = fieldsOf(object, schema);
      if (!fields) { errors.push(`${where}: report source "${object}" does not exist`); return null; }
      const spec: ReportSpec = { object };
      if (sp.kind === "number") spec.kind = "number";
      if (Array.isArray(sp.columns)) { const bad = sp.columns.find((c: any) => !(c in fields)); if (bad) { errors.push(`${where}: "${bad}" is not a field of ${object}`); return null; } spec.columns = sp.columns.map(String).slice(0, 20); }
      if (Array.isArray(sp.filters)) {
        spec.filters = [];
        for (const f of sp.filters.slice(0, 10)) {
          if (!(String(f?.field) in fields)) { errors.push(`${where}: "${f?.field}" is not a field of ${object}`); return null; }
          if (!["eq", "neq", "gt", "gte", "lt", "lte", "contains", "empty", "notempty"].includes(f.op ?? "eq")) { errors.push(`${where}: unknown filter "${f.op}"`); return null; }
          spec.filters.push({ field: String(f.field), op: f.op ?? "eq", value: f.value == null ? undefined : String(f.value) });
        }
      }
      if (sp.group_by) { if (!(String(sp.group_by) in fields)) { errors.push(`${where}: cannot group by "${sp.group_by}"`); return null; } spec.group_by = String(sp.group_by); if (sp.bucket === "day" || sp.bucket === "month") spec.bucket = sp.bucket; }
      spec.aggregate = ["count", "sum", "avg", "min", "max"].includes(sp.aggregate) ? sp.aggregate : "count";
      if (spec.aggregate !== "count") {
        const t = fields[String(sp.agg_field)];
        if (t !== "number" && t !== "currency") { errors.push(`${where}: ${spec.aggregate} needs a number or currency field`); return null; }
        spec.agg_field = String(sp.agg_field);
      }
      if (!spec.group_by && !spec.kind && !spec.columns) { /* plain rows report */ }
      const chart = ["table", "bar", "pie", "number"].includes(a.chart) ? a.chart : spec.kind === "number" ? "number" : spec.group_by ? "bar" : "table";
      reports.add(name.toLowerCase());
      return { tool: "create_report", args: { name, description: a.description ? String(a.description).slice(0, 300) : undefined, chart, spec } };
    }
    case "create_dashboard": {
      const name = String(a.name ?? "").trim();
      if (name.length < 2 || name.length > 80) { errors.push(`${where}: give the dashboard a name`); return null; }
      const names: string[] = Array.isArray(a.reports) ? a.reports.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 12) : [];
      if (!names.length) { errors.push(`${where}: a dashboard needs at least one report`); return null; }
      return { tool: "create_dashboard", args: { name, description: a.description ? String(a.description).slice(0, 300) : undefined, reports: names } };
    }
    case "set_booking_rule": {
      const out: AgentStep & { tool: "set_booking_rule" } = { tool: "set_booking_rule", args: {} };
      if (a.doctor_rule !== undefined) { if (!DOCTOR_RULES.includes(a.doctor_rule)) { errors.push(`${where}: doctor rule must be ${DOCTOR_RULES.join(", ")}`); return null; } out.args.doctor_rule = a.doctor_rule; }
      if (a.slot_minutes !== undefined) { const m = Number(a.slot_minutes); if (!Number.isInteger(m) || m < 5 || m > 120) { errors.push(`${where}: slot length must be 5 to 120 minutes`); return null; } out.args.slot_minutes = m; }
      if (!Object.keys(out.args).length) { errors.push(`${where}: nothing to change`); return null; }
      return out;
    }
    case "create_permission_set": {
      const name = String(a.name ?? "").trim();
      if (name.length < 2 || name.length > 60) { errors.push(`${where}: give the permission set a name`); return null; }
      if (!Array.isArray(a.objects) || !a.objects.length) { errors.push(`${where}: choose at least one table`); return null; }
      const objects: PermObject[] = [];
      for (const o of a.objects.slice(0, 30)) {
        const api = String(o?.object ?? "");
        if (!fieldsOf(api, schema)) { errors.push(`${where}: table "${api}" does not exist`); return null; }
        objects.push({ object: api, read: o.read !== false, create: !!o.create, edit: !!o.edit, delete: !!o.delete, read_scope: o.read_scope === "own" ? "own" : "all", edit_scope: o.edit_scope === "all" ? "all" : "own" });
      }
      const roles: string[] = Array.isArray(a.assign_roles) ? a.assign_roles.map(String) : [];
      if (roles.some((r) => !ROLES.includes(r))) { errors.push(`${where}: roles can be ${ROLES.join(", ")}`); return null; }
      return { tool: "create_permission_set", args: { name, description: a.description ? String(a.description).slice(0, 300) : undefined, objects, assign_to: Array.isArray(a.assign_to) ? a.assign_to.map(String).slice(0, 30) : undefined, assign_roles: roles.length ? roles : undefined } };
    }
    case "create_flow": {
      const name = String(a.name ?? "").trim();
      if (name.length < 2 || name.length > 80) { errors.push(`${where}: give the flow a name`); return null; }
      const event = a.trigger?.event as FlowEvent;
      if (!FLOW_EVENTS.includes(event)) { errors.push(`${where}: unknown trigger "${a.trigger?.event}". Use one of: ${FLOW_EVENTS.join(", ")}`); return null; }
      let object: string | undefined;
      if (event === "record_created" || event === "record_updated") {
        object = apiName(String(a.trigger?.object ?? ""));
        if (!schema.objects.some((o) => o.api_name === object && !o.is_system)) { errors.push(`${where}: the table "${a.trigger?.object ?? ""}" for this trigger does not exist`); return null; }
      }
      if (!Array.isArray(a.actions) || !a.actions.length || a.actions.length > 5) { errors.push(`${where}: a flow needs 1 to 5 actions`); return null; }
      const actions: FlowAction[] = [];
      for (const x of a.actions) {
        if (x?.type === "send_whatsapp") {
          const to = x.to ?? "patient";
          if (!["patient", "doctor", "admin"].includes(to)) { errors.push(`${where}: send to patient, doctor or admin`); return null; }
          const template = x.template;
          if (template !== undefined && !["confirmation", "reminder", "cancellation", "thanks"].includes(template)) { errors.push(`${where}: unknown message template "${template}"`); return null; }
          const text = x.text ? String(x.text).slice(0, 500) : undefined;
          if (!template && !text) { errors.push(`${where}: a message needs a template or some text`); return null; }
          actions.push({ type: "send_whatsapp", to, template, text });
        } else if (x?.type === "create_task") {
          const title = String(x.title ?? "").trim().slice(0, 120);
          if (title.length < 2) { errors.push(`${where}: a task needs a title`); return null; }
          actions.push({ type: "create_task", title, priority: ["low", "medium", "high"].includes(x.priority) ? x.priority : undefined, assigned_to: x.assigned_to ? String(x.assigned_to).slice(0, 60) : undefined });
        } else { errors.push(`${where}: a flow action can be send_whatsapp or create_task`); return null; }
      }
      const conditions: FlowCondition[] = (Array.isArray(a.conditions) ? a.conditions : []).slice(0, 5).filter((c: any) => c?.field && ["eq", "neq", "gt", "lt", "contains"].includes(c.op)).map((c: any) => ({ field: String(c.field), op: c.op, value: String(c.value ?? "") }));
      return { tool: "create_flow", args: { name, description: a.description ? String(a.description).slice(0, 300) : undefined, trigger: { event, object }, conditions: conditions.length ? conditions : undefined, actions } };
    }
    case "set_flow_active": {
      const name = String(a.name ?? "").trim();
      if (!name) { errors.push(`${where}: which flow?`); return null; }
      return { tool: "set_flow_active", args: { name, active: a.active !== false } };
    }
  }
  return null;
}

export function describeFlowAction(x: FlowAction): string {
  return x.type === "send_whatsapp" ? `send ${x.template ? `the ${x.template} message` : `“${x.text}”`} to the ${x.to ?? "patient"} on WhatsApp` : `create a task “${x.title}”`;
}

export function describeAgentStep(s: AgentStep): string {
  switch (s.tool) {
    case "create_report": {
      const sp = s.args.spec;
      const what = sp.kind === "number" || sp.group_by ? `${sp.aggregate === "count" || !sp.aggregate ? "count" : `${sp.aggregate} of ${sp.agg_field}`}${sp.group_by ? ` by ${sp.group_by}${sp.bucket ? ` (${sp.bucket})` : ""}` : ""}` : "list of records";
      const flt = sp.filters?.length ? `, where ${sp.filters.map((f) => `${f.field} ${f.op === "eq" ? "is" : f.op === "neq" ? "is not" : f.op}${f.value ? " " + f.value : ""}`).join(" and ")}` : "";
      return `Save report “${s.args.name}”: ${what} on ${sp.object}${flt} (${s.args.chart})`;
    }
    case "create_dashboard": return `Create dashboard “${s.args.name}” with ${s.args.reports.length} report${s.args.reports.length > 1 ? "s" : ""}: ${s.args.reports.join(", ")}`;
    case "set_booking_rule": {
      const p: string[] = [];
      if (s.args.doctor_rule) p.push(`doctor choice = ${{ usual_then_free: "patient's usual doctor, else next free", least_loaded: "least busy doctor", ask: "ask the receptionist" }[s.args.doctor_rule]}`);
      if (s.args.slot_minutes) p.push(`appointment slot = ${s.args.slot_minutes} minutes`);
      return `Change booking rules: ${p.join("; ")}`;
    }
    case "create_flow": return `Create flow “${s.args.name}”: when ${FLOW_EVENT_LABEL[s.args.trigger.event]}${s.args.trigger.object ? ` (${s.args.trigger.object})` : ""}${s.args.conditions?.length ? `, and ${s.args.conditions.map((c) => `${c.field} ${c.op === "eq" ? "is" : c.op} ${c.value}`).join(" and ")}` : ""} → ${s.args.actions.map(describeFlowAction).join(", then ")}`;
    case "configure_app": {
      const who = s.args.everyone ? "everyone" : [...(s.args.roles ?? []).map((r) => r + "s"), ...(s.args.permission_sets ?? []).map((n) => `“${n}” permission set`)].join(", ");
      const target = s.args.tab ? `the “${s.args.tab}” tab of ${s.args.app}` : s.args.app;
      return s.args.home_dashboard && !who ? `Make “${s.args.home_dashboard}” the home dashboard of ${s.args.app}` : `Show ${target} to: ${who || "unchanged"}${s.args.home_dashboard ? `; home dashboard “${s.args.home_dashboard}”` : ""} (admins always see everything)`;
    }
    case "set_flow_active": return `${s.args.active ? "Turn on" : "Pause"} flow “${s.args.name}”`;
    case "create_permission_set": {
      const rights = (o: PermObject) => [o.read && "see", o.create && "add", o.edit && "change", o.delete && "delete"].filter(Boolean).join("/") + (o.read_scope === "own" ? " (own records only)" : "");
      const who = [...(s.args.assign_roles?.map((r) => r + "s") ?? []), ...(s.args.assign_to ?? [])];
      return `Create permission set “${s.args.name}”: ${s.args.objects.map((o) => `${o.object} → ${rights(o)}`).join("; ")}${who.length ? `; give it to ${who.join(", ")}` : ""}`;
    }
  }
}

/* ─────────────── plain-language parsing (used without an external AI) ─────────────── */

const GROUPS: [RegExp, (src: string) => { field: string; bucket?: "day" | "month" } | null][] = [
  [/\bmonth(?:ly)?\b/, (s) => ({ field: BUILTIN[s]?.dateField ?? "created_at", bucket: "month" })],
  [/\b(?:day|daily|date)\b/, (s) => ({ field: BUILTIN[s]?.dateField ?? "created_at", bucket: "day" })],
  [/\bdoctors?\b/, (s) => (s === "appointments" ? { field: "doctor" } : null)],
  [/\bpayment (?:method|mode)s?\b|\bmethod\b/, (s) => (s === "invoices" ? { field: "payment_method" } : null)],
  [/\bstatus\b/, (s) => (BUILTIN[s]?.fields.status ? { field: "status" } : null)],
  [/\bgender\b/, (s) => (s === "patients" ? { field: "gender" } : null)],
  [/\bblood group\b/, (s) => (s === "patients" ? { field: "blood_group" } : null)],
  [/\bcategory\b/, (s) => (s === "stock" ? { field: "category" } : null)],
  [/\bsupplier\b/, (s) => (s === "stock" ? { field: "supplier" } : null)],
  [/\b(?:booked via|source|channel)\b/, (s) => (s === "appointments" ? { field: "source" } : null)],
  [/\bmode\b/, (s) => (s === "appointments" ? { field: "mode" } : null)],
];

/** "appointments by doctor", "unpaid invoices by month", "total revenue by payment method", "patients by gender" … */
export function parseReportPhrase(text: string, schema: Schema): { name: string; chart: "bar" | "pie" | "number" | "table"; spec: ReportSpec } | null {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim().replace(/^(?:a |an |the |me |my )+/, "").replace(/^(?:report|chart|graph)s?\s+(?:of|on|for|showing)?\s*/, "");
  let object = SOURCE_WORDS.find(([re]) => re.test(t))?.[1];
  if (!object) for (const o of schema.objects) if (!o.is_system && (t.includes(o.api_name.replace(/_/g, " ")) || t.includes((o.plural_label || o.label).toLowerCase()))) object = o.api_name;
  if (!object) return null;
  const by = t.match(/\b(?:by|per|each|across)\s+(.+)$/);
  const spec: ReportSpec = { object, aggregate: "count" };
  const fields = fieldsOf(object, schema) ?? {};
  if (by) {
    let g = BUILTIN[object] ? GROUPS.map(([re, fn]) => (re.test(by[1]) ? fn(object!) : null)).find(Boolean) : null;
    if (!g) { const f = Object.keys(fields).find((k) => by[1].includes(k.replace(/_/g, " "))); if (f) g = { field: f }; }
    if (!g) return null;
    spec.group_by = g.field; if (g.bucket) spec.bucket = g.bucket;
  }
  if (object === "invoices") {
    const money = /\b(?:revenue|total|amount|sales|billed|collected|collections?|paid|dues?|outstanding|unpaid|pending)\b/.test(t);
    if (money) { spec.aggregate = "sum"; spec.agg_field = /\b(?:collected|collections?|paid)\b/.test(t) && !/\bunpaid\b/.test(t) ? "paid_amount" : "total"; }
    if (/\b(?:unpaid|pending|outstanding|dues?)\b/.test(t)) spec.filters = [{ field: "status", op: "neq", value: "paid" }, { field: "status", op: "neq", value: "cancelled" }];
  } else if (object === "appointments") {
    const st = t.match(/\b(cancelled|completed|confirmed|no[- ]show)s?\b/);
    if (st) spec.filters = [{ field: "status", op: "eq", value: st[1].replace(/[- ]/, "_") }];
  } else if (object === "stock" && /\blow\b/.test(t) && !spec.group_by) { return null; }
  if (!spec.group_by) { if (/\b(?:how many|number of|count|total number)\b/.test(t) || spec.aggregate !== "count") spec.kind = "number"; else return null; }
  const chart = spec.kind === "number" ? "number" : spec.bucket ? "bar" : /status|gender|method|mode|source|blood/.test(spec.group_by ?? "") ? "pie" : "bar";
  const label = titleCase(t.replace(/^(?:show|create|make|build|add)\s+/, "").replace(/\b(?:report|chart|graph)\b/g, "").replace(/\s+/g, " ").trim());
  return { name: label.slice(0, 80) || "Report", chart, spec };
}

/** Admin requests for the Builder: booking rules, permission sets, flows. Null when the sentence is not about these. */
/** "for nurses only", "only doctors and nurses can see it", "visible to everyone". Returns roles (admin included only if named), or "everyone", or null when nothing is said. */
export function parseAudience(p: string): { roles: string[] } | "everyone" | null {
  const t = p.toLowerCase();
  if (/\b(?:for|to|visible to|shown to)\s+everyone\b|\bevery(?:one|body)\s+can\s+(?:see|use|access)\b/.test(t)) return "everyone";
  if (!/\b(?:only|for|to|visible|hide|hidden|from|except|can (?:see|use|access|view))\b/.test(t)) return null;
  const named = VIS_ROLES.filter((r) => new RegExp(`\\b${r}s?\\b`).test(t));
  if (!named.length) return null;
  if (/\b(?:hide|hidden|except|not (?:be )?visible|without)\b/.test(t)) { const rest = VIS_ROLES.filter((r) => r !== "admin" && !named.includes(r)); return rest.length ? { roles: rest } : null; }
  return /\bonly\b|\bfor\b|\bto\b|\bvisible\b|\bcan\b/.test(t) ? { roles: named } : null;
}

/** Change who can see an existing app or one of its tabs: "only doctors and nurses can see Inpatient", "hide the Staff tab in Administration from receptionists". */
export function parseVisibility(p: string, schema: Schema): { steps: AgentStep[]; message: string } | { error: string } | null {
  const t = p.toLowerCase();
  if (!/\b(?:see|view|access|visible|hide|hidden|show|restrict|only)\b/.test(t) || /\b(?:create|build|make|set up|setup)\s+(?:an?\s+|the\s+)?.+\s+app\b/.test(t)) return null;
  const apps = [...schema.apps.map((a) => ({ api: a.api_name, label: a.label, tabs: a.tabs.map((x) => x.label) })), ...SYSTEM_APPS];
  const app = apps.find((a) => t.includes(a.label.toLowerCase()) || t.includes(a.api.replace(/_/g, " ")));
  if (!app) return null;
  let tab: string | undefined;
  const known = app.tabs.find((x) => new RegExp(`\\b${x.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+tab\\b`).test(t));
  if (known) tab = known;
  else { const tm = t.match(/\bthe\s+([a-z][a-z &-]{1,30}?)\s+tab\b/); if (tm) return { error: `${app.label} has no tab called “${tm[1].trim()}”. Its tabs: ${app.tabs.join(", ") || "none"}.` }; }
  const aud = parseAudience(p);
  if (!aud) return { error: "Who should see it: everyone, or certain roles (admin, doctor, nurse, receptionist, intern)?" };
  const args: { app: string; tab?: string; roles?: string[]; everyone?: boolean } = { app: app.api };
  if (tab) args.tab = tab;
  if (aud === "everyone") args.everyone = true; else args.roles = aud.roles;
  const st: AgentStep = { tool: "configure_app", args };
  return { steps: [st], message: describeAgentStep(st) + "." };
}

export function parseBuilderRequest(prompt: string, schema: Schema): { steps: AgentStep[]; message: string } | { error: string } | null {
  const p = prompt.trim().replace(/\s+/g, " ");

  // who can see an app or tab
  const vis = parseVisibility(p, schema);
  if (vis) return vis;

  // booking rules
  const slot = p.match(/\b(?:slot|appointment)s?\s*(?:length|duration|size|time)?\D{0,20}?(\d{1,3})\s*(?:min|minutes)\b/i) ?? p.match(/\b(\d{1,3})\s*(?:min|minute)\s*(?:slots?|appointments?)\b/i);
  const rule = /\b(?:doctor|booking|assignment)\s*(?:rule|choice|assign\w*)|\bassign\w*\s+(?:the\s+)?doctor|\bleast (?:busy|loaded)|\busual doctor\b|\bask (?:the )?receptionist\b/i.test(p);
  if (slot || rule) {
    const args: { doctor_rule?: "usual_then_free" | "least_loaded" | "ask"; slot_minutes?: number } = {};
    if (rule) args.doctor_rule = /least (?:busy|loaded)|first free|free(?:st)? doctor|balanc/i.test(p) ? "least_loaded" : /\bask\b/i.test(p) ? "ask" : /usual|same doctor|regular|continu/i.test(p) ? "usual_then_free" : undefined;
    if (slot) args.slot_minutes = Number(slot[1]);
    if (args.doctor_rule === undefined) delete args.doctor_rule;
    if (!Object.keys(args).length) return { error: "Which doctor rule would you like: the patient's usual doctor then the next free one, the least busy doctor, or ask the receptionist?" };
    const s: AgentStep = { tool: "set_booking_rule", args };
    return { steps: [s], message: describeAgentStep(s) + "." };
  }

  // permission sets: "give nurses read access to aligner", "let receptionists add and edit lab orders", "Priya can only see her own patients"
  const perm = p.match(/\b(?:give|let|allow|grant)\s+(.+?)\s+(?:(read|view|full|edit|write)\s+)?access\s+to\s+(.+)$/i) ?? p.match(/\b(?:let|allow)\s+(.+?)\s+((?:see|view|read|add|create|edit|change|delete)(?:\s*(?:,|and|&)\s*(?:see|view|read|add|create|edit|change|delete))*)\s+(?:the\s+)?(.+)$/i);
  if (perm) {
    const whoRaw = perm[1].toLowerCase();
    const level = (perm[2] ?? "read").toLowerCase();
    const targets = perm[3].split(/\s*(?:,|&|\band\b)\s*/).map((x) => x.replace(/\b(?:tables?|objects?|records?)\b/gi, "").trim()).filter(Boolean);
    const objs: PermObject[] = [];
    for (const tname of targets) {
      const key = apiName(tname.replace(/^(?:the|all|my)\s+/, ""));
      const hit = BUILTIN[key] ? key : Object.keys(BUILTIN).find((k) => k === apiName(tname.replace(/s$/, "")) || k === key.replace(/_?s$/, "")) ?? schema.objects.find((o) => !o.is_system && [o.api_name, apiName(o.label), apiName(o.plural_label || "")].some((n) => n === key || n === key.replace(/s$/, "")))?.api_name;
      if (!hit) return { error: `I couldn't find a table called “${tname}”. Tables I know: ${[...Object.keys(BUILTIN), ...schema.objects.filter((o) => !o.is_system).map((o) => o.api_name)].join(", ")}.` };
      const w = /edit|write|change|full|add|create/.test(level) || /\b(?:add|create|edit|change)\b/.test(perm[2] ?? "");
      objs.push({ object: hit, read: true, create: w, edit: w, delete: level === "full" || /\bdelete\b/.test(perm[2] ?? ""), read_scope: /\bown\b/.test(p) ? "own" : "all", edit_scope: "own" });
    }
    const roles = ROLES.filter((r) => new RegExp(`\\b${r}s?\\b`).test(whoRaw));
    const names = roles.length ? [] : whoRaw.split(/\s*(?:,|&|\band\b)\s*/).map((n) => titleCase(n.trim())).filter(Boolean);
    if (!roles.length && !names.length) return { error: "Who should get this access: a role (doctors, nurses, receptionists, interns) or a team member's name?" };
    const nameStr = objs.map((o) => o.object).join(" & ");
    const set: AgentStep = { tool: "create_permission_set", args: { name: titleCase(`${(roles[0] ?? names.join(" & "))} ${objs[0].create ? "can edit" : "can see"} ${nameStr}`.replace(/_/g, " ")).slice(0, 60), objects: objs, assign_roles: roles.length ? roles : undefined, assign_to: names.length ? names : undefined } };
    return { steps: [set], message: describeAgentStep(set) + ". Staff who join later need the set added in Access control." };
  }

  // flows: "remind patients the day before", "when an appointment is cancelled, create a task to call the patient"
  const fl = parseFlow(p, schema);
  if (fl) return fl;

  return null;
}


/** Anyone's requests for the Assistant: save a report or a dashboard. */
export function parseAssistantRequest(prompt: string, schema: Schema): { steps: AgentStep[]; message: string } | { error: string } | null {
  const p = prompt.trim().replace(/\s+/g, " ");
  // dashboards: "create a dashboard called Daily ops with appointments by doctor and unpaid invoices by month"
  const dash = p.match(/\b(?:create|make|build|add|set up|new)\s+(?:an?\s+|the\s+|my\s+)?(?:(.+?)\s+)?dashboard(?:\s+(?:called|named|for)\s+(.+?))?(?:\s+(?:with|showing|containing|of|that shows?)\s+(.+))?$/i);
  if (dash) {
    const given = (dash[2] ?? dash[1] ?? "").trim();
    const parts = (dash[3] ?? "").split(/\s*(?:,|&|\band\b|\bplus\b)\s*/).map((x) => x.trim()).filter(Boolean);
    const steps: AgentStep[] = [];
    const names: string[] = [];
    const bad: string[] = [];
    for (const part of parts) {
      const r = parseReportPhrase(part, schema);
      if (!r) { bad.push(part); continue; }
      steps.push({ tool: "create_report", args: { name: r.name, chart: r.chart, spec: r.spec } }); names.push(r.name);
    }
    if (bad.length) return { error: `I couldn't turn “${bad.join("”, “")}” into a report. Try wording like “appointments by doctor”, “unpaid invoices by month” or “patients by gender”.` };
    if (!names.length) return { error: "What should the dashboard show? For example: “Create a dashboard called Daily ops with appointments by doctor and unpaid invoices by month”." };
    const name = titleCase(given.replace(/^(?:called|named)\s+/i, "")) || "Dashboard";
    steps.push({ tool: "create_dashboard", args: { name, reports: names } });
    return { steps, message: `Create ${names.length} report${names.length > 1 ? "s" : ""} and the “${name}” dashboard that shows them.` };
  }

  // single report: "create a report of appointments by doctor", "show me unpaid invoices by month"
  const rep = p.match(/^(?:(?:create|make|build|add|save|new)\s+(?:an?\s+|the\s+|my\s+)?)?(?:report|chart|graph)\s+(?:of|on|for|showing)?\s*(.+)$/i) ?? p.match(/^(?:show|give|chart|graph|report)\s+(?:me\s+)?(.+\s(?:by|per)\s.+)$/i);
  if (rep) {
    const r = parseReportPhrase(rep[1], schema);
    if (!r) return { error: "I couldn't turn that into a report. Try “appointments by doctor”, “unpaid invoices by month”, “revenue by payment method” or “patients by gender”." };
    const s: AgentStep = { tool: "create_report", args: { name: r.name, chart: r.chart, spec: r.spec } };
    return { steps: [s], message: describeAgentStep(s) + ". It will appear in Reports." };
  }
  return null;
}

/** For the external AI's prompt: what it may use. */
export const ASSISTANT_TOOLS_PROMPT = `- create_report  {name, description?, chart?: "table"|"bar"|"pie"|"number", spec: {object, kind?: "number", columns?: string[], filters?: [{field, op: eq|neq|gt|gte|lt|lte|contains|empty|notempty, value?}], group_by?, bucket?: "day"|"month", aggregate?: "count"|"sum"|"avg"|"min"|"max", agg_field?}}
    object is a built-in source or one of the admin's own objects. Built-in sources and fields:
${Object.entries(BUILTIN).map(([k, v]) => `      ${k}: ${Object.entries(v.fields).map(([f, t]) => `${f}:${t}`).join(", ")}`).join("\n")}
    sum/avg need a number or currency agg_field. Group by a date field with bucket "month" or "day" for trends.
- create_dashboard {name, description?, reports: string[]}  -> reports are names of existing reports or reports created earlier in the same plan
- set_booking_rule {doctor_rule?: "usual_then_free"|"least_loaded"|"ask", slot_minutes?: 5..120}  -> how doctors are chosen and how long a slot is
- create_permission_set {name, description?, objects: [{object, read?, create?, edit?, delete?, read_scope?: "all"|"own", edit_scope?: "all"|"own"}], assign_roles?: ("doctor"|"intern"|"nurse"|"receptionist")[], assign_to?: string[] (team member names)}`;


/* ─────────────── flows in plain words ─────────────── */

const TRIGGERS: [RegExp, FlowEvent][] = [
  [/\bday before\b|\b(?:1|one) day (?:before|ahead)\b|\bthe evening before\b|\bahead of (?:the )?appointment/, "day_before_appointment"],
  [/\bappointment(?:s)? (?:is |are |gets? )?(?:booked|created|confirmed|made|scheduled)\b|\bnew appointment\b|\bwhen (?:someone|a patient) books\b|\bbooking is (?:made|confirmed)\b/, "appointment_booked"],
  [/\bappointment(?:s)? (?:is |are |gets? )?(?:cancelled|canceled)\b|\bcancellation\b/, "appointment_cancelled"],
  [/\bappointment(?:s)? (?:is |are |gets? )?(?:completed|done|finished)\b|\bvisit (?:is )?(?:completed|done)\b/, "appointment_completed"],
  [/\bno[- ]?show\b|\bmiss(?:es|ed)? (?:their |an? |the )?appointment\b|\bdoes not (?:show|turn) up\b/, "appointment_no_show"],
  [/\binvoice(?:s)? (?:is |are |gets? )?(?:paid|settled)\b|\bpayment (?:is )?(?:received|made)\b|\bpays? (?:the |an? )?(?:invoice|bill)\b/, "invoice_paid"],
  [/\bstock (?:runs?|is|gets?|falls?|goes) (?:low|below)\b|\blow stock\b|\bruns? out\b/, "stock_low"],
  [/\bevery (?:morning|day)\b|\bdaily\b|\beach (?:morning|day)\b/, "daily"],
];

export function parseFlow(p: string, schema: Schema): { steps: AgentStep[]; message: string } | { error: string } | null {
  if (!/\b(?:when|whenever|after|once|if|on|every|each|daily|remind|reminder)\b/i.test(p)) return null;
  if (!/\b(?:send|message|whatsapp|notify|tell|remind|reminder|create (?:a )?task|add (?:a )?task|task|text|inform|thank)\b/i.test(p)) return null;
  const t = p.toLowerCase();
  let event: FlowEvent | undefined; let object: string | undefined;
  const hit = TRIGGERS.find(([re]) => re.test(t));
  if (hit) event = hit[1];
  else {
    for (const o of schema.objects) {
      if (o.is_system) continue;
      const names = [o.label, o.plural_label, o.api_name.replace(/_/g, " ")].filter(Boolean).map((x) => x.toLowerCase());
      if (names.some((n) => t.includes(n))) {
        if (/\b(?:created|added|new|registered|saved)\b/.test(t)) { event = "record_created"; object = o.api_name; break; }
        if (/\b(?:updated|changed|edited|modified)\b/.test(t)) { event = "record_updated"; object = o.api_name; break; }
      }
    }
  }
  if (!event) return null;

  const actions: FlowAction[] = [];
  const to: "patient" | "doctor" | "admin" = /\b(?:the )?doctor\b(?! is)/.test(t.replace(/appointment with (?:the )?doctor/g, "")) && /(?:send|notify|tell|message|inform)[^.]*\bdoctor\b/.test(t) ? "doctor" : /\b(?:the )?(?:admin|owner|manager)\b/.test(t) && /(?:send|notify|tell|message|inform)[^.]*\b(?:admin|owner|manager)\b/.test(t) ? "admin" : "patient";
  const template: "confirmation" | "reminder" | "cancellation" | "thanks" | undefined = /\bremind|reminder\b/.test(t) ? "reminder" : /\bconfirm/.test(t) && event !== "appointment_booked" ? "confirmation" : /\bconfirm|confirmation\b/.test(t) ? "confirmation" : /\bcancel/.test(t) && event === "appointment_cancelled" ? "cancellation" : /\bthank/.test(t) ? "thanks" : undefined;
  const taskM = p.match(/\b(?:create|add|make)\s+(?:a\s+)?task\s*(?:to|for|called|named|:)?\s*(.+?)(?:\s+when\b|\s+after\b|\s+once\b|$)/i);
  if (taskM && taskM[1].trim().length > 1) actions.push({ type: "create_task", title: taskM[1].replace(/[."]+$/, "").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 120) });
  if (!taskM || /\b(?:send|whatsapp|message|notify|remind|thank)\b/.test(t)) {
    if (template) actions.push({ type: "send_whatsapp", to, template: template === "thanks" ? undefined : template, text: template === "thanks" ? "Thank you for visiting {{clinic}}, {{patient}}. We hope to see you again." : undefined });
    else {
      const q = p.match(/["“](.+?)["”]/);
      if (q) actions.push({ type: "send_whatsapp", to, text: q[1].slice(0, 500) });
      else if (!actions.length) return { error: "What should the message say? Put the words in quotes, e.g. “when an invoice is paid, send ‘Thank you {{patient}}!’ to the patient”, or ask for a reminder, a confirmation or a thank-you." };
    }
  }
  if (!actions.length) return null;
  const nameBase = actions.map((a) => (a.type === "send_whatsapp" ? (a.template === "reminder" ? "Reminder" : a.template === "confirmation" ? "Confirmation" : a.template === "cancellation" ? "Cancellation notice" : "Message") : "Task")).join(" + ");
  const name = `${nameBase} when ${FLOW_EVENT_LABEL[event].replace(/^it is /, "")}`.replace(/^./, (c) => c.toUpperCase()).slice(0, 80);
  const step: AgentStep = { tool: "create_flow", args: { name, trigger: { event, object }, actions } };
  return { steps: [step], message: describeAgentStep(step) + "." };
}

export const BUILDER_TOOLS_PROMPT = `- configure_app {app, tab?, roles?: ["admin"|"doctor"|"nurse"|"receptionist"|"intern"], permission_sets?: string[], everyone?: boolean, home_dashboard?: string}  -> who can see an app or one tab (admins always can); use after create_app, and ask the admin who should see a new app
- set_booking_rule {doctor_rule?: "usual_then_free"|"least_loaded"|"ask", slot_minutes?: 5..120}  -> how doctors are chosen and how long a slot is
- create_permission_set {name, description?, objects: [{object, read?, create?, edit?, delete?, read_scope?: "all"|"own", edit_scope?: "all"|"own"}], assign_roles?: ("doctor"|"intern"|"nurse"|"receptionist")[], assign_to?: string[] (team member names)}
    object is a built-in source (appointments, invoices, patients, stock) or one of the admin's own objects.
- create_flow {name, description?, trigger: {event, object?}, conditions?: [{field, op: eq|neq|gt|lt|contains, value}], actions: [1 to 5 of {type:"send_whatsapp", to?: "patient"|"doctor"|"admin", template?: "confirmation"|"reminder"|"cancellation"|"thanks", text?} | {type:"create_task", title, priority?: "low"|"medium"|"high"}]}
    event is one of: ${FLOW_EVENTS.join(", ")}. record_created / record_updated need trigger.object (one of the admin's own objects). text and title may use {{patient}} {{date}} {{time}} {{doctor}} {{clinic}}.
- set_flow_active {name, active}  -> pause or resume an existing flow
Reports and dashboards are NOT built here: tell the admin to ask the AI Assistant chat (every user can).`;
