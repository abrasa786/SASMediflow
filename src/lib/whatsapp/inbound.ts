/**
 * A patient chats with the clinic on WhatsApp. They can only ever see and change THEIR OWN appointments and bills:
 * the phone number that wrote in decides which patient records are in play. No data leaves the clinic's database.
 */
import { formatDateNice, parseBookingText, todayInTz } from "@/lib/booking/parse";
import { bookAppointmentViaEngine, rescheduleViaEngine, setStatusViaEngine, suggestSlots } from "@/lib/booking/engine";
import { notifyAppointment } from "@/lib/booking/notify";
import { processFlowsSoon } from "@/lib/flows/engine";
import { checkScope } from "@/lib/ai/scope";
import { clip, detectWaIntent, pickNumber, WA_MENU } from "./intent";

const TTL_MIN = 30;
type Pat = { clinic_id: string; clinic_name: string; patient_id: string; patient_name: string; opted_out: boolean };
const hm = (t: string) => { const m = String(t).match(/^(\d{1,2}):(\d{2})/); if (!m) return String(t); const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? "PM" : "AM"}`; };

async function saveState(db: any, phone: string, clinicId: string | null, state: any) {
  if (!state) { await db.from("wa_conversations").delete().eq("phone", phone); return; }
  await db.from("wa_conversations").upsert({ phone, clinic_id: clinicId, state, updated_at: new Date().toISOString() });
}

export async function handleInbound(db: any, phoneRaw: string, text: string): Promise<string[]> {
  const phone = phoneRaw.replace(/\D/g, "").slice(-10);
  const { data: found } = await db.rpc("wa_find_patients", { p_phone: phone });
  const pats = (found ?? []) as Pat[];
  const intent0 = detectWaIntent(text);
  if (!pats.length) return ["Hello! I couldn't find this number at any clinic using our system. Please call the clinic and ask them to add your number."];

  // stop / start apply to this phone everywhere
  if (intent0 === "stop" || intent0 === "start") {
    await db.from("clinic_patients").update({ wa_opt_out: intent0 === "stop", wa_opt_out_at: intent0 === "stop" ? new Date().toISOString() : null }).in("id", pats.map((p) => p.patient_id));
    await saveState(db, phone, null, null);
    return [intent0 === "stop" ? "You won't get reminders or follow-up messages any more. You can still message us to book or ask. Send START to turn them back on." : "Reminders and follow-ups are on again."];
  }

  const { data: row } = await db.from("wa_conversations").select("clinic_id, state, updated_at").eq("phone", phone).maybeSingle();
  let state: any = row && Date.now() - new Date(row.updated_at).getTime() < TTL_MIN * 60000 ? row.state : null;
  let clinicId: string | null = row?.clinic_id && state ? row.clinic_id : null;
  const clinics = Array.from(new Map(pats.map((p) => [p.clinic_id, p.clinic_name])).entries());

  // which clinic?
  if (!clinicId && clinics.length === 1) clinicId = clinics[0][0];
  if (!clinicId && state?.step === "pick_clinic") {
    const n = pickNumber(text, clinics.length);
    if (n) { clinicId = clinics[n - 1][0]; text = state.pending ?? "menu"; state = null; }
  }
  if (!clinicId) {
    await saveState(db, phone, null, { step: "pick_clinic", pending: text });
    return [`Which clinic is this about?\n${clinics.map(([, n], i) => `${i + 1}. ${n}`).join("\n")}\nReply with the number.`];
  }
  const mine = pats.filter((p) => p.clinic_id === clinicId);
  const clinicName = clinics.find(([id]) => id === clinicId)![1];
  const { data: cl } = await db.from("clinics").select("ai_name").eq("id", clinicId).maybeSingle();
  const bot: string = cl?.ai_name || "the assistant";
  const today = todayInTz();
  const intent = detectWaIntent(text);

  const upcoming = async () => {
    const { data } = await db.from("appointments").select("id, appointment_date, appointment_time, start_time, doctor_id, clinic_patient_id, doctors(name), clinic_patients(name)")
      .eq("clinic_id", clinicId).in("clinic_patient_id", mine.map((p) => p.patient_id)).eq("status", "confirmed").gte("appointment_date", today).order("appointment_date").order("start_time").limit(6);
    return (data ?? []) as any[];
  };
  const line = (a: any) => `${formatDateNice(a.appointment_date)} at ${a.appointment_time}${a.doctors?.name ? " with " + a.doctors.name : ""}${mine.length > 1 ? ` (${a.clinic_patients?.name})` : ""}`;
  const keep = async (s: any) => saveState(db, phone, clinicId, s);

  // ── continuing a multi-step chat ──
  if (state && intent !== "menu") {
    if (state.step === "pick_patient") {
      const n = pickNumber(text, mine.length);
      if (!n) return [`Please reply with a number from 1 to ${mine.length}.`];
      await keep({ step: "ask_day", mode: "book", patientId: mine[n - 1].patient_id });
      return [`Booking for ${mine[n - 1].patient_name}. Which day would you like? For example “tomorrow”, “Friday” or “25 Oct”.`];
    }
    if (state.step === "pick_appt") {
      const n = pickNumber(text, state.options.length);
      if (!n) return [`Please reply with a number from 1 to ${state.options.length}.`];
      const a = (await upcoming()).find((x) => x.id === state.options[n - 1]);
      if (!a) { await keep(null); return ["That appointment is no longer there. Send *my appointments* to see what's booked."]; }
      if (state.action === "cancel") { await keep({ step: "confirm_cancel", apptId: a.id }); return [`Cancel ${line(a)}? Reply *yes* to confirm or *no* to keep it.`]; }
      await keep({ step: "ask_day", mode: "reschedule", apptId: a.id, doctorId: a.doctor_id });
      return [`Moving ${line(a)}. Which day would you like instead? For example “tomorrow”, “Friday” or “25 Oct”.`];
    }
    if (state.step === "confirm_cancel") {
      if (intent === "no") { await keep(null); return ["No problem, your appointment stays as it is."]; }
      if (intent !== "yes") return ["Please reply *yes* to cancel or *no* to keep the appointment."];
      const a = (await upcoming()).find((x) => x.id === state.apptId);
      await keep(null);
      if (!a) return ["That appointment was already cancelled or has passed."];
      const details = await setStatusViaEngine(db, { clinicId, actor: null, appointmentId: a.id, status: "cancelled", reason: "Cancelled by the patient on WhatsApp" });
      if (details?.changed) await notifyAppointment(db, clinicId, details, "cancellation", ["doctor"]);
      await processFlowsSoon(db, clinicId);
      return [`Done. ${line(a)} is cancelled. Send *book* any time to book again.`];
    }
    if (state.step === "ask_day") {
      const date = parseBookingText(text, today).date;
      if (!date || date < today) return ["Sorry, I didn't catch the day. Try “tomorrow”, “Friday” or “25 Oct”."];
      let sugg = await suggestSlots(db, clinicId, date, { doctorId: state.doctorId ?? undefined, max: 6, days: 3 });
      if (!sugg.length && state.doctorId) sugg = await suggestSlots(db, clinicId, date, { max: 6, days: 3 });
      const slots = sugg.flatMap((d) => d.slots.map((s) => ({ date: d.date, time: s.time, doctorId: s.doctorId, doctorName: s.doctorName }))).slice(0, 6);
      if (!slots.length) return ["There are no free times around that day. Try another day."];
      await keep({ ...state, step: "pick_slot", slots });
      return [`Free times:\n${slots.map((s, i) => `${i + 1}. ${formatDateNice(s.date)}, ${hm(s.time)} · ${s.doctorName}`).join("\n")}\nReply with the number you'd like.`];
    }
    if (state.step === "pick_slot") {
      const n = pickNumber(text, state.slots.length);
      if (!n) return [`Please reply with a number from 1 to ${state.slots.length}, or send *menu*.`];
      const s = state.slots[n - 1];
      try {
        let details: any;
        if (state.mode === "reschedule") details = await rescheduleViaEngine(db, { clinicId, actor: null, appointmentId: state.apptId, date: s.date, time: s.time, doctorId: s.doctorId });
        else {
          if ((await upcoming()).filter((x) => x.clinic_patient_id === state.patientId).length >= 3) { await keep(null); return ["You already have 3 upcoming appointments. Please call the clinic to book more."]; }
          details = await bookAppointmentViaEngine(db, { clinicId, actor: null, patient: { id: state.patientId }, doctorId: s.doctorId, date: s.date, time: s.time, symptoms: "Booked on WhatsApp", source: "bot" });
        }
        await keep(null);
        if (details?.appointment) await notifyAppointment(db, clinicId, details, state.mode === "reschedule" ? "reschedule" : "confirmation", ["doctor"]);
        await processFlowsSoon(db, clinicId);
        return [`✅ ${state.mode === "reschedule" ? "Moved to" : "Booked for"} ${formatDateNice(s.date)} at ${hm(s.time)} with ${s.doctorName}. ${clinicName} will see you then. Send *my appointments* any time to check.`];
      } catch (e: any) {
        await keep({ ...state, step: "ask_day" });
        return [`${String(e.message ?? "That time is no longer free.").slice(0, 200)} Which other day works for you?`];
      }
    }
  }

  // ── a fresh request ──
  switch (intent) {
    case "appointments": {
      const a = await upcoming();
      return [a.length ? `Your upcoming appointments at ${clinicName}:\n${a.map((x) => "• " + line(x)).join("\n")}` : "You have no upcoming appointments. Send *book* to book one."];
    }
    case "cancel": case "reschedule": {
      const a = await upcoming();
      if (!a.length) return ["You have no upcoming appointments. Send *book* to book one."];
      if (a.length === 1) {
        if (intent === "cancel") { await keep({ step: "confirm_cancel", apptId: a[0].id }); return [`Cancel ${line(a[0])}? Reply *yes* to confirm or *no* to keep it.`]; }
        await keep({ step: "ask_day", mode: "reschedule", apptId: a[0].id, doctorId: a[0].doctor_id });
        return [`Moving ${line(a[0])}. Which day would you like instead? For example “tomorrow”, “Friday” or “25 Oct”.`];
      }
      await keep({ step: "pick_appt", action: intent, options: a.map((x) => x.id) });
      return [`Which appointment?\n${a.map((x, i) => `${i + 1}. ${line(x)}`).join("\n")}\nReply with the number.`];
    }
    case "book": {
      if (mine.length > 1) { await keep({ step: "pick_patient" }); return [`Who is the appointment for?\n${mine.map((p, i) => `${i + 1}. ${p.patient_name}`).join("\n")}\nReply with the number.`]; }
      await keep({ step: "ask_day", mode: "book", patientId: mine[0].patient_id });
      return [`Happy to help, ${mine[0].patient_name.split(" ")[0]}. Which day would you like? For example “tomorrow”, “Friday” or “25 Oct”.`];
    }
    case "balance": {
      const { data } = await db.from("invoices").select("invoice_number, total, paid_amount, status").eq("clinic_id", clinicId).in("clinic_patient_id", mine.map((p) => p.patient_id)).in("status", ["sent", "partially_paid"]).order("created_at", { ascending: false }).limit(10);
      const rows = ((data ?? []) as any[]).map((r) => ({ n: r.invoice_number, due: Math.max(Number(r.total) - Number(r.paid_amount || 0), 0) })).filter((r) => r.due > 0);
      if (!rows.length) return ["You have nothing due. Thank you!"];
      return [`You have ₹${Math.round(rows.reduce((s, r) => s + r.due, 0)).toLocaleString("en-IN")} due at ${clinicName}:\n${rows.map((r) => `• ${r.n ?? "Invoice"}: ₹${Math.round(r.due).toLocaleString("en-IN")}`).join("\n")}\nPlease pay at the clinic or ask the front desk for a payment link.`];
    }
    case "menu": await keep(null); return [WA_MENU(clinicName, bot)];
    default: {
      const sc = checkScope(text, { module: "assistant" });
      if (!sc.ok) return [`I can only help with your appointments and bills at ${clinicName}. ` + clip(WA_MENU(clinicName, bot), 400).split("\n").slice(1).join("\n")];
      return [WA_MENU(clinicName, bot)];
    }
  }
}
