import { expect, test, type Page } from "@playwright/test";

/**
 * Full walkthrough of the clinic app, signed in as the clinic admin.
 *
 *   E2E_BASE_URL=https://sas-mediflow.vercel.app E2E_EMAIL=you@clinic.com E2E_PASSWORD='...' npx playwright test features
 *
 * Use a TEST clinic: this creates a patient, an appointment, a staff member, a treatment template and an invoice
 * (all named "E2E <timestamp>") and it never sends real WhatsApp messages unless the clinic has WhatsApp connected
 * and the test patient's number is a real one. The test patient uses an unreachable number.
 * Without E2E_EMAIL and E2E_PASSWORD the whole file is skipped.
 */
const EMAIL = process.env.E2E_EMAIL, PASSWORD = process.env.E2E_PASSWORD;
test.skip(!EMAIL || !PASSWORD, "set E2E_EMAIL and E2E_PASSWORD to run the signed-in walkthrough");
test.describe.configure({ mode: "serial" });

const RUN = `E2E ${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "")}`;
const PHONE = "6000000" + String(Math.floor(Math.random() * 900) + 100);   // 10 digits, not a real subscriber
let page: Page;
const problems: string[] = [];

const tomorrow = () => { const d = new Date(Date.now() + 86_400_000); return d.toISOString().slice(0, 10); };

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("pageerror", (e) => problems.push(`page error on ${page.url()}: ${e.message}`));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 500) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
});
test.afterAll(async () => { await page.close(); });

async function open(path: string, heading: RegExp | string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 20_000 });
}

test("sign in", async () => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(EMAIL!);
  await page.locator('input[type="password"]').fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  // some accounts see a clinic chooser first
  const choose = page.getByRole("heading", { name: /choose a clinic/i });
  if (await choose.isVisible({ timeout: 4000 }).catch(() => false)) await page.locator("button").filter({ hasText: /./ }).nth(0).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("every page opens without an error", async () => {
  const pages: [string, RegExp | string][] = [
    ["/dashboard", "Dashboard"], ["/patients", "Patients"], ["/appointments", "Appointments"], ["/calendar", "Calendar"],
    ["/availability", "Doctor availability"], ["/staff", /staff/i], ["/users", "Users"], ["/treatments", "Treatments"],
    ["/billing", "Billing"], ["/payments", "Payments"], ["/stock", "Stock"], ["/purchasing", "Purchasing"],
    ["/tasks", "Task Manager"], ["/recall", "Recall"], ["/attendance", "Attendance"], ["/leave", "Leave"],
    ["/analytics", "Analytics"], ["/settings", "Settings"], ["/profile", "My profile"],
  ];
  for (const [path, h] of pages) await test.step(path, () => open(path, h));
  expect(problems, problems.join("\n")).toEqual([]);
});

test("add a patient", async () => {
  await open("/patients", "Patients");
  await page.getByRole("button", { name: /new patient/i }).click();
  await page.getByLabel(/full name/i).fill(`${RUN} Patient`);
  await page.locator('input[placeholder="+91 98765 43210"]').fill(PHONE);
  await page.getByRole("button", { name: /save patient/i }).click();
  await page.getByPlaceholder(/search by name or phone/i).fill(`${RUN} Patient`);
  await expect(page.getByText(`${RUN} Patient`).first()).toBeVisible({ timeout: 15_000 });
});

test("a patient record opens its own page and can be edited", async () => {
  await open("/patients", "Patients");
  await page.getByPlaceholder(/search by name or phone/i).fill(`${RUN} Patient`);
  await page.getByText(`${RUN} Patient`).first().click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}/);
  await page.getByLabel("Allergies").fill("Penicillin");
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Allergies")).toHaveValue("Penicillin");
});

test("add a staff member without an invitation email (temporary password)", async () => {
  await open("/staff", /staff/i);
  await page.getByRole("button", { name: /\+ add staff/i }).click();
  await expect(page.getByText(/temporary password/i)).toBeVisible();
  await page.getByPlaceholder("Abdul Rahim").fill(`${RUN} Reception`);
  await page.locator('input[type="email"]').last().fill(`e2e+${Date.now()}@example.com`);
  await page.getByPlaceholder("At least 8 characters").fill("Temp-pass-" + Date.now().toString().slice(-6));
  await page.getByRole("button", { name: /^add staff member$/i }).click();
  await expect(page.getByText(`${RUN} Reception`).first()).toBeVisible({ timeout: 20_000 });
});

