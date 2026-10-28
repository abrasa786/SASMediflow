/** Shared wording and colours for a treatment's money status. */
export const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export interface PlanLike { status?: string; payment_status?: string }

/** The badge for a treatment: Unpaid, Partly paid, or Fully paid (and closed once it is finished). */
export function planBadge(p: PlanLike): { text: string; cls: string } {
  if (p.status === "cancelled") return { text: "Cancelled", cls: "bg-red-100 text-red-700" };
  if (p.status === "completed" && p.payment_status === "paid") return { text: "Fully paid · closed", cls: "bg-emerald-100 text-emerald-800" };
  if (p.status === "completed") return { text: "Closed", cls: "bg-slate-100 text-slate-700" };
  if (p.payment_status === "paid") return { text: "Fully paid", cls: "bg-emerald-100 text-emerald-800" };
  if (p.payment_status === "part_paid") return { text: "Partly paid", cls: "bg-amber-100 text-amber-800" };
  return { text: "Unpaid", cls: "bg-slate-100 text-slate-700" };
}

/** One sitting's money status from what it costs and what has been paid. */
export function sittingPay(due: unknown, paid: unknown): { text: string; cls: string } {
  const d = Number(due || 0), p = Number(paid || 0);
  if (d > 0 && p >= d) return { text: "Paid", cls: "bg-emerald-100 text-emerald-800" };
  if (p > 0) return { text: "Part paid", cls: "bg-amber-100 text-amber-800" };
  return { text: "Unpaid", cls: "bg-slate-100 text-slate-700" };
}

/** Billed, paid and what is left for a treatment, from its sittings. */
export function planTotals(p: { total_amount?: number; discount?: number; treatment_sittings?: { due_amount: number; paid_amount: number; status?: string }[] }) {
  const s = (p.treatment_sittings ?? []).filter((x) => x.status !== "cancelled");
  const billed = s.reduce((n, x) => n + Number(x.due_amount || 0), 0);
  const paid = s.reduce((n, x) => n + Math.min(Number(x.paid_amount || 0), Number(x.due_amount || 0)), 0);
  const estimate = Math.max(0, Number(p.total_amount || 0) - Number(p.discount || 0));
  return { billed, paid, due: Math.max(0, billed - paid), estimate, remainingEstimate: Math.max(0, estimate - billed) };
}
