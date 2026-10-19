import { test } from "node:test";
import assert from "node:assert/strict";
import { isAddDoctor, parseAddDoctor, parseShift } from "../../src/lib/booking/doctor-parse";

test("the exact sentence a clinic admin typed", () => {
  const m = "Add a new doctor name : Abdul Rahim , dentist , years of experience 10 , shift 2-11,";
  assert.equal(isAddDoctor(m), true);
  assert.deepEqual(parseAddDoctor(m), { name: "Abdul Rahim", specialty: "Dentist", years: 10, start: "14:00", end: "23:00" });
});

test("12-hour times with am/pm and days", () => {
  const r = parseAddDoctor("add doctor Priya Nair cardiologist 8 years 9am to 5pm mon-fri");
  assert.equal(r.name, "Priya Nair"); assert.equal(r.years, 8);
  assert.equal(r.start, "09:00"); assert.equal(r.end, "17:00");
  assert.deepEqual(r.days, [1, 2, 3, 4, 5]);
});

test("shift parsing", () => {
  assert.deepEqual(parseShift("shift 9-6"), { start: "09:00", end: "18:00" });
  assert.deepEqual(parseShift("timings 10:30am - 7pm"), { start: "10:30", end: "19:00" });
  assert.equal(parseShift("shift 22-6").shiftError?.includes("Overnight"), true);   // overnight is refused with a clear message
  assert.deepEqual(parseShift("see you tomorrow"), {});
});

test("ordinary chat is not an add-doctor request", () => {
  assert.equal(isAddDoctor("book an appointment for tomorrow at 5pm"), false);
  assert.equal(isAddDoctor("how many patients today"), false);
});
