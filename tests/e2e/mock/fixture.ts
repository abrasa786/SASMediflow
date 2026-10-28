import { test as base, expect, type Page, type Route } from "@playwright/test";

/**
 * A fake backend for the browser tests, so every screen can be tested with no real logins, no real database and no real WhatsApp.
 *  - Supabase REST calls (/rest/v1/<table>) are answered from `db` (supports eq/neq/in/is filters, order, limit, head counts, insert/update/delete).
 *  - Our own /api calls are answered by `app.api("POST /api/x", handler)`; anything not mocked answers {ok:true}. Every call is recorded in `app.calls`.
 *  - Any uncaught JavaScript error on a page fails the test (regression guard).
 */
export const CID = "11111111-1111-4111-8111-111111111111";
export const PID = "22222222-2222-4222-8222-222222222222";
export const AID = "33333333-3333-4333-8333-333333333333";
export const IID = "44444444-4444-4444-8444-444444444444";
export const DID = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, any>;
export interface Call { method: string; path: string; body: any }
export type Handler = (call: Call) => { status?: number; json?: unknown; delayMs?: number } | Promise<{ status?: number; json?: unknown; delayMs?: number }>;

export function seed(): Record<string, Row[]> {
  return {
    clinics: [{ id: CID, name: "Demo Dental Clinic", brand_name: "Demo Dental", specialty: "Dentistry", phone: "", address: "", city: "", email: "", website: "", gst_number: "", primary_color: "#0ea5e9", enabled_apps: [], ai_name: "Assistant", working_hours: { days: ["Monday"], open: "09:00", close: "18:00" }, settings: { setup: {} } }],
    clinic_staff: [{ id: CID, clinic_id: CID, user_id: CID, role: "admin", is_active: true, name: "Dr. Demo", specialty: "Dentistry" }],
    doctors: [], doctor_schedules: [], stock_items: [{ id: "66666666-6666-4666-8666-666666666666", clinic_id: CID, name: "Gloves", quantity: 10, unit: "pcs" }], price_list: [], treatment_templates: [],
    clinic_patients: [{ id: PID, clinic_id: CID, name: "Abdul Rahim", phone: "9187983647", email: "", allergies: "", is_active: true }],
    appointments: [{ id: AID, clinic_id: CID, clinic_patient_id: PID, appointment_date: "2026-10-27", appointment_time: "10:00:00", status: "completed", doctors: { name: "Dr. Anil" } }],
    invoices: [{ id: IID, clinic_id: CID, clinic_patient_id: PID, appointment_id: AID, invoice_number: "INV-2026-0003", status: "sent", total: 15200, subtotal: 15200, discount: 0, gst_percent: 0, gst_amount: 0, paid_amount: 0, created_at: "2026-10-27T10:00:00Z",
      items: [{ description: "Dental implant (3 stages) · Implant placement", qty: 1, price: 15200, amount: 15200 }], clinic_patients: { name: "Abdul Rahim", phone: "9187983647", email: "" } }],
    treatment_plans: [], treatment_sittings: [], visit_notes: [], list_views: [], ai_memory: [],
  };
}

