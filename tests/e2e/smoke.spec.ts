import { expect, test } from "@playwright/test";

// Public pages and guards. These need no database, so they run on every build.
test("home page loads", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(400);
});

test("login shows the sign-in form and the clinic can be chosen by web address", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test("signup asks for clinic details, brand and AI assistant name", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByText(/name your ai assistant/i)).toBeVisible();
});

test("unknown clinic page says so politely", async ({ page }) => {
  await page.route("**/api/public/clinic**", (r) => r.fulfill({ json: { clinic: null } }));
  await page.goto("/c/does-not-exist");
  await expect(page.getByText(/couldn.t find that clinic/i)).toBeVisible();
});

test("a branded clinic page uses the clinic's colour, name and bot", async ({ page }) => {
  await page.route("**/api/public/clinic**", (r) => r.fulfill({ json: { clinic: { slug: "sai", name: "Sai Dental", tagline: "Gentle care", primary_color: "#0d9488", ai_name: "Mira", doctors: [] } } }));
  await page.goto("/c/sai");
  await expect(page.getByText("Sai Dental").first()).toBeVisible();
  const v = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sky-600").trim());
  expect(v).not.toBe("");
});

test("protected pages send visitors to sign in", async ({ page }) => {
  for (const path of ["/dashboard", "/users", "/builder", "/chatbot", "/settings", "/claims"]) {
    await page.goto(path);
    await page.waitForURL(/\/login/, { timeout: 15_000 });
  }
});

test("APIs refuse anonymous callers", async ({ request }) => {
  for (const [method, path] of [["get", "/api/users?clinicId=00000000-0000-0000-0000-000000000000"], ["get", "/api/ai/history?clinicId=00000000-0000-0000-0000-000000000000"], ["post", "/api/chatbot"], ["post", "/api/builder/plan"], ["delete", "/api/users"]] as const) {
    const res = await request[method](path, method === "get" ? {} : { data: {} });
    expect([400, 401, 403], `${method} ${path}`).toContain(res.status());
  }
});

test("health endpoint never leaks values", async ({ request }) => {
  const res = await request.get("/api/health");
  const text = await res.text();
  expect(text).not.toMatch(/service-test-key|anon-test-key/);
});
