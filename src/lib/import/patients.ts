/**
 * Importing patients from a file exported by another app. All pure functions, so the screen (to preview) and the server (to enforce) use the same rules.
 */
export const MAX_IMPORT_ROWS = 2000;

export type PatientField = "name" | "phone" | "email" | "dob" | "gender" | "blood_group" | "allergies" | "conditions" | "medications" | "address" | "notes";
export const FIELDS: { key: PatientField; label: string; required?: boolean; words: string[] }[] = [
  { key: "name", label: "Patient name", required: true, words: ["name", "patient name", "full name", "patient"] },
  { key: "phone", label: "Mobile number", words: ["phone", "mobile", "contact", "cell", "whatsapp", "phone number", "mobile number", "mobile no"] },
  { key: "email", label: "Email", words: ["email", "e-mail", "mail"] },
  { key: "dob", label: "Date of birth", words: ["dob", "date of birth", "birth", "birthday"] },
  { key: "gender", label: "Gender", words: ["gender", "sex"] },
  { key: "blood_group", label: "Blood group", words: ["blood", "blood group"] },
  { key: "allergies", label: "Allergies", words: ["allerg"] },
  { key: "conditions", label: "Medical conditions", words: ["condition", "history", "medical"] },
  { key: "medications", label: "Medications", words: ["medication", "medicine", "drug"] },
  { key: "address", label: "Address", words: ["address", "city", "location"] },
  { key: "notes", label: "Notes", words: ["note", "remark", "comment"] },
];

/** A forgiving CSV reader: quotes, commas and line breaks inside quotes, Windows line ends, a leading byte-order mark. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === ";" || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export type Mapping = Partial<Record<PatientField, string>>;   // field -> the file's column header

/** Guess which column is which, by the words in the header. */
export function guessMapping(headers: string[]): Mapping {
  const m: Mapping = {}; const used = new Set<string>();
  const norm = (h: string) => h.toLowerCase().replace(/[_\-.]+/g, " ").trim();
  for (const f of FIELDS) {
    const exact = headers.find((h) => !used.has(h) && f.words.includes(norm(h)));
    const part = exact ?? headers.find((h) => !used.has(h) && f.words.some((w) => norm(h).includes(w)));
    if (part) { m[f.key] = part; used.add(part); }
  }
  return m;
}

/** The last 10 digits, the same rule the database uses to find a patient by phone. null when it is not a usable mobile number. */
export function normPhone(raw: unknown): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.slice(-10);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Dates as day/month/year (India), year-month-day, or "12 Mar 1985". Returns YYYY-MM-DD or null. */
export function parseDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim(); if (!s) return null;
  let y = 0, m = 0, d = 0, x: RegExpMatchArray | null;
  if ((x = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; if (y < 100) y += y > 30 ? 1900 : 2000; }
  else if ((x = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-,]+(\d{4})$/))) { d = +x[1]; m = MONTHS.indexOf(x[2].slice(0, 3).toLowerCase()) + 1; y = +x[3]; }
  else return null;
  if (!m || m > 12 || d < 1 || d > 31 || y < 1900 || y > new Date().getFullYear()) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseGender(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase(); if (!s) return null;
  if (/^(m|male|man|boy)$/.test(s)) return "male";
  if (/^(f|female|woman|girl)$/.test(s)) return "female";
  return "other";
}

export interface CleanPatient {
  name: string; phone: string | null; email: string | null; dob: string | null; gender: string | null; blood_group: string | null;
  allergies: string | null; conditions: string | null; medications: string | null; address: string | null; notes: string | null;
}
export interface CleanResult { patient?: CleanPatient; problems: string[]; warnings: string[]; key: string }

const cut = (v: unknown, n: number) => { const s = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, n); return s || null; };

/** One file row -> a clean patient, or the reasons it cannot be imported. `key` is what identifies the person for duplicate checks. */
export function cleanRow(raw: Record<string, unknown>, map: Mapping): CleanResult {
  const get = (f: PatientField) => (map[f] ? raw[map[f] as string] : undefined);
  const problems: string[] = [], warnings: string[] = [];
  const name = cut(get("name"), 120);
  if (!name || name.length < 2) problems.push("No patient name");
  const phoneRaw = String(get("phone") ?? "").trim();
  const pn = normPhone(phoneRaw);
  if (phoneRaw && !pn) warnings.push("Mobile number not valid, imported without it");
  const emailRaw = String(get("email") ?? "").trim();
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase().slice(0, 160) : null;
  if (emailRaw && !email) warnings.push("Email not valid, imported without it");
  const dobRaw = String(get("dob") ?? "").trim();
  const dob = parseDate(dobRaw);
  if (dobRaw && !dob) warnings.push("Date of birth not understood, imported without it");
  const key = pn ? "p:" + pn : "n:" + (name ?? "").toLowerCase() + "|" + (dob ?? "");
  if (problems.length) return { problems, warnings, key };
  return {
    problems, warnings, key,
    patient: {
      name: name!, phone: pn ? phoneRaw.replace(/\D/g, "").slice(-15) : null, email, dob, gender: parseGender(get("gender")), blood_group: cut(get("blood_group"), 8),
      allergies: cut(get("allergies"), 500), conditions: cut(get("conditions"), 500), medications: cut(get("medications"), 500),
      address: cut(get("address"), 300), notes: cut(get("notes"), 1000),
    },
  };
}

/** A sample file the clinic can fill in. */
export const SAMPLE_CSV = "Name,Mobile,Email,Date of birth,Gender,Allergies,Address\nAsha Verma,9876543210,asha@example.com,12/03/1985,Female,Penicillin,Indiranagar\nRavi Kumar,9123456780,,1990-07-01,Male,,\n";
