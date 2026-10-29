"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, clearActiveClinicId, getActiveClinicId } from "@/lib/auth";
import { authFetch } from "@/lib/api";
import type { ClinicRole } from "@/types";

export const NAV = [
  { href: "/dashboard",    icon: "🏠", label: "Dashboard" },
  { href: "/setup",        icon: "🚀", label: "Setup", roles: ["admin"] as ClinicRole[] },
  { href: "/appointments", icon: "📅", label: "Appointments" },
  { href: "/appointments/list", icon: "📋", label: "All appointments" },
  { href: "/calendar",     icon: "🗓️", label: "Calendar" },
  { href: "/availability", icon: "⏰", label: "Availability", roles: ["admin", "doctor"] as ClinicRole[] },
  { href: "/patients",     icon: "👥", label: "Patients" },
  { href: "/lists/patients", icon: "📋", label: "All patients" },
  { href: "/recall",       icon: "📣", label: "Recall", roles: ["admin", "doctor", "nurse", "receptionist"] as ClinicRole[] },
  { href: "/treatments",   icon: "🦷", label: "Treatments", roles: ["admin", "doctor", "nurse", "receptionist"] as ClinicRole[] },
  { href: "/lists/treatments", icon: "📋", label: "All treatments" },
  { href: "/sittings", icon: "🪥", label: "Sittings", roles: ["admin", "doctor", "nurse", "receptionist"] as ClinicRole[] },
  { href: "/lists/sittings", icon: "📋", label: "All sittings" },
  { href: "/offers",       icon: "📨", label: "Offers", roles: ["admin", "doctor"] as ClinicRole[] },
  { href: "/lists/invoices", icon: "📃", label: "All bills" },
  { href: "/billing",      icon: "🧾", label: "Billing" },
  { href: "/lists/invoices", icon: "📋", label: "All bills" },
  { href: "/payments",     icon: "💳", label: "Payments", roles: ["admin", "doctor", "nurse", "receptionist"] as ClinicRole[] },
  { href: "/stock",        icon: "💊", label: "Stock" },
  { href: "/lists/stock", icon: "📋", label: "All stock" },
  { href: "/purchasing",  icon: "🚚", label: "Purchasing", roles: ["admin", "nurse", "receptionist"] as ClinicRole[] },
  { href: "/attendance",   icon: "🕘", label: "Attendance" },
  { href: "/leave",        icon: "🏖️", label: "Leave" },
  { href: "/tasks",        icon: "✅", label: "Tasks" },
  { href: "/lists/tasks", icon: "📋", label: "All tasks" },
  { href: "/analytics",   icon: "📊", label: "Analytics" },
  { href: "/import",       icon: "📥", label: "Import data", roles: ["admin"] as ClinicRole[] },
  { href: "/staff",        icon: "👤", label: "Staff",    roles: ["admin"] as ClinicRole[] },
  { href: "/users",        icon: "🔐", label: "Users" },
  { href: "/profile",      icon: "🙍", label: "My profile" },
  { href: "/chatbot",      icon: "🤖", label: "AI Assistant" },
  { href: "/builder",      icon: "🛠", label: "AI Builder", roles: ["admin"] as ClinicRole[] },
  { href: "/builder/reports", icon: "📈", label: "Reports" },
  { href: "/apps/manage", icon: "🧩", label: "App Manager", roles: ["admin"] as ClinicRole[] },
  { href: "/settings",     icon: "⚙️", label: "Settings", roles: ["admin"] as ClinicRole[] },
];

const ROLE_COLORS: Record<ClinicRole, string> = {
  admin:        "bg-purple-100 text-purple-700",
  doctor:       "bg-sky-100 text-sky-700",
  intern:       "bg-indigo-100 text-indigo-700",
  nurse:        "bg-emerald-100 text-emerald-700",
  receptionist: "bg-amber-100 text-amber-700",
};

