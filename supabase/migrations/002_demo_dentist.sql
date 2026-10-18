-- ============================================================
-- Mediflow Clinic — Bright Smile Dental Demo Seed
-- Run AFTER 001_schema.sql
-- Idempotent — uses fixed UUIDs, safe to re-run
-- ============================================================

do $$
declare
  v_clinic_id   uuid := 'a1b2c3d4-0001-0001-0001-000000000001';
  v_admin_id    uuid := 'a1b2c3d4-0001-0001-0002-000000000001';
  v_doc1_id     uuid := 'a1b2c3d4-0001-0001-0002-000000000002';
  v_doc2_id     uuid := 'a1b2c3d4-0001-0001-0002-000000000003';
  v_doctor1_id  uuid := 'a1b2c3d4-0001-0001-0003-000000000001';
  v_doctor2_id  uuid := 'a1b2c3d4-0001-0001-0003-000000000002';
  v_p1          uuid := 'a1b2c3d4-0001-0001-0004-000000000001';
  v_p2          uuid := 'a1b2c3d4-0001-0001-0004-000000000002';
  v_p3          uuid := 'a1b2c3d4-0001-0001-0004-000000000003';
  v_p4          uuid := 'a1b2c3d4-0001-0001-0004-000000000004';
  v_p5          uuid := 'a1b2c3d4-0001-0001-0004-000000000005';
  today         date := current_date;
begin

-- ── Clinic ───────────────────────────────────────────────────
insert into clinics (id, name, brand_name, specialty, phone, email, address, city, state, website, gst_number, working_hours)
values (
  v_clinic_id,
  'Bright Smile Dental Clinic',
  'Bright Smile Dental',
  'Dentistry',
  '+91 80 2345 6789',
  'hello@brightsmile.in',
  '12, 3rd Cross, Koramangala 5th Block',
  'Bangalore',
  'Karnataka',
  'https://brightsmile.in',
  '29ABCDE1234F1Z5',
  '{"days":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],"open":"09:00","close":"18:00"}'
)
on conflict (id) do update
  set brand_name = excluded.brand_name,
      specialty  = excluded.specialty;

-- ── Demo admin user in auth.users (if running locally, skip) ─
-- NOTE: Create demo@brightsmile.in manually in Supabase Auth UI
-- with password Demo@1234, then replace v_admin_id with real UUID

-- ── Doctors ──────────────────────────────────────────────────
insert into doctors (id, clinic_id, name, speciality, specialty, phone, is_active)
values
  (v_doctor1_id, v_clinic_id, 'Dr. Priya Sharma',  'Orthodontist',       'Orthodontist',      '+91 98765 43210', true),
  (v_doctor2_id, v_clinic_id, 'Dr. Arjun Mehta',   'Endodontist',        'Endodontist',       '+91 98765 43211', true)
on conflict (id) do update
  set name = excluded.name,
      speciality = excluded.speciality;

-- ── Patients ─────────────────────────────────────────────────
insert into clinic_patients (id, clinic_id, name, phone, gender, blood_group, dob, conditions, allergies, address, emergency_contact_name, emergency_contact_phone)
values
  (v_p1, v_clinic_id, 'Rahul Gupta',     '+91 98100 11111', 'Male',   'B+',  '1985-04-12', 'None', 'Penicillin', 'Whitefield, Bangalore', 'Sneha Gupta', '+91 98100 11112'),
  (v_p2, v_clinic_id, 'Anita Sharma',    '+91 98100 22222', 'Female', 'A+',  '1990-08-25', 'Diabetes', 'None', 'Indiranagar, Bangalore', 'Ramesh Sharma', '+91 98100 22223'),
  (v_p3, v_clinic_id, 'Kiran Patel',     '+91 98100 33333', 'Male',   'O+',  '1978-11-03', 'Hypertension', 'Aspirin', 'JP Nagar, Bangalore', 'Meera Patel', '+91 98100 33334'),
  (v_p4, v_clinic_id, 'Deepa Nair',      '+91 98100 44444', 'Female', 'AB+', '1995-02-17', 'None', 'None', 'Koramangala, Bangalore', 'Suresh Nair', '+91 98100 44445'),
  (v_p5, v_clinic_id, 'Mohammed Farhan', '+91 98100 55555', 'Male',   'B-',  '1982-07-30', 'None', 'Sulpha drugs', 'HSR Layout, Bangalore', 'Fatima Farhan', '+91 98100 55556')
on conflict (id) do update
  set name = excluded.name, phone = excluded.phone;

-- ── Today's Appointments ─────────────────────────────────────
insert into appointments (clinic_id, clinic_patient_id, doctor_id, appointment_date, appointment_time, status, mode, symptoms, consultation_fee, source)
values
  (v_clinic_id, v_p1, v_doctor1_id, today, '09:00 AM', 'completed',  'in_clinic', 'Braces tightening',       800,  'clinic'),
  (v_clinic_id, v_p2, v_doctor2_id, today, '09:30 AM', 'completed',  'in_clinic', 'Root canal follow-up',    1200, 'clinic'),
  (v_clinic_id, v_p3, v_doctor1_id, today, '10:00 AM', 'completed',  'in_clinic', 'Tooth extraction consult', 600, 'clinic'),
  (v_clinic_id, v_p4, v_doctor2_id, today, '10:30 AM', 'confirmed',  'in_clinic', 'Teeth cleaning',          500,  'clinic'),
  (v_clinic_id, v_p5, v_doctor1_id, today, '11:00 AM', 'confirmed',  'in_clinic', 'Crown fitting',           2500, 'clinic'),
  (v_clinic_id, v_p1, v_doctor2_id, today, '11:30 AM', 'confirmed',  'video',     'Post-op check',           400,  'clinic'),
  (v_clinic_id, v_p2, v_doctor1_id, today, '02:00 PM', 'confirmed',  'in_clinic', 'Retainer adjustment',     600,  'clinic'),
  (v_clinic_id, v_p3, v_doctor2_id, today, '02:30 PM', 'cancelled',  'in_clinic', 'Filling',                 800,  'clinic')
