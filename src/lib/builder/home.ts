/** The cards on the Home dashboard that the Builder can hide or bring back. Nothing is removed from the app: a hidden card is only not shown. */
export const HOME_CARDS: Record<string, { label: string; words: string[] }> = {
  appointments: { label: "Today's appointments", words: ["appointments", "appointment", "bookings", "today's appointments", "todays appointments"] },
  completed: { label: "Completed today", words: ["completed", "completed today", "done"] },
  patients: { label: "Total patients", words: ["patients", "patient", "total patients", "patient count"] },
  stock: { label: "Low stock", words: ["stock", "low stock", "inventory", "low stock items", "stock alert"] },
  collections: { label: "Collected today", words: ["collected", "collected today", "collections", "collection", "revenue", "money", "income"] },
  dues: { label: "Outstanding dues", words: ["dues", "outstanding", "outstanding dues", "pending payments", "unpaid"] },
  utilisation: { label: "Doctor utilisation", words: ["utilisation", "utilization", "doctor utilisation", "doctor utilization"] },
  noshows: { label: "No-shows", words: ["no-shows", "no shows", "noshows", "no show", "missed visits"] },
  trend: { label: "Collected, last 7 days", words: ["trend", "7 day trend", "last 7 days", "weekly collection", "collection graph", "collected graph"] },
  doctors: { label: "Doctor load", words: ["doctor load", "doctors", "doctor", "doctors load"] },
  schedule: { label: "Today's schedule", words: ["schedule", "today's schedule", "todays schedule", "appointment list", "appointments list"] },
};

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\b(the|my|our|a|an|card|cards|widget|box|tile|section|count|counts|stats?|on|in|from)\b/g, " ").replace(/[^a-z0-9' -]/g, " ").replace(/\s+/g, " ").trim();

/** Turn what an admin said ("patient", "no shows", "the schedule") into a card key, or null. */
export function resolveHomeCard(text: string): string | null {
  const t = norm(text);
  if (!t) return null;
  for (const [k, v] of Object.entries(HOME_CARDS)) if (norm(v.label) === t || v.words.some((w) => norm(w) === t)) return k;
  for (const [k, v] of Object.entries(HOME_CARDS)) if (v.words.some((w) => t.includes(norm(w)) && norm(w).length > 3)) return k;
  return null;
}
