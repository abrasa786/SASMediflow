import { NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/server/http";
import { requireClinicMember } from "@/lib/server/auth";
import { STARTER_LIBRARY } from "@/lib/treatments/library";

const str = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => { const n = Number(v); return v === "" || v === null || v === undefined || !Number.isFinite(n) || n < 0 ? null : n; };

function clean(b: any) {
  const steps = Array.isArray(b.steps) ? b.steps.map((s: unknown) => str(s, 300)).filter(Boolean) : [];
  const faqs = Array.isArray(b.faqs) ? b.faqs.map((f: any) => ({ q: str(f?.q, 300), a: str(f?.a, 1000) })).filter((f: any) => f.q && f.a) : [];
  return {
    name: str(b.name, 120), category: str(b.category, 60), summary: str(b.summary, 300), why_needed: str(b.why_needed),
    steps: steps.slice(0, 12), duration_text: str(b.duration_text, 300), pain_text: str(b.pain_text, 500), aftercare: str(b.aftercare),
    delay_risk: str(b.delay_risk, 600), price_from: num(b.price_from), price_to: num(b.price_to), emi_note: str(b.emi_note, 300),
    faqs: faqs.slice(0, 10), offer_text: str(b.offer_text, 160), is_published: !!b.is_published,
  };
}

/** Create, edit, delete or import the clinic's treatment explainers. Doctors and admins only. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const b = await req.json();
    const { db } = await requireClinicMember(req, b.clinicId, ["admin", "doctor"]);

    if (b.action === "import") {
      const { data: have } = await db.from("treatment_info").select("name").eq("clinic_id", b.clinicId);
      const names = new Set((have ?? []).map((r: any) => String(r.name).toLowerCase()));
      const rows = STARTER_LIBRARY.filter((t) => !names.has(t.name.toLowerCase())).map((t) => ({ ...t, clinic_id: b.clinicId, is_published: false }));
      if (rows.length) { const { error } = await db.from("treatment_info").insert(rows); if (error) throw new HttpError(400, error.message); }
      return { added: rows.length };
    }

    if (b.action === "delete") {
      if (typeof b.id !== "string") throw new HttpError(400, "Missing id.");
      const { error } = await db.from("treatment_info").delete().eq("id", b.id).eq("clinic_id", b.clinicId);
      if (error) throw new HttpError(400, error.message);
      return { ok: true };
    }

    const f = clean(b.fields ?? {});
    if (!f.name) throw new HttpError(400, "Give the treatment a name.");
    if (f.price_from !== null && f.price_to !== null && f.price_to < f.price_from) throw new HttpError(400, "The highest price is lower than the lowest price.");

    if (b.action === "update") {
      if (typeof b.id !== "string") throw new HttpError(400, "Missing id.");
      const { data, error } = await db.from("treatment_info").update({ ...f, updated_at: new Date().toISOString() }).eq("id", b.id).eq("clinic_id", b.clinicId).select("id").maybeSingle();
      if (error) throw new HttpError(400, error.message);
      if (!data) throw new HttpError(404, "Treatment not found.");
      return { id: data.id };
    }
    const { data, error } = await db.from("treatment_info").insert({ ...f, clinic_id: b.clinicId }).select("id").single();
    if (error) throw new HttpError(400, error.message);
    return { id: data.id };
  });
}
