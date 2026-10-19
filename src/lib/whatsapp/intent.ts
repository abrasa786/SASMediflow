/** What did the patient mean? Rule-based, so it is predictable and needs no external AI. Pure functions, easy to test. */
export type WaIntent = "menu" | "appointments" | "book" | "cancel" | "reschedule" | "balance" | "stop" | "start" | "yes" | "no" | "number" | "other";

export function detectWaIntent(raw: string): WaIntent {
  const t = raw.trim().toLowerCase().replace(/[!.?]+$/g, "");
  if (!t) return "other";
  if (/^(?:stop|unsubscribe|opt ?out|do not (?:message|contact)|dont message)$/.test(t)) return "stop";
  if (/^(?:start|subscribe|opt ?in|resume)$/.test(t)) return "start";
  if (/^(?:yes|y|yeah|yep|ok|okay|sure|confirm|haan|ha|correct)$/.test(t)) return "yes";
  if (/^(?:no|n|nope|nah|cancel that|never ?mind|back|stop that)$/.test(t)) return "no";
  if (/^\d{1,2}$/.test(t)) return "number";
  if (/^(?:hi|hello|hey|hii+|namaste|menu|help|start over|options)\b/.test(t) && t.split(/\s+/).length <= 3) return "menu";
  if (/\b(?:re-?schedule|postpone|change (?:my )?(?:appointment|time|date|slot)|move (?:my )?appointment|another (?:day|time))\b/.test(t)) return "reschedule";
  if (/\bcancel\b/.test(t)) return "cancel";
  if (/\b(?:balance|dues?|bill|invoice|pending (?:payment|amount)|how much (?:do i owe|is due)|outstanding|pay)\b/.test(t)) return "balance";
  if (/\b(?:my (?:appointments?|bookings?|visit)|next (?:appointment|visit)|when is my|upcoming)\b/.test(t)) return "appointments";
  if (/\b(?:book|appointment|slot|see (?:the )?doctor|consult|visit|check ?-?up)\b/.test(t)) return "book";
  return "other";
}

/** "2", "option 2", "no. 2" → 2 */
export function pickNumber(raw: string, max: number): number | null {
  const m = raw.trim().match(/^(?:option|no\.?|number|#)?\s*(\d{1,2})\b/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

export const WA_MENU = (clinic: string, bot: string) =>
  `Hi, I'm ${bot}, ${clinic}'s assistant. You can send:\n• *book* – book an appointment\n• *my appointments* – see what's booked\n• *reschedule* – move an appointment\n• *cancel* – cancel an appointment\n• *balance* – see what is due\nSend *stop* any time to stop reminders.`;

/** The words used around a reply so nothing in it can be mistaken for a command from someone else. */
export const clip = (s: string, n = 900) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
