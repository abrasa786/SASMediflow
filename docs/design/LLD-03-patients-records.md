# LLD 03: Patients, record pages, custom fields, deletion, list views, search

## Purpose
One consistent way to see, edit, list and delete every kind of record, and one place that shows everything about a patient.

## Screens
| Screen | What |
|---|---|
| `/patients`, `/patients/[id]` | Patient list; record page with the summary and related lists |
| `/lists/[entity]` | Shared list view for every main tab (`entity` = patients, appointments, treatments, sittings, invoices …) |
| Record pages (`RecordForm`) | Fields, save toast, custom fields, delete (dustbin) at the bottom right |

## Patient record page
`PatientSummary` (visits, billed, paid, balance due) and related lists: Appointments (+ New), Invoices (+ New), Treatments (badge Unpaid / Partly paid / Fully paid · closed, billed and paid against the estimate, "+ Add sitting", "Book next sitting"), Visit notes. Also offers and consent (`OffersConsent`).

## List engine (`src/components/ListView.tsx`, `src/lib/lists/config.tsx`)
`LISTS[entity]` declares table, search columns (plus optional `extraSearch` reaching related tables), default order, columns (render, optional), filters, the record link and the `+ New` target. The engine provides search (debounced), filters, column chooser, sort, paging and saved views (`list_views`, migration 030: per user and entity). `refreshKey` reloads after a change without remounting the page, so toasts survive.

## Custom fields
`custom_field_defs` (added by the Builder) apply to built-in records; values are saved through `POST /api/custom-fields` (roles admin, doctor, nurse, receptionist); only fields that exist for that record are accepted.

## Delete (dustbin)
`DeleteRecord` shows a confirmation dialog ("Delete this patient" → Confirm / Keep it). `POST /api/records/delete { entity, id, clinicId }` uses `DELETABLE` (`src/lib/deleteRules.ts`):
| Entity | Roles |
|---|---|
| appointments | admin, doctor, receptionist |
| clinic_patients | admin |
| invoices | admin; refused when paid or part paid ("cancel it instead") |
| treatment_templates | admin |
| stock_items | admin, nurse |
| clinic_tasks | all roles |
The row is looked up by id **and** clinic, so another clinic's record is "not found".

## Search (`GlobalSearch`)
Ctrl/⌘+K or "/" opens one box over screens, apps, patients (name or phone), invoices, doctors, stock, treatment templates, tasks and sittings. Each table is queried independently and skipped if unreadable; late answers never overwrite newer ones.

## Patient search helpers
`src/lib/booking/patient-search.ts` and `clinic.ts searchClinicPatients` match by name or normalised phone (`appt_norm_phone`); `wa_find_patients` serves WhatsApp.

## Tests
`records.spec.ts` (related lists, delete confirm/cancel), `shell.spec.ts` (List view and + New on every tab), unit `patient-search.test.ts`; SQL `patient_app_search_test.sql`.
