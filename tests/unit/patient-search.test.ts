import test from "node:test";
import assert from "node:assert/strict";
import { corsHeaders, allowedOrigins } from "../../src/lib/server/cors";
import { specialtyPattern, num } from "../../src/lib/booking/patient-search";

test("only the patient app's sites may read the public services", () => {
  assert.equal(corsHeaders("http://localhost:3000")?.["Access-Control-Allow-Origin"], "http://localhost:3000");
  assert.equal(corsHeaders("https://evil.example"), null);
  assert.equal(corsHeaders(null), null);
  assert.equal(corsHeaders("https://app.mediflow.in", "https://app.mediflow.in/")?.["Access-Control-Allow-Origin"], "https://app.mediflow.in");
  assert.deepEqual(allowedOrigins("not a url, https://ok.in"), ["http://localhost:3000", "https://ok.in"]);
});

test("specialty tags become safe patterns", () => {
  assert.equal(specialtyPattern("All"), null);
  assert.equal(specialtyPattern(""), null);
  assert.match(specialtyPattern("Dental")!, /dent/);
  assert.equal(new RegExp(specialtyPattern("ENT")!, "i").test("Dentistry"), false, "ENT must not match Dentistry");
  assert.equal(specialtyPattern("a.*(b)"), "a\\.\\*\\(b\\)", "free text is escaped, never used as a pattern");
});

test("numbers from the address are range checked", () => {
  assert.equal(num("12.5", -90, 90), 12.5);
  assert.equal(num("200", -90, 90), null);
  assert.equal(num("abc", 0, 10), null);
  assert.equal(num(null, 0, 10), null);
  assert.equal(num("", 0, 10), null);
});