const jwt = () => { const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b({ sub: CID, exp: 4102444800, role: "authenticated" })}.sig`; };
const session = () => ({ access_token: jwt(), refresh_token: "r", expires_at: 4102444800, expires_in: 99999, token_type: "bearer", user: { id: CID, email: "admin@demo.com", aud: "authenticated", app_metadata: {}, user_metadata: {} } });

function applyFilters(rows: Row[], params: URLSearchParams): Row[] {
  let out = rows;
  params.forEach((v, k) => {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) return;
    const m = /^(eq|neq|gt|gte|lt|lte|in|is|ilike|like)\.(.*)$/.exec(v); if (!m) return;
    const [, op, val] = m;
    out = out.filter((r) => {
      const x = r[k];
      if (op === "eq") return String(x) === val;
      if (op === "neq") return String(x) !== val;
      if (op === "gt") return Number(x) > Number(val);
      if (op === "gte") return Number(x) >= Number(val);
      if (op === "lt") return Number(x) < Number(val);
      if (op === "lte") return Number(x) <= Number(val);
      if (op === "is") return val === "null" ? x == null : String(x) === val;
      if (op === "in") return val.replace(/[()"]/g, "").split(",").includes(String(x));
      if (op === "ilike" || op === "like") return String(x ?? "").toLowerCase().includes(val.replace(/%/g, "").toLowerCase());
      return true;
    });
  });
  const ord = params.get("order");
  if (ord) { const [col, dir] = ord.split("."); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === "desc" ? -1 : 1)); }
  const lim = Number(params.get("limit")); if (lim) out = out.slice(0, lim);
  return out;
}

export class App {
  db = seed(); calls: Call[] = []; errors: string[] = [];
  private handlers = new Map<string, Handler>();
  api(key: string, h: Handler) { this.handlers.set(key, h); }
  called(path: string) { return this.calls.filter((c) => c.path === path); }

  async attach(page: Page, signedIn = true) {
    const ctx = page.context();
    if (signedIn) {
      const cookie = "base64-" + Buffer.from(JSON.stringify(session())).toString("base64url");
      await ctx.addCookies([{ name: "sb-127-auth-token", value: cookie, url: "http://localhost:3100" }, { name: "sb-127-auth-token", value: cookie, url: "http://127.0.0.1:3100" }]);
      await page.addInitScript(([id]) => {
        localStorage.setItem("mf_active_clinic", id as string);
        sessionStorage.setItem("mf_shell_" + id, JSON.stringify({ clinic: { id, name: "Demo Dental Clinic", specialty: "Dentistry", primary_color: "#0ea5e9", enabled_apps: [] }, role: "admin", email: "admin@demo.com", t: Date.now() }));
      }, [CID]);
    }
    page.on("pageerror", (e) => this.errors.push(`${page.url()} → ${e.message}`));
    await ctx.route("**/auth/v1/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(/\/user/.test(r.request().url()) ? session().user : session()) }));
    await ctx.route("**/rest/v1/**", (r) => this.rest(r));
    await ctx.route("**/api/**", (r) => this.apiRoute(r));
  }

  private async rest(r: Route) {
    const req = r.request(), url = new URL(req.url()), table = url.pathname.split("/").pop()!, method = req.method();
    const rows = (this.db[table] ??= []);
    const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();
    if (method === "GET" || method === "HEAD") {
      const found = applyFilters(rows, url.searchParams);
      const obj = /object\+json/.test(req.headers()["accept"] ?? "");
      const headers = { "content-range": `0-${Math.max(0, found.length - 1)}/${found.length}` };
      if (method === "HEAD") return r.fulfill({ status: 200, headers, body: "" });
      if (obj) return found.length ? r.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(found[0]) }) : r.fulfill({ status: 406, contentType: "application/json", body: JSON.stringify({ code: "PGRST116", message: "no rows" }) });
      return r.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(found) });
    }
    this.calls.push({ method, path: `/rest/v1/${table}`, body });
    const wantsRow = /return=representation/.test(req.headers()["prefer"] ?? "");
    if (method === "POST") { const add = (Array.isArray(body) ? body : [body]).map((x: Row) => ({ id: crypto.randomUUID(), clinic_id: CID, ...x })); rows.push(...add); return r.fulfill({ status: 201, contentType: "application/json", body: wantsRow ? JSON.stringify(Array.isArray(body) ? add : add[0]) : "" }); }
    if (method === "PATCH") { const hit = applyFilters(rows, url.searchParams); hit.forEach((x) => Object.assign(x, body)); return r.fulfill({ status: 200, contentType: "application/json", body: wantsRow ? JSON.stringify(hit) : "" }); }
    if (method === "DELETE") { const hit = new Set(applyFilters(rows, url.searchParams)); this.db[table] = rows.filter((x) => !hit.has(x)); return r.fulfill({ status: 204, body: "" }); }
    return r.fulfill({ status: 200, body: "[]" });
  }

  private defaults: Record<string, unknown> = {
    "/api/ai/settings": { policy: { external_enabled: false, retention_days: 30 }, provider_configured: false, encrypted_at_rest: true },
    "/api/online-booking": { enabled: false, config: {} },
  };

  private async apiRoute(r: Route) {
    const req = r.request(), url = new URL(req.url());
    if (!/\/api\//.test(url.pathname) || url.origin.includes("supabase")) return r.fallback();
    const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();
    const call: Call = { method: req.method(), path: url.pathname, body };
    this.calls.push(call);
    const h = this.handlers.get(`${call.method} ${call.path}`) ?? this.handlers.get(call.path);
    const out = h ? await h(call) : { json: this.defaults[url.pathname] ?? { ok: true, rows: [], items: [] } };
    if (out.delayMs) await new Promise((x) => setTimeout(x, out.delayMs));
    return r.fulfill({ status: out.status ?? 200, contentType: "application/json", body: JSON.stringify(out.json ?? { ok: true }) });
  }
}

export const test = base.extend<{ app: App }>({
  app: [async ({ page }, use) => {
    const app = new App(); await app.attach(page); await use(app);
    expect(app.errors, "uncaught JavaScript errors on the page").toEqual([]);
  }, { auto: true }],
});
/** For tests that need to start signed out: no automatic fake login. */
export const bare = base;
export { expect };
