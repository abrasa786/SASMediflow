import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { bookAppointmentViaEngine } from "@/lib/booking/engine";
import { notifyAppointment } from "@/lib/booking/notify";
import { requestOffersConsent } from "@/lib/offers/consent";
import { processFlowsSoon } from "@/lib/flows/engine";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);

    if (!ISO.test(b.date ?? "")) throw new HttpError(400, "Please choose a date.");
    if (!str(b.time, 12)) throw new HttpError(400, "Please choose a time.");
    const p = b.patient ?? {};
    if (!p.id && !str(p.name)) throw new HttpError(400, "Patient name is required.");
    if (b.mode && !["in_clinic", "video"].includes(b.mode)) throw new HttpError(400, "Invalid visit mode.");
    const fee = b.fee === undefined || b.fee === "" || b.fee === null ? undefined : Number(b.fee);
    if (fee !== undefined && (!Number.isFinite(fee) || fee < 0 || fee > 1_000_000)) throw new HttpError(400, "Fee must be a positive number.");

    const details = await bookAppointmentViaEngine(db, {
      clinicId: b.clinicId, actor: userId,
      patient: { id: str(p.id, 40), name: str(p.name, 120), phone: str(p.phone, 20), age: p.age ? Number(p.age) : undefined, gender: str(p.gender, 10), email: str(p.email, 120), allergies: str(p.allergies, 200) },
      doctorId: str(b.doctorId, 40), specialty: str(b.specialty, 60), date: b.date, time: b.time,
      durationMinutes: b.durationMinutes ? Number(b.durationMinutes) : undefined, mode: b.mode,
      symptoms: str(b.symptoms), notes: str(b.notes), fee, source: "clinic",
    });
    const notifications = b.notify === false ? [] : await notifyAppointment(db, b.clinicId, details, "confirmation");
    // a brand-new patient is also asked, on WhatsApp, if they want tips and offers (only when WhatsApp and the consent template are set up)
    if (b.notify !== false && details?.patient_created && details?.patient?.id) await requestOffersConsent(db, b.clinicId, details.patient.id, true).catch(() => null);
    await processFlowsSoon(db, b.clinicId);
    return { details, notifications };
  });
}
