# Making the product video

You need three things: **real screen footage**, **a voice**, and **captions**. Use AI tools for the voice and polish; use the real app for what is shown, because buyers compare against real software.

## 1. Footage (automatic)

- `npm run build && npx next start -p 3100` in one terminal, then `npm run demo:record` in another.
- Playwright walks the guided demo (`/demo`) and saves a 1280×720 `.webm` to `demo-video/`. It pauses between steps so you can narrate over each screen.
- For the real signed-in app, record against a **staging clinic with fake data** (never real patients) using the tools below.

## 2. AI tools (check current features and pricing yourself)

| Job | Options | Notes |
|---|---|---|
| Voice-over | ElevenLabs, Azure or Google text-to-speech | Use an Indian-English voice; add Hindi/Telugu/Tamil versions later |
| Presenter avatar / dubbing | HeyGen, Synthesia | Good for an intro and for translated versions |
| Edit by editing text | Descript | Record or generate narration, cut by deleting words, auto captions |
| Screen capture with zoom and cursor polish | Loom, Screen Studio, Clipchamp | For flows the demo does not cover |
| Video from code | Remotion | Optional; reuse brand colours from `src/lib/theme.ts` |
| Captions and vertical cuts | CapCut, Descript | 9:16 cut for Reels, Shorts and WhatsApp status |

## 3. Storyboard (90 seconds)

| Time | Show | Say |
|---|---|---|
| 0:00 | Waiting room, paper register, WhatsApp chaos | "Running a clinic shouldn't mean running between five tools." |
| 0:08 | Sign-up: clinic name, logo, colour, AI assistant name | "Set up in minutes, and it looks like your clinic from the first screen." |
| 0:20 | Assistant: "Book Anita 9876543210 tomorrow 4pm" → confirmed, WhatsApp link | "Book by typing. It checks the doctor's hours and leave." |
| 0:32 | Calendar, then a treatment plan with 3 sittings | "Multi-visit treatments, tracked sitting by sitting." |
| 0:44 | Invoice, part payment, print | "Bills, balances and printable invoices." |
| 0:54 | Stock low alert → purchase order → received | "Never run out of gloves again." |
| 1:02 | AI Builder: "Create a Laboratory app…" → approve → app appears | "Need something new? Describe it. You approve every change, and can undo." |
| 1:14 | Ask the bot "What is Kohli's score?" → polite refusal; Settings → AI & privacy | "Your assistant only talks about your clinic. What you type stays in your database, and you can delete it." |
| 1:24 | Users screen, admin deletes a user | "Admins control who has access." |
| 1:30 | Logo, web address, "Start free" | |

## 4. Rules for the video

- Use fake names and phone numbers only.
- Don't claim certifications or outcomes you don't have.
- Keep 15-second and 30-second cuts for ads; the 90-second cut for the website and demos.
