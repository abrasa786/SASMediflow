import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { parseEngineError, friendlyEngineMessage } from "@/lib/booking/engine";

const ROLES = ["admin", "doctor", "intern", "nurse", "receptionist"];
const TIME = /^\d{2}:\d{2}$/;

async function findUserByEmail(db: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const u = data.users.find((x: any) => (x.email ?? "").toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

/**
 * Add a team member. Admin only.
 * Doctors carry a full profile (specialty, experience, phone, fee) and weekly hours.
 * A doctor can be added WITHOUT an email: they can be booked but have no login.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId: callerId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const role = String(b.role ?? "");
    const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 80) : "";
    if (!ROLES.includes(role)) throw new HttpError(400, "Choose a valid role.");
    if (role !== "doctor" && !email) throw new HttpError(400, "Email is required for this role.");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    if (role === "doctor" && name.length < 2) throw new HttpError(400, "Enter the doctor's name.");

    const years = b.experienceYears === "" || b.experienceYears == null ? null : Number(b.experienceYears);
    if (years !== null && (!Number.isInteger(years) || years < 0 || years > 70)) throw new HttpError(400, "Years of experience must be a whole number from 0 to 70.");
    const fee = b.fee === "" || b.fee == null ? null : Number(b.fee);
    if (fee !== null && (!Number.isFinite(fee) || fee < 0)) throw new HttpError(400, "Enter a valid consultation fee.");
    const phoneDigits = typeof b.phone === "string" ? b.phone.replace(/\D/g, "").slice(-10) : "";
    if (b.phone && phoneDigits.length !== 10) throw new HttpError(400, "Enter a 10-digit mobile number.");

    let rows: any[] = [];
    if (role === "doctor") {
      if (b.shiftStart || b.shiftEnd) {
        if (!TIME.test(b.shiftStart ?? "") || !TIME.test(b.shiftEnd ?? "") || b.shiftEnd <= b.shiftStart) throw new HttpError(400, "The shift must start before it ends (same day).");
        if ((b.breakStart && !b.breakEnd) || (!b.breakStart && b.breakEnd)) throw new HttpError(400, "A break needs both a start and an end.");
        if (b.breakStart && (b.breakStart < b.shiftStart || b.breakEnd > b.shiftEnd || b.breakEnd <= b.breakStart)) throw new HttpError(400, "The break must sit inside the shift.");
        const days: number[] = Array.isArray(b.days) && b.days.length ? b.days.map(Number).filter((d: number) => d >= 0 && d <= 6) : [1, 2, 3, 4, 5, 6];
        rows = Array.from(new Set(days)).map((weekday) => ({ weekday, start: b.shiftStart, end: b.shiftEnd, break_start: b.breakStart || null, break_end: b.breakEnd || null }));
      }
    }

    // 1. login (optional for doctors)
    let userId: string | null = null;
    let invited = false;
    if (email) {
      userId = await findUserByEmail(db, email);
      if (!userId) {
        const { data, error } = await (db as any).auth.admin.inviteUserByEmail(email, {
          redirectTo: `${(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "")}/login?invited=1`,
          data: { name, role },
        });
        if (error) throw new HttpError(400, /rate limit/i.test(error.message) ? "Too many emails were sent. Wait a little, or add your own SMTP in Supabase." : error.message);
        userId = data.user.id; invited = true;
      }
      // Never change the role of someone who is already an admin (this used to turn the owner into a doctor
      // when they added themselves). An admin who also practises keeps admin and just gets a doctor profile.
      const { data: existingMember } = await db.from("clinic_staff").select("role").eq("clinic_id", b.clinicId).eq("user_id", userId).maybeSingle();
      if (existingMember?.role === "admin" || userId === callerId) {
        if (role !== "doctor" && role !== "admin") throw new HttpError(409, "This person is an admin of the clinic. Their admin access was not changed.");
        await db.from("clinic_staff").update({ name: name || undefined, specialty: b.specialty || null, is_active: true }).eq("clinic_id", b.clinicId).eq("user_id", userId);
      } else {
        const { error: se } = await db.from("clinic_staff").upsert({ clinic_id: b.clinicId, user_id: userId, role, name: name || null, specialty: b.specialty || null, is_active: true }, { onConflict: "clinic_id,user_id" });
        if (se) throw new HttpError(400, se.message);
      }
    }

    // 2. doctor profile + hours
    let doctorId: string | null = null;
    if (role === "doctor") {
      const profile = {
        clinic_id: b.clinicId, user_id: userId, name: /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`,
        specialty: b.specialty || null, speciality: b.specialty || null, experience_years: years,
        phone: phoneDigits || null, consultation_fee: fee, is_active: true,
      };
      let res;
      if (userId) res = await db.from("doctors").upsert(profile, { onConflict: "clinic_id,user_id" }).select("id").single();
      else {
        const { data: dup } = await db.from("doctors").select("id").eq("clinic_id", b.clinicId).ilike("name", profile.name).limit(1);
        if (dup?.length) throw new HttpError(409, `A doctor named ${profile.name} already exists.`);
        res = await db.from("doctors").insert(profile).select("id").single();
      }
      if (res.error) throw new HttpError(400, res.error.message);
      doctorId = res.data.id;
      if (rows.length) {
        const { error } = await db.rpc("appt_set_schedule", { p_clinic: b.clinicId, p_doctor: doctorId, p_rows: rows });
        if (error) { const e = parseEngineError(error.message); throw new HttpError(400, `Doctor added, but hours were not saved: ${friendlyEngineMessage(e.code, e.detail)}`); }
      }
    }
    return { success: true, userId, doctorId, invited, hoursSaved: rows.length > 0 };
  });
}
