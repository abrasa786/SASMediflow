"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { getMyRoleInClinic } from "@/lib/clinic";
import type { ClinicRole } from "@/types";

interface Member { key: string; userId: string | null; doctorId: string | null; name: string; role: string; email: string; specialty: string; active: boolean; isMe: boolean; hasLogin: boolean; phone: string; fee: number | null; experience: number | null; shift: { start: string; end: string; breakStart: string; breakEnd: string; days: number[] } | null }
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "9:30", "930", "9.30 pm", "21:00" -> "HH:MM" (24 h), or null if it can't be read. */
function parseTyped(v: string): string | null {
  const t = v.trim().toLowerCase().replace(/\./g, ":").replace(/\s+/g, "");
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[3].startsWith("p") ? 12 : 0); }
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
const to12 = (hhmm: string) => { if (!hhmm) return ""; const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

/** A time you type (9:30, 930, 9.30 pm). It is tidied when you leave the box. */
function TimeField({ value, onChange, placeholder }: { value: string; onChange: (hhmm: string) => void; placeholder?: string }) {
  const [text, setText] = useState(to12(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(to12(value)); setBad(false); }, [value]);
  return (
    <input value={text} inputMode="text" placeholder={placeholder ?? "e.g. 9:30 AM"} aria-invalid={bad}
      onChange={(e) => { setText(e.target.value); setBad(false); }}
      onBlur={() => { if (!text.trim()) { onChange(""); setBad(false); return; } const r = parseTyped(text); if (r) { onChange(r); setText(to12(r)); setBad(false); } else setBad(true); }}
      className={`w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 ${bad ? "border-red-400" : "border-slate-200"}`} />
  );
}

const ROLE_COLORS: Record<string, string> = {
  admin:        "bg-purple-100 text-purple-700",
  doctor:       "bg-sky-100 text-sky-700",
  nurse:        "bg-emerald-100 text-emerald-700",
  receptionist: "bg-amber-100 text-amber-700",
};

export default function StaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<Member[]>([]);
  const [editing, setEditing] = useState<Member | null>(null);
  const [listErr, setListErr] = useState("");
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
    const cid: string = id;
    async function init() {
      const r = await getMyRoleInClinic(cid);
      setMyRole(r as ClinicRole);
      await reload(cid);
      setLoading(false);
    }
    init();
  }, [router]);

  async function reload(cid: string) {
    try { const d = await authFetch<{ members: Member[] }>(`/api/staff?clinicId=${cid}`); setStaff(d.members); setListErr(""); }
    catch (e: any) { setListErr(e.message || "Couldn't load the team."); }
  }

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
      await reload(clinicId);
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
            <p className="text-slate-500 text-sm mt-1">{staff.length} team members{myRole === "admin" ? " · tap a person to edit" : ""}</p>
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
          ) : listErr ? (
            <div className="py-12 text-center text-red-600 text-sm px-4">{listErr}</div>
          ) : staff.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm"><div className="text-4xl mb-3">👥</div>No staff members yet</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {staff.map(member => (
                <button key={member.key} type="button" onClick={() => setEditing(member)} className="w-full text-left flex items-center gap-4 px-6 py-4 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                    {member.name?.replace(/^dr\.?\s*/i, "").charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 truncate">{member.name || "—"}</p>
                    <p className="text-xs text-slate-500 truncate">{member.email || (member.hasLogin ? "" : "No login (can be booked)")}</p>
                    {(member.specialty || member.shift) && <p className="text-xs text-slate-400 mt-0.5 truncate">{[member.specialty, member.shift ? `${to12(member.shift.start)}–${to12(member.shift.end)}` : ""].filter(Boolean).join(" · ")}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${ROLE_COLORS[member.role] ?? "bg-slate-100 text-slate-600"}`}>{member.role}</span>
                    <span className={`hidden sm:inline text-xs px-2 py-0.5 rounded-full ${member.active ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
                      {member.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={() => { setShowInvite(false); setInviteMsg(""); setInviteErr(""); }}>
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
                      <div><label className="text-xs text-slate-500 block mb-1">From</label><TimeField value={shiftStart} onChange={setShiftStart} placeholder="9:00 AM" /></div>
                      <div><label className="text-xs text-slate-500 block mb-1">To</label><TimeField value={shiftEnd} onChange={setShiftEnd} placeholder="6:00 PM" /></div>
                      <div><label className="text-xs text-slate-500 block mb-1">Break from (optional)</label><TimeField value={breakStart} onChange={setBreakStart} placeholder="1:00 PM" /></div>
                      <div><label className="text-xs text-slate-500 block mb-1">Break to</label><TimeField value={breakEnd} onChange={setBreakEnd} placeholder="2:00 PM" /></div>
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
      {editing && <EditMember m={editing} clinicId={clinicId} canEdit={myRole === "admin"} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(clinicId); }} />}
    </AppShell>
  );
}

