import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../../src/lib/offers/eligibility";

test("only opted-in patients with a phone and no recent message are eligible", () => {
  assert.equal(classify({ phone: "9876543210", marketing_opt_in: true }, false), "ok");
  assert.equal(classify({ phone: "9876543210", marketing_opt_in: false }, false), "off");
  assert.equal(classify({ phone: "9876543210", marketing_opt_in: null }, false), "off");
  assert.equal(classify({ phone: "12345", marketing_opt_in: true }, false), "no_phone");
  assert.equal(classify({ phone: null, marketing_opt_in: true }, false), "no_phone");
  assert.equal(classify({ phone: "9876543210", marketing_opt_in: true }, true), "recent");
  assert.equal(classify({ phone: "9876543210", marketing_opt_in: false }, true), "off");   // switched off wins over everything
});
