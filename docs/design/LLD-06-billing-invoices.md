# LLD 06: Billing and invoices

## Purpose
Create an invoice for a visit or a sitting, record payments, print or send it, and keep appointment and treatment status in step.

## Screens
`/billing` (list, `+ New` invoice modal, send, mark paid), `/billing/[id]` (invoice record, send on WhatsApp, PDF, delete), `/billing/print`, `/payments` (every bill and its payment status; marking paid also closes the appointment). `InvoiceCard` is the in-visit invoice creator; after an invoice is finished the app returns to Home.

## Tables and rules
| Item | Rule |
|---|---|
| `invoices` | per-clinic number `INV-YYYY-NNNN` from `doc_counters` (`next_doc_number`, `set_invoice_number`); items json with description/price/qty/amount (readers accept `name`/`description` and `price`/`unit_price`); subtotal, discount, GST percent and amount, total, `paid_amount`, `status` draft / sent / partially_paid / paid / cancelled, `payment_method` |
| `bill_pay` | records a payment atomically |
| Triggers | `trg_invoice_billing` refreshes the appointment's `billing_status`; `trg_invoice_to_sitting` copies total and paid to a single sitting; `flow_invoice_trigger` queues automations |
| Delete | admin only; refused when paid or part paid (cancel instead) |

## API
| Route | Roles | Does |
|---|---|---|
| `/api/payments/complete` | admin, doctor, nurse, receptionist | Marks paid (method `physical` for now), closes the appointment, returns its date; refuses cancelled invoices |
| `/api/invoices/send` | same | Sends the invoice to the patient: WhatsApp (document with caption, or template then document) and email when set up; `linkOnly:true` returns the signed PDF link; when WhatsApp is not connected it returns a tap-to-send link with the PDF URL |
| `/api/invoices/pdf` | signed link | Streams the PDF; no login, signature checked |
| `/api/invoices/sittings` | admin, doctor, receptionist | Sittings on an invoice |

## PDF (`src/lib/server/invoice-pdf.ts`, `invoice-data.ts`)
pdf-lib A4: coloured header bar with logo and clinic name, clinic address/phone/GST, patient, invoice number and date, status stamp (PAID / UNPAID), item table, totals (subtotal, discount, GST, total, paid, balance), payment method, **clinic stamp at the bottom right under the totals** (up to 120 pt, moved to a new page when there is no room, skipped when it cannot be loaded), footer. Remote images are fetched with a timeout; the invoice prints without them on failure. `clean()` strips characters the font cannot draw.

## Sending (see LLD-07)
Message text lists up to 12 items, discount, GST, total and due. First-contact rule: with `WHATSAPP_TEMPLATE_INVOICE_PATIENT` set, the template opens the conversation and the PDF follows; without it the document is sent as free-form.

## Errors and timeouts
Send route allows 30 s. The UI shows the server reason and a tap-to-send fallback; a stuck "Sending…" state clears with an error.

## Tests
Playwright `billing.spec.ts` (send toast, failures, fallback link); SQL `tenant_and_treatments_test.sql`, `flexible_sittings_test.sql` (invoice edit syncs sitting).
