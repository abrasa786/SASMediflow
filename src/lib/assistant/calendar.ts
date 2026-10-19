/**
 * Calendar by chat, for everyone on the team (within their role):
 *   agenda ("what's on tomorrow", "Dr Mehta's schedule on Friday"), free times, leave, weekly hours (admin), and marking a visit done / missed.
 * Booking, cancelling and moving appointments live in the main chat handler and use the same booking engine.
 */
import { addDays, formatDateNice, parseBookingText } from "@/lib/booking/parse";
import { parseShift } from "@/lib/booking/doctor-parse";
import { DAY, daysText, isYes, loadDoctors, parseRange, pickDoctor, type AxCtx, type AxReply } from "./common";

const parseDate = (t: string, today: string) => parseBookingText(t, today);
const hhmm12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`; };

type Kind = "agenda" | "free" | "leave_add" | "leave_remove" | "hours" | "status";
export function detectCalendar(t: string): Kind | null {
  const s = t.toLowerCase();
  if (/\b(?:remove|cancel|delete|clear|undo|end)\b.*\b(?:leave|holiday|time off)\b/.test(s)) return "leave_remove";
  if (/\b(?:on leave|leave|holiday|vacation|day off|time off|off duty|unavailable|absent)\b/.test(s) && /\b(?:mark|put|set|add|block|record|is|will be|going|taking|has|have|needs?|from|for)\b/.test(s) && !/\b(?:request|apply|balance|my leave|approve|reject)\b/.test(s)) return "leave_add";
  if (/\b(?:works?|working hours|timings?|shift|hours)\b/.test(s) && /\d\s*(?:am|pm|:\d\d)?\s*(?:-|–|to|till|until)\s*\d/.test(s) && /\b(?:set|change|update|make|works?|working|now|from)\b/.test(s)) return "hours";
  if (/\b(?:free|available|open)\b.*\b(?:slots?|times?|time)\b|\bwhen is\b.*\bfree\b|\bfree (?:slots?|times?)\b|\bany(?:thing| slots?)? (?:free|available|open)\b/.test(s)) return "free";
  if (/\b(?:mark|set)\b.*\b(?:completed?|done|finished|no[- ]?show|missed)\b|\b(?:was a|is a)\s+no[- ]?show\b|\b(?:did not|didn'?t|did n't)\s+(?:show|turn)\s*up\b/.test(s)) return "status";
  if (/\b(?:agenda|schedule|calendar)\b/.test(s) || /\b(?:what'?s|whats|what is|what do (?:i|we) have)\b.*\b(?:on|today|tomorrow|schedule)\b/.test(s) || /^(?:show|list|view|see|give)\b.*\b(?:appointments?|bookings?|patients?)\b/.test(s)
      || /\bmy (?:appointments?|patients|day)\b/.test(s) || /\b(?:dr\.?|doctor)\s+\w+'?s?\s+(?:appointments?|schedule|agenda|day)\b/.test(s)) return "agenda";
  return null;
}

export async function handleCalendar(c: AxCtx): Promise<AxReply | null> {
  const open: string | undefined = c.prev?.intent?.startsWith("ax:cal_") ? c.prev.intent : undefined;
  if (open) return continueOpen(c, open);
  const kind = detectCalendar(c.message);
  if (!kind) return null;
  const doctors = await loadDoctors(c.db, c.clinicId);
  const pick = pickDoctor(doctors, c.message, c.userId);
  if (pick.error) return { reply: pick.error, draft: null };
  const { date } = parseDate(c.message, c.today);
  switch (kind) {
    case "agenda": return agenda(c, pick.doctor, date ?? c.today, /\bmy\b/i.test(c.message) && !pick.doctor ? doctors.find((d) => d.user_id === c.userId) : undefined);
    case "free": return free(c, pick.doctor, date ?? c.today);
    case "leave_add": return leaveAdd(c, pick.doctor ?? (c.role === "doctor" ? doctors.find((d) => d.user_id === c.userId) : undefined), doctors);
    case "leave_remove": return leaveRemove(c, pick.doctor ?? (c.role === "doctor" ? doctors.find((d) => d.user_id === c.userId) : undefined));
    case "hours": return hoursStart(c, pick.doctor);
    case "status": return statusChange(c);
  }
}

async function agenda(c: AxCtx, doctor: { id: string; name: string } | undefined, date: string, mine?: { id: string; name: string }): Promise<AxReply> {
  const doc = doctor ?? mine;
  let q = c.db.from("appointments").select("appointment_time, start_time, status, doctor_id, doctors(name), clinic_patients(name)").eq("clinic_id", c.clinicId).eq("appointment_date", date).in("status", ["confirmed", "completed", "no_show"]).order("start_time").limit(40);
  if (doc) q = q.eq("doctor_id", doc.id);
  const { data } = await q;
  const { data: leaves } = await c.db.from("doctor_leaves").select("doctors(name)").eq("clinic_id", c.clinicId).lte("from_date", date).gte("to_date", date);
  const rows = (data ?? []) as any[];
  const head = `${doc ? doc.name + "'s" : "Clinic"} schedule for ${formatDateNice(date)}`;
  const lines = rows.map((a) => `• ${a.appointment_time} · ${a.clinic_patients?.name ?? "Patient"}${doc ? "" : " · " + (a.doctors?.name ?? "Doctor")}${a.status !== "confirmed" ? ` · ${a.status.replace("_", " ")}` : ""}`);
  const away = (leaves ?? []).map((l: any) => l.doctors?.name).filter(Boolean);
  return {
    reply: `${head}\n${lines.length ? lines.join("\n") : "No appointments."}${away.length ? `\n🏖️ On leave: ${Array.from(new Set(away)).join(", ")}` : ""}`,
    draft: null, actions: [{ label: "Open the calendar", url: "/calendar" }],
  };
}

async function free(c: AxCtx, doctor: { id: string; name: string } | undefined, date: string): Promise<AxReply> {
  const { suggestSlots } = await import("@/lib/booking/engine");
  const sugg = await suggestSlots(c.db, c.clinicId, date, { doctorId: doctor?.id, max: 60, days: 0 });
  const slots = sugg[0]?.slots ?? [];
  if (!slots.length) return { reply: `${doctor ? doctor.name + " has" : "Nobody has"} no free times on ${formatDateNice(date)}. Try another day, for example “free slots tomorrow”.`, draft: null };
  const by = new Map<string, string[]>();
  for (const s of slots) by.set(s.doctorName, [...(by.get(s.doctorName) ?? []), s.time]);
  return { reply: `Free times on ${formatDateNice(date)}:\n` + Array.from(by.entries()).map(([n, t]) => `• ${n}: ${t.slice(0, 10).join(", ")}${t.length > 10 ? ` … (+${t.length - 10} more)` : ""}`).join("\n") + "\nTo book one, say “Book <name> <phone> <time>”.", draft: null };
}

async function leaveAdd(c: AxCtx, doctor: { id: string; name: string; user_id?: string | null } | undefined, doctors: any[]): Promise<AxReply> {
  if (c.role !== "admin" && !(c.role === "doctor" && doctor?.user_id === c.userId)) return { reply: "Only an admin, or the doctor themselves, can mark a doctor on leave.", draft: null };
  if (!doctor) return { reply: `Which doctor? ${doctors.map((d) => d.name).join(", ")}`, draft: { intent: "ax:cal_leave_add" } };
  const r = parseRange(c.message, c.today, parseDate);
  if (!r.from) return { reply: `For which dates is ${doctor.name} on leave? For example “25 to 27 Oct” or “tomorrow”.`, draft: { intent: "ax:cal_leave_add", doctorId: doctor.id, doctorName: doctor.name } };
  return leaveConfirm(c, doctor.id, doctor.name, r.from, r.to ?? r.from, c.message.match(/\b(?:for|because|reason:?)\s+([a-z ]{3,40})$/i)?.[1]);
}
async function leaveConfirm(c: AxCtx, doctorId: string, name: string, from: string, to: string, reason?: string): Promise<AxReply> {
  const { count } = await c.db.from("appointments").select("id", { count: "exact", head: true }).eq("clinic_id", c.clinicId).eq("doctor_id", doctorId).eq("status", "confirmed").gte("appointment_date", from).lte("appointment_date", to);
  const when = from === to ? formatDateNice(from) : `${formatDateNice(from)} to ${formatDateNice(to)}`;
  return { reply: `Mark ${name} on leave ${when}? Nobody will be able to book ${name} then.${count ? `\n⚠️ ${count} confirmed appointment${count > 1 ? "s" : ""} fall in that period. They stay booked until you move them.` : ""}\nReply yes to confirm.`, draft: { intent: "ax:cal_leave_add", doctorId, doctorName: name, from, to, reason: reason ?? null, confirm: true } };
}

async function leaveRemove(c: AxCtx, doctor: { id: string; name: string; user_id?: string | null } | undefined): Promise<AxReply> {
  if (c.role !== "admin" && !(c.role === "doctor" && doctor?.user_id === c.userId)) return { reply: "Only an admin, or the doctor themselves, can remove leave.", draft: null };
  if (!doctor) return { reply: "Whose leave should I remove? Say the doctor's name.", draft: { intent: "ax:cal_leave_remove" } };
  const { data } = await c.db.from("doctor_leaves").select("id, from_date, to_date").eq("clinic_id", c.clinicId).eq("doctor_id", doctor.id).gte("to_date", c.today).order("from_date");
  const { from } = parseRange(c.message, c.today, parseDate);
  const hit = (data ?? []).filter((l: any) => !from || (from >= l.from_date && from <= l.to_date));
  if (!hit.length) return { reply: `${doctor.name} has no upcoming leave${from ? " on that date" : ""}.`, draft: null };
  const txt = hit.map((l: any) => (l.from_date === l.to_date ? formatDateNice(l.from_date) : `${formatDateNice(l.from_date)} to ${formatDateNice(l.to_date)}`)).join("; ");
  return { reply: `Remove ${doctor.name}'s leave (${txt})? Reply yes to confirm.`, draft: { intent: "ax:cal_leave_remove", doctorName: doctor.name, ids: hit.map((l: any) => l.id), confirm: true } };
}

