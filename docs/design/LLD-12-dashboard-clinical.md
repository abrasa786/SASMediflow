# LLD 12: Dashboard, analytics, tasks, visit notes, patient summary

## Dashboard (Home)
`/dashboard` shows the owner numbers from `GET /api/dashboard` → `dashboard_stats(clinic, actor)` (migration 012): collected vs billed, dues, utilisation, no-show rate, seven-day trend, doctor load, low stock. Money figures are hidden from interns. Home has `+ New booking`; the first-run Setup banner shows until setup is complete.

## Analytics (`/analytics`)
Period report computed in the browser from invoices and appointments: revenue, collected, by doctor and by status.

## Tasks (`/tasks`, `/tasks/[id]`, `/lists/tasks`)
`clinic_tasks`: title, status (todo, in_progress, done), priority (low, medium, high), `assigned_to`, `due_date`, `kind` (general, `order_material`, `check_material`). Every role can delete a task (dustbin).

## Visit notes (`/api/visits/note`, `src/components/VisitNotes.tsx`)
`visit_notes`: visit date, treatment, tooth, follow-up; optional "needs X before the next visit" (`order_item`, `needed_by`) that creates and keeps updating two tasks (see LLD-08). Roles: admin, doctor, nurse.

## Patient summary (`src/lib/visits/summary.ts`, `PatientSummary`)
Built by plain rules from what the clinic recorded, never written by AI, so it says only what a doctor entered: last visit, open treatment, balance, open orders. Shown at a new appointment and on the patient page.

## Learned durations (`src/lib/durations.ts`, `treatment_durations`, trigger `trg_learn_duration`)
Visit length is chosen in this order: what this clinic's real visits show (median of recent), then what the clinic set, then a starting guess by treatment kind. Nobody configures it; it learns as visits complete.

## Treatment explainers (`/t/[id]`, `treatment_info`)
Short patient-facing page per treatment, linked in messages; managed by admin and doctor.

## Tests
SQL `dashboard_test.sql`; unit `visit-summary.test.ts`, `durations.test.ts`, `visit-orders.test.ts`.
