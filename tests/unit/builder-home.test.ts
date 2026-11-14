import { test } from "node:test";
import assert from "node:assert/strict";
import { makePlan } from "../../src/lib/builder/planner";
import { describeStep } from "../../src/lib/builder/validate";

const schema: any = { objects: [{ api_name: "patients", label: "Patients", plural_label: "Patients", builtin: true, fields: [] }], apps: [] };
const plan = (prompt: string) => makePlan({ prompt, schema });

test("a new tab for surgeries creates the table, the app AND pins it as a main tab", async () => {
  const r: any = await plan("create a new tab for surgeries");
  assert.ok(r.plan, r.message);
  assert.deepEqual(r.plan.steps.map((s: any) => s.tool), ["create_object", "create_app", "pin_tab"]);
  assert.equal(r.plan.steps[2].args.target, "app:surgeries");
  assert.match(describeStep(r.plan.steps[2]), /main tab/i);
});

test("remove patients from the dashboard hides that Home card only", async () => {
  const r: any = await plan("remove patient from dashboard");
  assert.ok(r.plan, r.message);
  assert.deepEqual(r.plan.steps[0], { tool: "home_layout", args: { hide: ["patients"] } });
  const r2: any = await plan("hide the no shows and the schedule on home");
  assert.deepEqual(r2.plan.steps[0].args.hide.sort(), ["noshows", "schedule"]);
  const back: any = await plan("show patients on the dashboard");
  assert.deepEqual(back.plan.steps[0].args, { show: ["patients"] });
});

test("a chart on Home makes a report, a dashboard and puts it on Home", async () => {
  const r: any = await plan("show a chart of appointments by doctor on home");
  assert.ok(r.plan, r.message);
  assert.deepEqual(r.plan.steps.map((s: any) => s.tool), ["create_report", "create_dashboard", "home_layout"]);
  assert.equal(r.plan.steps[2].args.dashboard, "Home charts");
});

test("an unknown Home card gets a helpful answer, not silence", async () => {
  const r: any = await plan("remove the unicorn card from the dashboard");
  assert.equal(r.plan, null);
  assert.match(r.message, /Total patients/);
});

test("pinning a screen to the main tabs still works", async () => {
  const r: any = await plan("show stock in the main tabs");
  assert.equal(r.plan.steps[0].tool, "pin_tab");
});
