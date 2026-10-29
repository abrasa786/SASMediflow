import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { cleanRow, MAX_IMPORT_ROWS, FIELDS, type Mapping } from "@/lib/import/patients";

export const maxDuration = 30;

/**
 * Bring patients over from another app. Admin only.
 *   preview  checks the rows and reports what would happen; saves nothing
 *   commit   saves the new patients as one batch (people already in the clinic are skipped, never overwritten)
 *   undo     removes a batch's patients that have no visits, bills or treatments yet
 *   list     recent batches
 * The same rules run on the screen (to show the preview) and here (to enforce them).
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    const clinicId: string = b.clinicId;
    const batchTable = () => db.from("import_batches");
    const tooOld = (e: any) => { if (e && /import_batches|import_batch_id|does not exist|schema cache/i.test(e.message ?? "")) throw new HttpError(500, "Import needs a database update. Run supabase/RUN_ME_ALL_MIGRATIONS.sql in Supabase, then try again."); };

    if (b.action === "list") {
      const { data, error } = await batchTable().select("id, file_name, total, added, duplicates, failed, created_at, undone_at").eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(10);
      tooOld(error); if (error) throw new HttpError(500, error.message);
      return { batches: data ?? [] };
    }

    if (b.action === "undo") {
      if (typeof b.batchId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.batchId)) throw new HttpError(400, "Which import?");
      const { data: batch, error: be } = await batchTable().select("id, undone_at").eq("id", b.batchId).eq("clinic_id", clinicId).maybeSingle();
      tooOld(be);
      if (!batch) throw new HttpError(404, "That import was not found in this clinic.");
      if (batch.undone_at) throw new HttpError(409, "This import was already undone.");
      const { data: pts } = await db.from("clinic_patients").select("id").eq("clinic_id", clinicId).eq("import_batch_id", b.batchId).limit(5000);
      const ids: string[] = (pts ?? []).map((p: any) => p.id);
      const used = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        for (const t of ["appointments", "invoices", "treatment_plans", "visit_notes"]) {
          const { data } = await db.from(t).select("clinic_patient_id").eq("clinic_id", clinicId).in("clinic_patient_id", part);
          (data ?? []).forEach((r: any) => used.add(r.clinic_patient_id));
        }
      }
      const removable = ids.filter((id) => !used.has(id));
      for (let i = 0; i < removable.length; i += 200) {
        const { error } = await db.from("clinic_patients").delete().eq("clinic_id", clinicId).in("id", removable.slice(i, i + 200));
        if (error) throw new HttpError(500, "Could not remove some patients: " + error.message);
      }
      await batchTable().update({ undone_at: new Date().toISOString() }).eq("id", b.batchId).eq("clinic_id", clinicId);
      return { removed: removable.length, kept: ids.length - removable.length };
    }

    if (b.action !== "preview" && b.action !== "commit") throw new HttpError(400, "Unknown action.");
    const rows: Record<string, unknown>[] = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) throw new HttpError(400, "The file has no patient rows.");
    if (rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, `Import up to ${MAX_IMPORT_ROWS} patients at a time. Split the file and import it in parts.`);
    const map: Mapping = {};
    for (const f of FIELDS) { const h = b.mapping?.[f.key]; if (typeof h === "string" && h) map[f.key] = h; }
    if (!map.name) throw new HttpError(400, "Choose which column holds the patient's name.");

    // existing people in this clinic (by mobile, or by name and date of birth when there is no mobile)
    const existing = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("clinic_patients").select("name, phone_norm, dob").eq("clinic_id", clinicId).range(from, from + 999);
      if (error) throw new HttpError(500, error.message);
      (data ?? []).forEach((p: any) => existing.add(p.phone_norm && p.phone_norm.length === 10 ? "p:" + p.phone_norm : "n:" + String(p.name ?? "").toLowerCase() + "|" + (p.dob ?? "")));
      if (!data || data.length < 1000) break;
    }

    const seen = new Set<string>();
    const toAdd: any[] = []; const skipped: { row: number; name: string; reason: string }[] = []; const warnings: { row: number; name: string; note: string }[] = [];
    let dupes = 0, bad = 0;
    rows.forEach((raw, i) => {
      const r = cleanRow(raw, map); const line = i + 2;           // line 1 of the file is the header
      if (!r.patient) { bad++; skipped.push({ row: line, name: String(raw[map.name as string] ?? ""), reason: r.problems.join(", ") }); return; }
      if (existing.has(r.key) || seen.has(r.key)) { dupes++; skipped.push({ row: line, name: r.patient.name, reason: existing.has(r.key) ? "Already in your patients" : "Repeated in the file" }); return; }
      seen.add(r.key); toAdd.push(r.patient);
      r.warnings.forEach((w) => warnings.push({ row: line, name: r.patient!.name, note: w }));
    });

    const summary = { total: rows.length, willAdd: toAdd.length, duplicates: dupes, invalid: bad, skipped: skipped.slice(0, 100), warnings: warnings.slice(0, 100), sample: toAdd.slice(0, 5).map((p) => ({ name: p.name, phone: p.phone, dob: p.dob })) };
    if (b.action === "preview") return { preview: summary };

    if (!toAdd.length) throw new HttpError(400, "There is nothing new to import. Everyone in this file is already in your patients or has a problem.");
    const { data: batch, error: ce } = await batchTable().insert({ clinic_id: clinicId, kind: "patients", file_name: String(b.fileName ?? "").slice(0, 200) || null, total: rows.length, created_by: userId }).select("id").single();
    tooOld(ce); if (ce || !batch) throw new HttpError(500, ce?.message ?? "Could not start the import.");
    let added = 0, failed = 0; const failures: string[] = [];
    for (let i = 0; i < toAdd.length; i += 200) {
      const chunk = toAdd.slice(i, i + 200).map((p) => ({ ...p, clinic_id: clinicId, import_batch_id: batch.id }));
      const { error } = await db.from("clinic_patients").insert(chunk);
      if (error) { failed += chunk.length; failures.push(error.message); } else added += chunk.length;
    }
    await batchTable().update({ added, duplicates: dupes, failed: failed + bad }).eq("id", batch.id).eq("clinic_id", clinicId);
    if (!added) throw new HttpError(500, "Nothing could be saved: " + (failures[0] ?? "unknown error"));
    return { batchId: batch.id, added, duplicates: dupes, invalid: bad, failed, summary };
  });
}
