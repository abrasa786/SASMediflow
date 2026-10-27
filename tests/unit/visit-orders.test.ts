import { test } from "node:test";
import assert from "node:assert/strict";
import { planOrderDates, suggestOrderItem } from "../../src/lib/visits/orders";

test("order five days before the appointment, check the day before", () => {
  assert.deepEqual(planOrderDates("2026-11-10", "2026-10-27"), { orderBy: "2026-11-05", checkBy: "2026-11-09", late: false, known: true });
});

test("an appointment that is too close means order today, and say it is late", () => {
  const r = planOrderDates("2026-10-29", "2026-10-27");
  assert.equal(r.orderBy, "2026-10-27");
  assert.equal(r.late, true);
  assert.equal(r.checkBy, "2026-10-28");
  assert.equal(planOrderDates("2026-10-27", "2026-10-27").checkBy, "2026-10-27");   // same day: never before the order date
});

test("no appointment yet still gives dates", () => {
  const r = planOrderDates(null, "2026-10-27");
  assert.equal(r.known, false);
  assert.equal(r.orderBy, "2026-10-28");
  assert.equal(r.checkBy, "2026-11-02");
});

test("words in a note that suggest something must be ordered", () => {
  assert.equal(suggestOrderItem("Fit zirconium tooth next visit"), "Zirconium crown");
  assert.equal(suggestOrderItem("", "Place the Implant after healing"), "Implant");
  assert.equal(suggestOrderItem("Scaling and polishing", "Review in 2 weeks"), null);
  assert.equal(suggestOrderItem(null, undefined), null);
});
