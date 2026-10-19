import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase";

/**
 * Creates the admin's login, the clinic, and the admin's staff record.
 *
 * Email verification: the account is created with the public sign-up call, which is
 * what makes Supabase actually send the confirmation email (admin.createUser never does).
 * While testing without SMTP set up, set AUTO_CONFIRM_EMAILS=true to skip verification.
 */
export async function POST(req: NextRequest) {
  try {
    const { clinicName, brandName, specialty, city, adminName, email, password } = await req.json();

    if (!clinicName || !specialty || !adminName || !email || !password) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    const admin = createAdminClient() as any;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "");
    const autoConfirm = process.env.AUTO_CONFIRM_EMAILS === "true";

    let userId: string;
    let needsEmailConfirmation = true;

    if (autoConfirm) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name: adminName },
      });
      if (error) return NextResponse.json({ error: friendlyAuthError(error) }, { status: 400 });
      userId = data.user.id;
      needsEmailConfirmation = false;
    } else {
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await anon.auth.signUp({
        email, password,
        options: { emailRedirectTo: `${appUrl}/login?confirmed=1`, data: { name: adminName } },
      });
      if (error) return NextResponse.json({ error: friendlyAuthError(error) }, { status: 400 });
      if (!data.user) return NextResponse.json({ error: "Could not create the account. Please try again." }, { status: 500 });
      // Supabase hides whether an address is already registered by returning a user with no identities.
      if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return NextResponse.json({ error: "This email is already registered. Sign in instead, or use “Forgot password”." }, { status: 409 });
      }
      userId = data.user.id;
      // A session comes back only when the project has "Confirm email" switched off.
      needsEmailConfirmation = !data.session && !data.user.email_confirmed_at;
    }

    // Retrying sign-up for an account whose clinic already exists must not create a second clinic.
    const { data: existing } = await admin.from("clinic_staff").select("clinic_id").eq("user_id", userId).eq("role", "admin").limit(1).maybeSingle();
    if (existing) {
      return NextResponse.json({ success: true, clinicId: existing.clinic_id, needsEmailConfirmation, resent: true });
    }

    const { data: clinic, error: clinicError } = await admin
      .from("clinics")
      .insert({ name: clinicName, brand_name: brandName || clinicName, specialty, city: city || null, is_active: true })
      .select()
      .single();
    if (clinicError) {
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: clinicError.message }, { status: 500 });
    }

    const { error: staffError } = await admin
      .from("clinic_staff")
      .insert({ clinic_id: clinic.id, user_id: userId, role: "admin", name: adminName, is_active: true });
    if (staffError) {
      await admin.from("clinics").delete().eq("id", clinic.id);
      await admin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: staffError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, clinicId: clinic.id, needsEmailConfirmation });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

function friendlyAuthError(error: { message: string; code?: string; status?: number }): string {
  const c = error.code ?? "";
  if (c === "email_address_not_authorized" || /not authorized/i.test(error.message)) {
    return "Supabase's built-in email service can only send to your own team members. In Supabase go to Authentication → Emails → SMTP Settings and add a sender (Resend, Brevo, Gmail SMTP…), or set AUTO_CONFIRM_EMAILS=true while testing.";
  }
  if (c === "over_email_send_rate_limit" || /rate limit/i.test(error.message)) {
    return "Too many emails were requested. Supabase's built-in email is limited to a few per hour. Wait a bit, or add your own SMTP in Supabase (Authentication → Emails → SMTP Settings).";
  }
  if (c === "user_already_exists" || c === "email_exists" || /already (been )?registered/i.test(error.message)) {
    return "This email is already registered. Sign in instead, or use “Forgot password”.";
  }
  if (c === "weak_password") return "That password is too weak. Use at least 8 characters with letters and numbers.";
  return error.message;
}
