"use client";

import { toast } from "@/lib/toast";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CustomFields from "@/components/CustomFields";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export interface Field {
  key: string; label: string; type?: "text" | "textarea" | "number" | "date" | "select" | "email" | "tel";
  options?: { value: string; label: string }[]; readOnly?: boolean; wide?: boolean; help?: string; required?: boolean; min?: number; max?: number;
}

const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50 disabled:text-slate-500";

/**
 * A record's own page: every field in one place, editable, with Save. Used for patients, stock, tasks and the like.
 * It reads and writes the one row of `table` that belongs to the signed-in clinic (the database's row-level rules still apply).
 */
const ENTITY: Record<string, string> = { clinic_patients: "patients", appointments: "appointments", invoices: "invoices", stock_items: "stock", clinic_tasks: "tasks", doctors: "doctors" };

export default function RecordForm({ table, id, fields, title, subtitle, backHref, backLabel, canEdit = true, children, clean }: {
  table: string; id: string; fields: Field[]; title: (row: any) => string; subtitle?: (row: any) => string | null;
  backHref: string; backLabel: string; canEdit?: boolean; children?: (row: any, reload: () => void) => ReactNode;
  clean?: (patch: Record<string, any>) => Record<string, any> | string;
}) {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [row, setRow] = useState<any | null | undefined>(undefined);
  const [form, setForm] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async (cid: string) => {
    const { data, error } = await supabase.from(table).select("*").eq("id", id).eq("clinic_id", cid).maybeSingle();
    if (error || !data) { setRow(null); return; }
    setRow(data); setForm(Object.fromEntries(fields.map((f) => [f.key, data[f.key] ?? ""])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, id]);

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid); load(cid);
  }, [router, load]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    let patch: Record<string, any> = {};
    for (const f of fields) {
      if (f.readOnly) continue;
      let v: any = form[f.key];
      if (f.type === "number") v = v === "" || v == null ? null : Number(v);
      else if (typeof v === "string") v = v.trim() === "" ? null : v.trim();
      if (f.required && (v == null || v === "")) return setErr(`${f.label} is required.`);
      if (f.type === "number" && v != null && (Number.isNaN(v) || (f.min != null && v < f.min) || (f.max != null && v > f.max))) return setErr(`${f.label} must be a number${f.min != null ? ` from ${f.min}` : ""}${f.max != null ? ` to ${f.max}` : ""}.`);
      if (f.type === "email" && v && !/^\S+@\S+\.\S+$/.test(v)) return setErr("Enter a valid email address.");
      patch[f.key] = v;
    }
    if (clean) { const r = clean(patch); if (typeof r === "string") return setErr(r); patch = r; }
    setBusy(true);
    const { error } = await supabase.from(table).update(patch).eq("id", id).eq("clinic_id", clinicId);
    setBusy(false);
    if (error) return setErr(error.message);
    setMsg("Saved."); toast("Saved successfully"); await load(clinicId);
  }

  if (row === undefined) return <AppShell><div className="p-10 text-center text-slate-400 text-sm">Loading…</div></AppShell>;
  if (row === null) return <AppShell><div className="p-10 text-center"><p className="text-slate-600 mb-3">We couldn&apos;t find that record in this clinic.</p><Link href={backHref} className="text-sky-600 underline text-sm">← {backLabel}</Link></div></AppShell>;

  const sub = subtitle?.(row);
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <Link href={backHref} className="text-sm text-slate-500 hover:text-sky-700">← {backLabel}</Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">{title(row)}</h1>
        {sub && <p className="text-slate-500 text-sm mt-1">{sub}</p>}
        <form onSubmit={save} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {fields.map((f) => {
            const dis = f.readOnly || !canEdit;
            const common = { id: `f-${f.key}`, disabled: dis, className: inp, value: form[f.key] ?? "", "aria-label": f.label } as any;
            return (
              <div key={f.key} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : ""}>
                <label htmlFor={`f-${f.key}`} className="text-xs font-medium text-slate-600 block mb-1">{f.label}{f.required && " *"}</label>
                {f.type === "textarea" ? <textarea {...common} rows={3} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  : f.type === "select" ? (
                    <select {...common} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}>
                      {!f.required && <option value="">—</option>}
                      {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : <input {...common} type={f.type === "number" ? "number" : f.type ?? "text"} step={f.type === "number" ? "any" : undefined} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />}
                {f.help && <p className="text-[11px] text-slate-400 mt-1">{f.help}</p>}
              </div>
            );
          })}
          {err && <p className="sm:col-span-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          {msg && <p className="sm:col-span-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</p>}
          {canEdit && <div className="sm:col-span-2 flex gap-2"><button disabled={busy} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : "Save changes"}</button>
            <Link href={backHref} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Close</Link></div>}
        </form>
        {clinicId && ENTITY[table] && <CustomFields clinicId={clinicId} entity={ENTITY[table]} recordId={id} canEdit={canEdit} />}
        {children?.(row, () => load(clinicId))}
      </div>
    </AppShell>
  );
}
