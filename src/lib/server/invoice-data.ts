import type { InvoiceData } from "./invoice-pdf";

/** Everything the invoice PDF shows, read for one invoice. */
export async function loadInvoiceData(db: any, invoiceId: string, clinicId?: string): Promise<InvoiceData | null> {
  let q = db.from("invoices").select("id, clinic_id, invoice_number, created_at, items, subtotal, discount, gst_percent, gst_amount, total, paid_amount, status, payment_method, clinic_patients(name, phone)").eq("id", invoiceId);
  if (clinicId) q = q.eq("clinic_id", clinicId);
  const { data: inv } = await q.maybeSingle();
  if (!inv) return null;
  const { data: c } = await db.from("clinics").select("name, brand_name, address, city, phone, email, gst_number, logo_url, primary_color").eq("id", inv.clinic_id).maybeSingle();
  const pat: any = inv.clinic_patients ?? {};
  const method: Record<string, string> = { physical: "Paid at the desk", cash: "Cash", upi: "UPI", qr: "QR", card: "Card", online: "Online", insurance: "Insurance", other: "Other" };
  return {
    clinic: { name: c?.brand_name || c?.name || "Clinic", address: c?.address, city: c?.city, phone: c?.phone, email: c?.email, gst_number: c?.gst_number, logo_url: c?.logo_url, color: c?.primary_color },
    invoice: {
      number: inv.invoice_number ?? "", date: new Date(inv.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }),
      status: inv.status ?? "", items: Array.isArray(inv.items) ? inv.items.map((i: any) => ({ name: String(i.name ?? i.description ?? ""), qty: Number(i.qty || 1), unit_price: Number(i.unit_price ?? i.price ?? i.amount ?? 0), amount: Number(i.amount ?? (Number(i.qty || 1) * Number(i.unit_price ?? i.price ?? 0))) })) : [],
      subtotal: Number(inv.subtotal || 0), discount: Number(inv.discount || 0), gst_percent: Number(inv.gst_percent || 0), gst_amount: Number(inv.gst_amount || 0), total: Number(inv.total || 0),
      paid: Number(inv.paid_amount || 0), method: inv.payment_method && inv.status === "paid" ? method[inv.payment_method] ?? null : null,
    },
    patient: { name: pat.name ?? "", phone: pat.phone },
  };
}
