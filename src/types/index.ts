export type ClinicRole = "admin" | "doctor" | "intern" | "nurse" | "receptionist";
export type AppointmentStatus = "confirmed" | "cancelled" | "completed" | "no_show";
export type AppointmentMode = "in_clinic" | "video";
export type InvoiceStatus = "draft" | "sent" | "paid" | "partially_paid" | "cancelled";
export type PaymentMethod = "cash" | "upi" | "card" | "insurance" | "other" | "physical" | "qr" | "online";
export type StockCategory = "medicine" | "consumable" | "equipment" | "lab_supply" | "other";

export interface Clinic {
  id: string;
  name: string;
  brand_name?: string;
  area?: string;
  address?: string;
  phone?: string;
  email?: string;
  slug?: string;
  logo_url?: string;
  primary_color?: string;
  tagline?: string;
  ai_name?: string;
  custom_domain?: string;
  domain_verified?: boolean;
  about?: string;
  specialties?: string[];
  slot_duration_minutes?: number;
  default_consultation_fee?: number;
  open_time?: string;
  close_time?: string;
  gstin?: string;
  specialty?: string;
  city?: string;
  state?: string;
  website?: string;
  gst_number?: string;
  working_hours?: { days?: string[]; open?: string; close?: string };
  whatsapp_enabled?: boolean;
  whatsapp_phone_id?: string;
  google_calendar_id?: string;
  created_at?: string;
  // joined from clinic_users
  role?: ClinicRole;
}

export interface ClinicPatient {
  id: string;
  clinic_id: string;
  patient_id?: string;
  name: string;
  phone?: string;
  age_years?: number | null;
  dob?: string;
  gender?: string;
  blood_group?: string;
  allergies?: string;
  conditions?: string;
  medications?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  insurance_number?: string;
  created_at?: string;
}

export interface Doctor {
  id: string;
  clinic_id: string;
  name: string;
  speciality?: string;
  phone?: string;
  is_active?: boolean;
  specialty?: string;
  consultation_fee?: number | null;
  slot_minutes?: number | null;
  user_id?: string | null;
  created_at?: string;
}

export interface Appointment {
  id: string;
  clinic_id: string;
  clinic_patient_id?: string;
  patient_id?: string;
  doctor_id?: string;
  appointment_date: string;
  appointment_time: string;
  status: AppointmentStatus;
  consultation_fee: number;
  symptoms?: string;
  notes?: string;
  mode?: AppointmentMode;
  video_room?: string;
  source?: "app" | "clinic" | "bot" | "online";
  advance_paid?: number;
  duration_minutes?: number;
  start_time?: string | null;
  end_time?: string | null;
  assigned_by?: string | null;
  cancel_reason?: string | null;
  reschedule_count?: number;
  created_at?: string;
  // joined
  patient?: ClinicPatient;
  doctor_name?: string;
  doctor_speciality?: string;
}

export interface Invoice {
  id: string;
  invoice_number?: string;
  clinic_id: string;
  clinic_patient_id?: string;
  appointment_id?: string;
  items?: Array<{ name: string; qty: number; unit_price: number; amount: number }>;
  subtotal?: number;
  discount?: number;
  gst_percent?: number;
  gst_amount?: number;
  total?: number;
  status?: InvoiceStatus;
  paid_amount?: number;
  payment_method?: PaymentMethod;
  created_at?: string;
  // joined
  patient?: Pick<ClinicPatient, "name" | "phone">;
}

export interface StockItem {
  id: string;
  clinic_id: string;
  name: string;
  category?: StockCategory;
  unit?: string;
  quantity: number;
  min_quantity?: number;
  unit_price?: number;
  supplier?: string;
  expiry_date?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StaffMember {
  id: string;
  clinic_id: string;
  user_id: string;
  role: ClinicRole;
  specialty?: string;
  email?: string;
  name?: string;
  is_active?: boolean;
  created_at?: string;
}

export interface DashboardStats {
  todayAppointments: number;
  completedToday: number;
  totalPatients: number;
  todayRevenue: number;
  lowStockCount: number;
}
