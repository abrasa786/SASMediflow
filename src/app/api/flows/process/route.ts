import { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { processFlowsSoon } from "@/lib/flows/engine";

/** Run whatever flows are waiting for this clinic. The screens call this right after a change (e.g. an invoice was marked paid). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json().catch(() => ({}));
    const { db } = await requireClinicMember(req, b.clinicId);
    await processFlowsSoon(db, b.clinicId);
    return { ok: true };
  });
}
