import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { HttpError } from "./http";

export type Role = "admin" | "doctor" | "intern" | "nurse" | "receptionist";
export const ALL_ROLES: Role[] = ["admin", "doctor", "intern", "nurse", "receptionist"];

/**
 * Verifies the bearer token and that the caller is an active member of the clinic
 * with one of the allowed roles. API routes use the service-role client, so this
 * check is what keeps one clinic's staff out of another clinic's data.
 */
// Who is signed in and which role they hold changes rarely, so a verified answer is remembered for 30 seconds.
// This skips two database round trips on every save after the first. A removed member loses access within 30 seconds.
const MEMBER_TTL_MS = 30_000;
const memberCache = new Map<string, { until: number; userId: string; role: Role }>();

export async function requireClinicMember(req: NextRequest, clinicId: unknown, roles: Role[] = ALL_ROLES) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Please sign in again.");
  if (typeof clinicId !== "string" || !/^[0-9a-f-]{36}$/i.test(clinicId)) throw new HttpError(400, "clinicId is required.");

  const db = createAdminClient();
  const key = token.slice(-40) + "|" + clinicId;
  const hit = memberCache.get(key);
  if (hit && hit.until > Date.now()) {
    if (!roles.includes(hit.role)) throw new HttpError(403, `Your role (${hit.role}) cannot do this.`);
    return { db, userId: hit.userId, role: hit.role };
  }
  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u?.user) throw new HttpError(401, "Your session has expired. Please sign in again.");

  const { data: m } = await db.from("clinic_staff").select("role, is_active")
    .eq("clinic_id", clinicId).eq("user_id", u.user.id).maybeSingle();
  if (!m || !m.is_active) throw new HttpError(403, "You do not belong to this clinic.");
  if (!roles.includes(m.role)) throw new HttpError(403, `Your role (${m.role}) cannot do this.`);
  if (memberCache.size > 500) memberCache.clear();
  memberCache.set(key, { until: Date.now() + MEMBER_TTL_MS, userId: u.user.id as string, role: m.role as Role });
  return { db, userId: u.user.id as string, role: m.role as Role };
}
