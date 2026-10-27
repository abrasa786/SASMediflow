import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

/** Front desk: the patient agreed (or declined) to receive offers when asked in person. The date and where it was agreed are kept. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.patientId !== "string" || typeof b.on !== "boolean") throw new HttpError(400, "Missing patient or answer.");
    const now = new Date().toISOString();
    const patch = b.on
      ? { marketing_opt_in: true, marketing_opt_in_at: now, marketing_opt_in_source: "front_desk", marketing_opt_out_at: null }
      : { marketing_opt_in: false, marketing_opt_out_at: now };
    const { data, error } = await db.from("clinic_patients").update(patch).eq("id", b.patientId).eq("clinic_id", b.clinicId).select("id").maybeSingle();
    if (error) throw new HttpError(400, /marketing_opt/.test(error.message) ? "Run migration 020 (offers consent) first." : error.message);
    if (!data) throw new HttpError(404, "Patient not found in this clinic.");
    return { ok: true };
  });
}
