import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { deleteHistory, isUuid, listHistory } from "@/lib/ai/store";
import { encryptionEnabled } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

/** My AI questions and answers (the admin may list the whole clinic's with ?all=1). */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const all = req.nextUrl.searchParams.get("all") === "1";
    if (all && role !== "admin") throw new HttpError(403, "Only the admin can see the whole clinic's AI history.");
    const items = await listHistory(db, clinicId!, userId, { all, module: req.nextUrl.searchParams.get("module") ?? undefined });
    return { items, encrypted_at_rest: encryptionEnabled() };
  });
}

/** Delete from our database, which is the AI's only memory. scope: one | session | mine | all (admin). */
export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);
    if (!["one", "session", "mine", "all"].includes(b.scope)) throw new HttpError(400, "Choose what to delete.");
    if (b.scope === "one" && !isUuid(b.id)) throw new HttpError(400, "id is required.");
    if (b.scope === "session" && !isUuid(b.sessionId)) throw new HttpError(400, "sessionId is required.");
    const deleted = await deleteHistory(db, b.clinicId, userId, { scope: b.scope, id: b.id, session_id: b.sessionId });
    return { deleted };
  });
}
