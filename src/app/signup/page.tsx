"use client";

import { useState } from "react";
import Link from "next/link";
import LogoPicker from "@/components/LogoPicker";

const SPECIALTIES = [
  "General Medicine", "Dental / Oral Care", "Dermatology", "Orthopaedics",
  "Cardiology", "Paediatrics", "Gynaecology", "ENT", "Ophthalmology",
  "Neurology", "Psychiatry", "Physiotherapy", "Ayurveda / Homeopathy",
  "Diagnostics / Lab", "Multi-specialty", "Other",
];

export default function SignupPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(true);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [error, setError] = useState("");

  // Step 1 — Clinic info
  const [clinicName, setClinicName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [clinicPhone, setClinicPhone] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinMsg, setPinMsg] = useState("");
  function pinHere() {
    setPinMsg("");
    if (!navigator.geolocation) return setPinMsg("This browser can't share your location. You can add it later in Settings.");
    navigator.geolocation.getCurrentPosition(
      (p) => { setPin({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); setPinMsg("Location saved. Do this at the clinic for the best accuracy."); },
      () => setPinMsg("Couldn't get your location. Allow location access, or add it later in Settings."),
      { enableHighAccuracy: true, timeout: 10000 });
  }
  const [logo, setLogo] = useState<string | null>(null);
  const [color, setColor] = useState("#2563eb");
  const [tagline, setTagline] = useState("");
  const [aiName, setAiName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [domain, setDomain] = useState("");
  const [logoWarn, setLogoWarn] = useState("");
  const autoSlug = (brandName || clinicName).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);
  const shownSlug = slugTouched ? slug : autoSlug;

  // Step 2 — Admin account
  const [adminName, setAdminName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function resend() {
    setResending(true); setResendMsg("");
    try {
      const r = await fetch("/api/auth/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json();
      setResendMsg(r.ok ? d.message : d.error || "Could not resend.");
    } catch { setResendMsg("Could not resend. Please try again."); }
    setResending(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) { setError("Passwords don't match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clinic/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicName, brandName, specialty, city, address: address.trim() || undefined, clinicPhone: clinicPhone.trim() || undefined, latitude: pin?.lat, longitude: pin?.lng, adminName, email, password, logoDataUrl: logo, primaryColor: color, tagline, aiName: aiName.trim() || undefined, slug: shownSlug.length >= 3 ? shownSlug : undefined, customDomain: domain.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create clinic");
      setNeedsConfirm(data.needsEmailConfirmation !== false);
      setLogoWarn(data.logoWarning ?? "");
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  const progress = step === 1 ? 33 : step === 2 ? 66 : 100;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 via-violet-600 to-indigo-700 p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-white font-bold text-xl border border-white/30">M</div>
            <span className="text-2xl font-bold text-white" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Mediflow</span>
          </div>
          <p className="text-blue-100 text-sm">Set up your clinic in 2 minutes</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-7">

          {/* Progress bar */}
          {step < 3 && (
            <div className="mb-6">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                <span className={step >= 1 ? "text-blue-600 font-semibold" : ""}>Clinic info</span>
                <span className={step >= 2 ? "text-blue-600 font-semibold" : ""}>Admin account</span>
                <span className={step >= 3 ? "text-blue-600 font-semibold" : ""}>Done!</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-violet-600 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* STEP 1 — Clinic */}
          {step === 1 && (
            <form onSubmit={(e) => { e.preventDefault(); if (!clinicName || !specialty) { setError("Please fill clinic name and specialty."); return; } setError(""); setStep(2); }}>
              <h1 className="text-xl font-bold text-gray-900 mb-1" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Tell us about your clinic</h1>
              <p className="text-sm text-gray-500 mb-5">This appears on your invoices and patient messages.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Clinic / Hospital Name *</label>
                  <input
                    type="text"
                    value={clinicName}
                    onChange={(e) => setClinicName(e.target.value)}
                    required
                    placeholder="e.g. Apollo Dental Clinic"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Brand / Short Name</label>
                  <input
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    placeholder="e.g. Apollo Dental (shown in sidebar)"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Specialty *</label>
                  <select
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select specialty…</option>
                    {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Bangalore"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Clinic address</label>
                  <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} maxLength={300} placeholder="Shop / building, street, area, pincode" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Clinic phone</label>
                  <input type="tel" value={clinicPhone} onChange={(e) => setClinicPhone(e.target.value)} maxLength={20} placeholder="Number patients can call" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                </div>
                <div>
                  <button type="button" onClick={pinHere} className="px-3.5 py-2.5 rounded-xl border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-50">📍 {pin ? "Update clinic location" : "Use my location as the clinic's pin"}</button>
                  <p className="text-xs text-gray-400 mt-1">{pinMsg || "Lets patients find you by distance in the Mediflow patient app. Your browser will ask for permission. Optional."}</p>
                </div>
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Your brand (optional, change anytime in Settings)</p>
                  <LogoPicker value={logo} onChange={setLogo} />
                  <div className="mt-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Name your AI assistant</label>
                    <input type="text" value={aiName} maxLength={24} onChange={(e) => setAiName(e.target.value)} placeholder="e.g. Mira" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-3 mt-4 items-end">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Tagline</label>
                      <input type="text" value={tagline} maxLength={120} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Gentle dental care for the whole family" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Colour</label>
                      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Brand colour" className="h-10 w-14 rounded-lg border border-gray-200 bg-white p-1" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Your web address</label>
                    <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500">
                      <span className="pl-3.5 text-xs text-gray-400 whitespace-nowrap">/c/</span>
                      <input type="text" value={shownSlug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }} className="flex-1 min-w-0 px-1.5 py-2.5 bg-transparent text-sm focus:outline-none" aria-label="Web address" />
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Your own domain</label>
                    <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. appointments.yourclinic.com" className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-xs text-gray-400 mt-1">Already own a domain? Enter it and we&apos;ll show the two DNS records to add after you sign in (Settings → Branding &amp; domain). Skip if you don&apos;t.</p>
                  </div>
                </div>
              </div>

              {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-4">{error}</div>}

              <button type="submit" className="mt-5 w-full py-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
                Continue →
              </button>
            </form>
          )}

          {/* STEP 2 — Admin account */}
          {step === 2 && (
            <form onSubmit={handleCreate}>
              <h1 className="text-xl font-bold text-gray-900 mb-1" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Create your admin account</h1>
              <p className="text-sm text-gray-500 mb-5">You&apos;ll be the clinic admin. You can invite staff next.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Your Full Name *</label>
                  <input
                    type="text"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    required
                    placeholder="Dr. Priya Sharma"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Email *</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@clinic.com"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Password *</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Min 8 characters"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Confirm Password *</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    placeholder="Repeat password"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {error && <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-4">{error}</div>}

              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => { setStep(1); setError(""); }} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all">
                  ← Back
                </button>
                <button type="submit" disabled={loading} className="flex-[2] py-3 bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-all shadow-sm">
                  {loading ? "Creating clinic…" : "Launch my clinic 🚀"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 3 — Success */}
          {step === 3 && (
            <div className="text-center py-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-3xl mx-auto mb-5 shadow-lg">🎉</div>
              <h1 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Clinic created!</h1>
              {needsConfirm ? (
                <>
                  <p className="text-sm text-gray-500 mb-6"><strong>{clinicName}</strong> is ready. Confirm your email to sign in.</p>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-4 text-left text-sm">
                    <p className="font-semibold text-blue-700 mb-2">📧 Check your email</p>
                    <p className="text-blue-600 text-xs">We sent a confirmation link to <strong>{email}</strong>. Click it, then sign in. Check spam if it doesn&apos;t arrive within a minute.</p>
                  </div>
                  <button type="button" onClick={resend} disabled={resending} className="w-full mb-3 py-2.5 border border-blue-200 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-50 disabled:opacity-60">
                    {resending ? "Sending…" : "Resend confirmation email"}
                  </button>
                  {resendMsg && <p className="text-xs text-gray-600 mb-4">{resendMsg}</p>}
                </>
              ) : (
                <p className="text-sm text-gray-500 mb-6"><strong>{clinicName}</strong> is live. You can sign in now.</p>
              )}
              {logoWarn && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">Your clinic was created, but the logo could not be saved ({logoWarn}). Upload it again in Settings → Branding &amp; domain.</p>}
              <Link href="/login" className="block w-full py-3 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-all shadow-sm">
                Sign in to your clinic →
              </Link>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-blue-100 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-white font-semibold hover:underline">Sign in →</Link>
        </p>
        <p className="text-center mt-3">
          <Link href="/" className="text-xs text-blue-200 hover:text-white transition-colors">← Back to homepage</Link>
        </p>
      </div>
    </div>
  );
}
