import { recommendFields } from "./recommend";
import { toApiName, validatePlan } from "./validate";
import type { FieldSpec, FieldType, Plan, Schema, Step } from "./types";

export interface PlannerResult {
  message: string;
  plan: Plan | null;
  questions?: string[];
  source: "gemini" | "rules";
}
interface Input {
  prompt: string;
  schema: Schema;
  history?: { role: "user" | "assistant"; content: string }[];
  specialty?: string;
}

/* ───────────────────────── Gemini planner ───────────────────────── */

const SYSTEM = `You are the Mediflow AI Builder. You configure a hospital / clinic portal for an administrator by producing a JSON PLAN of tool calls. You never write SQL. The server validates every plan and the admin must approve it before anything runs.

TOOLS (the only steps allowed):
- create_object  {api_name, label, plural_label?, description?, icon?, fields?: FieldSpec[]}  -> a new table. A required text field "name" is added automatically; do not list it.
- add_field      {object, field: FieldSpec}
- hide_field     {object, field}     (data is kept; the "name" field cannot be hidden)
- create_app     {api_name, label, icon?, description?, objects?: string[]}  -> an app whose tabs are those objects
- add_tab        {app, kind?: "object"|"dashboard"|"report"|"page", object?, label?}

FieldSpec = {api_name, label?, data_type, required?, unique?, picklist_values?: string[], lookup_object?, help_text?}
data_type is one of: text, long_text, number, currency, date, datetime, boolean, picklist, email, phone, url, lookup.
picklist needs picklist_values. lookup needs lookup_object (an existing object, or one created earlier in the same plan).

RULES
- api_name values are lowercase snake_case, start with a letter, max 41 chars. Reference objects and apps by api_name.
- Never recreate something that already exists in CURRENT SCHEMA. Use add_field for existing objects.
- When the admin names an object but no fields, include 4-8 useful fields a real hospital would need (status dropdowns, dates, lookups to related objects, notes). Prefer lookups between related objects you are creating.
- Order steps so dependencies come first (create objects before apps and lookups).
- If the request is ambiguous or unsafe, set plan to null and ask 1-3 short questions.
- Requests about profiles, permission sets, dashboards, reports, automations or WhatsApp are not available yet: say so in "message", set plan to null, and suggest what you can do now.
- Do not invent extra objects the admin did not imply.

Reply with ONLY this JSON:
{"message": "<one or two plain sentences for the admin>", "plan": {"summary": "<short>", "steps": [ ... ]} | null, "questions": ["..."]}`;

function schemaForPrompt(s: Schema): string {
  const objs = s.objects.slice(0, 40).map((o) => `${o.api_name} [${o.fields.map((f) => `${f.api_name}:${f.data_type}`).join(", ")}]`);
  const apps = s.apps.slice(0, 20).map((a) => `${a.api_name} (tabs: ${a.tabs.map((t) => t.object || t.kind).join(", ") || "none"})`);
  return `OBJECTS:\n${objs.join("\n") || "(none yet)"}\nAPPS:\n${apps.join("\n") || "(none yet)"}`;
}

async function callGemini(contents: any[]): Promise<any> {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message ?? `Gemini error ${res.status}`);
  const data = await res.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
}

async function geminiPlan(inp: Input): Promise<PlannerResult> {
  const ctx = `CLINIC SPECIALTY: ${inp.specialty || "general"}\nCURRENT SCHEMA:\n${schemaForPrompt(inp.schema)}`;
  const contents: any[] = [
    ...(inp.history ?? []).slice(-6).map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: `${ctx}\n\nADMIN REQUEST: ${inp.prompt}` }] },
  ];
  let out = await callGemini(contents);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!out?.plan) return { message: String(out?.message || "Could you tell me a bit more?"), plan: null, questions: out?.questions, source: "gemini" };
    const v = validatePlan(out.plan, inp.schema);
    if (v.ok) return { message: String(out.message || v.plan.summary), plan: v.plan, source: "gemini" };
    if (attempt === 1) return { message: "I couldn't build a valid plan from that. " + v.errors.slice(0, 3).join(" "), plan: null, source: "gemini" };
    contents.push({ role: "model", parts: [{ text: JSON.stringify(out) }] });
    contents.push({ role: "user", parts: [{ text: `The plan failed validation:\n- ${v.errors.join("\n- ")}\nReturn a corrected JSON reply.` }] });
    out = await callGemini(contents);
  }
  return { message: "Something went wrong planning that.", plan: null, source: "gemini" };
}

/* ───────────────────── Rule-based planner (no API key) ───────────────────── */

