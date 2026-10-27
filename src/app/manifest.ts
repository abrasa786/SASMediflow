import type { MetadataRoute } from "next";

/** Lets "Add to Home Screen" install Mediflow like an app: its own icon, no browser bars. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mediflow Clinic", short_name: "Mediflow", description: "Appointments, billing, stock and WhatsApp for your clinic",
    start_url: "/dashboard", scope: "/", display: "standalone", orientation: "portrait",
    background_color: "#f8fafc", theme_color: "#0f172a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
