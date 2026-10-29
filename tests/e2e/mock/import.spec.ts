import { test, expect } from "./fixture";

const CSV = "Name,Mobile,Date of birth\nAsha Verma,9876543210,12/03/1985\nRavi Kumar,9123456780,\n";

test.describe("Import patients in Setup", () => {
  test("positive: choose a file, match columns, check, import, toast", async ({ page, app }) => {
    app.api("POST /api/import/patients", (c) => c.body.action === "preview"
      ? { json: { preview: { total: 2, willAdd: 2, duplicates: 0, invalid: 0, skipped: [], warnings: [], sample: [{ name: "Asha Verma", phone: "9876543210" }] } } }
      : { json: { batchId: "99999999-9999-4999-8999-999999999999", added: 2, duplicates: 0, invalid: 0, failed: 0 } });
    await page.goto("/import");
    await page.getByLabel("Choose patient file").setInputFiles({ name: "practo.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByText("2 patients found")).toBeVisible();
    await expect(page.getByLabel("Patient name *")).toHaveValue("Name");           // columns are guessed
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.getByText("2 new patients will be added")).toBeVisible();
    await page.getByRole("button", { name: "Import 2 patients" }).click();
    await expect(page.getByRole("status").filter({ hasText: "2 patients imported" }).first()).toBeVisible();
    const sent = app.called("/api/import/patients").find((x) => x.body.action === "commit")!.body;
    expect(sent.rows).toHaveLength(2); expect(sent.mapping).toMatchObject({ name: "Name", phone: "Mobile" });
  });

  test("negative: a file that is not a CSV is refused and nothing is sent", async ({ page, app }) => {
    await page.goto("/import");
    await page.getByLabel("Choose patient file").setInputFiles({ name: "patients.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("Choose a CSV file");
    expect(app.called("/api/import/patients")).toHaveLength(0);
  });

  test("negative: a file with only a header row is refused", async ({ page }) => {
    await page.goto("/import");
    await page.getByLabel("Choose patient file").setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Mobile\n") });
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("no patient rows");
  });

  test("negative: a server error is shown and nothing is claimed as imported", async ({ page, app }) => {
    app.api("POST /api/import/patients", () => ({ status: 500, json: { error: "Import needs a database update. Run supabase/RUN_ME_ALL_MIGRATIONS.sql in Supabase, then try again." } }));
    await page.goto("/import");
    await page.getByLabel("Choose patient file").setInputFiles({ name: "p.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await page.getByRole("button", { name: "Check the file" }).click();
    await expect(page.locator("[role=alert]:not(#__next-route-announcer__)")).toContainText("database update");
  });

  test("positive: the Setup page offers the import step", async ({ page }) => {
    await page.goto("/setup");
    await expect(page.getByText("Bring your patients from another app")).toBeVisible();
  });
});
