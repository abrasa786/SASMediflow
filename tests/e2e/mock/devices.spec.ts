import { test, expect, PID, IID, AID } from "./fixture";

/** Device and usability matrix. Every screen, at phone, foldable, tablet, laptop and wide-desktop sizes. */
const DEVICES: [string, number, number, boolean][] = [
  ["Galaxy Z Fold (cover)", 280, 653, true], ["iPhone SE", 375, 667, true], ["iPhone 14", 390, 844, true], ["Pixel 7", 412, 915, true],
  ["iPad portrait", 768, 1024, true], ["iPad landscape / laptop", 1024, 768, false], ["Desktop", 1440, 900, false],
];
const SCREENS = ["/dashboard", "/patients", `/patients/${PID}`, "/appointments", `/appointments/${AID}`, "/appointments/list", "/billing", `/billing/${IID}`,
  "/treatments", "/lists/patients", "/lists/invoices", "/setup", "/settings", "/stock", "/staff", "/availability", "/calendar", "/offers", "/tasks", "/builder", "/analytics", "/recall", "/payments", "/purchasing", "/profile"];

/** page content wider than the screen, outside a scrollable box */
async function overflow(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth, bad: string[] = [];
    for (const e of Array.from(document.querySelectorAll("body *"))) {
      const c = e.getBoundingClientRect(); if (!c.width || !c.height) continue;
      if (c.right > vw + 1 || c.left < -1) {
        let a: Element | null = e, ok = false;
        while ((a = a.parentElement)) { const o = getComputedStyle(a).overflowX; if (/(auto|scroll|hidden|clip)/.test(o) && a !== document.body && a !== document.documentElement) { ok = true; break; } }
        if (!ok && !e.closest(".fixed,[aria-hidden='true'],.invisible,[inert]")) bad.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(" ").slice(0, 2).join(".")}`);
      }
    }
    return { sw: document.documentElement.scrollWidth, vw, bad: bad.slice(0, 4) };
  });
}

for (const [name, w, h, touch] of DEVICES) {
  test.describe(`${name} (${w}px)`, () => {
    test.use({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });

    test(`no screen needs sideways scrolling or has a clipped control`, async ({ page }) => {
      test.setTimeout(150_000);
      const problems: string[] = [];
      for (const s of SCREENS) {
        await page.goto(s, { waitUntil: "domcontentloaded" }).catch(() => null);
        await page.waitForTimeout(700);
        if (/\/login/.test(page.url())) { problems.push(`${s} → sent to login`); continue; }
        const r = await overflow(page);
        if (r.sw > r.vw + 1 || r.bad.length) problems.push(`${s}: page ${r.sw}px in a ${r.vw}px screen ${r.bad.join(" | ")}`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    test(`the tab bar, menu and assistant are always reachable`, async ({ page }) => {
      await page.goto("/patients");
      const nav = page.getByRole("navigation", { name: "Main tabs" });
      await expect(nav).toBeVisible();
      await nav.getByRole("link", { name: "Billing", exact: true }).scrollIntoViewIfNeeded();
      await expect(nav.getByRole("link", { name: "Billing", exact: true })).toBeInViewport();
      await expect(page.getByRole("button", { name: "Open menu" })).toBeInViewport();
      await expect(page.getByRole("button", { name: /^Open / }).last()).toBeInViewport();
      await expect(page.getByRole("link", { name: "New", exact: true }).first()).toBeInViewport();
    });

    if (touch) {
      test(`phone text fields are 16px or larger (so iOS does not zoom in) and taps are easy`, async ({ page }) => {
        const small: string[] = [], tiny: string[] = [];
        for (const s of ["/patients", "/appointments?new=1", `/billing/${IID}`, "/settings", "/setup"]) {
          await page.goto(s, { waitUntil: "networkidle" }).catch(() => null);
          await page.waitForTimeout(250);
          const r = await page.evaluate(() => {
            const vis = (e: Element) => { const c = e.getBoundingClientRect(); const st = getComputedStyle(e); return c.width > 0 && c.height > 0 && st.visibility !== "hidden" && st.display !== "none"; };
            const fields = Array.from(document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),select,textarea")).filter(vis)
              .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => (e.getAttribute("placeholder") || e.getAttribute("aria-label") || e.tagName.toLowerCase()) + ":" + getComputedStyle(e).fontSize);
            const taps = Array.from(document.querySelectorAll("button,a[href]")).filter(vis).filter((e) => { const c = e.getBoundingClientRect(); return c.height < 32 || c.width < 32; })
              .filter((e) => !(e.textContent || "").trim().match(/^(×|✕|x)$/i) || true).map((e) => ((e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 24)) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
            return { fields, taps };
          });
          r.fields.slice(0, 3).forEach((f) => small.push(`${s} ${f}`)); r.taps.slice(0, 3).forEach((f) => tiny.push(`${s} ${f}`));
        }
        expect({ smallText: small, smallTaps: tiny }, "fields under 16px zoom the page on iPhones; taps under 32px are hard to hit").toEqual({ smallText: [], smallTaps: [] });
      });
    }
  });
}
