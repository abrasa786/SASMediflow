"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { setNewPassword } from "@/lib/auth";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // The emailed link signs the person in temporarily; wait for that session.
    const { data: sub } = supabase.auth.onAuthStateChange((_ev: string, session: unknown) => { if (session) setReady(true); });
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    const { error: err } = await setNewPassword(pw);
    setBusy(false);
    if (err) return setError(err.message);
    setDone(true);
    setTimeout(() => router.push("/login"), 1800);
  }

  const input = "w-full px-4 py-3 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500";
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-2xl font-bold text-slate-900">Choose a new password</h1>
        {done ? (
          <p className="mt-4 text-emerald-700">✓ Password updated. Taking you to sign in…</p>
        ) : !ready ? (
          <p className="mt-4 text-sm text-slate-600">Open this page from the link in your reset email. If it has expired, <a className="text-sky-700 underline" href="/login">request a new one</a>.</p>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <input type="password" autoComplete="new-password" className={input} placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="New password" />
            <input type="password" autoComplete="new-password" className={input} placeholder="Confirm new password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-label="Confirm new password" />
            {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">{error}</div>}
            <button disabled={busy} className="w-full py-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-semibold disabled:opacity-60">{busy ? "Saving…" : "Update password"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
