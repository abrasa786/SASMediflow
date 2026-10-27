"use client";

import { useEffect } from "react";

/** Any unexpected crash on a page lands here: a plain message and a way forward, never a blank screen. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
        <p className="text-3xl" aria-hidden>⚠️</p>
        <h1 className="mt-2 text-lg font-bold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-600">Your data is safe. Try again, or go back to Home.</p>
        {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button onClick={reset} className="px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold">Try again</button>
          <a href="/dashboard" className="px-4 py-3 rounded-xl border border-slate-300 text-slate-800 font-medium">Go to Home</a>
        </div>
      </div>
    </main>
  );
}
