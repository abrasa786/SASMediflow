/** When to order lab work or materials so they are here for the appointment, and when to check they arrived. */
export const LEAD_DAYS = 5;                    // lab work such as a zirconium crown usually takes about this long

const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function planOrderDates(neededBy: string | null, today: string): { orderBy: string; checkBy: string; late: boolean; known: boolean } {
  if (!neededBy || !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) {
    // no appointment date yet: order soon, check a few days later
    return { orderBy: addDays(today, 1), checkBy: addDays(today, 1 + LEAD_DAYS), late: false, known: false };
  }
  const ideal = addDays(neededBy, -LEAD_DAYS);
  const orderBy = ideal < today ? today : ideal;
  const checkDay = addDays(neededBy, -1);
  return { orderBy, checkBy: checkDay < orderBy ? orderBy : checkDay, late: ideal < today, known: true };
}

/** Words in a note that usually mean something must be made or bought first. */
const ORDER_WORDS = /\b(zirconi\w*|porcelain|ceramic|e\.?max|crowns?|caps?|bridges?|implants?|abutments?|aligners?|dentures?|veneers?|inlays?|onlays?|retainers?|night ?guards?|membrane|bone graft)\b/i;
export function suggestOrderItem(...texts: (string | null | undefined)[]): string | null {
  const m = texts.filter(Boolean).join(" ").match(ORDER_WORDS);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return /^zirconi/.test(w) ? "Zirconium crown" : w.charAt(0).toUpperCase() + w.slice(1).replace(/s$/, "");
}
