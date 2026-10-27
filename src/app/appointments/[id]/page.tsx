"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import SlotPicker from "@/components/SlotPicker";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { getClinicDoctors, getMyRoleInClinic } from "@/lib/clinic";
import PatientSummary from "@/components/PatientSummary";
import VisitNotes from "@/components/VisitNotes";
import type { Doctor } from "@/types";

const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50";
const STATUSES = [["confirmed", "Confirmed"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["no_show", "No-show"]];

/** One appointment: change the doctor, day or time (checked for clashes), the status, the fee and the notes. */
export default function AppointmentRecord({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [a, setA] = useState<any | null | undefined>(undefined);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [status, setStatus] = useState("confirmed");
  const [symptoms, setSymptoms] = useState("");
  const [notes, setNotes] = useState("");
  const [fee, setFee] = useState("");
  const [mode, setMode] = useState("in_clinic");
  const [invoice, setInvoice] = useState<{ id: string; invoice_number: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [canNote, setCanNote] = useState(false);
  const [rk, setRk] = useState(0);        // bumps when a visit note changes, so the summary refreshes

  const load = useCallback(async (cid: string) => {
    const { data } = await supabase.from("appointments").select("*, clinic_patients(id, name, phone), doctors(name)").eq("id", params.id).eq("clinic_id", cid).maybeSingle();
    if (!data) { setA(null); return; }
    setA(data); setDoctorId(data.doctor_id ?? ""); setDate(data.appointment_date); setTime(data.appointment_time); setStatus(data.status);
    setSymptoms(data.symptoms ?? ""); setNotes(data.notes ?? ""); setFee(String(data.consultation_fee ?? "")); setMode(data.mode ?? "in_clinic");
    const { data: inv } = await supabase.from("invoices").select("id, invoice_number, status").eq("clinic_id", cid).eq("appointment_id", params.id).neq("status", "cancelled").limit(1);
    setInvoice(inv?.[0] ?? null);
  }, [params.id]);

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid); load(cid); getClinicDoctors(cid).then(setDoctors);
    getMyRoleInClinic(cid).then((r) => setCanNote(r === "admin" || r === "doctor" || r === "nurse"));
  }, [router, load]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const feeN = fee.trim() === "" ? 0 : Number(fee);
    if (Number.isNaN(feeN) || feeN < 0) return setErr("The fee must be a number, 0 or more.");
    setBusy(true);
    try {
      const moved = doctorId !== (a.doctor_id ?? "") || date !== a.appointment_date || time !== a.appointment_time;
      if (moved) {
        if (!time) throw new Error("Pick a free time.");
        await authFetch("/api/appointments/reschedule", { body: { clinicId, appointmentId: a.id, date, time, doctorId: doctorId || null } });
      }
      const { error } = await supabase.from("appointments").update({ symptoms: symptoms.trim() || null, notes: notes.trim() || null, consultation_fee: feeN, mode }).eq("id", a.id).eq("clinic_id", clinicId);
      if (error) throw new Error(error.message);
      if (status !== a.status) await authFetch("/api/appointments/status", { body: { clinicId, appointmentId: a.id, status } });
      setMsg(moved ? "Saved. The patient was told about the new time." : "Saved.");
      await load(clinicId);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  if (a === undefined) return <AppShell><div className="p-10 text-center text-slate-400 text-sm">Loading…</div></AppShell>;
  if (a === null) return <AppShell><div className="p-10 text-center"><p className="text-slate-600 mb-3">We couldn&apos;t find that appointment in this clinic.</p><Link href="/appointments" className="text-sky-600 underline text-sm">← Appointments</Link></div></AppShell>;
  const p = a.clinic_patients;

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <Link href={`/appointments?date=${a.appointment_date}`} className="text-sm text-slate-500 hover:text-sky-700">← Appointments</Link>
        <div className="flex flex-wrap items-start justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{p ? <Link href={`/patients/${p.id}`} className="hover:text-sky-700">{p.name}</Link> : "Appointment"}</h1>
            <p className="text-slate-500 text-sm mt-1">{a.appointment_date} at {a.appointment_time}{a.doctors?.name ? ` · ${a.doctors.name}` : ""}{p?.phone ? ` · ${p.phone}` : ""}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {invoice
              ? <Link href={`/billing/${invoice.id}`} className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Invoice {invoice.invoice_number}</Link>
              : <Link href={`/billing?appointment=${a.id}`} className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold">Create invoice</Link>}
          </div>
        </div>

        {p && <PatientSummary patientId={p.id} refreshKey={rk} />}

        <form onSubmit={save} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 mt-5 grid sm:grid-cols-2 gap-4">
          <div><label htmlFor="ap-doc" className="text-xs font-medium text-slate-600 block mb-1">Doctor</label>
            <select id="ap-doc" value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(""); }} className={inp}>
              <option value="">Auto-assign</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.speciality ? ` · ${d.speciality}` : ""}</option>)}
            </select></div>
          <div><label htmlFor="ap-date" className="text-xs font-medium text-slate-600 block mb-1">Date</label>
            <input id="ap-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} className={inp} /></div>
          <div className="sm:col-span-2"><label className="text-xs font-medium text-slate-600 block mb-1">Time <span className="text-slate-400 font-normal">(currently {a.appointment_time}; only free times are shown)</span></label>
            {date === a.appointment_date && doctorId === (a.doctor_id ?? "") && time === a.appointment_time && <p className="text-xs text-slate-500 mb-2">Pick another time below to move it.</p>}
            <SlotPicker clinicId={clinicId} date={date} doctorId={doctorId || undefined} value={time} onChange={setTime} /></div>
          <div><label htmlFor="ap-status" className="text-xs font-medium text-slate-600 block mb-1">Status</label>
            <select id="ap-status" value={status} onChange={(e) => setStatus(e.target.value)} className={inp}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label htmlFor="ap-mode" className="text-xs font-medium text-slate-600 block mb-1">Visit type</label>
            <select id="ap-mode" value={mode} onChange={(e) => setMode(e.target.value)} className={inp}><option value="in_clinic">In clinic</option><option value="video">Video</option></select></div>
          <div><label htmlFor="ap-fee" className="text-xs font-medium text-slate-600 block mb-1">Consultation fee (₹)</label>
            <input id="ap-fee" type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className={inp} /></div>
          <div><label htmlFor="ap-sym" className="text-xs font-medium text-slate-600 block mb-1">Reason for visit</label>
            <input id="ap-sym" value={symptoms} onChange={(e) => setSymptoms(e.target.value)} className={inp} /></div>
          <div className="sm:col-span-2"><label htmlFor="ap-notes" className="text-xs font-medium text-slate-600 block mb-1">Notes</label>
            <textarea id="ap-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={inp} /></div>
          {err && <p className="sm:col-span-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
          {msg && <p className="sm:col-span-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{msg}</p>}
          <div className="sm:col-span-2 flex gap-2"><button disabled={busy} className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : "Save changes"}</button>
            <Link href={`/appointments?date=${a.appointment_date}`} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">Close</Link></div>
        </form>
        {p && clinicId && <VisitNotes clinicId={clinicId} patientId={p.id} appointmentId={a.id} canEdit={canNote} onChange={() => setRk((n) => n + 1)} />}
      </div>
    </AppShell>
  );
}
