import { NextRequest } from "next/server";
import { handle, HttpError, loadSchema, requireClinicAdmin } from "@/lib/builder/server";
import { validatePlan } from "@/lib/builder/validate";
import { rememberPlan } from "@/lib/ai/memory";
import { BUILTIN_RECORDS, loadSchemaWithBuiltins } from "@/lib/builder/builtin";

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { clinicId, prompt, plan } = await req.json();
    const { db, userId } = await requireClinicAdmin(req, clinicId);

    // Re-validate against the live schema: the plan may be stale, or tampered with in the browser.
    const before = await loadSchemaWithBuiltins(db, clinicId, await loadSchema(db, clinicId));
    const v = validatePlan(plan, before);
    if (!v.ok) throw new HttpError(400, v.errors.join(" "));

    // Steps on built-in records (patients, appointments…) are kept as field definitions; everything else goes through the normal plan.
    const isB = (s: any) => (s.tool === "add_field" || s.tool === "hide_field") && Object.prototype.hasOwnProperty.call(BUILTIN_RECORDS, s.args.object);
    const bSteps = v.plan.steps.filter(isB) as any[];
    const rest = { ...v.plan, steps: v.plan.steps.filter((s) => !isB(s)) };
    let n = 0;
    for (const s of bSteps) {
      const entity = s.args.object as string;
      if (s.tool === "add_field") {
        const f = s.args.field;
        const { error } = await db.from("custom_field_defs").insert({ clinic_id: clinicId, entity, api_name: f.api_name, label: f.label, data_type: f.data_type, required: !!f.required, picklist_values: f.picklist_values ?? null, help_text: f.help_text ?? null, sort_order: Date.now() % 1000000, created_by: userId });
        if (error) throw new HttpError(400, /custom_field_defs/.test(error.message) ? "Run migration 024 (fields on built-in records) in Supabase first." : `Nothing was changed. ${error.message}`);
      } else {
        const { error } = await db.from("custom_field_defs").update({ status: "hidden" }).eq("clinic_id", clinicId).eq("entity", entity).eq("api_name", s.args.field);
        if (error) throw new HttpError(400, error.message);
      }
      n++;
    }
    if (!rest.steps.length) { await rememberPlan(db, clinicId, "builder", String(prompt ?? ""), v.plan); return { changesetId: null, schema: await loadSchemaWithBuiltins(db, clinicId, await loadSchema(db, clinicId)), builtinChanges: n }; }

    const { data, error } = await db.rpc("builder_apply_plan", {
      p_clinic: clinicId, p_actor: userId, p_prompt: String(prompt ?? ""), p_plan: rest,
    });
    if (error) {
      await db.rpc("builder_record_failure", { p_clinic: clinicId, p_actor: userId, p_prompt: String(prompt ?? ""), p_plan: v.plan, p_error: error.message });
      for (const s of bSteps) if (s.tool === "add_field") await db.from("custom_field_defs").delete().eq("clinic_id", clinicId).eq("entity", s.args.object).eq("api_name", s.args.field.api_name);
      throw new HttpError(400, `Nothing was changed. ${error.message}`);
    }
    await rememberPlan(db, clinicId, "builder", String(prompt ?? ""), v.plan);
    return { changesetId: data, schema: await loadSchemaWithBuiltins(db, clinicId, await loadSchema(db, clinicId)), builtinChanges: n };
  });
}
