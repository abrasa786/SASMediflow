import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { loadCandidates, recallSettings, sendRecall } from "@/lib/recall/engine";
import { whatsappConfigured } from "@/lib/booking/notify";

export const dynamic = "force-dynamic";
const STAFF = ["admin", "doctor", "nurse", "receptionist"] as const;

/** Who is due a nudge, the recent log, and the settings. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, role } = await requireClinicMember(req, clinicId, [...STAFF]);
    const { data: cl } = await db.from("clinics").select("settings").eq("id", clinicId).maybeSingle();
    const settings = recallSettings(cl?.settings);
    let candidates: any[] = [];
    try { candidates = await loadCandidates(db, clinicId!, settings.days); }
    catch (e: any) { throw new HttpError(500, /recall_candidates|does not exist|Could not find/.test(e.message) ? "Recall is not installed yet. Run supabase/migrations/015_whatsapp_recall.sql in the Supabase SQL editor." : e.message); }
    const { data: log } = await db.from("recall_log").select("id, reason, status, auto, created_at, clinic_patients(name)").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(20);
    return { candidates, settings, whatsapp: whatsappConfigured(), chatReady: !!process.env.WHATSAPP_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN, log: log ?? [], role };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    if (b.action === "settings") {
      const { db } = await requireClinicMember(req, b.clinicId, ["admin"]);
      const { data: cl } = await db.from("clinics").select("settings").eq("id", b.clinicId).maybeSingle();
      const cur = recallSettings(cl?.settings);
      const next = { auto: typeof b.auto === "boolean" ? b.auto : cur.auto, days: b.days != null ? Math.min(Math.max(Number(b.days) || cur.days, 30), 730) : cur.days, daily_limit: b.dailyLimit != null ? Math.min(Math.max(Number(b.dailyLimit) || cur.daily_limit, 1), 100) : cur.daily_limit };
      const { error } = await db.from("clinics").update({ settings: { ...(cl?.settings ?? {}), recall: next } }).eq("id", b.clinicId);
      if (error) throw new HttpError(500, error.message);
      return { settings: next };
    }
    const { db, userId } = await requireClinicMember(req, b.clinicId, [...STAFF]);
    if (!Array.isArray(b.patientIds) || !b.patientIds.length) throw new HttpError(400, "Choose at least one patient.");
    const ids = b.patientIds.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x as string));
    const { data: cl } = await db.from("clinics").select("settings").eq("id", b.clinicId).maybeSingle();
    const results = await sendRecall(db, b.clinicId, ids, { actor: userId, days: recallSettings(cl?.settings).days });
    return { results };
  });
}
