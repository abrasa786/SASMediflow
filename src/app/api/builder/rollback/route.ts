import { NextRequest } from "next/server";
import { handle, HttpError, loadSchema, requireClinicAdmin } from "@/lib/builder/server";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { clinicId, changesetId } = await req.json();
    const { db, userId } = await requireClinicAdmin(req, clinicId);
    if (typeof changesetId !== "string") throw new HttpError(400, "changesetId is required.");
    const { data, error } = await db.rpc("builder_rollback", { p_clinic: clinicId, p_actor: userId, p_changeset: changesetId });
    if (error) throw new HttpError(400, error.message);
    return { result: data, schema: await loadSchema(db, clinicId) };
  });
}
