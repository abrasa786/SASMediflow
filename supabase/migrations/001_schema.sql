-- ============================================================
-- Mediflow Clinic — Core Schema
-- Run this in Supabase SQL Editor (Project: twjkqbmhujctxebhnwec)
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── Clinics ─────────────────────────────────────────────────
create table if not exists clinics (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand_name    text,
  specialty     text,
  phone         text,
  email         text,
  address       text,
  city          text,
  state         text,
  country       text default 'India',
  pincode       text,
  website       text,
  gst_number    text,
  logo_url      text,
  working_hours jsonb default '{"days":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],"open":"09:00","close":"18:00"}'::jsonb,
  settings      jsonb default '{}'::jsonb,
  is_active     boolean default true,
  created_at    timestamptz default now()
);

-- ─── Clinic staff (auth.users ↔ clinic) ──────────────────────
create table if not exists clinic_staff (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid references clinics(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin','doctor','nurse','receptionist')),
  name       text,
  specialty  text,
  is_active  boolean default true,
  created_at timestamptz default now(),
  unique (clinic_id, user_id)
);

-- ─── Doctors (richer profile, may overlap with staff) ────────
create table if not exists doctors (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid references clinics(id) on delete cascade,
  user_id    uuid references auth.users(id),
  name       text not null,
  speciality text,
  specialty  text,       -- alias
  phone      text,
  email      text,
  is_active  boolean default true,
  created_at timestamptz default now(),
  unique (clinic_id, user_id)
);

-- ─── Clinic patients (walk-in / clinic-registered) ───────────
create table if not exists clinic_patients (
  id                      uuid primary key default gen_random_uuid(),
  clinic_id               uuid references clinics(id) on delete cascade,
  patient_id              uuid references auth.users(id),   -- null for walk-ins
  name                    text not null,
  phone                   text,
  email                   text,
  dob                     date,
  gender                  text,
  blood_group             text,
  allergies               text,
  conditions              text,
  medications             text,
  address                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  notes                   text,
  created_at              timestamptz default now()
);

-- ─── Appointments ─────────────────────────────────────────────
create table if not exists appointments (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid references clinics(id) on delete cascade,
  clinic_patient_id uuid references clinic_patients(id),
  doctor_id         uuid references doctors(id),
  appointment_date  date not null,
  appointment_time  text not null,
  status            text not null default 'confirmed'
                      check (status in ('confirmed','completed','cancelled','no_show')),
  mode              text default 'in_clinic' check (mode in ('in_clinic','video')),
  symptoms          text,
  notes             text,
  consultation_fee  numeric(10,2) default 0,
  source            text default 'clinic',
  video_room        text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz default now()
);

-- ─── Invoices ─────────────────────────────────────────────────
create sequence if not exists invoice_seq;

create table if not exists invoices (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid references clinics(id) on delete cascade,
  clinic_patient_id  uuid references clinic_patients(id),
  appointment_id     uuid references appointments(id),
  invoice_number     text unique,
  items              jsonb default '[]'::jsonb,
  subtotal           numeric(10,2) default 0,
  discount           numeric(10,2) default 0,
  gst_percent        numeric(5,2)  default 18,
  gst_amount         numeric(10,2) default 0,
  total              numeric(10,2) default 0,
  paid_amount        numeric(10,2) default 0,
  status             text default 'draft'
                       check (status in ('draft','sent','paid','partially_paid','cancelled')),
  payment_method     text default 'cash'
                       check (payment_method in ('cash','upi','card','insurance','other')),
  notes              text,
  created_at         timestamptz default now()
);

-- Auto-generate invoice number: INV-YYYY-NNNN
create or replace function set_invoice_number()
returns trigger language plpgsql as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_number on invoices;
create trigger trg_invoice_number
  before insert on invoices
  for each row execute function set_invoice_number();

-- ─── Stock ────────────────────────────────────────────────────
create table if not exists stock_items (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid references clinics(id) on delete cascade,
  name         text not null,
  category     text default 'other'
                 check (category in ('medicine','consumable','equipment','lab_supply','other')),
  quantity     integer not null default 0,
  min_quantity integer not null default 5,
  unit         text default 'pcs',
  unit_price   numeric(10,2) default 0,
  supplier     text,
  expiry_date  date,
  notes        text,
  updated_at   timestamptz default now(),
  created_at   timestamptz default now()
);

-- ─── RLS Policies ─────────────────────────────────────────────
alter table clinics         enable row level security;
alter table clinic_staff    enable row level security;
alter table doctors         enable row level security;
alter table clinic_patients enable row level security;
alter table appointments    enable row level security;
alter table invoices        enable row level security;
alter table stock_items     enable row level security;

-- Helper: is the current user a staff member of a clinic?
create or replace function is_clinic_staff(p_clinic_id uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1 from clinic_staff
    where clinic_id = p_clinic_id
      and user_id   = auth.uid()
      and is_active = true
  );
$$;

-- Clinics: staff can read
create policy "Staff can read their clinic"
  on clinics for select using (is_clinic_staff(id));

create policy "Admin can update their clinic"
  on clinics for update using (
    exists (select 1 from clinic_staff where clinic_id = id and user_id = auth.uid() and role = 'admin')
  );

-- clinic_staff: members can read their clinic's staff
create policy "Staff can see teammates"
  on clinic_staff for select using (is_clinic_staff(clinic_id));

-- Doctors
create policy "Staff can see clinic doctors"
  on doctors for select using (is_clinic_staff(clinic_id));

create policy "Admin/Doctor can manage doctors"
  on doctors for all using (
    exists (select 1 from clinic_staff where clinic_id = doctors.clinic_id and user_id = auth.uid() and role in ('admin','doctor'))
  );

-- Clinic patients
create policy "Staff can CRUD clinic patients"
  on clinic_patients for all using (is_clinic_staff(clinic_id));

-- Appointments
create policy "Staff can CRUD appointments"
  on appointments for all using (is_clinic_staff(clinic_id));

-- Invoices
create policy "Staff can CRUD invoices"
  on invoices for all using (is_clinic_staff(clinic_id));

-- Stock
create policy "Staff can CRUD stock"
  on stock_items for all using (is_clinic_staff(clinic_id));
