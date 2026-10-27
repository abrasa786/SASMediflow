import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

/** Tie an appointment to one sitting of a treatment plan (or untie it). The patient must be the same on both. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.appointmentId !== "string") throw new HttpError(400, "Missing appointment.");
    const { data: ap } = await db.from("appointments").select("id, clinic_patient_id").eq("id", b.appointmentId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!ap) throw new HttpError(404, "Appointment not found in this clinic.");
    if (b.action === "unlink") {
      await db.from("treatment_sittings").update({ appointment_id: null }).eq("appointment_id", ap.id).eq("clinic_id", b.clinicId).eq("status", "pending");
      await db.from("appointments").update({ treatment_plan_id: null }).eq("id", ap.id).eq("clinic_id", b.clinicId);
      return { ok: true };
    }
    if (typeof b.sittingId !== "string") throw new HttpError(400, "Choose a sitting.");
    const { data: st } = await db.from("treatment_sittings").select("id, status, plan_id, treatment_plans!inner(clinic_patient_id)").eq("id", b.sittingId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!st) throw new HttpError(404, "Sitting not found in this clinic.");
    if ((st as any).treatment_plans?.clinic_patient_id !== ap.clinic_patient_id) throw new HttpError(400, "That sitting belongs to a different patient.");
    if (st.status !== "pending") throw new HttpError(400, "Only a sitting that is still pending can be linked to a visit.");
    const { error } = await db.from("treatment_sittings").update({ appointment_id: ap.id }).eq("id", st.id).eq("clinic_id", b.clinicId);
    if (error) throw new HttpError(400, error.message);
    await db.from("appointments").update({ treatment_plan_id: st.plan_id }).eq("id", ap.id).eq("clinic_id", b.clinicId);   // works even before migration 025's trigger exists
    return { ok: true };
  });
}
