/**
 * How long should this visit be? Order of trust: what this clinic's real visits show (median of the last few), then what the clinic set,
 * then a sensible starting guess by kind of treatment. Nobody has to configure anything: it learns as visits are completed.
 */
export interface DurationRow { key: string; label?: string | null; minutes?: number | null; samples?: number[] | null }
export interface Suggestion { minutes: number; basis: "learned" | "set" | "starting guess"; n?: number }

const STARTING: [RegExp, number][] = [
  [/implant/, 60], [/root canal|rct|endodont/, 60], [/crown|cap|bridge|veneer|zirconi/, 45], [/whiten|bleach/, 45], [/wisdom|surgical|impact/, 45],
  [/extract|removal|pull/, 30], [/fill|cavity|restor/, 30], [/scal|clean|polish/, 30], [/brace|aligner|ortho/, 30], [/denture/, 30],
  [/consult|check|review|follow|pain|opinion|first visit/, 15],
];
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
const round5 = (n: number) => Math.min(240, Math.max(5, Math.round(n / 5) * 5));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function suggestDuration(reason: string, rows: DurationRow[]): Suggestion | null {
  const k = normKey(reason);
  if (k.length < 3) return null;
  // the clinic's own record: the same wording, or one that contains the other ("root canal" vs "root canal treatment")
  const match = rows.filter((r) => r.key === k).concat(rows.filter((r) => r.key !== k && (r.key.includes(k) || k.includes(r.key)))).find((r) => (r.samples?.length ?? 0) >= 3 || r.minutes);
  if (match) {
    const s = match.samples ?? [];
    if (s.length >= 3) return { minutes: round5(median(s)), basis: "learned", n: s.length };
    if (match.minutes) return { minutes: match.minutes, basis: "set" };
  }
  for (const [re, m] of STARTING) if (re.test(k)) return { minutes: m, basis: "starting guess" };
  return null;
}
