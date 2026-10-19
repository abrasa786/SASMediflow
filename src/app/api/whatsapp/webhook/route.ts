import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase";
import { handleInbound } from "@/lib/whatsapp/inbound";
import { sendViaCloudApi, whatsappConfigured, whatsappPhone } from "@/lib/booking/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** WhatsApp's one-time check when you register the webhook: it sends a challenge and expects it back if the token matches. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("Forbidden", { status: 403 });
}

const validSignature = (raw: string, header: string | null) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice(7);
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
};

/** Messages from patients. Public URL, so every request must carry WhatsApp's signature; anything else is refused. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!process.env.WHATSAPP_APP_SECRET) return NextResponse.json({ error: "WhatsApp chat is not configured." }, { status: 503 });
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  let body: any; try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const db = createAdminClient();
  const msgs: { id: string; from: string; text: string }[] = [];
  for (const e of body?.entry ?? []) for (const c of e?.changes ?? []) for (const m of c?.value?.messages ?? []) {
    if (m?.id && m?.from) msgs.push({ id: String(m.id), from: String(m.from), text: m.type === "text" ? String(m.text?.body ?? "").slice(0, 500) : m.type === "button" ? String(m.button?.text ?? "") : "" });
  }
  for (const m of msgs.slice(0, 10)) {
    try {
      const { error: dup } = await db.from("wa_inbound").insert({ message_id: m.id, phone: m.from });     // a retry of the same message is ignored
      if (dup) continue;
      const since = new Date(Date.now() - 60000).toISOString();
      const { count } = await db.from("wa_inbound").select("message_id", { count: "exact", head: true }).eq("phone", m.from).gte("received_at", since);
      if ((count ?? 0) > 15) continue;
      const replies = m.text ? await handleInbound(db, m.from, m.text) : ["Hi! I can only read text messages. Send *menu* to see what I can do."];
      const to = whatsappPhone(m.from);
      if (to && whatsappConfigured()) for (const r of replies) await sendViaCloudApi(to, r);
    } catch (e) { console.error("whatsapp inbound failed:", e instanceof Error ? e.message : e); }
  }
  return NextResponse.json({ ok: true });
}