interface Props {
  clinicName: string;
  userEmail: string;
  role?: ClinicRole;
  logoUrl?: string | null;
  brandColor?: string | null;
  /** Phone/tablet: the menu is a slide-out drawer. */
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ clinicName, userEmail, role, logoUrl, brandColor, open = false, onClose }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  interface AppTab { label: string; kind: string; path?: string | null; object?: string | null }
  interface AppInfo { api_name: string; label: string; icon?: string; is_system: boolean; tabs: AppTab[] }
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [cid, setCid] = useState("");
  const [mode, setMode] = useState("");        // "" = every screen (the classic menu); otherwise one app's tabs
  useEffect(() => {
    const id = getActiveClinicId(); if (!id) return;
    setCid(id);
    try { setMode(localStorage.getItem("mf_app_" + id) ?? ""); } catch { /* storage blocked */ }
    // the app list rarely changes: show the saved copy straight away and only ask the server again every few minutes,
    // or at once when the Builder has just added, changed or undone an app
    const fetchApps = () => authFetch(`/api/apps?clinicId=${id}`).then((r) => { setApps(r.apps ?? []); try { sessionStorage.setItem("mf_apps_" + id, JSON.stringify({ apps: r.apps ?? [], t: Date.now() })); } catch { /* optional */ } }).catch(() => setApps([]));
    let stale = true;
    try { const c = JSON.parse(sessionStorage.getItem("mf_apps_" + id) ?? "null"); if (c?.apps) { setApps(c.apps); stale = Date.now() - (c.t ?? 0) > 5 * 60_000; } } catch { /* optional */ }
    if (stale) fetchApps();
    window.addEventListener("mf:apps-changed", fetchApps);
    return () => window.removeEventListener("mf:apps-changed", fetchApps);
  }, []);
  function pick(v: string) { setMode(v); try { localStorage.setItem("mf_app_" + cid, v); } catch { /* ignore */ } const a = apps.find((x) => x.api_name === v); if (a) router.push(`/apps/${a.api_name}`); }
  const tabHref = (app: AppInfo, t: AppTab) => t.path || (t.kind === "object" && t.object ? `/builder/data?table=${t.object}` : `/apps/${app.api_name}`);
  const cur = apps.find((x) => x.api_name === mode);
  // Close the drawer after every navigation, and let Escape close it.
  useEffect(() => { onClose?.(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  async function handleLogout() {
    clearActiveClinicId();
    await signOut();
    router.push("/login");
  }

  const visibleNav = NAV.filter((n) => !n.roles || (role && n.roles.includes(role)));

  return (
    <>
    {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} aria-hidden="true" />}
    <aside
      id="app-menu"
      aria-label="Main menu"
      className={`fixed left-0 top-0 h-[100dvh] bg-slate-900 text-slate-300 flex flex-col z-50 w-[min(280px,85vw)] transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full invisible"}`}
    >
      {/* Clinic header */}
      <div className="px-4 py-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          {logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={logoUrl} alt="" className="w-8 h-8 rounded-lg bg-white object-contain shrink-0" />
            : <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">M</div>}
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{clinicName}</p>
            <p className="text-slate-500 text-xs">Mediflow Clinic</p>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="ml-auto text-slate-400 hover:text-white text-xl px-2 py-1">✕</button>
        </div>
      </div>

      {/* Search everything */}
      <div className="px-3 pt-3">
        <button onClick={() => { onClose?.(); window.dispatchEvent(new Event("mf:search")); }} aria-label="Search everything"
          className="w-full flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg px-3 py-2 border border-slate-700">
          <span aria-hidden>🔍</span><span className="flex-1 text-left">Search…</span><kbd className="text-[10px] border border-slate-600 rounded px-1 text-slate-400">Ctrl K</kbd>
        </button>
      </div>

      {/* App launcher */}
      {apps.length > 0 && (
        <div className="px-3 pt-3">
          <label className="sr-only" htmlFor="app-launcher">App launcher</label>
          <select id="app-launcher" value={cur ? mode : ""} onChange={(e) => pick(e.target.value)}
            className="w-full bg-slate-800 text-slate-200 text-base md:text-sm rounded-lg px-3 py-2 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500">
            <option value="">▦ All screens</option>
            {apps.map((a) => <option key={a.api_name} value={a.api_name}>{a.icon ?? "🧩"} {a.label}</option>)}
          </select>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {cur ? (
          <>
            <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">{cur.label}</p>
            {cur.tabs.map((t) => {
              const href = tabHref(cur, t);
              const active = pathname === href.split("?")[0] && (typeof window === "undefined" || !href.includes("?") || href.split("?")[1] === window.location.search.slice(1));
              return (
                <Link key={t.label + href} href={href} style={active && brandColor ? { background: brandColor } : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? `${brandColor ? "" : "bg-sky-500 "}text-white shadow-sm` : "text-slate-400 hover:text-white hover:bg-slate-800"}`}>
                  {t.label}
                </Link>
              );
            })}
            {role === "admin" && <Link href="/apps/manage" className="block px-3 py-2 mt-2 text-xs text-slate-500 hover:text-white">🧩 Manage apps &amp; access</Link>}
          </>
        ) : (
          <>
            {visibleNav.map((item) => {
              const active = pathname === item.href || (item.href !== "/builder" && pathname.startsWith(item.href + "/"));
              return (
                <Link key={item.href} href={item.href} style={active && brandColor ? { background: brandColor } : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${active ? `${brandColor ? "" : "bg-sky-500 "}text-white shadow-sm` : "text-slate-400 hover:text-white hover:bg-slate-800"}`}>
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
            {apps.some((a) => !a.is_system) && (
              <div className="pt-3 mt-2 border-t border-slate-800">
                <p className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">Your apps</p>
                {apps.filter((a) => !a.is_system).map((a) => (
                  <Link key={a.api_name} href={`/apps/${a.api_name}`} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800">
                    <span className="text-base">{a.icon ?? "🧩"}</span>{a.label}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
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
    </>
  );
}
