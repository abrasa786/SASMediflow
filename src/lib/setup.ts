/** First-run setup checklist for a clinic. Everything is computed from the clinic's own data (RLS keeps it separate). */
import { supabase } from "./supabase";
import { authFetch } from "./api";

export interface SetupItem {
  id: string;
  title: string;
  hint: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

async function count(table: string, clinicId: string, extra?: (q: any) => any): Promise<number> {
  let q: any = supabase.from(table).select("id", { count: "exact", head: true }).eq("clinic_id", clinicId);
  if (extra) q = extra(q);
  const { count: n } = await q;
  return n ?? 0;
}

export async function getSetupStatus(clinicId: string): Promise<{ items: SetupItem[]; dismissed: boolean }> {
  const { data: clinic } = await supabase.from("clinics").select("phone,address,settings").eq("id", clinicId).maybeSingle();
  const [doctors, schedules, staff, stockWithQty, prices, templates, patients] = await Promise.all([
    count("doctors", clinicId, (q) => q.eq("is_active", true)),
    count("doctor_schedules", clinicId),
    count("clinic_staff", clinicId, (q) => q.eq("is_active", true)),
    count("stock_items", clinicId, (q) => q.gt("quantity", 0)),
    count("price_list", clinicId),
    count("treatment_templates", clinicId),
    count("clinic_patients", clinicId),
  ]);
  const s = (clinic?.settings ?? {}) as any;
  const items: SetupItem[] = [
    { id: "profile",   title: "Add your clinic's phone and address", hint: "Shown on invoices and in every WhatsApp confirmation.", href: "/settings", done: !!(clinic?.phone && clinic?.address) },
    { id: "doctors",   title: "Add your doctors", hint: "Bookings are assigned to doctors, so add at least one.", href: "/staff", done: doctors > 0 },
    { id: "hours",     title: "Set each doctor's weekly hours", hint: "Working days, breaks and slot length decide which times can be booked.", href: "/availability", done: schedules > 0 },
    { id: "prices",    title: "Review your price list", hint: "A starter list was added for your specialty. Change the amounts to yours.", href: "/settings", done: prices > 0 && !!s?.setup?.prices_reviewed },
    { id: "templates", title: "Check your treatment templates", hint: "Multi-sitting treatments (like root canals) with gaps and amounts. Edit to match your practice.", href: "/treatments", done: templates > 0 && !!s?.setup?.templates_reviewed },
    { id: "stock",     title: "Enter your stock quantities", hint: "Shelves are ready with the usual items. Add real quantities so usage can be deducted.", href: "/stock", done: stockWithQty > 0, optional: true },
    { id: "whatsapp",  title: "Connect WhatsApp (optional)", hint: "Without it, Mediflow opens WhatsApp with the message ready to send.", href: "/settings", done: !!s?.setup?.whatsapp_done, optional: true },
    { id: "team",      title: "Invite your team", hint: "Receptionists, nurses and other doctors get their own logins.", href: "/staff", done: staff > 1, optional: true },
    { id: "patient",   title: "Book your first appointment", hint: "Use the AI Assistant: type a name, a time and it does the rest.", href: "/chatbot", done: patients > 0 },
  ];
  return { items, dismissed: !!s?.setup?.dismissed };
}

/** Set a setup flag. Saved through the server (admin only), so a refusal is reported instead of silently ignored. */
export async function setSetupFlag(clinicId: string, flag: string, value: boolean) {
  await authFetch("/api/clinic/setup", { body: { clinicId, action: "flag", flag, value } });
}
