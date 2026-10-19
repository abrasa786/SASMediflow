import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { handle } from "@/lib/server/http";
import { findClinic, onlineSettings } from "@/lib/booking/online";
import { gatewayFor } from "@/lib/payments/razorpay";

export const dynamic = "force-dynamic";

/** Everything the public booking page needs: branding, doctors, fee. Never any secret, never any patient. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const q = req.nextUrl.searchParams;
    const db = createAdminClient();
    const c = await findClinic(db, { slug: q.get("clinic"), host: q.get("host") });
    const s = onlineSettings(c.settings);
    const gw = gatewayFor(c.settings);
    const { data: docs } = await db.from("doctors").select("id, name, specialty, speciality, experience_years, consultation_fee, slot_minutes")
      .eq("clinic_id", c.id).neq("is_active", false).order("name");
    return {
      clinic: { slug: c.slug, name: c.brand_name ?? c.name, tagline: c.tagline, logo_url: c.logo_url, primary_color: c.primary_color, address: c.address, city: c.city, phone: c.phone, specialty: c.specialty },
      booking: { open: s.enabled && (s.fee === 0 || !!gw), fee: s.fee, advanceDays: s.advance_days, holdMinutes: s.hold_minutes, notice: s.notice, keyId: s.fee > 0 ? gw?.keyId ?? null : null },
      doctors: (docs ?? []).map((d: any) => ({ id: d.id, name: d.name, specialty: d.specialty ?? d.speciality ?? null, experience: d.experience_years ?? null, fee: Number(d.consultation_fee ?? 0) })),
    };
  });
}
