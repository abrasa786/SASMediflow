/** Claim stages, labels and the IRDAI clocks, shared by the Claims screen and its tests. */

export type ClaimStatus = "draft" | "preauth_sent" | "query" | "approved" | "discharge_sent" | "settled" | "rejected" | "cancelled";

export const STAGES: { key: ClaimStatus; label: string; hint: string }[] = [
  { key: "draft",          label: "Getting papers",     hint: "Collect the pre-auth papers" },
  { key: "preauth_sent",   label: "Pre-auth sent",      hint: "Insurer must decide in 1 hour" },
  { key: "query",          label: "Insurer query",      hint: "Answer to restart the clock" },
  { key: "approved",       label: "Approved",           hint: "Patient admitted / treated" },
  { key: "discharge_sent", label: "Discharge sent",     hint: "Insurer must decide in 3 hours" },
  { key: "settled",        label: "Settled",            hint: "Money received" },
];

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  draft: "Getting papers", preauth_sent: "Pre-auth sent", query: "Insurer query", approved: "Approved",
  discharge_sent: "Discharge sent", settled: "Settled", rejected: "Rejected", cancelled: "Cancelled",
};

/** IRDAI Master Circular on Health Insurance (2024): 1 hour for cashless authorisation, 3 hours for final discharge authorisation. */
export const SLA_MINUTES = { preauth_sent: 60, discharge_sent: 180 } as const;

export interface ClaimClock { status: ClaimStatus; preauth_sent_at?: string | null; discharge_sent_at?: string | null }
export interface SlaState { limitMinutes: number; elapsedMinutes: number; leftMinutes: number; overdue: boolean; label: string }

/** How long the insurer has been sitting on this claim, against the IRDAI limit. Null when no clock is running. */
export function slaState(c: ClaimClock, now: Date = new Date()): SlaState | null {
  const since = c.status === "preauth_sent" ? c.preauth_sent_at : c.status === "discharge_sent" ? c.discharge_sent_at : null;
  if (!since) return null;
  const limit = SLA_MINUTES[c.status as keyof typeof SLA_MINUTES];
  const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60000));
  const left = limit - elapsed;
  return { limitMinutes: limit, elapsedMinutes: elapsed, leftMinutes: left, overdue: left < 0, label: left < 0 ? `${duration(-left)} late` : `${duration(left)} left` };
}

/** 45m, 2h 5m, 3d 4h */
export function duration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60) ? ` ${Math.floor((m % 1440) / 60)}h` : ""}`;
}

/** What a person can do next from each status, in the order buttons are shown. */
export function nextActions(s: ClaimStatus): { to: string; label: string; needs?: "approved_amount" | "billed_amount" | "settled_amount" | "note" | "message" }[] {
  switch (s) {
    case "draft":          return [{ to: "preauth_sent", label: "Send pre-auth" }, { to: "cancelled", label: "Cancel claim" }];
    case "preauth_sent":   return [{ to: "approved", label: "Mark approved", needs: "approved_amount" }, { to: "query", label: "Insurer asked a question", needs: "message" }, { to: "rejected", label: "Mark rejected", needs: "note" }];
    case "query":          return [{ to: "reply", label: "We replied", needs: "message" }];
    case "approved":       return [{ to: "discharge_sent", label: "Send for discharge", needs: "billed_amount" }, { to: "cancelled", label: "Cancel claim" }];
    case "discharge_sent": return [{ to: "settled", label: "Mark paid", needs: "settled_amount" }, { to: "query", label: "Insurer asked a question", needs: "message" }, { to: "rejected", label: "Mark rejected", needs: "note" }];
    case "rejected":       return [{ to: "preauth_sent", label: "Resubmit pre-auth" }];
    default:               return [];
  }
}

export const DEDUCTION_CATEGORIES: Record<string, string> = {
  non_payable: "Non-payable items", room_rent: "Room rent limit", co_pay: "Co-payment", tariff: "Above agreed tariff",
  documentation: "Missing papers", policy_limit: "Policy limit / sub-limit", other: "Other",
};
