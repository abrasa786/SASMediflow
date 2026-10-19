import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { finalizeBooking } from "@/lib/booking/online";
import { gatewayFor, verifyWebhook } from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";

/**
 * Safety net: if a patient pays and then closes the page, Razorpay tells us and we still make the booking.
 * Set the webhook URL in the clinic's Razorpay dashboard to  /api/razorpay/webhook?c=<clinic id>  (events: payment.captured, order.paid).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const clinicId = req.nextUrl.searchParams.get("c") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(clinicId)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const db = createAdminClient();
  const { data: c } = await db.from("clinics").select("id, slug, name, settings").eq("id", clinicId).maybeSingle();
  const gw = c ? gatewayFor(c.settings) : null;
  if (!c || !gw?.webhookSecret || !verifyWebhook(gw.webhookSecret, raw, req.headers.get("x-razorpay-signature") ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const ev = JSON.parse(raw);
    if (ev.event === "payment.captured" || ev.event === "order.paid") {
      const pay = ev.payload?.payment?.entity;
      const orderId: string | undefined = pay?.order_id ?? ev.payload?.order?.entity?.id;
      const paymentId: string | undefined = pay?.id;
      if (orderId && paymentId) {
        const { data: h } = await db.from("booking_holds").select("id").eq("order_id", orderId).eq("clinic_id", c.id).maybeSingle();
        if (h) await finalizeBooking(db, c, gw, { holdId: h.id, orderId, paymentId }).catch(() => {});
      }
    }
  } catch { /* always answer 200 once the signature is good, so Razorpay does not retry forever */ }
  return NextResponse.json({ ok: true });
}
