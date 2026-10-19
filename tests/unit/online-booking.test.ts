import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyCheckout, verifyWebhook, gatewayFor } from "../../src/lib/payments/razorpay";
import { onlineSettings, summary } from "../../src/lib/booking/online";

const g = { keyId: "rzp_test_abc", keySecret: "s3cret" };
const sig = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("hex");

test("checkout signature: only the real order and payment verify", () => {
  assert.equal(verifyCheckout(g, "order_1", "pay_1", sig("order_1|pay_1", "s3cret")), true);
  assert.equal(verifyCheckout(g, "order_1", "pay_2", sig("order_1|pay_1", "s3cret")), false, "different payment");
  assert.equal(verifyCheckout(g, "order_1", "pay_1", sig("order_1|pay_1", "wrong")), false, "wrong secret");
  assert.equal(verifyCheckout(g, "order_1", "pay_1", ""), false, "empty signature");
  assert.equal(verifyCheckout(g, "order_1", "pay_1", "abc"), false, "short signature does not throw");
});

test("webhook signature is checked over the raw body", () => {
  const body = '{"event":"payment.captured"}';
  assert.equal(verifyWebhook("wh", body, sig(body, "wh")), true);
  assert.equal(verifyWebhook("wh", body + " ", sig(body, "wh")), false, "tampered body");
  assert.equal(verifyWebhook("", body, sig(body, "")), false, "no secret configured means no trust");
});

test("clinic settings are clamped and default to off", () => {
  assert.equal(onlineSettings({}).enabled, false);
  const s = onlineSettings({ online_booking: { enabled: true, fee: -5, hold_minutes: 999, advance_days: 0 } });
  assert.deepEqual([s.fee, s.hold_minutes, s.advance_days], [0, 30, 30]);
  assert.equal(onlineSettings({ online_booking: { enabled: true, fee: 100 } }).fee, 100);
});

test("no gateway without keys; secrets are never needed to describe the booking", () => {
  const had = [process.env.RAZORPAY_KEY_ID, process.env.RAZORPAY_KEY_SECRET];
  delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
  assert.equal(gatewayFor({}), null);
  if (had[0]) process.env.RAZORPAY_KEY_ID = had[0]; if (had[1]) process.env.RAZORPAY_KEY_SECRET = had[1];
});

test("the patient only gets their own booking back", () => {
  const out = summary({ appointment: { id: "abcdef12-0000", date: "2026-11-02", time: "10:00 AM", fee: 500 }, doctor: { name: "Dr. Rao", phone: "999" }, patient: { name: "Asha", phone: "98450" }, clinic: { name: "Sai", address: "MG Road", phone: "080", secret: "x" }, advance_paid: 50 });
  assert.equal(out.id, "ABCDEF12");
  assert.equal(out.advancePaid, 50);
  assert.ok(!JSON.stringify(out).includes("999"), "doctor phone is not exposed");
});
