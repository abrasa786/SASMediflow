import { NextRequest, NextResponse } from "next/server";
import { requireClinicMember } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";

const WA_BASE = "https://graph.facebook.com/v18.0";

interface SendTextPayload {
  to: string;
  message: string;
}

interface SendTemplatePayload {
  to: string;
  template: string;
  language?: string;
  components?: object[];
}

async function sendWhatsApp(payload: object) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp not configured");
  }

  const res = await fetch(`${WA_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message ?? "WhatsApp API error");
  }

  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Only signed-in staff of a clinic may send; otherwise anyone could message from the clinic's number.
    await requireClinicMember(req, body.clinicId);
    const { type = "text", to, message, template, language = "en_US", components } = body;

    if (!to) {
      return NextResponse.json({ error: "to (phone number) is required" }, { status: 400 });
    }

    // Normalize phone number — ensure starts with country code
    const phone = to.replace(/\D/g, "").startsWith("91") ? to.replace(/\D/g, "") : `91${to.replace(/\D/g, "")}`;

    let result;
    if (type === "template") {
      if (!template) return NextResponse.json({ error: "template name required" }, { status: 400 });
      result = await sendWhatsApp({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "template",
        template: {
          name: template,
          language: { code: language },
          components: components ?? [],
        },
      });
    } else {
      if (!message) return NextResponse.json({ error: "message text required" }, { status: 400 });
      result = await sendWhatsApp({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: { body: message, preview_url: false },
      });
    }

    return NextResponse.json({ success: true, result });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("WhatsApp error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Meta webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}
