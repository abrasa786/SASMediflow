-- 031: speed. Indexes for the screens used all day (calendar by date, a patient's visits and bills, the bill list). Safe to run again.
create index if not exists appointments_clinic_date_idx    on appointments (clinic_id, appointment_date, appointment_time);
create index if not exists appointments_clinic_patient_idx on appointments (clinic_id, clinic_patient_id, appointment_date desc);
create index if not exists invoices_clinic_created_idx     on invoices (clinic_id, created_at desc);
create index if not exists invoices_clinic_patient_idx     on invoices (clinic_id, clinic_patient_id, created_at desc);
create index if not exists stock_items_clinic_idx          on stock_items (clinic_id, name);
