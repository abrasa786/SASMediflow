import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCalendar } from "../../src/lib/assistant/calendar";
import { parseRange, daysText } from "../../src/lib/assistant/common";
import { extractValues, findObject } from "../../src/lib/assistant/records";
import { detectReport } from "../../src/lib/assistant/reports";
import { parseBookingText } from "../../src/lib/booking/parse";
import { checkScope } from "../../src/lib/ai/scope";

const TODAY = "2026-10-19";
const pd = (t: string, d: string) => parseBookingText(t, d) as { date?: string };

test("calendar phrases are recognised", () => {
  assert.equal(detectCalendar("what's on tomorrow"), "agenda");
  assert.equal(detectCalendar("show Dr Mehta's schedule on Friday"), "agenda");
  assert.equal(detectCalendar("free slots tomorrow"), "free");
  assert.equal(detectCalendar("mark Dr Mehta on leave 25 to 27 Oct"), "leave_add");
  assert.equal(detectCalendar("remove Dr Mehta's leave"), "leave_remove");
  assert.equal(detectCalendar("Dr Mehta works 10am to 6pm Monday to Friday"), "hours");
  assert.equal(detectCalendar("mark Rahul as completed"), "status");
  assert.equal(detectCalendar("Book Anita 9876543210 tomorrow 4pm"), null);
  assert.equal(detectCalendar("cancel Anita's appointment"), null);
});

test("date ranges", () => {
  assert.deepEqual(parseRange("on leave 25 to 27 Oct", TODAY, pd), { from: "2026-10-25", to: "2026-10-27" });
  const one = parseRange("tomorrow", TODAY, pd);
  assert.equal(one.from, "2026-10-20"); assert.equal(one.to, one.from);
  assert.equal(daysText([1, 2, 3, 4, 5]), "Mon–Fri");
});

const schema: any = { objects: [{ api_name: "lab_test", label: "Lab Test", plural_label: "Lab Tests", fields: [
  { api_name: "name", label: "Name", data_type: "text", required: true },
  { api_name: "price", label: "Price", data_type: "currency" },
  { api_name: "fasting", label: "Fasting", data_type: "boolean" },
  { api_name: "kind", label: "Kind", data_type: "picklist", picklist_values: ["Blood", "Urine"] }] }], apps: [] };

test("records: object and field values are read from a sentence", () => {
  assert.equal(findObject(schema, "add a lab test CBC")?.api_name, "lab_test");
  const { values, problems } = extractValues(schema.objects[0], "add lab test name CBC, price 300, fasting yes, kind blood", TODAY, pd);
  assert.deepEqual(values, { name: "CBC", price: 300, fasting: true, kind: "Blood" });
  assert.equal(problems.length, 0);
  assert.equal(extractValues(schema.objects[0], "price abc", TODAY, pd).problems.length, 1);
});

test("reports phrases", () => {
  assert.ok(detectReport("create a dashboard called Ops with appointments by doctor"));
  assert.ok(detectReport("show appointments by doctor"));
  assert.ok(!detectReport("book Anita tomorrow"));
});

test("scope: custom table names and new calendar words are in scope, off-topic is not", () => {
  const o = { module: "assistant" as const, terms: ["Lab Test"] };
  assert.ok(checkScope("add a lab test CBC", o).ok);
  assert.ok(checkScope("free slots tomorrow", o).ok);
  assert.ok(!checkScope("what is Kohli's score", o).ok);
});
