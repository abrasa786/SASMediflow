import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** For uptime monitors and the go-live checklist. Reports what is configured, never the values. */
export async function GET() {
  const env = {
    supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL, supabase_anon_key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY, app_url: !!process.env.NEXT_PUBLIC_APP_URL,
    gemini_optional: !!process.env.GEMINI_API_KEY, whatsapp_optional: !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN),
    vercel_domains_optional: !!(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID),
  };
  const migrations: Record<string, boolean | null> = { "003_builder": null, "004_appointments": null, "005_tenant_safety": null, "006_purchasing_attendance_leave": null, "007_branding_domains": null, "008_builder_access_reports": null };
  let database = false;
  if (env.supabase_url && env.service_role_key) {
    const db = createAdminClient();
    const probe = async (k: string, q: PromiseLike<{ error: any }>) => { const { error } = await q; migrations[k] = !error; if (!error) database = true; };
    await Promise.all([
      probe("003_builder", db.from("builder_objects").select("id", { head: true, count: "exact" }).limit(1)),
      probe("004_appointments", db.from("doctor_schedules").select("id", { head: true, count: "exact" }).limit(1)),
      probe("005_tenant_safety", db.from("treatment_templates").select("id", { head: true, count: "exact" }).limit(1)),
      probe("006_purchasing_attendance_leave", db.from("purchase_orders").select("id", { head: true, count: "exact" }).limit(1)),
      probe("007_branding_domains", db.from("clinics").select("slug", { head: true, count: "exact" }).limit(1)),
      probe("008_builder_access_reports", db.from("permission_sets").select("id", { head: true, count: "exact" }).limit(1)),
    ]);
  }
  const ok = env.supabase_url && env.supabase_anon_key && env.service_role_key && database;
  return NextResponse.json({ ok, database, env, migrations }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
