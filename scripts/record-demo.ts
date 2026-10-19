/**
 * Records a screen video of the guided demo (/demo) with Playwright, as raw footage for the product video.
 * Usage:  npm run build && npx next start -p 3100 &   then   npx tsx scripts/record-demo.ts
 * Output: demo-video/*.webm  (1280x720). Add narration and captions in a video tool (see docs/VIDEO.md).
 */
import { chromium } from "@playwright/test";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3100";
(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: "demo-video", size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto(`${base}/demo`);
  await page.waitForTimeout(2500);
  const start = page.locator('[data-act="startquiet"]');
  if (await start.count()) await start.first().click();
  for (let i = 0; i < 25; i++) {                       // walk the trail, pausing so each screen can be narrated
    await page.waitForTimeout(3000);
    const next = page.locator("#bNext");
    if (!(await next.count()) || (await next.isDisabled())) break;
    await next.click();
  }
  await ctx.close(); await browser.close();
  console.log("Saved to demo-video/");
})();
