import { test } from "node:test";
import assert from "node:assert/strict";
import { detectWaIntent, pickNumber } from "../../src/lib/whatsapp/intent";

test("patient messages are understood", () => {
  const cases: [string, string][] = [
    ["Hi", "menu"], ["hello!", "menu"], ["menu", "menu"], ["STOP", "stop"], ["start", "start"], ["Yes", "yes"], ["no", "no"], ["2", "number"],
    ["I want to book an appointment", "book"], ["book", "book"], ["can I see the doctor tomorrow", "book"],
    ["cancel my appointment", "cancel"], ["Please reschedule", "reschedule"], ["can I change my appointment time", "reschedule"],
    ["what is my balance", "balance"], ["how much do I owe", "balance"], ["my appointments", "appointments"], ["when is my next appointment", "appointments"],
    ["what is Kohli's score", "other"], ["", "other"],
  ];
  for (const [t, want] of cases) assert.equal(detectWaIntent(t), want, t);
});

test("choosing from a numbered list", () => {
  assert.equal(pickNumber("2", 3), 2); assert.equal(pickNumber("option 3", 3), 3); assert.equal(pickNumber("5", 3), null); assert.equal(pickNumber("abc", 3), null); assert.equal(pickNumber("0", 3), null);
});
