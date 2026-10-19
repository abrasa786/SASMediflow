"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmail } from "@/lib/auth";
import { getMyClinics } from "@/lib/clinic";
import { setActiveClinicId } from "@/lib/auth";
import type { Clinic } from "@/types";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"login" | "pick">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [info, setInfo] = useState("");

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
    setLoading(true);
    setError("");
    const { error: authErr } = await signInWithEmail(email, password);
    if (authErr) {
      const notConfirmed = /not confirmed/i.test(authErr.message);
      setUnconfirmed(notConfirmed);
      setError(notConfirmed ? "Your email isn't confirmed yet. Click the link we emailed you, or resend it below." : authErr.message);
      setLoading(false);
      return;
    }
    setUnconfirmed(false);
    try {
      const myClinics = await getMyClinics();
      if (myClinics.length === 0) {
        setError("No clinic assigned to your account. Contact your clinic admin.");
        setLoading(false);
        return;
      }
      if (myClinics.length === 1) {
        setActiveClinicId(myClinics[0].id);
        router.push("/dashboard");
        return;
      }
      setClinics(myClinics);
      setStep("pick");
    } catch {
      setError("Failed to load clinics. Please try again.");
    }
    setLoading(false);
  }

  function pickClinic(clinic: Clinic) {
    setActiveClinicId(clinic.id);
    router.push("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-violet-600 to-indigo-700 p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white font-bold text-xl border border-white/30">M</div>
            <span className="text-2xl font-bold text-white" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Mediflow</span>
          </div>
          <p className="text-blue-100 text-sm">Clinic Staff Portal</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-7">
          {step === "login" ? (
            <>
              <h1 className="text-xl font-bold mb-5 text-gray-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Sign in to your clinic</h1>

              {/* Demo hint */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-5 text-xs text-blue-700">
                <p className="font-semibold mb-1">🦷 Demo — Bright Smile Dental</p>
                <p>Email: <strong>demo@brightsmile.in</strong></p>
                <p>Password: <strong>Demo@1234</strong></p>
                <button
                  type="button"
                  onClick={() => { setEmail("demo@brightsmile.in"); setPassword("Demo@1234"); }}
                  className="mt-2 text-blue-600 font-semibold underline"
                >
                  Fill demo credentials →
                </button>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="you@clinic.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="••••••••"
                  />
                </div>
                {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
                {unconfirmed && (
                  <button type="button" onClick={resendConfirmation} className="text-xs text-blue-600 hover:underline">Resend confirmation email</button>
                )}
                {info && <div className="text-xs text-gray-600">{info}</div>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all shadow-sm"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold mb-1 text-gray-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Select clinic</h1>
              <p className="text-sm text-gray-500 mb-5">You belong to multiple clinics</p>
              <div className="space-y-2">
                {clinics.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickClinic(c)}
                    className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-colors group"
                  >
                    <div className="font-medium text-gray-900 group-hover:text-blue-600">{c.brand_name ?? c.name}</div>
                    {c.area && <div className="text-xs text-gray-500 mt-0.5">{c.area}</div>}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-blue-100 mt-6">
          Don&apos;t have an account?{" "}
          <a href="/signup" className="text-white font-semibold hover:underline">Sign up →</a>
        </p>
        <p className="text-center mt-2">
          <a href="/" className="text-xs text-blue-200 hover:text-white transition-colors">← Back to homepage</a>
        </p>
      </div>
    </div>
  );
}
