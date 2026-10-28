import { test, expect, PID, CID } from "./fixture";

const PLAN = "77777777-7777-4777-8777-777777777777";

test.describe("Sittings", () => {
  test("positive: add a first sitting for a patient, with its own cost and equipment", async ({ page, app }) => {
    app.api("POST /api/treatments/sitting", () => ({ json: { seq: 1, title: "Dental implant", plan_id: PLAN } }));
    await page.goto(`/sittings?new=1&patient=${PID}`);
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByLabel("Treatment name *").fill("Dental implant");
    await dlg.getByLabel("Estimated total cost (₹)").fill("40000");
    await dlg.getByLabel("This sitting *").fill("Tooth removal");
    await dlg.getByLabel("Cost of this sitting (₹) *").fill("2000");
    await dlg.getByRole("button", { name: /Add equipment/ }).click();
    await page.getByPlaceholder(/search/i).last().fill("glo");
    await page.getByText("Gloves").first().click();
    await dlg.getByRole("button", { name: "Save sitting" }).click();
    await expect.poll(() => app.called("/api/treatments/sitting").length).toBe(1);
    const b = app.called("/api/treatments/sitting")[0].body;
    expect(b).toMatchObject({ action: "add", patientId: PID, label: "Tooth removal", price: 2000, estimatedTotal: 40000, title: "Dental implant" });
    expect(b.materials[0].item).toBe("Gloves");
    await expect(page.getByRole("status").filter({ hasText: "Sitting 1 added to Dental implant" })).toBeVisible();
    await expect(dlg).toBeHidden();
  });

  test("negative: a sitting without a name or a cost is refused and nothing is sent", async ({ page, app }) => {
    await page.goto(`/sittings?new=1&patient=${PID}`);
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Treatment name *").fill("Dental implant");
    await dlg.getByRole("button", { name: "Save sitting" }).click();
    await expect(dlg.locator("[role=alert]")).toContainText("Name this sitting");
    await dlg.getByLabel("This sitting *").fill("Tooth removal");
    await dlg.getByRole("button", { name: "Save sitting" }).click();
    await expect(dlg.locator("[role=alert]")).toContainText("what this sitting costs");
    expect(app.called("/api/treatments/sitting")).toHaveLength(0);
  });

  test("negative: a server error is shown in the form and the form stays open", async ({ page, app }) => {
    app.api("POST /api/treatments/sitting", () => ({ status: 400, json: { error: "That treatment belongs to another clinic." } }));
    await page.goto(`/sittings?new=1&patient=${PID}`);
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Treatment name *").fill("Dental implant");
    await dlg.getByLabel("This sitting *").fill("Tooth removal");
    await dlg.getByLabel("Cost of this sitting (₹) *").fill("2000");
    await dlg.getByRole("button", { name: "Save sitting" }).click();
    await expect(dlg.locator("[role=alert]")).toContainText("another clinic");
    await expect(dlg).toBeVisible();
  });

  test("positive: the Treatments page shows a part-paid badge and Add sitting", async ({ page, app }) => {
    app.db.treatment_plans.push({ id: PLAN, clinic_id: CID, clinic_patient_id: PID, title: "Dental implant", total_amount: 40000, discount: 0, status: "active", payment_status: "part_paid", mode: "flexible", created_at: "2026-10-28T00:00:00Z",
      clinic_patients: { name: "Abdul Rahim", phone: "9187983647" }, doctors: null,
      treatment_sittings: [{ id: "88888888-8888-4888-8888-888888888888", seq: 1, label: "Tooth removal", target_date: "2026-10-28", amount: 2000, due_amount: 2000, paid_amount: 2000, status: "done", invoice_id: null }] });
    await page.goto("/treatments");
    await expect(page.getByText("Partly paid").first()).toBeVisible();
    await expect(page.getByText("Estimated ₹40,000")).toBeVisible();
    await page.getByRole("button", { name: "+ Add sitting" }).click();
    await expect(page.getByRole("dialog", { name: /Add a sitting/ })).toBeVisible();
  });

  test("positive: This was the last sitting calls the server", async ({ page, app }) => {
    app.db.treatment_plans.push({ id: PLAN, clinic_id: CID, clinic_patient_id: PID, title: "Dental implant", total_amount: 40000, discount: 0, status: "active", payment_status: "paid", mode: "flexible", created_at: "2026-10-28T00:00:00Z",
      clinic_patients: { name: "Abdul Rahim" }, doctors: null, treatment_sittings: [] });
    app.api("POST /api/treatments/sitting", () => ({ json: { status: "completed" } }));
    await page.goto("/treatments");
    await page.getByRole("button", { name: "This was the last sitting" }).click();
    await expect.poll(() => app.called("/api/treatments/sitting").length).toBe(1);
    expect(app.called("/api/treatments/sitting")[0].body).toMatchObject({ action: "finish", planId: PLAN, finish: true });
    await expect(page.getByRole("status").filter({ hasText: "Treatment fully paid and closed" })).toBeVisible();
  });
});
