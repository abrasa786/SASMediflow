import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Public branding for a clinic, by web address (?slug=) or by a verified custom domain (?host=). No private data. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const host = (req.nextUrl.searchParams.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]{0,253}$/i.test(slug + host) || (!slug && !host)) return NextResponse.json({ clinic: null });
  const { data, error } = await createAdminClient().rpc("public_clinic", { p_slug: slug || null, p_host: slug ? null : host });
  if (error) return NextResponse.json({ clinic: null });
  return NextResponse.json({ clinic: data ?? null }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
