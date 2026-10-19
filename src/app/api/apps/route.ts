import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";
const ROLES = ["admin", "doctor", "nurse", "receptionist", "intern"];

/** The apps and tabs this person may see. Built-in apps (Booking, Payments, Inventory…) are created for the clinic on first use. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const { data, error } = await db.rpc("apps_for_user", { p_clinic: clinicId, p_user: userId });
    if (error) { if (/apps_for_user|does not exist|Could not find/.test(error.message)) throw new HttpError(500, "The App Manager is not installed yet. Run supabase/migrations/014_app_manager.sql in the Supabase SQL editor."); throwRpc(error); }
    let sets: any[] = [];
    if (role === "admin") sets = (await db.from("permission_sets").select("name").eq("clinic_id", clinicId).order("name")).data ?? [];
    return { apps: data ?? [], role, permissionSets: sets.map((s) => s.name), roles: ROLES };
  });
}

/** Admin: choose who can see an app or one of its tabs, or its home dashboard. Goes through the builder, so it is audited and can be undone. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId } = await requireClinicMember(req, b.clinicId, ["admin"]);
    if (typeof b.app !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(b.app)) throw new HttpError(400, "Choose an app.");
    const args: Record<string, unknown> = { app: b.app };
    if (typeof b.tab === "string" && b.tab) args.tab = b.tab.slice(0, 80);
    if (b.everyone === true) args.everyone = true;
    else {
      if (Array.isArray(b.roles) && b.roles.length) args.roles = b.roles.filter((r: unknown) => typeof r === "string" && ROLES.includes(r));
      if (Array.isArray(b.permissionSets) && b.permissionSets.length) args.permission_sets = b.permissionSets.filter((s: unknown) => typeof s === "string").slice(0, 10);
    }
    if (typeof b.homeDashboard === "string" && b.homeDashboard) args.home_dashboard = b.homeDashboard.slice(0, 80);
    const { data, error } = await db.rpc("builder_apply_plan", { p_clinic: b.clinicId, p_actor: userId, p_prompt: `Change who can see ${b.app}${args.tab ? " / " + args.tab : ""}`, p_plan: { steps: [{ tool: "configure_app", args }] } });
    if (error) throwRpc(error);
    return { ok: true, changeset: data };
  });
}
