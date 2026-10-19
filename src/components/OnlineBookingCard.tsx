"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";

/** Settings card (admin): let patients book online, the confirmation fee, and the clinic's own Razorpay account. */
export default function OnlineBookingCard({ clinicId }: { clinicId: string }) {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState({ enabled: false, fee: 0, hold_minutes: 10, advance_days: 30, notice: "", keyId: "", keySecret: "", webhookSecret: "" });
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  const apply = (d: any) => { setS(d); setF({ enabled: d.enabled, fee: d.fee, hold_minutes: d.hold_minutes, advance_days: d.advance_days, notice: d.notice ?? "", keyId: d.keyId ?? "", keySecret: "", webhookSecret: "" }); };
  useEffect(() => { authFetch(`/api/online-booking?clinicId=${clinicId}`).then(apply).catch((e) => setErr(e.message)); }, [clinicId]);

  async function save() {
    setBusy(true); setErr(""); setMsg("");
    try { apply(await authFetch("/api/online-booking", { body: { clinicId, ...f } })); setMsg("Saved."); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = s ? `${origin}/c/${s.slug}/book` : "";
  const inp = "w-full px-3 py-2 rounded-xl border border-slate-200 text-sm";
  const lab = "block text-xs font-semibold text-slate-600 mb-1";

  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 sm:p-6 mt-6" aria-labelledby="ob-h">
      <h2 id="ob-h" className="font-semibold text-sm uppercase tracking-wide text-slate-500 mb-4">Online booking &amp; confirmation fee</h2>
      {!s ? <p className="text-sm text-slate-400">{err || "Loading…"}</p> : (
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">Patients pick a doctor and a free time on your public page, pay a small confirmation fee, and the booking appears in Appointments and Patients with a WhatsApp confirmation. The fee is adjusted in their final bill.</p>
          <label className="flex items-center gap-3"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><span className="font-semibold text-slate-800">Let patients book online</span></label>
          <div className="grid sm:grid-cols-3 gap-3">
            <div><label className={lab}>Confirmation fee (₹, 0 = free)</label><input type="number" min={0} value={f.fee} onChange={(e) => setF({ ...f, fee: Number(e.target.value) })} className={inp} /></div>
            <div><label className={lab}>Hold the time while paying (minutes)</label><input type="number" min={3} max={30} value={f.hold_minutes} onChange={(e) => setF({ ...f, hold_minutes: Number(e.target.value) })} className={inp} /></div>
            <div><label className={lab}>Bookable up to (days ahead)</label><input type="number" min={1} max={180} value={f.advance_days} onChange={(e) => setF({ ...f, advance_days: Number(e.target.value) })} className={inp} /></div>
          </div>
          <div><label className={lab}>Note shown to patients (cancellation policy, what to bring…)</label><textarea rows={2} maxLength={400} value={f.notice} onChange={(e) => setF({ ...f, notice: e.target.value })} className={inp} placeholder="e.g. The fee is adjusted in your bill. Reschedule up to 4 hours before by messaging us on WhatsApp." /></div>

          {f.fee > 0 && (
            <div className="rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="font-semibold text-slate-800">Your Razorpay account <span className="font-normal text-slate-500">(money goes straight to you)</span></p>
              {s.usingPlatformKeys && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">Using the platform&apos;s default payment account. Add your own keys below so payments go to your bank.</p>}
              {!s.encryptionReady && <p className="text-xs text-red-700 bg-red-50 rounded-lg p-2">Set <code>AI_DATA_KEY</code> in hosting first. Payment keys are only stored encrypted.</p>}
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className={lab}>Key id</label><input value={f.keyId} onChange={(e) => setF({ ...f, keyId: e.target.value })} className={inp} placeholder="rzp_live_xxxxxxxx" autoComplete="off" /></div>
                <div><label className={lab}>Key secret {s.hasSecret && <span className="text-emerald-600">· saved</span>}</label><input type="password" value={f.keySecret} onChange={(e) => setF({ ...f, keySecret: e.target.value })} className={inp} placeholder={s.hasSecret ? "Leave blank to keep" : "Paste the secret"} autoComplete="new-password" /></div>
                <div className="sm:col-span-2"><label className={lab}>Webhook secret {s.hasWebhookSecret && <span className="text-emerald-600">· saved</span>} <span className="font-normal text-slate-400">(optional, recommended)</span></label><input type="password" value={f.webhookSecret} onChange={(e) => setF({ ...f, webhookSecret: e.target.value })} className={inp} placeholder="So a booking is still made if the patient closes the page after paying" autoComplete="new-password" /></div>
              </div>
              <p className="text-xs text-slate-500">In the Razorpay dashboard, add a webhook to <code className="break-all bg-slate-100 px-1 rounded">{s.webhookUrl}</code> for the events <b>payment.captured</b> and <b>order.paid</b>, and use the same secret here.</p>
            </div>
          )}
          {s.slug && <p className="text-xs text-slate-500">Your booking page: <a className="underline break-all text-sky-700" href={link} target="_blank" rel="noreferrer">{link}</a>. Put this link on your Google Business Profile as the &ldquo;Appointment link&rdquo; so searchers see a Book button.</p>}
          {err && <p className="text-red-600" role="alert">{err}</p>}{msg && <p className="text-emerald-700">{msg}</p>}
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-xl bg-slate-900 text-white font-semibold disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
    </section>
  );
}
