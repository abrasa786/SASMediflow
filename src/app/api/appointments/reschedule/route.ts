import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { rescheduleViaEngine } from "@/lib/booking/engine";
import { notifyAppointment } from "@/lib/booking/notify";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);
    if (typeof b.appointmentId !== "string") throw new HttpError(400, "appointmentId is required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "") || typeof b.time !== "string") throw new HttpError(400, "Choose a new date and time.");
    const details = await rescheduleViaEngine(db, { clinicId: b.clinicId, actor: userId, appointmentId: b.appointmentId, date: b.date, time: b.time, doctorId: b.doctorId || null });
    const notifications = b.notify === false ? [] : await notifyAppointment(db, b.clinicId, details, "reschedule");
    return { details, notifications };
  });
}
