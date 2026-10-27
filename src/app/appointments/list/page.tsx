"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { supabase as sb } from "@/lib/supabase";
import { getClinicDoctors } from "@/lib/clinic";
import type { Doctor } from "@/types";

const supabase = sb as any;
const PAGE = 30;
const STATUS: Record<string, string> = { confirmed: "bg-sky-100 text-sky-700", completed: "bg-emerald-100 text-emerald-700", cancelled: "bg-red-100 text-red-600", no_show: "bg-amber-100 text-amber-700" };
const BILL: Record<string, string> = { invoiced: "Invoiced", part_paid: "Part paid", paid: "Paid & settled" };
const inp = "px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500";
const nice = (d: string, t: string) => { try { return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) + ", " + t; } catch { return `${d} ${t}`; } };
const clean = (s: string) => s.replace(/[,()%\\]/g, " ").trim();

/** Every appointment, newest booking first, with the fields people look for and a search that reaches the patient, the number, the bill and the complaint. */
export default function AppointmentList() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [q, setQ] = useState(""); const [term, setTerm] = useState("");
  const [status, setStatus] = useState(""); const [doctor, setDoctor] = useState(""); const [bill, setBill] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [more, setMore] = useState(false); const [loading, setLoading] = useState(true); const [err, setErr] = useState("");

  useEffect(() => { const id = getActiveClinicId(); if (!id) { router.push("/login"); return; } setClinicId(id); getClinicDoctors(id).then(setDoctors).catch(() => {}); }, [router]);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async (offset: number) => {
    if (!clinicId) return;
    setLoading(true); setErr("");
    try {
      let query = supabase.from("appointments")
        .select("id, appt_no, appointment_date, appointment_time, status, billing_status, symptoms, created_at, clinic_patients(id, name, phone), doctors(name)")
        .eq("clinic_id", clinicId).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
      if (status) query = query.eq("status", status);
      if (doctor) query = query.eq("doctor_id", doctor);
      if (bill) query = query.eq("billing_status", bill);
      if (from) query = query.gte("appointment_date", from);
      if (to) query = query.lte("appointment_date", to);
      if (term) {
        const t = clean(term), like = `%${t}%`, digits = t.replace(/\D/g, "");
        const [p, i] = await Promise.all([
          supabase.from("clinic_patients").select("id").eq("clinic_id", clinicId).or(digits.length >= 4 ? `name.ilike.${like},phone_norm.ilike.%${digits}%` : `name.ilike.${like}`).limit(200),
          supabase.from("invoices").select("appointment_id").eq("clinic_id", clinicId).ilike("invoice_number", like).not("appointment_id", "is", null).limit(200),
        ]);
        const pids = (p.data ?? []).map((x: any) => x.id), aids = (i.data ?? []).map((x: any) => x.appointment_id);
        const parts = [`symptoms.ilike.${like}`, `appt_no.ilike.${like}`];
        if (pids.length) parts.push(`clinic_patient_id.in.(${pids.join(",")})`);
        if (aids.length) parts.push(`id.in.(${aids.join(",")})`);
        query = query.or(parts.join(","));
      }
      let { data, error } = await query;
      if (error && /appt_no/.test(error.message)) {            // migration 029 not run yet: list without the number
        setErr("Run migration 029 to get appointment numbers (APT-00001). The list works without it.");
        let q2 = supabase.from("appointments").select("id, appointment_date, appointment_time, status, billing_status, symptoms, created_at, clinic_patients(id, name, phone), doctors(name)").eq("clinic_id", clinicId).order("created_at", { ascending: false }).range(offset, offset + PAGE - 1);
        if (status) q2 = q2.eq("status", status); if (doctor) q2 = q2.eq("doctor_id", doctor); if (from) q2 = q2.gte("appointment_date", from); if (to) q2 = q2.lte("appointment_date", to);
        ({ data, error } = await q2);
      } else if (error && /billing_status/.test(error.message)) { setErr("Run migration 025 for the bill filter."); }
      if (error) throw error;
      const list: any[] = data ?? [];
      const inv = list.length ? await supabase.from("invoices").select("appointment_id, invoice_number, id").in("appointment_id", list.map((a) => a.id)).neq("status", "cancelled") : { data: [] };
      const byAppt: Record<string, any[]> = {};
      for (const v of inv.data ?? []) (byAppt[v.appointment_id] ??= []).push(v);
      const withInv = list.map((a) => ({ ...a, invoices: byAppt[a.id] ?? [] }));
      setRows((r) => (offset === 0 ? withInv : [...r, ...withInv])); setMore(list.length === PAGE);
    } catch (e: any) { setErr(e.message ?? "Could not load appointments."); }
    setLoading(false);
  }, [clinicId, term, status, doctor, bill, from, to]);
  useEffect(() => { load(0); }, [load]);

  const clear = () => { setQ(""); setStatus(""); setDoctor(""); setBill(""); setFrom(""); setTo(""); };
  const filtered = !!(q || status || doctor || bill || from || to);

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h1 className="text-2xl font-bold text-slate-900">All appointments</h1><p className="text-sm text-slate-500 mt-0.5">Newest bookings first</p></div>
          <div className="flex gap-2">
            <Link href="/appointments" className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50">Day view</Link>
            <Link href="/appointments?new=1" className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold">+ Book</Link>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, phone, APT number, bill number, issue…" aria-label="Search appointments" className={`${inp} flex-1 min-w-[220px]`} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className={inp}><option value="">Any status</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option><option value="no_show">No-show</option></select>
          <select value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Doctor" className={inp}><option value="">Any doctor</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select value={bill} onChange={(e) => setBill(e.target.value)} aria-label="Billing" className={inp}><option value="">Any billing</option><option value="none">Not billed</option><option value="invoiced">Invoiced</option><option value="part_paid">Part paid</option><option value="paid">Paid &amp; settled</option></select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Appointment from" className={inp} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Appointment to" className={inp} />
          {filtered && <button onClick={clear} className="px-3 py-2 text-sm text-sky-700 hover:bg-sky-50 rounded-xl">Clear</button>}
        </div>
        {err && <p className="mb-3 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{err}</p>}

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              {["Appointment", "Patient", "Date & time", "Doctor", "Invoice", "Issue", "Status"].map((h) => <th key={h} className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/appointments/${a.id}`)} className="border-b border-slate-50 hover:bg-sky-50/50 cursor-pointer">
                  <td className="px-4 py-3 whitespace-nowrap"><Link href={`/appointments/${a.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-sky-700 hover:underline">{a.appt_no ?? a.id.slice(0, 8)}</Link></td>
                  <td className="px-4 py-3"><p className="font-medium text-slate-900">{a.clinic_patients?.name ?? "—"}</p><p className="text-xs text-slate-500">{a.clinic_patients?.phone ?? ""}</p></td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">{nice(a.appointment_date, a.appointment_time)}</td>
                  <td className="px-4 py-3 text-slate-700">{a.doctors?.name ?? "Duty doctor"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{a.invoices.length ? a.invoices.map((v: any) => <Link key={v.id} href={`/billing/${v.id}`} onClick={(e) => e.stopPropagation()} className="block text-sky-700 hover:underline">{v.invoice_number}</Link>) : <span className="text-slate-400">—</span>}{BILL[a.billing_status] && <span className="text-xs text-slate-500">{BILL[a.billing_status]}</span>}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[260px] truncate" title={a.symptoms ?? ""}>{a.symptoms || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS[a.status] ?? "bg-gray-100 text-gray-500"}`}>{String(a.status).replace("_", " ")}</span></td>
                </tr>
              ))}
              {!rows.length && !loading && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">{filtered ? "No appointments match. Try fewer filters." : "No appointments yet."}</td></tr>}
            </tbody>
          </table>
          {loading && <p className="px-4 py-3 text-sm text-slate-400">Loading…</p>}
        </div>
        {more && !loading && <div className="text-center mt-4"><button onClick={() => load(rows.length)} className="px-5 py-2 rounded-xl border border-slate-200 bg-white text-sm font-medium hover:bg-slate-50">Load more</button></div>}
      </div>
    </AppShell>
  );
}
