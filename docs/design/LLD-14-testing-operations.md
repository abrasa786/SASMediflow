# LLD 14: Testing and operations

## Tests
| Layer | Command | Notes |
|---|---|---|
| Types, lint | `npm run typecheck`, `npm run lint` | Build fails on errors |
| Unit and architecture | `npm test` | Parsers, rules, scope guard, auth on every route, only the gateway calls an AI provider |
| Database | `bash scripts/test-db.sh` (needs `PGHOST`, `PGPORT`, `PGUSER`) | Blank Postgres, all migrations twice, then every file in `supabase/tests` |
| Build | `next build` with dummy Supabase variables | Required before every push |
| Browser (mock) | `npx playwright test --project=mock` | Fake backend (`tests/e2e/mock/fixture.ts`): functional, negative, regression, 7-device matrix (280 to 1440 px). Needs the app built with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` |
| Browser (real) | `npm run test:e2e` | Public pages, redirects, anonymous refusal, load and typing budgets |

## Migrations
Numbered in `supabase/migrations`, additive and re-runnable. `supabase/RUN_ME_ALL_MIGRATIONS.sql` is all of them plus a final security sweep (row-level security on every public table). After running: `notify pgrst, 'reload schema';`.

## Environment (names only; values never in the repo)
Supabase URL, anon key, service-role key; `NEXT_PUBLIC_APP_URL`; `CRON_SECRET`; `AI_DATA_KEY`; optional AI key; WhatsApp (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, templates); email (Resend); `PLATFORM_HOSTS`, `ROOT_DOMAIN`, `CANONICAL_HOST`; Vercel domain API variables. Details in `.env.example`.

## Release checklist
1. `npm test`, `next build` (dummy env), SQL tests, Playwright suite.
2. Commit with the Co-Authored-By and Claude-Session lines; push to `main`.
3. Owner: run the master SQL if a new migration was added.
4. Check `GET /api/health`.

## Runbook
See `docs/HLD.md` §6 table plus: a "database is missing an update" message → run the master SQL; WhatsApp "tap to send" shown → WhatsApp not connected (see ROADMAP); an exposed key → rotate in the provider and update Vercel.

## Monitoring
`/api/health` for uptime checks; Vercel logs for server errors; `appointment_notifications`, `offer_sends`, `recall_log`, `flow_runs` for message and automation outcomes.
