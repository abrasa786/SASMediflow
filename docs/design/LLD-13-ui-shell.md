# LLD 13: UI shell and user experience

UI and UX are the heart of the application. Rules come from `CLAUDE.md`.

## Layout
| Part | File | Behaviour |
|---|---|---|
| App shell | `components/layout/AppShell.tsx` | Top bar, tab bar, ☰ menu, search, assistant button; caches clinic and role per tab so moving between screens does not reload them |
| Main tabs | `TopTabs.tsx` | Horizontal: Home, Patients, Appointments, Treatments, Sittings, Billing, plus Builder-pinned tabs. Scrolls sideways on phones. `+ New` and `List view` buttons change per tab (Home: `+ New booking`) |
| ☰ menu | `Sidebar.tsx` | Every other feature, the apps, Setup; items filtered by role |
| AI Assistant button | `AssistantWidget.tsx` | Fixed bottom right on every page |
| Modal | `Modal.tsx` | Escape closes, focus handled, scrolls inside on small screens |
| Toasts | `lib/toast.ts`, `ToastHost.tsx` | `toast(text)` after every save or booking (`role="status"`); pop-ups close after success |
| Errors | `Boundary.tsx`, `app/error.tsx`, `not-found.tsx` | A failing section never blanks the page |

## Interaction rules
1. Every tab has `+ New` and a List view (search, filters, columns, sort, saved views).
2. Every record page has a dustbin at the bottom right with a confirmation.
3. Setup runs once, then returns to Home; after an invoice is finished, return to Home.
4. Forms show errors inline in red next to what to fix; buttons show "Saving…" and disable while busy.

## Devices (`src/app/globals.css`)
Mobile-first with media queries: tap targets at least 44 px on touch screens, text and inputs at 16 px to stop iOS zoom, tables scroll sideways inside their own box, safe-area padding, no page-level horizontal scroll, print styles for invoices and purchase documents. The device matrix test runs 25 screens on 280 px to 1440 px widths.

## Theming
Per-clinic colour and logo (`lib/theme.ts`), contrast-checked.

## Tests
Playwright mock `shell.spec.ts` (tabs, + New, List view, menu, assistant position, search), `devices.spec.ts` (overflow, tap targets, tab bar reach), accessibility roles used by selectors.
