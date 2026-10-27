"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";
import { getMyRoleInClinic } from "@/lib/clinic";
import { toast } from "@/lib/toast";
import { DELETABLE } from "@/lib/deleteRules";

/** The dustbin at the bottom right of a record. Asks first, then deletes and returns to the list. Hidden for roles that may not delete. */
export default function DeleteRecord({ clinicId, entity, id, backHref }: { clinicId: string; entity: string; id: string; backHref: string }) {
  const router = useRouter();
  const rule = DELETABLE[entity];
  const [allowed, setAllowed] = useState(false);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (clinicId && rule) getMyRoleInClinic(clinicId).then((r) => setAllowed(!!r && (rule.roles as string[]).includes(r))).catch(() => setAllowed(false)); }, [clinicId, rule]);
  if (!rule || !allowed) return null;

  async function go() {
    setBusy(true); setErr("");
    try { await authFetch("/api/records/delete", { body: { clinicId, entity, id } }); toast(`The ${rule.label} was deleted`); router.push(backHref); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="mt-8 flex justify-end">
      <button type="button" onClick={() => { setAsk(true); setErr(""); }} aria-label={`Delete this ${rule.label}`} title={`Delete this ${rule.label}`}
        className="w-11 h-11 flex items-center justify-center rounded-xl border border-red-200 text-red-600 hover:bg-red-50 text-lg">🗑</button>
      {ask && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4" onClick={() => !busy && setAsk(false)} role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-slate-900">Delete this {rule.label}?</p>
            <p className="text-sm text-slate-600 mt-1">This cannot be undone.</p>
            {err && <p className="mt-3 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button disabled={busy} onClick={() => setAsk(false)} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium">Keep it</button>
              <button disabled={busy} onClick={go} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
