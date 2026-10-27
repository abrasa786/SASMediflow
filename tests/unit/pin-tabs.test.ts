import { test } from "node:test";
import assert from "node:assert/strict";
import { makePlan } from "../../src/lib/builder/planner";
import { checkScope } from "../../src/lib/ai/scope";
import { resolvePin } from "../../src/lib/builder/pins";

const schema = { objects: [], apps: [{ api_name: "lab", label: "Lab", icon: "🧪", is_system: false, tabs: [] }] } as any;

test("screens can be put in the main tabs in many phrasings", async () => {
  for (const [q, target, remove] of [
    ["show stock in the main tabs", "stock", false],
    ["stocks should come in main app page", "stock", false],
    ["put tasks on the top tab bar", "tasks", false],
    ["add the calendar to main tabs", "calendar", false],
    ["remove stock from the main tabs", "stock", true],
    ["pin the lab app to the main menu", "app:lab", false],
  ] as const) {
    assert.ok(checkScope(q, { module: "builder", hasHistory: false }).ok, "scope: " + q);
    const r = await makePlan({ prompt: q, schema });
    assert.ok(r.plan, q + " -> " + r.message);
    const st = r.plan!.steps[0] as any;
    assert.equal(st.tool, "pin_tab", q);
    assert.equal(st.args.target, target, q);
    assert.equal(!!st.args.remove, remove, q);
  }
});
test("unknown names are refused with a helpful list", async () => {
  assert.equal(resolvePin("moon base"), null);
  const r = await makePlan({ prompt: "show moon base in the main tabs", schema });
  assert.equal(r.plan, null);
  assert.match(r.message, /Stock/);
});
