import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { checkInvoiceImage } from "@/lib/server/invoice-pdf";
import { loadInvoiceData } from "@/lib/server/invoice-data";
import { addDomainToVercel, checkAiName, checkColor, checkDomain, checkSlug, newDomainToken, saveLogo, verifyDomainDns } from "@/lib/server/branding";

export const dynamic = "force-dynamic";

const view = (c: any) => ({ slug: c.slug, logo_url: c.logo_url, primary_color: c.primary_color, tagline: c.tagline, ai_name: c.ai_name, website: c.website, custom_domain: c.custom_domain, domain_verified: c.domain_verified, domain_token: c.custom_domain && !c.domain_verified ? c.domain_token : null });
const COLS = "slug, logo_url, primary_color, tagline, ai_name, website, custom_domain, domain_verified, domain_token";


/** The branding plus the stamp. The stamp is read on its own, so a database without the stamp column still works. */
async function full(db: any, clinicId: string, c: any) {
  const r = await db.from("clinics").select("stamp_url").eq("id", clinicId).maybeSingle();
  const g = await db.from("clinics").select("signature_url").eq("id", clinicId).maybeSingle();   // separate, so a database without the signature column still works
  return { ...view(c ?? {}), stamp_url: r.data?.stamp_url ?? null, signature_url: g.data?.signature_url ?? null };
}

/** Current branding + domain status. Any staff member (the sidebar uses it). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { db } = await requireClinicMember(req, req.nextUrl.searchParams.get("clinicId"));
    const { data, error } = await db.from("clinics").select(COLS).eq("id", req.nextUrl.searchParams.get("clinicId")).maybeSingle();
    if (error) throw new HttpError(500, /does not exist/.test(error.message) ? "Branding is not installed yet. Run supabase/migrations/007_branding_and_domains.sql in the Supabase SQL editor." : error.message);
    const stamp = await db.from("clinics").select("stamp_url").eq("id", req.nextUrl.searchParams.get("clinicId")).maybeSingle();   // separate, so a database without the stamp column still loads
    const sig = await db.from("clinics").select("signature_url").eq("id", req.nextUrl.searchParams.get("clinicId")).maybeSingle();
    return { branding: { ...view(data ?? {}), stamp_url: stamp.data?.stamp_url ?? null, signature_url: sig.data?.signature_url ?? null } };
  });
}

/** Admin: save branding, set or verify a custom domain. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const { data: cur, error: ce } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
    if (ce || !cur) throw new HttpError(500, ce?.message ?? "Clinic not found.");

    if (b.action === "check_images") {
      const st = await db.from("clinics").select("stamp_url").eq("id", b.clinicId).maybeSingle();
      const sg = await db.from("clinics").select("signature_url").eq("id", b.clinicId).maybeSingle();
      const [stamp, signature] = await Promise.all([checkInvoiceImage(st.data?.stamp_url), checkInvoiceImage(sg.data?.signature_url)]);
      // what the invoice itself would read: the newest invoice of this clinic, loaded the way the PDF loads it
      let latest: { number: string; stamp: boolean; signature: boolean } | null = null;
      try {
        const { data: inv } = await db.from("invoices").select("id").eq("clinic_id", b.clinicId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        const d = inv ? await loadInvoiceData(db, inv.id, b.clinicId) : null;
        if (d) latest = { number: d.invoice.number, stamp: !!d.clinic.stamp_url, signature: !!d.clinic.signature_url };
      } catch { /* the check still reports the images */ }
      return { images: { stamp, signature, latest, build: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7), appUrl: process.env.NEXT_PUBLIC_APP_URL || null, thisHost: req.nextUrl.host } };
    }

    if (b.action === "save") {
      const patch: Record<string, unknown> = {};
      if ("tagline" in b) patch.tagline = b.tagline ? String(b.tagline).trim().slice(0, 120) : null;
      if ("aiName" in b) patch.ai_name = checkAiName(b.aiName);
      if ("website" in b) { const w = String(b.website ?? "").trim(); if (w && !/^https?:\/\/\S+\.\S+$/.test(w)) throw new HttpError(400, "Website must start with https://"); patch.website = w || null; }
      if ("primaryColor" in b) patch.primary_color = checkColor(b.primaryColor);
      if (b.slug && b.slug !== cur.slug) patch.slug = checkSlug(b.slug);
      if (b.removeLogo) patch.logo_url = null;
      if (b.logoDataUrl) patch.logo_url = await saveLogo(db, b.clinicId, b.logoDataUrl);
      if (b.removeStamp) patch.stamp_url = null;
      if (b.stampDataUrl) patch.stamp_url = await saveLogo(db, b.clinicId, b.stampDataUrl, "stamp");
      if (b.removeSignature) patch.signature_url = null;
      if (b.signatureDataUrl) patch.signature_url = await saveLogo(db, b.clinicId, b.signatureDataUrl, "signature");
      if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to save.");
      const { error } = await db.from("clinics").update(patch).eq("id", b.clinicId);
      if (error && /signature_url/.test(error.message)) throw new HttpError(500, "The signature needs a database update. Run supabase/RUN_ME_ALL_MIGRATIONS.sql in Supabase, then try again.");
      if (error && /stamp_url/.test(error.message)) throw new HttpError(500, "The stamp needs a database update. Run supabase/RUN_ME_ALL_MIGRATIONS.sql in Supabase, then try again.");
      if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "That web address is already taken. Try another." : error.message);
    } else if (b.action === "set_domain") {
      const d = checkDomain(b.domain);
      const { data: taken } = await db.from("clinics").select("id").ilike("custom_domain", d).eq("domain_verified", true).neq("id", b.clinicId).maybeSingle();
      if (taken) throw new HttpError(409, "That domain is already connected to another clinic.");
      const { error } = await db.from("clinics").update({ custom_domain: d, domain_verified: false, domain_verified_at: null, domain_token: newDomainToken() }).eq("id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      const vercel = await addDomainToVercel(d);
      const { data } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
      return { branding: await full(db, b.clinicId, data), vercel };
    } else if (b.action === "verify_domain") {
      if (!cur.custom_domain || !cur.domain_token) throw new HttpError(400, "Add a domain first.");
      const r = await verifyDomainDns(cur.custom_domain, cur.domain_token);
      if (!r.owned) return { branding: await full(db, b.clinicId, cur), check: { ...r, message: r.found.length ? "A TXT record exists at _mediflow but its value does not match. Copy the value again." : "We could not find the TXT record yet. DNS changes can take a few minutes up to a few hours." } };
      const { data: taken } = await db.from("clinics").select("id").ilike("custom_domain", cur.custom_domain).eq("domain_verified", true).neq("id", b.clinicId).maybeSingle();
      if (taken) throw new HttpError(409, "That domain is already connected to another clinic.");
      const { error } = await db.from("clinics").update({ domain_verified: true, domain_verified_at: new Date().toISOString() }).eq("id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      const { data } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
      return { branding: await full(db, b.clinicId, data), check: { ...r, message: r.pointing ? "Verified. Your domain is live." : "Ownership verified. Now point the domain at us (step 2) so the site opens on it." } };
    } else if (b.action === "remove_domain") {
      const { error } = await db.from("clinics").update({ custom_domain: null, domain_verified: false, domain_token: null, domain_verified_at: null }).eq("id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
    } else throw new HttpError(400, "Unknown action.");

    const { data } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
    return { branding: await full(db, b.clinicId, data) };
  });
}
