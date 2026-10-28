import { createHmac, timingSafeEqual } from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from "pdf-lib";

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.WHATSAPP_APP_SECRET || "dev-secret";
/** A link only the clinic can mint: lets WhatsApp (and the patient) fetch one invoice's PDF without logging in. */
export const invoiceToken = (id: string) => createHmac("sha256", secret()).update("invoice-pdf:" + id).digest("hex").slice(0, 32);
export function validInvoiceToken(id: string, t: string): boolean {
  const a = Buffer.from(invoiceToken(id)), b = Buffer.from(String(t ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const invoicePdfUrl = (origin: string, id: string) => `${origin.replace(/\/$/, "")}/api/invoices/pdf?id=${id}&t=${invoiceToken(id)}`;

// Standard PDF fonts have no rupee sign, so amounts print as "Rs."
const rs = (n: unknown) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const clean = (s: unknown) => String(s ?? "").replace(/[^\x20-\x7E -ÿ]/g, "?");

async function loadLogo(pdf: PDFDocument, url?: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x89 && buf[1] === 0x50) return await pdf.embedPng(buf);
    if (buf[0] === 0xff && buf[1] === 0xd8) return await pdf.embedJpg(buf);
  } catch { /* the invoice is fine without a logo */ }
  return null;
}

export interface InvoiceData {
  clinic: { name: string; address?: string | null; city?: string | null; phone?: string | null; email?: string | null; gst_number?: string | null; logo_url?: string | null; stamp_url?: string | null; color?: string | null };
  invoice: { number: string; date: string; status: string; items: { name: string; qty: number; unit_price: number; amount: number }[]; subtotal: number; discount: number; gst_percent: number; gst_amount: number; total: number; paid: number; method?: string | null };
  patient: { name: string; phone?: string | null };
}

function hex(c?: string | null) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? "");
  if (!m) return rgb(0.01, 0.52, 0.78);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function buildInvoicePdf(d: InvoiceData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hex(d.clinic.color), ink = rgb(0.1, 0.13, 0.18), mute = rgb(0.42, 0.46, 0.52), line = rgb(0.88, 0.9, 0.93);
  const W = 595, H = 842, M = 40;
  let page = pdf.addPage([W, H]);
  const text = (t: string, x: number, y: number, size = 10, f: PDFFont = reg, color = ink) => page.drawText(clean(t), { x, y, size, font: f, color });
  const right = (t: string, xr: number, y: number, size = 10, f: PDFFont = reg, color = ink) => text(t, xr - f.widthOfTextAtSize(clean(t), size), y, size, f, color);
  const center = (t: string, y: number, size: number, f: PDFFont, color = ink) => text(t, (W - f.widthOfTextAtSize(clean(t), size)) / 2, y, size, f, color);

  // header: logo on the left, clinic name in the middle
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
  const logo = await loadLogo(pdf, d.clinic.logo_url);
  if (logo) {
    const s = Math.min(70 / logo.width, 70 / logo.height);
    page.drawImage(logo, { x: M, y: H - 30 - logo.height * s, width: logo.width * s, height: logo.height * s });
  }
  let nameSize = 22; while (nameSize > 12 && bold.widthOfTextAtSize(clean(d.clinic.name), nameSize) > W - 2 * M - 160) nameSize -= 1;
  center(d.clinic.name, H - 52, nameSize, bold, accent);
  const addr = [d.clinic.address, d.clinic.city].filter(Boolean).join(", ");
  let y = H - 70;
  for (const l of [addr, [d.clinic.phone && `Phone: ${d.clinic.phone}`, d.clinic.email].filter(Boolean).join("   "), d.clinic.gst_number ? `GSTIN: ${d.clinic.gst_number}` : ""]) {
    if (l) { center(l, y, 9, reg, mute); y -= 13; }
  }
  y = Math.min(y, H - 112) - 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });

  // title and meta
  y -= 30;
  text("INVOICE", M, y, 18, bold);
  right(`Invoice no: ${d.invoice.number}`, W - M, y + 8, 10, bold);
  right(`Date: ${d.invoice.date}`, W - M, y - 6, 10, reg, mute);
  y -= 34;
  text("Billed to", M, y, 8, bold, mute);
  text(d.patient.name, M, y - 14, 12, bold);
  if (d.patient.phone) text(`Phone: ${d.patient.phone}`, M, y - 28, 9, reg, mute);
  const paid = d.invoice.status === "paid" || d.invoice.paid >= d.invoice.total;
  const label = paid ? "PAID" : d.invoice.paid > 0 ? "PART PAID" : "UNPAID";
  const lw = bold.widthOfTextAtSize(label, 11) + 20;
  page.drawRectangle({ x: W - M - lw, y: y - 24, width: lw, height: 24, borderColor: paid ? rgb(0.09, 0.64, 0.38) : rgb(0.85, 0.45, 0.05), borderWidth: 1.2 });
  text(label, W - M - lw + 10, y - 16, 11, bold, paid ? rgb(0.09, 0.64, 0.38) : rgb(0.85, 0.45, 0.05));
  y -= 56;

  // items
  const cols = { n: M + 8, qty: 340, price: 430, amt: W - M - 8 };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 24, color: accent });
    text("Description", cols.n, y + 2, 9.5, bold, rgb(1, 1, 1));
    right("Qty", cols.qty + 20, y + 2, 9.5, bold, rgb(1, 1, 1));
    right("Price", cols.price + 20, y + 2, 9.5, bold, rgb(1, 1, 1));
    right("Amount", cols.amt, y + 2, 9.5, bold, rgb(1, 1, 1));
    y -= 26;
  };
  header();
  for (const it of d.invoice.items) {
    if (y < 190) { page = pdf.addPage([W, H]); y = H - 60; header(); }
    let nm = clean(it.name); while (nm.length > 3 && reg.widthOfTextAtSize(nm, 10) > 280) nm = nm.slice(0, -2);
    if (nm !== clean(it.name)) nm = nm.trimEnd() + "...";
    text(nm, cols.n, y, 10);
    right(String(it.qty), cols.qty + 20, y);
    right(rs(it.unit_price), cols.price + 20, y);
    right(rs(it.amount), cols.amt, y);
    y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: line }); y -= 14;
  }

  // totals
  if (y < 170) { page = pdf.addPage([W, H]); y = H - 60; }
  y -= 6;
  const row = (k: string, v: string, f: PDFFont = reg, size = 10) => { text(k, 360, y, size, f, f === bold ? ink : mute); right(v, W - M - 8, y, size, f); y -= 17; };
  row("Subtotal", rs(d.invoice.subtotal));
  if (d.invoice.discount > 0) row("Discount", `- ${rs(d.invoice.discount)}`);
  if (d.invoice.gst_amount > 0) row(`GST (${d.invoice.gst_percent}%)`, rs(d.invoice.gst_amount));
  page.drawLine({ start: { x: 360, y: y + 11 }, end: { x: W - M, y: y + 11 }, thickness: 1, color: line });
  y -= 4;
  row("Total", rs(d.invoice.total), bold, 13);
  if (d.invoice.paid > 0) row("Paid", rs(d.invoice.paid));
  const due = Math.max(0, d.invoice.total - d.invoice.paid);
  if (due > 0) row("Balance due", rs(due), bold, 11);
  if (d.invoice.method) text(`Payment method: ${d.invoice.method}`, M, y + 17, 9, reg, mute);

  // the clinic's stamp, bottom right under the totals
  const stamp = await loadLogo(pdf, d.clinic.stamp_url);
  if (stamp) {
    const s = Math.min(120 / stamp.width, 120 / stamp.height), w = stamp.width * s, h = stamp.height * s;
    let top = y - 4;
    if (top - h < 75) { page = pdf.addPage([W, H]); top = H - 60; }
    page.drawImage(stamp, { x: W - M - w, y: top - h, width: w, height: h });
  }

  center(`Thank you for choosing ${d.clinic.name}.`, 60, 10, reg, mute);
  center("This is a computer generated invoice.", 46, 8, reg, mute);
  return pdf.save();
}
