import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
type Card = { label: string; value: string | number; hint?: string; href?: string };
const inr = (n: unknown) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** The home screen of one app: a few headline numbers, and (for custom apps) the app's home dashboard. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const clinicId = req.nextUrl.searchParams.get("clinicId");
    const app = req.nextUrl.searchParams.get("app") ?? "";
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(app)) throw new HttpError(400, "Choose an app.");
    const { db, userId, role } = await requireClinicMember(req, clinicId);
    const { data: apps } = await db.rpc("apps_for_user", { p_clinic: clinicId, p_user: userId });
    const meta = (apps ?? []).find((a: any) => a.api_name === app);
    if (!meta) throw new HttpError(404, "That app is not available to you.");
    const cards: Card[] = []; const widgets: any[] = [];
    const count = async (table: string, f: (q: any) => any) => { const { count: n } = await f(db.from(table).select("id", { count: "exact", head: true }).eq("clinic_id", clinicId)); return n ?? 0; };
    const money = role !== "intern";
    const { data: st } = await db.rpc("dashboard_stats", { p_clinic: clinicId, p_actor: userId });
    const k: any = st ?? {};
    if (app === "sys_booking") cards.push({ label: "Appointments today", value: k.appointments_today ?? 0, href: "/appointments" }, { label: "Completed today", value: k.completed_today ?? 0 }, { label: "Patients", value: k.total_patients ?? 0, href: "/patients" }, { label: "No-shows (30 days)", value: `${k.no_show_pct ?? 0}%`, hint: `${k.no_shows_30d ?? 0} missed` }, { label: "Doctor utilisation", value: `${k.utilisation_pct ?? 0}%`, href: "/calendar" });
    else if (app === "sys_payments") { if (money) cards.push({ label: "Collected today", value: inr(k.collected_today), hint: `of ${inr(k.billed_today)} billed`, href: "/billing" }, { label: "Outstanding dues", value: inr(k.outstanding), hint: `${k.outstanding_invoices ?? 0} unpaid invoices`, href: "/billing?filter=pending" }, { label: "Collection rate today", value: `${k.collection_rate ?? 0}%` }); }
    else if (app === "sys_inventory") {
      cards.push({ label: "Low stock items", value: k.low_stock ?? 0, hint: (k.low_stock_items ?? []).slice(0, 3).map((i: any) => i.name ?? i).join(", "), href: "/stock" },
        { label: "Open purchase orders", value: await count("purchase_orders", (q) => q.in("status", ["ordered", "partially_received"])), href: "/purchasing" },
        { label: "Unpaid supplier bills", value: await count("supplier_bills", (q) => q.neq("status", "paid")), href: "/purchasing?tab=bills" });
    } else if (app === "sys_clinical") {
      cards.push({ label: "Active treatment plans", value: await count("treatment_plans", (q) => q.eq("status", "active")), href: "/treatments" },
        { label: "Open tasks", value: await count("clinic_tasks", (q) => q.neq("status", "done")), href: "/tasks" });
    } else if (app === "sys_admin") {
      cards.push({ label: "Active staff", value: await count("clinic_staff", (q) => q.eq("is_active", true)), href: "/users" },
        { label: "Leave requests waiting", value: await count("staff_leaves", (q) => q.eq("status", "pending")), href: "/leave" });
    } else if (app === "sys_builder") {
      cards.push({ label: "Reports", value: await count("saved_reports", (q) => q), href: "/builder/reports" }, { label: "Dashboards", value: await count("saved_dashboards", (q) => q) },
        { label: "Automation flows", value: await count("flows", (q) => q.eq("is_active", true)), hint: "turned on", href: "/builder/flows" });
    } else {
      // a custom app: how many records in each table, then its home dashboard
      for (const t of meta.tabs.filter((t: any) => t.kind === "object" && t.object)) {
        const { data } = await db.rpc("builder_rec_list", { p: { clinic_id: clinicId, actor: userId, object: t.object, filters: [], limit: 1, offset: 0 } });
        cards.push({ label: t.label, value: data?.total ?? 0, href: `/builder/data?table=${t.object}` });
      }
      if (meta.home_dashboard_id) {
        const { data: d } = await db.from("saved_dashboards").select("name, widgets").eq("id", meta.home_dashboard_id).eq("clinic_id", clinicId).maybeSingle();
        for (const w of ((d?.widgets ?? []) as { report_id: string; width?: number }[]).slice(0, 8)) {
          const { data: r } = await db.from("saved_reports").select("name, chart, spec").eq("id", w.report_id).eq("clinic_id", clinicId).maybeSingle();
          if (!r) continue;
          const { data: out, error } = await db.rpc("builder_query", { p_clinic: clinicId, p_actor: userId, p: r.spec });
          widgets.push({ name: r.name, chart: r.chart, width: w.width ?? 1, result: error ? null : out, error: error ? String(error.message).replace(/^[A-Z_]+:\s*/, "") : undefined });
        }
      }
    }
    return { app: { api_name: meta.api_name, label: meta.label, icon: meta.icon, description: meta.description, is_system: meta.is_system }, tabs: meta.tabs, cards, widgets };
  });
}
