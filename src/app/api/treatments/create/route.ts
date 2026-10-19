import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";
import { notifyAppointment } from "@/lib/booking/notify";

/** Create a multi-sitting treatment plan: books every sitting with the doctor, in order. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "receptionist"]);
    if (typeof b.patientId !== "string" || typeof b.doctorId !== "string") throw new HttpError(400, "Choose a patient and a doctor.");
    if (!b.templateId && !Array.isArray(b.sittings)) throw new HttpError(400, "Choose a treatment template.");
    const { data, error } = await db.rpc("tx_create_plan", { p: {
      clinic_id: b.clinicId, actor: userId, patient_id: b.patientId, doctor_id: b.doctorId,
      template_id: b.templateId ?? null, sittings: b.sittings ?? null, title: b.title ?? null,
      total_amount: b.total ?? null, discount: b.discount ?? 0, start_date: b.startDate, time: b.time,
    } });
    if (error) throwRpc(error);

    // Tell the patient about the first sitting (the rest are announced as they come round).
    let notifications: any[] = [];
    const first = data?.sittings?.[0];
    if (first && b.notify !== false) {
      const { data: details } = await db.rpc("appt_details", { p_appt: first.appointment_id });
      if (details) notifications = await notifyAppointment(db, b.clinicId, details, "confirmation");
    }
    return { plan: data, notifications };
  });
}
