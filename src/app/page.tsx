import Link from "next/link";

export const metadata = {
  title: "Mediflow Clinic — Smart Clinic Management",
};

const FEATURES = [
  { icon: "📅", title: "Smart Scheduling", desc: "Slot-based calendar with doctor assignment, multi-sitting treatment plans, and walk-in tokens." },
  { icon: "💬", title: "WhatsApp Reminders", desc: "Auto-send confirmations, sitting reminders, and payment links. Patients never miss a visit." },
  { icon: "🧾", title: "GST Billing", desc: "One-click invoices with GST, UPI, cash, card, insurance. Razorpay payment links built-in." },
  { icon: "💊", title: "Stock & Pharmacy", desc: "Track medicines and consumables. Low-stock alerts and expiry warnings before you run out." },
  { icon: "🤖", title: "AI Assistant", desc: "Ask about today's schedule, revenue, or pending tasks. Powered by Gemini 1.5 Flash." },
  { icon: "📋", title: "Patient Records", desc: "Full profiles — allergies, conditions, visit history. MediPass QR sync from patient app." },
  { icon: "👥", title: "Multi-Role Staff", desc: "Admin, doctor, nurse, receptionist. Role-based access. Invite with one click." },
  { icon: "📊", title: "Live Analytics", desc: "Revenue by doctor, no-show rates, department trends — all on a real-time dashboard." },
  { icon: "✅", title: "Task Manager", desc: "Kanban board for clinical tasks. Assign to staff, track progress, close the loop." },
];

const STATS = [
  ["10+", "Specialties"],
  ["4", "Staff roles"],
  ["∞", "Patients"],
  ["AI", "Powered"],
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900" style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>

      {/* NAV */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white font-bold text-base shadow-sm">M</div>
            <span className="font-bold text-lg tracking-tight">Mediflow <span className="text-blue-600">Clinic</span></span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#demo" className="hover:text-gray-900 transition-colors">Demo</a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors">Sign in</Link>
            <Link href="/signup" className="text-sm bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-90 text-white font-semibold px-4 py-2 rounded-xl transition-all shadow-sm">
              Get started →
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-24 pb-28 px-6 text-center relative overflow-hidden">
        {/* background blobs */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-40" />
          <div className="absolute top-10 right-1/4 w-80 h-80 bg-violet-100 rounded-full blur-3xl opacity-40" />
        </div>
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 border border-blue-100">
            🦷 Live dentist demo — try it free, no signup needed
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-[1.1]" style={{ fontFamily: "Sora, Inter, system-ui, sans-serif" }}>
            Run your clinic<br />
            <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
              without the chaos
            </span>
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            All-in-one SaaS for modern Indian clinics — appointments, billing, stock, WhatsApp, multi-sitting plans, and AI in one dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold px-8 py-4 rounded-2xl text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
              Start free — set up in 2 min
            </Link>
            <Link href="/login"
              className="inline-flex items-center justify-center bg-gray-50 border border-gray-200 text-gray-700 font-semibold px-8 py-4 rounded-2xl text-lg hover:bg-gray-100 transition-colors">
              🦷 Try Dentist Demo
            </Link>
            <a href="/demo"
              className="inline-flex items-center justify-center gap-2 bg-white border border-blue-200 text-blue-700 font-semibold px-8 py-4 rounded-2xl text-lg hover:bg-blue-50 transition-colors">
              ▶ Watch the guided demo
            </a>
          </div>
          <p className="text-xs text-gray-400 mt-4">No credit card · Free for small clinics · Upgrade anytime</p>
        </div>
      </section>

      {/* STATS BAR */}
      <div className="bg-gradient-to-r from-blue-600 to-violet-600 py-10">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-white text-center">
          {STATS.map(([n, l]) => (
            <div key={l}>
              <div className="text-3xl font-extrabold" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{n}</div>
              <div className="text-blue-100 text-sm mt-1">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* FEATURES */}
      <section id="features" className="py-24 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Everything your clinic needs</h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">From first appointment to final invoice — one place for every member of your team.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24 px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Set up in under 2 minutes</h2>
            <p className="text-gray-500 text-lg">No IT team required. Get your clinic live today.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "Create your clinic", desc: "Enter your clinic name, specialty, and admin account. We set everything up automatically." },
              { step: "02", title: "Invite your team", desc: "Add doctors, nurses, receptionists with one click. Role-based access is configured automatically." },
              { step: "03", title: "Start seeing patients", desc: "Book appointments, raise invoices, manage stock — everything from a single dashboard." },
            ].map((s) => (
              <div key={s.step} className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white font-bold text-lg flex items-center justify-center mx-auto mb-4" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{s.step}</div>
                <h3 className="font-bold text-gray-900 mb-2 text-lg">{s.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="py-24 px-6 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Simple, honest pricing</h2>
          <p className="text-gray-500 text-lg mb-12">Pay only for what you use. No hidden fees.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {[
              { name: "Starter", price: "Free", desc: "Perfect for solo doctors", features: ["Up to 50 patients/month", "Appointments & billing", "Basic stock tracking", "1 staff member"] },
              { name: "Clinic", price: "₹999/mo", desc: "For growing clinics", features: ["Unlimited patients", "All modules unlocked", "WhatsApp + AI assistant", "Up to 10 staff members"], highlight: true },
            ].map((p) => (
              <div key={p.name} className={`rounded-2xl p-8 text-left border-2 ${p.highlight ? "border-blue-600 bg-white shadow-xl" : "border-gray-200 bg-white"}`}>
                {p.highlight && <div className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md inline-block mb-3">MOST POPULAR</div>}
                <div className="text-lg font-bold text-gray-900 mb-1">{p.name}</div>
                <div className="text-3xl font-extrabold mb-1" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{p.price}</div>
                <div className="text-sm text-gray-500 mb-6">{p.desc}</div>
                <ul className="space-y-3 mb-8">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="text-green-500 font-bold">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={`block text-center py-3 rounded-xl font-semibold text-sm transition-all ${p.highlight ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-90" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}>
                  Get started →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DEMO CTA */}
      <section id="demo" className="py-24 px-6 bg-gradient-to-br from-blue-50 to-violet-50">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-5xl mb-6">🦷</div>
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Try Bright Smile Dental</h2>
          <p className="text-gray-500 text-lg mb-8">
            A pre-loaded dentist clinic with real patients, appointments, billing, stock, and staff. Try every feature — no setup needed.
          </p>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm mb-8 text-left max-w-xs mx-auto">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">Demo credentials</p>
            {[["Email", "demo@brightsmile.in"], ["Password", "Demo@1234"], ["Role", "Admin"]].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm py-1.5 border-b last:border-0 border-gray-100">
                <span className="text-gray-500">{k}</span>
                <span className="font-mono font-medium text-gray-900">{v}</span>
              </div>
            ))}
          </div>
          <Link href="/login"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-violet-600 text-white font-bold px-10 py-4 rounded-2xl text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
            Enter Demo Clinic →
          </Link>
          <p className="mt-5">
            <a href="/demo" className="text-blue-700 font-semibold hover:underline">▶ Or take the 3-minute guided tour first</a>
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-900 text-gray-400 py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 text-sm mb-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white font-bold text-sm">M</div>
              <span className="text-white font-bold text-lg">Mediflow Clinic</span>
            </div>
            <div className="flex gap-6 text-sm">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
              <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
              <Link href="/signup" className="hover:text-white transition-colors">Sign up</Link>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs">
            <p>© 2026 Mediflow. Made with ❤️ for Indian clinics.</p>
            <p className="text-gray-600">Backed by Supabase · Gemini AI · Meta WhatsApp</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
