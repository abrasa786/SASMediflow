"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { createBrowserClient } from "@/lib/supabase";

interface DoctorRevenue { name: string; revenue: number; appointments: number; }
interface DeptStat { name: string; count: number; }
interface MonthStat { month: string; revenue: number; appointments: number; }

const supabase = createBrowserClient() as any;

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalAppts, setTotalAppts] = useState(0);
  const [paidInvoices, setPaidInvoices] = useState(0);
  const [noShowCount, setNoShowCount] = useState(0);
  const [doctorRevenue, setDoctorRevenue] = useState<DoctorRevenue[]>([]);
  const [deptStats, setDeptStats] = useState<DeptStat[]>([]);
  const [monthStats, setMonthStats] = useState<MonthStat[]>([]);
  const [period, setPeriod] = useState<"week" | "month" | "year">("month");

  useEffect(() => { load(); }, [period]);

  async function load() {
    setLoading(true);
    const clinicId = getActiveClinicId();
    if (!clinicId) { setLoading(false); return; }

    const now = new Date();
    let fromDate: string;
    if (period === "week") {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      fromDate = d.toISOString().split("T")[0];
    } else if (period === "month") {
      fromDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    } else {
      fromDate = `${now.getFullYear()}-01-01`;
    }

    // Invoices in period
    const { data: invoices } = await supabase
      .from("invoices")
      .select("total, paid_amount, status, created_at")
      .eq("clinic_id", clinicId)
      .gte("created_at", fromDate);

    const paid = (invoices ?? []).filter((i: any) => i.status === "paid");
    setTotalRevenue(paid.reduce((s: number, i: any) => s + Number(i.paid_amount || 0), 0));
    setPaidInvoices(paid.length);

    // Appointments in period
    const { data: appts } = await supabase
      .from("appointments")
      .select("status, doctor_id, doctors(name, speciality, specialty)")
      .eq("clinic_id", clinicId)
      .gte("appointment_date", fromDate);

    const apptList = appts ?? [];
    setTotalAppts(apptList.length);
    setNoShowCount(apptList.filter((a: any) => a.status === "no_show").length);

    // Revenue by doctor — group by doctor name from appointments
    const drMap: Record<string, { revenue: number; appointments: number }> = {};
    for (const a of apptList) {
      const name = a.doctors?.name || "Unknown";
      if (!drMap[name]) drMap[name] = { revenue: 0, appointments: 0 };
      drMap[name].appointments++;
    }
    // Add revenue from invoices matching appointment doctors (approximate via paid invoices count)
    // For now distribute revenue proportionally across doctors
    const totalApptCount = apptList.length || 1;
    const rev = paid.reduce((s: number, i: any) => s + Number(i.paid_amount || 0), 0);
    for (const name in drMap) {
      drMap[name].revenue = Math.round((drMap[name].appointments / totalApptCount) * rev);
    }
    const drList = Object.entries(drMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
    setDoctorRevenue(drList);

    // Dept stats from doctor specialty
    const deptMap: Record<string, number> = {};
    for (const a of apptList) {
      const dept = a.doctors?.speciality || a.doctors?.specialty || "General";
      deptMap[dept] = (deptMap[dept] || 0) + 1;
    }
    setDeptStats(Object.entries(deptMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6));

    // Monthly trend (last 6 months)
    const months: MonthStat[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleString("default", { month: "short" });
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

      const { data: mInv } = await supabase
        .from("invoices")
        .select("paid_amount, status")
        .eq("clinic_id", clinicId)
        .gte("created_at", start)
        .lte("created_at", endStr + "T23:59:59");

      const { data: mAppts } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .gte("appointment_date", start)
        .lte("appointment_date", endStr);

      const mRev = (mInv ?? []).filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + Number(i.paid_amount || 0), 0);
      months.push({ month: label, revenue: mRev, appointments: (mAppts ?? []).length });
    }
    setMonthStats(months);

    setLoading(false);
  }

  const maxRev = Math.max(...doctorRevenue.map(d => d.revenue), 1);
  const maxDept = Math.max(...deptStats.map(d => d.count), 1);
  const maxMonthRev = Math.max(...monthStats.map(m => m.revenue), 1);
  const noShowRate = totalAppts > 0 ? ((noShowCount / totalAppts) * 100).toFixed(1) : "0.0";
  const avgPerInvoice = paidInvoices > 0 ? Math.round(totalRevenue / paidInvoices) : 0;

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" style={{ fontFamily: "Sora, Inter, sans-serif" }}>Analytics</h1>
            <p className="text-sm text-gray-500 mt-0.5">Revenue, appointments, and performance insights</p>
          </div>
          <div className="flex gap-2">
            {(["week", "month", "year"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${period === p ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {p === "week" ? "This Week" : p === "month" ? "This Month" : "This Year"}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                { label: "Total Revenue", value: `₹${totalRevenue >= 100000 ? (totalRevenue / 100000).toFixed(1) + "L" : totalRevenue >= 1000 ? Math.round(totalRevenue / 1000) + "K" : totalRevenue}`, sub: `${paidInvoices} paid invoices`, color: "from-blue-600 to-violet-600" },
                { label: "Appointments", value: totalAppts.toString(), sub: `${period === "week" ? "this week" : period === "month" ? "this month" : "this year"}`, color: "from-emerald-500 to-teal-600" },
                { label: "Avg per Invoice", value: `₹${avgPerInvoice >= 1000 ? Math.round(avgPerInvoice / 1000) + "K" : avgPerInvoice}`, sub: "per paid invoice", color: "from-amber-500 to-orange-600" },
                { label: "No-show Rate", value: `${noShowRate}%`, sub: `${noShowCount} no-shows`, color: noShowCount > 0 ? "from-red-500 to-rose-600" : "from-emerald-500 to-teal-600" },
              ].map((stat) => (
                <div key={stat.label} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative overflow-hidden">
                  <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${stat.color}`} />
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{stat.label}</div>
                  <div className="text-3xl font-extrabold text-gray-900 mb-1" style={{ fontFamily: "Sora, Inter, sans-serif" }}>{stat.value}</div>
                  <div className="text-xs text-gray-400">{stat.sub}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

              {/* Revenue Trend */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h2 className="font-bold text-gray-900 mb-4">Revenue — Last 6 Months</h2>
                {monthStats.length === 0 ? (
                  <div className="text-center text-gray-400 py-8 text-sm">No data yet</div>
                ) : (
                  <div className="space-y-3">
                    {monthStats.map((m) => (
                      <div key={m.month} className="flex items-center gap-3">
                        <div className="text-xs font-semibold text-gray-500 w-8">{m.month}</div>
                        <div className="flex-1 h-6 bg-gray-100 rounded-lg overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-lg transition-all duration-700"
                            style={{ width: `${maxMonthRev > 0 ? (m.revenue / maxMonthRev) * 100 : 0}%` }}
                          />
                        </div>
                        <div className="text-xs font-bold text-gray-700 w-16 text-right tabular-nums">
                          {m.revenue >= 1000 ? `₹${Math.round(m.revenue / 1000)}K` : `₹${m.revenue}`}
                        </div>
                        <div className="text-xs text-gray-400 w-10 text-right">{m.appointments} appts</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Appointments Trend */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h2 className="font-bold text-gray-900 mb-4">Appointments — Last 6 Months</h2>
                {monthStats.length === 0 ? (
                  <div className="text-center text-gray-400 py-8 text-sm">No data yet</div>
                ) : (
                  <div className="flex items-end gap-2 h-32">
                    {monthStats.map((m) => {
                      const maxA = Math.max(...monthStats.map(x => x.appointments), 1);
                      const heightPct = maxA > 0 ? (m.appointments / maxA) * 100 : 0;
                      return (
                        <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                          <div className="text-xs font-bold text-gray-600">{m.appointments}</div>
                          <div className="w-full rounded-t-lg bg-gradient-to-t from-emerald-500 to-teal-400 transition-all duration-700" style={{ height: `${heightPct}%`, minHeight: m.appointments > 0 ? "8px" : "0" }} />
                          <div className="text-xs text-gray-400">{m.month}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Revenue by Doctor */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h2 className="font-bold text-gray-900 mb-4">Revenue by Doctor</h2>
                {doctorRevenue.length === 0 ? (
                  <div className="text-center text-gray-400 py-8 text-sm">No appointment data yet</div>
                ) : (
                  <div className="space-y-4">
                    {doctorRevenue.map((d, i) => (
                      <div key={d.name}>
                        <div className="flex justify-between text-sm mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-white text-xs font-bold">{d.name[0]}</div>
                            <span className="font-medium text-gray-800">{d.name}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-bold text-gray-900">{d.revenue >= 100000 ? `₹${(d.revenue / 100000).toFixed(1)}L` : d.revenue >= 1000 ? `₹${Math.round(d.revenue / 1000)}K` : `₹${d.revenue}`}</span>
                            <span className="text-gray-400 text-xs ml-1">· {d.appointments} appts</span>
                          </div>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${(d.revenue / maxRev) * 100}%`,
                              background: `hsl(${240 + i * 20}, 80%, 55%)`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Appointments by Department */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h2 className="font-bold text-gray-900 mb-4">Appointments by Department</h2>
                {deptStats.length === 0 ? (
                  <div className="text-center text-gray-400 py-8 text-sm">No appointment data yet</div>
                ) : (
                  <div className="space-y-3">
                    {deptStats.map((d, i) => (
                      <div key={d.name} className="flex items-center gap-3">
                        <div className="text-sm text-gray-700 w-28 truncate font-medium">{d.name}</div>
                        <div className="flex-1 h-5 bg-gray-100 rounded-lg overflow-hidden">
                          <div
                            className="h-full rounded-lg transition-all duration-700"
                            style={{
                              width: `${(d.count / maxDept) * 100}%`,
                              background: `hsl(${160 + i * 25}, 65%, 45%)`,
                            }}
                          />
                        </div>
                        <div className="text-sm font-bold text-gray-700 w-8 text-right tabular-nums">{d.count}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
