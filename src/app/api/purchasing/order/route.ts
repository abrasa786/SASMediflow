import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";
import { closeRemindersForOrder, reopenRemindersForOrder } from "@/lib/visits/po-link";

/** Reminder tasks follow the order. A problem here must never break the order itself. */
const quietly = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* the order is saved; reminders are best effort */ } };

/** Create a purchase order, receive goods against it (stock goes up, a supplier bill is raised), or cancel it. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "nurse", "receptionist"]);
    if (b.action === "create") {
      const { data, error } = await db.rpc("po_create", { p: { clinic_id: b.clinicId, actor: userId, supplier_id: b.supplierId, order_date: b.orderDate, expected_date: b.expectedDate, notes: b.notes, items: b.items } });
      if (error) throwRpc(error);
      if (data?.po_id) await quietly(() => closeRemindersForOrder(db, b.clinicId, data.po_id, "placed"));
      return data;
    }
    if (b.action === "receive") {
      if (typeof b.poId !== "string") throw new HttpError(400, "poId is required.");
      const { data, error } = await db.rpc("po_receive", { p_clinic: b.clinicId, p_actor: userId, p_po: b.poId, p_lines: b.lines, p_bill_no: b.billNumber ?? null, p_bill_date: b.billDate || null, p_due: b.dueDate || null });
      if (error) throwRpc(error);
      if (data?.po_status === "received") await quietly(() => closeRemindersForOrder(db, b.clinicId, b.poId, "received"));
      return data;
    }
    if (b.action === "update") {
      // header details only: dates and notes. Items, quantities and totals change through receiving, so stock and bills stay correct.
      if (typeof b.poId !== "string") throw new HttpError(400, "poId is required.");
      const ok = (v: unknown) => v == null || v === "" || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
      if (!ok(b.expectedDate) || !ok(b.orderDate)) throw new HttpError(400, "Enter valid dates.");
      const patch: Record<string, unknown> = { expected_date: b.expectedDate || null, notes: typeof b.notes === "string" ? b.notes.trim().slice(0, 500) || null : null };
      if (b.orderDate) patch.order_date = b.orderDate;
      const { error } = await db.from("purchase_orders").update(patch).eq("id", b.poId).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { updated: true };
    }
    if (b.action === "cancel") {
      const { error } = await db.rpc("po_cancel", { p_clinic: b.clinicId, p_po: b.poId });
      if (error) throwRpc(error);
      await quietly(() => reopenRemindersForOrder(db, b.clinicId, b.poId));
      return { cancelled: true };
    }
    throw new HttpError(400, "Unknown action.");
  });
}
