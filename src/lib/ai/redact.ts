/**
 * De-identification applied to EVERYTHING that leaves our system for an external AI provider.
 *  1. Pattern redaction: phone numbers, e-mail/UPI ids, Aadhaar, PAN, long digit strings.
 *  2. Pseudonymisation: known patient/staff names become stable tokens ("Patient A") and are put back in the answer.
 */
const PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, "[email]"],
  [/(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, "[id-number]"],              // Aadhaar
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]"],
  [/(?<![\d.])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, "[phone]"],
  [/(?<!\d)\d{9,18}(?!\d)/g, "[number]"],
];

export function redactText(text: string): { text: string; count: number } {
  let count = 0, out = text;
  for (const [re, label] of PATTERNS) out = out.replace(re, () => { count++; return label; });
  return { text: out, count };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Builds a reversible name → token map. Longer names are matched first so "Priya Sharma" wins over "Priya". */
export class Pseudonymizer {
  private toToken = new Map<string, string>();
  private toName = new Map<string, string>();
  private re: RegExp | null;

  constructor(names: string[], private prefix = "Patient") {
    const words = new Set<string>();
    for (const n of names) {
      const full = n.replace(/^dr\.?\s+/i, "").trim();
      if (full.length >= 3) words.add(full);
      for (const part of full.split(/\s+/)) if (part.length >= 4) words.add(part);   // first/last names on their own
    }
    const list = Array.from(words).sort((a, b) => b.length - a.length).slice(0, 3000);
    this.re = list.length ? new RegExp(`\\b(${list.map(escapeRe).join("|")})\\b`, "gi") : null;
  }

  private tokenFor(name: string): string {
    const key = name.toLowerCase();
    let t = this.toToken.get(key);
    if (!t) {
      const i = this.toToken.size;
      t = `${this.prefix} ${i < 26 ? LABELS[i] : LABELS[Math.floor(i / 26) - 1] + LABELS[i % 26]}`;
      this.toToken.set(key, t); this.toName.set(t, name);
    }
    return t;
  }

  apply(text: string): { text: string; count: number } {
    if (!this.re) return { text, count: 0 };
    let count = 0;
    const out = text.replace(this.re, (m) => { count++; return this.tokenFor(m); });
    return { text: out, count };
  }

  /** Puts real names back into the model's answer, for display to the clinic only. */
  restore(text: string): string {
    let out = text;
    this.toName.forEach((name, token) => { out = out.split(token).join(name); });
    return out;
  }
}
