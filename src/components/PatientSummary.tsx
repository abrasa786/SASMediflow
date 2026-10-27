"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getActiveClinicId } from "@/lib/auth";
import { supabase as sb } from "@/lib/supabase";
import { buildSummary, type Summary, type VisitNote } from "@/lib/visits/summary";

const supabase = sb as any;
const nice = (iso?: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

/**
 * Everything the clinic already knows about this patient: warnings, conditions found, treatment so far, plans in progress.
 * Shown on the patient's page and at the top of every appointment, so the doctor does not have to dig for it.
 */
export default function PatientSummary({ patientId, refreshKey = 0 }: { patientId: string; refreshKey?: number }) {
  const [s, setS] = useState<Summary | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const cid = getActiveClinicId(); if (!cid || !patientId) return;
    const [p, n, pl] = await Promise.all([
      supabase.from("clinic_patients").select("name, dob, gender, allergies, conditions, medications").eq("id", patientId).eq("clinic_id", cid).maybeSingle(),
      supabase.from("visit_notes").select("id, visit_date, tooth, treatment, findings, concerns, conditions, alert, follow_up, doctors(name)").eq("clinic_id", cid).eq("clinic_patient_id", patientId).order("visit_date", { ascending: false }).limit(200),
      supabase.from("treatment_plans").select("title, status, treatment_sittings(status, target_date)").eq("clinic_id", cid).eq("clinic_patient_id", patientId).eq("status", "active"),
    ]);
    if (n.error) setErr(/visit_notes/.test(n.error.message) ? "Run migration 022 (visit notes) in Supabase to see treatment history here." : n.error.message);
    if (!p.data) return;
    setName(p.data.name);
    const notes: VisitNote[] = ((n.data ?? []) as any[]).map((x) => ({ ...x, doctor: x.doctors?.name ?? null }));
    const plans = ((pl.data ?? []) as any[]).map((x) => {
      const sit = (x.treatment_sittings ?? []) as { status: string; target_date: string }[];
      const next = sit.filter((t) => t.status === "pending").map((t) => t.target_date).sort()[0] ?? null;
      return { title: x.title, status: x.status, done: sit.filter((t) => t.status === "done").length, total: sit.length, next };
    });
    setS(buildSummary(p.data, notes, plans));
  }, [patientId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function copy() {
    if (!s) return;
    try { await navigator.clipboard.writeText(s.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }
  if (!s) return err ? <p className="mt-4 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{err}</p> : null;

  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden" aria-label="Patient summary">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="font-semibold text-slate-900 text-sm">Patient summary{name ? ` · ${name}` : ""}</span>
        <span className="text-xs text-slate-500">{s.history.length ? `${s.history.length} previous ${s.history.length === 1 ? "entry" : "entries"} · last ${nice(s.lastVisit)}` : "No previous treatment recorded"} {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 text-sm">
          {err && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">{err}</p>}
          {s.alerts.length > 0 && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5" role="alert">
              <p className="text-xs font-bold text-red-800 uppercase tracking-wide">Please note</p>
              <ul className="mt-1 space-y-1 text-red-900">{s.alerts.map((a, i) => <li key={i}>⚠ {a.text}{a.tooth ? ` (tooth ${a.tooth})` : ""} <span className="text-xs text-red-700/70">· noted {nice(a.date)}</span></li>)}</ul>
            </div>
          )}
          {s.basics.length > 0 && <p className="text-slate-700">{s.basics.join(" · ")}</p>}
          {s.conditions.length > 0 && <p className="text-slate-700"><span className="font-medium">Noticed at visits:</span> {s.conditions.join("; ")}</p>}
          {s.plans.length > 0 && <p className="text-slate-700"><span className="font-medium">Plan in progress:</span> {s.plans.map((x) => `${x.title} · ${x.done} of ${x.total} sittings done${x.next ? `, next ${nice(x.next)}` : ""}`).join("; ")}</p>}
          {s.followUps.length > 0 && <p className="text-slate-700"><span className="font-medium">Follow-up:</span> {s.followUps.map((f) => `${f.text} (${nice(f.date)})`).join("; ")}</p>}
          {s.history.length > 0 && (
            <div>
              <p className="font-medium text-slate-800 mb-1">Treatment so far</p>
              <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
                {s.history.slice(0, 10).map((n) => (
                  <li key={n.id} className="px-3 py-2">
                    <p className="text-slate-900"><span className="text-xs text-slate-500 mr-2">{nice(n.visit_date)}</span>{n.treatment}{n.tooth ? ` · tooth ${n.tooth}` : ""}{n.doctor ? <span className="text-xs text-slate-400"> · {n.doctor}</span> : null}</p>
                    {n.findings && <p className="text-xs text-slate-600 mt-0.5">Findings: {n.findings}</p>}
                    {n.concerns && <p className="text-xs text-slate-600 mt-0.5">Patient concern: {n.concerns}</p>}
                  </li>
                ))}
              </ul>
              {s.history.length > 10 && <p className="text-xs text-slate-400 mt-1">Showing the latest 10 of {s.history.length}.</p>}
            </div>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={copy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-medium">{copied ? "Copied" : "Copy summary"}</button>
            <Link href={`/patients/${patientId}`} className="text-xs text-sky-700 underline">Open patient record</Link>
          </div>
        </div>
      )}
    </section>
  );
}
