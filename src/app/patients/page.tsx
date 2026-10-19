"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { getClinicPatients, upsertClinicPatient } from "@/lib/clinic";
import type { ClinicPatient } from "@/types";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const EMPTY: Partial<ClinicPatient> = {
  name: "", phone: "", dob: "", gender: "", blood_group: "",
  allergies: "", conditions: "", medications: "", address: "",
  emergency_contact_name: "", emergency_contact_phone: "",
};

export default function PatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [filtered, setFiltered] = useState<ClinicPatient[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [clinicId, setClinicId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Partial<ClinicPatient>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    setClinicId(id);
    load(id);
  }, [router]);

  async function load(id: string) {
    setLoading(true);
    const data = await getClinicPatients(id);
    setPatients(data);
    setFiltered(data);
    setLoading(false);
  }

  function handleSearch(q: string) {
    setSearch(q);
    const lq = q.toLowerCase();
    setFiltered(patients.filter(p =>
      p.name.toLowerCase().includes(lq) ||
      (p.phone && p.phone.includes(q))
    ));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing.name?.trim()) { setErr("Name is required"); return; }
    setSaving(true); setErr("");
    const { error } = await upsertClinicPatient(clinicId, editing);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setShowForm(false);
    setEditing(EMPTY);
    load(clinicId);
  }

  function openEdit(p: ClinicPatient) {
    setEditing(p);
    setShowForm(true);
    setErr("");
  }

  function openNew() {
    setEditing(EMPTY);
    setShowForm(true);
    setErr("");
  }

  const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
            <p className="text-slate-500 text-sm mt-1">{patients.length} registered</p>
          </div>
          <button onClick={openNew} className="bg-sky-500 hover:bg-sky-600 text-white px-4 py-2 rounded-xl text-sm font-semibold">
            + New Patient
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search by name or phone…"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
        />

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <div className="text-4xl mb-3">👥</div>
              {search ? "No patients match your search" : "No patients yet — add the first one"}
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Phone</th>
                  <th className="px-5 py-3 text-left font-medium hidden md:table-cell">Blood Group</th>
                  <th className="px-5 py-3 text-left font-medium hidden lg:table-cell">Conditions</th>
                  <th className="px-5 py-3 text-left font-medium">Added</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{p.name}</td>
                    <td className="px-5 py-3 text-slate-500 font-mono text-xs">{p.phone || "—"}</td>
                    <td className="px-5 py-3 hidden md:table-cell">
                      {p.blood_group ? (
                        <span className="bg-red-50 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">{p.blood_group}</span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden lg:table-cell max-w-xs truncate">{p.conditions || "—"}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">{p.created_at ? new Date(p.created_at).toLocaleDateString("en-IN") : "—"}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => openEdit(p)} className="text-sky-500 hover:text-sky-700 text-xs font-medium">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>

      {/* Patient form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl my-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-900">{editing.id ? "Edit Patient" : "New Patient"}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-600 block mb-1">Full Name *</label>
                  <input value={editing.name ?? ""} onChange={(e) => setEditing(p => ({ ...p, name: e.target.value }))} className={inp} required />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Phone</label>
                  <input value={editing.phone ?? ""} onChange={(e) => setEditing(p => ({ ...p, phone: e.target.value }))} className={inp} placeholder="+91 98765 43210" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Date of Birth</label>
                  <input type="date" value={editing.dob ?? ""} onChange={(e) => setEditing(p => ({ ...p, dob: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Gender</label>
                  <select value={editing.gender ?? ""} onChange={(e) => setEditing(p => ({ ...p, gender: e.target.value }))} className={inp}>
                    <option value="">—</option>
                    <option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Blood Group</label>
                  <select value={editing.blood_group ?? ""} onChange={(e) => setEditing(p => ({ ...p, blood_group: e.target.value }))} className={inp}>
                    <option value="">—</option>
                    {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-600 block mb-1">Allergies</label>
                  <input value={editing.allergies ?? ""} onChange={(e) => setEditing(p => ({ ...p, allergies: e.target.value }))} className={inp} placeholder="e.g. Penicillin, peanuts" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Known Conditions</label>
                  <input value={editing.conditions ?? ""} onChange={(e) => setEditing(p => ({ ...p, conditions: e.target.value }))} className={inp} placeholder="e.g. Diabetes" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Current Medications</label>
                  <input value={editing.medications ?? ""} onChange={(e) => setEditing(p => ({ ...p, medications: e.target.value }))} className={inp} placeholder="e.g. Metformin 500mg" />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-slate-600 block mb-1">Address</label>
                  <input value={editing.address ?? ""} onChange={(e) => setEditing(p => ({ ...p, address: e.target.value }))} className={inp} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Emergency Contact</label>
                  <input value={editing.emergency_contact_name ?? ""} onChange={(e) => setEditing(p => ({ ...p, emergency_contact_name: e.target.value }))} className={inp} placeholder="Name" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Emergency Phone</label>
                  <input value={editing.emergency_contact_phone ?? ""} onChange={(e) => setEditing(p => ({ ...p, emergency_contact_phone: e.target.value }))} className={inp} placeholder="+91…" />
                </div>
              </div>
              {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              <button type="submit" disabled={saving} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors">
                {saving ? "Saving…" : "Save Patient"}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppShell>
  );
}
