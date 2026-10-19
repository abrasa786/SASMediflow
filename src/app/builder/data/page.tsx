"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import Modal from "@/components/Modal";
import BuilderTabs from "@/components/BuilderTabs";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getMyRoleInClinic } from "@/lib/clinic";
import { inputCls as inp } from "@/components/ui";

interface Field { api: string; label: string; type: string; required?: boolean; picklist_values?: string[]; lookup_object?: string }
interface Table { api_name: string; label: string; plural_label: string; icon?: string; access: { read: boolean; create: boolean; edit: boolean; delete: boolean; read_scope: string; edit_scope: string }; fields: Field[] }

const show = (v: any, f: Field, lookups: Record<string, Record<string, string>>) => {
  if (v == null || v === "") return "–";
  if (f.type === "boolean") return v ? "Yes" : "No";
  if (f.type === "currency") return "₹" + Number(v).toLocaleString("en-IN");
  if (f.type === "date") return new Date(v + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (f.type === "datetime") return new Date(v).toLocaleString("en-IN");
  if (f.type === "lookup") return lookups[f.lookup_object ?? ""]?.[v] ?? "…";
  return String(v);
};

export default function DataPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [cur, setCur] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [lookups, setLookups] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<{ id?: string; values: Record<string, any> } | null>(null);
  const [del, setDel] = useState<string | null>(null);

  const table = tables.find((t) => t.api_name === cur);

  const loadLookups = useCallback(async (cid: string, t: Table) => {
    const targets = Array.from(new Set(t.fields.filter((f) => f.type === "lookup" && f.lookup_object).map((f) => f.lookup_object!)));
    const out: Record<string, Record<string, string>> = {};
    await Promise.all(targets.map(async (o) => { try { const r = await authFetch("/api/builder/data", { body: { clinicId: cid, action: "list", object: o, limit: 200 } }); out[o] = Object.fromEntries(r.rows.map((x: any) => [x.id, x.name ?? "(unnamed)"])); } catch { out[o] = {}; } }));
    setLookups(out);
  }, []);

  const loadRows = useCallback(async (cid: string, t: string, search: string) => {
    setLoading(true); setErr("");
    try { const r = await authFetch("/api/builder/data", { body: { clinicId: cid, action: "list", object: t, search } }); setRows(r.rows); setTotal(r.total); }
    catch (e: any) { setErr(e.message); setRows([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid);
    getMyRoleInClinic(cid).then((r) => setIsAdmin(r === "admin"));
    authFetch(`/api/builder/data?clinicId=${cid}`).then((r) => { setTables(r.tables); if (r.tables[0]) setCur(r.tables[0].api_name); else setLoading(false); }).catch((e) => { setErr(e.message); setLoading(false); });
  }, [router]);
  useEffect(() => { if (clinicId && cur) { loadRows(clinicId, cur, q); const t = tables.find((x) => x.api_name === cur); if (t) loadLookups(clinicId, t); } }, [cur]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!edit || !table) return;
    setErr("");
    try {
      const values: Record<string, any> = {};
      for (const f of table.fields) if (f.api in edit.values) values[f.api] = edit.values[f.api];
      await authFetch("/api/builder/data", { body: { clinicId, action: "save", object: cur, id: edit.id, values } });
      setEdit(null); loadRows(clinicId!, cur, q);
    } catch (e: any) { setErr(e.message); }
  }
  async function remove(id: string) {
    setErr("");
    try { await authFetch("/api/builder/data", { body: { clinicId, action: "delete", object: cur, id } }); setDel(null); loadRows(clinicId!, cur, q); } catch (e: any) { setErr(e.message); setDel(null); }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Builder</h1>
        <p className="text-sm text-slate-500 mb-4">Records in the tables you built with the AI Builder.</p>
        <BuilderTabs isAdmin={isAdmin} />
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {tables.length === 0 && !loading ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
            <p className="text-3xl mb-2">🗂️</p><p className="font-semibold text-slate-800">No tables to show yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{isAdmin ? "Ask the AI Builder to create a table, for example “Create a Laboratory app with Lab Test”. Then give staff access under Access control." : "Your admin has not given you access to any custom tables yet."}</p>
            {isAdmin && <a href="/builder" className="inline-block mt-4 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Open the AI Builder</a>}
          </div>
        ) : (<>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex gap-1.5 flex-wrap">{tables.map((t) => <button key={t.api_name} onClick={() => { setCur(t.api_name); setQ(""); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${cur === t.api_name ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{t.icon ?? "📄"} {t.plural_label}</button>)}</div>
            <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); loadRows(clinicId!, cur, q); }}>
              <input className={inp + " w-52"} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
              {table?.access.create && <button type="button" onClick={() => setEdit({ values: {} })} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold whitespace-nowrap">+ New {table.label.toLowerCase()}</button>}
            </form>
          </div>
          {table && table.access.read_scope === "own" && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">You can see only the records you created.</p>}
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            {loading ? <p className="p-6 text-sm text-slate-400">Loading…</p> : rows.length === 0 ? <p className="p-8 text-sm text-slate-400 text-center">No records yet.</p> :
              <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-slate-500 bg-slate-50">{table!.fields.slice(0, 6).map((f) => <th key={f.api} className="px-4 py-2 font-medium">{f.label}</th>)}<th /></tr></thead>
                <tbody className="divide-y divide-slate-100">{rows.map((r) => (
                  <tr key={r.id}>{table!.fields.slice(0, 6).map((f) => <td key={f.api} className="px-4 py-2.5 text-slate-700">{show(r[f.api], f, lookups)}</td>)}
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {table!.access.edit && <button className="text-xs text-sky-700 hover:underline mr-3" onClick={() => setEdit({ id: r.id, values: Object.fromEntries(table!.fields.map((f) => [f.api, r[f.api] ?? ""])) })}>Edit</button>}
                      {table!.access.delete && (del === r.id ? <span className="text-xs">Delete? <button className="text-red-600 font-semibold" onClick={() => remove(r.id)}>Yes</button> · <button onClick={() => setDel(null)}>No</button></span> : <button className="text-xs text-red-600 hover:underline" onClick={() => setDel(r.id)}>Delete</button>)}
                    </td></tr>))}</tbody></table>}
          </div>
          <p className="text-xs text-slate-400 mt-2">{total} record{total === 1 ? "" : "s"}</p>
        </>)}
      </div>

      {edit && table && (
        <Modal title={`${edit.id ? "Edit" : "New"} ${table.label.toLowerCase()}`} onClose={() => setEdit(null)}>
          <div className="space-y-3">{table.fields.map((f) => (
            <label key={f.api} className="block text-xs font-medium text-slate-600">{f.label}{f.required ? " *" : ""}
              {f.type === "picklist" ? <select className={inp + " mt-1"} value={edit.values[f.api] ?? ""} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.api]: e.target.value } })}><option value="">–</option>{(f.picklist_values ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                : f.type === "boolean" ? <input type="checkbox" className="ml-2" checked={!!edit.values[f.api]} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.api]: e.target.checked } })} />
                : f.type === "lookup" ? <select className={inp + " mt-1"} value={edit.values[f.api] ?? ""} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.api]: e.target.value } })}><option value="">–</option>{Object.entries(lookups[f.lookup_object ?? ""] ?? {}).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
                : f.type === "long_text" ? <textarea className={inp + " mt-1"} rows={3} value={edit.values[f.api] ?? ""} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.api]: e.target.value } })} />
                : <input className={inp + " mt-1"} type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : f.type === "number" || f.type === "currency" ? "number" : f.type === "email" ? "email" : "text"} step={f.type === "currency" ? "0.01" : undefined} value={edit.values[f.api] ?? ""} onChange={(e) => setEdit({ ...edit, values: { ...edit.values, [f.api]: e.target.value } })} />}
            </label>))}</div>
          {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-3" role="alert">{err}</p>}
          <div className="flex justify-end gap-2 mt-4"><button onClick={() => setEdit(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={save} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Save</button></div>
        </Modal>
      )}
    </AppShell>
  );
}
