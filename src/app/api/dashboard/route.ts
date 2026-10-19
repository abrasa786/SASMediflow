import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Owner dashboard numbers (see migration 012 for exactly how each one is calculated). Money figures are hidden from interns. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const { data, error } = await db.rpc("dashboard_stats", { p_clinic: clinicId, p_actor: userId });
    if (error) throw new HttpError(500, /does not exist|Could not find/.test(error.message) ? "Dashboard figures are not installed yet. Run supabase/migrations/012_dashboard_stats.sql in the Supabase SQL editor." : error.message);
    const money = role === "admin" || role === "receptionist" || role === "doctor" || role === "nurse";
    return { stats: money ? data : { ...data, billed_today: null, collected_today: null, collection_rate: null, outstanding: null, outstanding_invoices: null, trend: [] }, role };
  });
}
