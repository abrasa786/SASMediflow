import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = createAdminClient() as any;
  const { data: t } = await db.from("treatment_info").select("*").eq("id", id).eq("is_published", true).maybeSingle();
  if (!t) return null;
  const { data: c } = await db.from("clinics").select("slug, name, brand_name, logo_url, primary_color, phone, address, city, settings, is_active").eq("id", t.clinic_id).maybeSingle();
  if (!c || c.is_active === false) return null;
  return { t, c };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const r = await load(params.id);
  if (!r) return { title: "Treatment", robots: { index: false } };
  return { title: `${r.t.name} - ${r.c.brand_name ?? r.c.name}`, description: r.t.summary ?? undefined, robots: { index: false } };
}

function Block({ title, children, color }: { title: string; children: React.ReactNode; color: string }) {
  return (
    <section style={{ background: "#fff", borderRadius: 16, padding: 20, border: "1px solid #e2e8f0" }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color, margin: "0 0 6px" }}>{title}</h2>
      <div style={{ fontSize: 15, lineHeight: 1.55, color: "#334155" }}>{children}</div>
    </section>
  );
}

/** What the patient sees when the clinic sends them the link: a short, plain explanation of one treatment. */
export default async function TreatmentExplainer({ params }: { params: { id: string } }) {
  const r = await load(params.id);
  if (!r) notFound();
  const { t, c } = r;
  const color = /^#[0-9a-f]{6}$/i.test(c.primary_color ?? "") ? c.primary_color : "#0ea5e9";
  const name = c.brand_name ?? c.name;
  const from = t.price_from != null ? Number(t.price_from) : null, to = t.price_to != null ? Number(t.price_to) : null;
  const price = from != null && to != null && to !== from ? `${inr(from)} to ${inr(to)}` : from != null ? `From ${inr(from)}` : to != null ? `Up to ${inr(to)}` : null;
  const tel = (c.phone ?? "").replace(/[^\d+]/g, "");

  return (
    <main style={{ minHeight: "100vh", background: "#f1f5f9", padding: "16px 16px 96px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: 12 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {c.logo_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.logo_url} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "contain", background: "#fff" }} />}
          <div style={{ fontWeight: 700, color: "#0f172a" }}>{name}</div>
        </header>

        <div style={{ background: color, color: "#fff", borderRadius: 20, padding: 24 }}>
          {t.category && <div style={{ fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: 1 }}>{t.category}</div>}
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 8px", lineHeight: 1.15 }}>{t.name}</h1>
          {t.summary && <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{t.summary}</p>}
        </div>

        {t.why_needed && <Block title="Why your dentist advises it" color={color}>{t.why_needed}</Block>}
        {Array.isArray(t.steps) && t.steps.length > 0 && (
          <Block title="What happens" color={color}>
            <ol style={{ margin: 0, paddingLeft: 20 }}>{t.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
          </Block>
        )}
        {(t.duration_text || t.pain_text) && (
          <Block title="Time and comfort" color={color}>
            {t.duration_text && <p style={{ margin: "0 0 6px" }}>{t.duration_text}</p>}
            {t.pain_text && <p style={{ margin: 0 }}>{t.pain_text}</p>}
          </Block>
        )}
        {t.delay_risk && <Block title="If it is put off" color={color}>{t.delay_risk}</Block>}
        {t.aftercare && <Block title="Aftercare" color={color}>{t.aftercare}</Block>}
        {(price || t.emi_note) && (
          <Block title="Cost" color={color}>
            {price && <p style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{price}</p>}
            {t.emi_note && <p style={{ margin: 0 }}>{t.emi_note}</p>}
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>The final cost depends on your examination. Your dentist will confirm it.</p>
          </Block>
        )}
        {Array.isArray(t.faqs) && t.faqs.length > 0 && (
          <Block title="Common questions" color={color}>
            {t.faqs.map((f: { q: string; a: string }, i: number) => (
              <div key={i} style={{ marginBottom: 8 }}><b>{f.q}</b><div>{f.a}</div></div>
            ))}
          </Block>
        )}
        <p style={{ fontSize: 12, color: "#64748b", textAlign: "center" }}>This is general information, not a diagnosis. Please speak to your dentist about your own case.</p>
      </div>

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff", borderTop: "1px solid #e2e8f0", padding: 12, display: "flex", gap: 10, justifyContent: "center" }}>
        {c.settings?.online_booking?.enabled && <a href={`/c/${c.slug}/book`} style={{ background: color, color: "#fff", padding: "12px 20px", borderRadius: 12, fontWeight: 700, textDecoration: "none" }}>Book a visit</a>}
        {tel && <a href={`tel:${tel}`} style={{ border: `1px solid ${color}`, color, padding: "12px 20px", borderRadius: 12, fontWeight: 700, textDecoration: "none" }}>Call the clinic</a>}
      </div>
    </main>
  );
}
