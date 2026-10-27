import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-sm w-full bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
        <p className="text-3xl" aria-hidden>🔎</p>
        <h1 className="mt-2 text-lg font-bold text-slate-900">We couldn&apos;t find that page</h1>
        <p className="mt-1 text-sm text-slate-600">The link may be old or the record was deleted.</p>
        <Link href="/dashboard" className="mt-5 block px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-semibold">Go to Home</Link>
      </div>
    </main>
  );
}
