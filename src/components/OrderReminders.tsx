"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const nice = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Things a doctor asked to have ready for a patient's next visit (a zirconium crown, aligners…) that are still open. They clear by themselves when the order is received. */
export default function OrderReminders({ clinicId }: { clinicId: string }) {
  const [rows, setRows] = useState<{ id: string; title: string; due_date: string | null; kind: string; description: string | null }[]>([]);
  useEffect(() => {
    if (!clinicId) return;
    supabase.from("clinic_tasks").select("id, title, due_date, kind, description").eq("clinic_id", clinicId).in("kind", ["order_material", "check_material"]).neq("status", "done").order("due_date").limit(30)
      .then(({ data }: any) => setRows(data ?? []));        // before migration 023 this simply returns nothing
  }, [clinicId]);
  if (rows.length === 0) return null;
  return (
    <section className="mb-5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3" aria-label="To order for upcoming patients">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-sky-900">To order for upcoming patients ({rows.length})</p>
        <Link href="/purchasing" className="text-xs text-sky-800 underline">Go to purchase orders</Link>
      </div>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => {
          const late = !!r.due_date && r.due_date < today();
          return (
            <li key={r.id} className="text-sm text-sky-950 flex flex-wrap items-baseline gap-x-2">
              <Link href="/tasks" className="font-medium hover:underline">{r.title}</Link>
              {r.due_date && <span className={`text-xs ${late ? "text-red-700 font-semibold" : "text-sky-700"}`}>{late ? "overdue, was due " : "by "}{nice(r.due_date)}</span>}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-sky-800/80">Place the order, then close it in Purchasing when it arrives. These reminders clear on their own.</p>
    </section>
  );
}
