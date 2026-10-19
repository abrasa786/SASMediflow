import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Public branding for a clinic, by web address (?slug=) or by a verified custom domain (?host=). No private data. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const host = (req.nextUrl.searchParams.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]{0,253}$/i.test(slug + host) || (!slug && !host)) return NextResponse.json({ clinic: null });
  const db = createAdminClient();
  // On a clinic's own domain, "www.clinic.com" and "clinic.com" are the same site; also "<slug>.<platform domain>".
  const root = (process.env.ROOT_DOMAIN ?? "").toLowerCase();
  const bare = host.replace(/^www\./, "");
  let data: any = null, error: any = null;
  if (slug) ({ data, error } = await db.rpc("public_clinic", { p_slug: slug, p_host: null }));
  else {
    for (const h of Array.from(new Set([host, bare, "www." + bare]))) { ({ data, error } = await db.rpc("public_clinic", { p_slug: null, p_host: h })); if (data) break; }
    if (!data && root && bare.endsWith("." + root)) ({ data, error } = await db.rpc("public_clinic", { p_slug: bare.slice(0, -root.length - 1), p_host: null }));
  }
  if (error) return NextResponse.json({ clinic: null });
  return NextResponse.json({ clinic: data ?? null }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
