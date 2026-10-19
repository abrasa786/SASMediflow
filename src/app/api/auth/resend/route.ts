import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Re-sends the signup confirmation email. Always answers generically so it cannot be used to probe which emails exist. */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${appUrl}/login?confirmed=1` } });
    if (error && (error.code === "over_email_send_rate_limit" || /rate limit/i.test(error.message))) {
      return NextResponse.json({ error: "Too many emails requested. Please wait a few minutes and try again." }, { status: 429 });
    }
    if (error && (error.code === "email_address_not_authorized" || /not authorized/i.test(error.message))) {
      return NextResponse.json({ error: "Email sending isn't set up for this address yet. Ask the account owner to add SMTP in Supabase (Authentication → Emails → SMTP Settings)." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: "If that address has an unconfirmed account, a new confirmation email is on its way." });
  } catch (e: any) {
    return NextResponse.json({ error: "Could not resend. Please try again." }, { status: 500 });
  }
}
