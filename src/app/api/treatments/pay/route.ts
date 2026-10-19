import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

/** Record a (part-)payment against a sitting's invoice. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "receptionist"]);
    if (typeof b.sittingId !== "string") throw new HttpError(400, "sittingId is required.");
    const amount = b.amount === undefined || b.amount === null || b.amount === "" ? null : Number(b.amount);
    if (amount !== null && !Number.isFinite(amount)) throw new HttpError(400, "Enter a valid amount.");
    const { data, error } = await db.rpc("tx_pay_sitting", { p_clinic: b.clinicId, p_actor: userId, p_sitting: b.sittingId, p_amount: amount, p_method: b.method ?? "cash" });
    if (error) throwRpc(error);
    return data;
  });
}
