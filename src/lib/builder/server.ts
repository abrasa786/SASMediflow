import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import type { Schema } from "./types";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Verifies the bearer token and that the caller is an active admin of the clinic. */
export async function requireClinicAdmin(req: NextRequest, clinicId: unknown) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  if (typeof clinicId !== "string" || !/^[0-9a-f-]{36}$/i.test(clinicId)) throw new HttpError(400, "clinicId is required.");

  const db = createAdminClient();
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u?.user) throw new HttpError(401, "Your session has expired. Please sign in again.");

  const { data: m } = await db.from("clinic_staff").select("role, is_active")
    .eq("clinic_id", clinicId).eq("user_id", u.user.id).maybeSingle();
  if (!m || !m.is_active) throw new HttpError(403, "You do not belong to this clinic.");
  if (m.role !== "admin") throw new HttpError(403, "Only clinic admins can use the AI Builder.");

  const { data: clinic } = await db.from("clinics").select("specialty").eq("id", clinicId).maybeSingle();
  return { db, userId: u.user.id as string, specialty: (clinic?.specialty as string | undefined) ?? undefined };
}

export async function loadSchema(db: any, clinicId: string): Promise<Schema> {
  const { data, error } = await db.rpc("builder_get_schema", { p_clinic: clinicId });
  if (error) throw new HttpError(500, error.message.includes("builder_get_schema")
    ? "The builder tables are not installed yet. Run supabase/migrations/003_builder_engine.sql in the Supabase SQL editor."
    : error.message);
  return (data as Schema) ?? { objects: [], apps: [] };
}

export async function handle(fn: () => Promise<any>) {
  try { return NextResponse.json(await fn()); }
  catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("builder error:", e);
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status });
  }
}
