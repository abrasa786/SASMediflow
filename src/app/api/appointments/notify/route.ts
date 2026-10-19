import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { notifyAppointment, type NotifyKind } from "@/lib/booking/notify";

/** Re-send a confirmation or reminder for an existing appointment. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId);
    const kind = (b.kind ?? "reminder") as NotifyKind;
    if (!["confirmation", "reminder"].includes(kind)) throw new HttpError(400, "kind must be confirmation or reminder.");
    if (typeof b.appointmentId !== "string") throw new HttpError(400, "appointmentId is required.");
    const { data: ok } = await db.from("appointments").select("id").eq("id", b.appointmentId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!ok) throw new HttpError(404, "Appointment not found.");
    const { data: details } = await db.rpc("appt_details", { p_appt: b.appointmentId });
    const only = b.only === "patient" || b.only === "doctor" ? [b.only] : undefined;
    return { notifications: await notifyAppointment(db, b.clinicId, details, kind, only) };
  });
}
