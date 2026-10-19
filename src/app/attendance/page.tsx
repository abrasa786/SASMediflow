"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { getMyRoleInClinic } from "@/lib/clinic";
import { todayIso } from "@/lib/format";

const supabase = sb as any;
const tm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }) : "–";
const hrs = (a?: string | null, b?: string | null) => { if (!a || !b) return "–"; const m = Math.round((+new Date(b) - +new Date(a)) / 60000); return `${Math.floor(m / 60)}h ${m % 60}m`; };
const inp = "px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500";

export default function AttendancePage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<any | null>(null);

  const load = useCallback(async (cid: string, user: string, r: string | null, d: string) => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const q = [supabase.from("attendance").select("*").eq("clinic_id", cid).eq("user_id", user).gte("work_date", since).order("work_date", { ascending: false })];
    if (r === "admin") q.push(supabase.from("attendance").select("*").eq("clinic_id", cid).eq("work_date", d), supabase.from("clinic_staff").select("user_id,name,role").eq("clinic_id", cid).eq("is_active", true));
    const res = await Promise.all(q);
    const bad = res.find((x: any) => x.error);
    if (bad) setErr(/does not exist|schema cache/i.test(bad.error.message) ? "Attendance is not installed yet. Run supabase/migrations/006_purchasing_attendance_leave.sql in the Supabase SQL editor." : bad.error.message);
    setMine(res[0].data ?? []);
    if (r === "admin") { setRows(res[1].data ?? []); setStaff(res[2].data ?? []); }
  }, []);

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid);
    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user?.id; if (!u) { router.push("/login"); return; }
      setUid(u);
      const r = await getMyRoleInClinic(cid); setRole(r);
      load(cid, u, r, todayIso());
    })();
  }, [router, load]);
  useEffect(() => { if (clinicId && uid && role === "admin") load(clinicId, uid, role, date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const today = mine.find((m) => m.work_date === todayIso());
  async function act(action: "check_in" | "check_out") {
    setErr(""); setMsg(""); setBusy(true);
    try { const r = await authFetch("/api/attendance", { body: { clinicId, action } }); setMsg(action === "check_in" ? (r.late_minutes ? `Checked in. You are ${r.late_minutes} min late for your shift.` : "Checked in. Have a good day.") : `Checked out. You worked ${r.worked ?? hrs(today?.check_in, new Date().toISOString())}.`); await load(clinicId!, uid!, role, date); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function saveFix() {
    setErr(""); setBusy(true);
    try { await authFetch("/api/attendance", { body: { clinicId, action: "correct", userId: fix.user_id, workDate: date, checkIn: fix.in || null, checkOut: fix.out || null, note: fix.note } }); setFix(null); await load(clinicId!, uid!, role, date); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const byUser = new Map(rows.map((r) => [r.user_id, r]));
  const hhmm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Attendance</h1>
        <p className="text-slate-500 text-sm mt-1 mb-5">Check in when you arrive and out when you leave.</p>
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {msg && <p className="mb-4 text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">{msg}</p>}

        <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Today</p>
            <p className="text-lg font-semibold text-slate-900">{today?.check_in ? (today.check_out ? "Day complete" : "You are checked in") : "Not checked in yet"}</p>
            <p className="text-sm text-slate-500">In {tm(today?.check_in)} · Out {tm(today?.check_out)}{today?.late_minutes ? ` · ${today.late_minutes} min late` : ""}</p>
          </div>
          {!today?.check_in ? <button disabled={busy} onClick={() => act("check_in")} className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60">Check in</button>
            : !today.check_out ? <button disabled={busy} onClick={() => act("check_out")} className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold disabled:opacity-60">Check out</button> : null}
        </div>

        {role === "admin" && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold text-slate-900">Team on {date === todayIso() ? "today" : date}</h2>
              <input type="date" className={inp} value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="Date" /></div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500 bg-slate-50"><th className="px-4 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Role</th><th className="px-2 py-2 font-medium">In</th><th className="px-2 py-2 font-medium">Out</th><th className="px-2 py-2 font-medium">Hours</th><th className="px-2 py-2 font-medium">Status</th><th className="px-4" /></tr></thead>
              <tbody className="divide-y divide-slate-100">{staff.map((s) => { const r = byUser.get(s.user_id); return (
                <tr key={s.user_id}><td className="px-4 py-2.5 font-medium text-slate-800">{s.name ?? "Unnamed"}</td><td className="px-2 capitalize text-slate-500">{s.role}</td>
                  <td className="px-2 tabular-nums">{tm(r?.check_in)}</td><td className="px-2 tabular-nums">{tm(r?.check_out)}</td><td className="px-2 tabular-nums">{hrs(r?.check_in, r?.check_out)}</td>
                  <td className="px-2">{r?.check_in ? (r.late_minutes ? <span className="text-amber-700">Late {r.late_minutes}m</span> : <span className="text-emerald-700">Present</span>) : <span className="text-slate-400">Absent</span>}</td>
                  <td className="px-4 text-right"><button className="text-xs text-sky-700 hover:underline" onClick={() => setFix({ user_id: s.user_id, name: s.name, in: hhmm(r?.check_in), out: hhmm(r?.check_out), note: r?.note ?? "" })}>Correct</button></td></tr>); })}</tbody></table></div>
          </section>
        )}

        <section>
          <h2 className="font-semibold text-slate-900 mb-3">My last 30 days</h2>
          {mine.length === 0 ? <p className="text-sm text-slate-400">No records yet.</p> :
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto"><table className="w-full text-sm"><tbody className="divide-y divide-slate-100">{mine.map((m) => (
              <tr key={m.id}><td className="px-4 py-2.5 text-slate-700">{new Date(m.work_date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</td>
                <td className="px-2 tabular-nums">{tm(m.check_in)} – {tm(m.check_out)}</td><td className="px-2 tabular-nums text-slate-500">{hrs(m.check_in, m.check_out)}</td>
                <td className="px-4 text-right text-xs">{m.late_minutes ? <span className="text-amber-700">Late {m.late_minutes}m</span> : ""}{m.source === "admin" ? <span className="text-slate-400 ml-2">corrected</span> : ""}</td></tr>))}</tbody></table></div>}
        </section>
      </div>

      {fix && <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"><div className="bg-white rounded-2xl p-6 w-full max-w-sm">
        <h2 className="font-bold text-slate-900 mb-1">Correct attendance</h2><p className="text-sm text-slate-500 mb-4">{fix.name} · {date}</p>
        <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-600">Check in<input type="time" className={inp + " w-full mt-1"} value={fix.in} onChange={(e) => setFix({ ...fix, in: e.target.value })} /></label>
          <label className="text-xs text-slate-600">Check out<input type="time" className={inp + " w-full mt-1"} value={fix.out} onChange={(e) => setFix({ ...fix, out: e.target.value })} /></label></div>
        <label className="text-xs text-slate-600 block mt-3">Reason<input className={inp + " w-full mt-1"} value={fix.note} onChange={(e) => setFix({ ...fix, note: e.target.value })} /></label>
        <div className="flex justify-end gap-2 mt-4"><button onClick={() => setFix(null)} className="px-4 py-2 rounded-xl border border-slate-200 text-sm">Cancel</button><button disabled={busy} onClick={saveFix} className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">Save</button></div>
      </div></div>}
    </AppShell>
  );
}
