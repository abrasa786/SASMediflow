import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mediflow Clinic",
  description: "Smart clinic management — appointments, billing, stock, AI, and WhatsApp",
  applicationName: "Mediflow",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Mediflow", statusBarStyle: "black" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/apple-touch-icon.png" },
  formatDetection: { telephone: false },     // stop iOS turning phone numbers into blue links that change the layout
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0f172a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
