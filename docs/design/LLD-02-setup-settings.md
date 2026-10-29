# LLD 02: Setup, Settings, branding and stamp

## Purpose
Take a new clinic through the few things it must configure once, then let the admin change clinic details, look and privacy later.

## Screens
| Screen | What |
|---|---|
| `/setup` | Accordion of steps. Required steps decide when setup is complete; optional steps never block it |
| `/settings` | Clinic profile, price list, branding card, AI and privacy card, online booking card |
| Banner (`SetupBanner`) | Reminder on Home until setup is complete or dismissed |

## Setup steps (`src/lib/setup.ts`, `getSetupStatus`)
| Id | Required | Done when |
|---|---|---|
| profile | yes | clinic phone and address saved |
| doctors | yes | at least one active doctor |
| hours | yes | at least one doctor schedule |
| prices | yes | price list reviewed (`settings.setup.prices_reviewed`) |
| templates | yes | treatment templates reviewed (`templates_reviewed`) |
| stamp | optional | `clinics.stamp_url` is set |
| stock | optional | any stock item with quantity |
| whatsapp | optional | marked done |
| team | optional | more than one active staff |
| patient | after setup | first patient exists |

Queries are separate per table, so a missing column or table never blocks the page.

## Flow control (`src/lib/flow.ts`)
`firstRunTarget(clinicId)`: if setup is complete or dismissed → go where asked; otherwise take an admin to `/setup` once per sign-in; when everything required is done, set `completed` and go Home (`/dashboard`).

## API
| Route | Method | Who | Actions |
|---|---|---|---|
| `/api/clinic/setup` | POST | admin | `profile` (phone, address, city, specialty), `doctor` (add me or a named doctor), `flag` (prices_reviewed, templates_reviewed, whatsapp_done, completed, dismissed) |
| `/api/clinic/branding` | GET, POST | GET any member, POST admin | `save` (tagline, AI name, website, colour, web address, logo, stamp), `set_domain`, `verify_domain`, `remove_domain` |
| `/api/ai/settings` | GET, POST | admin | External AI on/off, retention days |
| `/api/online-booking` | GET, POST | admin | Fee, Razorpay keys (stored encrypted, never returned) |

## Branding and stamp
- Logo and stamp are uploaded as data URLs, checked (type, size under 1 MB, magic bytes; SVG refused) and stored in the public bucket `clinic-logos` as `<clinicId>/logo-<time>.<ext>` or `stamp-<time>.<ext>` (`saveLogo(db, clinicId, dataUrl, kind)`).
- `clinics.stamp_url` (migration 033) is read separately from the other branding columns, so branding and invoices keep working before the migration is run.
- The stamp is drawn at the bottom right of every invoice (LLD-06).
- Theme: `applyBrand()` sets colour variables with a contrast floor; `applyIdentity()` sets tab title and icon.

## Errors seen by the user
Phone under 10 digits, address under 5 characters, bad colour, taken web address ("already taken"), image too large or wrong type, missing migration ("run RUN_ME_ALL_MIGRATIONS.sql").

## Tests
`tests/e2e/mock/setup.spec.ts`, `settings.spec.ts`; unit `branding.test.ts`; SQL `branding_test.sql`.

## Data import (migration 034)
Optional Setup step "Bring your patients from another app", also at ☰ → Import data (`/import`, admin only).
- **Screen:** `PatientImport` takes a CSV (up to 5 MB, 2,000 patients at a time), guesses the column mapping from the headers (`guessMapping`), lets the admin correct it, then **Check the file** (preview, nothing saved) and **Import N patients**. A sample file can be downloaded. **Undo this import** removes the batch.
- **Pure rules** (`src/lib/import/patients.ts`, shared by screen and server): CSV reader (quotes, line breaks in quotes, `,` `;` tab, byte-order mark), phone (last 10 digits, same as the database's `phone_norm`), dates (day/month/year, ISO, "12 Mar 1985"; impossible dates refused), gender words, per-row problems (no name = skipped) and warnings (bad phone, email or date = imported without it).
- **API** `POST /api/import/patients` (admin): `preview`, `commit`, `undo`, `list`. Duplicates are matched by mobile (or name plus date of birth when there is none) against the clinic and inside the file, and are skipped, never overwritten. Inserts run in chunks of 200 under one `import_batches` row; `clinic_patients.import_batch_id` links each patient to it. Undo removes only batch patients with no appointments, invoices, treatment plans or visit notes and reports how many were kept.
- **Not covered yet:** appointment history, bills and balances, treatments, stock and price list (planned in this order).
- **Tests:** unit `tests/unit/import.test.ts`; Playwright `tests/e2e/mock/import.spec.ts`.
