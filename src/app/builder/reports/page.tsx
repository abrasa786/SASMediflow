"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import Modal from "@/components/Modal";
import BuilderTabs from "@/components/BuilderTabs";
import ReportView from "@/components/ReportView";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { inputCls as inp } from "@/components/ui";

const OPS: [string, string][] = [["eq", "is"], ["neq", "is not"], ["contains", "contains"], ["gt", "greater than"], ["gte", "at least"], ["lt", "less than"], ["lte", "at most"], ["empty", "is empty"], ["notempty", "is filled"]];
const AGG: [string, string][] = [["count", "Count"], ["sum", "Total"], ["avg", "Average"], ["min", "Lowest"], ["max", "Highest"]];
type Mode = "rows" | "grouped" | "number";
interface Draft { id?: string; name: string; description: string; object: string; mode: Mode; columns: string[]; filters: { field: string; op: string; value: string }[]; group_by: string; bucket: string; aggregate: string; agg_field: string; chart: string }

const toSpec = (d: Draft) => ({ object: d.object, kind: d.mode === "number" ? "number" : undefined, columns: d.mode === "rows" ? d.columns : [], filters: d.filters.filter((f) => f.field), group_by: d.mode === "grouped" ? d.group_by : undefined, bucket: d.bucket || undefined, aggregate: d.aggregate, agg_field: d.aggregate !== "count" ? d.agg_field : undefined });
const fromRep = (r: any): Draft => ({ id: r.id, name: r.name, description: r.description ?? "", object: r.spec.object, mode: r.spec.group_by ? "grouped" : r.spec.kind === "number" ? "number" : "rows", columns: r.spec.columns ?? [], filters: (r.spec.filters ?? []).map((f: any) => ({ field: f.field, op: f.op, value: f.value ?? "" })), group_by: r.spec.group_by ?? "", bucket: r.spec.bucket ?? "", aggregate: r.spec.aggregate ?? "count", agg_field: r.spec.agg_field ?? "", chart: r.chart });

