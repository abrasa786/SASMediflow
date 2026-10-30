import { test, expect, CID } from "./fixture";

test.describe("Setup", () => {
  test("positive: saving the clinic details calls the server, shows a toast and moves on", async ({ page, app }) => {
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Set up your clinic" })).toBeVisible();
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByPlaceholder("Street, area").fill("12 Main Road, Coimbatore");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Clinic details saved." })).toBeVisible();
    const c = app.called("/api/clinic/setup")[0];
    expect(c.body).toMatchObject({ clinicId: CID, action: "profile", fields: { phone: "9876543210", address: "12 Main Road, Coimbatore" } });
  });

  test("negative: a short phone number is explained next to the button and nothing is sent", async ({ page, app }) => {
    await page.goto("/setup");
    await page.getByPlaceholder("98765 43210").fill("123");
    await page.getByPlaceholder("Street, area").fill("12 Main Road");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("at least 10 digits");
    expect(app.called("/api/clinic/setup")).toHaveLength(0);
  });

  test("negative: a missing address is explained", async ({ page }) => {
    await page.goto("/setup");
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("address");
  });

  test("negative: when the server refuses, its reason is shown (not a silent failure)", async ({ page, app }) => {
    app.api("POST /api/clinic/setup", () => ({ status: 403, json: { error: "Your role (receptionist) cannot do this." } }));
    await page.goto("/setup");
    await page.getByPlaceholder("98765 43210").fill("9876543210");
    await page.getByPlaceholder("Street, area").fill("12 Main Road, Coimbatore");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("cannot do this");
  });

  test("positive: adding a doctor by name", async ({ page, app }) => {
    app.db.clinics[0].phone = "9876543210"; app.db.clinics[0].address = "12 Main Road";
    await page.goto("/setup");
    await page.getByPlaceholder(/Doctor's name/).fill("Dr. Anil Kumar");
    await page.getByRole("button", { name: "Add doctor" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Doctor added." })).toBeVisible();
    expect(app.called("/api/clinic/setup")[0].body).toMatchObject({ action: "doctor", me: false, name: "Dr. Anil Kumar" });
  });

  test("negative: adding a doctor with no name is explained", async ({ page, app }) => {
    app.db.clinics[0].phone = "9876543210"; app.db.clinics[0].address = "12 Main Road";
    await page.goto("/setup");
    await page.getByRole("button", { name: "Add doctor" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("doctor's name");
    expect(app.called("/api/clinic/setup")).toHaveLength(0);
  });

  test("regression: Home is not a trap. Setup opens once, then Home stays Home", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/setup/, { timeout: 15_000 });
    await page.getByRole("link", { name: "Home", exact: true }).click();
    await page.waitForURL(/\/dashboard/);
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/dashboard");
  });

  test("regression: the setup page works on a phone-width screen without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/setup");
    await expect(page.getByRole("heading", { name: "Set up your clinic" })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });
});

test.describe("Clinic stamp in Setup", () => {
  test("positive: choose a stamp image, save, the image is sent to the server and a toast shows", async ({ page, app }) => {
    app.api("POST /api/clinic/branding", () => ({ json: { branding: { stamp_url: "https://example.com/stamp.png" } } }));
    await page.goto("/setup");
    await page.getByText("Add your clinic stamp").click();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Upload logo").setInputFiles({ name: "stamp.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Save stamp" }).click();
    await expect.poll(() => app.called("/api/clinic/branding").length).toBe(1);
    expect(app.called("/api/clinic/branding")[0].body.stampDataUrl).toMatch(/^data:image\/png;base64,/);
    await expect(page.getByRole("status").filter({ hasText: "Stamp saved" })).toBeVisible();
  });

  test("negative: a server refusal is shown to the user", async ({ page, app }) => {
    app.api("POST /api/clinic/branding", () => ({ status: 500, json: { error: "The stamp needs a database update. Run supabase/RUN_ME_ALL_MIGRATIONS.sql in Supabase, then try again." } }));
    await page.goto("/setup");
    await page.getByText("Add your clinic stamp").click();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Upload logo").setInputFiles({ name: "stamp.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Save stamp" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("database update");
  });
});
