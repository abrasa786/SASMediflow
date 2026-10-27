import { test, expect, IID } from "./fixture";

test.describe("Invoice", () => {
  test("regression: items created from a treatment sitting show their name and price", async ({ page }) => {
    await page.goto(`/billing/${IID}`);
    await expect(page.getByRole("heading", { name: /INV-2026-0003/ })).toBeVisible();
    await expect(page.locator("input").filter({ hasText: "" }).first()).toBeVisible();
    await expect(page.locator('input[value^="Dental implant"]')).toBeVisible();
  });

  test("positive: sending on WhatsApp shows a toast", async ({ page, app }) => {
    app.api("POST /api/invoices/send", () => ({ json: { status: "sent" } }));
    await page.goto(`/billing/${IID}`);
    await page.getByRole("button", { name: "Send on WhatsApp" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Invoice sent on WhatsApp." })).toBeVisible();
  });

  test("negative: when WhatsApp is not connected the page says so and offers a ready link", async ({ page, app }) => {
    app.api("POST /api/invoices/send", () => ({ json: { status: "link", error: "WhatsApp is not connected yet.", link: "https://wa.me/919187983647?text=hi" } }));
    await page.goto(`/billing/${IID}`);
    await page.getByRole("button", { name: "Send on WhatsApp" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("not connected");
    await expect(page.getByRole("link", { name: /send it myself/i })).toBeVisible();
  });

  test("negative: a server error is shown and the button comes back", async ({ page, app }) => {
    app.api("POST /api/invoices/send", () => ({ status: 500, json: { error: "Something went wrong." } }));
    await page.goto(`/billing/${IID}`);
    const b = page.getByRole("button", { name: "Send on WhatsApp" });
    await b.click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("Something went wrong");
    await expect(b).toBeEnabled();
  });

  test("positive: marking payment received returns to Home", async ({ page, app }) => {
    app.api("POST /api/payments/complete", () => ({ json: { appointmentId: null } }));
    await page.goto(`/billing/${IID}`);
    const b = page.getByRole("button", { name: /payment received|mark.*paid|received/i }).first();
    await b.click();
    await page.waitForURL(/\/dashboard/);
  });
});
