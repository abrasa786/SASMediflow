/** Best-effort per-instance limiter for public endpoints (the database enforces the real per-phone limits). */
const hits = new Map<string, number[]>();
export function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) Array.from(hits.entries()).forEach(([k, v]) => { if (!v.some((t: number) => now - t < windowMs)) hits.delete(k); });
  return list.length > max;
}
export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
