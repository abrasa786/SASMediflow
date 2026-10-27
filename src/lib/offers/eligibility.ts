/** Who may be sent a tip or offer. The same rule runs in the page (to show it) and on the server (to enforce it). */
export const OFFER_GAP_DAYS = 30;     // at most one message per patient per this many days
export const OFFER_BATCH = 25;        // patients per request, so a send never times out

export type Eligibility = "ok" | "off" | "no_phone" | "recent";

export function classify(p: { phone?: string | null; marketing_opt_in?: boolean | null }, messagedRecently: boolean): Eligibility {
  if (!p.marketing_opt_in) return "off";                                            // never said yes, or said STOP
  if ((p.phone ?? "").replace(/\D/g, "").length < 10) return "no_phone";
  if (messagedRecently) return "recent";
  return "ok";
}

export const REASON: Record<Eligibility, string> = {
  ok: "Can be sent", off: "Offers switched off", no_phone: "No valid phone number", recent: `Messaged in the last ${OFFER_GAP_DAYS} days`,
};
