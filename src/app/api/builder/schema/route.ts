import { NextRequest } from "next/server";
import { handle, loadSchema, requireClinicAdmin } from "@/lib/builder/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db } = await requireClinicAdmin(req, clinicId);
    const schema = await loadSchema(db, clinicId!);
    const { data: changesets } = await db.from("builder_changesets")
      .select("id, prompt, plan, status, error, created_at")
      .eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(20);
    return { schema, changesets: changesets ?? [] };
  });
}
