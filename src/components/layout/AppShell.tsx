"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AssistantWidget from "@/components/AssistantWidget";
import Sidebar from "./Sidebar";
import { getSession, getActiveClinicId } from "@/lib/auth";
import { getClinic, getMyRoleInClinic } from "@/lib/clinic";
import { applyBrand, applyIdentity } from "@/lib/theme";
import type { Clinic, ClinicRole } from "@/types";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [role, setRole] = useState<ClinicRole | null>(null);
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Show the last known clinic/role instantly (so moving between pages does not flash "Loading…"),
    // then confirm with the server and correct it if anything changed (e.g. a role was changed).
    const clinicId = getActiveClinicId();
    try {
      const raw = clinicId ? sessionStorage.getItem("mf_shell_" + clinicId) : null;
      if (raw) { const c = JSON.parse(raw); applyBrand(c.clinic?.primary_color); setClinic(c.clinic); setRole(c.role); setEmail(c.email); setReady(true); }
    } catch { /* cache is optional */ }

    async function init() {
      const session = await getSession();
      if (!session) { router.push("/login"); return; }
      if (!clinicId) { router.push("/login"); return; }

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
      try { sessionStorage.setItem("mf_shell_" + clinicId, JSON.stringify({ clinic: c, role: r, email: session.user.email ?? "" })); } catch { /* ignore */ }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        clinicName={clinic?.brand_name ?? clinic?.name ?? "Clinic"}
        userEmail={email}
        role={role ?? undefined}
        logoUrl={clinic?.logo_url}
        brandColor={clinic?.primary_color}
      />
      <main className="flex-1 min-h-screen overflow-y-auto" style={{ marginLeft: "var(--sidebar-w, 240px)" }}>
        {children}
      </main>
      <AssistantWidget botName={clinic?.ai_name || "Assistant"} color={clinic?.primary_color} />
    </div>
  );
}
