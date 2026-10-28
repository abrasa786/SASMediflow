import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const materials = (m: unknown) => (Array.isArray(m) ? m.slice(0, 40).map((x: any) => ({ item: String(x?.item ?? "").slice(0, 120), qty: Number(x?.qty) })) : undefined);

/**
 * Sittings of a treatment, one at a time.
 *   add     a sitting (a name, its own price, the equipment used) on an open treatment, or start a treatment with its first sitting
 *   update  the name, price (before it is billed) or equipment of a sitting that is not done yet
 *   finish  "no more sittings": the treatment closes as soon as everything is paid
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse"]);

    if (b.action === "add") {
      for (const k of ["planId", "patientId", "appointmentId"]) if (b[k] != null && b[k] !== "" && !uuid(b[k])) throw new HttpError(400, "Something in this request is not valid. Reload and try again.");
      const { data, error } = await db.rpc("tx_add_sitting", { p: {
        clinic_id: b.clinicId, actor: userId, plan_id: b.planId || null, patient_id: b.patientId || null, appointment_id: b.appointmentId || null,
        title: b.title ?? null, estimated_total: b.estimatedTotal ?? null, template_id: uuid(b.templateId) ? b.templateId : null,
        label: b.label ?? "", price: b.price ?? null, date: b.date ?? null, ...(materials(b.materials) ? { materials: materials(b.materials) } : {}),
      } });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "update") {
      if (!uuid(b.sittingId)) throw new HttpError(400, "sittingId is required.");
      const p: Record<string, unknown> = { clinic_id: b.clinicId, sitting_id: b.sittingId };
      if ("label" in b) p.label = b.label; if ("price" in b) p.price = b.price;
      const m = materials(b.materials); if (m) p.materials = m;
      const { data, error } = await db.rpc("tx_update_sitting", { p });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "finish") {
      if (!uuid(b.planId)) throw new HttpError(400, "planId is required.");
      const { data, error } = await db.rpc("tx_finish_plan", { p_clinic: b.clinicId, p_plan: b.planId, p_finish: b.finish !== false });
      if (error) throwRpc(error);
      return data;
    }
    throw new HttpError(400, "Unknown action.");
  });
}
