"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { supabase } from "@/lib/supabase";

/**
 * My profile. The sign-in email is read-only everywhere else in the app.
 * It changes only here, and only after the new address proves it is yours with a one-time code.
 * Supabase sends the code(s): to the new address and, when "Secure email change" is on in Supabase, to the old one as well.
 */
export default function ProfilePage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [step, setStep] = useState<"view" | "code" | "done">("view");
  const [next, setNext] = useState("");
  const [codeNew, setCodeNew] = useState("");
  const [codeOld, setCodeOld] = useState("");
  const [needOld, setNeedOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }: { data: { user: any } }) => {
      setEmail(data.user?.email ?? "");
      setName(data.user?.user_metadata?.name ?? "");
    });
  }, []);

  async function request(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const n = next.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(n)) return setErr("Enter a valid email address.");
    if (n === email.toLowerCase()) return setErr("That is already your email.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: n });
    setBusy(false);
    if (error) return setErr(error.message);
    setNext(n); setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    if (!/^\d{6,8}$/.test(codeNew.trim())) return setErr("Enter the code from the email sent to your new address.");
    setBusy(true);
    const r1 = await supabase.auth.verifyOtp({ email: next, token: codeNew.trim(), type: "email_change" });
    if (r1.error) { setBusy(false); return setErr("That code is wrong or has expired. Check it, or send a new one."); }
    // With "Secure email change" on, Supabase also needs the code sent to the old address.
    const { data } = await supabase.auth.getUser();
    if (data.user?.new_email) {
      if (!codeOld.trim()) { setBusy(false); setNeedOld(true); return setErr("One more step: enter the code sent to your old email."); }
      const r2 = await supabase.auth.verifyOtp({ email, token: codeOld.trim(), type: "email_change" });
      if (r2.error) { setBusy(false); return setErr("The code from your old email is wrong or has expired."); }
    }
    const fresh = await supabase.auth.getUser();
    setBusy(false);
    setEmail(fresh.data.user?.email ?? next);
    setStep("done");
  }

  const input = "w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500";
  return (
    <AppShell>
      <div className="p-4 sm:p-8 max-w-xl">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">My profile</h1>
        <p className="text-sm text-slate-500 mb-6">Your sign-in email can only be changed here, with a one-time code.</p>

        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Name</p>
          <p className="text-slate-900 mb-4">{name || "—"}</p>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Sign-in email</p>
          <p className="text-slate-900 break-all">{email || "—"}</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          {step === "view" && (
            <form onSubmit={request} className="space-y-3">
              <p className="font-semibold text-slate-900">Change email</p>
              <input type="email" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New email address" className={input} autoComplete="email" />
              {err && <p className="text-sm text-red-600">{err}</p>}
              <button disabled={busy} className="bg-sky-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60">{busy ? "Sending…" : "Send code"}</button>
            </form>
          )}
          {step === "code" && (
            <form onSubmit={verify} className="space-y-3">
              <p className="font-semibold text-slate-900">Enter the code</p>
              <p className="text-sm text-slate-500">We emailed a code to <b>{next}</b>.</p>
              <input inputMode="numeric" value={codeNew} onChange={(e) => setCodeNew(e.target.value)} placeholder="Code from the new email" className={input} autoComplete="one-time-code" />
              {needOld && <input inputMode="numeric" value={codeOld} onChange={(e) => setCodeOld(e.target.value)} placeholder={`Code from your old email (${email})`} className={input} />}
              {err && <p className="text-sm text-red-600">{err}</p>}
              <div className="flex gap-2">
                <button disabled={busy} className="bg-sky-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60">{busy ? "Checking…" : "Confirm change"}</button>
                <button type="button" onClick={() => { setStep("view"); setErr(""); setCodeNew(""); setCodeOld(""); setNeedOld(false); }} className="px-4 py-2.5 rounded-lg text-sm border border-slate-300 text-slate-600">Cancel</button>
              </div>
            </form>
          )}
          {step === "done" && (
            <div>
              <p className="font-semibold text-emerald-700 mb-1">Email changed</p>
              <p className="text-sm text-slate-600">Use <b>{email}</b> the next time you sign in.</p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
