"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import SetupBanner from "@/components/SetupBanner";
import { getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import { getDashboardStats, getAppointments, todayIso } from "@/lib/clinic";
import type { DashboardStats, Appointment } from "@/types";

const STATUS_COLORS = {
  confirmed: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-700",
  no_show:   "bg-gray-100 text-gray-500",
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [k, setK] = useState<any>(null);       // the full dashboard maths from /api/dashboard (migration 012)

  useEffect(() => {
    const clinicId = getActiveClinicId();
    if (!clinicId) { router.push("/login"); return; }

    async function load() {
      try {
        const [s, appts] = await Promise.all([
          getDashboardStats(clinicId!),
          getAppointments(clinicId!, todayIso()),
        ]);
        setStats(s);
        setAppointments(appts);
      } finally {
        setLoading(false);
      }
    }
    load();
    authFetch(`/api/dashboard?clinicId=${clinicId}`).then((r) => setK(r.stats)).catch(() => setK(null));
  }, [router]);

  const now = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">{now}</p>
        </div>

        {typeof window !== "undefined" && getActiveClinicId() && <SetupBanner clinicId={getActiveClinicId()!} />}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-slate-100 h-24 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {[
                { label: "Today's Appointments", value: stats?.todayAppointments ?? 0, icon: "📅", color: "from-sky-500 to-sky-600" },
                { label: "Completed", value: stats?.completedToday ?? 0, icon: "✅", color: "from-emerald-500 to-emerald-600" },
                { label: "Total Patients", value: stats?.totalPatients ?? 0, icon: "👥", color: "from-indigo-500 to-indigo-600" },
                { label: "Low Stock Items", value: stats?.lowStockCount ?? 0, icon: "⚠️", color: "from-amber-500 to-amber-600" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                  <div className="text-2xl mb-2">{s.icon}</div>
                  <div className="text-2xl font-bold text-slate-900">{s.value}</div>
                  <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                </div>
              ))}
            </div>


            {/* Clinic health: collected vs billed, dues, utilisation, no-shows, 7-day trend, doctor load, low stock */}
            {k && (
              <div className="mb-8 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    k.collected_today != null && { label: "Collected today", value: "₹" + Math.round(k.collected_today).toLocaleString("en-IN"), sub: `of ₹${Math.round(k.billed_today).toLocaleString("en-IN")} billed · ${k.collection_rate ?? 0}%` },
                    k.outstanding != null && { label: "Outstanding dues", value: "₹" + Math.round(k.outstanding).toLocaleString("en-IN"), sub: `${k.outstanding_invoices} unpaid invoice${k.outstanding_invoices === 1 ? "" : "s"}` },
                    { label: "Doctor utilisation", value: `${k.utilisation_pct ?? 0}%`, sub: `${k.booked_minutes} of ${k.available_minutes} min booked` },
                    { label: "No-shows (30 days)", value: `${k.no_show_pct ?? 0}%`, sub: `${k.no_shows_30d} missed visit${k.no_shows_30d === 1 ? "" : "s"}` },
                  ].filter(Boolean).map((c: any) => (
                    <div key={c.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                      <div className="text-xs text-slate-500">{c.label}</div>
                      <div className="text-2xl font-bold text-slate-900 mt-1">{c.value}</div>
                      <div className="text-xs text-slate-400 mt-1">{c.sub}</div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {Array.isArray(k.trend) && k.trend.length > 0 && (
                    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                      <h3 className="font-semibold text-slate-900 text-sm mb-3">Collected, last 7 days</h3>
                      <div className="flex items-end gap-2 h-24">
                        {(() => { const max = Math.max(1, ...k.trend.map((t: any) => Number(t.collected) || 0)); return k.trend.map((t: any) => (
                          <div key={t.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${t.day}: ₹${Math.round(t.collected).toLocaleString("en-IN")}`}>
                            <div className="w-full rounded-t bg-sky-400" style={{ height: `${Math.max(3, (Number(t.collected) / max) * 100)}%` }} />
                            <span className="text-[10px] text-slate-400 mt-1">{String(t.day).slice(8)}</span>
                          </div>)); })()}
                      </div>
                    </div>
                  )}
                  {Array.isArray(k.doctors) && k.doctors.length > 0 && (
                    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                      <h3 className="font-semibold text-slate-900 text-sm mb-3">Doctor load today</h3>
                      <ul className="space-y-2">
                        {k.doctors.map((d: any) => (
                          <li key={d.name} className="text-sm flex items-center justify-between gap-3">
                            <span className="truncate text-slate-700">{d.name}</span>
                            <span className="text-xs text-slate-500 shrink-0">{d.appointments} appt · {d.minutes} min</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                {Array.isArray(k.low_stock_items) && k.low_stock_items.length > 0 && (
                  <p className="text-xs text-amber-700">Low on: {k.low_stock_items.map((i: any) => i.name ?? i).slice(0, 6).join(", ")}</p>
                )}
              </div>
            )}

            {/* Low stock alert */}
            {(stats?.lowStockCount ?? 0) > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 flex items-center gap-3">
                <span className="text-amber-600">⚠️</span>
                <p className="text-amber-800 text-sm font-medium">
                  {stats?.lowStockCount} item{stats!.lowStockCount > 1 ? "s are" : " is"} running low.{" "}
                  <a href="/stock" className="underline">Check stock →</a>
                </p>
              </div>
            )}

            {/* Today's schedule */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-900">Today&apos;s Schedule</h2>
                <a href="/appointments" className="text-sky-500 text-sm font-medium hover:text-sky-600">View all →</a>
              </div>
              {appointments.length === 0 ? (
                <div className="px-6 py-12 text-center text-slate-400 text-sm">No appointments today</div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {appointments.map((appt) => (
                    <div key={appt.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="w-16 text-xs font-mono text-slate-500 shrink-0">{appt.appointment_time}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm truncate">{appt.patient?.name ?? "—"}</p>
                        <p className="text-xs text-slate-500 truncate">{appt.doctor_name} · {appt.symptoms || "Check-up"}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-medium text-slate-600">₹{appt.consultation_fee}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-500"}`}>
                          {appt.status.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
