import { NextRequest } from "next/server";
import { handle, HttpError, loadSchema, requireClinicAdmin } from "@/lib/builder/server";
import { validatePlan } from "@/lib/builder/validate";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { clinicId, prompt, plan } = await req.json();
    const { db, userId } = await requireClinicAdmin(req, clinicId);

    // Re-validate against the live schema: the plan may be stale, or tampered with in the browser.
    const before = await loadSchema(db, clinicId);
    const v = validatePlan(plan, before);
    if (!v.ok) throw new HttpError(400, v.errors.join(" "));

    const { data, error } = await db.rpc("builder_apply_plan", {
      p_clinic: clinicId, p_actor: userId, p_prompt: String(prompt ?? ""), p_plan: v.plan,
    });
    if (error) {
      await db.rpc("builder_record_failure", { p_clinic: clinicId, p_actor: userId, p_prompt: String(prompt ?? ""), p_plan: v.plan, p_error: error.message });
      throw new HttpError(400, `Nothing was changed. ${error.message}`);
    }
    return { changesetId: data, schema: await loadSchema(db, clinicId) };
  });
}
