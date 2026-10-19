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
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
