"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { supabase as sb } from "@/lib/supabase";
import { toast } from "@/lib/toast";

const supabase = sb as any;
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";
const THEMES: Record<string, { name: string; a: string; b: string; text: string; chip: string; chipText: string }> = {
  ocean:  { name: "Ocean",  a: "#0369a1", b: "#38bdf8", text: "#ffffff", chip: "#ffffff", chipText: "#0369a1" },
  mint:   { name: "Mint",   a: "#047857", b: "#6ee7b7", text: "#ffffff", chip: "#ffffff", chipText: "#047857" },
  sunset: { name: "Sunset", a: "#be123c", b: "#fb923c", text: "#ffffff", chip: "#fff7ed", chipText: "#be123c" },
  night:  { name: "Night",  a: "#0f172a", b: "#334155", text: "#ffffff", chip: "#fbbf24", chipText: "#0f172a" },
  clean:  { name: "Clean",  a: "#f8fafc", b: "#e2e8f0", text: "#0f172a", chip: "#0369a1", chipText: "#ffffff" },
};
const SIZES = { square: { w: 1080, h: 1080, label: "Square (Instagram, Facebook)" }, story: { w: 1080, h: 1920, label: "Story / Status (tall)" } };

/** Break text into lines that fit: about `max` characters per line. */
function wrap(text: string, max: number, limit = 6): string[] {
  const out: string[] = []; let cur = "";
  for (const w of text.replace(/\s+/g, " ").trim().split(" ")) {
    if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, limit);
}
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

