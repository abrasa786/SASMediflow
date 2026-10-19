import { test } from "node:test";
import assert from "node:assert/strict";
import { checkColor, checkDomain, checkSlug, saveLogo } from "../../src/lib/server/branding";

const storage = (log: string[] = []) => ({ storage: {
  createBucket: async () => ({}),
  from: () => ({ upload: async (p: string) => { log.push(p); return { error: null }; }, getPublicUrl: () => ({ data: { publicUrl: "https://cdn/x" } }) }),
} });
const png = (extra = 20) => "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra)]).toString("base64");

test("domains are normalised and platform hosts refused", () => {
  assert.equal(checkDomain("https://Appointments.Clinic.com/"), "appointments.clinic.com");
  assert.throws(() => checkDomain("x.vercel.app"));
  assert.throws(() => checkDomain("not a domain"));
  assert.throws(() => checkDomain("localhost"));
});

test("slugs", () => {
  assert.equal(checkSlug("The-Tooth"), "the-tooth");
  for (const bad of ["admin", "a", "-bad-", "has space", "x".repeat(60)]) assert.throws(() => checkSlug(bad));
});

test("colours", () => {
  assert.equal(checkColor("#0EA5E9"), "#0ea5e9");
  assert.equal(checkColor(""), null);
  assert.throws(() => checkColor("blue"));
});

test("logo upload accepts a real PNG and stores it under the clinic's folder", async () => {
  const log: string[] = [];
  assert.equal(await saveLogo(storage(log), "clinic-1", png()), "https://cdn/x");
  assert.match(log[0], /^clinic-1\/logo-\d+\.png$/);
});

test("logo upload refuses SVG, fake images and oversized files", async () => {
  await assert.rejects(saveLogo(storage(), "c", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="));
  await assert.rejects(saveLogo(storage(), "c", "data:image/png;base64," + Buffer.from("not an image at all").toString("base64")));
  await assert.rejects(saveLogo(storage(), "c", png(1_100_000)));
});
