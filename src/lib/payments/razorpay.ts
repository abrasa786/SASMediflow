/**
 * Razorpay (UPI, cards, netbanking, wallets) for the patient confirmation fee.
 * Each clinic uses its OWN Razorpay account (keys saved encrypted in the clinic's settings), so the money goes straight to the clinic.
 * If a clinic has not saved keys, the platform's RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are used when present.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { decrypt, encrypt, encryptionEnabled } from "@/lib/ai/crypto";

export interface Gateway { keyId: string; keySecret: string; webhookSecret?: string }

/** The secret never leaves the server: settings keep only ciphertext. */
export function gatewayFor(settings: any): Gateway | null {
  const g = settings?.online_booking?.gateway;
  if (g?.key_id && g?.secret) {
    const secret = decrypt(g.secret, true);
    if (secret && !secret.startsWith("[encrypted")) {
      return { keyId: g.key_id, keySecret: secret, webhookSecret: g.webhook_secret ? decrypt(g.webhook_secret, true) : undefined };
    }
  }
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return { keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET };
  }
  return null;
}

export function sealGateway(input: { keyId: string; keySecret?: string; webhookSecret?: string }, prev: any) {
  if (!encryptionEnabled()) throw new Error("AI_DATA_KEY is not set in hosting, so payment keys cannot be stored safely yet.");
  return {
    key_id: input.keyId,
    secret: input.keySecret ? encrypt(input.keySecret).value : prev?.secret,
    webhook_secret: input.webhookSecret ? encrypt(input.webhookSecret).value : prev?.webhook_secret,
  };
}

const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const hmac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("hex");

/** Checkout success signature: HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyCheckout(g: Gateway, orderId: string, paymentId: string, signature: string): boolean {
  return !!signature && safeEq(hmac(g.keySecret, `${orderId}|${paymentId}`), signature);
}
/** Webhook signature: HMAC_SHA256(raw body, webhook secret). */
export function verifyWebhook(secret: string, rawBody: string, signature: string): boolean {
  return !!secret && !!signature && safeEq(hmac(secret, rawBody), signature);
}

async function call(g: Gateway, path: string, body?: unknown) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: "Basic " + Buffer.from(`${g.keyId}:${g.keySecret}`).toString("base64") },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.description ?? `Razorpay error ${res.status}`);
  return j;
}

export async function createOrder(g: Gateway, o: { amountRupees: number; receipt: string; notes?: Record<string, string> }) {
  const j = await call(g, "/orders", { amount: Math.round(o.amountRupees * 100), currency: "INR", receipt: o.receipt.slice(0, 40), payment_capture: 1, notes: o.notes ?? {} });
  return { id: j.id as string, amount: j.amount as number };
}
export async function refundPayment(g: Gateway, paymentId: string, amountRupees: number) {
  const j = await call(g, `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: Math.round(amountRupees * 100), speed: "optimum" });
  return j.id as string;
}
/** Used by the webhook and as a double check: is this payment really captured for this order? */
export async function fetchPayment(g: Gateway, paymentId: string) { return call(g, `/payments/${encodeURIComponent(paymentId)}`); }
