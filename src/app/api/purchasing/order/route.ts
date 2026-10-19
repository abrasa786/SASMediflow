import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

/** Create a purchase order, receive goods against it (stock goes up, a supplier bill is raised), or cancel it. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "nurse", "receptionist"]);
    if (b.action === "create") {
      const { data, error } = await db.rpc("po_create", { p: { clinic_id: b.clinicId, actor: userId, supplier_id: b.supplierId, order_date: b.orderDate, expected_date: b.expectedDate, notes: b.notes, items: b.items } });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "receive") {
      if (typeof b.poId !== "string") throw new HttpError(400, "poId is required.");
      const { data, error } = await db.rpc("po_receive", { p_clinic: b.clinicId, p_actor: userId, p_po: b.poId, p_lines: b.lines, p_bill_no: b.billNumber ?? null, p_bill_date: b.billDate || null, p_due: b.dueDate || null });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "cancel") {
      const { error } = await db.rpc("po_cancel", { p_clinic: b.clinicId, p_po: b.poId });
      if (error) throwRpc(error);
      return { cancelled: true };
    }
    throw new HttpError(400, "Unknown action.");
  });
}
