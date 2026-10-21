import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { parseEngineError, friendlyEngineMessage } from "@/lib/booking/engine";

export const dynamic = "force-dynamic";

const ROLES = ["admin", "doctor", "intern", "nurse", "receptionist"];
const TIME = /^\d{2}:\d{2}$/;
const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");

/** Everyone on the team: people with a login, and doctors who were added without one. Any member can see the list. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId: me, role: myRole } = await requireClinicMember(req, clinicId);
    const [{ data: staff, error: se }, { data: docs, error: de }, { data: sched }] = await Promise.all([
      db.from("clinic_staff").select("id, user_id, role, name, specialty, is_active, created_at").eq("clinic_id", clinicId).order("created_at"),
      db.from("doctors").select("id, user_id, name, specialty, speciality, phone, consultation_fee, experience_years, is_active").eq("clinic_id", clinicId).order("created_at"),
      db.from("doctor_schedules").select("doctor_id, weekday, start_time, end_time, break_start, break_end").eq("clinic_id", clinicId).eq("is_active", true),
    ]);
    if (se) throw new HttpError(400, se.message);
    if (de) throw new HttpError(400, de.message);

    const shiftOf = (doctorId: string) => {
      const rows = (sched ?? []).filter((r: any) => r.doctor_id === doctorId);
      if (!rows.length) return null;
      const f = rows[0];
      return { start: hhmm(f.start_time), end: hhmm(f.end_time), breakStart: hhmm(f.break_start), breakEnd: hhmm(f.break_end), days: rows.map((r: any) => Number(r.weekday)).sort() };
    };
    const docInfo = (d: any) => d ? { doctorId: d.id, phone: d.phone ?? "", fee: d.consultation_fee ?? null, experience: d.experience_years ?? null, shift: shiftOf(d.id) } : { doctorId: null, phone: "", fee: null, experience: null, shift: null };

    const members: any[] = await Promise.all((staff ?? []).map(async (s: any) => {
      let email = "";
      try { const { data } = await db.auth.admin.getUserById(s.user_id); email = data?.user?.email ?? ""; } catch { /* leave blank */ }
      const d = (docs ?? []).find((x: any) => x.user_id === s.user_id);
      return { key: `u:${s.user_id}`, userId: s.user_id, name: s.name ?? d?.name ?? "", role: s.role, email, specialty: s.specialty ?? d?.specialty ?? d?.speciality ?? "", active: s.is_active !== false, isMe: s.user_id === me, hasLogin: true, ...docInfo(d) };
    }));
    const linked = new Set((staff ?? []).map((s: any) => s.user_id));
    for (const d of docs ?? []) {
      if (d.user_id && linked.has(d.user_id)) continue;
      members.push({ key: `d:${d.id}`, userId: null, name: d.name, role: "doctor", email: "", specialty: d.specialty ?? d.speciality ?? "", active: d.is_active !== false, isMe: false, hasLogin: false, ...docInfo(d) });
    }
    return { members, canEdit: myRole === "admin" };
  });
}

/** Admin: change one person's details (and a doctor's fee and hours). Admin accounts keep their role here. */
export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId: me } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const uid = typeof b.userId === "string" && /^[0-9a-f-]{36}$/i.test(b.userId) ? b.userId : null;
    const did = typeof b.doctorId === "string" && /^[0-9a-f-]{36}$/i.test(b.doctorId) ? b.doctorId : null;
    if (!uid && !did) throw new HttpError(400, "Choose a person to change.");
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (name.length < 2) throw new HttpError(400, "Enter a name.");
    const specialty = typeof b.specialty === "string" ? b.specialty.trim().slice(0, 80) || null : null;
    const active = b.active !== false;

    let role: string | null = null;
    if (uid) {
      const { data: cur } = await db.from("clinic_staff").select("role").eq("clinic_id", b.clinicId).eq("user_id", uid).maybeSingle();
      if (!cur) throw new HttpError(404, "That person is not in this clinic.");
      role = cur.role;
      if (typeof b.role === "string" && b.role !== cur.role) {
        if (!ROLES.includes(b.role)) throw new HttpError(400, "Choose a valid role.");
        if (cur.role === "admin" || uid === me) throw new HttpError(409, "An admin's role can't be changed here. Use the Users page.");
        role = b.role;
      }
      if (cur.role === "admin" && !active) throw new HttpError(409, "An admin can't be made inactive here.");
      const { error } = await db.from("clinic_staff").update({ name, specialty, role, is_active: active }).eq("clinic_id", b.clinicId).eq("user_id", uid);
      if (error) throw new HttpError(400, error.message);
    }

    // doctor profile and hours
    const isDoctorRole = (role ?? "doctor") === "doctor" || !!did;
    if (isDoctorRole) {
      let docId = did;
      if (!docId && uid) { const { data: d } = await db.from("doctors").select("id").eq("clinic_id", b.clinicId).eq("user_id", uid).maybeSingle(); docId = d?.id ?? null; }
      if (docId) {
        const years = b.experienceYears === "" || b.experienceYears == null ? null : Number(b.experienceYears);
        if (years !== null && (!Number.isInteger(years) || years < 0 || years > 70)) throw new HttpError(400, "Years of experience must be a whole number from 0 to 70.");
        const fee = b.fee === "" || b.fee == null ? null : Number(b.fee);
        if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new HttpError(400, "Enter a valid consultation fee.");
        const digits = typeof b.phone === "string" ? b.phone.replace(/\D/g, "").slice(-10) : "";
        if (b.phone && digits.length !== 10) throw new HttpError(400, "Enter a 10-digit mobile number.");
        const dn = /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
        const { error } = await db.from("doctors").update({ name: dn, specialty, speciality: specialty, experience_years: years, phone: digits || null, consultation_fee: fee, is_active: active }).eq("id", docId).eq("clinic_id", b.clinicId);
        if (error) throw new HttpError(400, error.message);
        if (b.shiftStart || b.shiftEnd) {
          if (!TIME.test(b.shiftStart ?? "") || !TIME.test(b.shiftEnd ?? "") || b.shiftEnd <= b.shiftStart) throw new HttpError(400, "The shift must start before it ends (same day).");
          if ((b.breakStart && !b.breakEnd) || (!b.breakStart && b.breakEnd)) throw new HttpError(400, "A break needs both a start and an end.");
          if (b.breakStart && (b.breakStart < b.shiftStart || b.breakEnd > b.shiftEnd || b.breakEnd <= b.breakStart)) throw new HttpError(400, "The break must sit inside the shift.");
          const days: number[] = Array.isArray(b.days) && b.days.length ? b.days.map(Number).filter((d: number) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5, 6];
          const rows = Array.from(new Set(days)).map((weekday) => ({ weekday, start: b.shiftStart, end: b.shiftEnd, break_start: b.breakStart || null, break_end: b.breakEnd || null }));
          const r = await db.rpc("appt_set_schedule", { p_clinic: b.clinicId, p_doctor: docId, p_rows: rows });
          if (r.error) { const e = parseEngineError(r.error.message); throw new HttpError(400, `Saved, but the hours were not: ${friendlyEngineMessage(e.code, e.detail)}`); }
        }
      }
    }
    return { success: true };
  });
}
