import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mediflow Clinic",
  description: "Smart clinic management — appointments, billing, stock, AI, and WhatsApp",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
