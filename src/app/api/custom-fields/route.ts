import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { BUILTIN_RECORDS, isBuiltinName } from "@/lib/builder/builtin";

/** Save the values of the fields a clinic added to a built-in record (patient, appointment…). Only fields that exist and are active are accepted. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.entity !== "string" || !isBuiltinName(b.entity)) throw new HttpError(400, "Unknown record type.");
    if (typeof b.recordId !== "string") throw new HttpError(400, "Missing record.");
    const table = BUILTIN_RECORDS[b.entity].table;
    const { data: defs, error: de } = await db.from("custom_field_defs").select("api_name, data_type, required, picklist_values, label").eq("clinic_id", b.clinicId).eq("entity", b.entity).eq("status", "active");
    if (de) throw new HttpError(400, /custom_field_defs/.test(de.message) ? "Run migration 024 (fields on built-in records) first." : de.message);
    const { data: rec } = await db.from(table).select("id, custom").eq("id", b.recordId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!rec) throw new HttpError(404, "Record not found in this clinic.");
    const input = b.values && typeof b.values === "object" ? b.values : {};
    const next: Record<string, unknown> = { ...(rec.custom ?? {}) };
    for (const d of defs ?? []) {
      if (!(d.api_name in input)) continue;
      let v: unknown = input[d.api_name];
      if (v === "" || v == null) { if (d.required) throw new HttpError(400, `${d.label} is required.`); delete next[d.api_name]; continue; }
      if (["number", "currency"].includes(d.data_type)) { v = Number(v); if (!Number.isFinite(v)) throw new HttpError(400, `${d.label} must be a number.`); }
      else if (d.data_type === "boolean") v = v === true || v === "true";
      else { v = String(v).slice(0, 2000); if (d.data_type === "picklist" && !(d.picklist_values ?? []).includes(v)) throw new HttpError(400, `${d.label}: choose one of the listed options.`); }
      next[d.api_name] = v;
    }
    const { error } = await db.from(table).update({ custom: next }).eq("id", b.recordId).eq("clinic_id", b.clinicId);
    if (error) throw new HttpError(400, error.message);
    return { ok: true };
  });
}
