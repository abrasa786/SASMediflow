"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { toast } from "@/lib/toast";

const supabase = sb as any;
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const nice = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** The treatment this visit belongs to: every sitting of the plan, this visit's sitting marked. If the visit is not tied to a sitting yet, pick one. */
export default function AppointmentTreatment({ clinicId, appointmentId, patientId, canEdit }: { clinicId: string; appointmentId: string; patientId: string; canEdit: boolean }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await supabase.from("treatment_plans")
      .select("id, title, status, total_amount, discount, treatment_sittings(id, seq, label, status, due_amount, paid_amount, invoice_id, appointment_id, target_date, appointments(appointment_date))")
      .eq("clinic_id", clinicId).eq("clinic_patient_id", patientId).neq("status", "cancelled").order("created_at", { ascending: false });
    setPlans(r.data ?? []);
  }, [clinicId, patientId]);
  useEffect(() => { if (clinicId && patientId) load(); }, [clinicId, patientId, load]);

  async function link(sittingId?: string) {
    setBusy(true); setErr("");
    try { await authFetch("/api/treatments/link", { body: { clinicId, appointmentId, sittingId, action: sittingId ? "link" : "unlink" } }); toast(sittingId ? "Visit linked to the treatment" : "Visit unlinked"); await load(); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  const mine = plans.filter((p) => (p.treatment_sittings ?? []).some((s: any) => s.appointment_id === appointmentId));
  const open = plans.filter((p) => p.status === "active" && !mine.includes(p) && (p.treatment_sittings ?? []).some((s: any) => s.status === "pending" && !s.appointment_id));
  if (!mine.length && !open.length) return null;

  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Treatment for this visit">
      <h2 className="font-semibold text-slate-900 text-sm">Treatment</h2>
      {mine.map((p) => (
        <div key={p.id} className="mt-2">
          <p className="text-sm font-medium text-slate-800">{p.title} <span className="text-xs font-normal text-slate-500">· total {inr(p.total_amount - p.discount)}</span></p>
          <ul className="mt-1 divide-y divide-slate-50">
            {(p.treatment_sittings ?? []).sort((a: any, b: any) => a.seq - b.seq).map((s: any) => (
              <li key={s.id} className={`flex items-start justify-between gap-3 py-2 text-sm ${s.appointment_id === appointmentId ? "bg-sky-50/70 -mx-2 px-2 rounded-lg" : ""}`}>
                <span className="min-w-0"><span className={s.appointment_id === appointmentId ? "font-semibold text-slate-900" : "text-slate-600"}>Sitting {s.seq}{s.label ? ` · ${s.label}` : ""}{s.appointment_id === appointmentId ? " · this visit" : ""}</span>
                  <span className="block text-xs text-slate-500">{s.status === "done" ? "Done" : s.status === "pending" ? "Pending" : s.status}{s.appointments?.appointment_date ? ` · ${nice(s.appointments.appointment_date)}` : s.target_date ? ` · planned ${nice(s.target_date)}` : ""}
                    {s.invoice_id && <> · <Link href={`/billing/${s.invoice_id}`} className="text-sky-700 underline">invoice</Link></>}</span></span>
                <span className="text-right shrink-0">{inr(s.due_amount)}<span className="block text-xs text-slate-500">paid {inr(s.paid_amount)}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs flex gap-3"><Link href="/treatments" className="text-sky-700 underline">Open in Treatments</Link>
            {canEdit && <button type="button" disabled={busy} onClick={() => link()} className="text-red-600">Unlink this visit</button>}</p>
        </div>
      ))}
      {canEdit && open.length > 0 && (
        <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3">
          <p className="text-xs font-semibold text-sky-900">Is this visit a sitting of a treatment?</p>
          {open.map((p) => (
            <div key={p.id} className="mt-2"><p className="text-xs text-slate-600">{p.title}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {(p.treatment_sittings ?? []).filter((s: any) => s.status === "pending" && !s.appointment_id).sort((a: any, b: any) => a.seq - b.seq).map((s: any) => (
                  <button key={s.id} type="button" disabled={busy} onClick={() => link(s.id)} className="px-3 py-2 rounded-xl bg-white border border-sky-200 text-sky-800 text-sm font-medium">Sitting {s.seq} · {inr(s.due_amount)}</button>
                ))}
              </div></div>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-700" role="alert">{err}</p>}
    </section>
  );
}
