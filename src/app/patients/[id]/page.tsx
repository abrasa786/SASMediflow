"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RecordForm, { type Field } from "@/components/RecordForm";
import { getActiveClinicId } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

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

function History({ patientId }: { patientId: string }) {
  const [appts, setAppts] = useState<any[]>([]); const [invs, setInvs] = useState<any[]>([]);
  useEffect(() => {
    const cid = getActiveClinicId(); if (!cid) return;
    supabase.from("appointments").select("id, appointment_date, appointment_time, status, doctors(name)").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("appointment_date", { ascending: false }).limit(20).then(({ data }: any) => setAppts(data ?? []));
    supabase.from("invoices").select("id, invoice_number, total, status, created_at").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("created_at", { ascending: false }).limit(20).then(({ data }: any) => setInvs(data ?? []));
  }, [patientId]);
  return (
    <div className="grid sm:grid-cols-2 gap-4 mt-5">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <h2 className="font-semibold text-slate-900 text-sm mb-2">Appointments</h2>
        {appts.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : appts.map((a) => (
          <Link key={a.id} href={`/appointments/${a.id}`} className="flex justify-between text-sm py-1.5 border-b border-slate-50 last:border-0 hover:text-sky-700"><span>{a.appointment_date} · {a.appointment_time}</span><span className="text-xs text-slate-500 capitalize">{a.status}</span></Link>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <h2 className="font-semibold text-slate-900 text-sm mb-2">Invoices</h2>
        {invs.length === 0 ? <p className="text-xs text-slate-400">None yet.</p> : invs.map((i) => (
          <Link key={i.id} href={`/billing/${i.id}`} className="flex justify-between text-sm py-1.5 border-b border-slate-50 last:border-0 hover:text-sky-700"><span className="font-mono text-xs">{i.invoice_number}</span><span>{inr(i.total)} <span className="text-xs text-slate-500 capitalize">{String(i.status).replace("_", " ")}</span></span></Link>
        ))}
      </div>
    </div>
  );
}

export default function PatientRecord({ params }: { params: { id: string } }) {
  return <RecordForm table="clinic_patients" id={params.id} fields={FIELDS} backHref="/patients" backLabel="Patients"
    title={(r) => r.name} subtitle={(r) => r.phone ?? null}>{(r) => <History patientId={r.id} />}</RecordForm>;
}
