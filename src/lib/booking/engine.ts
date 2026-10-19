/**
 * Thin, testable wrapper over the appt_* database functions.
 * `db` is any object with a Supabase-style `.rpc(name, args)`.
 */
import { HttpError } from "@/lib/server/http";
import { addDays } from "./parse";

export interface SlotSuggestion { date: string; slots: { doctorId: string; doctorName: string; time: string }[] }

const REASON_TEXT: Record<string, string> = {
  booked: "That time is already taken",
  on_leave: "The doctor is on leave that day",
  break: "That time falls in the doctor's break",
  outside_hours: "That time is outside the doctor's working hours",
  clinic_closed: "The clinic is closed that day",
  past: "That time has already passed",
  doctor_inactive: "That doctor is not available for bookings",
  no_doctor_free: "No doctor is free at that time",
};

export function parseEngineError(message: string): { code: string; detail: string } {
  const m = message.match(/^([A-Z_]+):\s*(.*)$/s);
  return m ? { code: m[1], detail: m[2] } : { code: "ERROR", detail: message };
}

export function friendlyEngineMessage(code: string, detail: string): string {
  if (code === "SLOT_UNAVAILABLE") return REASON_TEXT[detail] ?? "That slot is not available";
  if (code === "ERROR") return "Something went wrong while saving the appointment.";
  return detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : "Request could not be completed";
}

export async function suggestSlots(
  db: any, clinicId: string, fromDate: string, opts: { doctorId?: string; durationMinutes?: number; max?: number; days?: number; afterTime?: string } = {},
): Promise<SlotSuggestion[]> {
  const out: SlotSuggestion[] = [];
  let total = 0;
  const max = opts.max ?? 6;
  for (let i = 0; i <= (opts.days ?? 7) && total < max; i++) {
    const date = addDays(fromDate, i);
    const { data, error } = await db.rpc("appt_slots", { p_clinic: clinicId, p_date: date, p_doctor: opts.doctorId ?? null, p_dur: opts.durationMinutes ?? null });
    if (error) throw new HttpError(500, error.message);
    const seen = new Set<string>();
    const slots: SlotSuggestion["slots"] = [];
    for (const s of (data ?? []) as any[]) {
      // one entry per time when no doctor is chosen (show the time once, with the first free doctor)
      const key = opts.doctorId ? s.s_time + s.s_doctor_id : s.s_time;
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push({ doctorId: s.s_doctor_id, doctorName: s.s_doctor_name, time: s.s_time });
      if (total + slots.length >= max) break;
    }
    if (slots.length) { out.push({ date, slots }); total += slots.length; }
  }
  return out;
}

export interface BookInput {
  clinicId: string; actor?: string | null;
  patient: { id?: string; name?: string; phone?: string; age?: number; gender?: string; email?: string; allergies?: string };
  doctorId?: string | null; specialty?: string; date: string; time: string; durationMinutes?: number;
  mode?: "in_clinic" | "video"; symptoms?: string; notes?: string; fee?: number; source?: "clinic" | "bot" | "app";
}

/** Book through the atomic engine. On a slot conflict, throws a 409 carrying alternative slots. */
export async function bookAppointmentViaEngine(db: any, input: BookInput) {
  const payload = {
    clinic_id: input.clinicId, actor: input.actor ?? null, patient: input.patient, doctor_id: input.doctorId ?? null,
    specialty: input.specialty ?? null, date: input.date, time: input.time, duration_minutes: input.durationMinutes ?? null,
    mode: input.mode ?? "in_clinic", symptoms: input.symptoms ?? null, notes: input.notes ?? null, fee: input.fee ?? null, source: input.source ?? "clinic",
  };
  const { data, error } = await db.rpc("appt_book", { p: payload });
  if (!error) return data;
  const { code, detail } = parseEngineError(error.message);
  if (code === "SLOT_UNAVAILABLE") {
    let suggestions: SlotSuggestion[] = [];
    try { suggestions = await suggestSlots(db, input.clinicId, input.date, { doctorId: input.doctorId ?? undefined, durationMinutes: input.durationMinutes }); } catch { /* suggestions are a bonus */ }
    throw new HttpError(409, friendlyEngineMessage(code, detail), { code, reason: detail, suggestions });
  }
  throw new HttpError(code === "ERROR" ? 500 : 400, friendlyEngineMessage(code, detail), { code });
}

export async function rescheduleViaEngine(db: any, a: { clinicId: string; actor?: string | null; appointmentId: string; date: string; time: string; doctorId?: string | null }) {
  const { data, error } = await db.rpc("appt_reschedule", { p_clinic: a.clinicId, p_actor: a.actor ?? null, p_appt: a.appointmentId, p_date: a.date, p_time: a.time, p_doctor: a.doctorId ?? null });
  if (!error) return data;
  const { code, detail } = parseEngineError(error.message);
  if (code === "SLOT_UNAVAILABLE") {
    let suggestions: SlotSuggestion[] = [];
    try { suggestions = await suggestSlots(db, a.clinicId, a.date, { doctorId: a.doctorId ?? undefined }); } catch { /* ignore */ }
    throw new HttpError(409, friendlyEngineMessage(code, detail), { code, reason: detail, suggestions });
  }
  throw new HttpError(code === "NOT_FOUND" ? 404 : code === "ERROR" ? 500 : 400, friendlyEngineMessage(code, detail), { code });
}

export async function setStatusViaEngine(db: any, a: { clinicId: string; actor?: string | null; appointmentId: string; status: string; reason?: string }) {
  const { data, error } = await db.rpc("appt_set_status", { p_clinic: a.clinicId, p_actor: a.actor ?? null, p_appt: a.appointmentId, p_status: a.status, p_reason: a.reason ?? null });
  if (!error) return data;
  const { code, detail } = parseEngineError(error.message);
  throw new HttpError(code === "SLOT_UNAVAILABLE" ? 409 : code === "NOT_FOUND" ? 404 : code === "ERROR" ? 500 : 400, friendlyEngineMessage(code, detail), { code });
}
