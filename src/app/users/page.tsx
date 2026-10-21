"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";

interface U { userId: string; name: string | null; role: string; specialty: string | null; active: boolean; joined: string; email: string | null; lastSignIn: string | null; isMe: boolean }
const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700", doctor: "bg-sky-100 text-sky-700", intern: "bg-indigo-100 text-indigo-700",
  nurse: "bg-emerald-100 text-emerald-700", receptionist: "bg-amber-100 text-amber-700",
};
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "never");

export default function UsersPage() {
  const router = useRouter();
  const [clinicId, setClinicId] = useState("");
  const [users, setUsers] = useState<U[]>([]);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<U | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<U | null>(null);
  const [newPw, setNewPw] = useState("");
  const [done, setDone] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async (id: string) => {
    try {
      const d = await authFetch(`/api/users?clinicId=${id}`, { method: "GET" });
      setUsers(d.users); setCanDelete(d.canDelete);
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id); load(id);
  }, [router, load]);

  async function remove() {
    if (!confirm) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await authFetch("/api/users", { method: "DELETE", body: { clinicId, userId: confirm.userId } });
      setMsg(`${confirm.name || confirm.email} was removed from the clinic.`);
      setConfirm(null); await load(clinicId);
    } catch (e: any) { setErr(e.message); setConfirm(null); } finally { setBusy(false); }
  }

  function genPw() {
    const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const a = new Uint32Array(10); crypto.getRandomValues(a);
    setNewPw(Array.from(a, (n) => c[n % c.length]).join(""));
  }

  async function doReset() {
    if (!reset) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await authFetch("/api/users", { method: "PATCH", body: { clinicId, userId: reset.userId, password: newPw } });
      setDone(newPw);
    } catch (e: any) { setErr(e.message); setReset(null); } finally { setBusy(false); }
  }

  function closeReset() { setReset(null); setNewPw(""); setDone(""); }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="text-slate-500 text-sm mt-1">Everyone with a login to this clinic. {canDelete ? "As admin you can reset passwords and remove users." : "Only the clinic admin can remove users."}</p>
        </div>
        {msg && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2 mb-4">{msg}</p>}
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-2 mb-4">{err}</p>}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? <div className="py-16 text-center text-slate-400 text-sm">Loading…</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium">User</th>
                    <th className="px-5 py-3 text-left font-medium">Role</th>
                    <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Joined</th>
                    <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Last sign-in</th>
                    {canDelete && <th className="px-5 py-3" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {users.map((u) => (
                    <tr key={u.userId} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{u.name || u.email || "—"}{u.isMe && <span className="ml-2 text-xs text-slate-400">(you)</span>}</p>
                        <p className="text-xs text-slate-400">{u.email}</p>
                      </td>
                      <td className="px-5 py-3"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${ROLE_COLORS[u.role] ?? ""}`}>{u.role}</span></td>
                      <td className="px-5 py-3 text-slate-500 text-xs hidden md:table-cell">{fmt(u.joined)}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs hidden md:table-cell">{fmt(u.lastSignIn)}</td>
                      {canDelete && (
                        <td className="px-5 py-3 text-right">
                          {!u.isMe && u.role !== "admin" && <button onClick={() => { setReset(u); setNewPw(""); setDone(""); }} className="text-sky-700 hover:text-sky-900 text-xs font-semibold mr-4">Reset password</button>}
                          {!u.isMe && <button onClick={() => setConfirm(u)} className="text-red-600 hover:text-red-800 text-xs font-semibold">Delete</button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {confirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => setConfirm(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900 mb-2">Delete {confirm.name || confirm.email}?</h2>
            <p className="text-sm text-slate-600 mb-5">They lose access to this clinic immediately. Their past appointments, invoices and attendance stay on record.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold">Cancel</button>
              <button onClick={remove} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Deleting…" : "Delete user"}</button>
            </div>
          </div>
        </div>
      )}
      {reset && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={closeReset}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900 mb-2">Reset password for {reset.name || reset.email}</h2>
            {done ? (
              <>
                <p className="text-sm text-slate-600 mb-2">Password changed. Tell them this temporary password; it is not shown again:</p>
                <p className="font-mono text-sm bg-slate-100 rounded-lg px-3 py-2 mb-5 select-all">{done}</p>
                <button onClick={closeReset} className="w-full py-2.5 rounded-xl bg-sky-600 text-white text-sm font-semibold">Done</button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-3">Set a new temporary password (at least 8 characters). Their old password stops working immediately.</p>
                <div className="flex gap-2 mb-5">
                  <input value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password" className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm" />
                  <button type="button" onClick={genPw} className="px-3 rounded-xl border border-slate-300 text-sm font-semibold">Generate</button>
                </div>
                <div className="flex gap-2">
                  <button onClick={closeReset} className="flex-1 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold">Cancel</button>
                  <button onClick={doReset} disabled={busy || newPw.length < 8} className="flex-1 py-2.5 rounded-xl bg-sky-600 disabled:opacity-60 text-white text-sm font-semibold">{busy ? "Saving…" : "Reset password"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
