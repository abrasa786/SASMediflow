/**
 * Answers common clinic questions inside our own backend: no external AI, nothing leaves the system.
 * Returns null when the question is not one of these (then the policy decides whether external AI may help).
 */
import { todayInTz } from "@/lib/booking/parse";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

export interface ClinicFacts {
  today: string; clinicName: string; names: string[];
  appts: { time: string; status: string; fee: number; patient: string; doctor: string; symptoms: string }[];
  billed: number; collected: number;
  low: { name: string; quantity: number; unit: string; min: number }[];
  unpaid: { count: number; amount: number };
  patients: { total: number; newThisWeek: number };
}

export async function loadFacts(db: any, clinicId: string): Promise<ClinicFacts> {
  const today = todayInTz();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const [clinic, appts, invoices, stock, unpaid, pTotal, pNew, pNames, sNames] = await Promise.all([
    db.from("clinics").select("name, brand_name").eq("id", clinicId).single(),
    db.from("appointments").select("appointment_time, status, consultation_fee, symptoms, clinic_patients(name), doctors(name)").eq("clinic_id", clinicId).eq("appointment_date", today).order("start_time"),
    db.from("invoices").select("total, status").eq("clinic_id", clinicId).gte("created_at", `${today}T00:00:00`),
    db.from("stock_items").select("name, quantity, min_quantity, unit").eq("clinic_id", clinicId),
    db.from("invoices").select("total, paid_amount").eq("clinic_id", clinicId).in("status", ["sent", "partially_paid"]),
    db.from("clinic_patients").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
    db.from("clinic_patients").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId).gte("created_at", weekAgo),
    db.from("clinic_patients").select("name").eq("clinic_id", clinicId).limit(2000),
    db.from("clinic_staff").select("name").eq("clinic_id", clinicId),
  ]);
  const rows = (appts.data ?? []) as any[];
  return {
    today, clinicName: clinic.data?.brand_name || clinic.data?.name || "the clinic",
    names: [...(pNames.data ?? []), ...(sNames.data ?? [])].map((r: any) => r.name).filter(Boolean),
    appts: rows.map((a) => ({ time: a.appointment_time, status: a.status, fee: Number(a.consultation_fee) || 0, patient: a.clinic_patients?.name ?? "Unknown", doctor: a.doctors?.name ?? "duty doctor", symptoms: a.symptoms ?? "" })),
    billed: rows.reduce((s, a) => s + (Number(a.consultation_fee) || 0), 0),
    collected: (invoices.data ?? []).filter((i: any) => i.status === "paid").reduce((s: number, i: any) => s + (Number(i.total) || 0), 0),
    low: (stock.data ?? []).filter((s: any) => s.min_quantity != null && s.quantity <= s.min_quantity).map((s: any) => ({ name: s.name, quantity: s.quantity, unit: s.unit ?? "", min: s.min_quantity })),
    unpaid: { count: (unpaid.data ?? []).length, amount: (unpaid.data ?? []).reduce((s: number, i: any) => s + Math.max(0, (Number(i.total) || 0) - (Number(i.paid_amount) || 0)), 0) },
    patients: { total: pTotal.count ?? 0, newThisWeek: pNew.count ?? 0 },
  };
}

const count = (f: ClinicFacts, st: string) => f.appts.filter((a) => a.status === st).length;

export function answerLocally(message: string, f: ClinicFacts): string | null {
  const m = message.toLowerCase();
  if (/(unpaid|pending (payment|invoice)|outstanding|dues|owe)/.test(m) && !/supplier|purchase/.test(m))
    return f.unpaid.count ? `${f.unpaid.count} invoice${f.unpaid.count > 1 ? "s are" : " is"} not fully paid, ${inr(f.unpaid.amount)} still to collect. Open Billing to follow up.` : "No unpaid invoices right now.";
  if (/(revenue|collection|collected|income|earn|sales)/.test(m))
    return `Today: ${inr(f.collected)} collected from paid invoices, ${inr(f.billed)} billed across ${f.appts.length} appointment${f.appts.length === 1 ? "" : "s"}.`;
  if (/(low stock|running low|stock|inventory|reorder)/.test(m))
    return f.low.length ? `${f.low.length} item${f.low.length > 1 ? "s are" : " is"} at or below minimum:\n${f.low.map((s) => `• ${s.name}: ${s.quantity} ${s.unit} (min ${s.min})`).join("\n")}\nYou can order them in Purchasing.` : "All stock items are above their minimum.";
  if (/(how many|number of|total|count).*(patients?)|patients?.*(count|total|registered)/.test(m))
    return `${f.patients.total} patient${f.patients.total === 1 ? "" : "s"} on record, ${f.patients.newThisWeek} registered in the last 7 days.`;
  if (/(appointments?|schedule|bookings?|who.*(coming|today)).*(today|now)?|today.*(appointments?|schedule)/.test(m) && /(today|how many|schedule|who|list|appointments?)/.test(m)) {
    if (!f.appts.length) return "No appointments today.";
    return `${f.appts.length} appointment${f.appts.length > 1 ? "s" : ""} today (${count(f, "confirmed")} confirmed, ${count(f, "completed")} completed, ${count(f, "cancelled")} cancelled, ${count(f, "no_show")} no-show):\n` +
      f.appts.slice(0, 15).map((a) => `• ${a.time} ${a.patient} with ${a.doctor} [${a.status}]`).join("\n");
  }
  return null;
}

/** What may be shown to an external model: totals and tokenised names only. No phone numbers, symptoms or conditions. */
export function deidentifiedContext(f: ClinicFacts): string {
  return `CLINIC: ${f.clinicName}
DATE: ${f.today}
APPOINTMENTS TODAY: ${f.appts.length} (confirmed ${count(f, "confirmed")}, completed ${count(f, "completed")}, cancelled ${count(f, "cancelled")}, no-show ${count(f, "no_show")})
${f.appts.slice(0, 30).map((a) => `- ${a.time}: ${a.patient} with ${a.doctor} [${a.status}] ₹${a.fee}`).join("\n")}
REVENUE TODAY: ₹${f.collected} collected, ₹${f.billed} billed
UNPAID INVOICES: ${f.unpaid.count} totalling ₹${f.unpaid.amount}
PATIENTS ON RECORD: ${f.patients.total} (${f.patients.newThisWeek} new this week)
LOW STOCK (${f.low.length}): ${f.low.map((s) => `${s.name} ${s.quantity}/${s.min}`).join("; ") || "none"}`;
}
