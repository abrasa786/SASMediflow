"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";

function Widget({ w }: { w: any }) {
  const r = w.result;
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm min-w-0">
      <h3 className="font-semibold text-slate-900 text-sm mb-3">{w.name}</h3>
      {w.error ? <p className="text-sm text-amber-700">{w.error}</p>
        : !r ? <p className="text-sm text-slate-400">No data</p>
        : r.kind === "number" ? <p className="text-3xl font-bold text-slate-900">{r.value ?? 0}</p>
        : r.kind === "grouped" ? (() => { const max = Math.max(1, ...r.rows.map((x: any) => Number(x.value) || 0)); return (
            <ul className="space-y-1.5">{r.rows.slice(0, 10).map((x: any) => (
              <li key={x.key} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate text-slate-700">{x.key}</span><span className="text-slate-500 shrink-0">{Math.round(Number(x.value) * 100) / 100}</span></div>
                <div className="h-1.5 rounded bg-slate-100 mt-0.5"><div className="h-1.5 rounded bg-sky-400" style={{ width: `${(Number(x.value) / max) * 100}%` }} /></div></li>))}</ul>); })()
        : <div className="overflow-x-auto"><table className="text-xs w-full"><thead><tr>{(r.columns ?? []).map((c: any) => <th key={c.api ?? c} className="text-left pr-3 pb-1 text-slate-500 font-medium">{c.label ?? c}</th>)}</tr></thead>
            <tbody>{(r.rows ?? []).slice(0, 8).map((row: any, i: number) => <tr key={i}>{(r.columns ?? []).map((c: any) => <td key={c.api ?? c} className="pr-3 py-0.5 text-slate-700">{String(row[c.api ?? c] ?? "")}</td>)}</tr>)}</tbody></table></div>}
    </div>
  );
}

/** One app's home screen: headline numbers, its dashboard, and its tabs. */
export default function AppHomePage() {
  const { app } = useParams<{ app: string }>();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setD(null); setErr("");
    authFetch(`/api/apps/home?clinicId=${cid}&app=${app}`).then(setD).catch((e) => setErr(e.message));
  }, [app, router]);

  const href = (t: any) => t.path || (t.kind === "object" && t.object ? `/builder/data?table=${t.object}` : `/apps/${app}`);
  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!d && !err && <p className="text-sm text-slate-400">Loading…</p>}
        {d && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900">{d.app.icon} {d.app.label}</h1>
              {d.app.description && <p className="text-slate-500 text-sm mt-1">{d.app.description}</p>}
            </div>
            {d.cards.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {d.cards.map((c: any) => {
                  const inner = (<><div className="text-xs text-slate-500">{c.label}</div><div className="text-2xl font-bold text-slate-900 mt-1">{c.value}</div>{c.hint && <div className="text-xs text-slate-400 mt-1 truncate">{c.hint}</div>}</>);
                  return c.href ? <Link key={c.label} href={c.href} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:border-sky-300">{inner}</Link> : <div key={c.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">{inner}</div>;
                })}
              </div>
            )}
            {d.widgets.length > 0 && <div className="grid md:grid-cols-2 gap-4 mb-6">{d.widgets.map((w: any, i: number) => <Widget key={i} w={w} />)}</div>}
            {!d.app.is_system && !d.widgets.length && <p className="text-sm text-slate-500 bg-white border border-slate-100 rounded-xl p-4 mb-6">No home dashboard yet. Ask the assistant: “Create a dashboard called {d.app.label} home with …”, then ask the AI Builder: “Use the {d.app.label} home dashboard as the home screen of {d.app.label}”.</p>}
            <h2 className="font-semibold text-slate-900 mb-3 text-sm">Tabs in this app</h2>
            <div className="flex flex-wrap gap-2">{d.tabs.filter((t: any) => t.label !== "Home").map((t: any) => <Link key={t.label} href={href(t)} className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-sky-300">{t.label}</Link>)}</div>
          </>
        )}
      </div>
    </AppShell>
  );
}
