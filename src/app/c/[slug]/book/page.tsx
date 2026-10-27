"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Script from "next/script";
import { applyBrand, applyIdentity } from "@/lib/theme";

interface Doctor { id: string; name: string; specialty: string | null; experience: number | null; fee: number }
interface Cfg {
  clinic: { slug: string; name: string; tagline?: string; logo_url?: string; primary_color?: string; address?: string; city?: string; phone?: string; specialty?: string };
  booking: { open: boolean; fee: number; advanceDays: number; holdMinutes: number; notice: string; keyId: string | null };
  doctors: Doctor[];
}
interface Booking { id: string; date: string; time: string; duration: number | null; doctor: string | null; patient: string | null; advancePaid: number; fee: number; clinic: { name: string; address: string; phone: string } }
interface Slot { time: string; doctorId: string; doctorName: string }
declare global { interface Window { Razorpay?: any } }

const rupees = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");
const niceDate = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) => new Date(iso + "T12:00:00").toLocaleDateString("en-IN", o);
const hour24 = (t: string) => { const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i); if (!m) return 0; let h = +m[1]; if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; } return h; };

function icsFor(b: Booking) {
  const m = b.time.match(/^(\d{1,2}):(\d{2})/)!; const h = hour24(b.time), mi = +m[2];
  const pad = (n: number) => String(n).padStart(2, "0"), d = b.date.replace(/-/g, "");
  const start = `${d}T${pad(h)}${pad(mi)}00`, endMin = h * 60 + mi + (b.duration ?? 30), end = `${d}T${pad(Math.floor(endMin / 60) % 24)}${pad(endMin % 60)}00`;
  const esc = (s: string) => s.replace(/[,;]/g, " ");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mediflow//Booking//EN", "BEGIN:VEVENT", `UID:${b.id}@mediflow`, `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, "")}`,
    `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${esc(`Appointment at ${b.clinic.name}`)}`, `LOCATION:${esc(b.clinic.address || "")}`, `DESCRIPTION:${esc(`With ${b.doctor ?? "the doctor"}. Booking ${b.id}`)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

/** Public online booking: pick a doctor, a day and a time, pay the confirmation fee, done. Works on a phone first. */
export default function BookPage() {
  const { slug } = useParams<{ slug: string }>();
  const ref = useMemo(() => (typeof window === "undefined" ? "" : slug === "_host" ? `host=${encodeURIComponent(window.location.host)}` : `clinic=${encodeURIComponent(slug)}`), [slug]);
  const [cfg, setCfg] = useState<Cfg | null | undefined>(undefined);
  const [doctorId, setDoctorId] = useState<string>("");          // "" = any doctor
  const [days, setDays] = useState<{ date: string; free: number }[]>([]);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", symptoms: "" });
  const [offers, setOffers] = useState(false);                     // optional, never ticked for them
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<{ holdId: string; orderId: string; amount: number; keyId: string; expiresAt: string } | null>(null);
  const [left, setLeft] = useState(0);
  const [done, setDone] = useState<Booking | null>(null);
  const [rzpReady, setRzpReady] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref) return;
    fetch(`/api/public/book/config?${ref}`).then((r) => r.json()).then((d) => {
      if (d.error || !d.clinic) { setCfg(null); return; }
      setCfg(d); applyBrand(d.clinic.primary_color); applyIdentity(d.clinic.name, d.clinic.logo_url);
    }).catch(() => setCfg(null));
  }, [ref]);

  const loadDays = useCallback(() => {
    setDays([]); setDate(""); setSlots(null); setSlot(null);
    fetch(`/api/public/book/days?${ref}${doctorId ? `&doctorId=${doctorId}` : ""}`).then((r) => r.json()).then((d) => {
      const list = d.days ?? []; setDays(list);
      const first = list.find((x: any) => x.free > 0); if (first) setDate(first.date);
    }).catch(() => setDays([]));
  }, [ref, doctorId]);
  useEffect(() => { if (cfg?.booking.open) loadDays(); }, [cfg, loadDays]);

  const loadSlots = useCallback(() => {
    if (!date) return; setSlots(null); setSlot(null);
    fetch(`/api/public/book/slots?${ref}&date=${date}${doctorId ? `&doctorId=${doctorId}` : ""}`).then((r) => r.json()).then((d) => setSlots(d.slots ?? [])).catch(() => setSlots([]));
  }, [ref, date, doctorId]);
  useEffect(() => { loadSlots(); }, [loadSlots]);

  // hold countdown
  useEffect(() => {
    if (!pending) return;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(pending.expiresAt).getTime() - Date.now()) / 1000)));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [pending]);

  const color = cfg?.clinic.primary_color || "#0ea5e9";
  const fee = cfg?.booking.fee ?? 0;
  const groups = useMemo(() => {
    const g: Record<string, Slot[]> = { Morning: [], Afternoon: [], Evening: [] };
    (slots ?? []).forEach((s) => { const h = hour24(s.time); g[h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"].push(s); });
    return g;
  }, [slots]);
  const phoneOk = f.phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").length === 10;
  const canPay = !!slot && f.name.trim().length >= 2 && phoneOk && !busy;

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); if (!r.ok) { const e: any = new Error(d.error ?? "Something went wrong"); e.data = d; throw e; } return d;
  }

  function openCheckout(p: NonNullable<typeof pending>) {
    if (!window.Razorpay) { setErr("The payment window is still loading. Please try again in a moment."); return; }
    const rz = new window.Razorpay({
      key: p.keyId, order_id: p.orderId, amount: Math.round(p.amount * 100), currency: "INR", name: cfg!.clinic.name,
      description: `Booking fee, adjusted in your final bill`, prefill: { name: f.name, contact: f.phone, email: f.email }, theme: { color },
      handler: async (res: any) => {
        setBusy(true); setErr("");
        try { const d = await post("/api/public/book/confirm", { holdId: p.holdId, orderId: res.razorpay_order_id, paymentId: res.razorpay_payment_id, signature: res.razorpay_signature }); setDone(d.booking); setPending(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
        catch (e: any) { setErr(e.message); setPending(null); loadDays(); }
        setBusy(false);
      },
      modal: { ondismiss: () => setBusy(false) },
    });
    rz.on?.("payment.failed", (r: any) => setErr(r?.error?.description ?? "The payment did not go through. You can try again."));
    rz.open();
  }

  async function book() {
    if (!canPay || !slot) return; setBusy(true); setErr("");
    try {
      const d = await post("/api/public/book/hold", { ...(slug === "_host" ? { host: window.location.host } : { clinic: slug }), doctorId: slot.doctorId, date, time: slot.time, name: f.name, phone: f.phone, email: f.email, symptoms: f.symptoms, offers });
      if (d.confirmed) { setDone(d.booking); window.scrollTo({ top: 0, behavior: "smooth" }); }
      else { const p = { holdId: d.holdId, orderId: d.orderId, amount: d.amount, keyId: d.keyId, expiresAt: d.expiresAt }; setPending(p); openCheckout(p); }
    } catch (e: any) { setErr(e.message); if (e.data?.code === "SLOT_UNAVAILABLE") loadSlots(); }
    setBusy(false);
  }

  // ---------- states ----------
  if (cfg === undefined) return <div className="min-h-[100dvh] flex items-center justify-center text-slate-400 text-sm">Loading…</div>;
  if (cfg === null) return <div className="min-h-[100dvh] flex items-center justify-center p-6 text-center"><div><p className="text-4xl mb-3">🏥</p><h1 className="text-xl font-bold text-slate-900">We couldn&apos;t find that clinic</h1><p className="text-sm text-slate-500 mt-1">Check the address and try again.</p></div></div>;

  const header = (
    <header style={{ background: `linear-gradient(135deg, ${color}, #1e1b4b)` }} className="text-white">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex items-center gap-3">
        {cfg.clinic.logo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={cfg.clinic.logo_url} alt="" className="w-12 h-12 rounded-xl bg-white object-contain p-1 shrink-0" />
          : <div className="w-12 h-12 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center text-xl font-bold shrink-0">{cfg.clinic.name.charAt(0)}</div>}
        <div className="min-w-0"><h1 className="font-bold text-lg leading-tight truncate">{cfg.clinic.name}</h1><p className="text-xs text-white/75 truncate">{[cfg.clinic.specialty, cfg.clinic.city].filter(Boolean).join(" · ") || "Book an appointment"}</p></div>
      </div>
    </header>
  );
  const home = slug === "_host" ? "/" : `/c/${slug}`;

  if (done) {
    const ics = () => { const blob = new Blob([icsFor(done)], { type: "text/calendar" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "appointment.ics"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
    const wa = (cfg.clinic.phone ?? "").replace(/\D/g, ""); const waNum = wa.length === 10 ? "91" + wa : wa;
    return (
      <div className="min-h-[100dvh] bg-slate-50">{header}
        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-3xl">✓</div>
            <h2 className="mt-3 text-xl font-bold text-slate-900">You&apos;re booked{done.patient ? `, ${done.patient.split(" ")[0]}` : ""}!</h2>
            <p className="text-sm text-slate-500 mt-1">We&apos;ve sent the details to your WhatsApp.</p>
            <dl className="mt-5 text-left text-sm divide-y divide-slate-100 border border-slate-100 rounded-xl">
              {([["When", `${niceDate(done.date)} · ${done.time}`], ["Doctor", done.doctor ?? "—"], ["Where", [done.clinic.name, done.clinic.address].filter(Boolean).join(", ")], ["Booking ID", done.id], ...(done.advancePaid > 0 ? [["Paid now", `${rupees(done.advancePaid)} (adjusted in your final bill)`]] : [])] as string[][]).map(([k, v]) => (
                <div key={k} className="flex gap-3 px-4 py-2.5"><dt className="w-24 shrink-0 text-slate-400">{k}</dt><dd className="text-slate-800 font-medium break-words min-w-0">{v}</dd></div>))}
            </dl>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button onClick={ics} style={{ background: color }} className="rounded-xl text-white font-semibold py-3">Add to calendar</button>
              {done.clinic.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(done.clinic.name + " " + done.clinic.address)}`} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 font-semibold py-3 hover:bg-slate-50">Get directions</a>}
            </div>
            {waNum && <p className="text-xs text-slate-400 mt-4">To change or cancel, <a className="underline" href={`https://wa.me/${waNum}`} target="_blank" rel="noreferrer">message us on WhatsApp</a>{cfg.clinic.phone ? ` or call ${cfg.clinic.phone}` : ""}.</p>}
          </div>
          <a href={home} className="block text-center text-sm text-slate-500 underline">Back to {cfg.clinic.name}</a>
        </main>
      </div>
    );
  }

  if (!cfg.booking.open) return (
    <div className="min-h-[100dvh] bg-slate-50">{header}
      <main className="max-w-2xl mx-auto px-4 py-10 text-center"><p className="text-4xl mb-3">📞</p><h2 className="text-lg font-bold text-slate-900">Online booking isn&apos;t available right now</h2>
        <p className="text-sm text-slate-500 mt-1">Please call {cfg.clinic.phone ? <a className="underline" href={`tel:${cfg.clinic.phone}`}>{cfg.clinic.phone}</a> : "the clinic"} to book.</p><a href={home} className="inline-block mt-4 text-sm underline text-slate-500">Back</a></main></div>
  );

  const mins = Math.floor(left / 60), secs = String(left % 60).padStart(2, "0");
  const step = "text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2";
  const card = "bg-white rounded-2xl border border-slate-200 p-4 sm:p-5";
  const input = "w-full px-3.5 py-3 rounded-xl border border-slate-200 text-base focus:outline-none focus:ring-2 bg-white";
  return (
    <div className="min-h-[100dvh] bg-slate-50 pb-28">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" onLoad={() => setRzpReady(true)} />
      {header}
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {cfg.doctors.length > 1 && (
          <section className={card}>
            <p className={step}>1 · Choose a doctor</p>
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1 snap-x">
              {[{ id: "", name: "Any available doctor", specialty: null as string | null, fee: 0, experience: null as number | null }, ...cfg.doctors].map((d) => (
                <button key={d.id || "any"} onClick={() => setDoctorId(d.id)} aria-pressed={doctorId === d.id}
                  style={doctorId === d.id ? { borderColor: color, background: color + "14" } : undefined}
                  className="snap-start shrink-0 min-w-[150px] text-left rounded-xl border-2 border-slate-200 px-3.5 py-2.5">
                  <p className="font-semibold text-sm text-slate-900">{d.name}</p>
                  <p className="text-xs text-slate-500">{d.specialty ?? (d.id ? "General" : "First free")}{d.experience ? ` · ${d.experience} yrs` : ""}</p>
                  {d.fee > 0 && <p className="text-xs text-slate-400 mt-0.5">Consultation {rupees(d.fee)}</p>}
                </button>))}
            </div>
          </section>
        )}

        <section className={card}>
          <p className={step}>{cfg.doctors.length > 1 ? "2" : "1"} · Pick a day</p>
          {days.length === 0 ? <p className="text-sm text-slate-400 py-3">Checking availability…</p> : days.every((d) => d.free === 0) ? <p className="text-sm text-slate-500 py-3">No free times in the next {cfg.booking.advanceDays} days. Please call the clinic.</p> : (
            <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1">
              {days.map((d) => { const on = d.date === date, off = d.free === 0; return (
                <button key={d.date} disabled={off} onClick={() => setDate(d.date)} aria-pressed={on} aria-label={`${niceDate(d.date)}, ${off ? "no times" : d.free + " times free"}`}
                  style={on ? { background: color, borderColor: color } : undefined}
                  className={`shrink-0 w-[62px] rounded-xl border-2 py-2 text-center ${on ? "text-white" : off ? "border-slate-100 text-slate-300" : "border-slate-200 text-slate-800"}`}>
                  <span className="block text-[11px] uppercase">{niceDate(d.date, { weekday: "short" })}</span>
                  <span className="block text-lg font-bold leading-tight">{new Date(d.date + "T12:00:00").getDate()}</span>
                  <span className="block text-[10px] opacity-80">{niceDate(d.date, { month: "short" })}</span>
                  <span className={`block text-[10px] mt-0.5 ${on ? "text-white/90" : off ? "" : "text-emerald-600"}`}>{off ? "full" : `${d.free} free`}</span>
                </button>); })}
            </div>)}
        </section>

        {date && (
          <section className={card}>
            <p className={step}>{cfg.doctors.length > 1 ? "3" : "2"} · Pick a time <span className="normal-case font-normal text-slate-400">· {niceDate(date)}</span></p>
            {slots === null ? <p className="text-sm text-slate-400 py-3">Loading times…</p> : slots.length === 0 ? <p className="text-sm text-slate-500 py-3">No times left this day. Try another day.</p> : (
              <div className="space-y-3">{Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) => (
                <div key={g}><p className="text-xs text-slate-400 mb-1.5">{g}</p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">{l.map((s) => { const on = slot?.time === s.time; return (
                    <button key={s.time} onClick={() => { setSlot(s); setErr(""); setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} aria-pressed={on}
                      style={on ? { background: color, borderColor: color } : undefined}
                      className={`rounded-xl border-2 py-2.5 text-sm font-semibold ${on ? "text-white" : "border-slate-200 text-slate-800 hover:border-slate-300"}`}>{s.time}</button>); })}</div>
                </div>))}</div>)}
          </section>
        )}

        {slot && (
          <section ref={formRef} className={card + " scroll-mt-4"}>
            <p className={step}>{cfg.doctors.length > 1 ? "4" : "3"} · Your details</p>
            <div className="space-y-3">
              <label className="block"><span className="text-sm text-slate-600">Full name</span><input autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} placeholder="e.g. Asha Rao" /></label>
              <label className="block"><span className="text-sm text-slate-600">Mobile number (WhatsApp)</span><input autoComplete="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={input} placeholder="10-digit mobile number" />
                {f.phone && !phoneOk && <span className="text-xs text-red-600">Enter a 10-digit mobile number</span>}</label>
              <label className="block"><span className="text-sm text-slate-600">Email <span className="text-slate-400">(optional)</span></span><input type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={input} /></label>
              <label className="block"><span className="text-sm text-slate-600">What&apos;s it about? <span className="text-slate-400">(optional)</span></span><input value={f.symptoms} onChange={(e) => setF({ ...f, symptoms: e.target.value })} className={input} placeholder="e.g. tooth pain, cleaning" /></label>
              <label className="flex items-start gap-2 text-xs text-slate-500 leading-snug">
                <input type="checkbox" checked={offers} onChange={(e) => setOffers(e.target.checked)} className="mt-0.5" />
                <span>Send me occasional dental tips and offers on WhatsApp. You can stop any time by replying STOP.</span>
              </label>
            </div>
            {cfg.booking.notice && <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg p-3">{cfg.booking.notice}</p>}
          </section>
        )}
        {err && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{err}</div>}
        {pending && left > 0 && <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3 flex items-center justify-between gap-3"><span>Your time is held for {mins}:{secs}.</span><button onClick={() => openCheckout(pending)} className="font-semibold underline shrink-0">Pay now</button></div>}
        {pending && left === 0 && <div className="rounded-xl bg-slate-100 text-slate-600 text-sm p-3">The hold ran out. Pick the time again to start over.</div>}
      </main>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="min-w-0 text-sm flex-1">
            {slot ? <><p className="font-semibold text-slate-900 truncate">{niceDate(date, { weekday: "short", day: "numeric", month: "short" })} · {slot.time}</p><p className="text-xs text-slate-500 truncate">{slot.doctorName}</p></> : <p className="text-slate-400">Choose a day and time</p>}
          </div>
          <button onClick={book} disabled={!canPay || (fee > 0 && !rzpReady)} style={{ background: color }} className="shrink-0 rounded-xl text-white font-semibold px-5 py-3 disabled:opacity-40">
            {busy ? "Please wait…" : fee > 0 ? `Pay ${rupees(fee)} & confirm` : "Confirm booking"}
          </button>
        </div>
        {fee > 0 && slot && <p className="max-w-2xl mx-auto text-[11px] text-slate-400 mt-1">The {rupees(fee)} confirmation fee is adjusted in your final bill. Secure payment by Razorpay.</p>}
      </div>
    </div>
  );
}
