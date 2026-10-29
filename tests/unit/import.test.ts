import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, guessMapping, normPhone, parseDate, parseGender, cleanRow } from "../../src/lib/import/patients";

test("csv: quotes, commas in quotes, windows line ends, byte-order mark", () => {
  const r = parseCsv('﻿Name,Address\r\n"Asha, Verma","12 ""Main"" Rd"\r\nRavi,\r\n');
  assert.deepEqual(r, [["Name", "Address"], ["Asha, Verma", '12 "Main" Rd'], ["Ravi", ""]]);
});

test("csv: blank lines are dropped", () => assert.equal(parseCsv("a,b\n\n1,2\n,\n").length, 2));

test("mapping guesses common headers", () => {
  const m = guessMapping(["Patient Name", "Mobile No", "E-mail", "DOB", "Sex", "Notes"]);
  assert.equal(m.name, "Patient Name"); assert.equal(m.phone, "Mobile No"); assert.equal(m.email, "E-mail");
  assert.equal(m.dob, "DOB"); assert.equal(m.gender, "Sex"); assert.equal(m.notes, "Notes");
});

test("phone: last ten digits, short numbers refused", () => {
  assert.equal(normPhone("+91 98765-43210"), "9876543210"); assert.equal(normPhone("12345"), null); assert.equal(normPhone(""), null);
});

test("dates: day/month/year, ISO, words; impossible dates refused", () => {
  assert.equal(parseDate("12/03/1985"), "1985-03-12"); assert.equal(parseDate("1990-07-01"), "1990-07-01"); assert.equal(parseDate("5 Mar 1979"), "1979-03-05");
  assert.equal(parseDate("31/02/1990"), null); assert.equal(parseDate("hello"), null); assert.equal(parseDate("01/01/2999"), null);
});

test("gender words", () => { assert.equal(parseGender("M"), "male"); assert.equal(parseGender("Female"), "female"); assert.equal(parseGender(""), null); });

test("cleanRow: no name is a problem; bad phone and email are warnings; key uses the phone", () => {
  const map = { name: "N", phone: "P", email: "E", dob: "D" };
  assert.ok(cleanRow({ N: "", P: "9876543210" }, map).problems.length);
  const bad = cleanRow({ N: "Asha", P: "123", E: "nope", D: "x" }, map);
  assert.ok(bad.patient && bad.warnings.length === 3 && bad.patient.phone === null);
  const ok = cleanRow({ N: " Asha   Verma ", P: "+91 98765 43210", E: "A@B.com", D: "12/03/1985" }, map);
  assert.equal(ok.patient?.name, "Asha Verma"); assert.equal(ok.patient?.email, "a@b.com"); assert.equal(ok.key, "p:9876543210"); assert.equal(ok.patient?.dob, "1985-03-12");
});
