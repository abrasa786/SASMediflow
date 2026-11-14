import { test, expect } from "./fixture";

test.describe("Home dashboard set up by the Builder", () => {
  test("positive: cards the Builder hid are not shown, the others stay", async ({ page, app }) => {
    (app.db.clinics[0] as any).settings = { setup: { completed: true }, home_hidden: ["patients", "schedule"] };
    await page.goto("/dashboard");
    await expect(page.getByText("Today's Appointments")).toBeVisible();
    await expect(page.getByText("Total Patients")).toHaveCount(0);
    await expect(page.getByText("Today's Schedule")).toHaveCount(0);
  });

  test("regression: with nothing hidden, every Home card is still there", async ({ page, app }) => {
    (app.db.clinics[0] as any).settings = { setup: { completed: true } };
    await page.goto("/dashboard");
    for (const t of ["Today's Appointments", "Completed", "Total Patients", "Low Stock Items", "Today's Schedule"]) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  });

  test("positive: a chart dashboard chosen by the Builder is shown on Home", async ({ page, app }) => {
    (app.db.clinics[0] as any).settings = { setup: { completed: true }, home_dashboard: "Home charts" };
    app.api("GET /api/builder/reports", () => ({ json: { reports: [], dashboards: [{ id: "d1", name: "Home charts" }], tables: [], canEdit: true } }));
    app.api("POST /api/builder/reports", () => ({ json: { dashboard: { id: "d1", name: "Home charts" }, widgets: [{ name: "Appointments by doctor", chart: "number", result: { kind: "number", value: 42, label: "Appointments", aggregate: "count" } }] } }));
    await page.goto("/dashboard");
    await expect(page.getByTestId("home-charts")).toContainText("Appointments by doctor");
    await expect(page.getByTestId("home-charts")).toContainText("42");
  });
});

test.describe("Builder chat: what you ask is what you see", () => {
  test("positive: 'create a new tab for surgeries' shows the plan with a main tab", async ({ page, app }) => {
    app.api("POST /api/builder/plan", () => ({ json: { message: "Create a Surgeries tab.", plan: { summary: "x", steps: [{ tool: "create_object", args: { api_name: "surgery" } }, { tool: "create_app", args: { api_name: "surgeries" } }, { tool: "pin_tab", args: { target: "app:surgeries" } }] }, lines: ["Create object Surgery", "Create app Surgeries", "Show “surgeries” as a main tab at the top"], source: "rules" } }));
    app.api("GET /api/builder/schema", () => ({ json: { schema: { objects: [], apps: [] }, changesets: [] } }));
    await page.goto("/builder");
    await page.getByPlaceholder(/./).first().fill("create a new tab for surgeries");
    await page.keyboard.press("Enter");
    await expect(page.getByText("as a main tab at the top")).toBeVisible();
  });
});

test.describe("A tab pinned by the Builder is visible", () => {
  test("positive: a brand-new app pinned as a main tab shows even before the saved app list knows it", async ({ page, app }) => {
    (app.db.clinics[0] as any).settings = { setup: { completed: true }, main_tabs: ["app:surgeries"] };
    app.api("GET /api/apps", () => ({ json: { apps: [{ api_name: "surgeries", label: "Surgeries", tabs: [] }] } }));
    await page.goto("/dashboard");
    await expect(page.getByRole("navigation", { name: "Main tabs" }).getByRole("link", { name: "Surgeries" })).toBeVisible();
  });
});
