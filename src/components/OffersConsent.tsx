"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/api";
import { supabase as sb } from "@/lib/supabase";
import { toast } from "@/lib/toast";

const supabase = sb as any;
const SRC: Record<string, string> = { online_booking: "online booking", front_desk: "front desk", whatsapp_reply: "WhatsApp reply" };

/** Did the patient agree to receive offers? Tick it when you ask them at the desk. They can also answer on the booking page or reply STOP / START. */
export default function OffersConsent({ clinicId, patientId, canEdit = true }: { clinicId: string; patientId: string; canEdit?: boolean }) {
  const [row, setRow] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!clinicId || !patientId) return;
    supabase.from("clinic_patients").select("marketing_opt_in, marketing_opt_in_at, marketing_opt_in_source, marketing_opt_out_at").eq("id", patientId).eq("clinic_id", clinicId).maybeSingle()
      .then((r: any) => { if (!r.error) setRow(r.data); });          // migration 020 not run: show nothing
  }, [clinicId, patientId]);
  if (!row) return null;
  async function set(on: boolean) {
    setBusy(true); setErr("");
    try { await authFetch("/api/patients/offers", { body: { clinicId, patientId, on } }); const now = new Date().toISOString();
      setRow({ ...row, marketing_opt_in: on, marketing_opt_in_at: on ? now : row.marketing_opt_in_at, marketing_opt_in_source: on ? "front_desk" : row.marketing_opt_in_source, marketing_opt_out_at: on ? null : now });
      toast(on ? "Saved: patient agreed to receive offers" : "Saved: patient will not get offers"); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  const d = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
  return (
    <section className="mt-5 bg-white rounded-2xl border border-slate-100 shadow-sm p-4" aria-label="Offers on WhatsApp">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" disabled={!canEdit || busy} checked={!!row.marketing_opt_in} onChange={(e) => set(e.target.checked)} />
        <span><span className="font-semibold text-slate-900">Patient agreed to get updates and offers on WhatsApp</span>
          <span className="block text-xs text-slate-500 mt-0.5">Tick this only if the patient said yes when you asked. Nothing is sent unless it is ticked.</span>
          {row.marketing_opt_in && row.marketing_opt_in_at && <span className="block text-xs text-emerald-700 mt-1">Agreed on {d(row.marketing_opt_in_at)}{row.marketing_opt_in_source ? ` · ${SRC[row.marketing_opt_in_source] ?? row.marketing_opt_in_source}` : ""}</span>}
          {!row.marketing_opt_in && row.marketing_opt_out_at && <span className="block text-xs text-slate-500 mt-1">Switched off on {d(row.marketing_opt_out_at)}</span>}</span>
      </label>
      {err && <p className="mt-2 text-sm text-red-700" role="alert">{err}</p>}
    </section>
  );
}
