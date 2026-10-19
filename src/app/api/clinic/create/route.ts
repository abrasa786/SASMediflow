import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase";
import { addDomainToVercel, checkAiName, checkColor, checkDomain, checkSlug, newDomainToken, saveLogo } from "@/lib/server/branding";

/**
 * Creates the admin's login, the clinic, and the admin's staff record.
 *
 * Email verification: the account is created with the public sign-up call, which is
 * what makes Supabase actually send the confirmation email (admin.createUser never does).
 * While testing without SMTP set up, set AUTO_CONFIRM_EMAILS=true to skip verification.
 */
export async function POST(req: NextRequest) {
  try {
    const { clinicName, brandName, specialty, city, adminName, email, password, logoDataUrl, primaryColor, tagline, slug, customDomain, aiName } = await req.json();

    if (!clinicName || !specialty || !adminName || !email || !password) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
    }

    // validate branding first so a bad logo/domain never leaves a half-created account
    let colour: string | null, aiNameClean: string | null = null, domainClean: string | null = null, slugClean: string | null = null;
    try {
      colour = checkColor(primaryColor);
      aiNameClean = checkAiName(aiName);
      if (customDomain) domainClean = checkDomain(customDomain);
      if (slug) slugClean = checkSlug(slug);
      if (logoDataUrl && !/^data:image\/(png|jpeg|webp);base64,/.test(logoDataUrl)) throw Object.assign(new Error("The logo must be a PNG, JPG or WebP image."), { status: 400 });
      if (logoDataUrl && String(logoDataUrl).length > 1.45 * 1024 * 1024) throw Object.assign(new Error("The logo is too large. Use an image under 1 MB."), { status: 400 });
    } catch (e: any) { return NextResponse.json({ error: e.message }, { status: e.status ?? 400 }); }

    const admin = createAdminClient() as any;
    if (slugClean) {
      const { data: s } = await admin.from("clinics").select("id").ilike("slug", slugClean).maybeSingle();
      if (s) return NextResponse.json({ error: "That web address is already taken. Try another." }, { status: 409 });
    }
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

    const fullRow = { name: clinicName, brand_name: brandName || clinicName, specialty, city: city || null, is_active: true, ...(colour ? { primary_color: colour } : {}), ...(aiNameClean ? { ai_name: aiNameClean } : {}), ...(tagline ? { tagline: String(tagline).slice(0, 120) } : {}), ...(slugClean ? { slug: slugClean } : {}), ...(domainClean ? { custom_domain: domainClean, domain_verified: false, domain_token: newDomainToken() } : {}) };
    let { data: clinic, error: clinicError } = await admin.from("clinics").insert(fullRow).select().single();
    // A database that is behind (a branding migration not run yet) must not block sign-up: create with the basics.
    if (clinicError && /schema cache|column/i.test(clinicError.message)) {
      console.error("clinics insert failed, retrying with basic fields (run the latest migrations):", clinicError.message);
      ({ data: clinic, error: clinicError } = await admin.from("clinics").insert({ name: clinicName, brand_name: brandName || clinicName, specialty, city: city || null, is_active: true }).select().single());
    }
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

    // Starter setup: booking rules, price list, treatment templates, empty stock shelves. No patient data.
    const { error: provisionError } = await admin.rpc("clinic_provision", { p_clinic: clinic.id });
    if (provisionError) console.error("clinic_provision failed (run migration 005):", provisionError.message);

    // Branding extras never block sign-up: the clinic exists, the admin can fix these in Settings.
    let logoWarning: string | undefined;
    if (logoDataUrl) {
      try { const url = await saveLogo(admin, clinic.id, logoDataUrl); await admin.from("clinics").update({ logo_url: url }).eq("id", clinic.id); }
      catch (e: any) { logoWarning = e.message; }
    }
    if (domainClean) await addDomainToVercel(domainClean);
    return NextResponse.json({ success: true, clinicId: clinic.id, needsEmailConfirmation, slug: clinic.slug, logoWarning });
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
