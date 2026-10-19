"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { todayIso } from "@/lib/clinic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // show Monday first
const inputCls = "px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500";

interface Row { weekday: number; on: boolean; start: string; end: string; break_start: string; break_end: string }
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "");
const blank = (): Row[] => ORDER.map((w) => ({ weekday: w, on: w !== 0, start: "09:00", end: "17:00", break_start: "", break_end: "" }));

function rowsFor(schedules: any[], doctorId: string): Row[] {
  const mine = schedules.filter((s) => s.doctor_id === doctorId && s.is_active !== false);
  if (!mine.length) return blank();
  return ORDER.map((w) => {
    const s = mine.find((x) => x.weekday === w);
    return s ? { weekday: w, on: true, start: hhmm(s.start_time), end: hhmm(s.end_time), break_start: hhmm(s.break_start), break_end: hhmm(s.break_end) }
             : { weekday: w, on: false, start: "09:00", end: "17:00", break_start: "", break_end: "" };
  });
}

export default function AvailabilityPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [data, setData] = useState<any>(null);
  const [doctorId, setDoctorId] = useState("");
  const [rows, setRows] = useState<Row[]>(blank());
  const [slot, setSlot] = useState(""); const [fee, setFee] = useState(""); const [phone, setPhone] = useState("");
  const [lFrom, setLFrom] = useState(todayIso()); const [lTo, setLTo] = useState(todayIso()); const [lWhy, setLWhy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (id: string) => {
    try {
      const d = await authFetch(`/api/doctors/availability?clinicId=${id}`);
      setData(d);
      setDoctorId((cur) => cur || d.doctors.find((x: any) => x.user_id === d.userId)?.id || d.doctors[0]?.id || "");
    } catch (e: any) { setErr(e.message); }
  }, []);

  useEffect(() => { const id = getActiveClinicId(); if (!id) { router.push("/login"); return; } setClinicId(id); load(id); }, [router, load]);

  const doc = data?.doctors.find((d: any) => d.id === doctorId);
  useEffect(() => {
    if (!data || !doc) return;
    setRows(rowsFor(data.schedules, doc.id));
    setSlot(doc.slot_minutes ? String(doc.slot_minutes) : ""); setFee(doc.consultation_fee != null ? String(doc.consultation_fee) : ""); setPhone(doc.phone ?? "");
  }, [data, doctorId]); // eslint-disable-line

  const canEdit = !!doc && (data?.role === "admin" || (data?.role === "doctor" && doc.user_id === data?.userId));
  const upd = (w: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.weekday === w ? { ...r, ...patch } : r)));

  async function post(body: any, ok: string) {
    setBusy(true); setMsg(null);
    try { const r = await authFetch("/api/doctors/availability", { body: { clinicId, doctorId, ...body } }); await load(clinicId); setMsg({ ok: true, text: ok }); return r; }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  async function saveSchedule() {
    for (const r of rows) if (r.on) {
      if (!r.start || !r.end || r.end <= r.start) return setMsg({ ok: false, text: `${DAYS[r.weekday]}: the end time must be after the start time.` });
      if ((r.break_start === "") !== (r.break_end === "")) return setMsg({ ok: false, text: `${DAYS[r.weekday]}: a break needs both a start and an end.` });
      if (r.break_start && (r.break_end <= r.break_start || r.break_start < r.start || r.break_end > r.end)) return setMsg({ ok: false, text: `${DAYS[r.weekday]}: the break must sit inside working hours.` });
    }
    await post({ action: "set_schedule", rows: rows.filter((r) => r.on).map((r) => ({ weekday: r.weekday, start: r.start, end: r.end, break_start: r.break_start || null, break_end: r.break_end || null })) }, "Weekly schedule saved. New bookings follow it immediately.");
  }
  const saveProfile = () => post({ action: "update_doctor", consultation_fee: fee === "" ? undefined : Number(fee), slot_minutes: slot === "" ? null : Number(slot), phone }, "Doctor details saved.");
  async function addLeave() {
    if (lTo < lFrom) return setMsg({ ok: false, text: "The end date can't be before the start date." });
    const r = await post({ action: "add_leave", fromDate: lFrom, toDate: lTo, reason: lWhy }, "Leave added. No new bookings can be made in that period.");
    if (r?.affectedAppointments) setMsg({ ok: true, text: `Leave added. ${r.affectedAppointments} existing confirmed appointment(s) fall in that period. Reschedule or cancel them from the Appointments page.` });
    setLWhy("");
  }

  const myLeaves = (data?.leaves ?? []).filter((l: any) => l.doctor_id === doctorId);

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Doctor availability</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">Working days, breaks, slot length and leave. Booking, the assistant and rescheduling only offer times that fit this.</p>

        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">{err}</p>}
        {!data && !err && <p className="text-sm text-slate-400">Loading…</p>}

        {data && (
          <>
            <div className="mb-5">
              <label className="text-xs font-medium text-slate-600 block mb-1">Doctor</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={`${inputCls} w-full sm:w-80`}>
                {data.doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}{d.is_active === false ? " (inactive)" : ""}</option>)}
              </select>
              {!canEdit && doc && <p className="text-xs text-amber-700 mt-2">You can view this schedule but only an admin or the doctor themselves can change it.</p>}
            </div>

            {msg && <p className={`text-sm rounded-xl px-4 py-3 mb-4 ${msg.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"}`}>{msg.text}</p>}

            {doc && (
              <fieldset disabled={!canEdit || busy} className="space-y-6">
                <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                  <h2 className="font-semibold text-slate-900 mb-3">Weekly schedule</h2>
                  <div className="space-y-2 overflow-x-auto">
                    {rows.map((r) => (
                      <div key={r.weekday} className="grid grid-cols-[110px_1fr] sm:grid-cols-[110px_auto_auto] items-center gap-3 min-w-[560px]">
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          <input type="checkbox" checked={r.on} onChange={(e) => upd(r.weekday, { on: e.target.checked })} /> {DAYS[r.weekday]}
                        </label>
                        {r.on ? (
                          <>
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                              <input type="time" value={r.start} onChange={(e) => upd(r.weekday, { start: e.target.value })} className={inputCls} /> to
                              <input type="time" value={r.end} onChange={(e) => upd(r.weekday, { end: e.target.value })} className={inputCls} />
                            </div>
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                              Break <input type="time" value={r.break_start} onChange={(e) => upd(r.weekday, { break_start: e.target.value })} className={inputCls} /> to
                              <input type="time" value={r.break_end} onChange={(e) => upd(r.weekday, { break_end: e.target.value })} className={inputCls} />
                            </div>
                          </>
                        ) : <span className="text-sm text-slate-400 col-span-2">Day off</span>}
                      </div>
                    ))}
                  </div>
                  <button onClick={saveSchedule} className="mt-4 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">Save schedule</button>
                  <p className="text-xs text-slate-400 mt-2">Doctors with no saved schedule follow the clinic&apos;s working hours.</p>
                </section>

                <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                  <h2 className="font-semibold text-slate-900 mb-3">Slot length, fee and WhatsApp number</h2>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <div><label className="text-xs font-medium text-slate-600 block mb-1">Slot length (minutes)</label><input type="number" min={5} max={120} value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="Clinic default" className={`${inputCls} w-full`} /></div>
                    <div><label className="text-xs font-medium text-slate-600 block mb-1">Consultation fee (₹)</label><input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} className={`${inputCls} w-full`} /></div>
                    <div><label className="text-xs font-medium text-slate-600 block mb-1">Doctor&apos;s mobile</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="For booking alerts" className={`${inputCls} w-full`} /></div>
                  </div>
                  <button onClick={saveProfile} className="mt-4 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">Save details</button>
                </section>

                <section className="bg-white border border-slate-100 rounded-2xl shadow-sm p-5">
                  <h2 className="font-semibold text-slate-900 mb-3">Leave</h2>
                  <div className="flex flex-wrap items-end gap-3">
                    <div><label className="text-xs font-medium text-slate-600 block mb-1">From</label><input type="date" min={todayIso()} value={lFrom} onChange={(e) => { setLFrom(e.target.value); if (lTo < e.target.value) setLTo(e.target.value); }} className={inputCls} /></div>
                    <div><label className="text-xs font-medium text-slate-600 block mb-1">To</label><input type="date" min={lFrom} value={lTo} onChange={(e) => setLTo(e.target.value)} className={inputCls} /></div>
                    <div className="flex-1 min-w-[160px]"><label className="text-xs font-medium text-slate-600 block mb-1">Reason</label><input value={lWhy} onChange={(e) => setLWhy(e.target.value)} placeholder="Optional" className={`${inputCls} w-full`} /></div>
                    <button onClick={addLeave} className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-semibold">Add leave</button>
                  </div>
                  <div className="mt-4 divide-y divide-slate-50">
                    {myLeaves.length === 0 && <p className="text-sm text-slate-400">No upcoming leave.</p>}
                    {myLeaves.map((l: any) => (
                      <div key={l.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="text-slate-700">{l.from_date}{l.to_date !== l.from_date ? ` → ${l.to_date}` : ""}{l.reason ? ` · ${l.reason}` : ""}</span>
                        <button onClick={() => post({ action: "remove_leave", leaveId: l.id }, "Leave removed.")} className="text-xs text-red-600 hover:underline">Remove</button>
                      </div>
                    ))}
                  </div>
                </section>
              </fieldset>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
