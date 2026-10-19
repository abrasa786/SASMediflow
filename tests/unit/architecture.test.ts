import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Architecture fitness tests: rules the codebase must keep, checked on every build. */
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : []; });
const src = files("src");

test("only the AI gateway may talk to the AI provider", () => {
  const bad = src.filter((f) => /generativelanguage\.googleapis\.com/.test(readFileSync(f, "utf8")) && !f.endsWith("src/lib/ai/gateway.ts"));
  assert.deepEqual(bad, []);
});

test("browser code never uses the service-role client", () => {
  const bad = src.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")) && /createAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});

test("every API route checks who is calling (or is explicitly public)", () => {
  const PUBLIC = ["api/health", "api/public", "api/auth", "api/clinic/create", "api/ai/purge"];
  const bad = files("src/app/api").filter((f) => f.endsWith("route.ts") && !PUBLIC.some((p) => f.includes(p)))
    .filter((f) => !/requireClinicMember|requireClinicAdmin|requireUser|getUser\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, [], "routes without an auth check");
});

test("both AI surfaces run the scope guard", () => {
  for (const f of ["src/app/api/chatbot/route.ts", "src/app/api/builder/plan/route.ts", "src/lib/ai/gateway.ts"]) assert.match(readFileSync(f, "utf8"), /checkScope/, f);
});

test("no secrets are hard-coded", () => {
  const bad = src.filter((f) => /AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/.test(readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});
