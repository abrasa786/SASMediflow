import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { planOrderDates } from "@/lib/visits/orders";
import { findPendingOrder } from "@/lib/visits/po-link";

const str = (v: unknown, max = 1500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const nice = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export interface Reminder { orderBy: string; checkBy: string; neededBy: string | null; late: boolean; stock: string; onOrder: string | null }

/**
 * "Needs X before the next visit": make (or update) two tasks, one to order it in time and one to check it arrived the day before.
 * Looks the item up in the stock list so the task says whether it is already on the shelf.
 */
async function syncReminders(db: any, clinicId: string, userId: string, note: any, patientName: string): Promise<Reminder | null> {
  const clearTasks = async () => {
    const ids = [note.order_task_id, note.check_task_id].filter(Boolean);
    if (ids.length) await db.from("clinic_tasks").delete().in("id", ids).eq("clinic_id", clinicId).eq("status", "todo");   // only if nobody started or finished it
    await db.from("visit_notes").update({ order_task_id: null, check_task_id: null, needed_by: null }).eq("id", note.id);
  };
  if (!note.order_item) { await clearTasks(); return null; }

  const today = todayIST();
  let neededBy: string | null = isDate(note.needed_by) ? note.needed_by : null;
  if (!neededBy) {                                                                 // default: the patient's next confirmed appointment
    const { data: nx } = await db.from("appointments").select("appointment_date").eq("clinic_id", clinicId).eq("clinic_patient_id", note.clinic_patient_id)
      .eq("status", "confirmed").gt("appointment_date", note.visit_date > today ? note.visit_date : today).order("appointment_date").limit(1);
    neededBy = nx?.[0]?.appointment_date ?? null;
  }
  const d = planOrderDates(neededBy, today);

  const words = String(note.order_item).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).slice(0, 4);
  let stock = "Not on your stock list, so it needs to be ordered.";
  if (words.length) {
    const { data: hit } = await db.from("stock_items").select("name, quantity, min_quantity, unit").eq("clinic_id", clinicId).or(words.map((w) => `name.ilike.%${w}%`).join(",")).limit(3);
    if (hit?.length) stock = "On your stock list: " + hit.map((h: any) => `${h.name} (${h.quantity} ${h.unit ?? "pcs"} in stock${h.quantity <= (h.min_quantity ?? 0) ? ", running low" : ""})`).join("; ") + ". Order only if this is not enough.";
  }

  const pending = await findPendingOrder(db, clinicId, note.order_item);           // already ordered and waiting to arrive?
  if (pending) stock = `Already on order: ${pending.po_number}. Close that order when it arrives and this reminder clears.`;

  const who = `${patientName}${note.tooth ? `, tooth ${note.tooth}` : ""}`;
  const when = neededBy ? `needed by the visit on ${nice(neededBy)}` : "no next appointment is booked yet";
  const order = { title: `Order ${note.order_item} for ${who}`, due_date: d.orderBy, priority: "high", kind: "order_material", ...(pending ? { status: "done", auto_closed_by_po: pending.id } : {}),
    description: `${note.order_item} for ${who}: ${when}.${d.late ? " The visit is close, so order today." : ""}\n${stock}\nFrom the visit note: ${note.treatment}.` };
  const check = { title: `Check ${note.order_item} has arrived for ${patientName}`, due_date: d.checkBy, priority: "high", kind: "check_material",
    description: `${patientName} is due ${neededBy ? `on ${nice(neededBy)}` : "soon"} and needs the ${note.order_item}. If it has not come, call the lab or supplier and move the visit if needed.` };

  const upsert = async (id: string | null, row: any) => {
    if (id) { const { data } = await db.from("clinic_tasks").update(row).eq("id", id).eq("clinic_id", clinicId).select("id").maybeSingle(); if (data) return data.id as string; }
    const { data, error } = await db.from("clinic_tasks").insert({ status: "todo", ...row, clinic_id: clinicId, created_by: userId }).select("id").single();
    if (error) throw new HttpError(400, error.message);
    return data.id as string;
  };
  const orderId = await upsert(note.order_task_id ?? null, order), checkId = await upsert(note.check_task_id ?? null, check);
  await db.from("visit_notes").update({ order_task_id: orderId, check_task_id: checkId, needed_by: neededBy }).eq("id", note.id);
  return { orderBy: d.orderBy, checkBy: d.checkBy, neededBy, late: d.late && !pending, stock, onOrder: pending?.po_number ?? null };
}

