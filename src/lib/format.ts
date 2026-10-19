/** Formatting helpers shared by every screen. Keep all money/date display rules here. */

/** ₹1,23,456.5 (Indian digit grouping, up to 2 decimals). */
export const inr = (n: unknown) => "₹" + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** Today's date in the viewer's own timezone as YYYY-MM-DD (for <input type="date"> and comparisons). */
export const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** "5 Mar 2026" from a YYYY-MM-DD string, without the timezone shifting the day. */
export const dayLabel = (iso?: string | null, withYear = true) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }) : "–";
