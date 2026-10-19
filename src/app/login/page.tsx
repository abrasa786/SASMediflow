"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmail, setActiveClinicId, getSession, sendPasswordReset } from "@/lib/auth";
import { getMyClinics } from "@/lib/clinic";
import type { Clinic } from "@/types";

const POINTS = [
  { icon: "📅", t: "Appointments that never clash", d: "Doctor schedules, breaks and leave are checked for every slot." },
  { icon: "💬", t: "WhatsApp built in", d: "Confirmations, reminders and receipts go out automatically." },
  { icon: "🦷", t: "Made for your specialty", d: "Start with a ready-made pack, then shape it with the AI Builder." },
  { icon: "🔒", t: "Your clinic's data stays yours", d: "Every clinic is fully separated. Nobody else can see your records." },
];

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"login" | "pick" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [justConfirmed, setJustConfirmed] = useState(false);
  const [brand, setBrand] = useState<{ name: string; logo_url?: string | null; primary_color?: string | null; tagline?: string | null } | null>(null);

  useEffect(() => {
    // Branded sign-in: a clinic's own domain, or ?clinic=<web address>
    const q = new URLSearchParams(window.location.search);
    const slug = q.get("clinic");
    const url = slug ? `/api/public/clinic?slug=${encodeURIComponent(slug)}` : `/api/public/clinic?host=${encodeURIComponent(window.location.host)}`;
    fetch(url).then((r) => r.json()).then((d) => d.clinic && setBrand(d.clinic)).catch(() => null);
    if (typeof window !== "undefined" && q.get("confirmed")) setJustConfirmed(true);
    // already signed in? go straight to the app
    (async () => {
      const s = await getSession();
      if (!s) return;
      try {
        const mine = await getMyClinics();
        if (mine.length === 1) { setActiveClinicId(mine[0].id); router.replace("/dashboard"); }
        else if (mine.length > 1) { setClinics(mine); setStep("pick"); }
      } catch { /* stay on the form */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resendConfirmation() {
    setInfo("");
    try {
      const r = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json();
      setInfo(r.ok ? d.message : d.error || "Could not resend.");
    } catch { setInfo("Could not resend. Please try again."); }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(""); setInfo("");
    const { error: authErr } = await signInWithEmail(email.trim(), password);
    if (authErr) {
      const notConfirmed = /not confirmed/i.test(authErr.message);
      setUnconfirmed(notConfirmed);
      setError(notConfirmed ? "Your email isn't confirmed yet. Click the link we emailed you, or resend it below." : authErr.message);
      setLoading(false);
      return;
    }
    setUnconfirmed(false);
    try {
      const mine = await getMyClinics();
      if (mine.length === 0) { setError("No clinic is linked to this account. Ask your clinic admin to add you."); setLoading(false); return; }
      if (mine.length === 1) { setActiveClinicId(mine[0].id); router.push("/dashboard"); return; }
      setClinics(mine); setStep("pick");
    } catch { setError("Could not load your clinic. Please try again."); }
    setLoading(false);
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(""); setInfo("");
    const { error: err } = await sendPasswordReset(email.trim());
    setLoading(false);
    if (err) setError(err.message); else setInfo("If that email has an account, a reset link is on its way. Check your spam folder too.");
  }

  const input = "w-full px-4 py-3 rounded-lg border border-slate-300 bg-white text-slate-900 text-[15px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500";

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-white">
      {/* Left: why Mediflow */}
      <aside className={`hidden lg:flex flex-col justify-between text-white p-12 xl:p-16 ${brand?.primary_color ? "" : "bg-gradient-to-br from-sky-600 via-indigo-600 to-violet-700"}`}
        style={brand?.primary_color ? { background: `linear-gradient(135deg, ${brand.primary_color}, #1e1b4b)` } : undefined}>
        <a href="/" className="inline-flex items-center gap-2.5">
          {brand?.logo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={brand.logo_url} alt="" className="w-12 h-12 rounded-xl bg-white object-contain p-1" />
            : <span className="w-10 h-10 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center font-bold text-xl">{brand ? brand.name.charAt(0) : "M"}</span>}
          <span className="text-2xl font-bold" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{brand?.name ?? "Mediflow"}</span>
        </a>
        <div className="max-w-md">
          <h2 className="text-3xl xl:text-4xl font-bold leading-tight" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{brand ? (brand.tagline || `Welcome to ${brand.name}`) : "Run your whole clinic from one place."}</h2>
          <ul className="mt-8 space-y-5">
            {POINTS.map((p) => (
              <li key={p.t} className="flex gap-3.5">
                <span className="text-2xl leading-none mt-0.5">{p.icon}</span>
                <span><b className="block">{p.t}</b><span className="text-sky-100 text-sm">{p.d}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <a href="/demo" className="text-sm text-sky-100 hover:text-white underline underline-offset-4">▶ Take the interactive trail first</a>
      </aside>

      {/* Right: the form */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <a href="/" className="lg:hidden inline-flex items-center gap-2 mb-8">
            {brand?.logo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={brand.logo_url} alt="" className="w-9 h-9 rounded-xl object-contain" />
              : <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center font-bold">M</span>}
            <span className="text-xl font-bold text-slate-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{brand?.name ?? "Mediflow"}</span>
          </a>

          {step === "login" && (
            <>
              <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Sign in to your clinic</h1>
              <p className="text-slate-500 mt-1.5 text-sm">Admins, doctors, nurses and receptionists all sign in here. What you see depends on your role.</p>

              {justConfirmed && <div className="mt-5 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">✓ Email confirmed. You can sign in now.</div>}

              <form onSubmit={handleLogin} className="mt-6 space-y-4" noValidate={false}>
                <div>
                  <label htmlFor="em" className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <input id="em" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} placeholder="you@yourclinic.com" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="pw" className="block text-sm font-medium text-slate-700">Password</label>
                    <button type="button" onClick={() => { setStep("forgot"); setError(""); setInfo(""); }} className="text-sm text-sky-700 hover:underline">Forgot password?</button>
                  </div>
                  <div className="relative">
                    <input id="pw" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={input + " pr-16"} placeholder="Your password" />
                    <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 hover:text-slate-800" aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
                  </div>
                </div>
                {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-lg">{error}</div>}
                {unconfirmed && <button type="button" onClick={resendConfirmation} className="text-sm text-sky-700 hover:underline">Resend confirmation email</button>}
                {info && <div className="text-sm text-slate-600">{info}</div>}
                <button type="submit" disabled={loading} className="w-full py-3 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-semibold text-[15px] transition-colors">
                  {loading ? "Signing in…" : "Sign in"}
                </button>
              </form>

              <div className="mt-8 pt-6 border-t border-slate-200 text-sm text-slate-600">
                New to Mediflow? <a href="/signup" className="text-sky-700 font-semibold hover:underline">Set up your clinic in a minute →</a>
              </div>
            </>
          )}

          {step === "forgot" && (
            <>
              <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Reset your password</h1>
              <p className="text-slate-500 mt-1.5 text-sm">Enter your work email and we&apos;ll send you a link to choose a new password.</p>
              <form onSubmit={handleForgot} className="mt-6 space-y-4">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} placeholder="you@yourclinic.com" aria-label="Email" />
                {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 px-3.5 py-2.5 rounded-lg">{error}</div>}
                {info && <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3.5 py-2.5">{info}</div>}
                <button type="submit" disabled={loading} className="w-full py-3 rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-semibold">{loading ? "Sending…" : "Send reset link"}</button>
                <button type="button" onClick={() => { setStep("login"); setError(""); setInfo(""); }} className="w-full text-sm text-slate-600 hover:underline">← Back to sign in</button>
              </form>
            </>
          )}

          {step === "pick" && (
            <>
              <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Choose a clinic</h1>
              <p className="text-slate-500 mt-1.5 text-sm">Your account belongs to more than one clinic. Each one is kept completely separate.</p>
              <div className="mt-6 space-y-2.5">
                {clinics.map((c) => (
                  <button key={c.id} onClick={() => { setActiveClinicId(c.id); router.push("/dashboard"); }}
                    className="w-full text-left px-4 py-3.5 rounded-lg border border-slate-300 hover:border-sky-500 hover:bg-sky-50 transition-colors">
                    <div className="font-semibold text-slate-900">{c.brand_name ?? c.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5 capitalize">{[c.role, (c as any).city].filter(Boolean).join(" · ")}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
