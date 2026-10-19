import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { handle, HttpError } from "@/lib/server/http";
import { clientIp, tooMany } from "@/lib/server/ratelimit";
import { findClinic, requireOpen, finalizeBooking, summary } from "@/lib/booking/online";
import { friendlyEngineMessage, parseEngineError, suggestSlots } from "@/lib/booking/engine";
import { createOrder } from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";
const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : "");

/** Step 1: hold the chosen time for a few minutes. With a fee: returns a Razorpay order to pay. Without: books straight away. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (tooMany("hold:" + clientIp(req), 12, 10 * 60_000)) throw new HttpError(429, "Too many tries. Please wait a few minutes.");
    const b = await req.json().catch(() => ({}));
    const db = createAdminClient();
    const c = await findClinic(db, { slug: str(b.clinic, 80), host: str(b.host, 253) });
    const { gw } = requireOpen(c);
    const doctorId = str(b.doctorId, 40);
    if (!/^[0-9a-f-]{36}$/i.test(doctorId)) throw new HttpError(400, "Please choose a doctor.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str(b.date, 10))) throw new HttpError(400, "Please choose a date.");

    const { data: hold, error } = await db.rpc("online_hold", { p: {
      clinic_id: c.id, doctor_id: doctorId, date: b.date, time: str(b.time, 12), symptoms: str(b.symptoms, 300),
      patient: { name: str(b.name, 100), phone: str(b.phone, 20), email: str(b.email, 120) },
    } });
    if (error) {
      const { code, detail } = parseEngineError(error.message);
      if (code === "SLOT_UNAVAILABLE") {
        let suggestions: any[] = [];
        try { suggestions = await suggestSlots(db, c.id, b.date, { doctorId, max: 6 }); } catch { /* optional */ }
        throw new HttpError(409, "Sorry, that time is no longer available. Please pick another.", { code, suggestions });
      }
      throw new HttpError(code === "ERROR" ? 500 : 400, friendlyEngineMessage(code, detail), { code });
    }

    if (!(hold.amount > 0)) {                                // nothing to pay
      const { details } = await finalizeBooking(db, c, gw, { holdId: hold.hold_id, orderId: null, paymentId: null });
      return { confirmed: true, booking: summary(details) };
    }
    try {
      const order = await createOrder(gw!, { amountRupees: hold.amount, receipt: hold.hold_id, notes: { clinic: c.slug ?? "", hold: hold.hold_id } });
      await db.from("booking_holds").update({ order_id: order.id }).eq("id", hold.hold_id);
      return { confirmed: false, holdId: hold.hold_id, orderId: order.id, amount: hold.amount, keyId: gw!.keyId, expiresAt: hold.expires_at, minutes: hold.minutes, doctor: hold.doctor, date: hold.date, time: hold.time };
    } catch {
      await db.from("booking_holds").delete().eq("id", hold.hold_id);
      throw new HttpError(502, "We could not start the payment. Please try again in a moment, or call the clinic.");
    }
  });
}