/** Make a poster for one treatment: pick a look, edit the words, download it as a picture to post or send. */
export default function PosterPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [clinic, setClinic] = useState<any>({});
  const [f, setF] = useState({ headline: "", body: "", offer: "", price: "", cta: "", theme: "ocean", size: "square" as keyof typeof SIZES });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const cid = getActiveClinicId(); if (!cid) { router.push("/login"); return; }
    (async () => {
      const [t, c] = await Promise.all([
        supabase.from("treatment_info").select("name, summary, why_needed, price_from, price_to").eq("id", params.id).eq("clinic_id", cid).maybeSingle(),
        supabase.from("clinics").select("name, brand_name, phone, address, slug").eq("id", cid).maybeSingle(),
      ]);
      if (!t.data) { setState("missing"); return; }
      const cl = c.data ?? {}; setClinic(cl);
      const from = Number(t.data.price_from), to = Number(t.data.price_to);
      setF((p) => ({ ...p, headline: t.data.name, body: t.data.summary || t.data.why_needed || "", offer: "",
        price: from > 0 ? `From ₹${from.toLocaleString("en-IN")}${to > from ? ` to ₹${to.toLocaleString("en-IN")}` : ""}` : "",
        cta: cl.phone ? `Book now · ${cl.phone}` : "Book your visit today" }));
      setState("ready");
    })();
  }, [params.id, router]);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const th = THEMES[f.theme], { w, h } = SIZES[f.size];
  const brand = clinic.brand_name || clinic.name || "";
  const tall = f.size === "story";

  const svg = useMemo(() => {
    const hl = wrap(f.headline, 16, 3), bd = wrap(f.body, tall ? 34 : 40, tall ? 8 : 5), of = wrap(f.offer, 22, 2);
    const pad = 90; let y = tall ? 380 : 230;
    const parts: string[] = [];
    hl.forEach((l) => { parts.push(`<text x="${pad}" y="${y}" font-size="104" font-weight="800" fill="${th.text}">${esc(l)}</text>`); y += 122; });
    y += 20;
    bd.forEach((l) => { parts.push(`<text x="${pad}" y="${y}" font-size="46" fill="${th.text}" opacity="0.92">${esc(l)}</text>`); y += 64; });
    y += 40;
    if (of.length) {
      const hh = of.length * 76 + 40;
      parts.push(`<rect x="${pad}" y="${y}" width="${w - pad * 2}" height="${hh}" rx="28" fill="${th.chip}"/>`);
      of.forEach((l, i) => parts.push(`<text x="${pad + 40}" y="${y + 74 + i * 76}" font-size="62" font-weight="800" fill="${th.chipText}">${esc(l)}</text>`));
      y += hh + 30;
    }
    if (f.price) parts.push(`<text x="${pad}" y="${y + 50}" font-size="58" font-weight="700" fill="${th.text}">${esc(f.price)}</text>`);
    const fy = h - 250;
    parts.push(`<rect x="0" y="${fy}" width="${w}" height="250" fill="#000000" opacity="${f.theme === "clean" ? 0.06 : 0.22}"/>`);
    parts.push(`<text x="${pad}" y="${fy + 90}" font-size="56" font-weight="800" fill="${th.text}">${esc(brand.slice(0, 32))}</text>`);
    parts.push(`<text x="${pad}" y="${fy + 150}" font-size="40" font-weight="600" fill="${th.text}">${esc(f.cta.slice(0, 44))}</text>`);
    if (clinic.address) parts.push(`<text x="${pad}" y="${fy + 205}" font-size="30" fill="${th.text}" opacity="0.85">${esc(String(clinic.address).slice(0, 70))}</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${th.a}"/><stop offset="1" stop-color="${th.b}"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w - 80}" cy="120" r="260" fill="#ffffff" opacity="0.10"/><circle cx="${w - 260}" cy="${h - 420}" r="180" fill="#ffffff" opacity="0.08"/>
      ${parts.join("")}</svg>`;
  }, [f, th, w, h, tall, brand, clinic.address]);

  function download() {
    setBusy(true);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d")!.drawImage(img, 0, 0);
      c.toBlob((b) => {
        if (b) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${f.headline.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "poster"}-${f.size}.png`; a.click(); toast("Poster downloaded"); }
        setBusy(false);
      }, "image/png");
    };
    img.onerror = () => { setBusy(false); toast("Could not make the picture. Try another browser.", false); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <Link href={`/treatments/library/${params.id}`} className="text-sm text-sky-700">← Back to the treatment</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Poster</h1>
        {state === "loading" && <p className="text-sm text-slate-400 mt-4">Loading…</p>}
        {state === "missing" && <p className="text-sm text-red-700 mt-4">Treatment not found.</p>}
        {state === "ready" && (
          <div className="mt-4 grid lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] gap-6">
            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 mx-auto w-full max-w-md lg:max-w-none">
              <div dangerouslySetInnerHTML={{ __html: svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="auto" style="display:block"') }} />
            </div>
            <div className="space-y-3">
              <div><label htmlFor="po-h" className="text-xs font-medium text-slate-600 block mb-1">Headline</label><input id="po-h" value={f.headline} onChange={(e) => set("headline", e.target.value)} className={inp} /></div>
              <div><label htmlFor="po-b" className="text-xs font-medium text-slate-600 block mb-1">Short description</label><textarea id="po-b" rows={3} value={f.body} onChange={(e) => set("body", e.target.value)} className={inp} /></div>
              <div><label htmlFor="po-o" className="text-xs font-medium text-slate-600 block mb-1">Offer (optional)</label><input id="po-o" value={f.offer} onChange={(e) => set("offer", e.target.value)} placeholder="e.g. 20% off this month" className={inp} /></div>
              <div><label htmlFor="po-p" className="text-xs font-medium text-slate-600 block mb-1">Price line (optional)</label><input id="po-p" value={f.price} onChange={(e) => set("price", e.target.value)} className={inp} /></div>
              <div><label htmlFor="po-c" className="text-xs font-medium text-slate-600 block mb-1">Call to action</label><input id="po-c" value={f.cta} onChange={(e) => set("cta", e.target.value)} className={inp} /></div>
              <div><p className="text-xs font-medium text-slate-600 mb-1">Look</p>
                <div className="flex flex-wrap gap-2">{Object.entries(THEMES).map(([k, t]) => (
                  <button type="button" key={k} aria-pressed={f.theme === k} onClick={() => set("theme", k)} className={`px-3 py-2 rounded-xl border text-sm font-medium ${f.theme === k ? "border-sky-600 ring-2 ring-sky-200" : "border-slate-200"}`}>
                    <span className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle" style={{ background: `linear-gradient(135deg, ${t.a}, ${t.b})` }} />{t.name}</button>))}</div></div>
              <div><label htmlFor="po-s" className="text-xs font-medium text-slate-600 block mb-1">Size</label>
                <select id="po-s" value={f.size} onChange={(e) => set("size", e.target.value)} className={inp}>{Object.entries(SIZES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}</select></div>
              <button type="button" disabled={busy} onClick={download} className="w-full px-5 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Preparing…" : "Download poster (PNG)"}</button>
              <p className="text-xs text-slate-500">Post it on Instagram, Facebook or WhatsApp status, or send it to patients who agreed to offers.</p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
