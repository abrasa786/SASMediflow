/**
 * Clinic data access layer — all queries run through Supabase RLS.
 * Staff must be signed in and belong to the clinic.
 */
import { supabase } from "./supabase";
import type {
  Clinic, ClinicPatient, Appointment, Doctor,
  StockItem, Invoice, ClinicRole, DashboardStats, StaffMember,
} from "@/types";

// ─── Auth / Clinic membership ─────────────────────────────────────────────────

export async function getMyClinics(): Promise<Clinic[]> {
  const { data, error } = await supabase
    .from("clinic_staff")
    .select("role, clinics(*)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r.clinics, role: r.role }));
}

export async function getMyRoleInClinic(clinicId: string): Promise<ClinicRole | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("clinic_staff")
    .select("role")
    .eq("clinic_id", clinicId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role ?? null;
}

// ─── Clinic ───────────────────────────────────────────────────────────────────

export async function getClinic(clinicId: string): Promise<Clinic | null> {
  const { data } = await supabase.from("clinics").select("*").eq("id", clinicId).maybeSingle();
  return data;
}

export async function updateClinic(clinicId: string, updates: Partial<Clinic>) {
  return supabase.from("clinics").update(updates).eq("id", clinicId);
}

// ─── Doctors ──────────────────────────────────────────────────────────────────

export async function getClinicDoctors(clinicId: string): Promise<Doctor[]> {
  const { data } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .order("name");
  return data ?? [];
}

export async function addDoctor(clinicId: string, doc: Omit<Doctor, "id" | "clinic_id" | "created_at">) {
  return supabase.from("doctors").insert({ ...doc, clinic_id: clinicId }).select("id").single();
}

// ─── Patients ─────────────────────────────────────────────────────────────────

export async function getClinicPatients(clinicId: string): Promise<ClinicPatient[]> {
  const { data } = await supabase
    .from("clinic_patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("name");
  return data ?? [];
}

export async function searchClinicPatients(clinicId: string, query: string): Promise<ClinicPatient[]> {
  const { data } = await supabase
    .from("clinic_patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .limit(20);
  return data ?? [];
}

export async function upsertClinicPatient(clinicId: string, patient: Partial<ClinicPatient>) {
  return supabase
    .from("clinic_patients")
    .upsert({ ...patient, clinic_id: clinicId }, { onConflict: "id" })
    .select("id")
    .single();
}

// ─── Appointments ─────────────────────────────────────────────────────────────

export async function getAppointments(clinicId: string, date: string): Promise<Appointment[]> {
  const { data } = await supabase
    .from("appointments")
    .select("*, clinic_patients(id, name, phone, blood_group, allergies, conditions), doctors(name, speciality)")
    .eq("clinic_id", clinicId)
    .eq("appointment_date", date)
    .order("appointment_time");
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    patient: r.clinic_patients,
    doctor_name: r.doctors?.name ?? "Duty Doctor",
    doctor_speciality: r.doctors?.speciality,
  }));
}

export async function getUpcomingAppointments(clinicId: string, limit = 50): Promise<Appointment[]> {
  const today = new Date().toISOString().split("T")[0];
  const { data } = await supabase
    .from("appointments")
    .select("*, clinic_patients(id, name, phone), doctors(name)")
    .eq("clinic_id", clinicId)
    .gte("appointment_date", today)
    .in("status", ["confirmed"])
    .order("appointment_date")
    .order("appointment_time")
    .limit(limit);
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    patient: r.clinic_patients,
    doctor_name: r.doctors?.name ?? "Duty Doctor",
  }));
}

export async function bookAppointment(appt: {
  clinicId: string;
  clinicPatientId: string;
  doctorId?: string;
  date: string;
  time: string;
  fee: number;
  notes?: string;
  symptoms?: string;
  mode?: "in_clinic" | "video";
  createdBy?: string;
}) {
  const row: Record<string, unknown> = {
    clinic_id: appt.clinicId,
    clinic_patient_id: appt.clinicPatientId,
    doctor_id: appt.doctorId ?? null,
    appointment_date: appt.date,
    appointment_time: appt.time,
    consultation_fee: appt.fee,
    status: "confirmed",
    source: "clinic",
    mode: appt.mode ?? "in_clinic",
    notes: appt.notes,
    symptoms: appt.symptoms,
    created_by: appt.createdBy,
  };
  if (appt.mode === "video") {
    row.video_room = `mf-${Math.random().toString(36).slice(2, 10)}`;
  }
  return supabase.from("appointments").insert(row).select("id").single();
}

