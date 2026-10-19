/**
 * Natural-language parsing for the booking assistant.
 * Pure functions (no I/O) so they can be tested in isolation.
 * Handles messages like:
 *   "Book Priya Sharma, 27 years, teeth cleaning tomorrow 10am 9876543210"
 *   "Cancel Rahul's appointment on 27 Oct"
 *   "Move Asha to Friday 4:30 pm with Dr Rao"
 */

export type Intent = "book" | "cancel" | "reschedule" | "other";

export interface BookingDraft {
  intent?: Intent;
  name?: string;
  phone?: string;       // 10 digits
  age?: number;
  gender?: "M" | "F";
  date?: string;        // YYYY-MM-DD
  time?: string;        // "10:00 AM"
  part_of_day?: "morning" | "afternoon" | "evening";
  doctor_hint?: string; // "Rao" from "with Dr Rao"
  reason?: string;
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function todayInTz(tz = "Asia/Kolkata", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dow = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();
const pad = (n: number) => String(n).padStart(2, "0");
export function fmt12(h: number, m: number): string {
  const p = h >= 12 ? "PM" : "AM";
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${pad(m)} ${p}`;
}

export function formatDateNice(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const STOP = new Set(("book appointment appt schedule fix for please new patient name is a an the add cancel reschedule move shift my to at on with has have " +
  "wants want needs need tomorrow today tonight next this coming age aged years year old male female man woman boy girl m f tooth teeth pain fever cough " +
  "cleaning checkup consultation and of his her phone mobile number no contact him them it can you could would i we that by from into after before " +
  "morning afternoon evening noon dr doctor mr mrs ms visit see slot time date day monday tuesday wednesday thursday friday saturday sunday " +
  "wisdom root canal braces brace filling extraction whitening implant crown scaling stomach back knee head headache ache cold vaccination xray scan in days").split(" "));

const REASON_WORDS = ["root canal", "teeth cleaning", "cleaning", "scaling", "filling", "extraction", "whitening", "braces", "implant", "crown", "check-up", "checkup",
  "consultation", "follow up", "follow-up", "fever", "cough", "cold", "headache", "stomach pain", "back pain", "knee pain", "tooth pain", "toothache", "pain", "vaccination", "x-ray", "xray"];

export function parseBookingText(text: string, today = todayInTz()): BookingDraft {
  const out: BookingDraft = {};
  let t = " " + text.replace(/\s+/g, " ").trim() + " ";
  const cut = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = t.match(re);
    if (m) { fn(m); t = t.replace(m[0], " | "); }
  };

  // intent
  const low = t.toLowerCase();
  if (/\b(cancel|cancellation|call off)\b/.test(low)) out.intent = "cancel";
  else if (/\b(reschedule|re-schedule|postpone|move|shift|change)\b/.test(low) && /\b(appointment|appt|booking|slot|to|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(low)) out.intent = "reschedule";
  else if (/\b(book|appointment|appt|schedule|fix|slot|register|visit|see the doctor|consult)\b/.test(low)) out.intent = "book";
  else out.intent = "other";

  // phone: 10-digit mobile (6-9 start), optional +91 / spaces / dashes
  cut(/(?:\+?91[\s-]?)?\b([6-9]\d{4}[\s-]?\d{5})\b/, (m) => { out.phone = m[1].replace(/\D/g, ""); });

  // age
  cut(/\b(?:age[d]?\s*:?\s*)?(\d{1,3})\s*(?:years?|yrs?|y\/o|yo|yr)(?:\s*old)?\b/i, (m) => { const a = +m[1]; if (a > 0 && a < 120) out.age = a; });
  if (out.age === undefined) cut(/\bage[d]?\s*:?\s*(\d{1,3})\b/i, (m) => { const a = +m[1]; if (a > 0 && a < 120) out.age = a; });

  // gender
  cut(/\b(male|female|man|woman|boy|girl)\b/i, (m) => { out.gender = /^(f|w|g)/i.test(m[1]) ? "F" : "M"; });

  // doctor hint
  cut(/\b(?:with|for|to see|see)\s+(?:dr\.?|doctor)\s+([A-Za-z]+(?:\s[A-Za-z]+)?)/i, (m) => { out.doctor_hint = m[1].trim(); });
  if (!out.doctor_hint) cut(/\b(?:dr\.?|doctor)\s+([A-Za-z]+)/i, (m) => { out.doctor_hint = m[1].trim(); });

  // ── date ──
  const lt = () => t.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = lt().match(/\bday after tomorrow\b|\bovermorrow\b/))) { out.date = addDays(today, 2); t = t.replace(new RegExp(m[0], "i"), " | "); }
  else if ((m = lt().match(/\b(?:tomorrow|tmrw|tmr)\b/))) { out.date = addDays(today, 1); t = t.replace(new RegExp(m[0], "i"), " | "); }
  else if ((m = lt().match(/\b(?:today|tonight)\b/))) { out.date = today; t = t.replace(new RegExp(m[0], "i"), " | "); }
  else if ((m = lt().match(/\bin (\d{1,2}) days?\b/))) { out.date = addDays(today, +m[1]); t = t.replace(new RegExp(m[0], "i"), " | "); }
  else if ((m = lt().match(/\b(?:(next|this|coming|on)\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*\b/))) {
    const idx = DAYS.findIndex((d) => d.startsWith(m![2].slice(0, 3)));
    let diff = (idx - dow(today) + 7) % 7;
    if (m[1] === "next" && diff === 0) diff = 7;
    if (m[1] === "next" && diff > 0 && diff < 7 && false) diff += 0;
    out.date = addDays(today, diff);
    t = t.replace(new RegExp(m[0], "i"), " | ");
  } else if ((m = lt().match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/))) {
    const d = +m[1], mo = +m[2]; let y = m[3] ? +m[3] : +today.slice(0, 4); if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let iso = `${y}-${pad(mo)}-${pad(d)}`;
      if (!m[3] && iso < today) iso = `${y + 1}-${pad(mo)}-${pad(d)}`;
      out.date = iso; t = t.replace(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " | ");
    }
  } else if ((m = lt().match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTHS.join("|")})[a-z]*\\b`))) ||
             (m = lt().match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const first = /^\d/.test(m[1]);
    const d = +(first ? m[1] : m[2]); const mo = MONTHS.indexOf(first ? m[2] : m[1]) + 1;
    const y = +today.slice(0, 4); let iso = `${y}-${pad(mo)}-${pad(d)}`;
    if (iso < today) iso = `${y + 1}-${pad(mo)}-${pad(d)}`;
    if (d >= 1 && d <= 31) { out.date = iso; t = t.replace(new RegExp(m[0], "i"), " | "); }
  }

  // ── time ──
  if ((m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/i))) {
    let h = +m[1]; const mi = m[2] ? +m[2] : 0; const pm = /^p/i.test(m[3]);
    if (h >= 1 && h <= 12 && mi < 60) { if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; out.time = fmt12(h, mi); t = t.replace(m[0], " | "); }
  } else if ((m = t.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    { const h = +m[1]; out.time = fmt12(h >= 1 && h <= 7 ? h + 12 : h, +m[2]); } t = t.replace(m[0], " | "); // clinic hours: bare 1-7 means afternoon
  } else if (/\bnoon\b/i.test(t)) { out.time = "12:00 PM"; t = t.replace(/\bnoon\b/i, " | "); }
  else if ((m = t.match(/\bat\s+(\d{1,2})\b(?!\s*(?:years?|yrs?))/i)) && +m[1] >= 1 && +m[1] <= 12) {
    // "at 5" — assume working hours: 1-7 => PM, 8-11 => AM, 12 => PM
    const h = +m[1]; out.time = fmt12(h >= 8 && h <= 11 ? h : h === 12 ? 12 : h + 12, 0); t = t.replace(m[0], " | ");
  }
  if (!out.time && (m = t.match(/\b(morning|afternoon|evening)\b/i))) { out.part_of_day = m[1].toLowerCase() as any; t = t.replace(m[0], " | "); }

  // ── name ──
  const explicit = t.match(/\b(?:patient\s+name|name\s+of\s+(?:the\s+)?patient|patient|name)\s*(?:is|:)?\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4})/i);
  const cleaned = t.replace(/'s\b/gi, " ").replace(/[,;:]/g, " | ");
  const pickName = (seg: string) => {
    const toks = seg.split(/\s+/).filter(Boolean);
    const names: string[] = [];
    let started = false;
    for (const w of toks) {
      const lw = w.toLowerCase().replace(/[.,]$/, "");
      const alpha = /^[A-Za-z][A-Za-z.'-]*$/.test(w);
      if (!started) { if (alpha && !STOP.has(lw)) { started = true; names.push(w); } continue; }
      if (alpha && !STOP.has(lw) && names.length < 3) names.push(w); else break;
    }
    return names.join(" ");
  };
  let name = "";
  if (explicit) {
    const cand = pickName(explicit[1]);
    if (cand) name = cand;
  }
  if (!name) for (const seg of cleaned.split("|")) { const c = pickName(seg); if (c) { name = c; break; } }
  if (name) out.name = name.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  // ── reason ──
  const lowAll = text.toLowerCase();
  const rw = REASON_WORDS.find((w) => lowAll.includes(w));
  const rm = text.match(/\b(?:has|have|having|suffering from|complaint(?:s)? of|for|regarding|needs?|wants?)\s+((?:an?\s+)?[A-Za-z][A-Za-z -]{2,30}?)(?=\s+(?:on|at|tomorrow|today|with|from|and|\d)|[,.]|$)/i);
  if (rm && !STOP.has(rm[1].trim().toLowerCase()) && !/^(an?\s+)?(appointment|visit|slot|consultation with)\b/i.test(rm[1].trim())) out.reason = rm[1].replace(/^(an?\s+)/i, "").trim();
  else if (rw) out.reason = rw;

  return out;
}

/** Merge a new message into the running draft. New facts win; a new booking intent keeps the old facts. */
export function mergeDraft(prev: BookingDraft | undefined, next: BookingDraft): BookingDraft {
  const merged: BookingDraft = { ...(prev ?? {}) };
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "intent") { if (v !== "other") merged.intent = v as Intent; else if (!merged.intent) merged.intent = "other"; continue; }
    (merged as any)[k] = v;
  }
  if (next.time) delete merged.part_of_day;
  return merged;
}

export function missingForBooking(d: BookingDraft): string[] {
  const miss: string[] = [];
  if (!d.name) miss.push("patient name");
  if (!d.phone) miss.push("10-digit mobile number");
  if (!d.date) miss.push("date");
  return miss;
}