function parseHours(text: string) {
  const brk = text.match(/\bbreak\s*(?:from\s*)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to|till|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  const main = text.replace(brk?.[0] ?? "", " ");
  const sh = parseShift(main);
  let br: { start: string; end: string } | undefined;
  if (brk) { const b = parseShift(`break ${brk[1]} - ${brk[2]}`.replace(/break/, "hours")); if (b.start && b.end) br = { start: b.start, end: b.end }; }
  let days: number[] | undefined;
  const range = main.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:-|–|to|through|till)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/i);
  if (range) { const a = DAY.indexOf(range[1].toLowerCase()), b = DAY.indexOf(range[2].toLowerCase()); days = []; for (let i = a; ; i = (i + 1) % 7) { days.push(i); if (i === b) break; } }
  else { const list = Array.from(main.toLowerCase().matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*/g)).map((m) => DAY.indexOf(m[1])); if (list.length) days = Array.from(new Set(list)); }
  if (/\bevery ?day|all days|daily|7 days\b/i.test(main)) days = [0, 1, 2, 3, 4, 5, 6];
  return { ...sh, brk: br, days };
}
async function hoursStart(c: AxCtx, doctor: { id: string; name: string } | undefined): Promise<AxReply> {
  if (c.role !== "admin") return { reply: "Only an admin can change a doctor's weekly hours.", draft: null };
  if (!doctor) return { reply: "Which doctor's hours? Say the name, for example “Dr Mehta works 10am to 6pm Monday to Friday”.", draft: null };
  const h = parseHours(c.message);
  if (h.shiftError) return { reply: h.shiftError, draft: null };
  if (!h.start || !h.end) return { reply: "What hours? For example “Dr Mehta works 10am to 6pm Monday to Friday, break 1pm to 2pm”.", draft: null };
  const days = h.days ?? [1, 2, 3, 4, 5, 6];
  return { reply: `Set ${doctor.name}'s weekly hours to ${daysText(days)}, ${hhmm12(h.start)} to ${hhmm12(h.end)}${h.brk ? `, break ${hhmm12(h.brk.start)} to ${hhmm12(h.brk.end)}` : ""}?\nThis replaces the hours now on file. Reply yes to confirm.`, draft: { intent: "ax:cal_hours", doctorId: doctor.id, doctorName: doctor.name, start: h.start, end: h.end, brk: h.brk ?? null, days, confirm: true } };
}

