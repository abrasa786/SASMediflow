import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { setStatusViaEngine } from "@/lib/booking/engine";
import { processFlowsSoon } from "@/lib/flows/engine";

/**
 * "Payment received": marks the invoice paid and, if it belongs to an appointment, closes that appointment as completed.
 * Returns the appointment's date so the screen can go straight back to it.
 * For now only the physical method (paid at the desk) is accepted; QR, UPI and online links come later.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.invoiceId)) throw new HttpError(400, "invoiceId is required.");
    const method = b.method == null ? "physical" : String(b.method);
    if (method !== "physical") throw new HttpError(400, "Only physical payment (at the desk) is available for now.");

    const { data: inv } = await db.from("invoices").select("id, clinic_id, status, total, paid_amount, appointment_id").eq("id", b.invoiceId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!inv) throw new HttpError(404, "Invoice not found.");
    if (inv.status === "cancelled") throw new HttpError(409, "This invoice is cancelled.");

    if (inv.status !== "paid") {
      const { error } = await db.from("invoices").update({ status: "paid", paid_amount: inv.total, payment_method: "physical" }).eq("id", inv.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
    }
    const appointmentId: string | null = inv.appointment_id ?? null;
    let appointmentDate: string | null = null;
    if (appointmentId) {
      const { data: a } = await db.from("appointments").select("appointment_date, status").eq("id", appointmentId).eq("clinic_id", b.clinicId).maybeSingle();
      appointmentDate = a?.appointment_date ?? null;
      if (a && a.status === "confirmed") {
        try { await setStatusViaEngine(db, { clinicId: b.clinicId, actor: userId, appointmentId, status: "completed" }); } catch { /* the payment is saved either way */ }
      }
    }
    await processFlowsSoon(db, b.clinicId);
    return { success: true, appointmentId, appointmentDate };
  });
}
