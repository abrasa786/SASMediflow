/** Shared pieces for the assistant's modules (calendar, records, reports). Each module answers or returns null. */
export interface AxCtx {
  db: any; clinicId: string; userId: string; role: string;
  message: string; prev: any; today: string; botName: string;
}
export interface AxReply { reply: string; draft: any; actions?: { label: string; url: string }[]; slots?: string[]; intent?: string }

export const YES = /^\s*(yes|yeah|yep|y|ok|okay|sure|confirm(?:ed)?|go ahead|do it|save(?: it)?|apply(?: it)?|please do|correct|right)\W*$/i;
export const isYes = (t: string) => YES.test(t);

export const DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri" style summary of weekday numbers. */
export function daysText(days: number[]): string {
  const d = Array.from(new Set(days)).sort((a, b) => a - b);
  if (d.length === 7) return "every day";
  const runs: number[][] = []; for (const x of d) { const r = runs[runs.length - 1]; if (r && x === r[r.length - 1] + 1) r.push(x); else runs.push([x]); }
  return runs.map((r) => (r.length > 2 ? `${DAY_NAME[r[0]]}–${DAY_NAME[r[r.length - 1]]}` : r.map((x) => DAY_NAME[x]).join(", "))).join(", ");
}

export interface DoctorRow { id: string; name: string; user_id: string | null; phone?: string | null }
export async function loadDoctors(db: any, clinicId: string): Promise<DoctorRow[]> {
  const { data } = await db.from("doctors").select("id, name, user_id, phone").eq("clinic_id", clinicId).eq("is_active", true).order("name");
  return (data ?? []) as DoctorRow[];
}

/** Which doctor does the sentence mean? "Dr Mehta", "Mehta", "my" (when the caller is a doctor). */
export function pickDoctor(doctors: DoctorRow[], text: string, userId: string): { doctor?: DoctorRow; error?: string; mentioned: boolean } {
  const t = text.toLowerCase();
  const hits = doctors.filter((d) => d.name.toLowerCase().replace(/^dr\.?\s+/, "").split(/\s+/).filter((w) => w.length >= 3).some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)));
  if (hits.length === 1) return { doctor: hits[0], mentioned: true };
  if (hits.length > 1) return { error: `More than one doctor matches: ${hits.map((h) => h.name).join(", ")}. Which one?`, mentioned: true };
  if (/\b(?:my|mine|i am|i'm|i will|i'll)\b/.test(t)) { const me = doctors.find((d) => d.user_id === userId); if (me) return { doctor: me, mentioned: true }; }
  const named = t.match(/\b(?:dr\.?|doctor)\s+([a-z]+)/);
  if (named) return { error: `I couldn't find a doctor called “${named[1]}”. Doctors: ${doctors.map((d) => d.name).join(", ") || "none yet"}.`, mentioned: true };
  return { mentioned: false };
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
/** A single date or a range: "25 to 27 Oct", "from tomorrow to Friday", "next Monday", "on 3/11". Returns ISO dates. */
export function parseRange(text: string, today: string, parse: (t: string, today: string) => { date?: string }): { from?: string; to?: string } {
  const t = text.toLowerCase();
  const shared = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|-|–|until|till|through)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})[a-z]*`));
  if (shared) { const a = parse(`${shared[1]} ${shared[3]}`, today).date, b = parse(`${shared[2]} ${shared[3]}`, today).date; if (a && b) return { from: a, to: b < a ? a : b }; }
  const parts = t.split(/\b(?:to|until|till|through)\b|[–—]|(?<=\w)\s-\s(?=\w)/);
  if (parts.length >= 2) {
    const a = parse(parts[0], today).date, b = parse(parts[1], today).date;
    if (a && b) return { from: a, to: b < a ? a : b };
    if (a && !b) return { from: a, to: a };
  }
  const one = parse(t, today).date;
  return one ? { from: one, to: one } : {};
}
