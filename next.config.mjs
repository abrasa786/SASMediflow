/** @type {import('next').NextConfig} */
const nextConfig = {
  // /demo serves the static guided tour in public/demo/index.html
  async rewrites() {
    return [{ source: "/demo", destination: "/demo/index.html" }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "twjkqbmhujctxebhnwec.supabase.co" },
      { protocol: "https", hostname: "ui-avatars.com" },
    ],
  },
  // Type errors and lint errors fail the build, so broken code can never reach production.
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default nextConfig;