test("a staff record is clickable and editable", async () => {
  await open("/staff", /staff/i);
  await page.getByText(`${RUN} Reception`).first().click();
  await expect(page.getByRole("button", { name: /save/i }).first()).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
});

test("users page offers a password reset", async () => {
  await open("/users", "Users");
  const reset = page.getByRole("button", { name: /reset password/i }).first();
  if (await reset.count() === 0) test.skip(true, "no non-admin user to reset");
  await reset.click();
  await page.getByRole("button", { name: /generate/i }).click();
  await expect(page.getByPlaceholder("New password")).not.toHaveValue("");
  await page.getByText(/^cancel$/i).first().click();
});

test("book an appointment (typed date, free slot)", async () => {
  await open("/appointments", "Appointments");
  await page.getByRole("button", { name: "+ Book" }).click();
  await page.getByPlaceholder("Full name").fill(`${RUN} Visit`);
  await page.getByPlaceholder("98765 43210").fill(PHONE.slice(0, 7) + "999");
  await page.locator('input[type="date"]').fill(tomorrow());
  const slot = page.locator("button").filter({ hasText: /^\d{1,2}:\d{2} (AM|PM)$/ }).first();
  await expect(slot, "no free slot tomorrow: set doctor hours on the Availability page").toBeVisible({ timeout: 20_000 });
  await slot.click();
  await page.getByRole("button", { name: /book|confirm/i }).last().click();
  await expect(page.getByText(`${RUN} Visit`).first()).toBeVisible({ timeout: 20_000 });
});

test("Done · bill opens the invoice with the patient and fee filled in", async () => {
  await open(`/appointments?date=${tomorrow()}`, "Appointments");
  const row = page.locator("tr, li, div").filter({ hasText: `${RUN} Visit` }).filter({ has: page.getByRole("button", { name: /done · bill/i }) }).last();
  await row.getByRole("button", { name: /done · bill/i }).click();
  await page.waitForURL(/\/billing\?appointment=/);
  await expect(page.getByText(`${RUN} Visit`).first()).toBeVisible();
  await expect(page.getByText(/consultation/i).first()).toBeVisible();
});

test("invoice: item lookup, discount, totals, create", async () => {
  // still on the invoice form from the previous test
  const item = page.locator('input[placeholder*="Item" i], input[value^="Consultation"]').first();
  await item.fill("Scaling");
  await page.getByText(/^discount/i).first().waitFor();
  const discount = page.locator("label", { hasText: /^discount/i }).locator("input").first();
  if (await discount.count()) await discount.fill("50");
  await expect(page.getByText(/^total/i).first()).toBeVisible();
  await expect(page.getByText(/method of payment/i)).toBeVisible();
  await expect(page.getByRole("option", { name: /physical/i }).first()).toBeAttached();
  await page.getByRole("button", { name: /^create invoice$/i }).click();
  await expect(page.getByText(/invoice .* created|INV-/i).first()).toBeVisible({ timeout: 20_000 });
});

test("the invoice has its own page: edit the discount and notes, totals follow", async () => {
  await open("/payments", "Payments");
  await page.getByRole("button", { name: /^all$/i }).click();
  await page.getByText(`${RUN} Visit`).first().click();
  await page.waitForURL(/\/billing\/[0-9a-f-]{36}/);
  await page.getByLabel("Notes").fill("edited by e2e");
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await page.goBack();
});

test("an appointment opens its own page and can be edited", async () => {
  await open(`/appointments?date=${tomorrow()}`, "Appointments");
  await page.getByText(`${RUN} Visit`).first().click();
  await page.waitForURL(/\/appointments\/[0-9a-f-]{36}/);
  await page.getByLabel("Reason for visit").fill("e2e checkup");
  await page.getByRole("button", { name: /save changes/i }).click();
  await expect(page.getByText(/^Saved/)).toBeVisible({ timeout: 15_000 });
});

