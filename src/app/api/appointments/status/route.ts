import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { setStatusViaEngine } from "@/lib/booking/engine";
import { notifyAppointment } from "@/lib/booking/notify";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);
    if (typeof b.appointmentId !== "string" || typeof b.status !== "string") throw new HttpError(400, "appointmentId and status are required.");
    const details = await setStatusViaEngine(db, { clinicId: b.clinicId, actor: userId, appointmentId: b.appointmentId, status: b.status, reason: typeof b.reason === "string" ? b.reason : undefined });
    // Only a real cancellation is announced; completing or marking no-show stays quiet.
    const notifications = details.changed && b.status === "cancelled" && b.notify !== false
      ? await notifyAppointment(db, b.clinicId, details, "cancellation") : [];
    return { details, notifications };
  });
}
