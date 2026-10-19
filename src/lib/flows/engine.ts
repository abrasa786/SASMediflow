/**
 * Flow engine: "when X happens, do Y".
 *  - Events are queued by the database (appointment and invoice changes) or by the app (records), then claimed here.
 *  - Scheduled events (day before an appointment, every morning, stock low) are found by the daily job.
 *  - Actions: WhatsApp message (sent through the Cloud API when configured, otherwise a one-tap link is logged) and tasks.
 *  - Every run is written to flow_runs so an admin can see exactly what happened. Nothing here throws into the caller.
 */
import { buildMessages, sendViaCloudApi, waLink, whatsappConfigured, whatsappPhone } from "@/lib/booking/notify";
import { formatDateNice } from "@/lib/booking/parse";
import type { FlowAction, FlowCondition } from "@/lib/builder/agent-tools";

interface FlowRow { id: string; clinic_id: string; name: string; trigger_event: string; trigger_object: string | null; conditions: FlowCondition[]; actions: FlowAction[] }
interface Ctx {
  event: string; clinicId: string; clinicName: string;
  vars: Record<string, string>; fields: Record<string, string>;
  phones: { patient?: string | null; doctor?: string | null; admin?: string | null };
  details?: any; appointmentId?: string;
}
interface ActionResult { type: string; to?: string; status: "sent" | "link" | "skipped" | "failed" | "created"; link?: string; error?: string; detail?: string }

