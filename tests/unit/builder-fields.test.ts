import { test } from "node:test";
import assert from "node:assert/strict";
import { makePlan } from "../../src/lib/builder/planner";
import { loadSchemaWithBuiltins } from "../../src/lib/builder/builtin";
import { validatePlan } from "../../src/lib/builder/validate";

const fakeDb = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [{ entity: "patients", api_name: "occupation", label: "Occupation", data_type: "text", required: false, picklist_values: null }] }) }) }) }) }) };
const schema = () => loadSchemaWithBuiltins(fakeDb, "c", { objects: [], apps: [] });
const plan = async (prompt: string) => makePlan({ prompt, schema: await schema() });

test("fields can be added to built-in records in many phrasings", async () => {
  for (const [q, obj, type] of [
    ["add a dropdown field Insurance provider to patients with options Star, HDFC, None", "patients", "picklist"],
    ["create a new field called referral source in the appointments object", "appointments", "text"],
    ["add a checkbox field consent signed to invoices", "invoices", "boolean"],
    ["add Aadhaar number field to the patient", "patients", "text"],
  ]) {
    const r = await plan(q);
    assert.ok(r.plan, q + " -> " + r.message);
    const st = r.plan!.steps[0] as any;
    assert.equal(st.tool, "add_field");
    assert.equal(st.args.object, obj);
    assert.equal(st.args.field.data_type, type);
  }
});

test("dropdown values are kept", async () => {
  const r = await plan("add a dropdown field Insurance provider to patients with options Star, HDFC, None");
  assert.deepEqual((r.plan!.steps[0] as any).args.field.picklist_values, ["Star", "HDFC", "None"]);
});

test("a field that already exists is not added twice, and core fields cannot be hidden", async () => {
  const r = await plan("add a field occupation to patients");
  assert.equal(r.plan, null);
  const s = await schema();
  assert.equal(validatePlan({ steps: [{ tool: "hide_field", args: { object: "patients", field: "phone" } }] }, s).ok, false);
  assert.equal(validatePlan({ steps: [{ tool: "hide_field", args: { object: "patients", field: "occupation" } }] }, s).ok, true);
  assert.equal(validatePlan({ steps: [{ tool: "add_field", args: { object: "patients", field: { api_name: "doc", data_type: "lookup", lookup_object: "doctors" } } }] }, s).ok, false);
});

test("an unclear field request gets a question, not a refusal", async () => {
  const r = await plan("I want a new column");
  assert.equal(r.plan, null);
  assert.match(r.message, /Tell me the field name/);
});
