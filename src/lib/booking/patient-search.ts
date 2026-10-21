/** Turns the patient app's specialty tags into a safe pattern for the clinic search. Never passes raw user text to the database as a pattern. */
const TAGS: Record<string, string> = {
  general: "general|physician|family", dental: "dent|oral", eye: "eye|ophthal|optic", cardio: "cardi|heart", ortho: "ortho|bone|joint",
  pediatric: "pediat|paediat|child", skin: "derma|skin", neuro: "neuro", gynecology: "gyn|obstet|women", ent: "\\yent\\y|otolaryn|ear nose", psychiatry: "psychi|mental", physio: "physio",
};
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function specialtyPattern(input: string | null | undefined): string | null {
  const t = (input ?? "").trim().toLowerCase().slice(0, 40);
  if (!t || t === "all") return null;
  return TAGS[t] ?? escapeRe(t);
}

export const num = (v: string | null, min: number, max: number): number | null => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
