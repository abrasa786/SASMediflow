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
    if (b.action === "edit") {
      // the supplier's bill number, due date and notes. Amounts change only through payments.
      const ok = (v: unknown) => v == null || v === "" || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
      if (!ok(b.dueDate) || !ok(b.billDate)) throw new HttpError(400, "Enter valid dates.");
      const patch: Record<string, unknown> = { bill_number: typeof b.billNumber === "string" ? b.billNumber.trim().slice(0, 60) || null : null, due_date: b.dueDate || null, notes: typeof b.notes === "string" ? b.notes.trim().slice(0, 500) || null : null };
      if (b.billDate) patch.bill_date = b.billDate;
      const { error } = await db.from("supplier_bills").update(patch).eq("id", b.billId).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { updated: true };
    }
    const amount = b.amount === undefined || b.amount === null || b.amount === "" ? null : Number(b.amount);
    if (amount !== null && !Number.isFinite(amount)) throw new HttpError(400, "Enter a valid amount.");
    const { data, error } = await db.rpc("bill_pay", { p_clinic: b.clinicId, p_actor: userId, p_bill: b.billId, p_amount: amount, p_method: b.method ?? "bank", p_ref: b.reference ?? null });
    if (error) throwRpc(error);
    return data;
  });
}
