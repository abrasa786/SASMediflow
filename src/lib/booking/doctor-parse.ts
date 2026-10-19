/** Understands "Add a new doctor name: Abdul Rahim, dentist, years of experience 10, shift 2-11". */

export interface DoctorDraft {
  name?: string; specialty?: string; years?: number; phone?: string; fee?: number;
  start?: string; end?: string;       // "HH:MM" 24h
  days?: number[];                    // 0 = Sunday
  shiftError?: string;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const isAddDoctor = (t: string) =>
  /\b(add|create|register|onboard|new|hire|join(?:ed|ing)?)\b/i.test(t) && /\b(doctor|dr\.?|dentist|physician|surgeon|consultant)\b/i.test(t) && !/\b(book|appointment|cancel|reschedule)\b/i.test(t.replace(/\bnew doctor\b/i, ""));

const to24 = (h: number, m: number, ap?: string) => {
  if (ap) { const a = ap.toLowerCase(); if (a === "pm" && h < 12) h += 12; if (a === "am" && h === 12) h = 0; }
  return h * 60 + m;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function parseShift(text: string): Pick<DoctorDraft, "start" | "end" | "shiftError"> {
  const m = text.match(/(?:shift|timings?|hours|available|working|duty)?\s*[:=]?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?!\d)/i);
  if (!m || !/(shift|timing|hours|available|working|duty|\d\s*(?:am|pm)\b|:\d\d)/i.test(text)) return {};
  let s = to24(+m[1], +(m[2] ?? 0), m[3]);
  let e = to24(+m[4], +(m[5] ?? 0), m[6]);
  if (!m[3] && s >= 60 && s <= 7 * 60 + 59 && +m[1] <= 7) s += 12 * 60;           // "2-11" → 2 PM
  if (!m[6]) { while (e <= s && e < 24 * 60 - 12 * 60 + 12 * 60) { e += 12 * 60; if (e > 24 * 60) break; } }
  if (e <= s || e > 24 * 60 || s >= 24 * 60) return { shiftError: "I can't use that shift. Overnight shifts aren't supported yet, so please give a start and end within one day, like 9am-6pm." };
  return { start: hhmm(s), end: hhmm(e) };
}

export function parseAddDoctor(text: string): DoctorDraft {
  const out: DoctorDraft = {};
  const nm = text.match(/\bname\s*[:=\-]?\s*(?:dr\.?\s+)?([A-Za-z][A-Za-z.' ]{1,50}?)(?=\s*(?:,|;|\n|\.\s|\bspeciali[sz]|\bdentist|\byears?|\bshift|\bphone|\bfee|\bexp|$))/i)
    ?? text.match(/\b(?:doctor|dr\.?)\s+(?:named\s+|called\s+)?(?:dr\.?\s+)?([A-Z][A-Za-z.']+(?:\s+[A-Z][A-Za-z.']+){0,2})/);
  if (nm) out.name = nm[1].replace(/\s+/g, " ").trim();
  const sp = text.match(/\bspeciali[sz]\w*\s*[:=\-]?\s*([A-Za-z ]{3,30}?)(?=,|;|$|\byears|\bshift)/i)
    ?? text.match(/\b([a-z]+(?:ist|ian|ologist))\b/i);
  if (sp && !/^(specialist|physician)$/i.test(sp[1].trim()) ) out.specialty = sp[1].trim().replace(/^\w/, (c) => c.toUpperCase());
  else if (/\bdoctor of medicine|general (physician|practi)/i.test(text)) out.specialty = "General Physician";
  const yr = text.match(/years?\s+of\s+experience\s*[:=\-]?\s*(\d{1,2})/i) ?? text.match(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/i) ?? text.match(/experience\s*[:=\-]?\s*(\d{1,2})/i);
  if (yr) out.years = Math.min(70, +yr[1]);
  const ph = text.replace(/[\s-]/g, "").match(/(?<!\d)(?:\+?91)?([6-9]\d{9})(?!\d)/);
  if (ph) out.phone = ph[1];
  const fee = text.match(/\bfees?\s*[:=\-]?\s*(?:rs\.?|₹|inr)?\s*(\d{2,6})/i);
  if (fee) out.fee = +fee[1];
  Object.assign(out, parseShift(text));
  const dr = text.match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:-|to|–)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/i);
  if (dr) {
    const a = DAYS.indexOf(dr[1].toLowerCase()), b = DAYS.indexOf(dr[2].toLowerCase()); const d: number[] = [];
    for (let i = a; ; i = (i + 1) % 7) { d.push(i); if (i === b) break; }
    out.days = d;
  }
  return out;
}

export function mergeDoctor(prev: DoctorDraft | undefined, next: DoctorDraft): DoctorDraft {
  const out: DoctorDraft = { ...(prev ?? {}) };
  (Object.keys(next) as (keyof DoctorDraft)[]).forEach((k) => { if (next[k] !== undefined) (out as any)[k] = next[k]; });
  if (!next.shiftError) delete out.shiftError;
  return out;
}
