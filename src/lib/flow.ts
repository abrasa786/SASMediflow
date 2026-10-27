/** First-run guide: a new clinic is taken through setup once, then to its first appointment. After that it is never sent back to setup. */
import { getSetupStatus, setSetupFlag } from "./setup";
import { supabase } from "./supabase";

/** Everything the clinic must set up before booking (booking the first appointment itself is not part of it). */
export async function setupReady(clinicId: string): Promise<{ ready: boolean; dismissed: boolean }> {
  const { items, dismissed } = await getSetupStatus(clinicId);
  return { ready: items.filter((i) => !i.optional && i.id !== "patient").every((i) => i.done), dismissed };
}

/** Where an admin who has just signed in should land: "/setup" until setup is done, then home once, then null (go where they asked). */
export async function firstRunTarget(clinicId: string): Promise<string | null> {
  try {
    // guide once per sign-in: after being taken to Setup, Home opens normally (the Setup reminder stays on it)
    const key = "mf_guided_" + clinicId;
    const { data } = await supabase.from("clinics").select("settings").eq("id", clinicId).maybeSingle();
    const s = ((data?.settings ?? {}) as any).setup ?? {};
    if (s.completed || s.dismissed) return null;
    const { ready } = await setupReady(clinicId);
    if (!ready) { try { if (sessionStorage.getItem(key)) return null; sessionStorage.setItem(key, "1"); } catch { /* ignore */ } return "/setup"; }
    try { await setSetupFlag(clinicId, "completed", true); } catch { return null; }
    return "/dashboard";
  } catch { return null; }
}
