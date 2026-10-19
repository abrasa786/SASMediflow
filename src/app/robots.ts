import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: ["/c/", "/book"], disallow: ["/api/", "/dashboard", "/builder", "/apps", "/settings", "/patients", "/billing"] }],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {}),
  };
}
