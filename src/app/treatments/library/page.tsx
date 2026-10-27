"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";

const supabase = sb as any;
interface Row { id: string; name: string; category: string | null; summary: string | null; price_from: number | null; is_published: boolean }

/** The clinic's treatment explainers: review each one, publish it, copy the patient link. */
export default function TreatmentLibrary() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cid: string) => {
    const { data, error } = await supabase.from("treatment_info").select("id, name, category, summary, price_from, is_published").eq("clinic_id", cid).order("name");
    if (error) setErr(/treatment_info/.test(error.message) ? "Run migration 019 (treatments) in Supabase first, then reload." : error.message);
    setRows(data ?? []); setLoading(false);
  }, []);
  useEffect(() => { const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setClinicId(c); load(c); }, [router, load]);

  async function importStarter() {
    setBusy(true); setErr(""); setMsg("");
    try { const r = await authFetch<{ added: number }>("/api/treatments/info", { body: { clinicId, action: "import" } }); setMsg(r.added ? `${r.added} starter treatments added. They are drafts: read each one, add your prices, then publish.` : "The starter treatments are already there."); await load(clinicId); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  async function publish(r: Row) {
    setErr(""); setMsg("");
    try { await authFetch("/api/treatments/info", { body: { clinicId, action: "publish", id: r.id, published: !r.is_published } }); await load(clinicId); }
    catch (e: any) { setErr(e.message); }
  }
  async function copy(id: string) {
    const url = `${window.location.origin}/t/${id}`;
    try { await navigator.clipboard.writeText(url); setMsg("Link copied. Paste it in WhatsApp."); } catch { setMsg(url); }
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <Link href="/treatments" className="text-sm text-slate-500 hover:text-sky-700">← Treatments</Link>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Treatment library</h1>
            <p className="text-slate-500 text-sm mt-1">Plain-language explainers patients can read on their phone. Review them before you publish.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={importStarter} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold disabled:opacity-60">Add starter treatments</button>
            <Link href="/treatments/library/new" className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">+ New</Link>
          </div>
        </div>
        {err && <p className="mt-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {msg && <p className="mt-4 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2" role="status">{msg}</p>}
        {loading ? <p className="mt-6 text-slate-400 text-sm">Loading…</p> : rows.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600">
            <p className="font-semibold text-slate-800">No treatments yet</p>
            <p className="mt-1">Tap &ldquo;Add starter treatments&rdquo; to begin with 12 common dental ones.</p>
          </div>
        ) : (
          <div className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/treatments/library/${r.id}`} className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 truncate">{r.name}</p>
                  <p className="text-xs text-slate-500 truncate">{r.category ?? ""}{r.price_from != null ? ` · from ₹${Number(r.price_from).toLocaleString("en-IN")}` : " · no price yet"}</p>
                </Link>
                <span className={`text-xs px-2 py-0.5 rounded-full ${r.is_published ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.is_published ? "Published" : "Draft"}</span>
                {r.is_published && <button type="button" onClick={() => copy(r.id)} className="text-xs text-sky-700 underline">Copy link</button>}
                <button type="button" onClick={() => publish(r)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-medium">{r.is_published ? "Unpublish" : "Publish"}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
