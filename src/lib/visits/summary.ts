/**
 * The patient summary shown at a new appointment. Built by plain rules from what the clinic recorded, never written by AI,
 * so it can only say what a doctor actually entered.
 */
export interface VisitNote {
  id: string; visit_date: string; tooth?: string | null; treatment: string; findings?: string | null; concerns?: string | null;
  conditions?: string | null; alert?: string | null; follow_up?: string | null; open_points?: string | null; doctor?: string | null;
}
export interface PatientBasics { name: string; dob?: string | null; gender?: string | null; allergies?: string | null; conditions?: string | null; medications?: string | null }
export interface PlanBrief { title: string; status: string; done: number; total: number; next?: string | null }

export interface Summary {
  basics: string[];                                                   // age, gender, allergies, conditions, medications
  alerts: { text: string; date: string; tooth?: string | null }[];    // newest first, same text only once
  conditions: string[];                                               // noticed during visits
  followUps: { text: string; date: string }[];                        // from the latest visits
  plans: PlanBrief[];                                                 // treatment plans still in progress
  history: VisitNote[];                                               // newest first
  lastVisit: string | null;
  text: string;                                                       // the same thing as plain text to copy
}

const nice = (iso?: string | null) => (iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const clean = (s?: string | null) => (s ?? "").trim();

export function ageFrom(dob?: string | null, today = new Date()): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const d = new Date(dob + "T00:00:00Z"); let a = today.getUTCFullYear() - d.getUTCFullYear();
  if (today.getUTCMonth() < d.getUTCMonth() || (today.getUTCMonth() === d.getUTCMonth() && today.getUTCDate() < d.getUTCDate())) a--;
  return a >= 0 && a < 130 ? a : null;
}

export function buildSummary(p: PatientBasics, notes: VisitNote[], plans: PlanBrief[] = [], today = new Date()): Summary {
  const history = [...notes].sort((a, b) => (b.visit_date || "").localeCompare(a.visit_date || ""));
  const age = ageFrom(p.dob, today);
  const basics = [
    [age != null ? `${age} years` : "", clean(p.gender)].filter(Boolean).join(", "),
    clean(p.allergies) && `Allergies: ${clean(p.allergies)}`, clean(p.conditions) && `Conditions: ${clean(p.conditions)}`, clean(p.medications) && `Medications: ${clean(p.medications)}`,
  ].filter(Boolean) as string[];

  const seen = new Set<string>(), alerts: Summary["alerts"] = [];
  for (const n of history) {
    const t = clean(n.alert); if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase()); alerts.push({ text: t, date: n.visit_date, tooth: n.tooth });
  }
  const cSeen = new Set<string>(), conditions: string[] = [];
  for (const n of history) { const t = clean(n.conditions); if (t && !cSeen.has(t.toLowerCase())) { cSeen.add(t.toLowerCase()); conditions.push(t); } }
  const followUps = history.filter((n) => clean(n.follow_up) || clean(n.open_points)).slice(0, 3).map((n) => ({ text: [clean(n.follow_up), clean(n.open_points) ? `Open: ${clean(n.open_points)}` : ""].filter(Boolean).join(" · "), date: n.visit_date }));

  const L: string[] = [`Patient: ${p.name}${basics.length ? ". " + basics.join(". ") : ""}.`];
  if (alerts.length) L.push("ALERTS: " + alerts.map((a) => `${a.text}${a.tooth ? ` (tooth ${a.tooth})` : ""}, noted ${nice(a.date)}`).join("; ") + ".");
  if (conditions.length) L.push("Noticed at visits: " + conditions.join("; ") + ".");
  if (plans.length) L.push("Treatment plans: " + plans.map((x) => `${x.title} (${x.done} of ${x.total} sittings done${x.next ? `, next ${nice(x.next)}` : ""})`).join("; ") + ".");
  if (history.length) {
    L.push("Previous treatment:");
    for (const n of history.slice(0, 8)) L.push(`- ${nice(n.visit_date)}: ${n.treatment}${n.tooth ? ` (tooth ${n.tooth})` : ""}${clean(n.findings) ? `. Findings: ${clean(n.findings)}` : ""}${clean(n.concerns) ? `. Patient concern: ${clean(n.concerns)}` : ""}${n.doctor ? ` - ${n.doctor}` : ""}`);
    if (history.length > 8) L.push(`(${history.length - 8} earlier visits not shown)`);
  } else L.push("No previous treatment recorded here.");
  if (followUps.length) L.push("Follow-up due: " + followUps.map((f) => `${f.text} (from ${nice(f.date)})`).join("; ") + ".");

  return { basics, alerts, conditions, followUps, plans, history, lastVisit: history[0]?.visit_date ?? null, text: L.join("\n") };
}
