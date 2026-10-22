import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { buildInvoicePdf, validInvoiceToken } from "@/lib/server/invoice-pdf";
import { loadInvoiceData } from "@/lib/server/invoice-data";

export const dynamic = "force-dynamic";

/** The invoice as a PDF. Opened by WhatsApp or the patient through a link that carries a signature, so no login is needed. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "", t = req.nextUrl.searchParams.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !validInvoiceToken(id, t)) return new NextResponse("Not found", { status: 404 });
  const data = await loadInvoiceData(createAdminClient(), id);
  if (!data) return new NextResponse("Not found", { status: 404 });
  const pdf = await buildInvoicePdf(data);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Invoice-${data.invoice.number || id.slice(0, 8)}.pdf"`, "Cache-Control": "private, max-age=60" },
  });
}
