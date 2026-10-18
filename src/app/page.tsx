import Link from "next/link";

export const metadata = {
  title: "Mediflow Clinic — Smart Clinic Management",
};

const FEATURES = [
  { icon: "📅", title: "Smart Scheduling", desc: "Book, reschedule, manage appointments with slot-based calendar and doctor assignment." },
  { icon: "💬", title: "WhatsApp Reminders", desc: "Auto-send confirmations and reminders via WhatsApp. Patients never miss a visit." },
  { icon: "🧾", title: "Instant Billing", desc: "GST-ready invoices with one click. UPI, cash, card, insurance — all tracked." },
  { icon: "💊", title: "Stock & Pharmacy", desc: "Track medicines and consumables. Low-stock alerts before you run out." },
  { icon: "🤖", title: "AI Assistant", desc: "Ask about today's schedule, revenue, or stock. Powered by Gemini 1.5 Flash." },
  { icon: "📋", title: "Patient Records", desc: "Full profiles — allergies, conditions, visit history. MediPass QR for walk-ins." },
  { icon: "👥", title: "Multi-Role Staff", desc: "Admin, doctor, nurse, receptionist. Role-based access, invite with one click." },
  { icon: "📊", title: "Live Dashboard", desc: "Today's appointments, revenue, pending patients, alerts — at a glance." },
  { icon: "🔗", title: "Patient App Sync", desc: "Appointments from the Mediflow patient app appear instantly in your dashboard." },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* NAV */}
      <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">M</div>
            <span className="font-bold text-lg">Mediflow <span className="text-sky-500">Clinic</span></span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#demo" className="hover:text-gray-900 transition-colors">Demo</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 font-medium">Sign in</Link>
            <Link href="/login" className="text-sm bg-sky-500 hover:bg-sky-600 text-white font-semibold px-4 py-2 rounded-xl transition-colors">
              Try Demo →
            </Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-24 pb-28 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-sky-50 text-sky-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6 border border-sky-100">
            🚀 Dentist demo available — try it now
          </div>
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
            Run your clinic<br />
            <span className="bg-gradient-to-r from-sky-500 to-indigo-600 bg-clip-text text-transparent">
              without the chaos
            </span>
          </h1>
          <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            All-in-one SaaS for modern clinics — appointments, billing, stock, WhatsApp, prescriptions, and AI in one dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold px-8 py-4 rounded-2xl text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
              🦷 Try Dentist Demo
            </Link>
            <Link href="/login"
              className="inline-flex items-center justify-center bg-gray-50 border border-gray-200 text-gray-700 font-semibold px-8 py-4 rounded-2xl text-lg hover:bg-gray-100 transition-colors">
              Sign in to your clinic
            </Link>
          </div>
          <p className="text-xs text-gray-400 mt-4">No credit card needed · Demo resets every hour</p>
        </div>
      </section>

      {/* STATS */}
      <div className="bg-gradient-to-r from-sky-500 to-indigo-600 py-10">
        <div className="max-w-4xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-white text-center">
          {[["10+","Specialties"],["4","Staff roles"],["∞","Patients"],["AI","Powered"]].map(([n,l]) => (
            <div key={l}><div className="text-3xl font-extrabold">{n}</div><div className="text-sky-100 text-sm mt-1">{l}</div></div>
          ))}
        </div>
      </div>

      {/* FEATURES */}
      <section id="features" className="py-24 px-6 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Everything your clinic needs</h2>
            <p className="text-gray-500 text-lg max-w-xl mx-auto">From first appointment to final invoice — one place for every member of your team.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DEMO CTA */}
      <section id="demo" className="py-24 px-6 bg-gradient-to-br from-sky-50 to-indigo-50">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-5xl mb-6">🦷</div>
          <h2 className="text-3xl md:text-4xl font-extrabold mb-4">Explore Bright Smile Dental</h2>
          <p className="text-gray-500 text-lg mb-8">
            A pre-loaded dentist clinic with real patients, appointments, billing, stock, and staff. Try every feature — no setup required.
          </p>
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm mb-8 text-left max-w-xs mx-auto">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">Demo login</p>
            {[["Email","demo@brightsmile.in"],["Password","Demo@1234"],["Role","Admin"]].map(([k,v]) => (
              <div key={k} className="flex justify-between text-sm py-1 border-b last:border-0 border-gray-100">
                <span className="text-gray-500">{k}</span>
                <span className="font-mono font-medium text-gray-900">{v}</span>
              </div>
            ))}
          </div>
          <Link href="/login"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold px-10 py-4 rounded-2xl text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
            Enter Demo Clinic →
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-gray-900 text-gray-400 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">M</div>
            <span className="text-white font-bold">Mediflow Clinic</span>
          </div>
          <div className="flex gap-6">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
          </div>
          <p className="text-xs">© 2026 Mediflow. Made for Indian clinics.</p>
        </div>
      </footer>
    </div>
  );
}
