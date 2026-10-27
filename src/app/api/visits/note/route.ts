import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

const str = (v: unknown, max = 1500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Record, change or remove what was done at a visit. Doctors, nurses and admins; the clinic and patient are checked here. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse"]);

    if (b.action === "delete") {
      if (typeof b.id !== "string") throw new HttpError(400, "Missing id.");
      const { error } = await db.from("visit_notes").delete().eq("id", b.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }

    const f = b.fields ?? {};
    const treatment = str(f.treatment, 300);
    if (!treatment) throw new HttpError(400, "Write what treatment was done.");
    const date = typeof f.visit_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.visit_date) ? f.visit_date : null;
    const fields = {
      treatment, tooth: str(f.tooth, 60), findings: str(f.findings), concerns: str(f.concerns), conditions: str(f.conditions, 500),
      alert: str(f.alert, 300), follow_up: str(f.follow_up, 500), ...(date ? { visit_date: date } : {}), updated_at: new Date().toISOString(),
    };

    if (b.action === "update") {
      if (typeof b.id !== "string") throw new HttpError(400, "Missing id.");
      const { data, error } = await db.from("visit_notes").update(fields).eq("id", b.id).eq("clinic_id", b.clinicId).select("id").maybeSingle();
      if (error) throw new HttpError(400, error.message);
      if (!data) throw new HttpError(404, "Note not found.");
      return { id: data.id };
    }

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
    if (error) throw new HttpError(400, error.message);
    return { id: data.id };
  });
}
