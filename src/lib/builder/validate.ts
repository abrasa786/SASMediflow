import { FIELD_TYPES, type FieldSpec, type FieldType, type Plan, type Schema, type Step } from "./types";

const MAX_STEPS = 40, MAX_FIELDS = 60, MAX_OBJECTS = 25, MAX_APPS = 15, MAX_TABS = 20;

export function toApiName(s: unknown): string {
  let n = String(s ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (/^[0-9]/.test(n)) n = "x_" + n;
  return n.slice(0, 41);
}
const okName = (n: string) => /^[a-z][a-z0-9_]{1,40}$/.test(n);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function normField(raw: any, errors: string[], where: string): FieldSpec | null {
  if (!raw || typeof raw !== "object") { errors.push(`${where}: field is missing`); return null; }
  const api = toApiName(raw.api_name ?? raw.label);
  if (!okName(api)) { errors.push(`${where}: "${raw.api_name ?? raw.label ?? ""}" is not a usable field name`); return null; }
  const type = (raw.data_type ?? "text") as FieldType;
  if (!FIELD_TYPES.includes(type)) { errors.push(`${where}: field "${api}" has unsupported type "${raw.data_type}"`); return null; }
  const out: FieldSpec = { api_name: api, label: String(raw.label || titleCase(api)).slice(0, 80), data_type: type };
  if (raw.required) out.required = true;
  if (raw.unique) out.unique = true;
  if (raw.help_text) out.help_text = String(raw.help_text).slice(0, 200);
  if (type === "picklist") {
    const vals = Array.isArray(raw.picklist_values) ? raw.picklist_values.map((v: any) => String(v).trim()).filter(Boolean) : [];
    if (!vals.length) { errors.push(`${where}: dropdown field "${api}" needs at least one value`); return null; }
    out.picklist_values = Array.from(new Set(vals)).slice(0, 50);
  }
  if (type === "lookup") out.lookup_object = toApiName(raw.lookup_object);
  return out;
}

/** Validate and normalise a plan against the current schema. Never trusts the planner (LLM) output. */
export function validatePlan(raw: any, schema: Schema): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || !Array.isArray(raw.steps) || raw.steps.length === 0) return { ok: false, errors: ["The plan has no steps."] };
  if (raw.steps.length > MAX_STEPS) return { ok: false, errors: [`A plan may contain at most ${MAX_STEPS} steps.`] };

  // simulated state
  const objects = new Map<string, Set<string>>();
  const objectFields = new Map<string, Map<string, FieldSpec["data_type"]>>();
  for (const o of schema.objects) {
    objects.set(o.api_name, new Set(o.fields.map((x) => x.api_name)));
    objectFields.set(o.api_name, new Map(o.fields.map((x) => [x.api_name, x.data_type])));
  }
  const apps = new Map<string, number>(schema.apps.map((a) => [a.api_name, a.tabs.length]));
  let customObjects = schema.objects.filter((o) => !o.is_system).length;

  const steps: Step[] = [];
  raw.steps.forEach((s: any, i: number) => {
    const where = `Step ${i + 1}`;
    const a = s?.args ?? {};
    switch (s?.tool) {
      case "create_object": {
        const api = toApiName(a.api_name ?? a.label);
        if (!okName(api)) { errors.push(`${where}: "${a.api_name ?? a.label ?? ""}" is not a usable object name`); return; }
        if (objects.has(api)) { errors.push(`${where}: object "${api}" already exists`); return; }
        if (++customObjects > MAX_OBJECTS) { errors.push(`${where}: a clinic can have at most ${MAX_OBJECTS} custom objects`); return; }
        objects.set(api, new Set(["name"]));
        objectFields.set(api, new Map([["name", "text"]]));
        const fields: FieldSpec[] = [];
        for (const rf of Array.isArray(a.fields) ? a.fields : []) {
          const nf = normField(rf, errors, `${where} (${api})`);
          if (!nf) continue;
          if (nf.api_name === "name") continue; // Name always exists
          if (objects.get(api)!.has(nf.api_name)) { errors.push(`${where}: field "${nf.api_name}" is listed twice`); continue; }
          if (nf.data_type === "lookup" && !(nf.lookup_object === api || objects.has(nf.lookup_object!))) {
            errors.push(`${where}: field "${nf.api_name}" points to "${nf.lookup_object}", which does not exist`); continue;
          }
          objects.get(api)!.add(nf.api_name);
          objectFields.get(api)!.set(nf.api_name, nf.data_type);
          fields.push(nf);
        }
        if (fields.length + 1 > MAX_FIELDS) { errors.push(`${where}: too many fields (max ${MAX_FIELDS})`); return; }
        const label = String(a.label || titleCase(api)).slice(0, 80);
        steps.push({ tool: "create_object", args: { api_name: api, label, plural_label: a.plural_label ? String(a.plural_label).slice(0, 80) : undefined, description: a.description ? String(a.description).slice(0, 300) : undefined, icon: a.icon ? String(a.icon).slice(0, 8) : undefined, fields } });
        return;
      }
      case "add_field": {
        const obj = toApiName(a.object);
        if (!objects.has(obj)) { errors.push(`${where}: object "${a.object}" does not exist`); return; }
        const nf = normField(a.field, errors, where);
        if (!nf) return;
        if (objects.get(obj)!.has(nf.api_name)) { errors.push(`${where}: "${obj}" already has a field "${nf.api_name}"`); return; }
        if (objects.get(obj)!.size >= MAX_FIELDS) { errors.push(`${where}: "${obj}" already has ${MAX_FIELDS} fields`); return; }
        if (nf.data_type === "lookup" && !objects.has(nf.lookup_object!)) { errors.push(`${where}: lookup target "${nf.lookup_object}" does not exist`); return; }
        objects.get(obj)!.add(nf.api_name);
        objectFields.get(obj)!.set(nf.api_name, nf.data_type);
        steps.push({ tool: "add_field", args: { object: obj, field: nf } });
        return;
      }
      case "hide_field": {
        const obj = toApiName(a.object), fld = toApiName(a.field);
        if (!objects.has(obj)) { errors.push(`${where}: object "${a.object}" does not exist`); return; }
        if (fld === "name") { errors.push(`${where}: the Name field cannot be hidden`); return; }
        if (!objects.get(obj)!.has(fld)) { errors.push(`${where}: "${obj}" has no field "${fld}"`); return; }
        objects.get(obj)!.delete(fld);
        steps.push({ tool: "hide_field", args: { object: obj, field: fld } });
        return;
      }
      case "create_app": {
        const api = toApiName(a.api_name ?? a.label);
        if (!okName(api)) { errors.push(`${where}: "${a.api_name ?? a.label ?? ""}" is not a usable app name`); return; }
        if (apps.has(api)) { errors.push(`${where}: app "${api}" already exists`); return; }
        if (apps.size >= MAX_APPS) { errors.push(`${where}: a clinic can have at most ${MAX_APPS} apps`); return; }
        const objs: string[] = [];
        for (const o of Array.isArray(a.objects) ? a.objects : []) {
          const on = toApiName(o);
          if (!objects.has(on)) { errors.push(`${where}: tab object "${o}" does not exist`); continue; }
          objs.push(on);
        }
        if (objs.length > MAX_TABS) { errors.push(`${where}: an app can have at most ${MAX_TABS} tabs`); return; }
        apps.set(api, objs.length);
        steps.push({ tool: "create_app", args: { api_name: api, label: String(a.label || titleCase(api)).slice(0, 80), icon: a.icon ? String(a.icon).slice(0, 8) : undefined, description: a.description ? String(a.description).slice(0, 300) : undefined, objects: objs } });
        return;
      }
      case "add_tab": {
        const app = toApiName(a.app);
        if (!apps.has(app)) { errors.push(`${where}: app "${a.app}" does not exist`); return; }
        const kind = a.kind ?? "object";
        if (!["object", "dashboard", "report", "page"].includes(kind)) { errors.push(`${where}: unsupported tab kind "${kind}"`); return; }
        let obj: string | undefined;
        if (kind === "object") {
          obj = toApiName(a.object);
          if (!objects.has(obj)) { errors.push(`${where}: tab object "${a.object}" does not exist`); return; }
        }
        if ((apps.get(app) ?? 0) >= MAX_TABS) { errors.push(`${where}: app "${app}" already has ${MAX_TABS} tabs`); return; }
        apps.set(app, (apps.get(app) ?? 0) + 1);
        steps.push({ tool: "add_tab", args: { app, kind, object: obj, label: a.label ? String(a.label).slice(0, 80) : undefined } });
        return;
      }
      default:
        errors.push(`${where}: "${s?.tool ?? "(missing)"}" is not a tool the builder can run`);
    }
  });

  if (errors.length) return { ok: false, errors };
  if (!steps.length) return { ok: false, errors: ["The plan has no valid steps."] };
  return { ok: true, plan: { summary: String(raw.summary || "Apply changes").slice(0, 300), steps, recommendations: Array.isArray(raw.recommendations) ? raw.recommendations : undefined } };
}

