import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx next start -p ${port}`, port, reuseExistingServer: !process.env.CI, timeout: 60_000,
    env: { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "anon-test-key", SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "service-test-key" },
  },
});
