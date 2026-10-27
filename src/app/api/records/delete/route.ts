import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { DELETABLE } from "@/lib/deleteRules";

/** Delete one record (the dustbin at the bottom right of a record). Only certain records, only certain roles, always inside the caller's own clinic. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const rule = typeof b.entity === "string" ? DELETABLE[b.entity] : undefined;
    if (!rule) throw new HttpError(400, "That kind of record cannot be deleted here.");
    if (typeof b.id !== "string" || !/^[0-9a-f-]{36}$/i.test(b.id)) throw new HttpError(400, "Which record?");
    const { db } = await requireClinicMember(req, b.clinicId, rule.roles);

    const { data: row } = await db.from(b.entity).select("*").eq("id", b.id).eq("clinic_id", b.clinicId).maybeSingle();
    if (!row) throw new HttpError(404, `That ${rule.label} was not found in this clinic.`);
    if (b.entity === "invoices" && (Number(row.paid_amount) > 0 || ["paid", "partially_paid"].includes(row.status)))
      throw new HttpError(409, "A bill with payments on it cannot be deleted. Cancel it instead, so the money trail stays.");

    const { error } = await db.from(b.entity).delete().eq("id", b.id).eq("clinic_id", b.clinicId);
    if (error) {
      if (error.code === "23503") throw new HttpError(409, `This ${rule.label} is used by other records (for example bills, visits or treatments), so it cannot be deleted. ${b.entity === "appointments" ? "Cancel it instead." : "Remove or close the linked records first."}`);
      throw new HttpError(400, error.message);
    }
    return { deleted: true };
  });
}
