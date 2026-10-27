import { test, expect, PID } from "./fixture";

test.describe("Records", () => {
  test("positive: the patient page shows the related lists and money summary", async ({ page }) => {
    await page.goto(`/patients/${PID}`);
    for (const h of ["Appointments", "Invoices", "Treatments", "Visit notes"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
    await expect(page.getByText("Balance due")).toBeVisible();
    await expect(page.getByText("₹15,200").first()).toBeVisible();
  });

  test("positive: Book next sitting opens booking with the patient already chosen", async ({ page }) => {
    await page.goto(`/patients/${PID}`);
    await page.getByRole("link", { name: "Book next sitting" }).click();
    await page.waitForURL(/\/appointments/);
    await expect(page.getByText("Abdul Rahim").first()).toBeVisible();
  });

  test("positive: the dustbin asks first, then deletes through the server", async ({ page, app }) => {
    await page.goto(`/patients/${PID}`);
    await page.getByRole("button", { name: "Delete this patient" }).click();
    const dlg = page.getByRole("dialog", { name: "Confirm delete" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: /^delete/i }).click();
    await expect.poll(() => app.called("/api/records/delete").length).toBe(1);
  });

  test("negative: cancelling the confirmation deletes nothing", async ({ page, app }) => {
    await page.goto(`/patients/${PID}`);
    await page.getByRole("button", { name: "Delete this patient" }).click();
    await page.getByRole("dialog", { name: "Confirm delete" }).getByRole("button", { name: /keep it/i }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(app.called("/api/records/delete")).toHaveLength(0);
  });

  test("negative: when the server refuses a delete, the reason is shown in the dialog", async ({ page, app }) => {
    app.api("POST /api/records/delete", () => ({ status: 403, json: { error: "Only an admin can delete patients." } }));
    await page.goto(`/patients/${PID}`);
    await page.getByRole("button", { name: "Delete this patient" }).click();
    const dlg = page.getByRole("dialog", { name: "Confirm delete" });
    await dlg.getByRole("button", { name: /^delete/i }).click();
    await expect(dlg.getByRole("alert")).toContainText("Only an admin");
  });
});
