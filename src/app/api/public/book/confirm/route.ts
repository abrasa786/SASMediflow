import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { handle, HttpError } from "@/lib/server/http";
import { clientIp, tooMany } from "@/lib/server/ratelimit";
import { finalizeBooking, summary } from "@/lib/booking/online";
import { gatewayFor, verifyCheckout } from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";
const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Step 2: the patient paid. The payment signature is checked with the clinic's secret before anything is booked. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    if (tooMany("confirm:" + clientIp(req), 20, 10 * 60_000)) throw new HttpError(429, "Too many tries. Please wait a few minutes.");
    const b = await req.json().catch(() => ({}));
    const holdId = str(b.holdId, 40), orderId = str(b.orderId, 60), paymentId = str(b.paymentId, 60), signature = str(b.signature, 200);
    if (!/^[0-9a-f-]{36}$/i.test(holdId) || !orderId || !paymentId || !signature) throw new HttpError(400, "Payment details are missing.");
    const db = createAdminClient();

    // the hold may already be gone if this is a repeat (the webhook got there first): look the order up instead
    const { data: h } = await db.from("booking_holds").select("clinic_id, order_id").eq("id", holdId).maybeSingle();
    let clinicId: string | undefined = h?.clinic_id;
    if (!clinicId) { const { data: p } = await db.from("booking_payments").select("clinic_id").eq("order_id", orderId).maybeSingle(); clinicId = p?.clinic_id; }
    if (!clinicId) throw new HttpError(404, "We could not find this booking. If money was deducted, it will be refunded; please call the clinic.");
    const { data: c } = await db.from("clinics").select("id, slug, name, settings, is_active").eq("id", clinicId).maybeSingle();
    const gw = c ? gatewayFor(c.settings) : null;
    if (!c || !gw) throw new HttpError(503, "Payment is not set up for this clinic.");
    if (h && h.order_id !== orderId) throw new HttpError(400, "That payment is for a different booking.");
    if (!verifyCheckout(gw, orderId, paymentId, signature)) throw new HttpError(400, "We could not verify this payment. If money was deducted it will be refunded; please call the clinic.");

    const { details } = await finalizeBooking(db, c, gw, { holdId, orderId, paymentId });
    return { confirmed: true, booking: summary(details) };
  });
}
