import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";
import { processFlowsSoon } from "@/lib/flows/engine";

/** Mark one sitting done: invoice for that sitting, stock deducted, appointment completed. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse"]);
    if (typeof b.sittingId !== "string") throw new HttpError(400, "sittingId is required.");
    const { data, error } = await db.rpc("tx_complete_sitting", { p_clinic: b.clinicId, p_actor: userId, p_sitting: b.sittingId });
    if (error) throwRpc(error);
    await processFlowsSoon(db, b.clinicId);
    return data;
  });
}
