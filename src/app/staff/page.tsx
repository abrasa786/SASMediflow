"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { getStaffMembers, getMyRoleInClinic } from "@/lib/clinic";
import type { StaffMember, ClinicRole } from "@/types";

const ROLE_COLORS: Record<string, string> = {
  admin:        "bg-purple-100 text-purple-700",
  doctor:       "bg-sky-100 text-sky-700",
  nurse:        "bg-emerald-100 text-emerald-700",
  receptionist: "bg-amber-100 text-amber-700",
};

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicId] = useState("");
  const [myRole, setMyRole] = useState<ClinicRole | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ClinicRole>("receptionist");
  const [inviteName, setInviteName] = useState("");
  const [inviteSpecialty, setInviteSpecialty] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteErr, setInviteErr] = useState("");

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    async function init() {
      const [s, r] = await Promise.all([getStaffMembers(id), getMyRoleInClinic(id)]);
      setStaff(s);
      setMyRole(r as ClinicRole);
      setLoading(false);
    }
    init();
  }, [router]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) { setInviteErr("Email required"); return; }
    setSending(true); setInviteErr(""); setInviteMsg("");
    try {
      const res = await fetch("/api/staff/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, email: inviteEmail, role: inviteRole, name: inviteName, specialty: inviteSpecialty }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to invite");
      setInviteMsg(`✅ Invitation sent to ${inviteEmail}`);
      setInviteEmail(""); setInviteName(""); setInviteSpecialty("");
      const s = await getStaffMembers(clinicId);
      setStaff(s);
    } catch (e: any) {
      setInviteErr(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Staff</h1>
            <p className="text-slate-500 text-sm mt-1">{staff.length} team members</p>
          </div>
          {myRole === "admin" && (
            <button onClick={() => setShowInvite(true)} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
              + Invite Staff
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm"><div className="text-4xl mb-3">👥</div>No staff members yet</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {staff.map(member => (
                <div key={member.id} className="flex items-center gap-4 px-6 py-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {member.name?.charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{member.name ?? "—"}</p>
                    <p className="text-xs text-slate-500">{member.email}</p>
                    {member.specialty && <p className="text-xs text-slate-400 mt-0.5">{member.specialty}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${ROLE_COLORS[member.role]}`}>{member.role}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${member.is_active ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
                      {member.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setShowInvite(false); setInviteMsg(""); setInviteErr(""); }}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-900">Invite Staff Member</h2>
              <button onClick={() => { setShowInvite(false); setInviteMsg(""); setInviteErr(""); }} className="text-slate-400 text-xl">×</button>
            </div>
            <form onSubmit={handleInvite} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Email *</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Full Name</label>
                <input value={inviteName} onChange={e => setInviteName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Dr. Jane Smith" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Role *</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value as ClinicRole)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="receptionist">Receptionist</option>
                  <option value="nurse">Nurse</option>
                  <option value="doctor">Doctor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {(inviteRole === "doctor") && (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Specialty</label>
                  <input value={inviteSpecialty} onChange={e => setInviteSpecialty(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="e.g. Dentist, Cardiologist" />
                </div>
              )}
              {inviteMsg && <p className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{inviteMsg}</p>}
              {inviteErr && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{inviteErr}</p>}
              <button type="submit" disabled={sending} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                {sending ? "Sending invite…" : "Send Invitation"}
              </button>
            </form>
            <p className="text-xs text-slate-400 mt-3 text-center">They&apos;ll receive a magic link to set up their account and join this clinic.</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
