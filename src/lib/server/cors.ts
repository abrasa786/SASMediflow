/**
 * Which websites may call the public booking/search services from a browser: the Mediflow patient app.
 * Set PATIENT_APP_ORIGINS (comma separated, e.g. https://app.mediflow.in) in hosting. http://localhost:3000 is always allowed for development.
 * These services carry no cookies and no private data, so this only decides which sites a browser lets read the answers.
 */
export function allowedOrigins(env: string | undefined = process.env.PATIENT_APP_ORIGINS): string[] {
  return Array.from(new Set(["http://localhost:3000", ...(env ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter((o) => /^https?:\/\/[^/\s]+$/i.test(o))]));
}

export function corsHeaders(origin: string | null, env?: string): Record<string, string> | null {
  if (!origin || !allowedOrigins(env).includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