const clean = (s: string) => s.replace(/^(an?|the|new|some)\s+/i, "").replace(/\s+(objects?|tabs?|tables?|modules?)$/i, "").replace(/[."']+$/g, "").trim();
const splitList = (s?: string) => (s ? s.split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i).map(clean).filter(Boolean) : []);
const singular = (s: string) => s.replace(/ies$/i, "y").replace(/(ss)$/i, "$1").replace(/([^s])s$/i, "$1");

function findObject(name: string, objects: { api_name: string; label: string; plural_label?: string }[]): string | null {
  const t = toApiName(name), ts = toApiName(singular(name));
  for (const o of objects) {
    const set = [o.api_name, toApiName(o.label), toApiName(o.plural_label || "")];
    if (set.includes(t) || set.includes(ts)) return o.api_name;
  }
  return null;
}

function inferField(phrase: string): FieldSpec {
  let p = phrase.trim();
  const dd = p.match(/\b(?:dropdown|picklist|options?)\b\s*(?:of|:|\()?\s*([^)]+)\)?$/i);
  let values: string[] | null = null;
  if (dd) { values = dd[1].split(/[\/|;,]| or /i).map((v) => v.trim()).filter(Boolean); p = p.slice(0, dd.index).replace(/[:(]\s*$/, "").trim(); }
  const explicit = p.match(/^(.*?)\s*\((text|number|currency|date|datetime|yes\/no|boolean|phone|email|url)\)\s*$/i);
  let type: FieldType | null = null;
  if (explicit) {
    p = explicit[1].trim();
    const m = explicit[2].toLowerCase();
    type = m === "yes/no" ? "boolean" : (m as FieldType);
  }
  const label = p.replace(/^(a|an|the)\s+/i, "").trim() || "Field";
  const l = label.toLowerCase();
  if (!type) {
    if (values) type = "picklist";
    else if (/date and time|datetime|timestamp/.test(l)) type = "datetime";
    else if (/\b(date|dob|birthday)\b|\b(on|until|from)$/.test(l)) type = "date";
    else if (/(amount|price|cost|fee|charge|rate|total|fees)/.test(l)) type = "currency";
    else if (/(count|number of|qty|quantity|age|beds|floor|days|hours|rating|dose)/.test(l)) type = "number";
    else if (/(phone|mobile|contact number)/.test(l)) type = "phone";
    else if (/email/.test(l)) type = "email";
    else if (/(url|link|website)/.test(l)) type = "url";
    else if (/(notes|description|comments|remarks|details|history|summary|instructions|reason)/.test(l)) type = "long_text";
    else if (/^(is|has)\s|yes\/no|urgent|emergency|insured|paid|active/.test(l)) type = "boolean";
    else if (/(status|stage)$/.test(l)) { type = "picklist"; values = ["New", "In progress", "Completed"]; }
    else if (/(type|category|priority)$/.test(l)) { type = "picklist"; values = ["Option 1", "Option 2"]; }
    else type = "text";
  }
  const f: FieldSpec = { api_name: toApiName(label), label: label.replace(/\b\w/g, (c) => c.toUpperCase()), data_type: type };
  if (type === "picklist") f.picklist_values = values ?? ["Option 1", "Option 2"];
  return f;
}

function rulesPlan(inp: Input): PlannerResult {
  const p = inp.prompt.trim().replace(/\s+/g, " ");
  const known = inp.schema.objects.map((o) => ({ api_name: o.api_name, label: o.label, plural_label: o.plural_label }));
  const finish = (steps: Step[], msg: string): PlannerResult => {
    const v = validatePlan({ summary: msg, steps }, inp.schema);
    return v.ok ? { message: msg, plan: v.plan, source: "rules" } : { message: "I couldn't build that: " + v.errors.slice(0, 3).join(" "), plan: null, source: "rules" };
  };
  const objectStep = (label: string, fieldPhrases: string[], sim: string[]): Step => {
    const api = toApiName(label);
    const fields = fieldPhrases.length ? fieldPhrases.map(inferField) : recommendFields(api, [], sim).fields;
    return { tool: "create_object", args: { api_name: api, label: label.replace(/\b\w/g, (c) => c.toUpperCase()), fields } };
  };

  // recommend fields
  let m = p.match(/(?:recommend|suggest)\w*\s+(?:some\s+)?(?:fields?\s+)?(?:for|on|to)\s+(?:the\s+)?(.+)$/i);
  if (m) {
    const obj = findObject(clean(m[1]), known);
    const api = obj ?? toApiName(clean(m[1]));
    const have = inp.schema.objects.find((o) => o.api_name === api)?.fields.map((f) => f.api_name) ?? [];
    const rec = recommendFields(api, have, known.map((k) => k.api_name));
    if (!rec.fields.length) return { message: `“${api}” already has all the usual fields I'd suggest.`, plan: null, source: "rules" };
    const names = rec.fields.map((f) => f.label || f.api_name).join(", ");
    if (obj) return finish(rec.fields.map((field) => ({ tool: "add_field", args: { object: obj, field } }) as Step), `${rec.reason}: ${names}. Approve to add them all, or tell me which to skip.`);
    return finish([{ tool: "create_object", args: { api_name: api, fields: rec.fields } }], `${rec.reason}: ${names}. Approve to create “${api}” with these fields.`);
  }

  // create app
  m = p.match(/(?:create|build|make|set up|setup)\s+(?:an?\s+|the\s+)?(.+?)\s+app(?:lication)?(?:\s+(?:with|containing|having|including|for)\s+(.+))?$/i);
  if (m) {
    const appLabel = clean(m[1]);
    const names = splitList(m[2]);
    const wanted = names.length ? names : [singular(appLabel)];
    const steps: Step[] = [];
    const sim = known.map((k) => k.api_name);
    const tabObjs: string[] = [];
    for (const n of wanted) {
      const existing = findObject(n, known);
      if (existing) { tabObjs.push(existing); continue; }
      steps.push(objectStep(singular(n), [], sim));
      sim.push(toApiName(singular(n)));
      tabObjs.push(toApiName(singular(n)));
    }
    steps.push({ tool: "create_app", args: { api_name: toApiName(appLabel), label: appLabel.replace(/\b\w/g, (c) => c.toUpperCase()), objects: tabObjs } });
    return finish(steps, `Create the ${appLabel} app with ${tabObjs.length} tab${tabObjs.length > 1 ? "s" : ""}. ${tabObjs.length > 1 ? "Each has" : "It has"} its own table and recommended fields.`);
  }

  // add field(s)
  m = p.match(/add\s+(?:an?\s+|the\s+)?(?:new\s+)?(?:fields?|columns?)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+)?(.+?)(?:\s+(?:object|table|tab))?$/i);
  if (m) {
    const obj = findObject(clean(m[2]), known);
    if (!obj) return { message: `I couldn't find an object called “${clean(m[2])}”. Existing objects: ${known.map((k) => k.api_name).join(", ") || "none yet"}.`, plan: null, source: "rules" };
    const have = new Set(inp.schema.objects.find((o) => o.api_name === obj)?.fields.map((x) => x.api_name) ?? []);
    const all = splitList(m[1]).map(inferField);
    const fields = all.filter((x) => !have.has(x.api_name));
    const skipped = all.filter((x) => have.has(x.api_name)).map((x) => x.label);
    if (!fields.length) return { message: `${obj} already has ${skipped.join(", ")}. Nothing to add.`, plan: null, source: "rules" };
    return finish(fields.map((field) => ({ tool: "add_field", args: { object: obj, field } }) as Step),
      `Add ${fields.length} field${fields.length > 1 ? "s" : ""} to ${obj}.${skipped.length ? ` Skipped ${skipped.join(", ")} because ${skipped.length > 1 ? "they exist" : "it exists"} already.` : ""}`);
  }

  // hide field
  m = p.match(/(?:remove|hide|delete)\s+(?:the\s+)?(?:field\s+)?(.+?)\s+(?:field\s+)?(?:from|on)\s+(?:the\s+)?(.+?)(?:\s+(?:object|table|tab))?$/i);
  if (m) {
    const obj = findObject(clean(m[2]), known);
    if (!obj) return { message: `I couldn't find an object called “${clean(m[2])}”.`, plan: null, source: "rules" };
    return finish([{ tool: "hide_field", args: { object: obj, field: toApiName(m[1]) } }], `Hide “${clean(m[1])}” on ${obj}. The data stays in the database.`);
  }

  // add tab
  m = p.match(/add\s+(?:an?\s+|the\s+)?(.+?)\s+tab\s+to\s+(?:the\s+)?(.+?)(?:\s+app)?$/i);
  if (m) {
    const obj = findObject(clean(m[1]), known);
    const app = inp.schema.apps.find((a) => a.api_name === toApiName(m![2]) || toApiName(a.label) === toApiName(m![2]));
    if (!obj || !app) return { message: `I need an existing object and app. Objects: ${known.map((k) => k.api_name).join(", ") || "none"}; apps: ${inp.schema.apps.map((a) => a.api_name).join(", ") || "none"}.`, plan: null, source: "rules" };
    return finish([{ tool: "add_tab", args: { app: app.api_name, kind: "object", object: obj } }], `Add a ${obj} tab to ${app.label}.`);
  }

  // create object
  m = p.match(/(?:create|add|make|new)\s+(?:an?\s+|the\s+)?(?:new\s+)?(?:object|table|tab|module)\s+(?:called\s+|named\s+|for\s+)?(.+?)(?:\s+(?:with|having)\s+(?:fields?\s+)?(.+))?$/i);
  if (m) {
    const label = clean(m[1]);
    const sim = known.map((k) => k.api_name);
    return finish([objectStep(label, splitList(m[2]), sim)], m[2] ? `Create “${label}” with the fields you listed.` : `Create “${label}” with recommended fields. You can add more any time.`);
  }

  return {
    message: "I can create apps and objects (new tables), add or hide fields, and add tabs. Try: “Create a Lab app with Lab Test and Lab Order”, “Add fields urgent and result notes to lab order”, or “Recommend fields for ward”. To control who sees your data use the Access control tab, and for dashboards and reports use the Reports tab.",
    plan: null,
    source: "rules",
  };
}

export async function makePlan(inp: Input): Promise<PlannerResult> {
  if (process.env.GEMINI_API_KEY) {
    try { return await geminiPlan(inp); }
    catch (e: any) {
      const r = rulesPlan(inp);
      return { ...r, message: `${r.message}${r.plan ? "" : ""}`, source: "rules" };
    }
  }
  return rulesPlan(inp);
}
