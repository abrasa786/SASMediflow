"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RecordForm, { type Field } from "@/components/RecordForm";
import { getActiveClinicId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import OffersConsent from "@/components/OffersConsent";
import PatientSummary from "@/components/PatientSummary";
import { planBadge, planTotals } from "@/lib/treatments";

const FIELDS: Field[] = [
  { key: "name", label: "Full name", required: true }, { key: "phone", label: "Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" }, { key: "dob", label: "Date of birth", type: "date" },
  { key: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"].map((v) => ({ value: v, label: v })) },
  { key: "blood_group", label: "Blood group", type: "select", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v })) },
  { key: "allergies", label: "Allergies" }, { key: "conditions", label: "Conditions" }, { key: "medications", label: "Medications" },
  { key: "address", label: "Address", type: "textarea" },
  { key: "emergency_contact_name", label: "Emergency contact name" }, { key: "emergency_contact_phone", label: "Emergency contact phone", type: "tel" },
  { key: "notes", label: "Notes", type: "textarea" },
];
const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2"><h2 className="font-semibold text-slate-900 text-sm">{title}</h2>{action}</div>
      {children}
    </div>
  );
}
const none = <p className="text-xs text-slate-400">None yet.</p>;
const row = "flex justify-between gap-3 text-sm py-1.5 border-b border-slate-50 last:border-0 hover:text-sky-700";
const smallBtn = "text-xs font-semibold text-sky-700 hover:underline whitespace-nowrap";

/** Everything that belongs to this patient, in one place: money, visits, treatments, notes. */
function History({ patientId }: { patientId: string }) {
  const [appts, setAppts] = useState<any[]>([]); const [invs, setInvs] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]); const [notes, setNotes] = useState<any[]>([]);
  useEffect(() => {
    const cid = getActiveClinicId(); if (!cid) return;
    const db = supabase as any;
    db.from("appointments").select("id, appointment_date, appointment_time, status, doctors(name)").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("appointment_date", { ascending: false }).limit(20).then(({ data }: any) => setAppts(data ?? []));
    db.from("invoices").select("id, invoice_number, total, paid_amount, status, created_at").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("created_at", { ascending: false }).limit(50).then(({ data }: any) => setInvs(data ?? []));
    db.from("treatment_plans").select("id, title, status, payment_status, mode, total_amount, discount, treatment_sittings(id, seq, label, status, due_amount, paid_amount, appointment_id)").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("created_at", { ascending: false }).limit(10).then(({ data }: any) => setPlans(data ?? []));
    db.from("visit_notes").select("id, visit_date, treatment, tooth, follow_up").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("visit_date", { ascending: false }).limit(10).then(({ data }: any) => setNotes(data ?? []));
  }, [patientId]);
  const billed = invs.reduce((s, i) => s + Number(i.total || 0), 0);
  const paid = invs.reduce((s, i) => s + (i.status === "paid" ? Number(i.total || 0) : Number(i.paid_amount || 0)), 0);
  const stat = (label: string, v: string, tone = "text-slate-900") => <div className="rounded-xl bg-white border border-slate-100 shadow-sm px-3 py-2.5"><p className="text-xs text-slate-500">{label}</p><p className={`font-bold tabular-nums ${tone}`}>{v}</p></div>;
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
        {stat("Visits", String(appts.length))}{stat("Billed", inr(billed))}{stat("Paid", inr(paid), "text-emerald-700")}{stat("Balance due", inr(Math.max(0, billed - paid)), billed - paid > 0 ? "text-red-600" : "text-slate-900")}
      </div>
      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        <Panel title="Appointments" action={<Link href={`/appointments?new=1&patient=${patientId}`} className={smallBtn}>+ New</Link>}>
          {appts.length === 0 ? none : appts.map((a) => (
            <Link key={a.id} href={`/appointments/${a.id}`} className={row}><span>{a.appointment_date} · {String(a.appointment_time).slice(0, 5)}</span><span className="text-xs text-slate-500 capitalize">{a.status}</span></Link>
          ))}
        </Panel>
        <Panel title="Invoices" action={<Link href="/billing?new=1" className={smallBtn}>+ New</Link>}>
          {invs.length === 0 ? none : invs.slice(0, 20).map((i) => (
            <Link key={i.id} href={`/billing/${i.id}`} className={row}><span className="font-mono text-xs">{i.invoice_number}</span><span>{inr(i.total)} <span className="text-xs text-slate-500 capitalize">{String(i.status).replace("_", " ")}</span></span></Link>
          ))}
        </Panel>
        <Panel title="Treatments" action={<span className="flex gap-2"><Link href={`/sittings?new=1&patient=${patientId}`} className={smallBtn}>+ Add sitting</Link><Link href={`/appointments?new=1&patient=${patientId}`} className={smallBtn}>Book next sitting</Link></span>}>
          {plans.length === 0 ? none : plans.map((p) => {
            const s: any[] = [...(p.treatment_sittings ?? [])].sort((x, y) => x.seq - y.seq);
            const doneN = s.filter((x) => x.status === "done").length;
            return (
              <div key={p.id} className="py-2 border-b border-slate-50 last:border-0">
                <div className="flex justify-between gap-3 text-sm"><span className="font-medium text-slate-800">{p.title}</span><span className="text-xs text-slate-500">{doneN} of {s.length} done</span></div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500"><span className={`px-2 py-0.5 rounded-full ${planBadge(p).cls}`}>{planBadge(p).text}</span>{(() => { const t = planTotals(p); return <span>billed {inr(t.billed)} · paid {inr(t.paid)}{t.due > 0 ? ` · ${inr(t.due)} due` : ""}{p.mode === "flexible" && t.estimate > 0 ? ` · estimate ${inr(t.estimate)}` : ""}</span>; })()}{p.status === "active" && <Link href={`/sittings?new=1&patient=${patientId}&plan=${p.id}`} className="text-sky-700 underline">add sitting</Link>}</p>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${s.length ? (doneN / s.length) * 100 : 0}%` }} /></div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{s.map((x) => (
                  <Link key={x.id} href={x.appointment_id ? `/appointments/${x.appointment_id}` : `/appointments?new=1&patient=${patientId}`}
                    className={`text-xs px-2 py-0.5 rounded-full border ${x.status === "done" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : x.appointment_id ? "bg-sky-50 border-sky-200 text-sky-800" : "bg-white border-slate-200 text-slate-500"}`}>{x.seq}. {x.label}</Link>
                ))}</div>
              </div>
            );
          })}
        </Panel>
        <Panel title="Visit notes">
          {notes.length === 0 ? none : notes.map((n) => (
            <div key={n.id} className="text-sm py-1.5 border-b border-slate-50 last:border-0"><span className="text-xs text-slate-400">{n.visit_date}{n.tooth ? ` · tooth ${n.tooth}` : ""}</span><p className="text-slate-800">{n.treatment}</p>{n.follow_up && <p className="text-xs text-amber-700">Next: {n.follow_up}</p>}</div>
          ))}
        </Panel>
      </div>
    </>
  );
}

export default function PatientRecord({ params }: { params: { id: string } }) {
  return <RecordForm table="clinic_patients" id={params.id} fields={FIELDS} backHref="/patients" backLabel="Patients"
    title={(r) => r.name} subtitle={(r) => r.phone ?? null}>{(r) => <><PatientSummary patientId={r.id} /><OffersConsent clinicId={r.clinic_id} patientId={r.id} /><History patientId={r.id} /></>}</RecordForm>;
}
