"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";
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
  const [exp, setExp] = useState("");
  const [phone, setPhone] = useState("");
  const [fee, setFee] = useState("");
  const [shiftStart, setShiftStart] = useState("09:00");
  const [shiftEnd, setShiftEnd] = useState("18:00");
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
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
    const isDoc = inviteRole === "doctor";
    if (!isDoc && !inviteEmail.trim()) { setInviteErr("Email is required for this role."); return; }
    if (isDoc && inviteName.trim().length < 2) { setInviteErr("Enter the doctor's name."); return; }
    setSending(true); setInviteErr(""); setInviteMsg("");
    try {
      const data = await authFetch("/api/staff/invite", { body: {
        clinicId, email: inviteEmail, role: inviteRole, name: inviteName, specialty: inviteSpecialty,
        ...(isDoc ? { experienceYears: exp, phone, fee, shiftStart, shiftEnd, breakStart, breakEnd, days } : {}),
      } });
      setInviteMsg(isDoc
        ? `✅ ${inviteName} added${data.hoursSaved ? " with their weekly hours" : ""}.${inviteEmail ? (data.invited ? ` Invitation sent to ${inviteEmail}.` : " Linked to the existing login.") : " No login created (they can still be booked)."}`
        : `✅ ${data.invited ? "Invitation sent to" : "Added"} ${inviteEmail}`);
      setInviteEmail(""); setInviteName(""); setInviteSpecialty(""); setExp(""); setPhone(""); setFee(""); setBreakStart(""); setBreakEnd("");
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
              + Add staff
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
              <h2 className="font-bold text-slate-900">Add staff member</h2>
              <button onClick={() => { setShowInvite(false); setInviteMsg(""); setInviteErr(""); }} className="text-slate-400 text-xl">×</button>
            </div>
            <form onSubmit={handleInvite} className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Role *</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value as ClinicRole)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                  <option value="receptionist">Receptionist</option>
                  <option value="nurse">Nurse</option>
                  <option value="doctor">Doctor</option>
                  <option value="intern">Intern / Resident</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Full name {inviteRole === "doctor" ? "*" : ""}</label>
                <input value={inviteName} onChange={e => setInviteName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Abdul Rahim" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Email {inviteRole === "doctor" ? "(optional, only if they need a login)" : "*"}</label>
                <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required={inviteRole !== "doctor"} />
              </div>
              {inviteRole === "intern" && (
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Department / rotation</label>
                  <input value={inviteSpecialty} onChange={e => setInviteSpecialty(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="e.g. Dentistry, Paediatrics" />
                  <p className="text-xs text-slate-400 mt-1">Interns can see patients, appointments and plans, but cannot bill, change stock or complete treatments.</p>
                </div>
              )}
              {inviteRole === "doctor" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 block mb-1">Specialty</label>
                      <input value={inviteSpecialty} onChange={e => setInviteSpecialty(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="Dentist" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 block mb-1">Years of experience</label>
                      <input value={exp} onChange={e => setExp(e.target.value)} inputMode="numeric" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="10" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 block mb-1">Mobile (for WhatsApp)</label>
                      <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="98450 12345" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 block mb-1">Consultation fee (₹)</label>
                      <input value={fee} onChange={e => setFee(e.target.value)} inputMode="decimal" className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" placeholder="500" />
                    </div>
                  </div>
                  <fieldset className="rounded-xl border border-slate-200 p-3">
                    <legend className="text-xs font-semibold text-slate-600 px-1">Shift timing</legend>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-xs text-slate-500 block mb-1">From</label><input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                      <div><label className="text-xs text-slate-500 block mb-1">To</label><input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                      <div><label className="text-xs text-slate-500 block mb-1">Break from (optional)</label><input type="time" value={breakStart} onChange={e => setBreakStart(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                      <div><label className="text-xs text-slate-500 block mb-1">Break to</label><input type="time" value={breakEnd} onChange={e => setBreakEnd(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" /></div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label="Working days">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                        <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter(x => x !== i) : [...days, i])}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${days.includes(i) ? "bg-sky-500 border-sky-500 text-white" : "bg-white border-slate-200 text-slate-600"}`}>{d}</button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-2">Bookings are only offered inside this shift. Fine-tune each day later on the Availability page.</p>
                  </fieldset>
                </>
              )}
              {inviteMsg && <p className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">{inviteMsg}</p>}
              {inviteErr && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{inviteErr}</p>}
              <button type="submit" disabled={sending} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                {sending ? "Saving…" : inviteRole === "doctor" ? "Add doctor" : "Send invitation"}
              </button>
            </form>
            <p className="text-xs text-slate-400 mt-3 text-center">With an email, they get a link to set up their login and join this clinic.</p>
          </div>
        </div>
      )}
    </AppShell>
  );
}
