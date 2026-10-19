"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import BuilderTabs from "@/components/BuilderTabs";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getMyRoleInClinic } from "@/lib/clinic";

const BADGE: Record<string, string> = { done: "bg-emerald-100 text-emerald-700", sent: "bg-emerald-100 text-emerald-700", failed: "bg-red-100 text-red-700", skipped: "bg-slate-100 text-slate-600" };

/** Read-only view of automation flows and what they did. Flows are created and paused by chatting with the AI Builder. */
export default function FlowsPage() {
  const router = useRouter();
  const [role, setRole] = useState<string | null>(null);
  const [data, setData] = useState<{ flows: any[]; runs: any[] } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    getMyRoleInClinic(cid).then(setRole);
    authFetch(`/api/flows?clinicId=${cid}`).then(setData).catch((e) => setErr(e.message));
  }, [router]);

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Builder</h1>
        <p className="text-slate-500 text-sm mb-4">Automation flows run on their own when something happens in the clinic.</p>
        <BuilderTabs isAdmin={role === "admin"} />
        {err && <p className="text-sm text-red-600 mb-4">{err}</p>}
        {data && (
          <>
            <section className="mb-8">
              <h2 className="font-semibold text-slate-900 mb-3">Flows</h2>
              {data.flows.length === 0 ? (
                <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-5">No flows yet. In <Link href="/builder" className="text-sky-600 underline">Build with AI</Link> say, for example, “When an appointment is booked, send the patient a WhatsApp confirmation” or “Every day, remind patients a day before their appointment”.</p>
              ) : (
                <ul className="space-y-2">
                  {data.flows.map((f) => (
                    <li key={f.id} className="bg-white border border-slate-100 rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-900">{f.name}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${f.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{f.is_active ? "On" : "Paused"}</span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{f.summary}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="font-semibold text-slate-900 mb-3">Recent activity</h2>
              {data.runs.length === 0 ? <p className="text-sm text-slate-500">Nothing has run yet.</p> : (
                <div className="bg-white border border-slate-100 rounded-xl divide-y divide-slate-50">
                  {data.runs.map((r) => (
                    <div key={r.id} className="px-4 py-3 text-sm flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-slate-800">{r.flow_name}</p><p className="text-xs text-slate-400">{new Date(r.created_at).toLocaleString("en-IN")} · {String(r.event).replace(/_/g, " ")}</p></div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${BADGE[r.status] ?? "bg-slate-100 text-slate-600"}`}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
