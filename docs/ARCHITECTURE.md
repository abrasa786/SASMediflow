# Architecture

Mediflow is a multi-tenant clinic platform. One deployment serves many clinics. The design follows four rules, and each rule is enforced by a test, not by convention.

## Layers

```
Browser (Next.js pages, React)             src/app/**/page.tsx, src/components
   │  authFetch(): bearer token
API routes (thin controllers)              src/app/api/**/route.ts
   │  handle() → requireClinicMember(role)  src/lib/server/{http,auth,rpc}.ts
Domain services                            src/lib/{booking,builder,ai}
   │  one RPC call per business action
Postgres (Supabase)                        supabase/migrations/*.sql
      tables + RLS + SECURITY DEFINER functions (the business rules)
```

| Layer | Owns | Must not |
|---|---|---|
| Page | Layout, forms, calling `authFetch` | Hold secrets, call the service-role client, contain business rules |
| API route | Who is calling (`requireClinicMember`), input checks, mapping errors to HTTP | Write SQL for multi-step actions |
| Domain service | Parsing, planning, AI gateway, notifications | Skip the auth check of its route |
| Database function | The rule itself (slot is free, stock cannot go negative, last admin stays) and its transaction | Trust the caller: every function re-checks clinic and role |

Business rules live in the database so that no route, script or future screen can bypass them. A booking made through the AI chat, the calendar or the API all pass through the same `appt_book` function.

## The four rules (and the test that guards each)

1. **A clinic only ever sees its own data.** Every table carries `clinic_id`; row-level security uses `is_clinic_staff` / `is_clinic_role`; cross-clinic links are refused by `tenant_guard` triggers and composite foreign keys. Guard: `supabase/tests/tenant_and_treatments_test.sql`, `tenant_isolation_audit()`.
2. **Only the AI gateway talks to an AI provider.** Guard: `tests/unit/architecture.test.ts`.
3. **Every API route checks the caller** (or is on a short, named public list). Guard: same test.
4. **Broken code cannot ship.** Type and lint errors fail the build; CI runs type check, lint, unit, database, build and browser tests on every push (`.github/workflows/ci.yml`).

## Conventions

- **Errors from the database** are `CODE: message` (`FORBIDDEN`, `NOT_FOUND`, `NOT_ALLOWED`, `ALREADY`, `OVERLAP`, `BALANCE`, `ORDER`, `SLOT_UNAVAILABLE`, `TENANT_MISMATCH`). `throwRpc()` maps them to 403/404/409/400; the screen shows the message as written.
- **Numbering** (invoices, purchase orders) is per clinic from `doc_counters`, race-free.
- **Money** is `numeric`, shown with `src/lib/format.ts` (₹, Indian grouping).
- **Theming**: one accent scale (`sky-*`) driven by CSS variables; `applyBrand()` swaps it for the clinic's colour.
- **Migrations** are numbered, re-runnable, and tested from a blank database and again on top of themselves.
- **No silent removal**: features are only added; builder changes can be undone through change history.

## Decisions (ADR summary)

| # | Decision | Why |
|---|---|---|
| 1 | Shared database, `clinic_id` + RLS, not a database per clinic | Cheap to run, one deploy; isolation is tested and audited |
| 2 | Business rules as SECURITY DEFINER functions, callable only by the service role | One enforcement point; atomic; testable in plain SQL |
| 3 | API routes use the service role but must call `requireClinicMember` first | Lets functions be revoked from browsers entirely |
| 4 | Builder objects are real per-clinic tables (`tenant_data`), not JSON blobs | Real reporting, constraints and access control |
| 5 | AI via a single gateway with redaction, rate limit and scope guard | One place to audit what could leave the system |
| 6 | The AI's memory is our `ai_questionnaire` table, not the provider | Deleting a row makes the assistant forget |
| 7 | Vercel + Supabase, no servers of our own | Small team, managed patching and backups |

See `docs/HLD.md` for the system view, `docs/MODULES.md` for per-module design, `docs/SECURITY.md` for protection layers, and `docs/TESTING.md` for results.
