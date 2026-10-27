import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

/**
 * "This visit is a sitting of that treatment": picks the template, finds or starts the patient's treatment, ties this appointment to
 * its next sitting, and saves the price and the materials used. Stock goes down only when the sitting is completed.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse"]);
    if (typeof b.appointmentId !== "string") throw new HttpError(400, "Missing appointment.");
    const price = b.price === undefined || b.price === null || b.price === "" ? null : Number(b.price);
    if (price !== null && !Number.isFinite(price)) throw new HttpError(400, "Enter a valid price.");
    const materials = Array.isArray(b.materials) ? b.materials.slice(0, 40).map((m: any) => ({ item: String(m.item ?? "").slice(0, 120), qty: Number(m.qty) })) : undefined;
    const { data, error } = await db.rpc("visit_attach_treatment", { p: {
      clinic_id: b.clinicId, actor: userId, appointment_id: b.appointmentId, template_id: b.templateId ?? null,
      price, ...(materials ? { materials } : {}),
    } });
    if (error) throwRpc(error);
    if (typeof b.noteId === "string") {
      await db.from("visit_notes").update({ sitting_id: data.sitting_id, template_id: data.template_id }).eq("id", b.noteId).eq("clinic_id", b.clinicId);
    }
    return data;
  });
}
