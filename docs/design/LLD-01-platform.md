# LLD 01: Platform (accounts, tenancy, API foundation)

## Purpose
Create clinics and users, keep each clinic's data separate, and give every API route one safe way to authenticate, authorise and fail.

## Screens
`/signup`, `/login`, `/reset-password`, `/profile` (own name, phone, password; email changes only with a one-time code), `/users`.

## API
| Route | Method | Who | Does |
|---|---|---|---|
| `/api/clinic/create` | POST | public (rate-limited) | Validates brand, web address and AI name first, creates the user, the clinic, the admin membership and defaults (`clinic_provision`) |
| `/api/auth/resend` | POST | public | Re-sends the confirmation email; always answers generically so it cannot reveal which emails exist |
| `/api/users` | GET, PATCH, DELETE | any member reads; admin changes | List users of the clinic; PATCH (admin) sets a temporary password for another member; DELETE removes a member (`users_remove`) |
| `/api/health` | GET | monitor or cron secret | Reports what is configured, never the values |

## Server helpers (`src/lib/server`)
| File | Role |
|---|---|
| `auth.ts` | `requireClinicMember(req, clinicId, roles?)` verifies the bearer token, finds the active `clinic_staff` row, checks the role, returns `{ db, userId, role }` (a service-role client used only after the check) |
| `http.ts` | `handle(fn)` wraps every route: turns `HttpError` into JSON `{error}` with the right status, unknown errors into a safe 500; `HttpError(status, message)` |
| `rpc.ts` | `throwRpc(error)` converts database errors of the form `CODE: message` into HTTP errors (`FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION`/`INVALID` 400, `CONFLICT` 409 …); unknown codes show the raw reason; "function not found" becomes "The database is missing an update… run the latest migration" |
| `ratelimit.ts` | `tooMany(key, max, windowMs)` per-instance limiter for public endpoints; `clientIp` |
| `cors.ts` | CORS only for the patient app on `/api/public/*` |
| `appurl.ts` | Base URL for links in messages |

Client side: `src/lib/api.ts` `authFetch(path, {body})` adds the token and throws `Error(message)` with the server's text; `src/lib/auth.ts` holds the active clinic id; `src/lib/supabase.ts` is the browser client (row-level security applies).

## Roles
admin (everything), doctor (clinical, own schedule), nurse (clinical help, stock), receptionist (front desk, billing), intern (read only). Each route lists its allowed roles; the table in `docs/design/HLD.md` §6 explains isolation.

## Domains and middleware (`src/middleware.ts`)
A clinic's own domain shows its public page at `/`; other paths work unchanged. `PLATFORM_HOSTS`, `ROOT_DOMAIN` (subdomains per clinic) and `CANONICAL_HOST` (redirect from `*.vercel.app`) are optional environment variables. Domain ownership is proven by a TXT record `_mediflow.<domain>` (see LLD-02).

## Error handling rules
1. Server returns `{ error: "readable text" }`; the screen shows it inline (`role="alert"`), never a blank failure.
2. Pages are wrapped in `Boundary`; `src/app/error.tsx` and `not-found.tsx` catch the rest.
3. Network failures show "could not reach the server" style messages, not stack traces.

## Tests
`tests/unit/architecture.test.ts` (auth on every route), `supabase/tests/tenant_and_treatments_test.sql`, `users_test.sql`, Playwright `shell.spec.ts`.
