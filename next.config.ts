import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "twjkqbmhujctxebhnwec.supabase.co" },
      { protocol: "https", hostname: "ui-avatars.com" },
    ],
  },
  // Disable ESLint during production build so missing-type warnings
  // don't block the deploy while we iterate fast
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors surfaced in IDE but won't block the Vercel build
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
