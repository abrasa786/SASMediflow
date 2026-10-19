import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { throwRpc } from "@/lib/server/rpc";

export const dynamic = "force-dynamic";

async function run(db: any, clinicId: string, userId: string, spec: any) {
  const { data, error } = await db.rpc("builder_query", { p_clinic: clinicId, p_actor: userId, p: spec });
  if (error) throwRpc(error);
  return data;
}
const cleanSpec = (s: any) => {
  if (!s || typeof s.object !== "string" || !/^[a-z][a-z0-9_]{0,40}$/.test(s.object)) throw new HttpError(400, "Choose a table for the report.");
  const arr = (x: any, n: number) => (Array.isArray(x) ? x.slice(0, n) : []);
  return {
    object: s.object, kind: s.kind === "number" ? "number" : undefined,
    columns: arr(s.columns, 20).filter((c: any) => typeof c === "string"),
    filters: arr(s.filters, 10).map((f: any) => ({ field: String(f.field ?? ""), op: String(f.op ?? "eq"), value: f.value == null ? null : String(f.value) })),
    group_by: s.group_by ? String(s.group_by) : undefined, bucket: s.bucket === "month" || s.bucket === "day" ? s.bucket : undefined,
    aggregate: ["count", "sum", "avg", "min", "max"].includes(s.aggregate) ? s.aggregate : "count", agg_field: s.agg_field ? String(s.agg_field) : undefined,
    limit: Math.min(Math.max(Number(s.limit) || 100, 1), 500),
  };
};

/** Saved reports and dashboards, plus the tables this person may report on. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const [r, d, t] = await Promise.all([
      db.from("saved_reports").select("*").eq("clinic_id", clinicId).order("name"),
      db.from("saved_dashboards").select("*").eq("clinic_id", clinicId).order("name"),
      db.rpc("builder_accessible", { p_clinic: clinicId, p_user: userId }),
    ]);
    const bad = [r, d, t].find((x: any) => x.error);
    if (bad) throw new HttpError(500, /does not exist|schema cache|builder_accessible/i.test(bad.error.message) ? "Reports are not installed yet. Run supabase/migrations/008_builder_access_and_reports.sql in the Supabase SQL editor." : bad.error.message);
    return { reports: r.data ?? [], dashboards: d.data ?? [], tables: t.data ?? [], canEdit: role === "admin" };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db, userId, role } = await requireClinicMember(req, b.clinicId);
    const needAdmin = () => { if (role !== "admin") throw new HttpError(403, "Only the admin can create or change reports and dashboards."); };

    if (b.action === "run") return await run(db, b.clinicId, userId, cleanSpec(b.spec));

    if (b.action === "run_dashboard") {
      const { data: d } = await db.from("saved_dashboards").select("*").eq("id", b.id).eq("clinic_id", b.clinicId).maybeSingle();
      if (!d) throw new HttpError(404, "That dashboard no longer exists.");
      const ids: string[] = (d.widgets ?? []).map((w: any) => w.report_id);
      const { data: reps } = ids.length ? await db.from("saved_reports").select("*").eq("clinic_id", b.clinicId).in("id", ids) : { data: [] };
      const out = [];
      for (const w of d.widgets ?? []) {
        const rep = (reps ?? []).find((x: any) => x.id === w.report_id);
        if (!rep) { out.push({ report_id: w.report_id, error: "This report was deleted." }); continue; }
        try { out.push({ report_id: rep.id, name: rep.name, chart: rep.chart, width: w.width ?? "half", result: await run(db, b.clinicId, userId, rep.spec) }); }
        catch (e: any) { out.push({ report_id: rep.id, name: rep.name, chart: rep.chart, width: w.width ?? "half", error: e.status === 403 ? "You do not have access to this data." : e.message }); }
      }
      return { dashboard: { id: d.id, name: d.name, description: d.description }, widgets: out };
    }

    needAdmin();
    if (b.action === "save_report") {
      const name = String(b.name ?? "").trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(400, "Give the report a name.");
      const spec = cleanSpec(b.spec);
      await run(db, b.clinicId, userId, { ...spec, limit: 1 }); // reject a broken report now, not when someone opens it
      const chart = ["table", "bar", "pie", "number"].includes(b.chart) ? b.chart : "table";
      if (b.id) {
        const { data, error } = await db.from("saved_reports").update({ name, description: b.description ?? null, spec, chart, updated_at: new Date().toISOString() }).eq("id", b.id).eq("clinic_id", b.clinicId).select("id").maybeSingle();
        if (error || !data) throw new HttpError(error ? 400 : 404, error?.message ?? "That report no longer exists.");
        return { id: data.id };
      }
      const { data, error } = await db.from("saved_reports").insert({ clinic_id: b.clinicId, name, description: b.description ?? null, spec, chart, created_by: userId }).select("id").single();
      if (error) throw new HttpError(400, error.message);
      return { id: data.id };
    }
    if (b.action === "delete_report") {
      const { error } = await db.from("saved_reports").delete().eq("id", b.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      // drop it from dashboards so nothing points at a deleted report
      const { data: ds } = await db.from("saved_dashboards").select("id,widgets").eq("clinic_id", b.clinicId);
      for (const d of ds ?? []) if ((d.widgets ?? []).some((w: any) => w.report_id === b.id)) await db.from("saved_dashboards").update({ widgets: d.widgets.filter((w: any) => w.report_id !== b.id) }).eq("id", d.id);
      return { ok: true };
    }
    if (b.action === "save_dashboard") {
      const name = String(b.name ?? "").trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(400, "Give the dashboard a name.");
      const widgets = (Array.isArray(b.widgets) ? b.widgets : []).slice(0, 12).map((w: any) => ({ report_id: String(w.report_id), width: w.width === "full" ? "full" : "half" }));
      if (widgets.length) {
        const { data: ok } = await db.from("saved_reports").select("id").eq("clinic_id", b.clinicId).in("id", widgets.map((w: any) => w.report_id));
        if ((ok ?? []).length !== new Set(widgets.map((w: any) => w.report_id)).size) throw new HttpError(400, "One of the reports does not exist.");
      }
      if (b.id) {
        const { data, error } = await db.from("saved_dashboards").update({ name, description: b.description ?? null, widgets, updated_at: new Date().toISOString() }).eq("id", b.id).eq("clinic_id", b.clinicId).select("id").maybeSingle();
        if (error || !data) throw new HttpError(error ? 400 : 404, error?.message ?? "That dashboard no longer exists.");
        return { id: data.id };
      }
      const { data, error } = await db.from("saved_dashboards").insert({ clinic_id: b.clinicId, name, description: b.description ?? null, widgets, created_by: userId }).select("id").single();
      if (error) throw new HttpError(400, error.message);
      return { id: data.id };
    }
    if (b.action === "delete_dashboard") {
      const { error } = await db.from("saved_dashboards").delete().eq("id", b.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }
    throw new HttpError(400, "Unknown action.");
  });
}