const fld = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50";

function EditMember({ m, clinicId, canEdit, onClose, onSaved }: { m: Member; clinicId: string; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const isDoc = m.role === "doctor";
  const [name, setName] = useState(m.name);
  const [specialty, setSpecialty] = useState(m.specialty);
  const [role, setRole] = useState(m.role);
  const [active, setActive] = useState(m.active);
  const [phone, setPhone] = useState(m.phone);
  const [fee, setFee] = useState(m.fee == null ? "" : String(m.fee));
  const [exp, setExp] = useState(m.experience == null ? "" : String(m.experience));
  const [start, setStart] = useState(m.shift?.start ?? "");
  const [end, setEnd] = useState(m.shift?.end ?? "");
  const [bs, setBs] = useState(m.shift?.breakStart ?? "");
  const [be, setBe] = useState(m.shift?.breakEnd ?? "");
  const [days, setDays] = useState<number[]>(m.shift?.days ?? [1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const roleLocked = m.role === "admin" || m.isMe;
  async function save() {
    setBusy(true); setErr("");
    try {
      await authFetch("/api/staff", { method: "PATCH", body: {
        clinicId, userId: m.userId, doctorId: m.doctorId, name, specialty, active, ...(roleLocked ? {} : { role }),
        ...(isDoc ? { phone, fee, experienceYears: exp, shiftStart: start, shiftEnd: end, breakStart: bs, breakEnd: be, days } : {}),
      } });
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h2 className="font-bold text-slate-900">{canEdit ? "Edit" : "View"} {m.name || "team member"}</h2><button onClick={onClose} className="text-slate-400 text-xl" aria-label="Close">×</button></div>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div><label className="text-xs font-medium text-slate-600 block mb-1">Full name</label><input className={fld} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} /></div>
          <div><label className="text-xs font-medium text-slate-600 block mb-1">Email (sign-in)</label><input className={fld} value={m.email || "No login"} disabled /><p className="text-xs text-slate-400 mt-1">The sign-in email is changed by the person themselves, under My profile, with a one-time code.</p></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-medium text-slate-600 block mb-1">Role</label>
              <select className={fld} value={role} onChange={(e) => setRole(e.target.value)} disabled={!canEdit || roleLocked}>{["admin", "doctor", "intern", "nurse", "receptionist"].map((r) => <option key={r} value={r} disabled={r === "admin" && m.role !== "admin"}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></div>
            <div><label className="text-xs font-medium text-slate-600 block mb-1">{isDoc ? "Specialty" : "Department"}</label><input className={fld} value={specialty} onChange={(e) => setSpecialty(e.target.value)} disabled={!canEdit} /></div>
          </div>
          {isDoc && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-medium text-slate-600 block mb-1">Mobile</label><input className={fld} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" disabled={!canEdit} /></div>
                <div><label className="text-xs font-medium text-slate-600 block mb-1">Consultation fee (₹)</label><input className={fld} value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" disabled={!canEdit} /></div>
                <div><label className="text-xs font-medium text-slate-600 block mb-1">Years of experience</label><input className={fld} value={exp} onChange={(e) => setExp(e.target.value)} inputMode="numeric" disabled={!canEdit} /></div>
              </div>
              <fieldset className="rounded-xl border border-slate-200 p-3" disabled={!canEdit}>
                <legend className="text-xs font-semibold text-slate-600 px-1">Shift timing (type the time, e.g. 9:30 AM)</legend>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-slate-500 block mb-1">From</label><TimeField value={start} onChange={setStart} /></div>
                  <div><label className="text-xs text-slate-500 block mb-1">To</label><TimeField value={end} onChange={setEnd} /></div>
                  <div><label className="text-xs text-slate-500 block mb-1">Break from</label><TimeField value={bs} onChange={setBs} /></div>
                  <div><label className="text-xs text-slate-500 block mb-1">Break to</label><TimeField value={be} onChange={setBe} /></div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3" role="group" aria-label="Working days">
                  {DAY_NAMES.map((d, i) => (
                    <button key={d} type="button" aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${days.includes(i) ? "bg-sky-500 border-sky-500 text-white" : "bg-white border-slate-200 text-slate-600"}`}>{d}</button>
                  ))}
                </div>
              </fieldset>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canEdit || m.role === "admin"} /> Active</label>
          {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg" role="alert">{err}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm">{canEdit ? "Cancel" : "Close"}</button>
          {canEdit && <button onClick={save} disabled={busy} className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-sm font-semibold disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>}
        </div>
      </div>
    </div>
  );
}
