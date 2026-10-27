/**
 * Keeps the reminder tasks in step with purchase orders:
 *   an order is placed for the item      -> the "Order it" task is done
 *   that order is received in full       -> the "Check it arrived" task is done too
 *   that order is cancelled              -> both come back
 * An order matches only when ONE line of it contains every key word of the item, so a different crown never closes this patient's reminder.
 */
const stems = (s: string) => Array.from(new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5))));

export function itemMatches(orderItem: string, poLineNames: string[]): boolean {
  const need = stems(orderItem);
  if (!need.length) return false;
  return poLineNames.some((n) => { const have = stems(n); return need.every((w) => have.includes(w)); });
}

/** Returns the id of the first pending order line that covers the item, if any. */
export async function findPendingOrder(db: any, clinicId: string, orderItem: string): Promise<{ id: string; po_number: string } | null> {
  const { data } = await db.from("purchase_order_items").select("name, purchase_orders!inner(id, po_number, status, clinic_id)")
    .eq("clinic_id", clinicId).in("purchase_orders.status", ["ordered", "partially_received"]).limit(300);
  for (const r of (data ?? []) as any[]) if (itemMatches(orderItem, [r.name])) return { id: r.purchase_orders.id, po_number: r.purchase_orders.po_number };
  return null;
}

async function openReminders(db: any, clinicId: string) {
  const { data } = await db.from("visit_notes").select("id, order_item, order_task_id, check_task_id").eq("clinic_id", clinicId).not("order_item", "is", null);
  return (data ?? []) as { id: string; order_item: string; order_task_id: string | null; check_task_id: string | null }[];
}

export async function closeRemindersForOrder(db: any, clinicId: string, poId: string, stage: "placed" | "received"): Promise<number> {
  const { data: lines } = await db.from("purchase_order_items").select("name").eq("po_id", poId).eq("clinic_id", clinicId);
  const names = ((lines ?? []) as { name: string }[]).map((l) => l.name);
  let n = 0;
  for (const r of await openReminders(db, clinicId)) {
    if (!itemMatches(r.order_item, names)) continue;
    const ids = (stage === "received" ? [r.order_task_id, r.check_task_id] : [r.order_task_id]).filter(Boolean) as string[];
    if (!ids.length) continue;
    const { data } = await db.from("clinic_tasks").update({ status: "done", auto_closed_by_po: poId }).in("id", ids).eq("clinic_id", clinicId).neq("status", "done").select("id");
    n += data?.length ?? 0;
  }
  return n;
}

export async function reopenRemindersForOrder(db: any, clinicId: string, poId: string): Promise<number> {
  const { data } = await db.from("clinic_tasks").update({ status: "todo", auto_closed_by_po: null }).eq("clinic_id", clinicId).eq("auto_closed_by_po", poId).select("id");
  return data?.length ?? 0;
}
