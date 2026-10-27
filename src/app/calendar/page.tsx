"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getAppointments, getClinic, todayIso } from "@/lib/clinic";
import type { Appointment, Clinic } from "@/types";

interface Doc { id: string; name: string; specialty?: string; speciality?: string; is_active?: boolean }
interface Sched { doctor_id: string; weekday: number; start_time: string; end_time: string; break_start: string | null; break_end: string | null; is_active: boolean }
interface Leave { doctor_id: string; from_date: string; to_date: string; reason?: string }

const PX = 1.4;                       // pixels per minute
const toMin = (t?: string | null) => { if (!t) return 0; const [h, m] = t.split(":"); return Number(h) * 60 + Number(m); };
const hhmm = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? "PM" : "AM"; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${ap}`; };
const shift = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const niceDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const COLORS = [
  { bg: "bg-sky-100", border: "border-sky-400", text: "text-sky-900", dot: "bg-sky-500" },
  { bg: "bg-orange-100", border: "border-orange-400", text: "text-orange-900", dot: "bg-orange-500" },
  { bg: "bg-violet-100", border: "border-violet-400", text: "text-violet-900", dot: "bg-violet-500" },
  { bg: "bg-emerald-100", border: "border-emerald-400", text: "text-emerald-900", dot: "bg-emerald-500" },
];
const HATCH = { backgroundImage: "repeating-linear-gradient(45deg, rgba(148,163,184,.28) 0 6px, transparent 6px 12px)" } as const;

export default function CalendarPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [date, setDate] = useState(todayIso());
  const [docs, setDocs] = useState<Doc[]>([]);
  const [sched, setSched] = useState<Sched[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [sel, setSel] = useState<Appointment | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    getClinic(id).then(setClinic);
    authFetch(`/api/doctors/availability?clinicId=${id}`)
      .then((r) => { setDocs((r.doctors ?? []).filter((d: Doc) => d.is_active !== false)); setSched(r.schedules ?? []); setLeaves(r.leaves ?? []); })
      .catch((e) => setErr(e.message));
  }, [router]);

  const loadDay = useCallback(async () => {
    if (!clinicId) return;
    setLoading(true); setSel(null);
    try { setAppts(await getAppointments(clinicId, date)); } finally { setLoading(false); }
  }, [clinicId, date]);
  useEffect(() => { loadDay(); }, [loadDay]);

  const wd = new Date(date + "T00:00:00Z").getUTCDay();

  /** open/close and break for one doctor on this weekday (personal schedule, else the clinic's hours). */
  const hoursFor = useCallback((doctorId: string) => {
    const mine = sched.filter((s) => s.doctor_id === doctorId && s.is_active);
    if (mine.length) {
      const todays = mine.filter((s) => s.weekday === wd);
      if (!todays.length) return { open: null as number | null, close: null as number | null, brk: null as [number, number] | null, source: "schedule" };
      const s = todays[0];
      return { open: toMin(s.start_time), close: toMin(s.end_time), brk: s.break_start ? [toMin(s.break_start), toMin(s.break_end)] as [number, number] : null, source: "schedule" };
    }
    const wh: any = (clinic as any)?.working_hours;
    const dayName = new Date(date + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    if (!wh || !(wh.days ?? []).includes(dayName)) return { open: null, close: null, brk: null, source: "clinic" };
    return { open: toMin(wh.open ?? "09:00"), close: toMin(wh.close ?? "18:00"), brk: null, source: "clinic" };
  }, [sched, wd, clinic, date]);

  const onLeave = (doctorId: string) => leaves.find((l) => l.doctor_id === doctorId && date >= l.from_date && date <= l.to_date);

  // visible time window
  const { start, end } = useMemo(() => {
    let lo = 9 * 60, hi = 18 * 60;
    docs.forEach((d) => { const h = hoursFor(d.id); if (h.open != null) { lo = Math.min(lo, h.open); hi = Math.max(hi, h.close!); } });
    appts.forEach((a) => { if (a.start_time) { lo = Math.min(lo, toMin(a.start_time)); hi = Math.max(hi, toMin(a.end_time ?? a.start_time) || toMin(a.start_time) + 30); } });
    return { start: Math.floor(lo / 60) * 60, end: Math.ceil(hi / 60) * 60 };
  }, [docs, appts, hoursFor]);
  const height = (end - start) * PX;
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const isToday = date === todayIso();

  const active = appts.filter((a) => a.status !== "cancelled");
  const how = (a: any) => a.assigned_by === "auto_usual" ? "Auto-assigned: the patient's usual doctor was free" : a.assigned_by === "auto_free" ? "Auto-assigned: usual doctor was busy, so the first free doctor" : a.assigned_by === "manual" ? "Chosen by staff" : null;

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div><h1 className="text-2xl font-bold text-slate-900">Calendar</h1><p className="text-slate-500 text-sm mt-1">{niceDate(date)}</p></div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDate(shift(date, -1))} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Previous day">←</button>
            <button onClick={() => setDate(todayIso())} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium">Today</button>
            <button onClick={() => setDate(shift(date, 1))} className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50" aria-label="Next day">→</button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white" aria-label="Pick a date" />
          </div>
        </div>
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}

        {docs.length === 0 && !err ? (
          <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
            <p className="font-semibold text-slate-800">No doctors yet</p>
            <p className="text-sm text-slate-500 mt-1">Add your doctors, then set their weekly hours. The calendar shows each doctor in their own column.</p>
            <Link href="/setup" className="inline-block mt-4 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Open setup checklist</Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_300px] gap-5 items-start">
            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
              <div className="min-w-[520px]">
                <div className="flex border-b border-slate-200 sticky top-0 bg-white z-10">
                  <div className="w-16 shrink-0" />
                  {docs.map((d, i) => {
                    const lv = onLeave(d.id), h = hoursFor(d.id);
                    return (
                      <div key={d.id} className="flex-1 min-w-[150px] px-3 py-2.5 border-l border-slate-100">
                        <p className="font-semibold text-sm text-slate-900 flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${COLORS[i % 4].dot}`} />{d.name}</p>
                        <p className="text-xs text-slate-500">{lv ? "On leave" : h.open == null ? "Not working today" : `${hhmm(h.open)} – ${hhmm(h.close!)}`}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="flex relative" style={{ height }}>
                  <div className="w-16 shrink-0 relative">
                    {hours.map((m) => <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums" style={{ top: (m - start) * PX }}>{hhmm(m)}</span>)}
                  </div>
                  {docs.map((d, i) => {
                    const lv = onLeave(d.id), h = hoursFor(d.id), c = COLORS[i % 4];
                    const mine = active.filter((a) => a.doctor_id === d.id && a.start_time);
                    return (
                      <div key={d.id} className="flex-1 min-w-[150px] relative border-l border-slate-100">
                        {hours.map((m) => <div key={m} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (m - start) * PX }} />)}
                        {/* closed / break areas */}
                        {(lv || h.open == null) ? <div className="absolute inset-0" style={HATCH} /> : <>
                          {h.open > start && <div className="absolute inset-x-0" style={{ top: 0, height: (h.open - start) * PX, ...HATCH }} />}
                          {h.close! < end && <div className="absolute inset-x-0" style={{ top: (h.close! - start) * PX, height: (end - h.close!) * PX, ...HATCH }} />}
                          {h.brk && <div className="absolute inset-x-0 flex items-center justify-center text-[11px] text-slate-500" style={{ top: (h.brk[0] - start) * PX, height: (h.brk[1] - h.brk[0]) * PX, ...HATCH }}>Break</div>}
                        </>}
                        {lv && <div className="absolute inset-x-2 top-3 text-xs text-center text-slate-600 bg-white/90 rounded-md py-1 border border-slate-200">On leave{lv.reason ? ` · ${lv.reason}` : ""}</div>}
                        {isToday && nowMin >= start && nowMin <= end && <div className="absolute inset-x-0 border-t-2 border-red-400 z-[5]" style={{ top: (nowMin - start) * PX }} />}
                        {mine.map((a) => {
                          const s = toMin(a.start_time), e = Math.max(toMin(a.end_time), s + 15);
                          const picked = sel?.id === a.id;
                          return (
                            <button key={a.id} onClick={() => router.push(`/appointments/${a.id}`)} onMouseEnter={() => setSel(a)} onFocus={() => setSel(a)}
                              className={`absolute inset-x-1 rounded-lg border-l-4 ${c.bg} ${c.border} ${c.text} px-2 py-1 text-left overflow-hidden z-[6] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-sky-500 ${a.status === "completed" ? "opacity-70" : ""} ${picked ? "ring-2 ring-slate-900" : ""}`}
                              style={{ top: (s - start) * PX, height: Math.max((e - s) * PX - 2, 22) }}
                              aria-label={`${a.patient?.name ?? "Patient"} at ${hhmm(s)}`}>
                              <p className="text-xs font-semibold truncate">{a.patient?.name ?? "Patient"}</p>
                              <p className="text-[11px] opacity-80 truncate">{hhmm(s)}{a.status === "completed" ? " · done" : ""}{(a as any).assigned_by?.startsWith("auto") ? " · auto" : ""}</p>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                {sel ? (
                  <>
                    <p className="font-bold text-slate-900">{sel.patient?.name ?? "Patient"}</p>
                    <p className="text-sm text-slate-600">{hhmm(toMin(sel.start_time))}{sel.end_time ? ` – ${hhmm(toMin(sel.end_time))}` : ""} · {sel.doctor_name}</p>
                    {sel.symptoms && <p className="text-sm text-slate-700 mt-2">{sel.symptoms}</p>}
                    <p className="text-xs mt-2"><span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{sel.status}</span></p>
                    {how(sel) && <p className="text-xs text-slate-600 mt-3 bg-sky-50 rounded-lg px-2.5 py-2">🧭 {how(sel)}</p>}
                    <Link href={`/appointments/${sel.id}`} className="mt-3 inline-block px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold">Open full details →</Link>
                    <Link href="/appointments" className="mt-3 ml-3 inline-block text-sm text-sky-700 hover:underline">Move, cancel or message</Link>
                  </>
                ) : <p className="text-sm text-slate-500">Click an appointment to open its full details: patient summary, treatment, notes and invoice. Hover to preview it here.</p>}
              </div>
              <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm">
                <p className="font-semibold text-slate-800 mb-2">Today at a glance</p>
                {docs.map((d, i) => { const n = active.filter((a) => a.doctor_id === d.id).length; return <p key={d.id} className="flex justify-between text-slate-600"><span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${COLORS[i % 4].dot}`} />{d.name}</span><span className="tabular-nums">{n} booked</span></p>; })}
                <p className="mt-3 text-xs text-slate-500 flex items-center gap-2"><span className="inline-block w-5 h-3 rounded-sm border border-slate-300" style={HATCH} /> Closed, break or leave</p>
                {loading && <p className="text-xs text-slate-400 mt-2">Loading…</p>}
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
