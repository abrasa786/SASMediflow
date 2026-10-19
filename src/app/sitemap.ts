import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Every clinic's public page and booking page, so Google finds them. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  if (!base) return [];
  try {
    const { data } = await createAdminClient().from("clinics").select("slug, settings").neq("is_active", false).not("slug", "is", null).limit(5000);
    return (data ?? []).flatMap((c: any) => [
      { url: `${base}/c/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.8 },
      ...(c.settings?.online_booking?.enabled ? [{ url: `${base}/c/${c.slug}/book`, changeFrequency: "daily" as const, priority: 0.9 }] : []),
    ]);
  } catch { return []; }
}
