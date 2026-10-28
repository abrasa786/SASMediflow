# LLD 07: Messaging (WhatsApp, email, reminders, recall, offers)

## Purpose
Tell patients and doctors what is happening, bring patients back, and let patients reply, without staff retyping anything.

## Channels
| Channel | Code | Configured by |
|---|---|---|
| WhatsApp Cloud API | `src/lib/booking/notify.ts` (`sendViaCloudApi`, `sendDocumentViaCloudApi`), `src/lib/whatsapp.ts` | `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, templates `WHATSAPP_TEMPLATE_<KIND>_<RECIPIENT>`, `WHATSAPP_TEMPLATE_LANG` |
| Email | `src/lib/email.ts` | Resend (`emailConfigured()`) |
| Phone calendar | `/api/appointments/calendar` | link inside messages adds the appointment and reminders to the patient's phone |

## Appointment notifications (`notifyAppointment(db, clinicId, details, kind, only?)`)
Kinds: confirmation, reschedule, cancellation, reminder, no_show. `buildMessages` returns one text for the patient and one for the doctor. `deliver()` per recipient:
1. No valid phone → `skipped` with a reason ("Doctor has no phone number saved").
2. WhatsApp not configured → `link` (a `wa.me` link the staff taps).
3. Configured → send via Cloud API (template when `WHATSAPP_TEMPLATE_<KIND>_<RECIPIENT>` is set; template variables in order: patient name, date, time, doctor, clinic); on failure → `failed` with the reason and a fallback link.
4. Every attempt is logged in `appointment_notifications` (recipient, kind, channel, status, provider id, error). Notifying never throws; the booking is already saved.
Email copy goes to a patient with an address when email is set up.
Callers: book, reschedule, status (cancel), notify (Remind button), treatments create, chatbot, online booking, WhatsApp inbound (doctor copies).

## Meta rule that shapes the design
Free-form WhatsApp text only reaches a person who messaged the number in the last 24 hours. First contact (confirmations, reminders, invoices to patients; every message to a doctor) needs an approved template. Without templates the app falls back to tap-to-send links.

## Reminders
`src/lib/booking/reminders.ts` (called by `/api/flows/run`, daily cron 11:30 UTC): day-before reminders to patients when WhatsApp is configured, de-duplicated per day. The **Remind** button on the Appointments list sends a reminder immediately.

## Inbound WhatsApp (`/api/whatsapp/webhook`, `src/lib/whatsapp/*`)
Signature (`x-hub-signature-256` with `WHATSAPP_APP_SECRET`) checked, messages de-duplicated (`wa_inbound`), conversations tracked (`wa_conversations`), rate-limited. The sender's phone decides which records are in play; the patient can: book, list appointments, reschedule, cancel (asks yes), ask balance, STOP / START. `intent.ts` parses the words; `optout.ts` handles STOP/START; several clinics on one number → it asks which. `GET` answers Meta's one-time verification with `WHATSAPP_VERIFY_TOKEN`.

## Recall (`/api/recall`, `src/lib/recall/engine.ts`, migration 015)
`recall_candidates` lists patients who are due: `treatment_pending` (open treatment, nothing booked) or `lapsed` (no visit for N days, nothing booked), only with a phone, not opted out, not nudged lately. Settings per clinic: `auto`, `days` (30 to 730, default 180), `daily_limit` (1 to 100, default 20). Results go to `recall_log`; the screen `/recall` shows who was sent, who needs a tap.

## Offers and consent (`/api/offers/send`, `/api/patients/offers[/ask]`, migration 020/021)
Marketing messages go only to patients with `marketing_opt_in`. `classify()` (`src/lib/offers/eligibility.ts`): off (never said yes or said STOP), no_phone, recent (messaged within 30 days), ok. Batches of 25 per request. A new patient is asked on WhatsApp whether they want tips and offers (they reply START). Roles to send: admin, doctor. Every send is logged in `offer_sends`.

## Errors shown
"WhatsApp is not connected yet. Tap the link", "failed: <Meta reason>" with a link, "no valid mobile number". Remind button wording is tracked in `ROADMAP.md`.

## Tests
Unit `whatsapp.test.ts`, `optout.test.ts`, `offers.test.ts`; SQL `recall_test.sql`; Playwright `billing.spec.ts` (send paths).
