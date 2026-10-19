"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import BuilderTabs from "@/components/BuilderTabs";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getMyRoleInClinic } from "@/lib/clinic";
import { inputCls as inp } from "@/components/ui";

const BUILTIN = [{ api_name: "appointments", label: "Appointments" }, { api_name: "invoices", label: "Invoices" }, { api_name: "patients", label: "Patients" }, { api_name: "stock", label: "Stock" }];
interface Perm { read: boolean; create: boolean; edit: boolean; delete: boolean; read_scope: "all" | "own"; edit_scope: "all" | "own" }
const none = (): Perm => ({ read: false, create: false, edit: false, delete: false, read_scope: "all", edit_scope: "own" });
interface SetDraft { id?: string; name: string; description: string; perms: Record<string, Perm>; userIds: string[] }

export default function AccessPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  const load = useCallback(async (cid: string) => { try { setData(await authFetch(`/api/builder/access?clinicId=${cid}`)); } catch (e: any) { setErr(e.message); } }, []);
  useEffect(() => {
    const cid = getActiveClinicId();
    if (!cid) { router.push("/login"); return; }
    setClinicId(cid); getMyRoleInClinic(cid).then(setRole); load(cid);
  }, [router, load]);

  const open = (s?: any) => {
    const perms: Record<string, Perm> = {};
    for (const o of s?.objects ?? []) perms[o.object_api_name] = { read: o.can_read, create: o.can_create, edit: o.can_edit, delete: o.can_delete, read_scope: o.read_scope, edit_scope: o.edit_scope };
    setDraft({ id: s?.id, name: s?.name ?? "", description: s?.description ?? "", perms, userIds: s?.user_ids ?? [] }); setErr(""); setMsg("");
  };
  const setPerm = (obj: string, patch: Partial<Perm>) => setDraft((d) => d && ({ ...d, perms: { ...d.perms, [obj]: { ...(d.perms[obj] ?? none()), ...patch } } }));
  const preset = (kind: "read" | "entry" | "full") => setDraft((d) => {
    if (!d) return d; const perms: Record<string, Perm> = {};
    for (const t of data.tables) perms[t.api_name] = kind === "read" ? { ...none(), read: true } : kind === "entry" ? { read: true, create: true, edit: true, delete: false, read_scope: "own", edit_scope: "own" } : { read: true, create: true, edit: true, delete: true, read_scope: "all", edit_scope: "all" };
    return { ...d, perms };
  });

  async function save() {
    if (!draft) return; setErr(""); setMsg(""); setBusy(true);
    try {
      const objects = Object.entries(draft.perms).map(([object, p]) => ({ object, ...p }));
      const r = await authFetch("/api/builder/access", { body: { clinicId, action: "save_set", id: draft.id, name: draft.name, description: draft.description, objects } });
      await authFetch("/api/builder/access", { body: { clinicId, action: "assign", setId: r.id, userIds: draft.userIds } });
      setMsg("Saved. The change applies the next time they open a page."); setDraft(null); await load(clinicId!);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(id: string) { setErr(""); try { await authFetch("/api/builder/access", { body: { clinicId, action: "delete_set", setId: id } }); setDraft(null); await load(clinicId!); } catch (e: any) { setErr(e.message); } }

  if (role && role !== "admin") return <AppShell><div className="p-6"><p className="text-slate-600">Only the clinic admin can manage access.</p></div></AppShell>;
  const staffName = (id: string) => data?.staff.find((s: any) => s.user_id === id)?.name ?? "Staff";

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Builder</h1>
        <p className="text-sm text-slate-500 mb-4">Decide who can see and change the data in your tables.</p>
        <BuilderTabs isAdmin />
        {err && <p className="mb-4 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2" role="alert">{err}</p>}
        {msg && <p className="mb-4 text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2" role="status">{msg}</p>}
        <div className="rounded-xl bg-sky-50 border border-sky-100 p-4 text-sm text-sky-900 mb-5">
          <p><b>How it works.</b> Admins can do everything. Everyone else starts with no access to tables you build, and gets access through a <b>permission set</b>: a named bundle such as “Lab technicians”. A set says which tables people can read, add, edit or delete, and whether they see <b>all records or only their own</b>. Give a set to as many people as you like.</p>
        </div>
        {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
          <div className="grid lg:grid-cols-[280px_1fr] gap-6">
            <div className="space-y-2">
              <button onClick={() => open()} className="w-full px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">+ New permission set</button>
              {data.sets.map((s: any) => (
                <button key={s.id} onClick={() => open(s)} className={`w-full text-left bg-white rounded-xl border p-3 hover:border-sky-300 ${draft?.id === s.id ? "border-sky-500" : "border-slate-200"}`}>
                  <p className="font-medium text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.objects.length} table{s.objects.length === 1 ? "" : "s"} · {s.user_ids.length} {s.user_ids.length === 1 ? "person" : "people"}</p>
                </button>))}
              {data.sets.length === 0 && <p className="text-sm text-slate-400 px-1">No permission sets yet.</p>}
            </div>
            {draft ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-slate-600">Name<input className={inp + " mt-1"} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Lab technicians" /></label>
                  <label className="text-xs font-medium text-slate-600">Description<input className={inp + " mt-1"} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2"><h3 className="font-semibold text-slate-900 text-sm">Tables</h3>
                    {data.tables.length > 0 && <><span className="text-xs text-slate-400">Quick fill:</span>
                      {([["read", "Read only"], ["entry", "Data entry (own records)"], ["full", "Full access"]] as const).map(([k, l]) => <button key={k} onClick={() => preset(k)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:bg-slate-50">{l}</button>)}</>}</div>
                  {data.tables.length === 0 && <p className="text-sm text-slate-400 mb-2">You have not built any tables yet. You can still grant access to the built-in ones below.</p>}
                  <div className="overflow-x-auto"><table className="w-full text-sm">
                    <thead><tr className="text-xs uppercase text-slate-500 text-left"><th className="py-2 pr-3 font-medium">Table</th><th className="px-2 font-medium">Read</th><th className="px-2 font-medium">Add</th><th className="px-2 font-medium">Edit</th><th className="px-2 font-medium">Delete</th><th className="px-2 font-medium">Sees</th><th className="px-2 font-medium">Changes</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {[...data.tables.map((t: any) => ({ ...t, builtin: false })), ...BUILTIN.map((b) => ({ ...b, builtin: true }))].map((t: any) => { const p = draft.perms[t.api_name] ?? none(); return (
                        <tr key={t.api_name}><td className="py-2.5 pr-3 font-medium text-slate-800">{t.icon ?? ""} {t.plural_label ?? t.label}{t.builtin && <span className="block text-xs font-normal text-slate-400">built-in · read only</span>}</td>
                          {(["read", "create", "edit", "delete"] as const).map((k) => <td key={k} className="px-2"><input type="checkbox" aria-label={`${k} ${t.label}`} disabled={t.builtin && k !== "read"} checked={p[k]} onChange={(e) => setPerm(t.api_name, { [k]: e.target.checked, ...(k !== "read" && e.target.checked ? { read: true } : {}) })} /></td>)}
                          <td className="px-2"><select disabled={!p.read || t.builtin} className="text-xs border border-slate-200 rounded-lg px-2 py-1" value={p.read_scope} onChange={(e) => setPerm(t.api_name, { read_scope: e.target.value as any })}><option value="all">All records</option><option value="own">Own records</option></select></td>
                          <td className="px-2"><select disabled={!(p.edit || p.delete) || t.builtin} className="text-xs border border-slate-200 rounded-lg px-2 py-1" value={p.edit_scope} onChange={(e) => setPerm(t.api_name, { edit_scope: e.target.value as any })}><option value="own">Own records</option><option value="all">All records</option></select></td></tr>); })}
                    </tbody></table></div>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm mb-2">Who has this set</h3>
                  {data.staff.length === 0 ? <p className="text-sm text-slate-400">Add staff first (Staff page).</p> : <div className="grid sm:grid-cols-2 gap-1.5">{data.staff.map((s: any) => (
                    <label key={s.user_id} className="flex items-center gap-2 text-sm rounded-lg border border-slate-100 px-3 py-2"><input type="checkbox" checked={draft.userIds.includes(s.user_id)} onChange={(e) => setDraft({ ...draft, userIds: e.target.checked ? [...draft.userIds, s.user_id] : draft.userIds.filter((u) => u !== s.user_id) })} />{s.name ?? "Unnamed"} <span className="text-xs text-slate-400 capitalize">{s.role}</span></label>))}</div>}
                </div>
                <div className="flex justify-between">
                  <div>{draft.id && <button onClick={() => remove(draft.id!)} className="text-sm text-red-600 hover:underline">Delete this set{draft.userIds.length ? ` (${draft.userIds.length} ${draft.userIds.length === 1 ? "person loses" : "people lose"} access)` : ""}</button>}</div>
                  <div className="flex gap-2"><button onClick={() => setDraft(null)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">Cancel</button><button disabled={busy} onClick={save} className="px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Saving…" : "Save"}</button></div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">Choose a permission set, or create a new one.{data.sets.length > 0 && <p className="mt-3 text-xs">{Array.from(new Set(data.sets.flatMap((s: any) => s.user_ids))).length} people currently have a set: {Array.from(new Set(data.sets.flatMap((s: any) => s.user_ids))).slice(0, 5).map((u: any) => staffName(u)).join(", ")}</p>}</div>
            )}
          </div>)}
      </div>
    </AppShell>
  );
}
