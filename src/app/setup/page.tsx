"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { firstRunTarget } from "@/lib/flow";
import { toast } from "@/lib/toast";
import AppShell from "@/components/layout/AppShell";
import { getActiveClinicId, getUser } from "@/lib/auth";
import { getSetupStatus, setSetupFlag, type SetupItem } from "@/lib/setup";
import { supabase } from "@/lib/supabase";

export default function SetupPage() {
  const [items, setItems] = useState<SetupItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const router = useRouter();
  const clinicId = typeof window !== "undefined" ? getActiveClinicId() : null;

  const load = useCallback(async () => {
    if (!clinicId) return;
    const r = await getSetupStatus(clinicId);
    setItems(r.items); setDismissed(r.dismissed); setLoading(false);
    // Setup finished for the first time: carry on to booking the first appointment (this never happens again).
    const to = await firstRunTarget(clinicId);
    if (to && to !== "/setup") { toast("Setup complete. Welcome to your clinic."); router.push(to); }
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  async function addMeAsDoctor() {
    if (!clinicId) return;
    setMsg("");
    const user = await getUser();
    if (!user) return;
    const { data: me } = await supabase.from("clinic_staff").select("name,specialty").eq("clinic_id", clinicId).eq("user_id", user.id).maybeSingle();
    const { error } = await supabase.from("doctors").insert({ clinic_id: clinicId, user_id: user.id, name: me?.name ?? user.email, specialty: me?.specialty ?? null, is_active: true });
    setMsg(error ? (error.code === "23505" ? "You are already added as a doctor." : error.message) : "Done. You are now listed as a doctor.");
    load();
  }
  async function mark(flag: string) { if (clinicId) { await setSetupFlag(clinicId, flag, true); load(); } }
  async function dismiss(v: boolean) { if (clinicId) { await setSetupFlag(clinicId, "dismissed", v); setDismissed(v); } }

  const essential = items.filter((i) => !i.optional);
  const done = essential.filter((i) => i.done).length;

  return (
    <AppShell>
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-900">Clinic setup</h1>
        <p className="text-slate-500 mt-1">Your clinic starts with sensible defaults and no patient data. Work through these to make it yours.</p>

        {!loading && (
          <div className="mt-5 flex items-center gap-3">
            <div className="flex-1 h-2.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-sky-600" style={{ width: `${essential.length ? (done / essential.length) * 100 : 0}%` }} /></div>
            <span className="text-sm text-slate-600 tabular-nums">{done}/{essential.length} essentials</span>
          </div>
        )}
        {msg && <div className="mt-4 text-sm text-slate-700 bg-slate-100 rounded-lg px-3.5 py-2.5">{msg}</div>}

        <ul className="mt-6 space-y-3">
          {items.map((i) => (
            <li key={i.id} className={`rounded-xl border p-4 flex gap-4 items-start ${i.done ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
              <span className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${i.done ? "bg-emerald-600 text-white" : "border-2 border-slate-300 text-transparent"}`}>✓</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900">{i.title}{i.optional && <span className="ml-2 text-xs font-medium text-slate-500">optional</span>}</p>
                <p className="text-sm text-slate-600 mt-0.5">{i.hint}</p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!i.done && <Link href={i.href} className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-semibold">Open</Link>}
                  {i.id === "doctors" && !i.done && <button onClick={addMeAsDoctor} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">I&apos;m a doctor too: add me</button>}
                  {i.id === "prices" && !i.done && <button onClick={() => mark("prices_reviewed")} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Looks right, mark done</button>}
                  {i.id === "whatsapp" && !i.done && <button onClick={() => mark("whatsapp_done")} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">I&apos;ve added the WhatsApp keys</button>}
                  {i.id === "templates" && !i.done && <button onClick={() => mark("templates_reviewed")} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Looks right, mark done</button>}
                  {i.done && <Link href={i.href} className="text-sm text-sky-700 hover:underline">Review</Link>}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 text-sm text-slate-500">
          {dismissed ? <button onClick={() => dismiss(false)} className="underline">Show the setup reminder on the dashboard again</button>
                     : <button onClick={() => dismiss(true)} className="underline">Hide the reminder on the dashboard</button>}
        </div>
      </div>
    </AppShell>
  );
}
