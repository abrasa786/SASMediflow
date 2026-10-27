/** The public address of the app, for links in emails. Never a per-deployment preview address: those sit behind Vercel's login, which is what verify-email links were opening. */
export function appBase(origin: string): string {
  const pick = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")
    || origin;
  return pick.replace(/\/$/, "");
}
