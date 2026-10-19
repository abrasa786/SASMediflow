import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { onlineSettings } from "@/lib/booking/online";
import { sealGateway, gatewayFor } from "@/lib/payments/razorpay";
import { encryptionEnabled } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

const view = (settings: any, clinicId: string, req: NextRequest) => {
  const s = onlineSettings(settings), g = settings?.online_booking?.gateway;
  const gw = gatewayFor(settings);
  return {
    ...s, keyId: g?.key_id ?? (gw ? gw.keyId : ""), hasSecret: !!(g?.secret || gw), hasWebhookSecret: !!(g?.webhook_secret || gw?.webhookSecret),
    encryptionReady: encryptionEnabled(), usingPlatformKeys: !g?.secret && !!gw,
    webhookUrl: `${req.nextUrl.origin}/api/razorpay/webhook?c=${clinicId}`,
  };
};

export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db } = await requireClinicMember(req, clinicId, ["admin"]);
    const { data: c } = await db.from("clinics").select("slug, settings").eq("id", clinicId).maybeSingle();
    return { ...view(c?.settings, clinicId!, req), slug: c?.slug ?? "" };
  });
}

/** Admin only. Secrets are stored encrypted and never sent back. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const { data: c } = await db.from("clinics").select("settings").eq("id", b.clinicId).maybeSingle();
    const settings = { ...(c?.settings ?? {}) };
    const prev = settings.online_booking ?? {};
    const fee = Number(b.fee), hold = Number(b.hold_minutes), ahead = Number(b.advance_days);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw new HttpError(400, "The confirmation fee must be between 0 and 1,00,000.");
    if (fee > 0 && fee < 1) throw new HttpError(400, "The confirmation fee must be at least ₹1.");
    const next: any = {
      ...prev, enabled: !!b.enabled, fee, hold_minutes: Math.min(30, Math.max(3, hold || 10)), advance_days: Math.min(180, Math.max(1, ahead || 30)),
      notice: typeof b.notice === "string" ? b.notice.trim().slice(0, 400) : "",
    };
    const keyId = typeof b.keyId === "string" ? b.keyId.trim() : "", secret = typeof b.keySecret === "string" ? b.keySecret.trim() : "", wh = typeof b.webhookSecret === "string" ? b.webhookSecret.trim() : "";
    if (keyId || secret || wh) {
      if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) throw new HttpError(400, "That does not look like a Razorpay key id (it starts with rzp_test_ or rzp_live_).");
      try { next.gateway = sealGateway({ keyId: keyId || prev.gateway?.key_id, keySecret: secret || undefined, webhookSecret: wh || undefined }, prev.gateway); }
      catch (e: any) { throw new HttpError(400, e.message); }
    }
    settings.online_booking = next;
    if (next.enabled && fee > 0 && !gatewayFor(settings)) throw new HttpError(400, "Add your Razorpay key id and secret first, or set the fee to 0.");
    const { error } = await db.from("clinics").update({ settings }).eq("id", b.clinicId);
    if (error) throw new HttpError(500, "Could not save.");
    return view(settings, b.clinicId, req);
  });
}
