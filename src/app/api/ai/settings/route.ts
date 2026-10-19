import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { getPolicy, setPolicy } from "@/lib/ai/store";
import { encryptionEnabled } from "@/lib/ai/crypto";

export const dynamic = "force-dynamic";

const status = (policy: any) => ({ policy, provider_configured: !!process.env.GEMINI_API_KEY, encrypted_at_rest: encryptionEnabled() });

export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db } = await requireClinicMember(req, clinicId);
    return status(await getPolicy(db, clinicId!));
  });
}

/** Admin: switch external AI on or off, and how many days history is kept (0 = keep nothing). */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const patch: Record<string, unknown> = {};
    if (typeof b.external_enabled === "boolean") patch.external_enabled = b.external_enabled;
    if (b.retention_days !== undefined) {
      const n = Number(b.retention_days);
      if (!Number.isInteger(n) || n < 0 || n > 365) throw new HttpError(400, "Keep history for 0 to 365 days.");
      patch.retention_days = n;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to change.");
    return status(await setPolicy(db, b.clinicId, patch));
  });
}