export async function updateAppointmentStatus(
  apptId: string,
  status: AppointmentStatus
) {
  return supabase.from("appointments").update({ status }).eq("id", apptId);
}

export type AppointmentStatus = "confirmed" | "completed" | "cancelled" | "no_show";

export async function rescheduleAppointment(apptId: string, date: string, time: string) {
  return supabase
    .from("appointments")
    .update({ appointment_date: date, appointment_time: time, status: "confirmed" })
    .eq("id", apptId);
}

// ─── Billing ──────────────────────────────────────────────────────────────────

export async function getInvoices(clinicId: string, limit = 50): Promise<Invoice[]> {
  const { data } = await supabase
    .from("invoices")
    .select("*, clinic_patients(name, phone)")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as any[]).map((r) => ({ ...r, patient: r.clinic_patients }));
}

export async function createInvoice(inv: Omit<Invoice, "id" | "invoice_number" | "created_at">) {
  return supabase.from("invoices").insert(inv).select("id, invoice_number").single();
}

export async function updateInvoice(id: string, updates: Partial<Invoice>) {
  return supabase.from("invoices").update(updates).eq("id", id);
}

// ─── Stock ────────────────────────────────────────────────────────────────────

export async function getStockItems(clinicId: string): Promise<StockItem[]> {
  const { data } = await supabase
    .from("stock_items")
    .select("*")
    .eq("clinic_id", clinicId)
    .order("name");
  return data ?? [];
}

export async function upsertStockItem(clinicId: string, item: Partial<StockItem>) {
  return supabase
    .from("stock_items")
    .upsert({ ...item, clinic_id: clinicId, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("id")
    .single();
}

export async function adjustStockQuantity(itemId: string, delta: number) {
  const { data } = await supabase.from("stock_items").select("quantity").eq("id", itemId).single();
  if (!data) return;
  await supabase
    .from("stock_items")
    .update({ quantity: Math.max(0, data.quantity + delta), updated_at: new Date().toISOString() })
    .eq("id", itemId);
}

// ─── Staff ────────────────────────────────────────────────────────────────────

export async function getClinicStaff(clinicId: string): Promise<StaffMember[]> {
  const { data } = await supabase
    .from("clinic_staff")
    .select("*, users:user_id(email)")
    .eq("clinic_id", clinicId)
    .order("created_at");
  return ((data ?? []) as any[]).map((r) => ({
    ...r,
    email: r.users?.email ?? "",
  })) as StaffMember[];
}

// Alias used by staff page
export const getStaffMembers = getClinicStaff;

export async function updateStaffRole(clinicId: string, userId: string, role: ClinicRole) {
  return supabase
    .from("clinic_users")
    .update({ role })
    .eq("clinic_id", clinicId)
    .eq("user_id", userId);
}

export async function removeStaffMember(clinicId: string, userId: string) {
  return supabase
    .from("clinic_users")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("user_id", userId);
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export async function getDashboardStats(clinicId: string): Promise<DashboardStats> {
  const today = new Date().toISOString().split("T")[0];
  const [apptRes, patRes, invRes, stockRes] = await Promise.all([
    supabase.from("appointments").select("status").eq("clinic_id", clinicId).eq("appointment_date", today),
    supabase.from("clinic_patients").select("id", { count: "exact", head: true }).eq("clinic_id", clinicId),
    supabase.from("invoices").select("total, status").eq("clinic_id", clinicId)
      .eq("appointment_date", today).in("status", ["paid", "partially_paid"]),
    supabase.from("stock_items").select("quantity, min_quantity").eq("clinic_id", clinicId),
  ]);

  const appts = (apptRes.data ?? []) as any[];
  const todayAppointments = appts.length;
  const completedToday = appts.filter((a: any) => a.status === "completed").length;
  const todayRevenue = (invRes.data ?? []).reduce((s: number, i: any) => s + (i.total ?? 0), 0);
  const lowStockCount = (stockRes.data ?? []).filter(
    (i: any) => i.min_quantity != null && i.quantity <= i.min_quantity
  ).length;

  return {
    todayAppointments,
    completedToday,
    totalPatients: patRes.count ?? 0,
    todayRevenue,
    lowStockCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function todayIso() {
  return new Date().toISOString().split("T")[0];
}

export function timeSlots(start = 9, end = 20, step = 15): string[] {
  const slots: string[] = [];
  for (let h = start; h < end; h++) {
    for (let m = 0; m < 60; m += step) {
      const p = h < 12 ? "AM" : "PM";
      const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
      slots.push(`${dh}:${String(m).padStart(2, "0")} ${p}`);
    }
  }
  return slots;
}
