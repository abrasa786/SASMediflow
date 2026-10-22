"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";

export interface SField { key: string; label: string; type?: "text" | "date" | "number" | "textarea" | "tel" | "email"; readOnly?: boolean; wide?: boolean }
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50 disabled:text-slate-500";

/** A record page whose save goes through the app's own server route (because the rules for it live there). */
export default function SimpleRecord({ table, select, id, fields, title, subtitle, backHref, backLabel, buildRequest, endpoint, children }: {
  table: string; select?: string; id: string; fields: SField[]; title: (r: any) => string; subtitle?: (r: any) => string;
  backHref: string; backLabel: string; endpoint: string; buildRequest: (clinicId: string, row: any, form: Record<string, any>) => Record<string, unknown>;
  children?: (row: any) => ReactNode;
}) {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [row, setRow] = useState<any | null | undefined>(undefined);
  const [form, setForm] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async (cid: string) => {
    const { data } = await supabase.from(table).select(select ?? "*").eq("id", id).eq("clinic_id", cid).maybeSingle();
    if (!data) { setRow(null); return; }
    setRow(data); setForm(Object.fromEntries(fields.map((f) => [f.key, data[f.key] ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, select, id]);
  useEffect(() => { const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setClinicId(c); load(c); }, [router, load]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg(""); setBusy(true);
    try { await authFetch(endpoint, { body: buildRequest(clinicId, row, form) }); setMsg("Saved."); await load(clinicId); }
    catch (x: any) { setErr(x.message); }
    setBusy(false);
  }

  if (row === undefined) return <AppShell><div className="p-10 text-center text-slate-400 text-sm">Loading…</div></AppShell>;
  if (row === null) return <AppShell><div className="p-10 text-center"><p className="text-slate-600 mb-3">We couldn&apos;t find that record in this clinic.</p><Link href={backHref} className="text-sky-600 underline text-sm">← {backLabel}</Link></div></AppShell>;
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <Link href={backHref} className="text-sm text-slate-500 hover:text-sky-700">← {backLabel}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">{title(row)}</h1>
        {subtitle && <p className="text-slate-500 text-sm mt-1">{subtitle(row)}</p>}
        <form onSubmit={save} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mt-5 grid sm:grid-cols-2 gap-4">
          {fields.map((f) => (
            <div key={f.key} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}>
              <label htmlFor={`s-${f.key}`} className="text-xs font-medium text-slate-600 block mb-1">{f.label}</label>
              {f.type === "textarea"
                ? <textarea id={`s-${f.key}`} rows={3} disabled={f.readOnly} value={form[f.key] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} className={inp} />
                : <input id={`s-${f.key}`} type={f.type ?? "text"} disabled={f.readOnly} value={form[f.key] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} className={inp} />}
            </div>
          ))}
          {err && <p className="sm:col-span-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          {msg && <p className="sm:col-span-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</p>}
          <div className="sm:col-span-2 flex gap-2"><button disabled={busy} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : "Save changes"}</button>
            <Link href={backHref} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Close</Link></div>
        </form>
        {children?.(row)}
      </div>
    </AppShell>
  );
}
