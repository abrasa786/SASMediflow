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