const TYPE_LABEL: Record<string, string> = {
  text: "text", long_text: "long text", number: "number", currency: "currency", date: "date", datetime: "date & time",
  boolean: "yes/no", picklist: "dropdown", email: "email", phone: "phone", url: "link", lookup: "link to record",
};

export function describeField(f: FieldSpec): string {
  let s = `${f.label || f.api_name} (${TYPE_LABEL[f.data_type || "text"]}`;
  if (f.data_type === "picklist" && f.picklist_values) s += `: ${f.picklist_values.slice(0, 5).join(", ")}${f.picklist_values.length > 5 ? "…" : ""}`;
  if (f.data_type === "lookup") s += ` → ${f.lookup_object}`;
  if (f.required) s += ", required";
  return s + ")";
}

export function describeStep(s: Step): string {
  switch (s.tool) {
    case "create_object":
      return `Create object “${s.args.label}” — a new table with fields: Name${(s.args.fields ?? []).length ? ", " + (s.args.fields ?? []).map(describeField).join(", ") : ""}`;
    case "add_field": return `Add field ${describeField(s.args.field)} to “${s.args.object}”`;
    case "hide_field": return `Hide field “${s.args.field}” on “${s.args.object}” (data is kept)`;
    case "create_app": return `Create app “${s.args.label}”${s.args.objects?.length ? " with tabs: " + s.args.objects.join(", ") : ""}`;
    case "add_tab": return `Add ${s.args.kind ?? "object"} tab${s.args.object ? ` “${s.args.object}”` : ""} to app “${s.args.app}”`;
  }
}
