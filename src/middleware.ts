import { NextRequest, NextResponse } from "next/server";

/**
 * A clinic's own domain (e.g. appointments.yourclinic.com) shows that clinic's public page at "/".
 * Every other path (login, app, API) works unchanged on any domain. The clinic is looked up at runtime,
 * so nothing here touches the database.
 */
const PLATFORM = (process.env.PLATFORM_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
try { if (process.env.NEXT_PUBLIC_APP_URL) PLATFORM.push(new URL(process.env.NEXT_PUBLIC_APP_URL).host.toLowerCase()); } catch { /* ignore */ }

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname !== "/") return NextResponse.next();
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isPlatform = !host || host.startsWith("localhost") || host.endsWith(".vercel.app") || PLATFORM.includes(host);
  if (isPlatform) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/c/_host";
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/"] };
