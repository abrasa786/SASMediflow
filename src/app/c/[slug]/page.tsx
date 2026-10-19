"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { applyBrand, applyIdentity } from "@/lib/theme";

interface PublicClinic { slug: string; name: string; tagline?: string; ai_name?: string; logo_url?: string; primary_color?: string; address?: string; city?: string; phone?: string; email?: string; website?: string; specialty?: string; doctors: { name: string; specialty?: string; experience_years?: number }[] }

/** Public page for a clinic. On a clinic's own domain the slug is "_host" and the clinic is found from the domain. */
export default function PublicClinicPage() {
  const { slug } = useParams<{ slug: string }>();
  const [c, setC] = useState<PublicClinic | null | undefined>(undefined);
  useEffect(() => {
    const url = slug === "_host" ? `/api/public/clinic?host=${encodeURIComponent(window.location.host)}` : `/api/public/clinic?slug=${encodeURIComponent(slug)}`;
    fetch(url).then((r) => r.json()).then((d) => { setC(d.clinic); if (d.clinic) { applyBrand(d.clinic.primary_color); applyIdentity(d.clinic.name, d.clinic.logo_url); } }).catch(() => setC(null));
  }, [slug]);

  if (c === undefined) return <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  if (c === null) return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div><p className="text-4xl mb-3">🏥</p><h1 className="text-xl font-bold text-slate-900">We couldn&apos;t find that clinic</h1><p className="text-sm text-slate-500 mt-1">Check the address, or <a className="text-sky-700 underline" href="/login">sign in</a>.</p></div>
    </div>
  );
  const color = c.primary_color || "#0ea5e9";
  const phone = (c.phone ?? "").replace(/\D/g, "");
  const wa = phone.length === 10 ? "91" + phone : phone;
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header style={{ background: `linear-gradient(135deg, ${color}, #1e1b4b)` }} className="text-white">
        <div className="max-w-4xl mx-auto px-5 py-12 flex flex-col sm:flex-row sm:items-center gap-5">
          {c.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={c.logo_url} alt="" className="w-20 h-20 rounded-2xl bg-white object-contain p-1.5 shrink-0" />
            : <div className="w-20 h-20 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center text-3xl font-bold shrink-0">{c.name.charAt(0)}</div>}
          <div className="min-w-0">
            <h1 className="text-3xl font-bold" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{c.name}</h1>
            {c.tagline && <p className="mt-1 text-white/85">{c.tagline}</p>}
            {c.specialty && <p className="mt-2 text-xs uppercase tracking-wide text-white/70">{c.specialty}{c.city ? ` · ${c.city}` : ""}</p>}
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-5 py-8 grid gap-6 md:grid-cols-[1fr_280px]">
        <section>
          <h2 className="font-semibold text-slate-900 mb-3">Our doctors</h2>
          {c.doctors.length === 0 ? <p className="text-sm text-slate-400">Doctors will be listed here soon.</p> :
            <ul className="grid sm:grid-cols-2 gap-3">{c.doctors.map((d) => (
              <li key={d.name} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="font-medium text-slate-900">{d.name}</p>
                <p className="text-sm text-slate-500">{d.specialty ?? "General"}{d.experience_years ? ` · ${d.experience_years} yrs experience` : ""}</p>
              </li>))}</ul>}
        </section>
        <aside className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm space-y-2">
            <h2 className="font-semibold text-slate-900">Book an appointment</h2>
            {phone ? <>
              <a href={`tel:+${wa}`} style={{ background: color }} className="block text-center text-white font-semibold rounded-xl py-2.5">Call {c.phone}</a>
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="block text-center border border-slate-300 font-semibold rounded-xl py-2.5 hover:bg-slate-50">Message on WhatsApp</a>
            </> : <p className="text-slate-500">Contact the clinic to book.</p>}
          </div>
          {(c.address || c.email || c.website) && <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm space-y-1.5">
            {c.address && <p>📍 {c.address}</p>}{c.email && <p>✉️ {c.email}</p>}
            {c.website && <p>🌐 <a className="text-sky-700 underline break-all" href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, "")}</a></p>}
          </div>}
          <a href={`/login${slug === "_host" ? "" : `?clinic=${c.slug}`}`} className="block text-center text-sm text-slate-500 hover:text-slate-800 underline">Staff sign in</a>
        </aside>
      </main>
    </div>
  );
}
