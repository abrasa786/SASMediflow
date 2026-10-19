import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

/** Tables this person may open, with their field lists and what they may do. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId } = await requireClinicMember(req, clinicId);
    const { data, error } = await db.rpc("builder_accessible", { p_clinic: clinicId, p_user: userId });
    if (error) { if (/builder_accessible|does not exist/.test(error.message)) throw new HttpError(500, "Access control is not installed yet. Run supabase/migrations/008_builder_access_and_reports.sql in the Supabase SQL editor."); throwRpc(error); }
    return { tables: (data ?? []).filter((t: any) => !t.builtin) };
  });
}

const clean = (row: any, fields: string[]) => {
  const o: Record<string, unknown> = { id: row.id, owner_id: row.owner_id, created_at: row.created_at, updated_at: row.updated_at };
  for (const f of fields) o[f] = row["f_" + f] ?? null;
  return o;
};

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId);
    if (typeof b.object !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(b.object)) throw new HttpError(400, "Choose a table.");

    if (b.action === "list") {
      const { data: acc } = await db.rpc("builder_accessible", { p_clinic: b.clinicId, p_user: userId });
      const t = (acc ?? []).find((x: any) => x.api_name === b.object);
      if (!t) throw new HttpError(403, "You do not have access to this table.");
      const { data, error } = await db.rpc("builder_rec_list", { p: { clinic_id: b.clinicId, actor: userId, object: b.object, filters: Array.isArray(b.filters) ? b.filters : [], search: b.search ?? null, limit: b.limit ?? 50, offset: b.offset ?? 0 } });
      if (error) throwRpc(error);
      const names: string[] = t.fields.map((f: any) => f.api);
      return { total: data.total, access: data.access, rows: data.rows.map((r: any) => clean(r, names)) };
    }
    if (b.action === "save") {
      if (b.values == null || typeof b.values !== "object") throw new HttpError(400, "Nothing to save.");
      const { data, error } = await db.rpc("builder_rec_save", { p: { clinic_id: b.clinicId, actor: userId, object: b.object, id: b.id ?? null, values: b.values } });
      if (error) throwRpc(error);
      return data;
    }
    if (b.action === "delete") {
      if (typeof b.id !== "string") throw new HttpError(400, "id is required.");
      const { data, error } = await db.rpc("builder_rec_delete", { p_clinic: b.clinicId, p_actor: userId, p_object: b.object, p_id: b.id });
      if (error) throwRpc(error);
      return data;
    }
    throw new HttpError(400, "Unknown action.");
  });
}
