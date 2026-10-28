# Mediflow design documents

High-level design (HLD) and low-level design (LLD) for everything built so far. The older `docs/HLD.md`, `docs/MODULES.md` and `docs/ARCHITECTURE.md` are kept; these files are the current, fuller set.

| File | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full functional and non-functional architecture: actors, capability map, flows, security, performance, availability, known gaps |
| [HLD.md](HLD.md) | Whole-system picture: context, layers, modules, data, security, deployment, scheduled jobs |
| [LLD-01-platform.md](LLD-01-platform.md) | Sign-in, clinics, roles, API helpers, errors, domains, rate limits |
| [LLD-02-setup-settings.md](LLD-02-setup-settings.md) | First-run Setup, Settings, branding, clinic stamp |
| [LLD-03-patients-records.md](LLD-03-patients-records.md) | Patients, record pages, custom fields, delete rules, list views, search |
| [LLD-04-appointments-booking.md](LLD-04-appointments-booking.md) | Booking engine, slots, calendar, online booking and payment |
| [LLD-05-treatments-sittings.md](LLD-05-treatments-sittings.md) | Treatments, sittings, equipment, part payment, templates |
| [LLD-06-billing-invoices.md](LLD-06-billing-invoices.md) | Invoices, payments, PDF, sending |
| [LLD-07-messaging.md](LLD-07-messaging.md) | WhatsApp, email, reminders, recall, offers and consent |
| [LLD-08-stock-purchasing.md](LLD-08-stock-purchasing.md) | Stock, suppliers, purchase orders, bills, order reminders |
| [LLD-09-team-attendance-leave.md](LLD-09-team-attendance-leave.md) | Staff, users, availability, attendance, leave |
| [LLD-10-ai-assistant.md](LLD-10-ai-assistant.md) | Assistant, trust layer, memory, privacy |
| [LLD-11-builder-apps-flows.md](LLD-11-builder-apps-flows.md) | AI Builder, apps and tabs, flows, reports |
| [LLD-12-dashboard-clinical.md](LLD-12-dashboard-clinical.md) | Dashboard, analytics, tasks, visit notes, patient summary |
| [LLD-13-ui-shell.md](LLD-13-ui-shell.md) | Layout, tabs, menu, list engine, modals, toasts, devices |
| [LLD-14-testing-operations.md](LLD-14-testing-operations.md) | Tests, migrations, cron jobs, environment, runbook |
| [ROADMAP.md](ROADMAP.md) | Decided next steps: WhatsApp per clinic, usage billing, spam controls, offline |

Conventions: every API route returns JSON and a readable error message; every table has `clinic_id`; rules live in database functions (`tx_*`, `appt_*`, …) so the same rule applies from every screen.
