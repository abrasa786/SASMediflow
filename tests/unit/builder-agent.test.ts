import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAssistantRequest, parseBuilderRequest, parseFlow } from "../../src/lib/builder/agent-tools";

const schema: any = { objects: [], apps: [] };

test("builder: flows and booking rules are parsed", () => {
  const f: any = parseFlow("When an appointment is booked, send the patient a WhatsApp confirmation", schema);
  assert.ok(f && !("error" in f), JSON.stringify(f));
  assert.equal(f.steps[0].tool, "create_flow");
  assert.equal(f.steps[0].args.trigger.event, "appointment_booked");
  const r: any = parseBuilderRequest("use the least busy doctor and 20 minute slots", schema);
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r.steps[0].tool, "set_booking_rule");
});

test("assistant: reports and dashboards are parsed, flows are not", () => {
  const d: any = parseAssistantRequest("Create a dashboard called Daily ops with appointments by doctor and unpaid invoices by month", schema);
  assert.ok(d && !("error" in d), JSON.stringify(d));
  assert.deepEqual(d.steps.map((s: any) => s.tool), ["create_report", "create_report", "create_dashboard"]);
  const rep: any = parseAssistantRequest("create a report of patients by gender", schema);
  assert.equal(rep.steps[0].tool, "create_report");
  assert.equal(parseAssistantRequest("when an appointment is booked send whatsapp", schema), null);
});

import { parseAudience, parseVisibility } from "../../src/lib/builder/agent-tools";
import { makePlan } from "../../src/lib/builder/planner";
import { describeStep } from "../../src/lib/builder/validate";

test("who can see an app or tab is understood", () => {
  assert.deepEqual(parseAudience("only doctors and nurses can see it"), { roles: ["doctor", "nurse"] });
  assert.equal(parseAudience("visible to everyone"), "everyone");
  assert.equal(parseAudience("create a lab app"), null);
  const sc: any = { objects: [], apps: [{ api_name: "inpatient", label: "Inpatient", tabs: [{ label: "Wards", kind: "object" }] }] };
  const v: any = parseVisibility("only nurses can see Inpatient", sc);
  assert.equal(v.steps[0].tool, "configure_app"); assert.deepEqual(v.steps[0].args.roles, ["nurse"]);
  const t: any = parseVisibility("hide the Staff tab in Administration from receptionists", sc);
  assert.equal(t.steps[0].args.tab, "Staff"); assert.ok(!t.steps[0].args.roles.includes("receptionist")); 
  assert.ok("error" in (parseVisibility("hide the Foo tab in Inpatient from nurses", sc) as any));
});

test("creating an app asks who should see it, and honours the answer", async () => {
  const empty: any = { objects: [], apps: [] };
  const a: any = await makePlan({ prompt: "Create a Ward app with Ward and Bed", schema: empty });
  assert.match(a.message, /Who should see it/);
  const b: any = await makePlan({ prompt: "Create a Ward app with Ward and Bed only for nurses and doctors", schema: empty });
  const cfg = b.plan.steps.find((s: any) => s.tool === "configure_app");
  assert.deepEqual(cfg.args.roles, ["doctor", "nurse"]);
  assert.match(describeStep(cfg), /doctors, nurses/);
});