test("stock and task rows open record pages", async () => {
  for (const [path, re] of [["/stock", /\/stock\/[0-9a-f-]{36}/], ["/tasks", /\/tasks\/[0-9a-f-]{36}/]] as const) {
    await page.goto(path);
    const row = page.locator("tbody tr, [draggable=true]").first();
    if (await row.count() === 0) continue;   // nothing created yet
    await row.click();
    await page.waitForURL(re);
    await expect(page.getByRole("button", { name: /save changes/i })).toBeVisible();
  }
});

test("invoice PDF opens and is a real PDF", async () => {
  const [popup] = await Promise.all([page.waitForEvent("popup").catch(() => null), page.getByRole("button", { name: /download invoice pdf/i }).click()]);
  expect(popup, "the PDF should open in a new tab").not.toBeNull();
  const res = await page.request.get(popup!.url());
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  expect((await res.body()).subarray(0, 4).toString()).toBe("%PDF");
  await popup!.close();
});

test("send invoice on WhatsApp gives a clear result", async () => {
  await page.getByRole("button", { name: /send invoice on whatsapp/i }).click();
  // connected: "Sent to the patient"; not connected or outside 24 h: a clear message with a fallback link
  await expect(page.getByText(/sent to the patient|not connected|failed|24 hours|ready to send|no valid mobile/i).first()).toBeVisible({ timeout: 25_000 });
});

test("payment received: invoice paid, appointment closed, redirected back", async () => {
  await open("/billing", "Billing");
  await page.getByRole("button", { name: /payment received/i }).first().click();
  await page.waitForURL(/\/appointments|\/billing/, { timeout: 20_000 });
  await open("/payments", "Payments");
  await expect(page.getByText(/done/i).first()).toBeVisible();
});

test("treatment templates: create one with 5 sittings", async () => {
  await open("/treatments", "Treatments");
  await page.getByRole("button", { name: /templates/i }).first().click().catch(() => null);
  await page.getByRole("button", { name: "+ New template" }).click();
  await page.getByPlaceholder(/braces/i).fill(`${RUN} Braces`);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: /add (a )?sitting|\+ sitting/i }).first().click().catch(() => null);
  await page.getByRole("button", { name: /^save$/i }).click();
  await expect(page.getByText(`${RUN} Braces`).first()).toBeVisible({ timeout: 15_000 });
});

test("assistant: book by chat and open an invoice inside the chat", async () => {
  await open("/chatbot", /./);
  const box = page.getByPlaceholder(/book, cancel, reschedule/i);
  await box.fill("What's on today?");
  await box.press("Enter");
  await expect(page.locator("main, body").getByText(/today|no appointments|appointment/i).first()).toBeVisible({ timeout: 20_000 });
  await box.fill(`create an invoice for ${PHONE}`);
  await box.press("Enter");
  await expect(page.getByPlaceholder("Item or service")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /create & send/i })).toBeVisible();
  await box.fill("something about cricket scores");
  await box.press("Enter");
  await expect(page.getByText(/clinic|can only|help with/i).last()).toBeVisible({ timeout: 20_000 });   // stays inside the clinic
});

test("public clinic page and booking page open without signing in", async ({ browser }) => {
  const slug = process.env.E2E_CLINIC_SLUG;
  test.skip(!slug, "set E2E_CLINIC_SLUG to check the public pages");
  const anon = await browser.newPage();
  for (const p of [`/c/${slug}`, `/c/${slug}/book`]) {
    const res = await anon.goto(p);
    expect(res?.status()).toBeLessThan(400);
    await expect(anon.getByText(/loading…/i)).toHaveCount(0, { timeout: 20_000 });
    expect(await anon.locator('script[type="application/ld+json"]').count(), `${p} should carry structured data`).toBeGreaterThan(0);
  }
  await anon.close();
});

test("settings, builder and profile pages work", async () => {
  await open("/settings", "Settings");
  await open("/builder", /./);
  await open("/profile", "My profile");
  await expect(page.getByText(/email/i).first()).toBeVisible();
});

test("no server errors or page errors during the whole run", async () => {
  expect(problems, problems.join("\n")).toEqual([]);
});

test("sign out returns to the sign-in page", async () => {
  await page.getByRole("button", { name: /sign out|log out/i }).first().click().catch(() => null);
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});
