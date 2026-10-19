"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSetupStatus } from "@/lib/setup";

/** Small progress card on the dashboard until the clinic has finished its first-run setup. */
export default function SetupBanner({ clinicId }: { clinicId: string }) {
  const [st, setSt] = useState<{ done: number; total: number; next?: { title: string; href: string }; dismissed: boolean } | null>(null);
  useEffect(() => {
    getSetupStatus(clinicId).then(({ items, dismissed }) => {
      const required = items.filter((i) => !i.optional);
      const next = required.find((i) => !i.done);
      setSt({ done: required.filter((i) => i.done).length, total: required.length, next, dismissed });
    }).catch(() => {});
  }, [clinicId]);
  if (!st || st.dismissed || !st.next) return null;
  const pct = Math.round((st.done / st.total) * 100);
  return (
    <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[220px]">
        <p className="font-semibold text-slate-900">Finish setting up your clinic</p>
        <p className="text-sm text-slate-600 mt-0.5">Next: <b>{st.next.title}</b></p>
        <div className="mt-2.5 h-2 rounded-full bg-sky-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-sky-600 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-1">{st.done} of {st.total} essential steps done</p>
      </div>
      <Link href="/setup" className="px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">Open checklist →</Link>
    </div>
  );
}
