import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { requestOffersConsent } from "@/lib/offers/consent";

/** Front desk: ask a patient on WhatsApp if they want tips and offers (they reply START). New patients are also asked automatically when booked. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.patientId !== "string") throw new HttpError(400, "Which patient?");
    const r = await requestOffersConsent(db, b.clinicId, b.patientId);
    if (r.status === "skipped") {
      const why = { opted_in: [409, "This patient has already agreed to get offers."], opted_out: [409, "This patient switched offers off, so they will not be asked again. If they want them back, tick the box when they tell you."], no_phone: [400, "This patient has no valid mobile number."], not_found: [404, "Patient not found in this clinic."], no_template: [400, "Not set up."] }[r.reason] as [number, string];
      throw new HttpError(why[0], why[1]);
    }
    return r;
  });
}
