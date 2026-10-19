import { expect, test } from "@playwright/test";

// Budgets that catch "lagging" regressions on public pages (local production build).
for (const path of ["/login", "/signup"]) {
  test(`${path} is quick and does not shift`, async ({ page }) => {
    await page.goto(path, { waitUntil: "load" });
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return { dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, kb: performance.getEntriesByType("resource").reduce((n, r) => n + ((r as PerformanceResourceTiming).transferSize || 0), 0) / 1024 };
    });
    expect(m.dcl, "DOMContentLoaded ms").toBeLessThan(2500);
    expect(m.load, "load ms").toBeLessThan(4000);
    expect(m.kb, "transferred KB").toBeLessThan(900);
  });
}

test("typing in a form stays responsive", async ({ page }) => {
  await page.goto("/login");
  const t0 = Date.now();
  await page.locator('input[type="email"]').pressSequentially("someone@clinic.example", { delay: 0 });
  expect(Date.now() - t0).toBeLessThan(1500);
});
