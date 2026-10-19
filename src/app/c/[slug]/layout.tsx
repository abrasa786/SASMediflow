import type { Metadata } from "next";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase";
import { findClinic, onlineSettings } from "@/lib/booking/online";

/**
 * What Google sees for a clinic page: a proper title and description, plus structured data (schema.org) that says
 * "this is a clinic, here is its address and phone, and you can book online here" - that is what lets Google show
 * a Book button and rich details in search results.
 */
async function load(slug: string) {
  try {
    const host = headers().get("host") ?? "";
    return { c: await findClinic(createAdminClient(), slug === "_host" ? { host } : { slug }), host };
  } catch { return null; }
}
const origin = (host: string) => (host && !host.startsWith("localhost") ? `https://${host}` : process.env.NEXT_PUBLIC_APP_URL ?? "");

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await load(params.slug);
  if (!r) return { title: "Clinic", robots: { index: false } };
  const { c } = r, name = c.brand_name ?? c.name;
  const where = [c.city].filter(Boolean).join(", ");
  return {
    title: `${name}${c.specialty ? ` - ${c.specialty}` : ""}${where ? ` in ${where}` : ""} | Book an appointment online`,
    description: c.tagline || `Book an appointment at ${name}${where ? `, ${where}` : ""}. See doctors and free times, and confirm online.`,
    openGraph: { title: name, description: c.tagline ?? undefined, type: "website", images: c.logo_url ? [c.logo_url] : undefined },
  };
}

export default async function ClinicLayout({ children, params }: { children: React.ReactNode; params: { slug: string } }) {
  const r = await load(params.slug);
  let ld: any = null;
  if (r) {
    const { c, host } = r, base = origin(host), s = onlineSettings(c.settings);
    const path = params.slug === "_host" ? "" : `/c/${c.slug}`;
    const type = /dent/i.test(c.specialty ?? "") ? "Dentist" : "MedicalClinic";
    ld = {
      "@context": "https://schema.org", "@type": type, name: c.brand_name ?? c.name, url: `${base}${path || "/"}`,
      ...(c.logo_url ? { image: c.logo_url, logo: c.logo_url } : {}), ...(c.phone ? { telephone: c.phone } : {}), ...(c.email ? { email: c.email } : {}),
      ...(c.address || c.city ? { address: { "@type": "PostalAddress", streetAddress: c.address ?? undefined, addressLocality: c.city ?? undefined, addressCountry: "IN" } } : {}),
      ...(c.specialty ? { medicalSpecialty: c.specialty } : {}),
      ...(s.enabled ? { potentialAction: { "@type": "ReserveAction", name: "Book an appointment", target: { "@type": "EntryPoint", urlTemplate: `${base}${path}/book`, inLanguage: "en", actionPlatform: ["http://schema.org/DesktopWebPlatform", "http://schema.org/MobileWebPlatform"] }, result: { "@type": "Reservation", name: "Appointment" } } } : {}),
    };
  }
  return (<>
    {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />}
    {children}
  </>);
}
