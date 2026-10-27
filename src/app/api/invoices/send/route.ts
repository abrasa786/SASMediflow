import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { sendViaCloudApi, sendDocumentViaCloudApi, whatsappConfigured, whatsappPhone, waLink } from "@/lib/booking/notify";
import { emailConfigured, sendEmail } from "@/lib/email";
import { invoicePdfUrl } from "@/lib/server/invoice-pdf";

const rupees = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

/**
 * Sends an invoice to the patient's WhatsApp number straight from the clinic's WhatsApp Business number.
 * If WhatsApp is not connected yet (or Meta refuses the message), the reply carries a ready-to-tap link instead, so nothing is lost.
 * Meta only allows free text within 24 hours of the patient's last message. For first contact create an approved template
 * and set WHATSAPP_TEMPLATE_INVOICE_PATIENT; its body variables are {{1}} patient name, {{2}} invoice number, {{3}} total, {{4}} balance, {{5}} clinic.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor", "nurse", "receptionist"]);
    if (typeof b.invoiceId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.invoiceId)) throw new HttpError(400, "invoiceId is required.");
    const { data: inv } = await db.from("invoices").select("id, invoice_number, items, subtotal, discount, gst_amount, total, paid_amount, status, clinic_patients(name, phone, email)").eq("id", b.invoiceId).eq("clinic_id", b.clinicId).maybeSingle();
    if (!inv) throw new HttpError(404, "Invoice not found.");
    if (b.linkOnly) return { pdfUrl: invoicePdfUrl(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin, inv.id) };
    const { data: clinic } = await db.from("clinics").select("name, brand_name, phone, email").eq("id", b.clinicId).maybeSingle();
    const cname = clinic?.brand_name || clinic?.name || "the clinic";
    const pat: any = (inv as any).clinic_patients ?? {};
    const phone = whatsappPhone(pat.phone);
    if (!phone) return { status: "skipped", error: "This patient has no valid mobile number saved." };

    const balance = Math.max(0, Number(inv.total) - Number(inv.paid_amount || 0));
    const lines = (Array.isArray(inv.items) ? inv.items : []).slice(0, 12).map((i: any) => `• ${i.name}${Number(i.qty) > 1 ? ` × ${i.qty}` : ""} — ${rupees(i.amount)}`).join("\n");
    const text = `🧾 *Invoice ${inv.invoice_number ?? ""}* from *${cname}*\n\nHi ${pat.name ?? ""},\n\n${lines}\n${Number(inv.discount) > 0 ? `Discount: −${rupees(inv.discount)}\n` : ""}${Number(inv.gst_amount) > 0 ? `GST: ${rupees(inv.gst_amount)}\n` : ""}*Total: ${rupees(inv.total)}*${balance > 0 ? `\n*Amount due: ${rupees(balance)}*` : "\n✅ Paid in full"}\n\nThank you for choosing ${cname}.${clinic?.phone ? `\nQuestions? Call ${clinic.phone}.` : ""}`;

    const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const pdfUrl = invoicePdfUrl(origin, inv.id);
    const fname = `Invoice-${(inv.invoice_number ?? inv.id.slice(0, 8)).toString().replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
    const short = `🧾 Invoice ${inv.invoice_number ?? ""} from ${cname}\nTotal: ${rupees(inv.total)}${balance > 0 ? ` · Due: ${rupees(balance)}` : " · Paid in full"}`;
    const linkText = `${text}\n\n📄 Invoice PDF: ${pdfUrl}`;

    // also email it when the patient has an address and email is set up (does not change the WhatsApp result)
    let emailed: "sent" | "failed" | undefined;
    if (emailConfigured() && pat.email) emailed = (await sendEmail(pat.email, `Invoice ${inv.invoice_number ?? ""} from ${cname}`, linkText, { fromName: cname, replyTo: clinic?.email })).ok ? "sent" : "failed";

    if (!whatsappConfigured()) return { email: emailed, status: "link", link: waLink(phone, linkText), pdfUrl, error: "WhatsApp is not connected yet. Tap the link to send it from your own WhatsApp." };
    try {
      const tpl = process.env.WHATSAPP_TEMPLATE_INVOICE_PATIENT;
      if (tpl) {
        await sendViaCloudApi(phone, text, { name: tpl, params: [pat.name ?? "", inv.invoice_number ?? "", rupees(inv.total), rupees(balance), cname] });
        await sendDocumentViaCloudApi(phone, pdfUrl, fname, short).catch(() => null);   // the template opens the conversation; the PDF follows
      } else {
        await sendDocumentViaCloudApi(phone, pdfUrl, fname, short);
      }
      return { status: "sent", pdfUrl, email: emailed };
    } catch (e: any) {
      return { status: "failed", error: e.message, link: waLink(phone, linkText), pdfUrl, email: emailed };
    }
  });
}
