import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, ageFrom, type VisitNote } from "../../src/lib/visits/summary";

const n = (o: Partial<VisitNote>): VisitNote => ({ id: Math.random().toString(), visit_date: "2026-09-01", treatment: "Filling", ...o });

test("a recorded condition and alert come back at the next visit, newest first", () => {
  const s = buildSummary({ name: "Ravi", dob: "1990-05-10", gender: "Male", allergies: "Penicillin" }, [
    n({ visit_date: "2026-08-01", treatment: "Root canal", tooth: "46", conditions: "Inner bone is weak", alert: "Weak jaw bone: check before any implant" }),
    n({ visit_date: "2026-09-20", treatment: "Crown", tooth: "46", follow_up: "Review in 2 weeks" }),
  ], [], new Date("2026-10-27T00:00:00Z"));
  assert.equal(s.lastVisit, "2026-09-20");
  assert.equal(s.history[0].treatment, "Crown");
  assert.deepEqual(s.alerts.map((a) => a.text), ["Weak jaw bone: check before any implant"]);
  assert.deepEqual(s.conditions, ["Inner bone is weak"]);
  assert.match(s.text, /ALERTS: Weak jaw bone/);
  assert.match(s.text, /Allergies: Penicillin/);
  assert.match(s.text, /36 years/);
  assert.match(s.text, /Review in 2 weeks/);
});

test("the same alert is shown once, and an empty history says so", () => {
  const s = buildSummary({ name: "Asha" }, [n({ alert: "Bleeds easily" }), n({ visit_date: "2026-07-01", alert: "bleeds easily" })]);
  assert.equal(s.alerts.length, 1);
  assert.match(buildSummary({ name: "New" }, []).text, /No previous treatment recorded/);
});

test("age is worked out from the birth date", () => {
  assert.equal(ageFrom("2000-10-27", new Date("2026-10-27T00:00:00Z")), 26);
  assert.equal(ageFrom("2000-10-28", new Date("2026-10-27T00:00:00Z")), 25);
  assert.equal(ageFrom(null), null);
  assert.equal(ageFrom("garbage"), null);
});
