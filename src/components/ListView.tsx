"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId, getUser } from "@/lib/auth";
import { supabase as sb } from "@/lib/supabase";
import { getClinicDoctors } from "@/lib/clinic";
import { toast } from "@/lib/toast";
import { LISTS, type ListConfig } from "@/lib/lists/config";

const supabase = sb as any;
const PAGE = 30;
const inp = "px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500";
const clean = (s: string) => s.replace(/[,()%\\]/g, " ").trim();
interface View { name: string; q: string; filters: Record<string, string>; cols: string[]; sort: string; asc: boolean }

/** One list screen for every table: search, filters, choose columns, sort by a column, and saved views. */
export default function ListView({ entity, refreshKey = 0 }: { entity: string; refreshKey?: number }) {
  const cfg: ListConfig | undefined = LISTS[entity];
  const router = useRouter();
  const [clinicId, setClinicId] = useState(""); const [userId, setUserId] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [cols, setCols] = useState<string[]>(() => cfg?.cols.filter((c) => c.defaultOn).map((c) => c.key) ?? []);
  const [sort, setSort] = useState(cfg?.order.col ?? ""); const [asc, setAsc] = useState(cfg?.order.asc ?? false);
  const [more, setMore] = useState(false); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");
  const [panel, setPanel] = useState<"" | "filters" | "cols">("");
  const [views, setViews] = useState<View[]>([]); const [viewName, setViewName] = useState("");

  useEffect(() => {
    const id = getActiveClinicId(); if (!id) { router.push("/login"); return; }
    setClinicId(id);
    getUser().then((u) => u && setUserId(u.id));
    getClinicDoctors(id).then((d: any[]) => setDoctors(d.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
  }, [router]);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  // saved views: kept in the database for this person; a copy in this browser is used if the table is not set up yet
  const lsKey = `mf_views_${clinicId}_${entity}`;
  useEffect(() => {
    if (!clinicId || !userId) return;
    supabase.from("list_views").select("name, config").eq("clinic_id", clinicId).eq("user_id", userId).eq("entity", entity).order("name").then((r: any) => {
      if (!r.error) { setViews((r.data ?? []).map((v: any) => ({ ...v.config, name: v.name }))); return; }
      try { setViews(JSON.parse(localStorage.getItem(lsKey) ?? "[]")); } catch { /* optional */ }
    });
  }, [clinicId, userId, entity, lsKey]);

  const load = useCallback(async (offset: number) => {
    if (!clinicId || !cfg) return;
    setLoading(true); setErr("");
    try {
      let query = supabase.from(cfg.table).select(cfg.select).eq("clinic_id", clinicId).order(sort || cfg.order.col, { ascending: asc }).range(offset, offset + PAGE - 1);
      for (const f of cfg.filters) {
        const v = filters[f.key]; if (!v) continue;
        if (f.kind === "from") query = query.gte(f.column, v); else if (f.kind === "to") query = query.lte(f.column, v + (f.column === "created_at" ? "T23:59:59" : ""));
        else query = query.eq(f.column, v === "true" ? true : v === "false" ? false : v);
      }
      if (term) {
        const like = `%${clean(term)}%`;
        const extra = cfg.extraSearch ? await cfg.extraSearch(supabase, clinicId, term) : [];
        query = query.or([...cfg.searchCols.map((c) => `${c}.ilike.${like}`), ...extra].join(","));
      }
      let { data, error } = await query;
      if (error && cfg.entity === "appointments" && /appt_no/.test(error.message)) {
        setErr("Run migration 029 to get appointment numbers (APT-00001). The list works without it.");
        let q2 = supabase.from(cfg.table).select(cfg.select.replace("appt_no, ", "")).eq("clinic_id", clinicId).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
        for (const f of cfg.filters) { const v = filters[f.key]; if (!v) continue; if (f.kind === "from") q2 = q2.gte(f.column, v); else if (f.kind === "to") q2 = q2.lte(f.column, v); else if (f.column !== "billing_status") q2 = q2.eq(f.column, v); }
        ({ data, error } = await q2);
      }
      if (error) throw error;
      let list: any[] = data ?? [];
      if (cfg.enrich) list = await cfg.enrich(supabase, clinicId, list);
      setRows((r) => (offset === 0 ? list : [...r, ...list])); setMore(list.length === PAGE);
    } catch (e: any) { setErr(e.message ?? "Could not load the list."); }
    setLoading(false);
  }, [clinicId, cfg, term, filters, sort, asc]);
  useEffect(() => { load(0); }, [load, refreshKey]);

  const visible = useMemo(() => (cfg ? cfg.cols.filter((c) => cols.includes(c.key)) : []), [cfg, cols]);
  const activeFilters = Object.values(filters).filter(Boolean).length;

  async function saveView() {
    const name = viewName.trim(); if (!name) return;
    const v: View = { name, q, filters, cols, sort, asc };
    const next = [...views.filter((x) => x.name !== name), v];
    const { name: _n, ...config } = v; void _n;
    const r = await supabase.from("list_views").upsert({ clinic_id: clinicId, user_id: userId, entity, name, config }, { onConflict: "clinic_id,user_id,entity,name" });
    if (r.error) { try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch { /* optional */ } }
    setViews(next); setViewName(""); toast(`View “${name}” saved`);
  }
  async function delView(name: string) {
    const next = views.filter((x) => x.name !== name); setViews(next);
    const r = await supabase.from("list_views").delete().eq("clinic_id", clinicId).eq("user_id", userId).eq("entity", entity).eq("name", name);
    if (r.error) { try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch { /* optional */ } }
  }
  const apply = (v: View) => { setQ(v.q); setFilters(v.filters); setCols(v.cols); setSort(v.sort); setAsc(v.asc); };
  const clear = () => { setQ(""); setFilters({}); };
  const sortBy = (col?: string) => { if (!col) return; if (sort === col) setAsc(!asc); else { setSort(col); setAsc(true); } };

  if (!cfg) return <AppShell><div className="p-6 text-slate-600">There is no list called “{entity}”.</div></AppShell>;
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h1 className="text-2xl font-bold text-slate-900">{cfg.title}</h1><p className="text-sm text-slate-500 mt-0.5">{cfg.subtitle}</p></div>
          <div className="flex gap-2">
            {entity === "appointments" && <Link href="/appointments" className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50">Day view</Link>}
            {cfg.newHref && <Link href={cfg.newHref} className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold">{cfg.newLabel}</Link>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${cfg.title.toLowerCase()}…`} aria-label="Search this list" className={`${inp} flex-1 min-w-[200px]`} />
          <button onClick={() => setPanel(panel === "filters" ? "" : "filters")} className={`${inp} font-medium`}>Filters{activeFilters ? ` (${activeFilters})` : ""}</button>
          <button onClick={() => setPanel(panel === "cols" ? "" : "cols")} className={`${inp} font-medium`}>Columns</button>
          <select aria-label="Saved views" value="" onChange={(e) => { const v = views.find((x) => x.name === e.target.value); if (v) apply(v); }} className={inp}>
            <option value="">Saved views{views.length ? ` (${views.length})` : ""}</option>{views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
          {(q || activeFilters > 0) && <button onClick={clear} className="px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 rounded-xl">Clear</button>}
        </div>

        {panel === "filters" && (
          <div className="mb-3 p-3 bg-white border border-slate-200 rounded-2xl grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cfg.filters.map((f) => (
              <label key={f.key} className="text-xs font-medium text-slate-600">{f.label}
                {f.kind === "from" || f.kind === "to"
                  ? <input type="date" value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} className={`${inp} w-full mt-1`} />
                  : <select value={filters[f.key] ?? ""} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} className={`${inp} w-full mt-1`}>
                      <option value="">Any</option>
                      {f.kind === "doctor" ? doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>) : f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>}
              </label>
            ))}
          </div>
        )}
        {panel === "cols" && (
          <div className="mb-3 p-3 bg-white border border-slate-200 rounded-2xl flex flex-wrap gap-x-5 gap-y-2">
            {cfg.cols.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => setCols(e.target.checked ? cfg.cols.filter((x) => x.key === c.key || cols.includes(x.key)).map((x) => x.key) : cols.filter((k) => k !== c.key))} /> {c.label}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          <input value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name this view to save it" aria-label="Name for saved view" className={`${inp} w-52`} />
          <button onClick={saveView} disabled={!viewName.trim()} className="px-3 py-2 rounded-xl border border-slate-200 bg-white font-medium hover:bg-slate-50 disabled:opacity-50">Save view</button>
          {views.map((v) => <span key={v.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 pl-3 pr-1.5 py-1 text-xs text-slate-700"><button onClick={() => apply(v)} className="hover:underline">{v.name}</button><button onClick={() => delView(v.name)} aria-label={`Delete view ${v.name}`} className="text-slate-400 hover:text-red-500 px-1">×</button></span>)}
        </div>
        {err && <p className="mb-3 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{err}</p>}

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              {visible.map((c) => (
                <th key={c.key} className="px-4 py-3 font-medium whitespace-nowrap" aria-sort={c.sort && sort === c.sort ? (asc ? "ascending" : "descending") : undefined}>
                  {c.sort ? <button onClick={() => sortBy(c.sort)} className="hover:text-slate-800">{c.label}{sort === c.sort ? (asc ? " ▲" : " ▼") : ""}</button> : c.label}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => cfg.href && router.push(cfg.href(r))} className={`border-b border-slate-50 hover:bg-sky-50/50 ${cfg.href ? "cursor-pointer" : ""}`}>
                  {visible.map((c) => <td key={c.key} className="px-4 py-3 text-slate-700 align-top">{c.render(r)}</td>)}
                </tr>
              ))}
              {!rows.length && !loading && <tr><td colSpan={Math.max(1, visible.length)} className="px-4 py-12 text-center text-slate-500">{q || activeFilters ? "Nothing matches. Try fewer filters." : "Nothing here yet."}</td></tr>}
            </tbody>
          </table>
          {loading && <p className="px-4 py-3 text-sm text-slate-400">Loading…</p>}
        </div>
        {more && !loading && <div className="text-center mt-4"><button onClick={() => load(rows.length)} className="px-5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50">Load more</button></div>}
      </div>
    </AppShell>
  );
}
