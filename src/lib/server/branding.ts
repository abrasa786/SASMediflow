import { randomBytes } from "crypto";
import { promises as dns } from "dns";
import { HttpError } from "./http";

export const RESERVED_SLUGS = ["www", "app", "api", "admin", "login", "signup", "demo", "c", "setup", "dashboard", "static", "mail", "help", "support", "billing", "settings"];
const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 38);

export function checkSlug(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!SLUG.test(s)) throw new HttpError(400, "The web address can use letters, numbers and dashes only (3 to 40 characters).");
  if (RESERVED_SLUGS.includes(s)) throw new HttpError(400, `"${s}" is reserved. Choose another web address.`);
  return s;
}

export function platformHosts(): string[] {
  const hosts = (process.env.PLATFORM_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  try { if (process.env.NEXT_PUBLIC_APP_URL) hosts.push(new URL(process.env.NEXT_PUBLIC_APP_URL).host.toLowerCase()); } catch { /* ignore */ }
  return hosts;
}

export function checkDomain(raw: unknown): string {
  const d = String(raw ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (!HOST.test(d)) throw new HttpError(400, "Enter a domain like clinic.yourname.com (no https:// or slashes).");
  if (d.endsWith(".vercel.app") || d.endsWith(".supabase.co") || platformHosts().includes(d)) throw new HttpError(400, "That address belongs to the platform. Use your own domain.");
  return d;
}

export const newDomainToken = () => "mediflow-verify=" + randomBytes(16).toString("hex");

/** Checks the TXT record `_mediflow.<domain>` for the clinic's token, and reports whether traffic already reaches us. */
export async function verifyDomainDns(domain: string, token: string): Promise<{ owned: boolean; pointing: boolean; found: string[] }> {
  const r = new dns.Resolver(); r.setServers(["1.1.1.1", "8.8.8.8"]);
  let found: string[] = [];
  try { found = (await r.resolveTxt(`_mediflow.${domain}`)).map((x) => x.join("")); } catch { /* no record yet */ }
  let pointing = false;
  try { pointing = (await r.resolveCname(domain)).some((c) => /vercel-dns\.com\.?$/i.test(c)); } catch { /* not a CNAME */ }
  if (!pointing) { try { pointing = (await r.resolve4(domain)).includes("76.76.21.21"); } catch { /* no A */ } }
  return { owned: found.includes(token), pointing, found };
}

/** Optionally registers the domain with the Vercel project so HTTPS is issued automatically. */
export async function addDomainToVercel(domain: string): Promise<{ configured: boolean; ok?: boolean; error?: string }> {
  const token = process.env.VERCEL_API_TOKEN, project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return { configured: false };
  try {
    const q = process.env.VERCEL_TEAM_ID ? `?teamId=${process.env.VERCEL_TEAM_ID}` : "";
    const res = await fetch(`https://api.vercel.com/v10/projects/${project}/domains${q}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: domain }), signal: AbortSignal.timeout(8000),
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok || j?.error?.code === "domain_already_in_use" && /this project/i.test(j?.error?.message ?? "")) return { configured: true, ok: true };
    return { configured: true, ok: false, error: j?.error?.message ?? `Vercel returned ${res.status}` };
  } catch (e: any) { return { configured: true, ok: false, error: e.message }; }
}

const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  "image/png": { ext: "png", magic: (b) => b.length > 8 && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  "image/jpeg": { ext: "jpg", magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 },
  "image/webp": { ext: "webp", magic: (b) => b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
};
export const MAX_LOGO_BYTES = 1024 * 1024;

/** Stores a logo (PNG/JPG/WebP up to 1 MB; SVG is refused because it can carry scripts) and returns its public URL. */
export async function saveLogo(db: any, clinicId: string, dataUrl: string): Promise<string> {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
  if (!m) throw new HttpError(400, "The logo must be a PNG, JPG or WebP image.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > MAX_LOGO_BYTES) throw new HttpError(400, "The logo is too large. Use an image under 1 MB.");
  const t = TYPES[m[1]];
  if (!t.magic(buf)) throw new HttpError(400, "That file is not a valid image.");
  await db.storage.createBucket("clinic-logos", { public: true, fileSizeLimit: MAX_LOGO_BYTES, allowedMimeTypes: Object.keys(TYPES) }).catch(() => null);
  const path = `${clinicId}/logo-${Date.now()}.${t.ext}`;
  const { error } = await db.storage.from("clinic-logos").upload(path, buf, { contentType: m[1], upsert: false, cacheControl: "31536000" });
  if (error) throw new HttpError(500, "Could not store the logo: " + error.message);
  return db.storage.from("clinic-logos").getPublicUrl(path).data.publicUrl;
}

export function checkColor(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(String(raw))) throw new HttpError(400, "Choose a colour like #0ea5e9.");
  return String(raw).toLowerCase();
}
