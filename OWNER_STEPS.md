# Mediflow: what the owner does (in this order)

## 1. Supabase (SQL Editor, new query)
1. Paste the whole of `supabase/RUN_ME_ALL_MIGRATIONS.sql` and press Run. It is safe to run again. It ends with a security sweep that switches Row-Level Security on for any open table.
2. Check nothing is open (must return no rows):
   `select tablename from pg_tables where schemaname = 'public' and rowsecurity = false;`
3. Authentication > URL Configuration: Site URL = your app address; add `https://YOUR-APP/**` to Redirect URLs.
4. Authentication > SMTP: add the same email provider as below, so sign-up and reset emails are not limited.
5. Project Settings > API: rotate the keys that were exposed earlier, then update them in Vercel.

## 2. Vercel (Project > Settings > Environment Variables, then Redeploy)
- `NEXT_PUBLIC_APP_URL` = your app address (needed for invoice PDF and calendar links)
- `CRON_SECRET` = a long random string (daily reminders)
- `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (permanent system-user token), `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`
- Optional templates: `WHATSAPP_TEMPLATE_CONFIRMATION_PATIENT`, `WHATSAPP_TEMPLATE_REMINDER_PATIENT`, `WHATSAPP_TEMPLATE_INVOICE_PATIENT`, `WHATSAPP_TEMPLATE_OFFER_CONSENT`
- `RESEND_API_KEY`, `EMAIL_FROM` (an address on a domain you verified in Resend)
- Settings > Deployment Protection: off for Production. Settings > Functions: region Mumbai (bom1).

## 3. WhatsApp (Meta)
- Business account verified; number added; webhook URL `https://YOUR-APP/api/whatsapp/webhook` with your verify token.
- Create and get approved the message templates (patients who have not written in the last 24 hours only receive approved templates).

## 4. Email
- Resend: add and verify your domain, create an API key. A personal Gmail is fine only for testing (about 500 mails a day, may land in spam).

## 5. Tomorrow's check (10 minutes)
1. Sign in > Setup: save clinic details, add yourself as doctor, set hours, confirm prices and templates.
2. Book an appointment: the patient receives WhatsApp automatically, with an "Add a reminder to your phone" link.
3. Open the visit, pick a treatment, "Add to this visit", complete the sitting, bill opens, send on WhatsApp, mark paid, lands on Home.
4. Open the patient: related lists and balance show.

## Sittings and invoice stamp
- Run `supabase/RUN_ME_ALL_MIGRATIONS.sql` again in the Supabase SQL editor (it includes 032 flexible sittings and 033 clinic stamp; safe to re-run), then run `notify pgrst, 'reload schema';`.
- Setup has an optional step "Add your clinic stamp". The stamp prints at the bottom right of every invoice.

## Import patients from another app
- Run `supabase/RUN_ME_ALL_MIGRATIONS.sql` again (it now includes 034 data import), then `notify pgrst, 'reload schema';`.
- In Setup, open "Bring your patients from another app", or use the menu: Import data. Export the patient list from the old app as CSV first.
