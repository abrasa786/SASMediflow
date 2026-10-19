# Testing

Everything below runs in CI on every push (`.github/workflows/ci.yml`) and locally with the commands shown.

| Layer | Command | What it proves |
|---|---|---|
| Types | `npm run typecheck` | No type errors anywhere |
| Lint | `npm run lint` | No lint errors (the build fails on errors) |
| Unit + architecture | `npm run test:unit` | Parsers, branding rules, the **scope guard**, and the architecture rules: only the gateway calls the AI provider; browser code never uses the service role; every API route checks the caller; no hard-coded keys |
| Database | `npm run test:db` | Starts from a blank Postgres, runs **every migration**, runs them **again** (re-runnable), then every SQL test |
| Build | `npm run build` | Production build compiles |
| Browser | `npm run test:e2e` | Public pages, sign-in redirects, anonymous API refusal, branded page, load and typing budgets |

`test:db` needs a Postgres reachable through `PGHOST/PGUSER/PGPASSWORD` (the script creates and drops its own database). `test:e2e` needs `npm run build` first and Chromium (`npx playwright install chromium`).

## What the database tests cover

| File | Covers |
|---|---|
| `tenant_and_treatments_test.sql` | Cross-clinic links refused; per-clinic invoice numbers; treatment plans, ordering, stock deduction, part payments; RLS isolation between two clinics; intern read-only |
| `purchasing_attendance_leave_test.sql` | Purchase orders → receipt → stock; supplier bills; check-in/out rules; leave balance, overlap, approval |
| `branding_test.sql` | Slugs, colours, domain verification, public clinic view, AI name |
| `builder_access_test.sql` | Permission sets, own-vs-all records, report access, saved reports |
| `ai_trust_test.sql` | Questionnaire isolation, policy, rate limit, delete scopes, retention purge |
| `users_test.sql` | Only an admin can delete a user; not yourself; never the last admin; other clinics untouched; history kept; removal audited |

## Results recorded on 19 Oct 2026 (sandbox, Postgres 16, Node 22)

| Check | Result |
|---|---|
| Type check | clean |
| Lint | 0 errors (warnings only: `any` types in server helpers) |
| Unit + architecture | 18 passed, 0 failed |
| Database (11 migrations, re-run, 6 SQL test files) | all passed |
| Production build | succeeded |
| Browser (Chromium) | 11 passed, 0 failed |

## Not covered

- **Signed-in flows against a live Supabase** (sign-up email, booking through the UI, invoices) are not automated; the sandbox cannot reach your Supabase project. The rule functions behind them are covered by the SQL tests; the screens by type checks and the build. Before launch, walk the script in `docs/VIDEO.md` once on staging with a throwaway clinic.
- **External AI answers** are not tested against the real provider (needs your key). The gateway's scope, redaction and policy checks are unit and DB tested.
- **Load testing** has not been done. Add k6 against a staging project before a large rollout.
