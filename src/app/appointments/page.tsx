"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { getAppointments, getClinicDoctors, getClinicPatients, bookAppointment, updateAppointmentStatus, timeSlots, todayIso, searchClinicPatients } from "@/lib/clinic";
import type { Appointment, Doctor, ClinicPatient } from "@/types";

const STATUS_COLORS = {
  confirmed: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled:  "bg-red-100 text-red-700",
  no_show:   "bg-gray-100 text-gray-500",
};

export default function AppointmentsPage() {
  const router = useRouter();
  const [date, setDate] = useState(todayIso());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBook, setShowBook] = useState(false);
  const [clinicId, setClinicId] = useState("");

  // Booking form state
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<ClinicPatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<ClinicPatient | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [time, setTime] = useState("09:00 AM");
  const [fee, setFee] = useState("800");
  const [mode, setMode] = useState<"in_clinic" | "video">("in_clinic");
  const [symptoms, setSymptoms] = useState("");
  const [booking, setBooking] = useState(false);
  const [bookErr, setBookErr] = useState("");

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    loadAll(id, date);
  }, [router]);

  useEffect(() => {
    if (clinicId) loadAll(clinicId, date);
  }, [date, clinicId]);

  async function loadAll(id: string, d: string) {
    setLoading(true);
    const [appts, docs] = await Promise.all([getAppointments(id, d), getClinicDoctors(id)]);
    setAppointments(appts);
    setDoctors(docs);
    setLoading(false);
  }

  async function handlePatientSearch(q: string) {
    setPatientSearch(q);
    if (q.length < 2) { setPatientResults([]); return; }
    const results = await searchClinicPatients(clinicId, q);
    setPatientResults(results);
  }

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient) { setBookErr("Select a patient first"); return; }
    setBooking(true);
    setBookErr("");
    const { error } = await bookAppointment({
      clinicId, clinicPatientId: selectedPatient.id,
      doctorId: doctorId || undefined, date, time,
      fee: Number(fee), mode, symptoms,
    });
    if (error) { setBookErr(error.message); setBooking(false); return; }
    setShowBook(false);
    resetForm();
    loadAll(clinicId, date);
    setBooking(false);
  }

  function resetForm() {
    setSelectedPatient(null); setPatientSearch(""); setPatientResults([]);
    setDoctorId(""); setTime("09:00 AM"); setFee("800");
    setMode("in_clinic"); setSymptoms(""); setBookErr("");
  }

  async function changeStatus(apptId: string, status: "completed" | "cancelled" | "no_show" | "confirmed") {
    await updateAppointmentStatus(apptId, status);
    loadAll(clinicId, date);
  }

  const slots = timeSlots();
  const statusCounts = appointments.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Appointments</h1>
            <div className="flex gap-3 mt-2 text-xs text-slate-500">
              {Object.entries(statusCounts).map(([s, c]) => (
                <span key={s} className={`px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s as keyof typeof STATUS_COLORS] ?? "bg-gray-100 text-gray-500"}`}>
                  {c} {s.replace("_", " ")}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              onClick={() => setShowBook(true)}
              className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              + Book
            </button>
          </div>
        </div>

        {/* Appointment list */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
          ) : appointments.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <div className="text-4xl mb-3">📅</div>
              No appointments on this date
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {appointments.map((appt) => (
                <div key={appt.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4">
                  <div className="w-20 text-xs font-mono text-slate-500 shrink-0">{appt.appointment_time}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900 text-sm">{appt.patient?.name ?? "—"}</p>
                      {appt.patient?.phone && <span className="text-xs text-slate-400">{appt.patient.phone}</span>}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{appt.doctor_name} · {appt.symptoms || "General"} · {appt.mode === "video" ? "📹 Video" : "🏥 In-clinic"}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-slate-700">₹{appt.consultation_fee}</span>
                    <select
                      value={appt.status}
                      onChange={(e) => changeStatus(appt.id, e.target.value as any)}
                      className={`text-xs font-semibold px-2 py-1 rounded-lg border-0 cursor-pointer ${STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-500"}`}
                    >
                      <option value="confirmed">Confirmed</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="no_show">No Show</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Book modal */}
      {showBook && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowBook(false); resetForm(); }}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-900 text-lg">Book Appointment</h2>
              <button onClick={() => { setShowBook(false); resetForm(); }} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>
            <form onSubmit={handleBook} className="space-y-4">
              {/* Patient search */}
              <div className="relative">
                <label className="text-xs font-medium text-slate-600 block mb-1">Patient *</label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-sky-800">{selectedPatient.name}</p>
                      <p className="text-xs text-sky-600">{selectedPatient.phone}</p>
                    </div>
                    <button type="button" onClick={() => { setSelectedPatient(null); setPatientSearch(""); }} className="text-sky-400 hover:text-red-500 text-sm">×</button>
                  </div>
                ) : (
                  <>
                    <input
                      value={patientSearch}
                      onChange={(e) => handlePatientSearch(e.target.value)}
                      placeholder="Search by name or phone…"
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                    {patientResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden">
                        {patientResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { setSelectedPatient(p); setPatientResults([]); }}
                            className="w-full text-left px-4 py-3 text-sm hover:bg-sky-50 transition-colors border-b border-slate-50 last:border-0"
                          >
                            <p className="font-medium text-slate-900">{p.name}</p>
                            <p className="text-xs text-slate-500">{p.phone}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Doctor</label>
                  <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="">Duty Doctor</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Time *</label>
                  <select value={time} onChange={(e) => setTime(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required>
                    {slots.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Fee (₹) *</label>
                  <input type="number" value={fee} onChange={(e) => setFee(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Mode</label>
                  <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="in_clinic">In-clinic</option>
                    <option value="video">Video</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Symptoms / Notes</label>
                <input value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Tooth pain" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>

              {bookErr && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{bookErr}</p>}

              <button type="submit" disabled={booking} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors">
                {booking ? "Booking…" : "Book Appointment"}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
