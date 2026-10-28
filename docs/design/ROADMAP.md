# Decided next steps

1. **WhatsApp that sends by itself.** Shared Mediflow number first (Meta account, templates for patient and doctor, environment variables), then a number per clinic through Meta Embedded Signup with templates submitted automatically; a clinic that has not connected falls back to the shared number. The AI cannot create Meta accounts; a person signs in once.
2. **Remind button wording:** say "Reminder sent on WhatsApp to <name>" when sent, and show a clear warning when only a link is available.
3. **Usage log and billing:** count messages per clinic and bill them monthly with GST.
4. **Spam and abuse controls:** opt-out everywhere, marketing only with consent, daily and hourly caps per clinic, duplicate guard, template-only first contact, automatic pause on odd volume, admin switch per clinic, warnings in Settings.
5. **Doctor alerts in the app** and a warning when a doctor has no phone saved.
6. **Offline support:** offline banner and safe errors, cached app shell and recent screens, later queued writes for a few safe actions.
7. **Ads (later):** Meta ads and click-to-WhatsApp leads, after messaging is stable.
8. **Local development and patch flow:** clone, change and test locally, then push patches to GitHub.
