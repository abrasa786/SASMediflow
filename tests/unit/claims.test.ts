import { test } from "node:test";
import assert from "node:assert/strict";
import { slaState, duration, nextActions } from "../../src/lib/claims/sla";

const now = new Date("2026-10-19T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();

test("pre-auth has a 1 hour clock", () => {
  const s = slaState({ status: "preauth_sent", preauth_sent_at: ago(40) }, now)!;
  assert.equal(s.limitMinutes, 60); assert.equal(s.leftMinutes, 20); assert.equal(s.overdue, false); assert.equal(s.label, "20m left");
  const late = slaState({ status: "preauth_sent", preauth_sent_at: ago(95) }, now)!;
  assert.equal(late.overdue, true); assert.equal(late.label, "35m late");
});

test("discharge has a 3 hour clock", () => {
  const s = slaState({ status: "discharge_sent", discharge_sent_at: ago(60) }, now)!;
  assert.equal(s.limitMinutes, 180); assert.equal(s.label, "2h left");
  assert.equal(slaState({ status: "discharge_sent", discharge_sent_at: ago(200) }, now)!.label, "20m late");
});

test("no clock while the hospital holds the ball", () => {
  for (const status of ["draft", "query", "approved", "settled", "rejected", "cancelled"] as const) assert.equal(slaState({ status, preauth_sent_at: ago(10), discharge_sent_at: ago(10) }, now), null, status);
});

test("durations read naturally", () => {
  assert.equal(duration(0), "0m"); assert.equal(duration(59), "59m"); assert.equal(duration(60), "1h"); assert.equal(duration(125), "2h 5m");
  assert.equal(duration(1440), "1d"); assert.equal(duration(1440 + 4 * 60 + 10), "1d 4h");
});

test("each stage offers the right next steps", () => {
  assert.deepEqual(nextActions("draft").map((a) => a.to), ["preauth_sent", "cancelled"]);
  assert.equal(nextActions("preauth_sent").find((a) => a.to === "approved")?.needs, "approved_amount");
  assert.deepEqual(nextActions("query").map((a) => a.to), ["reply"]);
  assert.equal(nextActions("discharge_sent").find((a) => a.to === "settled")?.needs, "settled_amount");
  assert.deepEqual(nextActions("settled"), []);
});
