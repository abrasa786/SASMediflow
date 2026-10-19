# Hosting Mediflow

Mediflow is two managed services and no servers of your own:

| Piece | Service | What it does |
|---|---|---|
| App (screens + API) | **Vercel** | Runs the Next.js app. Each `git push` to `main` deploys. |
| Database, login, file storage | **Supabase** | Postgres with row-level security, email login, the `clinic-logos` bucket. |
| Email | **An SMTP provider** (Resend, Brevo, Gmail SMTP…) | Sign-up confirmation, password reset, staff invitations. |
| WhatsApp (optional) | Meta WhatsApp Cloud API | Appointment confirmations and reminders. |
| AI (optional) | Google Gemini | Smarter AI Assistant and Builder. Both work without it. |

One deployment serves every clinic. Clinics are separated by `clinic_id` in the database, enforced by row-level security and tested (`supabase/tests`). Nothing is deployed per clinic.

## 1. First-time setup (about 30 minutes)

1. **Supabase project.** Create one in the region closest to your patients (for India choose Mumbai, `ap-south-1`; patient data then stays in India).
2. **Run the migrations** in the SQL editor, in order: `001_schema.sql` (a brand-new project only), then `003` to `011` in order (`003, 004, 005, 006, 007, 008, 009, 010, 011`). They are safe to run again. (There is no `002`, it is demo data only; skip it in production.)
3. **Authentication → URL configuration.** Site URL = your production address (e.g. `https://app.yourdomain.com`). Add the same address, plus `http://localhost:3001`, to Redirect URLs.
4. **Authentication → Emails → SMTP Settings.** Add your SMTP sender. Without it Supabase's built-in mailer sends only a few emails an hour and only to your own team, so real clinics cannot sign up. Keep "Confirm email" switched on.
5. **Vercel.** Import the GitHub repo. Add the environment variables below, then deploy.
6. Open `https://<your-address>/api/health`. It should return `"ok": true` with every migration `true`.

### Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | same page |
| `AI_DATA_KEY` | recommended | 32+ random characters. Encrypts stored AI questions and answers. |
| `CRON_SECRET` | recommended | Random string. Lets the daily cron call `/api/ai/purge`. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | same page. **Secret.** Server only. Never put it in client code or chat. |
| `NEXT_PUBLIC_APP_URL` | yes | Your production address. Used in email links. |
| `AUTO_CONFIRM_EMAILS` | no | Leave unset/`false` in production. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | no | AI works with built-in rules if absent. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | no | Without them staff get a click-to-send WhatsApp link. |
| `PLATFORM_HOSTS` | no | Extra hostnames that are "the platform" (not a clinic's own domain). |
| `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | no | Lets Mediflow add each clinic's custom domain to Vercel automatically. |

Redeploy after changing any variable.

## 2. How each clinic gets its own address

Every clinic gets, at sign-up, with no work from you:

- **A web address:** `https://<your-address>/c/<clinic-slug>`: public page with logo, doctors, call and WhatsApp buttons.
- **A branded sign-in:** `https://<your-address>/login?clinic=<clinic-slug>` shows the clinic's logo, colour and tagline.
- **A logo**, uploaded at sign-up or later in Settings → *Branding & domain*, stored in the public `clinic-logos` bucket (PNG/JPG/WebP, 1 MB; SVG is refused because it can carry scripts).

### A clinic's own domain (e.g. `appointments.theirclinic.com`)

1. The clinic admin enters the domain at sign-up or in Settings → Branding & domain.
2. Mediflow shows two DNS records to add at their registrar:
   - **TXT** `_mediflow.<domain>` = the value shown. Proves ownership. Press *Check now*.
   - **CNAME** `<subdomain>` → `cname.vercel-dns.com` (or an **A** record `76.76.21.21` for a bare domain).
3. The domain must also be added to your Vercel project (Settings → Domains) so HTTPS is issued. If you set `VERCEL_API_TOKEN` and `VERCEL_PROJECT_ID`, Mediflow does this when the clinic saves the domain.
4. Once verified, opening the domain shows that clinic's public page, and `/login` on it is branded. The app itself works on any domain.

A domain only becomes exclusive to a clinic once ownership is verified, so nobody can block a real owner by typing their domain first. Check Vercel's current limit on domains per project for your plan before promising this to many clinics.

Auth emails (confirmation, reset) always link to `NEXT_PUBLIC_APP_URL`, so a clinic's staff confirm on your main address and then sign in on either.

## 3. Before real patients

- [ ] `/api/health` is green; `select * from tenant_isolation_audit();` lists nothing failing.
- [ ] Sign up a test clinic in a private window with a real email. Confirm the email arrives and the setup checklist opens.
- [ ] Create a second test clinic. Confirm neither can see the other's patients, stock or builder tables.
- [ ] Rotate any key that was ever pasted into chat, email or a screenshot (Supabase keys, Gemini, WhatsApp).
- [ ] Supabase → Database → Backups: know your retention. Daily backups and point-in-time recovery need a paid plan. Take a manual export before large changes.
- [ ] Add an uptime monitor (UptimeRobot, Better Stack) on `/api/health`.
- [ ] Privacy: publish a privacy policy and get patient consent for storing health data and sending WhatsApp messages (India's DPDP Act; HIPAA/GDPR elsewhere). Mediflow gives you the controls; the legal text is yours.
- [ ] Decide a support route (email or WhatsApp number) and put it on the public page.

## 4. Running costs and scaling

Start on Vercel and Supabase free tiers for a pilot, move both to paid plans before onboarding real clinics (backups, no project pausing, higher limits). Add costs for SMTP volume, WhatsApp conversations (billed by Meta) and Gemini usage. Check each provider's current pricing page; it changes. The app is stateless, so Vercel scales on its own; the database is the part to watch. Upgrade the Supabase compute size when query times rise.

## 5. Updating

`git push` to `main` → Vercel deploys. For database changes, add a new numbered file in `supabase/migrations` and run it in the SQL editor (keep it re-runnable). Run the matching test in `supabase/tests` against a scratch database first.
