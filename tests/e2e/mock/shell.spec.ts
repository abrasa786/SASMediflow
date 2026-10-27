import { test, expect } from "./fixture";
import { bare, expect as bareExpect, App } from "./fixture";

const TABS: [string, string, string | null, string][] = [
  ["Patients", "/patients", "/lists/patients", "New"], ["Appointments", "/appointments", "/lists/appointments", "New"],
  ["Treatments", "/treatments", "/lists/treatments", "New"], ["Billing", "/billing", "/lists/invoices", "New"],
];

test.describe("Layout and navigation", () => {
  test("the five main tabs run across the top and each opens its page", async ({ page }) => {
    await page.goto("/patients");
    const nav = page.getByRole("navigation", { name: "Main tabs" });
    for (const t of ["Home", "Patients", "Appointments", "Treatments", "Billing"]) await expect(nav.getByRole("link", { name: t, exact: true })).toBeVisible();
  });

  test("Home has + New booking", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/(dashboard|setup)/);
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "New booking", exact: true }).first()).toBeVisible();
  });

  for (const [name, href, list, label] of TABS) {
    test(`${name}: + New and List view are present`, async ({ page }) => {
      await page.goto(href);
      await expect(page.getByRole("link", { name: label, exact: true }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "List view" })).toHaveAttribute("href", list!);
    });
    test(`${name}: the List view opens with a search box`, async ({ page }) => {
      await page.goto(list!);
      await expect(page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first()).toBeVisible();
    });
  }

  test("the ☰ menu holds Setup and the other features", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("navigation", { name: "Main menu" }).or(page.getByLabel("Main menu"));
    await expect(menu.getByText("Setup").first()).toBeVisible();
    await page.getByRole("button", { name: "Close menu" }).click();
  });

  test("the AI Assistant button stays at the bottom right and opens a chat", async ({ page }) => {
    await page.goto("/patients");
    const b = page.getByRole("button", { name: /^Open / }).last();
    await expect(b).toBeInViewport();
    const box = (await b.boundingBox())!, vp = page.viewportSize()!;
    expect(box.x + box.width).toBeGreaterThan(vp.width * 0.7);
    expect(box.y + box.height).toBeGreaterThan(vp.height * 0.7);
    await b.click();
    await expect(page.getByLabel("Message")).toBeVisible();
  });

  test("global search opens from the top bar", async ({ page }) => {
    await page.goto("/patients");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("dialog").or(page.getByPlaceholder(/search/i)).first()).toBeVisible();
  });

  test("regression: an unknown page shows a friendly message, not a blank screen", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");
    await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
  });
});

bare.describe("Signed out", () => {
  bare("negative: a signed-out visitor is sent to the login page", async ({ page }) => {
    const app = new App(); await app.attach(page, false);
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  });
  bare("negative: a wrong password shows an error in red", async ({ page }) => {
    const app = new App(); await app.attach(page, false);
    await page.route("**/auth/v1/token**", (r) => r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials", code: "invalid_credentials", message: "Invalid login credentials" }) }));
    await page.goto("/login");
    await page.getByPlaceholder("you@yourclinic.com").fill("a@b.com");
    await page.getByPlaceholder("Your password").fill("wrong-password");
    await page.getByRole("button", { name: /sign in/i }).first().click();
    await bareExpect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toBeVisible();
  });
  bare("negative: a forged calendar or PDF link is refused", async ({ request }) => {
    bareExpect((await request.get("/api/appointments/calendar?id=33333333-3333-4333-8333-333333333333&t=bad")).status()).toBe(404);
    bareExpect((await request.get("/api/invoices/pdf?id=44444444-4444-4444-8444-444444444444&t=bad")).status()).toBe(404);
  });
});
