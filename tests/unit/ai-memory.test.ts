import test from "node:test";
import assert from "node:assert/strict";
import { bestMatch, memKey, similarity } from "../../src/lib/ai/memory";

const mems = [
  { key: memKey("Create a Lab app with Lab Test and Lab Order"), prompt: "Create a Lab app with Lab Test and Lab Order", plan: { a: 1 }, uses: 2 },
  { key: memKey("Add Aadhaar number field to patients"), prompt: "Add Aadhaar number field to patients", plan: { b: 1 }, uses: 1 },
];
test("same request in different wording is recalled", () => {
  assert.equal((bestMatch("create a lab app with lab test and lab order!", mems)?.plan as any)?.a, 1);
  assert.equal((bestMatch("Add an Aadhaar number field to the patients", mems)?.plan as any)?.b, 1);
});
test("unrelated request is not recalled", () => {
  assert.equal(bestMatch("Remind patients the day before", mems), null);
  assert.ok(similarity("a b c", "x y z") === 0);
});