export default function ReportsPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState<{ kind: "dash" | "report"; id: string } | null>(null);
  const [dash, setDash] = useState<any>(null);
  const [repRes, setRepRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const [rep, setRep] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [db, setDb] = useState<{ id?: string; name: string; description: string; widgets: { report_id: string; width: string }[] } | null>(null);

  const load = useCallback(async (cid: string) => { try { setD(await authFetch(`/api/builder/reports?clinicId=${cid}`)); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => { const cid = getActiveClinicId(); if (!cid) { router.push("/login"); return; } setClinicId(cid); load(cid); }, [router, load]);

  useEffect(() => {
    if (!view || !clinicId || !d) return; setErr(""); setDash(null); setRepRes(null);
    if (view.kind === "dash") authFetch("/api/builder/reports", { body: { clinicId, action: "run_dashboard", id: view.id } }).then(setDash).catch((e) => setErr(e.message));
    else { const r = d.reports.find((x: any) => x.id === view.id); if (r) authFetch("/api/builder/reports", { body: { clinicId, action: "run", spec: r.spec } }).then(setRepRes).catch((e) => setErr(e.message)); }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const tbl = (o: string) => d?.tables.find((t: any) => t.api_name === o);
  const newRep = (): Draft => ({ name: "", description: "", object: d.tables[0]?.api_name ?? "", mode: "grouped", columns: [], filters: [], group_by: "", bucket: "", aggregate: "count", agg_field: "", chart: "bar" });

  async function runPreview() { if (!rep) return; setErr(""); setPreview(null); try { setPreview(await authFetch("/api/builder/reports", { body: { clinicId, action: "run", spec: toSpec(rep) } })); } catch (e: any) { setErr(e.message); } }
  async function saveRep() {
    if (!rep) return; setErr("");
    try { await authFetch("/api/builder/reports", { body: { clinicId, action: "save_report", id: rep.id, name: rep.name, description: rep.description, spec: toSpec(rep), chart: rep.mode === "number" ? "number" : rep.mode === "rows" ? "table" : rep.chart } }); setRep(null); setPreview(null); load(clinicId!); } catch (e: any) { setErr(e.message); }
  }
  async function saveDb() {
    if (!db) return; setErr("");
    try { await authFetch("/api/builder/reports", { body: { clinicId, action: "save_dashboard", id: db.id, name: db.name, description: db.description, widgets: db.widgets } }); setDb(null); load(clinicId!); } catch (e: any) { setErr(e.message); }
  }
  async function del(kind: "report" | "dashboard", id: string) { try { await authFetch("/api/builder/reports", { body: { clinicId, action: kind === "report" ? "delete_report" : "delete_dashboard", id } }); setView(null); setRep(null); setDb(null); load(clinicId!); } catch (e: any) { setErr(e.message); } }

  const rt = rep && tbl(rep.object);
  const numFields = rt?.fields.filter((f: any) => f.type === "number" || f.type === "currency") ?? [];

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Builder</h1>
        <p className="text-sm text-slate-500 mb-4">Saved reports and dashboards over your tables and the built-in appointments, invoices, patients and stock.</p>
        <BuilderTabs isAdmin={!!d?.canEdit} />
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {!d ? <p className="text-sm text-slate-400">Loading…</p> : (
          <div className="grid lg:grid-cols-[300px_1fr] gap-6">
            <aside className="space-y-5">
              <section><div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-sm text-slate-900">Dashboards</h2>{d.canEdit && <button onClick={() => setDb({ name: "", description: "", widgets: [] })} className="text-xs text-sky-700 hover:underline">+ New</button>}</div>
                {d.dashboards.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : d.dashboards.map((x: any) => <button key={x.id} onClick={() => setView({ kind: "dash", id: x.id })} className={`w-full text-left rounded-lg px-3 py-2 text-sm mb-1 ${view?.id === x.id ? "bg-sky-50 text-sky-800" : "hover:bg-slate-100"}`}>📊 {x.name}<span className="text-xs text-slate-400"> · {x.widgets.length}</span></button>)}</section>
              <section><div className="flex items-center justify-between mb-2"><h2 className="font-semibold text-sm text-slate-900">Reports</h2>{d.canEdit && <button onClick={() => { setRep(newRep()); setPreview(null); }} className="text-xs text-sky-700 hover:underline">+ New</button>}</div>
                {d.reports.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : d.reports.map((x: any) => <button key={x.id} onClick={() => setView({ kind: "report", id: x.id })} className={`w-full text-left rounded-lg px-3 py-2 text-sm mb-1 ${view?.id === x.id ? "bg-sky-50 text-sky-800" : "hover:bg-slate-100"}`}>📄 {x.name}</button>)}</section>
              {!d.canEdit && <p className="text-xs text-slate-400">Your admin creates reports. You can open any of them; you only see data you have access to.</p>}
            </aside>

            <div className="min-w-0">
              {!view && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">{d.reports.length || d.dashboards.length ? "Choose a dashboard or report." : d.canEdit ? "Create your first report, then put reports together on a dashboard." : "Nothing has been shared yet."}</div>}
              {view?.kind === "report" && (() => { const r = d.reports.find((x: any) => x.id === view.id); return r && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-3 mb-3"><div><h2 className="font-bold text-slate-900">{r.name}</h2>{r.description && <p className="text-sm text-slate-500">{r.description}</p>}</div>
                  {d.canEdit && <button onClick={() => { setRep(fromRep(r)); setPreview(null); }} className="text-sm text-sky-700 hover:underline">Edit</button>}</div>
                  {repRes ? <ReportView result={repRes} chart={r.chart} /> : <p className="text-sm text-slate-400">Running…</p>}</div>); })()}
              {view?.kind === "dash" && (dash ? (
                <div><div className="flex items-start justify-between mb-3"><div><h2 className="text-lg font-bold text-slate-900">{dash.dashboard.name}</h2>{dash.dashboard.description && <p className="text-sm text-slate-500">{dash.dashboard.description}</p>}</div>
                  {d.canEdit && <button onClick={() => { const x = d.dashboards.find((y: any) => y.id === view.id); setDb({ id: x.id, name: x.name, description: x.description ?? "", widgets: x.widgets }); }} className="text-sm text-sky-700 hover:underline">Edit</button>}</div>
                  {dash.widgets.length === 0 ? <p className="text-sm text-slate-400">This dashboard has no reports yet.</p> :
                    <div className="grid md:grid-cols-2 gap-4">{dash.widgets.map((w: any, i: number) => (
                      <div key={i} className={`bg-white rounded-2xl border border-slate-200 p-4 min-w-0 ${w.width === "full" ? "md:col-span-2" : ""}`}><h3 className="font-semibold text-sm text-slate-800 mb-2">{w.name ?? "Report"}</h3>
                        {w.error ? <p className="text-sm text-amber-700">{w.error}</p> : <ReportView result={w.result} chart={w.chart} />}</div>))}</div>}</div>
              ) : <p className="text-sm text-slate-400">Loading…</p>)}
            </div>
          </div>)}
      </div>

      {rep && d && (
        <Modal title={rep.id ? "Edit report" : "New report"} onClose={() => setRep(null)} wide>
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">Name<input className={inp + " mt-1"} value={rep.name} onChange={(e) => setRep({ ...rep, name: e.target.value })} placeholder="e.g. Appointments by doctor" /></label>
              <label className="text-xs font-medium text-slate-600">Table<select className={inp + " mt-1"} value={rep.object} onChange={(e) => setRep({ ...rep, object: e.target.value, columns: [], filters: [], group_by: "", agg_field: "" })}>{d.tables.map((t: any) => <option key={t.api_name} value={t.api_name}>{t.label}</option>)}</select></label>
            </div>
            <div className="flex gap-2 text-sm">{([["grouped", "Breakdown"], ["number", "Single number"], ["rows", "List of records"]] as [Mode, string][]).map(([m, l]) => <button key={m} onClick={() => setRep({ ...rep, mode: m })} className={`px-3 py-1.5 rounded-lg ${rep.mode === m ? "bg-slate-900 text-white" : "border border-slate-200"}`}>{l}</button>)}</div>
            {rep.mode === "grouped" && <div className="grid sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-slate-600">Group by<select className={inp + " mt-1"} value={rep.group_by} onChange={(e) => setRep({ ...rep, group_by: e.target.value })}><option value="">Choose…</option>{rt?.fields.map((f: any) => <option key={f.api} value={f.api}>{f.label}</option>)}</select></label>
              {["date", "datetime"].includes(rt?.fields.find((f: any) => f.api === rep.group_by)?.type) && <label className="text-xs font-medium text-slate-600">By<select className={inp + " mt-1"} value={rep.bucket} onChange={(e) => setRep({ ...rep, bucket: e.target.value })}><option value="">Exact value</option><option value="month">Month</option><option value="day">Day</option></select></label>}
              <label className="text-xs font-medium text-slate-600">Show as<select className={inp + " mt-1"} value={rep.chart} onChange={(e) => setRep({ ...rep, chart: e.target.value })}><option value="bar">Bars</option><option value="pie">Pie</option><option value="table">Table</option></select></label></div>}
            {rep.mode !== "rows" && <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">Calculate<select className={inp + " mt-1"} value={rep.aggregate} onChange={(e) => setRep({ ...rep, aggregate: e.target.value })}>{AGG.map(([v, l]) => <option key={v} value={v} disabled={v !== "count" && numFields.length === 0}>{l}</option>)}</select></label>
              {rep.aggregate !== "count" && <label className="text-xs font-medium text-slate-600">Of<select className={inp + " mt-1"} value={rep.agg_field} onChange={(e) => setRep({ ...rep, agg_field: e.target.value })}><option value="">Choose…</option>{numFields.map((f: any) => <option key={f.api} value={f.api}>{f.label}</option>)}</select></label>}</div>}
            {rep.mode === "rows" && <div><p className="text-xs font-medium text-slate-600 mb-1">Columns (leave empty for the first six)</p><div className="flex flex-wrap gap-1.5">{rt?.fields.map((f: any) => <button key={f.api} onClick={() => setRep({ ...rep, columns: rep.columns.includes(f.api) ? rep.columns.filter((c) => c !== f.api) : [...rep.columns, f.api] })} className={`px-2.5 py-1 rounded-full text-xs ${rep.columns.includes(f.api) ? "bg-sky-600 text-white" : "border border-slate-200"}`}>{f.label}</button>)}</div></div>}
            <div><div className="flex items-center justify-between"><p className="text-xs font-medium text-slate-600">Only include records where</p><button onClick={() => setRep({ ...rep, filters: [...rep.filters, { field: rt?.fields[0]?.api ?? "", op: "eq", value: "" }] })} className="text-xs text-sky-700 hover:underline">+ Add condition</button></div>
              {rep.filters.map((f, i) => <div key={i} className="grid grid-cols-[1fr_1fr_1fr_24px] gap-2 mt-2">
                <select className={inp} value={f.field} onChange={(e) => setRep({ ...rep, filters: rep.filters.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}>{rt?.fields.map((x: any) => <option key={x.api} value={x.api}>{x.label}</option>)}</select>
                <select className={inp} value={f.op} onChange={(e) => setRep({ ...rep, filters: rep.filters.map((x, j) => j === i ? { ...x, op: e.target.value } : x) })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <input className={inp} disabled={f.op === "empty" || f.op === "notempty"} value={f.value} onChange={(e) => setRep({ ...rep, filters: rep.filters.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} aria-label="Value" />
                <button onClick={() => setRep({ ...rep, filters: rep.filters.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-red-600" aria-label="Remove condition">×</button></div>)}</div>
            <div className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between mb-2"><p className="text-xs font-semibold uppercase text-slate-500">Preview</p><button onClick={runPreview} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Run</button></div>{preview ? <ReportView result={preview} chart={rep.mode === "rows" ? "table" : rep.chart} /> : <p className="text-sm text-slate-400">Press Run to see it.</p>}</div>
            {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
            <div className="flex justify-between"><div>{rep.id && <button onClick={() => del("report", rep.id!)} className="text-sm text-red-600 hover:underline">Delete report</button>}</div><div className="flex gap-2"><button onClick={() => setRep(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={saveRep} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Save report</button></div></div>
          </div>
        </Modal>)}

      {db && d && (
        <Modal title={db.id ? "Edit dashboard" : "New dashboard"} onClose={() => setDb(null)}>
          <div className="space-y-3">
            <label className="text-xs font-medium text-slate-600 block">Name<input className={inp + " mt-1"} value={db.name} onChange={(e) => setDb({ ...db, name: e.target.value })} placeholder="e.g. Front desk overview" /></label>
            <div><p className="text-xs font-medium text-slate-600 mb-1">Reports on this dashboard</p>
              {d.reports.length === 0 ? <p className="text-sm text-slate-400">Create a report first.</p> : d.reports.map((r: any) => { const w = db.widgets.find((x) => x.report_id === r.id); return (
                <div key={r.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" id={`w-${r.id}`} checked={!!w} onChange={(e) => setDb({ ...db, widgets: e.target.checked ? [...db.widgets, { report_id: r.id, width: "half" }] : db.widgets.filter((x) => x.report_id !== r.id) })} />
                  <label htmlFor={`w-${r.id}`} className="flex-1 text-sm">{r.name}</label>
                  {w && <select className="text-xs border border-slate-200 rounded-lg px-2 py-1" value={w.width} onChange={(e) => setDb({ ...db, widgets: db.widgets.map((x) => x.report_id === r.id ? { ...x, width: e.target.value } : x) })}><option value="half">Half width</option><option value="full">Full width</option></select>}</div>); })}</div>
            {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
            <div className="flex justify-between"><div>{db.id && <button onClick={() => del("dashboard", db.id!)} className="text-sm text-red-600 hover:underline">Delete</button>}</div><div className="flex gap-2"><button onClick={() => setDb(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={saveDb} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Save</button></div></div>
          </div>
        </Modal>)}
    </AppShell>
  );
}