const drName = (n?: string | null) => (!n ? "" : /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`);
const sub = (t: string, vars: Record<string, string>) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");

function checkConditions(conds: FlowCondition[] | null | undefined, fields: Record<string, string>): boolean {
  for (const c of conds ?? []) {
    const have = String(fields[c.field] ?? "").toLowerCase(), want = String(c.value ?? "").toLowerCase();
    const num = (x: string) => Number(x.replace(/[^\d.-]/g, ""));
    const ok = c.op === "eq" ? have === want : c.op === "neq" ? have !== want : c.op === "contains" ? have.includes(want) : c.op === "gt" ? num(have) > num(want) : num(have) < num(want);
    if (!ok) return false;
  }
  return true;
}

async function ctxForAppointment(db: any, event: string, clinicId: string, appointmentId: string): Promise<Ctx | null> {
  const { data: d } = await db.rpc("appt_details", { p_appt: appointmentId });
  if (!d?.appointment || d.appointment.clinic_id !== clinicId) return null;
  const a = d.appointment, p = d.patient ?? {}, dr = d.doctor, c = d.clinic ?? {};
  return {
    event, clinicId, clinicName: c.name ?? "", details: d, appointmentId,
    vars: { patient: p.name ?? "", date: formatDateNice(a.date), time: a.time ?? "", doctor: drName(dr?.name), clinic: c.name ?? "", fee: String(a.fee ?? "") },
    fields: { patient: p.name ?? "", doctor: dr?.name ?? "", status: a.status ?? "", mode: a.mode ?? "", source: a.source ?? "", fee: String(a.fee ?? ""), date: String(a.date ?? ""), time: a.time ?? "" },
    phones: { patient: p.phone, doctor: dr?.phone, admin: c.phone },
  };
}

async function deliver(db: any, f: FlowRow, ctx: Ctx, x: Extract<FlowAction, { type: "send_whatsapp" }>): Promise<ActionResult> {
  const to = x.to ?? "patient";
  let text = "";
  if (x.template && x.template !== "thanks" && ctx.details?.appointment) {
    const kind = x.template as "confirmation" | "reminder" | "cancellation";
    const m = buildMessages(ctx.details, kind);
    text = to === "patient" ? m.patient : m.doctor;
  } else text = sub(x.text ?? "", ctx.vars);
  if (!text.trim()) return { type: "send_whatsapp", to, status: "skipped", error: "No message text" };
  const phone = whatsappPhone(ctx.phones[to]);
  if (!phone) return { type: "send_whatsapp", to, status: "skipped", error: `No valid phone number for the ${to}` };
  let r: ActionResult;
  if (!whatsappConfigured()) r = { type: "send_whatsapp", to, status: "link", link: waLink(phone, text) };
  else {
    try { await sendViaCloudApi(phone, text); r = { type: "send_whatsapp", to, status: "sent" }; }
    catch (e: any) { r = { type: "send_whatsapp", to, status: "failed", error: String(e.message).slice(0, 200), link: waLink(phone, text) }; }
  }
  if (ctx.appointmentId && (to === "patient" || to === "doctor") && ["confirmation", "reminder", "cancellation"].includes(String(x.template))) {
    try { await db.from("appointment_notifications").insert({ clinic_id: ctx.clinicId, appointment_id: ctx.appointmentId, recipient: to, phone, kind: x.template, channel: r.status === "sent" || r.status === "failed" ? "whatsapp" : "link", status: r.status === "created" ? "sent" : r.status, link: r.link ?? null, error: r.error ?? null }); } catch { /* log only */ }
  }
  return r;
}

async function runFlow(db: any, f: FlowRow, ctx: Ctx, key?: string): Promise<void> {
  if (!checkConditions(f.conditions, ctx.fields)) {
    await db.rpc("flow_log", { p_clinic: f.clinic_id, p_flow: f.id, p_name: f.name, p_event: ctx.event, p_status: "skipped", p_detail: { reason: "conditions not met", key } });
    return;
  }
  const results: ActionResult[] = [];
  for (const x of f.actions) {
    try {
      if (x.type === "send_whatsapp") results.push(await deliver(db, f, ctx, x));
      else if (x.type === "create_task") {
        const { error } = await db.from("clinic_tasks").insert({ clinic_id: f.clinic_id, title: sub(x.title, ctx.vars).slice(0, 200), description: `Created by the flow “${f.name}”`, status: "todo", priority: x.priority ?? "medium", assigned_to: x.assigned_to ?? null });
        results.push(error ? { type: "create_task", status: "failed", error: error.message } : { type: "create_task", status: "created" });
      }
    } catch (e: any) { results.push({ type: x.type, status: "failed", error: String(e.message).slice(0, 200) }); }
  }
  const failed = results.some((r) => r.status === "failed");
  await db.rpc("flow_log", { p_clinic: f.clinic_id, p_flow: f.id, p_name: f.name, p_event: ctx.event, p_status: failed ? "failed" : "ok", p_detail: { key, appointment_id: ctx.appointmentId, actions: results } });
}

async function flowsFor(db: any, clinicId: string, event: string, object?: string | null): Promise<FlowRow[]> {
  let q = db.from("flows").select("id, clinic_id, name, trigger_event, trigger_object, conditions, actions").eq("clinic_id", clinicId).eq("is_active", true).eq("trigger_event", event);
  if (object) q = q.eq("trigger_object", object);
  const { data } = await q;
  return (data ?? []) as FlowRow[];
}

async function handleEvent(db: any, ev: { id: string; clinic_id: string; event: string; payload: any }): Promise<void> {
  const p = ev.payload ?? {};
  let ctx: Ctx | null = null;
  if (p.appointment_id) ctx = await ctxForAppointment(db, ev.event, ev.clinic_id, p.appointment_id);
  else if (ev.event === "invoice_paid" && p.invoice_id) {
    const { data: d } = await db.rpc("flow_invoice_details", { p_invoice: p.invoice_id });
    if (d) ctx = { event: ev.event, clinicId: ev.clinic_id, clinicName: d.clinic?.name ?? "", vars: { patient: d.patient?.name ?? "", clinic: d.clinic?.name ?? "", amount: `₹${Number(d.invoice?.total ?? 0).toLocaleString("en-IN")}`, invoice: d.invoice?.number ?? "" }, fields: { total: String(d.invoice?.total ?? ""), method: d.invoice?.method ?? "", patient: d.patient?.name ?? "" }, phones: { patient: d.patient?.phone, admin: d.clinic?.phone } };
  } else if (ev.event === "record_created" || ev.event === "record_updated") {
    const vals: Record<string, string> = Object.fromEntries(Object.entries(p.values ?? {}).map(([k, v]) => [k, String(v ?? "")]));
    const { data: c } = await db.from("clinics").select("name, brand_name, phone").eq("id", ev.clinic_id).maybeSingle();
    ctx = { event: ev.event, clinicId: ev.clinic_id, clinicName: c?.brand_name ?? c?.name ?? "", vars: { ...vals, record: p.label ?? vals.name ?? "", clinic: c?.brand_name ?? c?.name ?? "", object: p.object ?? "" }, fields: vals, phones: { admin: c?.phone } };
  }
  if (!ctx) return;
  for (const f of await flowsFor(db, ev.clinic_id, ev.event, p.object)) await runFlow(db, f, ctx);
}

/** Run the queued events. `clinicId` limits it to one clinic (used right after an action). Never throws. */
export async function processFlows(db: any, clinicId?: string): Promise<number> {
  try {
    const { data: events } = await db.rpc("flow_claim", { p_clinic: clinicId ?? null, p_limit: 50 });
    let n = 0;
    for (const ev of events ?? []) { try { await handleEvent(db, ev); n++; } catch { /* one bad event must not block the rest */ } }
    return n;
  } catch { return 0; }
}

/** Same, but gives up waiting after a few seconds so a slow WhatsApp call never delays the screen. */
export async function processFlowsSoon(db: any, clinicId: string, ms = 6000): Promise<void> {
  await Promise.race([processFlows(db, clinicId), new Promise((r) => setTimeout(r, ms))]);
}

/** Queue and run an event raised by the app itself (e.g. a record was saved). */
export async function raiseFlowEvent(db: any, clinicId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  try { const { data } = await db.rpc("flow_enqueue", { p_clinic: clinicId, p_event: event, p_payload: payload }); if (data) await processFlowsSoon(db, clinicId); } catch { /* flows never break the action */ }
}

const dayIn = (tz: string, offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(Date.now() + offset * 86400000));

/** The daily job: events queued but not yet run, then the time-based flows. Safe to run twice (each item runs once per day). */
export async function runScheduledFlows(db: any): Promise<{ queued: number; scheduled: number }> {
  const queued = await processFlows(db);
  let scheduled = 0;
  const { data: all } = await db.from("flows").select("id, clinic_id, name, trigger_event, trigger_object, conditions, actions").eq("is_active", true).in("trigger_event", ["day_before_appointment", "daily", "stock_low"]);
  const byClinic = new Map<string, FlowRow[]>();
  for (const f of (all ?? []) as FlowRow[]) byClinic.set(f.clinic_id, [...(byClinic.get(f.clinic_id) ?? []), f]);
  for (const [clinicId, flows] of Array.from(byClinic.entries())) {
    try {
      const { data: c } = await db.from("clinics").select("name, brand_name, phone, settings").eq("id", clinicId).maybeSingle();
      const tz = c?.settings?.booking?.timezone || "Asia/Kolkata";
      const today = dayIn(tz), tomorrow = dayIn(tz, 1);
      const seen = async (key: string, flowId: string) => { const { data } = await db.from("flow_runs").select("id").eq("clinic_id", clinicId).eq("flow_id", flowId).eq("detail->>key", key).limit(1); return !!data?.length; };
      for (const f of flows) {
        if (f.trigger_event === "day_before_appointment") {
          const { data: appts } = await db.from("appointments").select("id").eq("clinic_id", clinicId).eq("appointment_date", tomorrow).eq("status", "confirmed").limit(500);
          for (const a of appts ?? []) {
            const key = `${f.id}:${a.id}`; if (await seen(key, f.id)) continue;
            const ctx = await ctxForAppointment(db, f.trigger_event, clinicId, a.id); if (ctx) { await runFlow(db, f, ctx, key); scheduled++; }
          }
        } else if (f.trigger_event === "daily") {
          const key = `${f.id}:${today}`; if (await seen(key, f.id)) continue;
          await runFlow(db, f, { event: "daily", clinicId, clinicName: c?.brand_name ?? c?.name ?? "", vars: { clinic: c?.brand_name ?? c?.name ?? "", date: formatDateNice(today) }, fields: {}, phones: { admin: c?.phone } }, key); scheduled++;
        } else if (f.trigger_event === "stock_low") {
          const { data: items } = await db.from("stock_items").select("id, name, quantity, min_quantity").eq("clinic_id", clinicId).not("min_quantity", "is", null).limit(500);
          for (const it of (items ?? []).filter((i: any) => i.quantity <= i.min_quantity)) {
            const key = `${f.id}:${it.id}:${today}`; if (await seen(key, f.id)) continue;
            await runFlow(db, f, { event: "stock_low", clinicId, clinicName: c?.brand_name ?? c?.name ?? "", vars: { item: it.name, quantity: String(it.quantity), minimum: String(it.min_quantity), clinic: c?.brand_name ?? c?.name ?? "" }, fields: { item: it.name, quantity: String(it.quantity) }, phones: { admin: c?.phone } }, key); scheduled++;
          }
        }
      }
    } catch { /* continue with the next clinic */ }
  }
  return { queued, scheduled };
}
