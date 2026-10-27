"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import SlotPicker from "@/components/SlotPicker";
import { supabase as supabaseClient } from "@/lib/supabase";
import { getAppointments, getClinicDoctors, searchClinicPatients, todayIso } from "@/lib/clinic";
import type { Appointment, Doctor, ClinicPatient } from "@/types";

const supabase = supabaseClient as any;

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  no_show: "bg-gray-100 text-gray-500",
};

interface Notification { recipient: "patient" | "doctor"; status: "sent" | "failed" | "link" | "skipped"; link?: string; error?: string }
interface Outcome { title: string; lines: string[]; notifications: Notification[]; tone: "ok" | "warn" }

const inputCls = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white";
const labelCls = "text-xs font-medium text-slate-600 block mb-1";
const shiftDay = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const niceDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

function NotificationList({ items }: { items: Notification[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      {items.map((n, i) => (
        <div key={i} className="flex items-center justify-between gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
          <span className="text-slate-700">
            {n.status === "sent" && <>✅ WhatsApp sent to the {n.recipient}</>}
            {n.status === "link" && <>📲 {n.recipient === "patient" ? "Patient" : "Doctor"} message ready</>}
            {n.status === "failed" && <>⚠️ WhatsApp to the {n.recipient} failed{n.error ? `: ${n.error}` : ""}</>}
            {n.status === "skipped" && <>ℹ️ {n.error ?? `No phone for the ${n.recipient}`}</>}
          </span>
          {n.link && <a href={n.link} target="_blank" rel="noreferrer" className="shrink-0 font-semibold text-emerald-700 hover:underline">Send on WhatsApp ↗</a>}
        </div>
      ))}
    </div>
  );
}

export default function AppointmentsPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [date, setDate] = useState(() => { try { const d = new URLSearchParams(window.location.search).get("date"); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayIso(); } catch { return todayIso(); } });
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [actionErr, setActionErr] = useState("");

  const [showBook, setShowBook] = useState(false);
  const [moveAppt, setMoveAppt] = useState<Appointment | null>(null);
  const [cancelAppt, setCancelAppt] = useState<Appointment | null>(null);

  const load = useCallback(async (id: string, d: string) => {
    setLoading(true);
    const [appts, docs] = await Promise.all([getAppointments(id, d), getClinicDoctors(id)]);
    setAppointments(appts); setDoctors(docs); setLoading(false);
  }, []);

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
  }, [router]);
  useEffect(() => { if (clinicId) load(clinicId, date); }, [clinicId, date, load]);

  async function run(appt: Appointment, path: string, body: any, title: (d: any) => string) {
    setBusyId(appt.id); setActionErr("");
    try {
      const r = await authFetch(path, { body: { clinicId, appointmentId: appt.id, ...body } });
      setOutcome({ title: title(r), lines: [], notifications: r.notifications ?? [], tone: "ok" });
      await load(clinicId, date);
      return r;
    } catch (e: any) {
      setActionErr(e.message);
    } finally { setBusyId(""); }
  }

  // Done: go straight to this visit's invoice. The appointment is closed when the payment is received.
  const complete = async (a: Appointment) => { router.push(`/billing?appointment=${a.id}`); };
  const noShow = (a: Appointment) => run(a, "/api/appointments/status", { status: "no_show" }, () => `${a.patient?.name ?? "Appointment"} marked no-show`);
  const reopen = (a: Appointment) => run(a, "/api/appointments/status", { status: "confirmed" }, () => `${a.patient?.name ?? "Appointment"} is confirmed again`);
  const remind = (a: Appointment) => run(a, "/api/appointments/notify", { kind: "reminder" }, () => `Reminder prepared for ${a.patient?.name ?? "patient"}`);

  const counts = appointments.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {} as Record<string, number>);
  const isToday = date === todayIso();

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Appointments</h1>
            <div className="flex flex-wrap gap-2 mt-2 text-xs">
              {Object.entries(counts).map(([s, c]) => (
                <span key={s} className={`px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s] ?? "bg-gray-100 text-gray-500"}`}>{c} {s.replace("_", " ")}</span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDate(shiftDay(date, -1))} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50" aria-label="Previous day">‹</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <button onClick={() => setDate(shiftDay(date, 1))} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50" aria-label="Next day">›</button>
            {!isToday && <button onClick={() => setDate(todayIso())} className="px-3 py-2 rounded-xl text-sm text-sky-700 hover:bg-sky-50">Today</button>}
            <button onClick={() => setShowBook(true)} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors">+ Book</button>
          </div>
        </div>

        {outcome && (
          <div className="mb-4 bg-white border border-emerald-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-slate-900">✅ {outcome.title}</p>
              <button onClick={() => setOutcome(null)} className="text-slate-400 hover:text-slate-600 leading-none text-lg" aria-label="Dismiss">×</button>
            </div>
            <NotificationList items={outcome.notifications} />
          </div>
        )}
        {actionErr && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 flex justify-between gap-3">
            <span>{actionErr}</span><button onClick={() => setActionErr("")} className="text-red-400" aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
          ) : appointments.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <div className="text-4xl mb-3">📅</div>
              No appointments on {niceDate(date)}
              <div><button onClick={() => setShowBook(true)} className="mt-3 text-sky-600 font-medium hover:underline">Book one</button></div>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {appointments.map((a) => {
                const busy = busyId === a.id;
                return (
                  <div key={a.id} onClick={(e) => { if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return; router.push(`/appointments/${a.id}`); }} className={`flex flex-col lg:flex-row lg:items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 ${busy ? "opacity-60" : ""}`}>
                    <div className="w-24 shrink-0">
                      <p className="text-sm font-mono font-semibold text-slate-700">{a.appointment_time}</p>
                      {a.duration_minutes ? <p className="text-[11px] text-slate-400">{a.duration_minutes} min</p> : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm">{a.patient?.name ?? "—"}</p>
                        {a.patient?.phone && <span className="text-xs text-slate-400">{a.patient.phone}</span>}
                        {a.source === "online" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">booked online{Number(a.advance_paid) > 0 ? ` · ₹${Number(a.advance_paid).toLocaleString("en-IN")} paid` : ""}</span>}
                        {a.source === "bot" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">via assistant</span>}
                        {(a.assigned_by === "auto_usual" || a.assigned_by === "auto_free") && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{a.assigned_by === "auto_usual" ? "usual doctor" : "auto-assigned"}</span>}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {a.doctor_name} · {a.symptoms || "General"} · {a.mode === "video" ? "📹 Video" : "🏥 In-clinic"}
                        {a.status === "cancelled" && a.cancel_reason ? ` · Reason: ${a.cancel_reason}` : ""}
                        {a.reschedule_count ? ` · moved ${a.reschedule_count}×` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap lg:justify-end">
                      <span className="text-sm font-semibold text-slate-700 mr-1">₹{a.consultation_fee}</span>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${STATUS_COLORS[a.status] ?? "bg-gray-100 text-gray-500"}`}>{a.status.replace("_", " ")}</span>
                      {a.status !== "cancelled" && ["invoiced", "part_paid", "paid"].includes((a as any).billing_status) && (
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${(a as any).billing_status === "paid" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                          {(a as any).billing_status === "paid" ? "Paid & settled" : (a as any).billing_status === "part_paid" ? "Part paid" : "Invoiced"}</span>
                      )}
                      {a.status === "confirmed" && (
                        <>
                          <button disabled={busy} onClick={() => complete(a)} className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium">Done · bill</button>
                          <button disabled={busy} onClick={() => { setActionErr(""); setMoveAppt(a); }} className="text-xs px-2.5 py-1.5 rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 font-medium">Reschedule</button>
                          <button disabled={busy} onClick={() => remind(a)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-700 hover:bg-slate-100 font-medium">Remind</button>
                          <button disabled={busy} onClick={() => noShow(a)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 font-medium">No-show</button>
                          <button disabled={busy} onClick={() => { setActionErr(""); setCancelAppt(a); }} className="text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 font-medium">Cancel</button>
                        </>
                      )}
                      {(a.status === "cancelled" || a.status === "no_show") && (
                        <button disabled={busy} onClick={() => reopen(a)} className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-700 hover:bg-slate-100 font-medium">Reopen</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showBook && (
        <BookModal clinicId={clinicId} doctors={doctors} defaultDate={date}
          onClose={() => setShowBook(false)} onBooked={(d) => { if (d) setDate(d); load(clinicId, d ?? date); }} />
      )}
      {moveAppt && (
        <MoveModal clinicId={clinicId} appt={moveAppt} defaultDate={date} onClose={() => setMoveAppt(null)}
          onDone={(title, notifications) => { toast(title); setMoveAppt(null); setOutcome({ title, lines: [], notifications, tone: "ok" }); load(clinicId, date); }} />
      )}
      {cancelAppt && (
        <CancelModal clinicId={clinicId} appt={cancelAppt} onClose={() => setCancelAppt(null)}
          onDone={(title, notifications) => { toast(title); setCancelAppt(null); setOutcome({ title, lines: [], notifications, tone: "ok" }); load(clinicId, date); }} />
      )}
    </AppShell>
  );
}

// ── Cancel ──────────────────────────────────────────────────────────
function CancelModal({ clinicId, appt, onClose, onDone }: { clinicId: string; appt: Appointment; onClose: () => void; onDone: (t: string, n: Notification[]) => void }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit() {
    setBusy(true); setErr("");
    try {
      const r = await authFetch("/api/appointments/status", { body: { clinicId, appointmentId: appt.id, status: "cancelled", reason: reason.trim() || undefined, notify } });
      onDone(`Cancelled ${appt.patient?.name ?? "appointment"}'s ${appt.appointment_time} slot`, r.notifications ?? []);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title="Cancel appointment" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-4"><strong>{appt.patient?.name}</strong> · {appt.appointment_date} at {appt.appointment_time} with {appt.doctor_name}</p>
      <label className={labelCls}>Reason (shared with the patient)</label>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Doctor unavailable" className={inputCls} />
      <label className="flex items-center gap-2 text-sm text-slate-600 mt-3"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the patient and doctor on WhatsApp</label>
      {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-3">{err}</p>}
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-700 hover:bg-slate-50">Keep it</button>
        <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Cancelling…" : "Cancel appointment"}</button>
      </div>
    </Modal>
  );
}

// ── Reschedule ──────────────────────────────────────────────────────
function MoveModal({ clinicId, appt, defaultDate, onClose, onDone }: { clinicId: string; appt: Appointment; defaultDate: string; onClose: () => void; onDone: (t: string, n: Notification[]) => void }) {
  const [date, setDate] = useState(defaultDate < todayIso() ? todayIso() : defaultDate);
  const [time, setTime] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  async function submit() {
    if (!time) { setErr("Pick a new time."); return; }
    setBusy(true); setErr("");
    try {
      const r = await authFetch("/api/appointments/reschedule", { body: { clinicId, appointmentId: appt.id, date, time, doctorId: appt.doctor_id, notify } });
      onDone(`Moved ${appt.patient?.name ?? "appointment"} to ${niceDate(date)} at ${time}`, r.notifications ?? []);
    } catch (e: any) { setErr(e.message); setBusy(false); setReload((n) => n + 1); }
  }
  return (
    <Modal title="Reschedule appointment" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-4"><strong>{appt.patient?.name}</strong> · now {appt.appointment_date} at {appt.appointment_time} with {appt.doctor_name}</p>
      <label className={labelCls}>New date</label>
      <input type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} className={inputCls} />
      <label className={`${labelCls} mt-3`}>New time</label>
      <SlotPicker clinicId={clinicId} date={date} doctorId={appt.doctor_id} value={time} onChange={setTime} reloadKey={reload} />
      <label className="flex items-center gap-2 text-sm text-slate-600 mt-3"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the patient and doctor on WhatsApp</label>
      {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-3">{err}</p>}
      <button onClick={submit} disabled={busy || !time} className="w-full mt-5 py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white rounded-xl text-sm font-semibold">{busy ? "Moving…" : "Move appointment"}</button>
    </Modal>
  );
}

// ── Book ────────────────────────────────────────────────────────────
function BookModal({ clinicId, doctors, defaultDate, onClose, onBooked }: { clinicId: string; doctors: Doctor[]; defaultDate: string; onClose: () => void; onBooked: (date?: string) => void }) {
  const [who, setWho] = useState<"existing" | "new">("new");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ClinicPatient[]>([]);
  const [picked, setPicked] = useState<ClinicPatient | null>(null);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [age, setAge] = useState(""); const [gender, setGender] = useState("");
  const [match, setMatch] = useState<{ id: string; name: string }[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(defaultDate < todayIso() ? todayIso() : defaultDate);
  const [time, setTime] = useState("");
  const [fee, setFee] = useState(""); const [feeTouched, setFeeTouched] = useState(false);
  const [mode, setMode] = useState<"in_clinic" | "video">("in_clinic");
  const [symptoms, setSymptoms] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [alts, setAlts] = useState<{ date: string; slots: { doctorName: string; time: string }[] }[]>([]);
  const [reload, setReload] = useState(0);
  const [done, setDone] = useState<any>(null);

  async function onSearch(q: string) {
    setSearch(q);
    if (q.trim().length < 2) { setResults([]); return; }
    setResults(await searchClinicPatients(clinicId, q));
  }

  // live check: does this mobile number already belong to someone in this clinic?
  useEffect(() => {
    const d = phone.replace(/\D/g, "").slice(-10);
    if (who !== "new" || d.length !== 10) { setMatch([]); return; }
    let live = true;
    supabase.from("clinic_patients").select("id, name").eq("clinic_id", clinicId).eq("phone_norm", d).limit(5)
      .then((r: any) => { if (live) setMatch(r.data ?? []); });
    return () => { live = false; };
  }, [phone, who, clinicId]);

  // pre-fill the fee from the chosen doctor until the user types their own
  useEffect(() => {
    if (feeTouched) return;
    const doc = doctors.find((d) => d.id === doctorId);
    setFee(doc?.consultation_fee != null ? String(doc.consultation_fee) : "");
  }, [doctorId, doctors, feeTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setAlts([]);
    if (who === "existing" && !picked) return setErr("Select a patient first.");
    if (who === "new" && !name.trim()) return setErr("Enter the patient's name.");
    if (who === "new" && phone.replace(/\D/g, "").length < 10) return setErr("Enter a 10-digit mobile number so we can send WhatsApp updates.");
    if (!time) return setErr("Pick a time slot.");
    setBusy(true);
    try {
      const r = await authFetch("/api/appointments/book", {
        body: {
          clinicId, date, time, doctorId: doctorId || undefined, mode, symptoms: symptoms.trim() || undefined,
          fee: fee === "" ? undefined : Number(fee),
          patient: who === "existing" ? { id: picked!.id } : { name: name.trim(), phone: phone.trim(), age: age ? Number(age) : undefined, gender: gender || undefined },
        },
      });
      onBooked(date);
      toast("Appointment created successfully");
      const notes: any[] = (r as any).notifications ?? [];
      if (notes.every((n) => n.status === "sent" || n.status === "skipped")) onClose();   // nothing left to read or tap: close the pop-up
      else setDone(r);                                                                     // a WhatsApp message needs a manual send: keep the details open
    } catch (e: any) {
      setErr(e.message);
      if (e.status === 409) { setAlts(e.data?.suggestions ?? []); setTime(""); setReload((n) => n + 1); }
    } finally { setBusy(false); }
  }

  if (done) {
    const d = done.details, a = d.appointment;
    return (
      <Modal title="Appointment booked" onClose={onClose}>
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-4 text-sm">
          <p className="font-semibold text-emerald-800">{d.patient?.name}{d.patient_created ? " · new patient record created" : ""}</p>
          <p className="text-emerald-700 mt-1">📅 {niceDate(a.date)} at {a.time}</p>
          <p className="text-emerald-700">👨‍⚕️ {d.doctor?.name ?? "Duty doctor"}{d.assigned_how === "auto_usual" ? " (patient's usual doctor)" : d.assigned_how === "auto_free" ? " (auto-assigned: first free doctor)" : ""}</p>
          {d.assignment?.new && <p className="text-emerald-700">🔗 Added to {d.doctor?.name}&apos;s patients</p>}
          {d.phone_shared && <p className="text-amber-700 mt-1">ℹ️ This number is shared with another patient, so a separate record was kept.</p>}
        </div>
        <NotificationList items={done.notifications ?? []} />
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold">Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Book appointment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex rounded-xl bg-slate-100 p-1 text-sm">
          {(["new", "existing"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setWho(m)} className={`flex-1 py-1.5 rounded-lg font-medium ${who === m ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
              {m === "new" ? "New / by phone" : "Existing patient"}
            </button>
          ))}
        </div>

        {who === "existing" ? (
          <div className="relative">
            {picked ? (
              <div className="flex items-center justify-between bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
                <div><p className="text-sm font-medium text-sky-800">{picked.name}</p><p className="text-xs text-sky-600">{picked.phone}</p></div>
                <button type="button" onClick={() => { setPicked(null); setSearch(""); }} className="text-sky-400 hover:text-red-500">×</button>
              </div>
            ) : (
              <>
                <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search by name or phone…" className={inputCls} />
                {results.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden max-h-56 overflow-y-auto">
                    {results.map((p) => (
                      <button key={p.id} type="button" onClick={() => { setPicked(p); setResults([]); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-sky-50 border-b border-slate-50 last:border-0">
                        <p className="font-medium text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{p.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className={labelCls}>Patient name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Full name" /></div>
            <div className="col-span-2">
              <label className={labelCls}>Mobile number * <span className="text-slate-400 font-normal">(used for WhatsApp)</span></label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={inputCls} placeholder="98765 43210" />
              {match.length > 0 && (
                <p className="text-xs text-sky-700 bg-sky-50 rounded-lg px-3 py-2 mt-2">
                  This number is already saved for <strong>{match.map((m) => m.name).join(", ")}</strong>.
                  {" "}Same name → the existing record is reused. Different name → a separate record (family phone).
                  {match.length === 1 && <button type="button" onClick={async () => { const { data } = await supabase.from("clinic_patients").select("*").eq("id", match[0].id).maybeSingle(); if (data) { setPicked(data); setWho("existing"); } }} className="ml-1 font-semibold underline">Use {match[0].name}</button>}
                </p>
              )}
            </div>
            <div><label className={labelCls}>Age</label><input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" className={inputCls} /></div>
            <div><label className={labelCls}>Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputCls}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Doctor</label>
            <select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(""); }} className={inputCls}>
              <option value="">Auto-assign (usual doctor, else first free)</option>
              {doctors.filter((d) => d.is_active !== false).map((d) => <option key={d.id} value={d.id}>{d.name}{d.speciality ? ` · ${d.speciality}` : ""}</option>)}
            </select>
          </div>
          <div><label className={labelCls}>Date *</label><input type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} className={inputCls} /></div>
        </div>

        <div>
          <label className={labelCls}>Time slot * <span className="text-slate-400 font-normal">(only free times are shown)</span></label>
          <SlotPicker clinicId={clinicId} date={date} doctorId={doctorId || undefined} value={time} onChange={setTime} reloadKey={reload} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Fee (₹)</label><input type="number" min={0} value={fee} onChange={(e) => { setFee(e.target.value); setFeeTouched(true); }} placeholder="Doctor's default" className={inputCls} /></div>
          <div><label className={labelCls}>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as any)} className={inputCls}><option value="in_clinic">In-clinic</option><option value="video">Video</option></select>
          </div>
        </div>
        <div><label className={labelCls}>Reason / symptoms</label><input value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder="e.g. Tooth pain" className={inputCls} /></div>

        {err && (
          <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg space-y-1">
            <p>{err}</p>
            {alts.slice(0, 3).map((x) => (
              <p key={x.date} className="text-slate-600">Open on <button type="button" onClick={() => { setDate(x.date); setTime(""); }} className="font-semibold underline">{niceDate(x.date)}</button>: {x.slots.slice(0, 4).map((s) => s.time).join(", ")}</p>
            ))}
          </div>
        )}
        <button type="submit" disabled={busy} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors">
          {busy ? "Booking…" : "Book & notify on WhatsApp"}
        </button>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-slate-900 text-lg">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
