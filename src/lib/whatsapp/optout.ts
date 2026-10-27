/** A patient replying STOP (or similar) to switch off tips and offers. START switches them back on. */
export const isStopMessage = (t: string) => /^\s*(stop|stop all|unsubscribe|opt[ -]?out|cancel offers)\s*[.!]*\s*$/i.test(t);
export const isStartMessage = (t: string) => /^\s*(start|subscribe|opt[ -]?in)\s*[.!]*\s*$/i.test(t);

/**
 * Turn offers off (or back on) for every record with this phone number, in every clinic.
 * Returns how many records changed; 0 means we did not know this number, so the normal chat carries on.
 */
export async function setOffersByPhone(db: any, phone: string, on: boolean): Promise<number> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length !== 10) return 0;
  const { data, error } = await db.from("clinic_patients").select("id").ilike("phone", `%${last10}`).limit(50);
  if (error || !data?.length) return 0;
  const patch = on
    ? { marketing_opt_in: true, marketing_opt_in_at: new Date().toISOString(), marketing_opt_in_source: "whatsapp_reply", marketing_opt_out_at: null }
    : { marketing_opt_in: false, marketing_opt_out_at: new Date().toISOString() };
  const { error: e2 } = await db.from("clinic_patients").update(patch).in("id", data.map((r: any) => r.id));
  return e2 ? 0 : data.length;
}
