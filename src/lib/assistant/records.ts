/**
 * Records by chat, for everyone on the team (access is enforced by the database as the signed-in person):
 *   "Add a lab test: name CBC, price 300"      -> asks for what's missing, confirms, saves
 *   "Update lab test CBC set price to 350"     -> finds the record, confirms, saves
 *   "Show lab tests" / "list lab orders for Anita" -> lists up to 10
 * New objects and fields are the Builder's job; here we only fill in what already exists.
 */
import type { Schema, SchemaField, SchemaObject } from "@/lib/builder/types";
import { isYes, type AxCtx, type AxReply } from "./common";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sing = (s: string) => s.toLowerCase().replace(/ies$/, "y").replace(/s$/, "");

export function findObject(schema: Schema, text: string): SchemaObject | null {
  const t = text.toLowerCase();
  let best: SchemaObject | null = null, len = 0;
  for (const o of schema.objects) {
    if (o.is_system) continue;
    for (const n of [o.label, o.plural_label, o.api_name.replace(/_/g, " ")]) {
      const k = n.toLowerCase();
      if (k.length > len && (t.includes(k) || t.includes(sing(k)))) { best = o; len = k.length; }
    }
  }
  return best;
}

function coerce(f: SchemaField, raw: string, today: string, parseDate: (t: string, d: string) => { date?: string }): { ok: true; v: any } | { ok: false; why: string } {
  const v = raw.trim().replace(/^["“']|["”']$/g, "").replace(/[.,]$/, "");
  switch (f.data_type) {
    case "number": case "currency": { const n = Number(v.replace(/[₹,\s]|rs\.?/gi, "")); return Number.isFinite(n) ? { ok: true, v: n } : { ok: false, why: `${f.label} should be a number` }; }
    case "boolean": return /^(yes|true|y|1|on)$/i.test(v) ? { ok: true, v: true } : /^(no|false|n|0|off)$/i.test(v) ? { ok: true, v: false } : { ok: false, why: `${f.label} should be yes or no` };
    case "date": case "datetime": { const d = parseDate(v, today).date ?? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined); return d ? { ok: true, v: d } : { ok: false, why: `I couldn't read “${v}” as a date` }; }
    case "picklist": { const hit = (f.picklist_values ?? []).find((p) => p.toLowerCase() === v.toLowerCase()); return hit ? { ok: true, v: hit } : { ok: false, why: `${f.label} must be one of: ${(f.picklist_values ?? []).join(", ")}` }; }
    case "email": return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? { ok: true, v } : { ok: false, why: `${f.label} should be an email address` };
    case "lookup": return { ok: true, v };      // resolved by name below
    default: return { ok: true, v };
  }
}

/** Pull "label value" pairs out of a sentence, using the object's own field labels. */
export function extractValues(obj: SchemaObject, text: string, today: string, parseDate: any): { values: Record<string, any>; problems: string[] } {
  const fields = obj.fields.filter((f) => f.api_name !== "id");
  const labels = fields.map((f) => ({ f, names: [f.label, f.api_name.replace(/_/g, " ")].map((x) => x.toLowerCase()) }));
  const alt = labels.flatMap((l) => l.names).sort((a, b) => b.length - a.length).map(esc).join("|");
  const values: Record<string, any> = {}; const problems: string[] = [];
  if (!alt) return { values, problems };
  const re = new RegExp(`\\b(${alt})\\b\\s*(?:=|:|is|of|as|to|-)?\\s*(.+?)(?=[,;]?\\s+\\b(?:${alt})\\b\\s*(?:=|:|is|of|as|to|-)?\\s|$)`, "gi");
  for (const m of Array.from(text.matchAll(re))) {
    const f = labels.find((l) => l.names.includes(m[1].toLowerCase()))?.f; if (!f || !m[2].trim()) continue;
    const r = coerce(f, m[2], today, parseDate);
    if (r.ok) values[f.api_name] = r.v; else problems.push(r.why);
  }
  return { values, problems };
}

async function resolveLookups(c: AxCtx, obj: SchemaObject, values: Record<string, any>): Promise<string | null> {
  for (const f of obj.fields) {
    if (f.data_type !== "lookup" || typeof values[f.api_name] !== "string" || /^[0-9a-f-]{36}$/i.test(values[f.api_name])) continue;
    const { data } = await c.db.rpc("builder_rec_list", { p: { clinic_id: c.clinicId, actor: c.userId, object: f.lookup_object, search: values[f.api_name], filters: [], limit: 5, offset: 0 } });
    const rows: any[] = data?.rows ?? [];
    if (rows.length !== 1) return rows.length ? `More than one ${f.label} matches “${values[f.api_name]}”. Please be more specific.` : `I couldn't find a ${f.label} called “${values[f.api_name]}”.`;
    values[f.api_name] = rows[0].id;
  }
  return null;
}

const show = (obj: SchemaObject, v: Record<string, any>) => Object.entries(v).map(([k, x]) => `${obj.fields.find((f) => f.api_name === k)?.label ?? k}: ${x}`).join(", ");
const nextMissing = (obj: SchemaObject, v: Record<string, any>) => obj.fields.find((f) => f.required && v[f.api_name] == null && f.api_name !== "id");

export async function handleRecords(c: AxCtx, parseDate: (t: string, d: string) => { date?: string }): Promise<AxReply | null> {
  const { loadSchema } = await import("@/lib/builder/server");
  const schema = await loadSchema(c.db, c.clinicId);
  const open = c.prev?.intent?.startsWith("ax:rec_") ? c.prev : null;
  if (open) return continueOpen(c, schema, open, parseDate);
  const t = c.message.trim();
  const obj = findObject(schema, t);
  if (!obj) return null;
  const create = /^(?:please\s+)?(?:add|create|new|register|record|log|enter)\b/i.test(t);
  const update = /^(?:please\s+)?(?:update|change|edit|set|modify)\b/i.test(t);
  const list = /^(?:show|list|view|see|open|find|search)\b/i.test(t);
  if (create) {
    const { values, problems } = extractValues(obj, t, c.today, parseDate);
    return progress(c, obj, { intent: "ax:rec_create", object: obj.api_name, values }, problems);
  }
  if (list) return listRecords(c, obj, t);
  if (update) return updateStart(c, obj, t, parseDate);
  return null;
}

async function progress(c: AxCtx, obj: SchemaObject, d: any, problems: string[] = []): Promise<AxReply> {
  const err = await resolveLookups(c, obj, d.values);
  if (err) return { reply: err, draft: { ...d, values: Object.fromEntries(Object.entries(d.values).filter(([k]) => obj.fields.find((f) => f.api_name === k)?.data_type !== "lookup")) } };
  const miss = nextMissing(obj, d.values);
  if (miss) return { reply: `${problems.length ? problems.join(". ") + ". " : ""}What is the ${miss.label.toLowerCase()}${miss.data_type === "picklist" ? ` (${(miss.picklist_values ?? []).join(", ")})` : ""}?`, draft: { ...d, asking: miss.api_name } };
  if (!Object.keys(d.values).length) return { reply: `What should the ${obj.label.toLowerCase()} contain? For example “${obj.fields.filter((f) => f.api_name !== "id").slice(0, 2).map((f) => f.label + " …").join(", ")}”.`, draft: d };
  return { reply: `${d.intent === "ax:rec_update" ? `Update ${d.label ?? "the " + obj.label.toLowerCase()}` : `Add this ${obj.label.toLowerCase()}`}: ${show(obj, d.values)}${problems.length ? `\n(${problems.join("; ")})` : ""}\nReply yes to save.`, draft: { ...d, confirm: true } };
}

async function continueOpen(c: AxCtx, schema: Schema, d: any, parseDate: any): Promise<AxReply | null> {
  const obj = schema.objects.find((o) => o.api_name === d.object); if (!obj) return null;
  if (d.confirm) {
    if (!isYes(c.message)) return null;
    const { data, error } = await c.db.rpc("builder_rec_save", { p: { clinic_id: c.clinicId, actor: c.userId, object: obj.api_name, id: d.id ?? null, values: d.values } });
    if (error) return { reply: `I couldn't save that: ${String(error.message).replace(/^[A-Z_]+:\s*/, "")}`, draft: null };
    const { raiseFlowEvent } = await import("@/lib/flows/engine");
    await raiseFlowEvent(c.db, c.clinicId, d.id ? "record_updated" : "record_created", { object: obj.api_name, values: d.values, label: String(d.values?.name ?? "") });
    return { reply: `Saved. The ${obj.label.toLowerCase()} is ${d.id ? "updated" : "added"}.`, draft: null, actions: [{ label: `Open ${obj.plural_label}`, url: `/builder/data/${obj.api_name}` }] };
  }
  if (d.intent === "ax:rec_pick") {              // choosing among several matches
    const n = Number(c.message.match(/\d+/)?.[0]); const hit = d.options?.[n - 1];
    if (!hit) return { reply: `Reply with a number from 1 to ${d.options?.length ?? 0}.`, draft: d };
    return progress(c, obj, { intent: "ax:rec_update", object: obj.api_name, id: hit.id, label: hit.label, values: d.values });
  }
  // answering "What is the <field>?" or adding more details
  const values = { ...d.values };
  const f = obj.fields.find((x) => x.api_name === d.asking);
  const problems: string[] = [];
  if (f) { const r = coerce(f, c.message, c.today, parseDate); if (r.ok) values[f.api_name] = r.v; else problems.push(r.why); }
  const more = extractValues(obj, c.message, c.today, parseDate); Object.assign(values, more.values); problems.push(...more.problems);
  return progress(c, obj, { ...d, values, asking: undefined }, problems);
}

async function listRecords(c: AxCtx, obj: SchemaObject, t: string): Promise<AxReply> {
  const search = t.match(/\b(?:for|named|called|with|matching)\s+(.+)$/i)?.[1]?.trim() ?? null;
  const { data, error } = await c.db.rpc("builder_rec_list", { p: { clinic_id: c.clinicId, actor: c.userId, object: obj.api_name, search, filters: [], limit: 10, offset: 0 } });
  if (error) return { reply: String(error.message).replace(/^[A-Z_]+:\s*/, ""), draft: null };
  const rows: any[] = data?.rows ?? [];
  const cols = obj.fields.filter((f) => f.api_name !== "id").slice(0, 3);
  if (!rows.length) return { reply: `No ${obj.plural_label.toLowerCase()}${search ? ` matching “${search}”` : ""} yet.`, draft: null };
  return { reply: `${data.total ?? rows.length} ${obj.plural_label.toLowerCase()}${search ? ` matching “${search}”` : ""}:\n` + rows.map((r) => "• " + cols.map((f) => r[f.api_name]).filter((x) => x != null && x !== "").join(" · ")).join("\n"), draft: null, actions: [{ label: `Open ${obj.plural_label}`, url: `/builder/data/${obj.api_name}` }] };
}

async function updateStart(c: AxCtx, obj: SchemaObject, t: string, parseDate: any): Promise<AxReply> {
  const sp = t.search(/\b(?:set|to|with|so that)\b/i);
  const subject = t.slice(0, sp > 0 ? sp : undefined).replace(new RegExp(`^(?:please\\s+)?(?:update|change|edit|set|modify)\\s+(?:the\\s+)?(?:${esc(obj.label)}|${esc(obj.plural_label)})\\s*`, "i"), "").replace(/\b(?:record|entry)\b/i, "").trim();
  const { values, problems } = extractValues(obj, sp > 0 ? t.slice(sp) : t, c.today, parseDate);
  if (!subject) return { reply: `Which ${obj.label.toLowerCase()}? Say its name, for example “Update ${obj.label.toLowerCase()} CBC set price to 350”.`, draft: null };
  if (!Object.keys(values).length) return { reply: `What should change on ${subject}? For example “set ${obj.fields.find((f) => f.api_name !== "id")?.label.toLowerCase() ?? "name"} to …”.`, draft: null };
  const { data } = await c.db.rpc("builder_rec_list", { p: { clinic_id: c.clinicId, actor: c.userId, object: obj.api_name, search: subject, filters: [], limit: 5, offset: 0 } });
  const rows: any[] = data?.rows ?? [];
  const name = (r: any) => String(r[obj.fields.find((f) => f.api_name !== "id")?.api_name ?? "id"] ?? r.id);
  if (!rows.length) return { reply: `I couldn't find a ${obj.label.toLowerCase()} matching “${subject}”.`, draft: null };
  if (rows.length > 1) return { reply: `Which one?\n${rows.map((r, i) => `${i + 1}. ${name(r)}`).join("\n")}\nReply with the number.`, draft: { intent: "ax:rec_pick", object: obj.api_name, values, options: rows.map((r) => ({ id: r.id, label: name(r) })) } };
  return progress(c, obj, { intent: "ax:rec_update", object: obj.api_name, id: rows[0].id, label: name(rows[0]), values }, problems);
}
