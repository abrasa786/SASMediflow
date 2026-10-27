"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";

const lab = (roles?: string[] | null, sets?: string[] | null) => !roles && !sets ? "Everyone" : [...(roles ?? []).map((r) => r + "s"), ...(sets ?? [])].join(", ") || "Everyone";

/** Admin: who can see each app and each tab. Changes go through the builder, so they are recorded and can be undone. */
export default function ManageAppsPage() {
  const router = useRouter();
  const [cid, setCid] = useState("");
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<{ app: string; tab?: string } | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [sets, setSets] = useState<string[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  const load = useCallback((c: string) => authFetch(`/api/apps?clinicId=${c}`).then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => {
    const c = getActiveClinicId(); if (!c) { router.push("/login"); return; } setCid(c); load(c);
    const again = () => { if (document.visibilityState === "visible") load(c); };      // coming back from the Builder shows the new app
    document.addEventListener("visibilitychange", again); window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [router, load]);
  useEffect(() => { if (d && d.role !== "admin") router.push("/dashboard"); }, [d, router]);

  async function save(everyone: boolean) {
    if (!sel) return; setBusy(true); setErr(""); setMsg("");
    try { await authFetch("/api/apps", { body: { clinicId: cid, app: sel.app, tab: sel.tab, everyone, roles, permissionSets: sets } }); setMsg("Saved. You can undo it from Builder → Change history."); setSel(null); await load(cid); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">App Manager</h1>
        <p className="text-slate-500 text-sm mb-5">Choose who sees each app and each tab. Admins always see everything. This controls the menu; what people can do with records is set in <a className="underline" href="/builder/access">Access control</a>.</p>
        {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
        {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}
        {d?.apps.map((a: any) => (
          <div key={a.api_name} className="bg-white border border-slate-100 rounded-xl mb-3">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><p className="font-semibold text-slate-900">{a.icon} {a.label}{a.is_system && <span className="ml-2 text-[11px] text-slate-400 font-normal">built in</span>}</p><p className="text-xs text-slate-500">Visible to: {lab(a.visible_roles, a.visible_sets?.length ? ["selected permission sets"] : null)}</p></div>
              <button onClick={() => { setSel({ app: a.api_name }); setRoles(a.visible_roles ?? []); setSets([]); }} className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:border-sky-300">Who can see</button>
            </div>
            <ul className="border-t border-slate-50 divide-y divide-slate-50">
              {a.tabs.map((t: any) => (
                <li key={t.label} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="text-slate-700">{t.label} <span className="text-xs text-slate-400">· {lab(t.visible_roles, t.visible_sets?.length ? ["selected permission sets"] : null)}</span></span>
                  {t.label !== "Home" && <button onClick={() => { setSel({ app: a.api_name, tab: t.label }); setRoles(t.visible_roles ?? []); setSets([]); }} className="text-xs px-2 py-1 rounded border border-slate-200 hover:border-sky-300">Change</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {sel && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Who can see this">
            <div className="bg-white rounded-2xl p-5 w-full max-w-md">
              <h2 className="font-semibold text-slate-900 mb-1">Who can see {sel.tab ? `“${sel.tab}”` : "this app"}?</h2>
              <p className="text-xs text-slate-500 mb-3">Pick roles, permission sets, or everyone.</p>
              <p className="text-xs font-medium text-slate-600 mb-1">Roles</p>
              <div className="flex flex-wrap gap-2 mb-3">{d.roles.filter((r: string) => r !== "admin").map((r: string) => <label key={r} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={roles.includes(r)} onChange={() => toggle(roles, r, setRoles)} />{r}</label>)}</div>
              {d.permissionSets.length > 0 && (<><p className="text-xs font-medium text-slate-600 mb-1">Permission sets</p><div className="flex flex-wrap gap-2 mb-3">{d.permissionSets.map((s: string) => <label key={s} className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={sets.includes(s)} onChange={() => toggle(sets, s, setSets)} />{s}</label>)}</div></>)}
              <div className="flex justify-between gap-2 mt-4">
                <button disabled={busy} onClick={() => save(true)} className="text-sm px-3 py-2 rounded-lg border border-slate-200">Everyone</button>
                <div className="flex gap-2"><button onClick={() => setSel(null)} className="text-sm px-3 py-2 rounded-lg border border-slate-200">Cancel</button>
                  <button disabled={busy || (!roles.length && !sets.length)} onClick={() => save(false)} className="text-sm px-3 py-2 rounded-lg bg-slate-900 text-white disabled:opacity-50">Save</button></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
