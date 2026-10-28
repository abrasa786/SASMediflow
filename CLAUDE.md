# Mediflow: standing rules (from the owner)

- **Only add features; never remove or change existing ones** unless asked.
- **Layout:** main tabs run horizontally across the top (Home, Patients, Appointments, Treatments, Sittings, Billing, plus any tab the Builder pins). The ☰ menu at the top left holds every other feature, the apps, Setup and the rest. The AI Assistant button stays at the bottom right on every page.
- **Every tab has a "+ New" button and a "List view"** (the shared list: search, filters, columns, sort, saved views). Home has "+ New booking". The tab bar and every page must scroll sideways and up and down on phones.
- **Home is the dashboard.** Setup runs once for a new clinic, then returns to Home. After an invoice is finished, return to Home.
- **The Builder can pin a screen or app as a main tab** ("show stock in the main tabs").
- **Every record page has a delete (dustbin) button at the bottom right,** with a confirmation. Deletion is checked on the server by role and clinic.
- **Users must never have to train the Builder or the assistant:** they learn from approved changes and usage.
- Success messages (toasts) after every save or booking; close pop-ups after success.
- Give the owner SQL as code blocks (one command per line, PowerShell-safe). Never handle or paste secrets.
- Before pushing: `npm test` and a `next build` (with dummy Supabase env vars) must pass. Commit trailers: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the Claude-Session line.
