"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { firstRunTarget } from "@/lib/flow";
import ToastHost from "@/components/ToastHost";
import GlobalSearch from "@/components/GlobalSearch";
import AssistantWidget from "@/components/AssistantWidget";
import Sidebar from "./Sidebar";
import { getSession, getActiveClinicId } from "@/lib/auth";
import { getClinic, getMyRoleInClinic } from "@/lib/clinic";
import { applyBrand, applyIdentity } from "@/lib/theme";
import type { Clinic, ClinicRole } from "@/types";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const guided = useRef(false);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [role, setRole] = useState<ClinicRole | null>(null);
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);

  useEffect(() => {
    // Show the last known clinic/role instantly (so moving between pages does not flash "Loading…"),
    // then confirm with the server and correct it if anything changed (e.g. a role was changed).
    const clinicId = getActiveClinicId();
    let fresh = false;     // confirmed with the server in the last few minutes: no need to ask again on every page change
    try {
      const raw = clinicId ? sessionStorage.getItem("mf_shell_" + clinicId) : null;
      if (raw) { const c = JSON.parse(raw); applyBrand(c.clinic?.primary_color); setClinic(c.clinic); setRole(c.role); setEmail(c.email); setReady(true); fresh = Date.now() - (c.t ?? 0) < 5 * 60_000; }
    } catch { /* cache is optional */ }

    async function init() {
      const session = await getSession();
      if (!session) { router.push("/login"); return; }
      if (!clinicId) { router.push("/login"); return; }
      if (fresh) return;     // the session check above is local; the three server round trips below are skipped

      const [c, r] = await Promise.all([
        getClinic(clinicId),
        getMyRoleInClinic(clinicId),
      ]);
      if (!c || !r) { try { sessionStorage.removeItem("mf_shell_" + clinicId); } catch { /* ignore */ } router.push("/login"); return; }

      applyBrand(c.primary_color); applyIdentity(c.brand_name ?? c.name, c.logo_url);
      setClinic(c);
      setRole(r as ClinicRole);
      setEmail(session.user.email ?? "");
      setReady(true);
      try { sessionStorage.setItem("mf_shell_" + clinicId, JSON.stringify({ clinic: c, role: r, email: session.user.email ?? "", t: Date.now() })); } catch { /* ignore */ }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new clinic is guided: setup first, then its first appointment. Only when an admin lands on the dashboard, and never again once done.
  useEffect(() => {
    if (!ready || role !== "admin" || pathname !== "/dashboard" || guided.current) return;
    guided.current = true;
    const id = getActiveClinicId();
    if (id) firstRunTarget(id).then((to) => { if (to) router.replace(to); });
  }, [ready, role, pathname, router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        open={menu}
        onClose={closeMenu}
        clinicName={clinic?.brand_name ?? clinic?.name ?? "Clinic"}
        userEmail={email}
        role={role ?? undefined}
        logoUrl={clinic?.logo_url}
        brandColor={clinic?.primary_color}
      />
      <div className="flex-1 min-w-0 lg:ml-[var(--sidebar-w,240px)]">
        {/* Phone top bar: menu button + clinic name */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-3 h-14 bg-slate-900 text-white">
          <button onClick={() => setMenu(true)} aria-label="Open menu" aria-controls="app-menu" aria-expanded={menu} className="w-10 h-10 -ml-1 flex items-center justify-center rounded-lg hover:bg-slate-800 text-2xl">☰</button>
          <p className="font-semibold text-sm truncate flex-1">{clinic?.brand_name ?? clinic?.name ?? "Clinic"}</p>
          <button onClick={() => window.dispatchEvent(new Event("mf:search"))} aria-label="Search" className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-800 text-lg">🔍</button>
        </header>
        <main className="min-h-screen overflow-x-hidden">
          {children}
        </main>
      </div>
      <GlobalSearch role={role ?? undefined} />
      <ToastHost />
      <AssistantWidget botName={clinic?.ai_name || "Assistant"} color={clinic?.primary_color} />
    </div>
  );
}
