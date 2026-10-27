"use client";

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;
const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";
const EMPTY = { tooth: "", treatment: "", findings: "", concerns: "", conditions: "", alert: "", follow_up: "" };

/** Record what was done at this visit and what the doctor found. The next appointment for this patient shows it automatically. */
export default function VisitNotes({ clinicId, patientId, appointmentId, canEdit, onChange }: { clinicId: string; patientId: string; appointmentId: string; canEdit: boolean; onChange?: () => void }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [f, setF] = useState<Record<string, string>>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("visit_notes").select("*").eq("clinic_id", clinicId).eq("appointment_id", appointmentId).order("created_at");
    if (error) setErr(/visit_notes/.test(error.message) ? "Run migration 022 (visit notes) in Supabase first." : error.message);
    setNotes(data ?? []);
  }, [clinicId, appointmentId]);
  useEffect(() => { if (clinicId) load(); }, [clinicId, load]);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      await authFetch("/api/visits/note", { body: { clinicId, patientId, appointmentId, action: editing ? "update" : "create", id: editing ?? undefined, fields: f } });
      setF(EMPTY); setEditing(null); await load(); onChange?.();
    } catch (x: any) { setErr(x.message); }
    setBusy(false);
  }
  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    try { await authFetch("/api/visits/note", { body: { clinicId, action: "delete", id } }); await load(); onChange?.(); } catch (x: any) { setErr(x.message); }
  }
  const edit = (n: any) => { setEditing(n.id); setF(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, n[k] ?? ""]))); window.scrollTo({ behavior: "smooth", top: document.body.scrollHeight }); };

  const T = (k: string, label: string, hint?: string, rows = 2) => (
    <div className="sm:col-span-2"><label htmlFor={`vn-${k}`} className="text-xs font-medium text-slate-600 block mb-1">{label}</label>
      <textarea id={`vn-${k}`} rows={rows} value={f[k]} onChange={(e) => set(k, e.target.value)} className={inp} />{hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}</div>);

  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Treatment done at this visit">
      <h2 className="font-semibold text-slate-900 text-sm">Treatment done at this visit</h2>
      {notes.length === 0 && <p className="text-xs text-slate-400 mt-1">Nothing recorded yet.</p>}
      <ul className="mt-2 space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-xl border border-slate-100 px-3 py-2 text-sm">
            <p className="font-medium text-slate-900">{n.treatment}{n.tooth ? ` · tooth ${n.tooth}` : ""}</p>
            {n.findings && <p className="text-xs text-slate-600">Findings: {n.findings}</p>}
            {n.concerns && <p className="text-xs text-slate-600">Patient concern: {n.concerns}</p>}
            {n.conditions && <p className="text-xs text-slate-600">Condition: {n.conditions}</p>}
            {n.alert && <p className="text-xs text-red-700 font-medium">⚠ Shown at every future visit: {n.alert}</p>}
            {n.follow_up && <p className="text-xs text-slate-600">Follow-up: {n.follow_up}</p>}
            {canEdit && <p className="mt-1 text-xs"><button type="button" onClick={() => edit(n)} className="text-sky-700 underline mr-3">Edit</button><button type="button" onClick={() => remove(n.id)} className="text-red-600">Delete</button></p>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={save} className="mt-3 grid sm:grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <div><label htmlFor="vn-tooth" className="text-xs font-medium text-slate-600 block mb-1">Tooth (optional)</label><input id="vn-tooth" value={f.tooth} onChange={(e) => set("tooth", e.target.value)} className={inp} placeholder="e.g. 46 or upper left molar" /></div>
          <div><label htmlFor="vn-treatment" className="text-xs font-medium text-slate-600 block mb-1">What was done *</label><input id="vn-treatment" value={f.treatment} onChange={(e) => set("treatment", e.target.value)} className={inp} placeholder="e.g. Root canal, first sitting" /></div>
          {T("findings", "What the doctor found")}
          {T("concerns", "Patient's concerns")}
          {T("conditions", "Condition noticed", "e.g. inner bone is weak, gums bleed easily")}
          {T("alert", "Warning for future visits (optional)", "Shown in a red box at the top of every future appointment for this patient.")}
          {T("follow_up", "Follow-up needed")}
          {err && <p className="sm:col-span-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          <div className="sm:col-span-2 flex gap-2">
            <button disabled={busy} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : editing ? "Save entry" : "Add to patient record"}</button>
            {editing && <button type="button" onClick={() => { setEditing(null); setF(EMPTY); }} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Cancel</button>}
          </div>
        </form>
      )}
      {!canEdit && err && <p className="mt-2 text-xs text-amber-700">{err}</p>}
    </section>
  );
}
