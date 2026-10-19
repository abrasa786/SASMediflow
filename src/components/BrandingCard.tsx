"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import LogoPicker from "@/components/LogoPicker";
import { inputCls as inp, labelCls as lbl } from "@/components/ui";


export default function BrandingCard({ clinicId }: { clinicId: string }) {
  const [b, setB] = useState<any>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [logoChanged, setLogoChanged] = useState(false);
  const [f, setF] = useState({ tagline: "", website: "", primaryColor: "#2563eb", slug: "" });
  const [domain, setDomain] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<any>(null);

  const apply = useCallback((br: any) => {
    setB(br); setLogo(br.logo_url ?? null); setLogoChanged(false);
    setF({ tagline: br.tagline ?? "", website: br.website ?? "", primaryColor: br.primary_color ?? "#2563eb", slug: br.slug ?? "" });
    setDomain(br.custom_domain ?? "");
  }, []);
  useEffect(() => { authFetch(`/api/clinic/branding?clinicId=${clinicId}`).then((r) => apply(r.branding)).catch((e) => setErr(e.message)); }, [clinicId, apply]);

  async function call(body: any, ok: string) {
    setErr(""); setMsg(""); setBusy(true);
    try { const r = await authFetch("/api/clinic/branding", { body: { clinicId, ...body } }); apply(r.branding); setMsg(r.check?.message ?? ok); setHelp(r.vercel ?? null); return r; }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!b) return <section className="bg-white rounded-2xl border border-slate-100 p-6 mb-6"><p className="text-sm text-slate-400">{err || "Loading branding…"}</p></section>;
  const apex = b.custom_domain && b.custom_domain.split(".").length <= 2;

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6" aria-labelledby="brand-h">
      <h2 id="brand-h" className="font-semibold text-sm uppercase tracking-wide text-slate-500 mb-4">Branding &amp; domain</h2>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <LogoPicker value={logo} onChange={(v) => { setLogo(v); setLogoChanged(true); }} />
          <div><label className={lbl}>Tagline</label><input className={inp} maxLength={120} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></div>
          <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
            <div><label className={lbl}>Website</label><input className={inp} placeholder="https://" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></div>
            <div><label className={lbl}>Colour</label><input type="color" aria-label="Brand colour" className="h-10 w-14 rounded-lg border border-slate-200 p-1 bg-white" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} /></div>
          </div>
          <div><label className={lbl}>Web address</label>
            <div className="flex items-center rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-3 text-xs text-slate-400 whitespace-nowrap">{origin.replace(/^https?:\/\//, "")}/c/</span>
              <input className="flex-1 min-w-0 px-1.5 py-2.5 text-sm bg-transparent focus:outline-none" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} aria-label="Web address" /></div>
            {b.slug && <a className="text-xs text-sky-700 hover:underline" href={`/c/${b.slug}`} target="_blank" rel="noreferrer">Open your public page ↗</a>}</div>
          <button disabled={busy} onClick={() => call({ action: "save", tagline: f.tagline, website: f.website, primaryColor: f.primaryColor, slug: f.slug, ...(logoChanged ? (logo ? { logoDataUrl: logo } : { removeLogo: true }) : {}) }, "Saved.")}
            className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-60">Save branding</button>
        </div>

        <div>
          <label className={lbl}>Your own domain</label>
          <div className="flex gap-2">
            <input className={inp} placeholder="appointments.yourclinic.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
            <button disabled={busy || !domain.trim()} onClick={() => call({ action: "set_domain", domain }, "Domain saved. Add the DNS records below.")} className="px-3 rounded-xl border border-slate-300 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap">{b.custom_domain ? "Change" : "Add"}</button>
          </div>
          {b.custom_domain && (
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm space-y-3">
              <p className="font-medium text-slate-800">{b.custom_domain} <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${b.domain_verified ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{b.domain_verified ? "ownership verified" : "waiting for DNS"}</span></p>
              {!b.domain_verified && <div><p className="text-xs font-semibold text-slate-500 uppercase">1 · Prove you own it (TXT record)</p>
                <Rec k="Type" v="TXT" /><Rec k="Name" v={`_mediflow.${b.custom_domain}`} /><Rec k="Value" v={b.domain_token ?? ""} /></div>}
              <div><p className="text-xs font-semibold text-slate-500 uppercase">{b.domain_verified ? "Point it at us" : "2 · Point it at us"}</p>
                {apex ? <><Rec k="Type" v="A" /><Rec k="Name" v="@" /><Rec k="Value" v="76.76.21.21" /></> : <><Rec k="Type" v="CNAME" /><Rec k="Name" v={b.custom_domain.split(".")[0]} /><Rec k="Value" v="cname.vercel-dns.com" /></>}</div>
              <div className="flex gap-2">
                {!b.domain_verified && <button disabled={busy} onClick={() => call({ action: "verify_domain" }, "Verified.")} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60">Check now</button>}
                <button disabled={busy} onClick={() => call({ action: "remove_domain" }, "Domain removed.")} className="px-3 py-2 rounded-xl text-red-600 text-xs font-semibold hover:bg-red-50">Remove domain</button>
              </div>
              {help && help.configured === false && <p className="text-xs text-slate-500">Also add this domain in Vercel → your project → Settings → Domains so HTTPS is issued (or set VERCEL_API_TOKEN and VERCEL_PROJECT_ID to have us do it automatically).</p>}
              {help?.configured && help.ok && <p className="text-xs text-emerald-700">Added to the Vercel project. HTTPS is issued automatically once DNS points here.</p>}
              {help?.configured && help.ok === false && <p className="text-xs text-red-600">Vercel said: {help.error}. Add it manually under Vercel → Domains.</p>}
            </div>
          )}
        </div>
      </div>
      {err && <p className="mt-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
      {msg && <p className="mt-4 text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">{msg}</p>}
    </section>
  );
}

function Rec({ k, v }: { k: string; v: string }) {
  return <p className="flex gap-2 items-start text-xs mt-1"><span className="w-12 text-slate-400 shrink-0">{k}</span><code className="bg-white border border-slate-200 rounded px-1.5 py-0.5 break-all select-all">{v}</code></p>;
}
