"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";
const TABLE: Record<string, string> = { patients: "clinic_patients", appointments: "appointments", invoices: "invoices", stock: "stock_items", tasks: "clinic_tasks", doctors: "doctors" };

/** The fields the clinic added to this kind of record through the Builder. Shows nothing when there are none. */
export default function CustomFields({ clinicId, entity, recordId, canEdit = true }: { clinicId: string; entity: keyof typeof TABLE; recordId: string; canEdit?: boolean }) {
  const [defs, setDefs] = useState<any[]>([]);
  const [vals, setVals] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!clinicId || !recordId) return;
    (async () => {
      const d = await supabase.from("custom_field_defs").select("*").eq("clinic_id", clinicId).eq("entity", entity).eq("status", "active").order("sort_order");
      if (d.error || !d.data?.length) return;                                            // migration 024 not run, or no fields: show nothing
      const r = await supabase.from(TABLE[entity]).select("custom").eq("id", recordId).eq("clinic_id", clinicId).maybeSingle();
      setDefs(d.data); setVals(r.data?.custom ?? {});
    })();
  }, [clinicId, entity, recordId]);

  if (!defs.length) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg("");
    try { await authFetch("/api/custom-fields", { body: { clinicId, entity, recordId, values: vals } }); setMsg("Saved."); } catch (x: any) { setMsg(x.message); }
    setBusy(false);
  }
  const set = (k: string, v: any) => setVals((p) => ({ ...p, [k]: v }));
  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Extra details">
      <h2 className="font-semibold text-slate-900 text-sm">Extra details</h2>
      <form onSubmit={save} className="mt-3 grid sm:grid-cols-2 gap-3">
        {defs.map((d) => {
          const id = `cf-${d.api_name}`, v = vals[d.api_name];
          return (
            <div key={d.id}><label htmlFor={id} className="text-xs font-medium text-slate-600 block mb-1">{d.label}{d.required ? " *" : ""}</label>
              {d.data_type === "boolean" ? <input id={id} type="checkbox" disabled={!canEdit} checked={!!v} onChange={(e) => set(d.api_name, e.target.checked)} className="h-5 w-5" />
                : d.data_type === "picklist" ? <select id={id} disabled={!canEdit} value={v ?? ""} onChange={(e) => set(d.api_name, e.target.value)} className={inp}><option value="">—</option>{(d.picklist_values ?? []).map((o: string) => <option key={o}>{o}</option>)}</select>
                : d.data_type === "long_text" ? <textarea id={id} rows={3} disabled={!canEdit} value={v ?? ""} onChange={(e) => set(d.api_name, e.target.value)} className={inp} />
                : <input id={id} disabled={!canEdit} value={v ?? ""} onChange={(e) => set(d.api_name, e.target.value)} className={inp}
                    type={d.data_type === "date" ? "date" : d.data_type === "datetime" ? "datetime-local" : ["number", "currency"].includes(d.data_type) ? "number" : d.data_type === "email" ? "email" : d.data_type === "phone" ? "tel" : d.data_type === "url" ? "url" : "text"} />}
            </div>
          );
        })}
        {canEdit && <div className="sm:col-span-2 flex items-center gap-3"><button disabled={busy} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : "Save"}</button>{msg && <span className="text-sm text-slate-600" role="status">{msg}</span>}</div>}
      </form>
    </section>
  );
}
