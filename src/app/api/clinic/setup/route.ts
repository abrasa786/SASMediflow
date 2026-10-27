import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

const FLAGS = new Set(["prices_reviewed", "templates_reviewed", "whatsapp_done", "dismissed", "completed"]);
const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const digits = (v: string) => v.replace(/\D/g, "");

/** Clinic details and the first-run setup, saved on the server so they always apply (and any mistake is explained). Admin only. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const id = b.clinicId as string;

    if (b.action === "flag") {
      if (!FLAGS.has(b.flag)) throw new HttpError(400, "Unknown setup step.");
      const { data } = await db.from("clinics").select("settings").eq("id", id).maybeSingle();
      const settings = (data?.settings ?? {}) as any;
      settings.setup = { ...(settings.setup ?? {}), [b.flag]: b.value !== false };
      const { error } = await db.from("clinics").update({ settings }).eq("id", id);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }

    if (b.action === "profile") {
      const f = b.fields ?? {};
      const patch: Record<string, unknown> = {};
      const errs: string[] = [];
      if ("name" in f) { const v = s(f.name, 120); if (v.length < 2) errs.push("Enter the clinic's legal name."); else patch.name = v; }
      if ("brand_name" in f) patch.brand_name = s(f.brand_name, 120) || null;
      if ("specialty" in f) patch.specialty = s(f.specialty, 60) || null;
      if ("phone" in f) { const v = s(f.phone, 20); if (v && (digits(v).length < 10 || digits(v).length > 13)) errs.push("Enter a valid phone number with at least 10 digits."); else patch.phone = v || null; }
      if ("email" in f) { const v = s(f.email, 120); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) errs.push("Enter a valid email address, like name@example.com."); else patch.email = v || null; }
      if ("address" in f) { const v = s(f.address, 300); if (v && v.length < 5) errs.push("Enter the full address (at least 5 characters)."); else patch.address = v || null; }
      if ("city" in f) patch.city = s(f.city, 80) || null;
      if ("state" in f) patch.state = s(f.state, 80) || null;
      if ("website" in f) { const v = s(f.website, 200); if (v && !/^https?:\/\/\S+\.\S+/i.test(v)) errs.push("The website must start with http:// or https://."); else patch.website = v || null; }
      if ("gst_number" in f) { const v = s(f.gst_number, 20).toUpperCase(); if (v && !/^[0-9A-Z]{15}$/.test(v)) errs.push("A GST number has 15 letters and digits, like 22ABCDE1234F1Z5."); else patch.gst_number = v || null; }
      if ("working_hours" in f) {
        const w = f.working_hours ?? {};
        if (Array.isArray(w.days) && w.days.length && w.open && w.close && String(w.close) <= String(w.open)) errs.push("Closing time must be later than opening time.");
        else patch.working_hours = { days: Array.isArray(w.days) ? w.days.slice(0, 7) : [], open: s(w.open, 5) || "09:00", close: s(w.close, 5) || "18:00" };
      }
      if (errs.length) throw new HttpError(400, errs.join(" "));
      if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to save.");
      const { error } = await db.from("clinics").update(patch).eq("id", id);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }

    if (b.action === "doctor") {
      let name = s(b.name, 120), specialty: string | null = s(b.specialty, 80) || null, user: string | null = null;
      if (b.me) {
        const { data: me } = await db.from("clinic_staff").select("name, specialty").eq("clinic_id", id).eq("user_id", userId).maybeSingle();
        name = name || me?.name || ""; specialty = specialty ?? me?.specialty ?? null; user = userId;
        const { data: dup } = await db.from("doctors").select("id").eq("clinic_id", id).eq("user_id", userId).maybeSingle();
        if (dup) throw new HttpError(409, "You are already added as a doctor.");
      }
      if (name.length < 2) throw new HttpError(400, "Enter the doctor's name.");
      const { error } = await db.from("doctors").insert({ clinic_id: id, user_id: user, name, specialty, is_active: true });
      if (error) throw new HttpError(400, error.code === "23505" ? "That doctor is already added." : error.message);
      return { ok: true };
    }
    throw new HttpError(400, "Unknown action.");
  });
}
