"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { firstRunTarget } from "@/lib/flow";
import { toast } from "@/lib/toast";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getSetupStatus, setSetupFlag, type SetupItem } from "@/lib/setup";
import { supabase } from "@/lib/supabase";

const SPECIALTIES = ["Dentistry", "General Practice", "Dermatology", "Gynaecology", "Orthopaedics", "Paediatrics", "Ophthalmology", "ENT", "Cardiology", "Other"];
const field = "w-full px-3 py-3 rounded-xl border border-slate-300 text-base focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white";
const primary = "px-4 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white text-base font-semibold";
const secondary = "px-4 py-3 rounded-xl border border-slate-300 hover:bg-slate-50 text-base font-medium text-slate-800";

function ErrorBox({ text }: { text: string }) {
  if (!text) return null;
  return <div role="alert" className="mt-3 flex gap-2 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-3.5 py-3"><span aria-hidden>⚠️</span><span>{text}</span></div>;
}

export default function SetupPage() {
  const [items, setItems] = useState<SetupItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ step: string; text: string } | null>(null);
  const [prof, setProf] = useState({ phone: "", address: "", city: "", specialty: "Dentistry" });
  const [doc, setDoc] = useState({ name: "", specialty: "" });
  const router = useRouter();
  const clinicId = typeof window !== "undefined" ? getActiveClinicId() : null;

  const load = useCallback(async (keepOpen = false) => {
    if (!clinicId) return;
    const r = await getSetupStatus(clinicId);
    setItems(r.items); setDismissed(r.dismissed); setLoading(false);
    if (!keepOpen) setOpen((cur) => cur ?? r.items.find((i) => !i.done && !i.optional && i.id !== "patient")?.id ?? null);
    const to = await firstRunTarget(clinicId);
    if (to && to !== "/setup") { toast("Setup complete. Welcome to your clinic."); router.push(to); }
  }, [clinicId, router]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!clinicId) return;
    supabase.from("clinics").select("phone,address,city,specialty").eq("id", clinicId).maybeSingle().then(({ data }: { data: any }) => {
      if (data) setProf((p) => ({ phone: data.phone ?? "", address: data.address ?? "", city: data.city ?? "", specialty: data.specialty ?? p.specialty }));
    });
  }, [clinicId]);

  /** Run one save; show the reason on the step if it fails, a toast if it works, then move to the next step. */
  async function run(step: string, fn: () => Promise<void>, okText: string) {
    setBusy(true); setError(null);
    try {
      await fn();
      toast(okText);
      const r = await getSetupStatus(clinicId!);
      setItems(r.items);
      const next = r.items.find((i) => !i.done && !i.optional && i.id !== "patient");
      setOpen(next?.id ?? null);
      await load(true);
    } catch (e: any) {
      setError({ step, text: e?.message || "That did not save. Please try again." });
    } finally { setBusy(false); }
  }

  const saveProfile = () => run("profile", async () => {
    if (prof.phone.replace(/\D/g, "").length < 10) throw new Error("Enter your clinic's phone number (at least 10 digits).");
    if (prof.address.trim().length < 5) throw new Error("Enter the clinic's address so it can appear on invoices.");
    await authFetch("/api/clinic/setup", { body: { clinicId, action: "profile", fields: { phone: prof.phone, address: prof.address, city: prof.city, specialty: prof.specialty } } });
  }, "Clinic details saved.");

  const addDoctor = (me: boolean) => run("doctors", async () => {
    if (!me && doc.name.trim().length < 2) throw new Error("Type the doctor's name first.");
    await authFetch("/api/clinic/setup", { body: { clinicId, action: "doctor", me, name: doc.name, specialty: doc.specialty } });
    setDoc({ name: "", specialty: "" });
  }, me ? "You are now listed as a doctor." : "Doctor added.");

  const mark = (step: string, flag: string, text: string) => run(step, () => setSetupFlag(clinicId!, flag, true), text);

  async function dismiss(v: boolean) {
    try { await setSetupFlag(clinicId!, "dismissed", v); setDismissed(v); toast(v ? "Reminder hidden from Home." : "Reminder will show on Home again."); }
    catch (e: any) { toast(e?.message || "Could not change that.", false); }
  }

  const required = items.filter((i) => !i.optional && i.id !== "patient");
  const done = required.filter((i) => i.done).length;
  const optional = items.filter((i) => i.optional);
  const patient = items.find((i) => i.id === "patient");
  const allDone = required.length > 0 && done === required.length;

  function body(i: SetupItem) {
    const err = error?.step === i.id ? <ErrorBox text={error.text} /> : null;
    switch (i.id) {
      case "profile": return (
        <div className="space-y-3">
          <label className="block"><span className="text-sm font-medium text-slate-700">Clinic phone *</span>
            <input inputMode="tel" value={prof.phone} onChange={(e) => setProf({ ...prof, phone: e.target.value })} placeholder="98765 43210" className={field + " mt-1"} /></label>
          <label className="block"><span className="text-sm font-medium text-slate-700">Address *</span>
            <input value={prof.address} onChange={(e) => setProf({ ...prof, address: e.target.value })} placeholder="Street, area" className={field + " mt-1"} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-sm font-medium text-slate-700">City</span>
              <input value={prof.city} onChange={(e) => setProf({ ...prof, city: e.target.value })} className={field + " mt-1"} /></label>
            <label className="block"><span className="text-sm font-medium text-slate-700">Specialty</span>
              <select value={prof.specialty} onChange={(e) => setProf({ ...prof, specialty: e.target.value })} className={field + " mt-1"}>{SPECIALTIES.map((s) => <option key={s}>{s}</option>)}</select></label>
          </div>
          {err}
          <button disabled={busy} onClick={saveProfile} className={primary + " w-full sm:w-auto"}>{busy ? "Saving…" : "Save and continue"}</button>
        </div>);
      case "doctors": return (
        <div className="space-y-3">
          <button disabled={busy} onClick={() => addDoctor(true)} className={secondary + " w-full sm:w-auto"}>I am a doctor: add me</button>
          <p className="text-sm text-slate-500">or add another doctor:</p>
          <input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} placeholder="Doctor's name, e.g. Dr. Anil Kumar" className={field} />
          <input value={doc.specialty} onChange={(e) => setDoc({ ...doc, specialty: e.target.value })} placeholder="Specialty (optional)" className={field} />
          {err}
          <button disabled={busy} onClick={() => addDoctor(false)} className={primary + " w-full sm:w-auto"}>{busy ? "Adding…" : "Add doctor"}</button>
        </div>);
      case "hours": return (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Pick the days and times each doctor sees patients. You can copy one doctor&apos;s week to the others.</p>
          {items.find((x) => x.id === "doctors")?.done
            ? <Link href="/availability" className={primary + " inline-block w-full sm:w-auto text-center"}>Set weekly hours</Link>
            : <p className="text-sm text-amber-700 bg-amber-50 rounded-xl px-3.5 py-3">Add a doctor first (step 2), then set their hours here.</p>}
        </div>);
      case "prices": case "templates": {
        const flag = i.id === "prices" ? "prices_reviewed" : "templates_reviewed";
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{i.id === "prices" ? "A starter price list is already added. Open it, change any amount, then confirm." : "Starter treatment plans are already added. Open them, edit if needed, then confirm."}</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Link href={i.href} className={secondary + " text-center"}>Open and review</Link>
              <button disabled={busy} onClick={() => mark(i.id, flag, "Marked as reviewed.")} className={primary}>{busy ? "Saving…" : "Looks right, continue"}</button>
            </div>
            {err}
          </div>);
      }
      case "whatsapp": return (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Mediflow sends confirmations and reminders from its own WhatsApp number. Nothing for you to connect. Mark this done when you are ready.</p>
          <button disabled={busy} onClick={() => mark(i.id, "whatsapp_done", "WhatsApp marked as ready.")} className={secondary}>Mark as done</button>
          {err}
        </div>);
      default: return (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{i.hint}</p>
          <Link href={i.href} className={primary + " inline-block w-full sm:w-auto text-center"}>Open</Link>
        </div>);
    }
  }

  function card(i: SetupItem, n?: number) {
    const isOpen = open === i.id && !i.done;
    return (
      <li key={i.id} className={`rounded-2xl border ${i.done ? "bg-emerald-50 border-emerald-200" : isOpen ? "bg-white border-sky-300 shadow-sm" : "bg-white border-slate-200"}`}>
        <button type="button" onClick={() => setOpen(isOpen ? null : i.id)} className="w-full flex items-center gap-3 p-4 text-left">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${i.done ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}>{i.done ? "✓" : n ?? "•"}</span>
          <span className="flex-1 min-w-0">
            <span className="block font-semibold text-slate-900">{i.title}{i.optional && <span className="ml-2 text-xs font-medium text-slate-500">optional</span>}</span>
            {!isOpen && <span className="block text-sm text-slate-500 truncate">{i.done ? "Done" : i.hint}</span>}
          </span>
          {i.done ? <Link href={i.href} onClick={(e) => e.stopPropagation()} className="text-sm text-sky-700 underline shrink-0">Review</Link> : <span className="text-slate-400 shrink-0">{isOpen ? "▲" : "▼"}</span>}
        </button>
        {isOpen && <div className="px-4 pb-4 pt-0 sm:pl-[3.75rem]">{body(i)}</div>}
      </li>
    );
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Set up your clinic</h1>
        <p className="text-slate-600 mt-1">Five short steps, about 5 minutes. You only do this once.</p>

        {!loading && (
          <div className="mt-5 rounded-2xl bg-white border border-slate-200 p-4">
            <div className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-800">{allDone ? "All set" : `Step ${Math.min(done + 1, required.length)} of ${required.length}`}</span><span className="text-slate-500 tabular-nums">{done}/{required.length} done</span></div>
            <div className="mt-2 h-2.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-sky-600 transition-all" style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} /></div>
          </div>
        )}

        {loading ? <p className="mt-6 text-slate-500">Loading…</p> : (
          <>
            <ul className="mt-5 space-y-3">{required.map((i, k) => card(i, k + 1))}</ul>

            {allDone && (
              <div className="mt-5 rounded-2xl bg-sky-50 border border-sky-200 p-4">
                <p className="font-semibold text-sky-900">Your clinic is ready.</p>
                <Link href="/dashboard" className={primary + " mt-3 inline-block w-full sm:w-auto text-center"}>Go to Home</Link>
              </div>
            )}

            {optional.length > 0 && <>
              <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Optional, any time later</h2>
              <ul className="space-y-3">{optional.map((i) => card(i))}</ul>
            </>}

            {patient && !patient.done && (
              <div className="mt-6 flex flex-col sm:flex-row gap-2">
                <Link href="/appointments?new=1" className={primary + " text-center"}>+ New booking</Link>
                <Link href="/dashboard" className={secondary + " text-center"}>Skip to Home</Link>
              </div>
            )}

            <div className="mt-8 text-sm text-slate-500">
              {dismissed ? <button onClick={() => dismiss(false)} className="underline">Show the setup reminder on Home again</button>
                         : <button onClick={() => dismiss(true)} className="underline">Hide the setup reminder on Home</button>}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
