import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "nurse", "receptionist"]);
    if (b.action === "archive") {
      const { error } = await db.from("suppliers").update({ is_active: false }).eq("id", b.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { archived: true };
    }
    const s = b.supplier ?? {};
    const name = str(s.name, 100);
    if (name.length < 2) throw new HttpError(400, "Enter the supplier's name.");
    const phone = str(s.phone, 20).replace(/[^\d+ -]/g, "");
    if (s.email && !/^\S+@\S+\.\S+$/.test(str(s.email))) throw new HttpError(400, "Enter a valid supplier email.");
    const terms = Number(s.payment_terms_days ?? 0);
    if (!Number.isInteger(terms) || terms < 0 || terms > 365) throw new HttpError(400, "Payment terms must be 0 to 365 days.");
    const row = { clinic_id: b.clinicId, name, contact_name: str(s.contact_name, 100) || null, phone: phone || null, email: str(s.email) || null,
      address: str(s.address, 300) || null, gstin: str(s.gstin, 15).toUpperCase() || null, payment_terms_days: terms, notes: str(s.notes, 300) || null, is_active: true };
    const q = b.id ? db.from("suppliers").update(row).eq("id", b.id).eq("clinic_id", b.clinicId) : db.from("suppliers").insert(row);
    const { data, error } = await q.select("id").single();
    if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "You already have a supplier with that name." : error.message);
    return { id: data.id };
  });
}
