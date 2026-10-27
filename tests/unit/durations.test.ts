import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestDuration, normKey } from "../../src/lib/durations";

test("starting guesses by kind of treatment", () => {
  assert.equal(suggestDuration("Teeth cleaning", [])?.minutes, 30);
  assert.equal(suggestDuration("Implant consultation", [])?.minutes, 60);
  assert.equal(suggestDuration("Tooth pain", [])?.minutes, 15);
  assert.equal(suggestDuration("hello", []), null);
});
test("real visits beat the guess once there are three", () => {
  const rows = [{ key: "root canal", samples: [50, 70, 60, 65] }];
  const r = suggestDuration("Root canal treatment", rows)!;
  assert.equal(r.basis, "learned"); assert.equal(r.minutes, 65);
  assert.equal(suggestDuration("root canal", [{ key: "root canal", samples: [40, 45] }])?.basis, "starting guess");
});
test("a time the clinic set is used when there are too few visits", () => {
  assert.deepEqual(suggestDuration("Scaling", [{ key: "scaling", minutes: 25, samples: [] }]), { minutes: 25, basis: "set" });
  assert.equal(normKey("  Root-Canal!! "), "root canal");
});
