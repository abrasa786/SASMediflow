import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { parseBookingText, mergeDraft, missingForBooking, todayInTz, formatDateNice, type BookingDraft } from "@/lib/booking/parse";
import { bookAppointmentViaEngine, rescheduleViaEngine, setStatusViaEngine, suggestSlots } from "@/lib/booking/engine";
import { notifyAppointment, type NotificationResult } from "@/lib/booking/notify";
import { isAddDoctor, parseAddDoctor, mergeDoctor, type DoctorDraft } from "@/lib/booking/doctor-parse";
import { AiDisabledError, generate } from "@/lib/ai/gateway";
import { answerLocally, deidentifiedContext, loadFacts } from "@/lib/ai/local-answers";
import { checkScope, OutOfScopeError, refusal } from "@/lib/ai/scope";
import { getPolicy, isUuid, loadHistory, logInteraction, newSession } from "@/lib/ai/store";

export const dynamic = "force-dynamic";

type Action = { label: string; url: string };
interface Reply { reply: string; draft: any; actions?: Action[]; appointmentId?: string; slots?: string[] }

const ABORT = /^\s*(no|nope|nah|cancel that|never ?mind|stop|forget it|abort|start over|reset)\W*$/i;
const drName = (n?: string | null) => (!n ? "the doctor" : /^dr\.?\s/i.test(n) ? n : `Dr. ${n}`);
const safe = (s: string) => s.replace(/[^A-Za-z .'-]/g, "").trim().slice(0, 60);

function notifyLines(ns: NotificationResult[]): { text: string; actions: Action[] } {
  const lines: string[] = []; const actions: Action[] = [];
  for (const n of ns) {
    const who = n.recipient === "patient" ? "patient" : "doctor";
    if (n.status === "sent") lines.push(`✅ WhatsApp sent to the ${who}`);
    else if (n.status === "link") { lines.push(`📲 WhatsApp for the ${who} is ready to send`); if (n.link) actions.push({ label: `Send to ${who} on WhatsApp`, url: n.link }); }
    else if (n.status === "failed") { lines.push(`⚠️ WhatsApp to the ${who} failed (${n.error ?? "unknown error"})`); if (n.link) actions.push({ label: `Send to ${who} manually`, url: n.link }); }
    else lines.push(`ℹ️ ${who === "patient" ? "Patient" : "Doctor"}: ${n.error ?? "no phone number"}`);
  }
  return { text: lines.join("\n"), actions };
}

async function findDoctor(db: any, clinicId: string, hint?: string) {
  if (!hint) return { id: undefined as string | undefined, error: "" };
  const h = safe(hint);
  if (!h) return { id: undefined, error: "" };
  const { data } = await db.from("doctors").select("id, name").eq("clinic_id", clinicId).eq("is_active", true).ilike("name", `%${h}%`).limit(5);
  if (!data?.length) {
    const { data: all } = await db.from("doctors").select("name").eq("clinic_id", clinicId).eq("is_active", true).order("name").limit(8);
    return { id: undefined, error: `I couldn't find a doctor matching "${hint}". Available: ${(all ?? []).map((d: any) => d.name).join(", ") || "none"}.` };
  }
  if (data.length > 1) return { id: undefined, error: `More than one doctor matches "${hint}": ${data.map((d: any) => d.name).join(", ")}. Which one?` };
  return { id: data[0].id as string, error: "" };
}

async function findPatients(db: any, clinicId: string, name: string) {
  const n = safe(name);
  if (!n) return [];
  const { data } = await db.from("clinic_patients").select("id, name, phone").eq("clinic_id", clinicId).ilike("name", `%${n}%`).limit(6);
  return (data ?? []) as { id: string; name: string; phone: string | null }[];
}

async function upcomingFor(db: any, clinicId: string, patientIds: string[], today: string) {
  if (!patientIds.length) return [];
  const { data } = await db.from("appointments").select("id, appointment_date, appointment_time, status, doctors(name), clinic_patients(name)")
    .eq("clinic_id", clinicId).in("clinic_patient_id", patientIds).eq("status", "confirmed").gte("appointment_date", today).order("appointment_date").order("start_time").limit(6);
  return (data ?? []) as any[];
}

async function slotReply(db: any, clinicId: string, d: BookingDraft, doctorId: string | undefined, prefix: string): Promise<Reply> {
  const today = todayInTz();
  const sugg = await suggestSlots(db, clinicId, d.date ?? today, { doctorId, max: 40, days: 0 });
  let times = (sugg[0]?.slots ?? []).map((s) => s.time);
  if (d.part_of_day) {
    const inPart = (t: string) => { const m = t.match(/^(\d+):(\d+) (AM|PM)$/); if (!m) return true; let h = +m[1] % 12; if (m[3] === "PM") h += 12; return d.part_of_day === "morning" ? h < 12 : d.part_of_day === "afternoon" ? h >= 12 && h < 17 : h >= 17; };
    times = times.filter(inPart);
  }
  if (times.length) {
    const shown = times.slice(0, 8);
    return { reply: `${prefix}Free times on ${formatDateNice(d.date!)}: ${shown.join(", ")}${times.length > shown.length ? " …" : ""}.\nWhich time works?`, draft: d, slots: shown };
  }
  const next = await suggestSlots(db, clinicId, d.date ?? today, { doctorId, max: 6, days: 10 });
  const alt = next.slice(0, 3).map((x) => `${formatDateNice(x.date)}: ${x.slots.slice(0, 3).map((s) => s.time).join(", ")}`).join("\n");
  return { reply: `${prefix}No free times on ${formatDateNice(d.date!)}${d.part_of_day ? ` (${d.part_of_day})` : ""}.${alt ? `\nNearest openings:\n${alt}\nTell me a date to continue.` : "\nTry another date."}`, draft: { ...d, date: undefined, time: undefined } };
}

async function handleBooking(db: any, clinicId: string, userId: string, d: BookingDraft): Promise<Reply> {
  // known patient by name but no phone: reuse the saved number when unambiguous
  if (d.name && !d.phone) {
    const found = await findPatients(db, clinicId, d.name);
    const exact = found.filter((p) => p.name.toLowerCase() === d.name!.toLowerCase());
    const pick = exact.length === 1 ? exact[0] : found.length === 1 ? found[0] : null;
    if (pick?.phone) { d = { ...d, name: pick.name, phone: String(pick.phone).replace(/\D/g, "").slice(-10) }; }
    else if (found.length > 1) return { reply: `I found ${found.length} patients matching "${d.name}": ${found.map((p) => p.name).join(", ")}. Please send the mobile number to pick the right one.`, draft: d };
  }
  const miss = missingForBooking(d);
  if (miss.length) return { reply: `Happy to book that. I still need: ${miss.join(", ")}.`, draft: d };

  const doc = await findDoctor(db, clinicId, d.doctor_hint);
  if (doc.error) return { reply: doc.error, draft: { ...d, doctor_hint: undefined } };
  if (!d.time) return slotReply(db, clinicId, d, doc.id, "");

  try {
    const details = await bookAppointmentViaEngine(db, {
      clinicId, actor: userId, patient: { name: d.name, phone: d.phone, age: d.age, gender: d.gender },
      doctorId: doc.id, date: d.date!, time: d.time, symptoms: d.reason, source: "bot",
    });
    const ns = await notifyAppointment(db, clinicId, details, "confirmation");
    const nl = notifyLines(ns);
    const a = details.appointment;
    const how = details.assigned_how === "auto_usual" ? " (the patient's usual doctor)" : details.assigned_how === "auto_free" ? " (auto-assigned: first free doctor)" : "";
    return {
      reply: `✅ Booked ${details.patient?.name}${details.patient_created ? " (new patient record created)" : ""} with ${drName(details.doctor?.name)}${how}\n📅 ${formatDateNice(a.date)} at ${a.time}${a.symptoms ? `\n📝 ${a.symptoms}` : ""}${details.phone_shared ? "\nℹ️ This number is shared with another patient; saved as a separate record." : ""}\n${nl.text}`.trim(),
      draft: null, actions: nl.actions, appointmentId: a.id,
    };
  } catch (e: any) {
    if (e instanceof HttpError && e.status === 409) {
      const sugg = (e.extra?.suggestions as any[]) ?? [];
      const alt = sugg.slice(0, 3).map((x) => `${formatDateNice(x.date)}: ${x.slots.slice(0, 4).map((s: any) => s.time).join(", ")}`).join("\n");
      return { reply: `${e.message}.${alt ? `\nOpen times:\n${alt}\nPick one (e.g. "10:30 AM") or give another date.` : "\nTry another date or time."}`, draft: { ...d, time: undefined } };
    }
    if (e instanceof HttpError) return { reply: `I couldn't book that: ${e.message}`, draft: d };
    throw e;
  }
}

async function handleCancelOrMove(db: any, clinicId: string, userId: string, d: BookingDraft, intent: "cancel" | "reschedule", today: string): Promise<Reply> {
  if (!d.name) return { reply: `Whose appointment should I ${intent === "cancel" ? "cancel" : "move"}? Send the patient's name.`, draft: { ...d, intent } };
  const pts = await findPatients(db, clinicId, d.name);
  if (!pts.length) return { reply: `I can't find a patient named "${d.name}".`, draft: null };
  const appts = await upcomingFor(db, clinicId, pts.map((p) => p.id), today);
  if (!appts.length) return { reply: `${pts[0].name} has no upcoming confirmed appointments.`, draft: null };
  if (appts.length > 1 && intent === "cancel" && d.date) {
    const m = appts.filter((a) => a.appointment_date === d.date);
    if (m.length === 1) appts.splice(0, appts.length, m[0]);
  }
  if (appts.length > 1) {
    const list = appts.map((a) => `• ${a.clinic_patients?.name}: ${formatDateNice(a.appointment_date)} ${a.appointment_time} with ${drName(a.doctors?.name)}`).join("\n");
    return { reply: `${appts[0].clinic_patients?.name} has ${appts.length} upcoming appointments:\n${list}\nPlease change them from the Appointments page so I don't pick the wrong one.`, draft: null };
  }
  const ap = appts[0];
  if (intent === "cancel") {
    const reason = d.reason && d.reason.toLowerCase() !== d.name.toLowerCase() ? d.reason : undefined;
    const details = await setStatusViaEngine(db, { clinicId, actor: userId, appointmentId: ap.id, status: "cancelled", reason });
    const ns = details.changed ? await notifyAppointment(db, clinicId, details, "cancellation") : [];
    const nl = notifyLines(ns);
    return { reply: `❌ Cancelled ${ap.clinic_patients?.name}'s appointment on ${formatDateNice(ap.appointment_date)} at ${ap.appointment_time}.\n${nl.text}`.trim(), draft: null, actions: nl.actions };
  }
  // reschedule
  if (!d.date) return { reply: `${ap.clinic_patients?.name} is booked ${formatDateNice(ap.appointment_date)} at ${ap.appointment_time}. Which new date?`, draft: { ...d, intent } };
  if (!d.time) return slotReply(db, clinicId, { ...d, intent }, undefined, "");
  try {
    const details = await rescheduleViaEngine(db, { clinicId, actor: userId, appointmentId: ap.id, date: d.date, time: d.time });
    const ns = await notifyAppointment(db, clinicId, details, "reschedule");
    const nl = notifyLines(ns);
    return { reply: `🔁 Moved ${details.patient?.name} to ${formatDateNice(details.appointment.date)} at ${details.appointment.time} with ${drName(details.doctor?.name)}.\n${nl.text}`.trim(), draft: null, actions: nl.actions, appointmentId: ap.id };
  } catch (e: any) {
    if (e instanceof HttpError && e.status === 409) {
      const sugg = (e.extra?.suggestions as any[]) ?? [];
      const alt = sugg.slice(0, 3).map((x) => `${formatDateNice(x.date)}: ${x.slots.slice(0, 4).map((s: any) => s.time).join(", ")}`).join("\n");
      return { reply: `${e.message}.${alt ? `\nOpen times:\n${alt}` : ""}`, draft: { ...d, intent, time: undefined } };
    }
    if (e instanceof HttpError) return { reply: `I couldn't move it: ${e.message}`, draft: d };
    throw e;
  }
}

// ── clinic Q&A ──────────────────────────────────────────────────────
// 1) our own backend answers the common questions (nothing leaves our system);
// 2) only if the clinic admin switched external AI on, a de-identified summary goes through the AI gateway.
interface QA { reply: string; source: "local" | "external"; sentText?: string; redactions?: number }

async function answerQuestion(db: any, clinicId: string, userId: string, message: string, history: { role: "user" | "assistant"; content: string }[], botName: string): Promise<QA> {
  const facts = await loadFacts(db, clinicId);
  const small = checkScope(message, { module: "assistant" });
  if (small.ok && small.kind === "smalltalk") return { source: "local", reply: `Hi! I'm ${botName}, ${facts.clinicName}'s assistant. I can book, cancel and move appointments, and answer questions about today's appointments, revenue, unpaid invoices, low stock and patients.` };
  const local = answerLocally(message, facts);
  if (local) return { reply: local, source: "local" };
  try {
    const system = `You are ${botName}, a concise clinic assistant. You only know this de-identified summary; names like "Patient A" are placeholders.\n\n${deidentifiedContext(facts)}\n\nAnswer using only this data. Use ₹ and Indian number format. If something is not in the data, say so. Under 150 words. Never ask for or repeat personal contact details.`;
    const out = await generate({ db, clinicId, userId, system, turns: [...history, { role: "user", content: message }], names: facts.names, maxTokens: 512, temperature: 0.3, scope: { module: "assistant", text: message, hasHistory: history.length > 0 } });
    return { reply: out.text || "Sorry, I couldn't generate a response.", source: "external", sentText: out.sentText, redactions: out.redactions };
  } catch (e) {
    if (e instanceof OutOfScopeError) return { source: "local", reply: refusal("assistant", botName, facts.clinicName) };
    if (!(e instanceof AiDisabledError)) throw e;
    return { source: "local", reply: `I can answer questions about today's appointments, revenue, unpaid invoices, low stock and patient counts, and I can book, cancel and move appointments. For open-ended questions the clinic admin can switch on external AI in Settings → AI & privacy; until then your data stays inside this system.` };
  }
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const t12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`; };

/** "Add a new doctor …" typed in the chat: creates the doctor and their weekly hours. Admin only. */
async function handleAddDoctor(db: any, clinicId: string, role: string, prev: DoctorDraft | undefined, message: string, continuing: boolean): Promise<Reply> {
  if (role !== "admin") return { reply: "Only the clinic admin can add doctors. Ask your admin, or open Staff → Invite.", draft: null };
  const parsed = parseAddDoctor(message);
  // while we're asking questions, a bare reply is the answer
  if (continuing && prev) {
    if (!prev.name && !parsed.name && /^[A-Za-z][A-Za-z.' ]{1,40}$/.test(message.trim())) parsed.name = message.trim().replace(/^dr\.?\s+/i, "");
    if (!prev.specialty && !parsed.specialty && /^[A-Za-z ]{3,30}$/.test(message.trim()) && prev.name) parsed.specialty = message.trim().replace(/^\w/, (c) => c.toUpperCase());
    if (/\b(default|clinic hours|same as clinic)\b/i.test(message) && !parsed.start) {
      const { data: c } = await db.from("clinics").select("working_hours").eq("id", clinicId).maybeSingle();
      parsed.start = (c?.working_hours?.open ?? "09:00").slice(0, 5); parsed.end = (c?.working_hours?.close ?? "18:00").slice(0, 5);
    }
  }
  const d = mergeDoctor(prev, parsed);
  const keep = { ...d, intent: "add_doctor" };
  if (d.shiftError) return { reply: d.shiftError, draft: { ...keep, start: undefined, end: undefined, shiftError: undefined } };
  if (!d.name) return { reply: "Sure. What is the doctor's name?", draft: keep };
  if (!d.start || !d.end) return { reply: `Got it: Dr. ${d.name}${d.specialty ? `, ${d.specialty}` : ""}. What hours does ${d.name.split(" ")[0]} work? For example "9am-6pm" or "2-11" (say "default" to use the clinic's hours).`, draft: keep };

  const { data: dup } = await db.from("doctors").select("id").eq("clinic_id", clinicId).ilike("name", d.name).limit(1);
  if (dup?.length) return { reply: `A doctor named ${d.name} is already on your list. Use the Availability page to change their hours, or give this doctor a different name.`, draft: null };

  const { data: doc, error } = await db.from("doctors").insert({
    clinic_id: clinicId, name: /^dr\.?\s/i.test(d.name) ? d.name : `Dr. ${d.name}`, specialty: d.specialty ?? null, speciality: d.specialty ?? null,
    experience_years: d.years ?? null, phone: d.phone ?? null, consultation_fee: d.fee ?? null, is_active: true,
  }).select("id, name").single();
  if (error) {
    const hint = /experience_years/.test(error.message) ? " (run supabase/migrations/005_tenant_safety_and_treatments.sql in Supabase)" : "";
    return { reply: `I couldn't add the doctor: ${error.message}${hint}`, draft: null };
  }
  const days = d.days ?? [1, 2, 3, 4, 5, 6];
  const rows = days.map((wd) => ({ weekday: wd, start: d.start, end: d.end }));
  const { error: se } = await db.rpc("appt_set_schedule", { p_clinic: clinicId, p_doctor: doc.id, p_rows: rows });
  const lines = [`✅ Added ${doc.name}${d.specialty ? ` (${d.specialty})` : ""}${d.years != null ? `, ${d.years} years of experience` : ""}.`];
  lines.push(se ? `⚠️ I couldn't save the hours (${se.message}). Set them on the Availability page.`
                : `🗓 Works ${days.map((x) => DAY_NAMES[x]).join(", ")}, ${t12(d.start)} – ${t12(d.end)}. New bookings can be made in those hours.`);
  if (!d.phone) lines.push("📱 No phone number yet, so the doctor won't get WhatsApp notes. Add it on the Availability page.");
  return { reply: lines.join("\n"), draft: null, actions: [{ label: "Open Availability", url: "/availability" }] };
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId, role } = await requireClinicMember(req, b.clinicId);
    const message = typeof b.message === "string" ? b.message.trim().slice(0, 1000) : "";
    if (!message) throw new HttpError(400, "message is required.");
    const sessionId = isUuid(b.sessionId) ? b.sessionId : newSession();
    const policy = await getPolicy(db, b.clinicId);
    // The AI's memory is OUR database. When history is switched off the conversation is only what this one request carries.
    const history = policy.retention_days > 0 ? await loadHistory(db, b.clinicId, userId, sessionId) : [];
    const prev: BookingDraft | undefined = b.draft && typeof b.draft === "object" ? b.draft : undefined;
    const today = todayInTz();
    const { data: clinicRow } = await db.from("clinics").select("ai_name").eq("id", b.clinicId).maybeSingle();
    const botName: string = clinicRow?.ai_name || "Assistant";

    let src: QA["source"] | "rules" = "rules";
    let sent: string | undefined, redactions = 0, intentName: string | undefined;
    const run = async (): Promise<Reply> => {
      // Scope guard first: out-of-syllabus questions are refused here, before any parsing, lookup or model call.
      const open = !!(prev?.intent && prev.intent !== "other");
      const sc = checkScope(message, { module: "assistant", hasOpenRequest: open, hasHistory: history.length > 0 });
      if (!sc.ok) { intentName = "out_of_scope"; return { reply: refusal("assistant", botName, undefined), draft: open ? prev : null }; }
      if (prev?.intent && prev.intent !== "other" && ABORT.test(message)) return { reply: "No problem, I've dropped that request.", draft: null };

      // Adding a doctor (admin) is handled before booking, because words like "shift" would otherwise look like a reschedule.
      const adding = (prev as any)?.intent === "add_doctor";
      if (adding || isAddDoctor(message)) { intentName = "add_doctor"; return handleAddDoctor(db, b.clinicId, role, adding ? (prev as any) : undefined, message, adding); }

      const parsed = parseBookingText(message, today);
      const active = prev?.intent && prev.intent !== "other" ? prev.intent : undefined;
      // While a request is open, a bare "yes"/"ok" must not be mistaken for a patient name
      if (active && /^\s*(yes|yeah|yep|ok|okay|sure|confirm)\W*$/i.test(message)) delete parsed.name;
      const intent = parsed.intent !== "other" ? parsed.intent : active;

      if (!intent) {
        const qa = await answerQuestion(db, b.clinicId, userId, message, history, botName);
        src = qa.source; sent = qa.sentText; redactions = qa.redactions ?? 0; intentName = "question";
        return { reply: qa.reply, draft: null };
      }
      intentName = intent;
      const merged = mergeDraft(prev, { ...parsed, intent });
      return intent === "book" ? await handleBooking(db, b.clinicId, userId, merged) : await handleCancelOrMove(db, b.clinicId, userId, merged, intent, today);
    };

    const out = await run();
    await logInteraction(db, { clinicId: b.clinicId, userId, sessionId, module: "assistant", question: message, answer: out.reply, source: src, intent: intentName, sentText: sent, redactions });
    return { ...out, sessionId };
  });
}
