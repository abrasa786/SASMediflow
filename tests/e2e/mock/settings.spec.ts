import { test, expect } from "./fixture";

test.describe("Settings", () => {
  test("positive: saving shows a toast and sends the profile", async ({ page, app }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Save Settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
    expect(app.called("/api/clinic/setup")[0].body.action).toBe("profile");
  });

  test("negative: a server validation message appears at the top of the page, in red", async ({ page, app }) => {
    app.api("POST /api/clinic/setup", () => ({ status: 400, json: { error: "Enter a valid email address, like name@example.com." } }));
    await page.goto("/settings");
    await page.getByRole("button", { name: "Save Settings" }).click();
    const alert = page.locator("[role=alert]:not(#__next-route-announcer__)").first();
    await expect(alert).toContainText("valid email");
    await expect(alert).toBeInViewport();
  });

  test("regression: the AI & privacy card explains why external AI cannot be switched on", async ({ page, app }) => {
    app.api("GET /api/ai/settings", () => ({ json: { policy: { external_enabled: false, retention_days: 30 }, provider_configured: false, encrypted_at_rest: true } }));
    await page.goto("/settings");
    await expect(page.getByText("Not available").first()).toBeVisible();
    await expect(page.getByText(/nothing to switch/)).toBeVisible();
  });
});