async function statusChange(c: AxCtx): Promise<AxReply> {
  const s = c.message;
  const status = /no[- ]?show|missed|did not|didn'?t/i.test(s) ? "no_show" : "completed";
  const nm = s.match(/\b(?:mark|set)\s+(.+?)(?:'s)?\s+(?:appointment\s+|visit\s+)?(?:as\s+)?(?:completed?|done|finished|a no[- ]?show|no[- ]?show|missed)\b/i)?.[1]
    ?? s.match(/^(.+?)\s+(?:was a no[- ]?show|did not|didn'?t|did n't)\b/i)?.[1];
  const name = (nm ?? "").replace(/^(?:the\s+)?(?:appointment|visit)\s+(?:of|for)\s+/i, "").replace(/[^A-Za-z .'-]/g, "").trim();
  if (name.length < 2) return { reply: "Whose appointment? For example “Mark Rahul as completed” or “Anita was a no-show”.", draft: null };
  const { date } = parseDate(s, c.today);
  const day = date ?? c.today;
  const { data: pats } = await c.db.from("clinic_patients").select("id, name").eq("clinic_id", c.clinicId).ilike("name", `%${name}%`).limit(6);
  if (!pats?.length) return { reply: `I couldn't find a patient called “${name}”.`, draft: null };
  const { data: appts } = await c.db.from("appointments").select("id, appointment_time, clinic_patients(name)").eq("clinic_id", c.clinicId).eq("appointment_date", day).eq("status", "confirmed").in("clinic_patient_id", pats.map((p: any) => p.id));
  if (!appts?.length) return { reply: `${pats[0].name} has no confirmed appointment on ${formatDateNice(day)}.`, draft: null };
  if (appts.length > 1) return { reply: `More than one match on ${formatDateNice(day)}: ${appts.map((a: any) => `${a.clinic_patients?.name} at ${a.appointment_time}`).join("; ")}. Please say the full name.`, draft: null };
  if (c.role === "intern") return { reply: "Interns cannot change appointment status.", draft: null };
  const { setStatusViaEngine } = await import("@/lib/booking/engine");
  const { processFlowsSoon } = await import("@/lib/flows/engine");
  await setStatusViaEngine(c.db, { clinicId: c.clinicId, actor: c.userId, appointmentId: appts[0].id, status });
  await processFlowsSoon(c.db, c.clinicId);
  return { reply: `Done. ${appts[0].clinic_patients?.name}'s ${appts[0].appointment_time} appointment is marked ${status === "no_show" ? "a no-show" : "completed"}.`, draft: null, actions: [{ label: "Open appointments", url: "/appointments" }] };
}

async function continueOpen(c: AxCtx, intent: string): Promise<AxReply | null> {
  const d = c.prev;
  if (intent === "ax:cal_leave_add") {
    if (d.confirm && isYes(c.message)) {
      const { error } = await c.db.from("doctor_leaves").insert({ clinic_id: c.clinicId, doctor_id: d.doctorId, from_date: d.from, to_date: d.to, reason: d.reason, created_by: c.userId });
      if (error) return { reply: `I couldn't save that: ${error.message}`, draft: null };
      return { reply: `Done. ${d.doctorName} is on leave ${d.from === d.to ? formatDateNice(d.from) : formatDateNice(d.from) + " to " + formatDateNice(d.to)} and can't be booked then.`, draft: null, actions: [{ label: "Open the calendar", url: "/calendar" }] };
    }
    // still collecting details: doctor and/or dates
    const doctors = await loadDoctors(c.db, c.clinicId);
    const pick = d.doctorId ? { doctor: doctors.find((x) => x.id === d.doctorId) } : pickDoctor(doctors, c.message, c.userId);
    if ("error" in pick && pick.error) return { reply: pick.error, draft: d };
    const doc = pick.doctor ?? (c.role === "doctor" ? doctors.find((x) => x.user_id === c.userId) : undefined);
    if (!doc) return { reply: `Which doctor? ${doctors.map((x) => x.name).join(", ")}`, draft: d };
    const r = parseRange(c.message, c.today, parseDate);
    if (!r.from) return { reply: `For which dates is ${doc.name} on leave?`, draft: { ...d, doctorId: doc.id, doctorName: doc.name } };
    return leaveConfirm(c, doc.id, doc.name, r.from, r.to ?? r.from);
  }
  if (intent === "ax:cal_leave_remove") {
    if (d.confirm && isYes(c.message)) {
      const { error } = await c.db.from("doctor_leaves").delete().eq("clinic_id", c.clinicId).in("id", d.ids);
      return { reply: error ? `I couldn't remove it: ${error.message}` : `Done. ${d.doctorName}'s leave is removed.`, draft: null };
    }
    const doctors = await loadDoctors(c.db, c.clinicId);
    const pick = pickDoctor(doctors, c.message, c.userId);
    return pick.doctor ? leaveRemove(c, pick.doctor) : { reply: pick.error ?? "Whose leave should I remove?", draft: d };
  }
  if (intent === "ax:cal_hours" && d.confirm && isYes(c.message)) {
    if (c.role !== "admin") return { reply: "Only an admin can change a doctor's weekly hours.", draft: null };
    const rows = (d.days as number[]).map((weekday) => ({ weekday, start: d.start, end: d.end, break_start: d.brk?.start ?? null, break_end: d.brk?.end ?? null }));
    const { error } = await c.db.rpc("appt_set_schedule", { p_clinic: c.clinicId, p_doctor: d.doctorId, p_rows: rows });
    return { reply: error ? `I couldn't save the hours: ${error.message.replace(/^[A-Z_]+:\s*/, "")}` : `Done. ${d.doctorName} now works ${daysText(d.days)}, ${hhmm12(d.start)} to ${hhmm12(d.end)}.`, draft: null, actions: [{ label: "Open availability", url: "/availability" }] };
  }
  return null;     // not a yes: let the main handler treat it as a new request
}
export { addDays };
