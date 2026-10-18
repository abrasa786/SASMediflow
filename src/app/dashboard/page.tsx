"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
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