/** Record, change or remove what was done at a visit. Doctors, nurses and admins; the clinic and patient are checked here. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse"]);

    if (b.action === "delete") {
      if (typeof b.id !== "string") throw new HttpError(400, "Missing id.");
      const { data: n } = await db.from("visit_notes").select("id, order_task_id, check_task_id").eq("id", b.id).eq("clinic_id", b.clinicId).maybeSingle();
      if (n) await db.from("clinic_tasks").delete().in("id", [n.order_task_id, n.check_task_id].filter(Boolean)).eq("clinic_id", b.clinicId).eq("status", "todo");
      const { error } = await db.from("visit_notes").delete().eq("id", b.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }

    const f = b.fields ?? {};
    const treatment = str(f.treatment, 300);
    if (!treatment) throw new HttpError(400, "Write what treatment was done.");
    const fields: Record<string, unknown> = {
      treatment, tooth: str(f.tooth, 60), findings: str(f.findings), concerns: str(f.concerns), conditions: str(f.conditions, 500),
      alert: str(f.alert, 300), follow_up: str(f.follow_up, 500), open_points: str(f.open_points, 500), order_item: str(f.order_item, 120), updated_at: new Date().toISOString(),
    };
    if (isDate(f.visit_date)) fields.visit_date = f.visit_date;
    fields.needed_by = isDate(f.needed_by) ? f.needed_by : null;
    if (fields.order_item && typeof f.needed_by === "string" && f.needed_by && !isDate(f.needed_by)) throw new HttpError(400, "The 'needed by' date is not valid.");

    let noteId: string;
    if (b.action === "update") {
      if (typeof b.id !== "string") throw new HttpError(400, "Missing id.");
      const { data, error } = await db.from("visit_notes").update(fields).eq("id", b.id).eq("clinic_id", b.clinicId).select("id").maybeSingle();
      if (error) throw new HttpError(400, /order_item|needed_by|open_points/.test(error.message) ? "Run migrations 023 and 026 first." : error.message);
      if (!data) throw new HttpError(404, "Note not found.");
      noteId = data.id;
    } else {
      if (typeof b.patientId !== "string") throw new HttpError(400, "Choose a patient.");
      const { data: pt } = await db.from("clinic_patients").select("id").eq("id", b.patientId).eq("clinic_id", b.clinicId).maybeSingle();
      if (!pt) throw new HttpError(404, "Patient not found in this clinic.");
      let doctorId: string | null = null, appointmentId: string | null = null;
      if (typeof b.appointmentId === "string") {
        const { data: ap } = await db.from("appointments").select("id, doctor_id, clinic_patient_id").eq("id", b.appointmentId).eq("clinic_id", b.clinicId).maybeSingle();
        if (!ap || ap.clinic_patient_id !== b.patientId) throw new HttpError(400, "That appointment is not for this patient.");
        appointmentId = ap.id; doctorId = ap.doctor_id ?? null;
      }
      const { data, error } = await db.from("visit_notes").insert({ ...fields, clinic_id: b.clinicId, clinic_patient_id: b.patientId, appointment_id: appointmentId, doctor_id: doctorId, created_by: userId }).select("id").single();
      if (error) throw new HttpError(400, /order_item|needed_by|open_points/.test(error.message) ? "Run migrations 023 and 026 first." : error.message);
      noteId = data.id;
    }

    // the reminders come after the note is safely saved: if they fail, the note is still there and we say so
    let reminder: Reminder | null = null, reminderError: string | null = null;
    try {
      const { data: note } = await db.from("visit_notes").select("*, clinic_patients(name)").eq("id", noteId).eq("clinic_id", b.clinicId).maybeSingle();
      if (note) reminder = await syncReminders(db, b.clinicId, userId, note, note.clinic_patients?.name ?? "the patient");
    } catch (e: any) { reminderError = e.message; }
    return { id: noteId, reminder, reminderError };
  });
}
