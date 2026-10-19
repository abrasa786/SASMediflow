"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId } from "@/lib/auth";
import { getClinic, getMyRoleInClinic } from "@/lib/clinic";
import { supabase } from "@/lib/supabase";
import PriceListEditor from "@/components/PriceListEditor";
import BrandingCard from "@/components/BrandingCard";
import AiPrivacyCard from "@/components/AiPrivacyCard";
import OnlineBookingCard from "@/components/OnlineBookingCard";
import type { Clinic, ClinicRole } from "@/types";

const SPECIALTIES = [
  "General Practice", "Dentistry", "Cardiology", "Dermatology",
  "Gynaecology", "Orthopaedics", "Paediatrics", "Ophthalmology",
  "ENT", "Neurology", "Psychiatry", "Oncology", "Other",
];

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

export default function SettingsPage() {
  const router = useRouter();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [myRole, setMyRole] = useState<ClinicRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // Form fields
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [openDays, setOpenDays] = useState<string[]>([]);
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("18:00");
  const [website, setWebsite] = useState("");
  const [gst, setGst] = useState("");

  useEffect(() => {
    const id = getActiveClinicId();
    if (!id) { router.push("/login"); return; }
    async function load() {
      const [c, r] = await Promise.all([getClinic(id!), getMyRoleInClinic(id!)]);
      if (!c) { router.push("/login"); return; }
      setClinic(c);
      setMyRole(r as ClinicRole);
      // Populate form
      setName(c.name ?? "");
      setBrandName(c.brand_name ?? "");
      setSpecialty(c.specialty ?? "");
      setPhone(c.phone ?? "");
      setEmail(c.email ?? "");
      setAddress(c.address ?? "");
      setCity(c.city ?? "");
      setState(c.state ?? "");
      setOpenDays(c.working_hours?.days ?? []);
      setOpenTime(c.working_hours?.open ?? "09:00");
      setCloseTime(c.working_hours?.close ?? "18:00");
      setWebsite(c.website ?? "");
      setGst(c.gst_number ?? "");
    }
    load();
  }, [router]);

  function toggleDay(day: string) {
    setOpenDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!clinic) return;
    setSaving(true); setErr(""); setSaved(false);
    const { error } = await (supabase as any).from("clinics").update({
      name, brand_name: brandName, specialty, phone, email, address, city, state,
      website, gst_number: gst,
      working_hours: { days: openDays, open: openTime, close: closeTime },
    }).eq("id", clinic.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const isAdmin = myRole === "admin";
  const inp = `w-full px-3 py-2.5 rounded-xl border text-sm focus:outline-none ${isAdmin ? "border-slate-200 focus:ring-2 focus:ring-sky-500 bg-white" : "border-slate-100 bg-slate-50 cursor-not-allowed text-slate-500"}`;

  return (
    <AppShell>
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
            <p className="text-slate-500 text-sm mt-1">Clinic profile &amp; configuration</p>
          </div>
          {!isAdmin && (
            <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg font-medium">Admin only to edit</span>
          )}
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Basic info */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4 text-sm uppercase tracking-wide text-slate-500">Clinic Info</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Legal Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Brand Name</label>
                  <input value={brandName} onChange={e => setBrandName(e.target.value)} className={inp} placeholder="Display name" disabled={!isAdmin} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Specialty</label>
                <select value={specialty} onChange={e => setSpecialty(e.target.value)} className={inp} disabled={!isAdmin}>
                  <option value="">—</option>
                  {SPECIALTIES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4 text-sm uppercase tracking-wide text-slate-500">Contact</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Phone</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Email</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Address</label>
                <input value={address} onChange={e => setAddress(e.target.value)} className={inp} disabled={!isAdmin} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">City</label>
                  <input value={city} onChange={e => setCity(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">State</label>
                  <input value={state} onChange={e => setState(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Website</label>
                <input value={website} onChange={e => setWebsite(e.target.value)} className={inp} placeholder="https://…" disabled={!isAdmin} />
              </div>
            </div>
          </div>

          {/* Working hours */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold mb-4 text-sm uppercase tracking-wide text-slate-500">Working Hours</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-2">Open Days</label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map(d => (
                    <button
                      key={d}
                      type="button"
                      disabled={!isAdmin}
                      onClick={() => isAdmin && toggleDay(d)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${openDays.includes(d) ? "bg-sky-500 text-white" : "bg-slate-100 text-slate-500"} ${!isAdmin ? "cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Opens at</label>
                  <input type="time" value={openTime} onChange={e => setOpenTime(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Closes at</label>
                  <input type="time" value={closeTime} onChange={e => setCloseTime(e.target.value)} className={inp} disabled={!isAdmin} />
                </div>
              </div>
            </div>
          </div>

          {/* Billing */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h2 className="font-semibold mb-4 text-sm uppercase tracking-wide text-slate-500">Billing</h2>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">GST Number</label>
              <input value={gst} onChange={e => setGst(e.target.value)} className={inp} placeholder="22ABCDE1234F1Z5" disabled={!isAdmin} />
            </div>
          </div>

          {isAdmin && (
            <>
              {err && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              {saved && <p className="text-xs text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">✅ Settings saved successfully!</p>}
              <button type="submit" disabled={saving} className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl text-sm font-semibold">
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </>
          )}
        </form>

        {isAdmin && clinic?.id && <BrandingCard clinicId={clinic.id} />}
        {isAdmin && clinic?.id && <OnlineBookingCard clinicId={clinic.id} />}
        {isAdmin && clinic?.id && <AiPrivacyCard clinicId={clinic.id} />}
        <PriceListEditor clinicId={clinic?.id ?? null} canEdit={isAdmin} />
      </div>
    </AppShell>
  );
}
