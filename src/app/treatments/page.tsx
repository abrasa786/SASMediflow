"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import SlotPicker from "@/components/SlotPicker";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { getClinicDoctors, getMyRoleInClinic, searchClinicPatients } from "@/lib/clinic";
import { setSetupFlag } from "@/lib/setup";
import type { ClinicPatient, ClinicRole, Doctor } from "@/types";

const supabase = sb as any;
const inr = (n: number) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");
const nice = (iso?: string | null) => iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }) : "–";
const isoPlus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const inputCls = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white";
const labelCls = "text-xs font-medium text-slate-600 block mb-1";

interface Sitting { id: string; seq: number; label: string; target_date: string; amount: number; due_amount: number; paid_amount: number; status: string; invoice_id: string | null; appointments?: { appointment_date: string; appointment_time: string; status: string } | null }
interface Plan { id: string; title: string; total_amount: number; discount: number; status: string; created_at: string; clinic_patients?: { name: string; phone?: string } | null; doctors?: { name: string } | null; treatment_sittings: Sitting[] }
interface Template { id: string; name: string; description?: string; total_amount: number; sittings: { label: string; gap_days: number; share: number; duration_minutes?: number; consumables?: { item: string; qty: number }[] }[] }

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 my-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TreatmentsPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [role, setRole] = useState<ClinicRole | null>(null);
  const [tab, setTab] = useState<"plans" | "templates">("plans");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; lines: string[] } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [payFor, setPayFor] = useState<{ plan: Plan; s: Sitting } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    const [p, t, d] = await Promise.all([
      supabase.from("treatment_plans")
        .select("*, clinic_patients(name,phone), doctors(name), treatment_sittings(*, appointments(appointment_date,appointment_time,status))")
        .eq("clinic_id", id).order("created_at", { ascending: false }),
      supabase.from("treatment_templates").select("*").eq("clinic_id", id).eq("is_active", true).order("name"),
      getClinicDoctors(id),
    ]);
    const list = ((p.data ?? []) as Plan[]).map((x) => ({ ...x, treatment_sittings: [...(x.treatment_sittings ?? [])].sort((a, b) => a.seq - b.seq) }));
    setPlans(list); setTemplates((t.data ?? []) as Template[]); setDoctors(d); setLoading(false);
  }, []);

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    getMyRoleInClinic(id).then((r) => setRole(r as ClinicRole));
    load(id);
  }, [router, load]);

  const canCreate = role === "admin" || role === "doctor" || role === "receptionist";
  const canComplete = role === "admin" || role === "doctor" || role === "nurse"; // interns can view plans but not complete them
  const canPay = role === "admin" || role === "doctor" || role === "receptionist";

  async function completeSitting(plan: Plan, s: Sitting) {
    if (!clinicId) return;
    setBusy(s.id); setNotice(null);
    try {
      const r = await authFetch("/api/treatments/complete", { body: { clinicId, sittingId: s.id } });
      const lines = [`Sitting ${s.seq} done. Invoice raised for ${inr(r.amount)}.`];
      (r.stock ?? []).forEach((x: any) => lines.push(x.missing ? `Stock: “${x.name}” is not on your shelf list, so nothing was deducted.` : `Stock: ${x.name} −${x.used} (left ${x.left})${x.low ? " ⚠ below minimum" : ""}${x.used < x.wanted ? ` (needed ${x.wanted})` : ""}`));
      lines.push(r.plan_done ? "That was the last sitting. The plan is complete." : `Next: sitting ${r.next.seq} (${r.next.label}) on ${nice(r.next.date)}${r.next.time ? " at " + r.next.time : ""}.`);
      setNotice({ tone: (r.stock ?? []).some((x: any) => x.low || x.missing) ? "warn" : "ok", lines });
      await load(clinicId);
    } catch (e: any) { setNotice({ tone: "warn", lines: [e.message] }); }
    setBusy(null);
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Treatments</h1>
            <p className="text-slate-500 text-sm mt-1">Multi-sitting treatments with a date, an amount and a payment for every sitting.</p>
          </div>
          {canCreate && tab === "plans" && <button onClick={() => setNewOpen(true)} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">+ New treatment plan</button>}
        </div>

        <div className="flex gap-1 border-b border-slate-200 mb-5" role="tablist">
          {(["plans", "templates"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
              {t === "plans" ? `Plans (${plans.length})` : `Templates (${templates.length})`}
            </button>
          ))}
        </div>

        {notice && (
          <div className={`mb-5 rounded-xl px-4 py-3 text-sm ${notice.tone === "ok" ? "bg-emerald-50 border border-emerald-200 text-emerald-900" : "bg-amber-50 border border-amber-200 text-amber-900"}`} role="status">
            {notice.lines.map((l, i) => <p key={i}>{l}</p>)}
            <button onClick={() => setNotice(null)} className="mt-1.5 text-xs underline">Dismiss</button>
          </div>
        )}

        {loading ? <p className="text-slate-400 text-sm">Loading…</p> : tab === "plans" ? (
          plans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center">
              <p className="text-3xl mb-2">🦷</p>
              <p className="font-semibold text-slate-800">No treatment plans yet</p>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">Create a plan for a procedure that needs several visits, like a root canal. All the sittings are booked at once and billed one by one.</p>
              {canCreate && <button onClick={() => setNewOpen(true)} className="mt-4 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Create the first plan</button>}
            </div>
          ) : (
            <div className="space-y-5">
              {plans.map((p) => {
                const payable = Number(p.total_amount) - Number(p.discount);
                const paid = p.treatment_sittings.reduce((n, s) => n + Number(s.paid_amount), 0);
                const done = p.treatment_sittings.filter((s) => s.status === "done").length;
                const next = p.treatment_sittings.find((s) => s.status === "pending");
                return (
                  <section key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-5 flex flex-wrap gap-4 justify-between">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900">{p.title}</p>
                        <p className="text-sm text-slate-500">{p.clinic_patients?.name ?? "Patient"} · {p.doctors?.name ?? "Unassigned"}
                          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${p.status === "completed" ? "bg-emerald-100 text-emerald-700" : p.status === "cancelled" ? "bg-red-100 text-red-700" : "bg-sky-100 text-sky-700"}`}>{p.status}</span></p>
                      </div>
                      <div className="text-right text-sm tabular-nums">
                        <p className="text-slate-500">Plan total {inr(p.total_amount)}{Number(p.discount) > 0 && <> − discount {inr(p.discount)}</>}</p>
                        <p className="font-semibold text-slate-900">Payable {inr(payable)} · Paid {inr(paid)} · <span className={payable - paid > 0 ? "text-amber-700" : "text-emerald-700"}>Balance {inr(payable - paid)}</span></p>
                      </div>
                    </div>
                    <div className="px-5 pb-4 grid sm:grid-cols-2 gap-4">
                      <Progress label={`Treatment ${done}/${p.treatment_sittings.length} sittings`} pct={(done / Math.max(p.treatment_sittings.length, 1)) * 100} color="bg-sky-500" />
                      <Progress label={`Payment ${inr(paid)} of ${inr(payable)}`} pct={payable ? (paid / payable) * 100 : 100} color="bg-emerald-500" />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
                          <th className="px-5 py-2 font-medium">#</th><th className="px-2 py-2 font-medium">Sitting</th><th className="px-2 py-2 font-medium">Date</th>
                          <th className="px-2 py-2 font-medium text-right">Amount</th><th className="px-2 py-2 font-medium text-right">Paid</th><th className="px-2 py-2 font-medium">Status</th><th className="px-5 py-2" /></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {p.treatment_sittings.map((s) => {
                            const when = s.appointments?.appointment_date ?? s.target_date;
                            const moved = s.appointments && s.appointments.appointment_date !== s.target_date;
                            return (
                              <tr key={s.id}>
                                <td className="px-5 py-3 text-slate-500">{s.seq}</td>
                                <td className="px-2 py-3 font-medium text-slate-800">{s.label}</td>
                                <td className="px-2 py-3 text-slate-700">{nice(when)}{s.appointments?.appointment_time ? ` · ${s.appointments.appointment_time}` : ""}
                                  {moved && s.status === "pending" && <span className="block text-xs text-amber-700">moved from {nice(s.target_date)} (doctor not free)</span>}</td>
                                <td className="px-2 py-3 text-right tabular-nums">{inr(s.due_amount)}</td>
                                <td className="px-2 py-3 text-right tabular-nums">{inr(s.paid_amount)}</td>
                                <td className="px-2 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${s.status === "done" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{s.status}</span></td>
                                <td className="px-5 py-3 text-right whitespace-nowrap">
                                  {s.status === "pending" && next?.id === s.id && p.status === "active" && canComplete &&
                                    <button disabled={busy === s.id} onClick={() => completeSitting(p, s)} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold disabled:opacity-60">{busy === s.id ? "Saving…" : "Mark complete"}</button>}
                                  {s.status === "done" && Number(s.paid_amount) < Number(s.due_amount) && canPay &&
                                    <button onClick={() => setPayFor({ plan: p, s })} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-xs font-semibold">Record payment</button>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          )
        ) : (
          <TemplatesTab templates={templates} clinicId={clinicId} canEdit={role === "admin"} onChanged={() => clinicId && load(clinicId)} />
        )}
      </div>

      {newOpen && clinicId && (
        <NewPlanModal clinicId={clinicId} templates={templates} doctors={doctors} onClose={() => setNewOpen(false)}
          onCreated={(lines) => { setNewOpen(false); setNotice({ tone: "ok", lines }); load(clinicId); }} />
      )}
      {payFor && clinicId && (
        <PayModal clinicId={clinicId} s={payFor.s} onClose={() => setPayFor(null)}
          onPaid={(lines) => { setPayFor(null); setNotice({ tone: "ok", lines }); load(clinicId); }} />
      )}
    </AppShell>
  );
}

function Progress({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>
    </div>
  );
}

function NewPlanModal({ clinicId, templates, doctors, onClose, onCreated }: { clinicId: string; templates: Template[]; doctors: Doctor[]; onClose: () => void; onCreated: (lines: string[]) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ClinicPatient[]>([]);
  const [patient, setPatient] = useState<ClinicPatient | null>(null);
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [date, setDate] = useState(isoPlus(1));
  const [time, setTime] = useState("");
  const [discount, setDiscount] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const tpl = templates.find((t) => t.id === tplId);

  useEffect(() => {
    if (q.trim().length < 2 || patient) { setFound([]); return; }
    const h = setTimeout(() => searchClinicPatients(clinicId, q).then(setFound).catch(() => {}), 250);
    return () => clearTimeout(h);
  }, [q, clinicId, patient]);

  const disc = Math.max(0, Number(discount) || 0);
  const total = tpl ? Number(tpl.total_amount) : 0;
  const preview = useMemo(() => {
    if (!tpl) return [];
    const n = tpl.sittings.length; let used = 0; const f = total ? (total - disc) / total : 1;
    return tpl.sittings.map((s, i) => {
      const list = Math.round(total * (s.share ?? 100 / n)) / 100 * 1; // share is a percent
      const amt = Math.round((total * (s.share ?? 100 / n)) / 100);
      const due = i === n - 1 ? total - disc - used : Math.round(amt * f);
      used += due; return { label: s.label, gap: s.gap_days, list: amt, due, _: list };
    });
  }, [tpl, total, disc]);

  async function submit() {
    setErr("");
    if (!patient) return setErr("Choose the patient.");
    if (!doctorId) return setErr("Choose a doctor.");
    if (!tpl) return setErr("Choose a treatment.");
    if (disc > total) return setErr("The discount cannot be more than the total.");
    if (!time) return setErr("Pick a time for the first sitting.");
    setBusy(true);
    try {
      const r = await authFetch("/api/treatments/create", { body: { clinicId, patientId: patient.id, doctorId, templateId: tpl.id, discount: disc, startDate: date, time } });
      const lines = [`${tpl.name} created for ${patient.name}. Payable ${inr(r.plan.payable)}.`];
      r.plan.sittings.forEach((s: any) => lines.push(`Sitting ${s.seq} (${s.label}): ${nice(s.date)}${s.moved ? `, moved from ${nice(s.target_date)} because the doctor is not free` : ""}`));
      const n = r.notifications?.[0];
      if (n) lines.push(n.status === "sent" ? "WhatsApp confirmation sent for sitting 1." : n.status === "link" ? "WhatsApp message prepared for sitting 1 (open Appointments to send it)." : "");
      onCreated(lines.filter(Boolean));
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <Modal title="New treatment plan" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Patient</label>
          {patient ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm"><span><b>{patient.name}</b> {patient.phone && <span className="text-slate-500">· {patient.phone}</span>}</span><button onClick={() => { setPatient(null); setQ(""); }} className="text-xs text-sky-700 underline">Change</button></div>
          ) : (
            <>
              <input className={inputCls} placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
              {found.length > 0 && <ul className="mt-1 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-40 overflow-y-auto">{found.map((f) => <li key={f.id}><button className="w-full text-left px-3 py-2 text-sm hover:bg-sky-50" onClick={() => setPatient(f)}>{f.name} <span className="text-slate-500">{f.phone}</span></button></li>)}</ul>}
              <p className="text-xs text-slate-500 mt-1">New patient? Book their first appointment with the AI Assistant, then come back.</p>
            </>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>Treatment</label>
            <select className={inputCls} value={tplId} onChange={(e) => setTplId(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div><label className={labelCls}>Doctor</label>
            <select className={inputCls} value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setTime(""); }}>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        </div>
        {templates.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">No treatment templates yet. Add one on the Templates tab.</p>}
        {doctors.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Add a doctor first (Setup → Add your doctors).</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className={labelCls}>First sitting date</label><input type="date" className={inputCls} min={isoPlus(0)} value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} /></div>
          <div><label className={labelCls}>Discount (₹)</label>
            <div className="flex gap-1.5"><input className={inputCls} inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              {[5, 10].map((p) => <button key={p} type="button" onClick={() => setDiscount(String(Math.round(total * p / 100)))} className="px-2.5 rounded-xl border border-slate-200 text-xs font-medium hover:bg-slate-50">{p}%</button>)}</div></div>
        </div>
        {doctorId && <div><label className={labelCls}>Time for the first sitting <span className="text-slate-400">(later sittings use the same time)</span></label>
          <SlotPicker clinicId={clinicId} date={date} doctorId={doctorId} value={time} onChange={setTime} /></div>}
        {preview.length > 0 && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-800 mb-1.5">How it will be billed</p>
            {preview.map((s, i) => <div key={i} className="flex justify-between gap-3 py-0.5 tabular-nums"><span className="text-slate-600">{i + 1}. {s.label}{i > 0 ? ` (+${s.gap} days)` : ""}</span><span>{inr(s.due)}</span></div>)}
            <div className="flex justify-between gap-3 border-t border-slate-200 mt-1.5 pt-1.5 font-semibold tabular-nums"><span>{inr(total)} − {inr(disc)} discount</span><span>{inr(total - disc)}</span></div>
          </div>
        )}
        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Booking all sittings…" : "Create & book sittings"}</button></div>
      </div>
    </Modal>
  );
}

function PayModal({ clinicId, s, onClose, onPaid }: { clinicId: string; s: Sitting; onClose: () => void; onPaid: (l: string[]) => void }) {
  const balance = Number(s.due_amount) - Number(s.paid_amount);
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState("cash");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function pay() {
    setErr(""); const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setErr("Enter an amount above zero.");
    if (n > balance) return setErr(`That is more than the balance (${inr(balance)}).`);
    setBusy(true);
    try {
      const r = await authFetch("/api/treatments/pay", { body: { clinicId, sittingId: s.id, amount: n, method } });
      onPaid([`${inr(r.paid_now)} received for sitting ${s.seq}. Sitting balance ${inr(r.sitting_balance)}. Plan balance ${inr(r.plan_balance)}.`]);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={`Payment · sitting ${s.seq}`} onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">{s.label}. Balance on this sitting: <b>{inr(balance)}</b>. A patient can pay part now and the rest later.</p>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={labelCls}>Amount (₹)</label><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><label className={labelCls}>Method</label><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}>{["cash", "upi", "card", "insurance", "other"].map((m) => <option key={m}>{m}</option>)}</select></div>
      </div>
      {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 mt-3" role="alert">{err}</p>}
      <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button>
        <button onClick={pay} disabled={busy} className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Saving…" : "Record payment"}</button></div>
    </Modal>
  );
}

const MAX_SITTINGS = 12; // the database accepts 1 to 12 sittings per plan
const BLANK_TEMPLATE: Template = { id: "", name: "", description: "", total_amount: 0, sittings: [{ label: "Sitting 1", gap_days: 0, share: 100 }] };

function TemplatesTab({ templates, clinicId, canEdit, onChanged }: { templates: Template[]; clinicId: string | null; canEdit: boolean; onChanged: () => void }) {
  const [edit, setEdit] = useState<Template | null>(null);
  return (
    <div>
      {canEdit && <div className="mb-4"><button onClick={() => setEdit({ ...BLANK_TEMPLATE, sittings: BLANK_TEMPLATE.sittings.map((x) => ({ ...x })) })} className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">+ New template</button></div>}
      <div className="grid md:grid-cols-2 gap-4">
        {templates.map((t) => (
          <div key={t.id} className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex justify-between gap-3"><div><p className="font-bold text-slate-900">{t.name}</p><p className="text-sm text-slate-500">{t.description}</p></div><p className="font-semibold tabular-nums">{inr(t.total_amount)}</p></div>
            <ol className="mt-3 space-y-1.5 text-sm">
              {t.sittings.map((s, i) => (
                <li key={i} className="flex justify-between gap-3 text-slate-700"><span>{i + 1}. {s.label}{i > 0 && <span className="text-slate-400"> · after {s.gap_days} days</span>}</span><span className="tabular-nums text-slate-500">{s.share}%</span></li>
              ))}
            </ol>
            {canEdit && <button onClick={() => setEdit(t)} className="mt-3 text-sm text-sky-700 hover:underline">Edit</button>}
          </div>
        ))}
        {templates.length === 0 && <p className="text-sm text-slate-500">No templates yet.{canEdit && " Use “New template” to add one."}</p>}
      </div>
      {edit && clinicId && <TemplateEditor t={edit} clinicId={clinicId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setSetupFlag(clinicId, "templates_reviewed", true); onChanged(); }} />}
    </div>
  );
}

function evenShares(n: number) { const base = Math.floor(100 / n); return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - base * (n - 1) : base)); }

function TemplateEditor({ t, clinicId, onClose, onSaved }: { t: Template; clinicId: string; onClose: () => void; onSaved: () => void }) {
  const isNew = !t.id;
  const [name, setName] = useState(t.name);
  const [desc, setDesc] = useState(t.description ?? "");
  const [total, setTotal] = useState(String(t.total_amount));
  const [rows, setRows] = useState(t.sittings.map((s) => ({ ...s })));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const shareSum = rows.reduce((n, r) => n + (Number(r.share) || 0), 0);
  function set(i: number, k: string, v: string) { setRows(rows.map((r, j) => j === i ? { ...r, [k]: k === "label" ? v : Number(v) } : r)); }
  function rebalance(next: typeof rows) { const sh = evenShares(next.length); return next.map((r, i) => ({ ...r, share: sh[i] })); }
  function add() { if (rows.length >= MAX_SITTINGS) return; setRows(rebalance([...rows, { label: `Sitting ${rows.length + 1}`, gap_days: 7, share: 0 }])); }
  function remove(i: number) { if (rows.length <= 1) return; const next = rows.filter((_, j) => j !== i); next[0] = { ...next[0], gap_days: 0 }; setRows(rebalance(next)); }
  async function save() {
    setErr("");
    if (!name.trim()) return setErr("Give the template a name.");
    if (Math.round(shareSum) !== 100) return setErr(`Shares must add up to 100% (now ${shareSum}%).`);
    if (rows.some((r) => !r.label.trim())) return setErr("Every sitting needs a name.");
    if (rows.some((r, i) => i > 0 && (!Number.isInteger(r.gap_days) || r.gap_days < 0 || r.gap_days > 365))) return setErr("“Days after” must be a whole number from 0 to 365.");
    const n = Number(total); if (!Number.isFinite(n) || n < 0) return setErr("Enter a valid total.");
    setBusy(true);
    const body = { name: name.trim(), description: desc.trim() || null, total_amount: n, sittings: rows.map((r, i) => ({ ...r, label: r.label.trim(), gap_days: i === 0 ? 0 : r.gap_days })) };
    const q = isNew ? (supabase as any).from("treatment_templates").insert({ clinic_id: clinicId, ...body }) : (supabase as any).from("treatment_templates").update(body).eq("id", t.id);
    const { error } = await q; setBusy(false);
    if (error) return setErr(error.code === "23505" ? "You already have a template with that name." : error.message);
    onSaved();
  }
  async function del() {
    if (!window.confirm(`Delete “${t.name}”? Plans already made from it are not affected.`)) return;
    setBusy(true);
    const { error } = await (supabase as any).from("treatment_templates").update({ is_active: false, name: `${t.name} (deleted ${Date.now()})` }).eq("id", t.id);
    setBusy(false);
    if (error) return setErr(error.message); onSaved();
  }
  return (
    <Modal title={isNew ? "New treatment template" : `Edit ${t.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div><label className={labelCls}>Name</label><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Braces (6 visits)" /></div>
        <div><label className={labelCls}>Short description <span className="text-slate-400">(optional)</span></label><input className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div><label className={labelCls}>Total amount (₹)</label><input className={inputCls} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_64px_64px_28px] gap-2 items-end">
            <div><label className={labelCls}>Sitting {i + 1}</label><input className={inputCls} value={r.label} onChange={(e) => set(i, "label", e.target.value)} /></div>
            <div><label className={labelCls}>Days after</label><input className={inputCls} inputMode="numeric" value={r.gap_days} disabled={i === 0} onChange={(e) => set(i, "gap_days", e.target.value)} /></div>
            <div><label className={labelCls}>Share %</label><input className={inputCls} inputMode="decimal" value={r.share} onChange={(e) => set(i, "share", e.target.value)} /></div>
            <button type="button" onClick={() => remove(i)} disabled={rows.length <= 1} aria-label={`Remove sitting ${i + 1}`} className="h-[42px] text-slate-400 hover:text-red-600 disabled:opacity-30">✕</button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={add} disabled={rows.length >= MAX_SITTINGS} className="text-sm text-sky-700 hover:underline disabled:opacity-40">+ Add a sitting{rows.length >= MAX_SITTINGS ? ` (max ${MAX_SITTINGS})` : ""}</button>
          <button type="button" onClick={() => setRows(rebalance(rows))} className="text-xs text-slate-500 hover:underline">Split shares evenly</button>
        </div>
        <p className={`text-xs ${Math.round(shareSum) === 100 ? "text-slate-500" : "text-red-600"}`}>Shares add up to {shareSum}% (must be 100%).</p>
        {err && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        <div className="flex justify-between gap-2">
          <div>{!isNew && <button onClick={del} disabled={busy} className="px-3 py-2.5 rounded-xl text-sm text-red-600 hover:bg-red-50">Delete</button>}</div>
          <div className="flex gap-2"><button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Saving…" : "Save"}</button></div>
        </div>
      </div>
    </Modal>
  );
}
