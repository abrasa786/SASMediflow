import { validatePlan } from "@/lib/builder/validate";
import type { Plan, Schema } from "@/lib/builder/types";

/** Same request written slightly differently should land on the same key. */
export const memKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 200);
const words = (s: string) => new Set(memKey(s).split(" ").filter((w) => w.length > 2));

export function similarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0; x.forEach((w) => { if (y.has(w)) both++; });
  return both / (x.size + y.size - both);
}

export interface Memory { key: string; prompt: string; plan: unknown; uses: number }

/** Pick the remembered request that matches best (exact, or very similar). Pure, so it is testable. */
export function bestMatch(prompt: string, mems: Memory[], min = 0.8): Memory | null {
  const k = memKey(prompt);
  let best: Memory | null = null, bs = 0;
  for (const m of mems) {
    const s = m.key === k ? 1 : similarity(prompt, m.prompt);
    if (s > bs || (s === bs && best && m.uses > best.uses)) { best = m; bs = s; }
  }
  return best && bs >= min ? best : null;
}

/** A remembered plan is only reused if it is still valid for the clinic's setup as it is now. */
export async function recallPlan(db: any, clinicId: string, module: string, prompt: string, schema: Schema): Promise<{ plan: Plan; uses: number } | null> {
  try {
    const { data, error } = await db.from("ai_memory").select("key, prompt, plan, uses").eq("clinic_id", clinicId).eq("module", module).order("last_used_at", { ascending: false }).limit(200);
    if (error || !data?.length) return null;
    const m = bestMatch(prompt, data);
    if (!m) return null;
    const v = validatePlan(m.plan, schema);
    if (!v.ok) return null;
    await db.from("ai_memory").update({ uses: m.uses + 1, last_used_at: new Date().toISOString() }).eq("clinic_id", clinicId).eq("module", module).eq("key", m.key);
    return { plan: v.plan, uses: m.uses + 1 };
  } catch { return null; }
}

/** Called after the admin approves and the change succeeds. */
export async function rememberPlan(db: any, clinicId: string, module: string, prompt: string, plan: unknown): Promise<void> {
  try {
    const key = memKey(prompt);
    if (!key || !plan) return;
    const { data } = await db.from("ai_memory").select("uses").eq("clinic_id", clinicId).eq("module", module).eq("key", key).maybeSingle();
    if (data) await db.from("ai_memory").update({ plan, prompt: prompt.slice(0, 1000), uses: (data.uses ?? 1) + 1, last_used_at: new Date().toISOString() }).eq("clinic_id", clinicId).eq("module", module).eq("key", key);
    else await db.from("ai_memory").insert({ clinic_id: clinicId, module, key, prompt: prompt.slice(0, 1000), plan });
  } catch { /* learning is best effort */ }
}

/** A few of this clinic's approved requests, shown to the language model as examples of what this clinic likes. */
export async function examplesFor(db: any, clinicId: string, module: string): Promise<{ prompt: string; plan: unknown }[]> {
  try {
    const { data } = await db.from("ai_memory").select("prompt, plan").eq("clinic_id", clinicId).eq("module", module).order("uses", { ascending: false }).limit(4);
    return data ?? [];
  } catch { return []; }
}
