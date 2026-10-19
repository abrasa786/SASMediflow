import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

/** Pay a supplier bill (full or part). Admin only. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    if (typeof b.billId !== "string") throw new HttpError(400, "billId is required.");
    const amount = b.amount === undefined || b.amount === null || b.amount === "" ? null : Number(b.amount);
    if (amount !== null && !Number.isFinite(amount)) throw new HttpError(400, "Enter a valid amount.");
    const { data, error } = await db.rpc("bill_pay", { p_clinic: b.clinicId, p_actor: userId, p_bill: b.billId, p_amount: amount, p_method: b.method ?? "bank", p_ref: b.reference ?? null });
    if (error) throwRpc(error);
    return data;
  });
}
