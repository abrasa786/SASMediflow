import { NextRequest, NextResponse } from "next/server";

/**
 * A clinic's own domain (e.g. appointments.yourclinic.com) shows that clinic's public page at "/".
 * Every other path (login, app, API) works unchanged on any domain. The clinic is looked up at runtime,
 * so nothing here touches the database.
 */
const PLATFORM = (process.env.PLATFORM_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
try { if (process.env.NEXT_PUBLIC_APP_URL) PLATFORM.push(new URL(process.env.NEXT_PUBLIC_APP_URL).host.toLowerCase()); } catch { /* ignore */ }

/** Set ROOT_DOMAIN (e.g. mediflow.in) so every clinic also gets www.<clinic>.mediflow.in and <clinic>.mediflow.in. */
const ROOT = (process.env.ROOT_DOMAIN ?? "").trim().toLowerCase();
const RESERVED = new Set(["www", "app", "api", "admin", "mail"]);

/** Set CANONICAL_HOST (e.g. app.mediflow.in) and anyone who opens the *.vercel.app address is sent to it, on every path. */
const CANONICAL = (process.env.CANONICAL_HOST ?? "").trim().toLowerCase();

export function middleware(req: NextRequest) {
  const h = (req.headers.get("host") ?? "").toLowerCase();
  if (CANONICAL && h.endsWith(".vercel.app")) {
    const u = req.nextUrl.clone(); u.protocol = "https"; u.host = CANONICAL; u.port = "";
    return NextResponse.redirect(u, 308);
  }
  if (req.nextUrl.pathname !== "/") return NextResponse.next();
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (ROOT && host.endsWith("." + ROOT)) {
    const sub = host.slice(0, -ROOT.length - 1).replace(/^www\./, "");
    if (!sub || RESERVED.has(sub) || sub.includes(".")) return NextResponse.next();
    const u = req.nextUrl.clone(); u.pathname = "/c/" + sub; return NextResponse.rewrite(u);
  }
  if (ROOT && (host === ROOT || host === "www." + ROOT)) return NextResponse.next();
  const isPlatform = !host || host.startsWith("localhost") || host.endsWith(".vercel.app") || PLATFORM.includes(host);
  if (isPlatform) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/c/_host";
  return NextResponse.rewrite(url);
}

export const config = { matcher: ["/((?!_next/|favicon.ico|api/).*)"] };
