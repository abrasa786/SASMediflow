"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { todayIso, dayLabel } from "@/lib/format";
import { inputCls as inp } from "@/components/ui";

const supabase = sb as any;
const dayLabelNoYear = (s: string) => dayLabel(s, false);
const ST: Record<string, string> = { pending: "bg-amber-100 text-amber-800", approved: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700", cancelled: "bg-slate-100 text-slate-500" };

export default function LeavePage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [bal, setBal] = useState<any>({});
  const [mine, setMine] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [f, setF] = useState({ leaveType: "casual", fromDate: todayIso(), toDate: todayIso(), halfDay: false, reason: "" });
  const [err, setErr] = useState(""); const [msg, setMsg] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(async (cid: string, user: string) => {
    try {
      const b = await authFetch(`/api/leave?clinicId=${cid}`, { method: "GET" });
      setBal(b.balance ?? {}); setRole(b.role);
      const q: any[] = [supabase.from("staff_leaves").select("*").eq("clinic_id", cid).eq("user_id", user).order("from_date", { ascending: false }).limit(50)];
      if (b.role === "admin") q.push(supabase.from("staff_leaves").select("*").eq("clinic_id", cid).eq("status", "pending").order("from_date"), supabase.from("clinic_staff").select("user_id,name").eq("clinic_id", cid));
      const res = await Promise.all(q);
      setMine(res[0].data ?? []);
      if (b.role === "admin") { setQueue(res[1].data ?? []); setNames(Object.fromEntries((res[2].data ?? []).map((s: any) => [s.user_id, s.name ?? "Unnamed"]))); }
    } catch (e: any) { setErr(/does not exist|schema cache|function/i.test(e.message) ? "Leave is not installed yet. Run supabase/migrations/006_purchasing_attendance_leave.sql in the Supabase SQL editor." : e.message); }
  }, []);

  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid);
    supabase.auth.getUser().then(({ data }: any) => { const u = data?.user?.id; if (!u) router.push("/login"); else { setUid(u); load(cid, u); } });
  }, [router, load]);

  async function submit() {
    setErr(""); setMsg([]);
    if (f.toDate < f.fromDate) return setErr("The end date is before the start date.");
    setBusy(true);
    try { const r = await authFetch("/api/leave", { body: { clinicId, action: "request", ...f, toDate: f.halfDay ? f.fromDate : f.toDate } }); setMsg([`Request sent for ${r.days} day${r.days === 1 ? "" : "s"}. The admin will approve or reject it.`]); setF({ ...f, reason: "" }); await load(clinicId!, uid!); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function decide(l: any, status: "approved" | "rejected") {
    setErr(""); setMsg([]);
    try {
      const r = await authFetch("/api/leave", { body: { clinicId, action: "decide", leaveId: l.id, status, note: note[l.id] || null } });
      const n = r.appointments_to_move?.length ?? 0;
      setMsg([`${names[l.user_id] ?? "Leave"} ${status}.`, ...(n ? [`${n} appointment${n > 1 ? "s" : ""} fall in these dates and need to be rescheduled (see Appointments).`] : [])]);
      await load(clinicId!, uid!);
    } catch (e: any) { setErr(e.message); }
  }
  async function cancel(l: any) { setErr(""); try { await authFetch("/api/leave", { body: { clinicId, action: "cancel", leaveId: l.id } }); await load(clinicId!, uid!); } catch (e: any) { setErr(e.message); } }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Leave</h1>
        <p className="text-slate-500 text-sm mt-1 mb-5">Request time off and track your balance.</p>
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {msg.length > 0 && <div className="mb-4 text-sm text-emerald-900 bg-emerald-50 rounded-lg px-3 py-2" role="status">{msg.map((m, i) => <p key={i}>{m}</p>)}</div>}

        <div className="grid grid-cols-3 gap-3 mb-6">{["casual", "sick", "earned"].map((t) => (
          <div key={t} className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">{t}</p>
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{bal[t]?.left ?? "–"}<span className="text-sm font-normal text-slate-400"> of {bal[t]?.quota ?? "–"} left</span></p></div>))}</div>

        {role === "admin" && queue.length > 0 && (
          <section className="mb-8"><h2 className="font-semibold text-slate-900 mb-3">Waiting for your decision ({queue.length})</h2>
            <div className="space-y-3">{queue.map((l) => (
              <div key={l.id} className="bg-white rounded-xl border border-amber-200 p-4">
                <p className="font-medium text-slate-900">{names[l.user_id] ?? "Staff"} <span className="text-slate-500 font-normal">· {l.leave_type} · {dayLabelNoYear(l.from_date)}{l.to_date !== l.from_date ? ` – ${dayLabelNoYear(l.to_date)}` : ""} · {l.days} day{l.days === 1 ? "" : "s"}{l.half_day ? " (half day)" : ""}</span></p>
                {l.reason && <p className="text-sm text-slate-600 mt-1">“{l.reason}”</p>}
                <div className="flex flex-wrap gap-2 mt-3"><input className={inp + " flex-1 min-w-[10rem]"} placeholder="Note (optional)" value={note[l.id] ?? ""} onChange={(e) => setNote({ ...note, [l.id]: e.target.value })} />
                  <button onClick={() => decide(l, "approved")} className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Approve</button>
                  <button onClick={() => decide(l, "rejected")} className="px-4 py-2 rounded-xl border border-red-300 text-red-700 text-sm font-semibold">Reject</button></div>
              </div>))}</div></section>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <section className="bg-white rounded-2xl border border-slate-200 p-5 h-fit">
            <h2 className="font-semibold text-slate-900 mb-3">Request leave</h2>
            <div className="space-y-3">
              <label className="block text-xs text-slate-600">Type<select className={inp + " mt-1"} value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value })}>{["casual", "sick", "earned", "unpaid", "other"].map((t) => <option key={t}>{t}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-slate-600">From<input type="date" className={inp + " mt-1"} value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value, toDate: e.target.value > f.toDate ? e.target.value : f.toDate })} /></label>
                <label className="block text-xs text-slate-600">To<input type="date" className={inp + " mt-1"} disabled={f.halfDay} min={f.fromDate} value={f.halfDay ? f.fromDate : f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></label></div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked })} /> Half day</label>
              <label className="block text-xs text-slate-600">Reason<input className={inp + " mt-1"} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
              <button onClick={submit} disabled={busy} className="w-full px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Sending…" : "Send request"}</button>
            </div>
          </section>
          <section><h2 className="font-semibold text-slate-900 mb-3">My requests</h2>
            {mine.length === 0 ? <p className="text-sm text-slate-400">No leave requested yet.</p> : <div className="space-y-2">{mine.map((l) => (
              <div key={l.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-medium text-slate-800 capitalize">{l.leave_type} · {dayLabelNoYear(l.from_date)}{l.to_date !== l.from_date ? ` – ${dayLabelNoYear(l.to_date)}` : ""} <span className="text-slate-400 font-normal">({l.days}d)</span></p>
                  {l.decision_note && <p className="text-xs text-slate-500">Note: {l.decision_note}</p>}</div>
                <div className="text-right shrink-0"><span className={`text-xs px-2 py-0.5 rounded-full ${ST[l.status]}`}>{l.status}</span>
                  {(l.status === "pending" || (l.status === "approved" && l.to_date >= todayIso())) && <button onClick={() => cancel(l)} className="block ml-auto mt-1 text-xs text-red-600 hover:underline">Cancel</button>}</div>
              </div>))}</div>}</section>
        </div>
      </div>
    </AppShell>
  );
}