on conflict do nothing;

-- ── Past week appointments ────────────────────────────────────
insert into appointments (clinic_id, clinic_patient_id, doctor_id, appointment_date, appointment_time, status, mode, symptoms, consultation_fee, source)
values
  (v_clinic_id, v_p4, v_doctor1_id, today - 1, '09:00 AM', 'completed', 'in_clinic', 'Wisdom tooth pain', 800, 'clinic'),
  (v_clinic_id, v_p5, v_doctor2_id, today - 1, '10:00 AM', 'completed', 'in_clinic', 'Root canal',       3500, 'clinic'),
  (v_clinic_id, v_p1, v_doctor1_id, today - 2, '09:30 AM', 'completed', 'in_clinic', 'Braces check',      800, 'clinic'),
  (v_clinic_id, v_p2, v_doctor2_id, today - 2, '11:00 AM', 'completed', 'in_clinic', 'Crown prep',       2000, 'clinic'),
  (v_clinic_id, v_p3, v_doctor1_id, today - 3, '09:00 AM', 'no_show',   'in_clinic', 'Scaling',           600, 'clinic'),
  (v_clinic_id, v_p4, v_doctor2_id, today - 3, '10:30 AM', 'completed', 'in_clinic', 'Cavity filling',    900, 'clinic'),
  (v_clinic_id, v_p5, v_doctor1_id, today - 4, '09:00 AM', 'completed', 'video',     'Post-treatment',    400, 'clinic'),
  (v_clinic_id, v_p1, v_doctor2_id, today - 4, '11:00 AM', 'completed', 'in_clinic', 'Braces tighten',    800, 'clinic')
on conflict do nothing;

-- ── Invoices ─────────────────────────────────────────────────
insert into invoices (clinic_id, clinic_patient_id, items, subtotal, discount, gst_percent, gst_amount, total, paid_amount, status, payment_method)
values
  (v_clinic_id, v_p1,
    '[{"name":"Braces Tightening","qty":1,"unit_price":800,"amount":800}]'::jsonb,
    800, 0, 18, 144, 944, 944, 'paid', 'upi'),
  (v_clinic_id, v_p2,
    '[{"name":"Root Canal Treatment","qty":1,"unit_price":3500,"amount":3500},{"name":"X-Ray","qty":2,"unit_price":200,"amount":400}]'::jsonb,
    3900, 0, 18, 702, 4602, 4602, 'paid', 'card'),
  (v_clinic_id, v_p3,
    '[{"name":"Consultation","qty":1,"unit_price":600,"amount":600}]'::jsonb,
    600, 0, 18, 108, 708, 708, 'paid', 'cash'),
  (v_clinic_id, v_p4,
    '[{"name":"Crown Fitting","qty":1,"unit_price":8000,"amount":8000},{"name":"Temp Crown","qty":1,"unit_price":1500,"amount":1500}]'::jsonb,
    9500, 500, 18, 1710, 10710, 5355, 'partially_paid', 'cash'),
  (v_clinic_id, v_p5,
    '[{"name":"Teeth Whitening","qty":1,"unit_price":5000,"amount":5000},{"name":"Polishing","qty":1,"unit_price":800,"amount":800}]'::jsonb,
    5800, 300, 18, 1044, 6544, 0, 'sent', 'upi')
on conflict do nothing;

-- ── Stock ─────────────────────────────────────────────────────
insert into stock_items (clinic_id, name, category, quantity, min_quantity, unit, unit_price, supplier, expiry_date)
values
  (v_clinic_id, 'Dental Floss',            'consumable',  45,  10, 'rolls',  25,    'Colgate Dental',    '2026-12-31'),
  (v_clinic_id, 'Composite Resin (A2)',    'medicine',     8,  10, 'syringes', 850, 'GC India',          '2025-09-30'),
  (v_clinic_id, 'Disposable Gloves (M)',   'consumable', 120,  50, 'pairs',    6,   'Mediglove',         '2026-06-30'),
  (v_clinic_id, 'Dental Anesthetic',       'medicine',    12,  15, 'cartridges', 180, 'Septodont',       '2025-11-30'),
  (v_clinic_id, 'Suction Tips',            'consumable',  80,  30, 'pcs',      8,   'Dentsply',          '2027-01-31'),
  (v_clinic_id, 'Dental X-Ray Film',       'consumable',  35,  20, 'sheets',  45,   'Kodak Dental',     '2025-08-31'),
  (v_clinic_id, 'Prophy Paste',            'medicine',     4,   5, 'cups',    55,   'Dentsply',          '2026-03-31'),
  (v_clinic_id, 'Orthodontic Wire (018)',  'equipment',   22,  10, 'pcs',    180,   'Ormco India',      '2027-06-30'),
  (v_clinic_id, 'Etchant Gel',             'medicine',     9,   5, 'syringes', 220, 'Ivoclar',           '2026-01-31'),
  (v_clinic_id, 'Disposable Masks',        'consumable',  60,  50, 'pcs',      5,   '3M India',         '2026-12-31'),
  (v_clinic_id, 'Articulating Paper',      'consumable',  15,   5, 'booklets', 90,  'Bausch',           '2027-03-31'),
  (v_clinic_id, 'Dental Mirror Set',       'equipment',    3,   5, 'sets',    350,  'Hu-Friedy',        null)
on conflict do nothing;

end $$;
