"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, clearActiveClinicId } from "@/lib/auth";
import type { ClinicRole } from "@/types";

const NAV = [
  { href: "/dashboard",    icon: "🏠", label: "Dashboard" },
  { href: "/appointments", icon: "📅", label: "Appointments" },
  { href: "/patients",     icon: "👥", label: "Patients" },
  { href: "/billing",      icon: "🧾", label: "Billing" },
  { href: "/stock",        icon: "💊", label: "Stock" },
  { href: "/tasks",        icon: "✅", label: "Tasks" },
  { href: "/analytics",   icon: "📊", label: "Analytics" },
  { href: "/staff",        icon: "👤", label: "Staff",    roles: ["admin"] as ClinicRole[] },
  { href: "/chatbot",      icon: "🤖", label: "AI Assistant" },
  { href: "/settings",     icon: "⚙️", label: "Settings", roles: ["admin"] as ClinicRole[] },
];

const ROLE_COLORS: Record<ClinicRole, string> = {
  admin:        "bg-purple-100 text-purple-700",
  doctor:       "bg-sky-100 text-sky-700",
  nurse:        "bg-emerald-100 text-emerald-700",
  receptionist: "bg-amber-100 text-amber-700",
};

interface Props {
  clinicName: string;
  userEmail: string;
  role?: ClinicRole;
}

export default function Sidebar({ clinicName, userEmail, role }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    clearActiveClinicId();
    await signOut();
    router.push("/login");
  }

  const visibleNav = NAV.filter((n) => !n.roles || (role && n.roles.includes(role)));

  return (
    <aside
      className="fixed left-0 top-0 h-screen bg-slate-900 text-slate-300 flex flex-col z-40"
      style={{ width: "var(--sidebar-w, 240px)" }}
    >
      {/* Clinic header */}
      <div className="px-4 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
            M
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{clinicName}</p>
            <p className="text-slate-500 text-xs">Mediflow Clinic</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {visibleNav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-sky-500 text-white shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="px-4 py-4 border-t border-slate-800">
        <div className="mb-3">
          <p className="text-xs text-slate-400 truncate">{userEmail}</p>
          {role && (
            <span className={`inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${ROLE_COLORS[role]}`}>
              {role}
            </span>
          )}
        </div>
        <button
          onClick={handleLogout}
          className="w-full text-left text-xs text-slate-500 hover:text-red-400 transition-colors py-1"
        >
          Sign out →
        </button>
      </div>
    </aside>
  );
}
