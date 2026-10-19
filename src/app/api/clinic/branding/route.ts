import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { addDomainToVercel, checkColor, checkDomain, checkSlug, newDomainToken, saveLogo, verifyDomainDns } from "@/lib/server/branding";

export const dynamic = "force-dynamic";

const view = (c: any) => ({ slug: c.slug, logo_url: c.logo_url, primary_color: c.primary_color, tagline: c.tagline, website: c.website, custom_domain: c.custom_domain, domain_verified: c.domain_verified, domain_token: c.custom_domain && !c.domain_verified ? c.domain_token : null });
const COLS = "slug, logo_url, primary_color, tagline, website, custom_domain, domain_verified, domain_token";

/** Current branding + domain status. Any staff member (the sidebar uses it). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const { db } = await requireClinicMember(req, req.nextUrl.searchParams.get("clinicId"));
    const { data, error } = await db.from("clinics").select(COLS).eq("id", req.nextUrl.searchParams.get("clinicId")).maybeSingle();
    if (error) throw new HttpError(500, /does not exist/.test(error.message) ? "Branding is not installed yet. Run supabase/migrations/007_branding_and_domains.sql in the Supabase SQL editor." : error.message);
    return { branding: view(data ?? {}) };
  });
}

/** Admin: save branding, set or verify a custom domain. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const { data: cur, error: ce } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
    if (ce || !cur) throw new HttpError(500, ce?.message ?? "Clinic not found.");

    if (b.action === "save") {
      const patch: Record<string, unknown> = {};
      if ("tagline" in b) patch.tagline = b.tagline ? String(b.tagline).trim().slice(0, 120) : null;
      if ("website" in b) { const w = String(b.website ?? "").trim(); if (w && !/^https?:\/\/\S+\.\S+$/.test(w)) throw new HttpError(400, "Website must start with https://"); patch.website = w || null; }
      if ("primaryColor" in b) patch.primary_color = checkColor(b.primaryColor);
      if (b.slug && b.slug !== cur.slug) patch.slug = checkSlug(b.slug);
      if (b.removeLogo) patch.logo_url = null;
      if (b.logoDataUrl) patch.logo_url = await saveLogo(db, b.clinicId, b.logoDataUrl);
      if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to save.");
      const { error } = await db.from("clinics").update(patch).eq("id", b.clinicId);
      if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "That web address is already taken. Try another." : error.message);
    } else if (b.action === "set_domain") {
      const d = checkDomain(b.domain);
      const { data: taken } = await db.from("clinics").select("id").ilike("custom_domain", d).eq("domain_verified", true).neq("id", b.clinicId).maybeSingle();
      if (taken) throw new HttpError(409, "That domain is already connected to another clinic.");
      const { error } = await db.from("clinics").update({ custom_domain: d, domain_verified: false, domain_verified_at: null, domain_token: newDomainToken() }).eq("id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      const vercel = await addDomainToVercel(d);
      const { data } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
      return { branding: view(data), vercel };
    } else if (b.action === "verify_domain") {
      if (!cur.custom_domain || !cur.domain_token) throw new HttpError(400, "Add a domain first.");
      const r = await verifyDomainDns(cur.custom_domain, cur.domain_token);
      if (!r.owned) return { branding: view(cur), check: { ...r, message: r.found.length ? "A TXT record exists at _mediflow but its value does not match. Copy the value again." : "We could not find the TXT record yet. DNS changes can take a few minutes up to a few hours." } };
      const { data: taken } = await db.from("clinics").select("id").ilike("custom_domain", cur.custom_domain).eq("domain_verified", true).neq("id", b.clinicId).maybeSingle();
      if (taken) throw new HttpError(409, "That domain is already connected to another clinic.");
      const { error } = await db.from("clinics").update({ domain_verified: true, domain_verified_at: new Date().toISOString() }).eq("id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      const { data } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
      return { branding: view(data), check: { ...r, message: r.pointing ? "Verified. Your domain is live." : "Ownership verified. Now point the domain at us (step 2) so the site opens on it." } };
    } else if (b.action === "remove_domain") {
      const { error } = await db.from("clinics").update({ custom_domain: null, domain_verified: false, domain_token: null, domain_verified_at: null }).eq("id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
    } else throw new HttpError(400, "Unknown action.");

    const { data } = await db.from("clinics").select(COLS).eq("id", b.clinicId).maybeSingle();
    return { branding: view(data) };
  });
}
