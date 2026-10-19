import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { parseBookingText, mergeDraft, missingForBooking, todayInTz, formatDateNice, type BookingDraft } from "@/lib/booking/parse";
import { bookAppointmentViaEngine, rescheduleViaEngine, setStatusViaEngine, suggestSlots } from "@/lib/booking/engine";
import { notifyAppointment, type NotificationResult } from "@/lib/booking/notify";

export const dynamic = "force-dynamic";

type Action = { label: string; url: string };
interface Reply { reply: string; draft: BookingDraft | null; actions?: Action[]; appointmentId?: string; slots?: string[] }

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

// ── clinic Q&A (Gemini) ─────────────────────────────────────────────
async function clinicContext(db: any, clinicId: string): Promise<string> {
  const today = todayInTz();
  const [{ data: clinic }, { data: appts }, { data: patients }, { data: invoices }, { data: stock }] = await Promise.all([
    db.from("clinics").select("name, brand_name, specialty, city").eq("id", clinicId).single(),
    db.from("appointments").select("appointment_time, status, consultation_fee, symptoms, clinic_patients(name), doctors(name)").eq("clinic_id", clinicId).eq("appointment_date", today).order("start_time"),
    db.from("clinic_patients").select("name, phone, conditions").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(10),
    db.from("invoices").select("total, status").eq("clinic_id", clinicId).gte("created_at", `${today}T00:00:00`),
    db.from("stock_items").select("name, quantity, min_quantity, unit").eq("clinic_id", clinicId),
  ]);
  const billed = (appts ?? []).reduce((s: number, a: any) => s + (a.consultation_fee || 0), 0);
  const paid = (invoices ?? []).filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + (i.total || 0), 0);
  const low = (stock ?? []).filter((s: any) => s.min_quantity != null && s.quantity <= s.min_quantity);
  const cnt = (st: string) => (appts ?? []).filter((a: any) => a.status === st).length;
  return `CLINIC: ${clinic?.brand_name || clinic?.name} (${clinic?.specialty}, ${clinic?.city})
DATE: ${today}
TODAY'S APPOINTMENTS (${appts?.length ?? 0}):
${(appts ?? []).map((a: any) => `- ${a.appointment_time}: ${a.clinic_patients?.name ?? "Unknown"} with ${a.doctors?.name ?? "duty doctor"} [${a.status}] ₹${a.consultation_fee ?? 0} — ${a.symptoms || "check-up"}`).join("\n") || "None"}
STATUS: confirmed ${cnt("confirmed")}, completed ${cnt("completed")}, cancelled ${cnt("cancelled")}, no-show ${cnt("no_show")}
REVENUE TODAY: ₹${paid} collected / ₹${billed} billed
RECENT PATIENTS:
${(patients ?? []).map((p: any) => `- ${p.name}${p.phone ? ` (${p.phone})` : ""}${p.conditions ? ` | ${p.conditions}` : ""}`).join("\n") || "None"}
LOW STOCK (${low.length}):
${low.map((s: any) => `- ${s.name}: ${s.quantity} ${s.unit ?? ""} (min ${s.min_quantity})`).join("\n") || "All items adequately stocked"}`;
}

async function askGemini(db: any, clinicId: string, message: string, history: any[]): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return "AI answers aren't switched on yet (no Gemini key is set). I can still book, cancel and reschedule appointments. Try: “Book Priya Sharma 9876543210 tomorrow 10am”.";
  const ctx = await clinicContext(db, clinicId);
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const system = `You are a concise clinic assistant with live access to this data:\n\n${ctx}\n\nAnswer using only this data. Use ₹ and Indian number format. If something isn't in the data, say so. Under 150 words. You can also tell the user they can type things like "Book Anita 9876543210 tomorrow 4pm", "Cancel Rahul's appointment" or "Move Asha to Friday 11am" to manage appointments.`;
  const contents = [
    ...history.slice(-8).filter((m: any) => typeof m?.content === "string").map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content).slice(0, 1500) }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.3, maxOutputTokens: 512 } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) { const e: any = await res.json().catch(() => ({})); throw new HttpError(502, e?.error?.message ?? "The AI service is not responding. Try again shortly."); }
  const j: any = await res.json();
  return j.candidates?.[0]?.content?.parts?.[0]?.text ?? "Sorry, I couldn't generate a response.";
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);
    const message = typeof b.message === "string" ? b.message.trim().slice(0, 1000) : "";
    if (!message) throw new HttpError(400, "message is required.");
    const history = Array.isArray(b.history) ? b.history : [];
    const prev: BookingDraft | undefined = b.draft && typeof b.draft === "object" ? b.draft : undefined;
    const today = todayInTz();

    if (prev?.intent && prev.intent !== "other" && ABORT.test(message)) {
      return { reply: "No problem, I've dropped that request.", draft: null } satisfies Reply;
    }

    const parsed = parseBookingText(message, today);
    const active = prev?.intent && prev.intent !== "other" ? prev.intent : undefined;
    // While a request is open, a bare "yes"/"ok" must not be mistaken for a patient name
    if (active && /^\s*(yes|yeah|yep|ok|okay|sure|confirm)\W*$/i.test(message)) delete parsed.name;
    const intent = parsed.intent !== "other" ? parsed.intent : active;

    if (!intent) {
      const reply = await askGemini(db, b.clinicId, message, history);
      return { reply, draft: null } satisfies Reply;
    }

    const merged = mergeDraft(prev, { ...parsed, intent });
    const out = intent === "book" ? await handleBooking(db, b.clinicId, userId, merged)
      : await handleCancelOrMove(db, b.clinicId, userId, merged, intent, today);
    return out;
  });
}
