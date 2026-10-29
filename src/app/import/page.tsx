"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import PatientImport from "@/components/PatientImport";
import { getActiveClinicId } from "@/lib/auth";
import { getMyRoleInClinic } from "@/lib/clinic";

export default function ImportPage() {
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { const id = getActiveClinicId(); setClinicId(id); if (id) getMyRoleInClinic(id).then((r) => setRole(r as string)); }, []);
  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Import data</h1>
        <p className="text-slate-500 text-sm mt-1 mb-5">Bring your patients from Practo or another app.</p>
        {role && role !== "admin" ? <p className="text-sm text-amber-800 bg-amber-50 rounded-xl px-4 py-3">Only the clinic admin can import data.</p>
          : clinicId ? <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5"><PatientImport clinicId={clinicId} /></div> : null}
      </div>
    </AppShell>
  );
}
