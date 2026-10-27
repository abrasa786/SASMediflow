-- 021: a record of every tip/offer message sent to a patient, so nobody is messaged too often
-- and the clinic can show who was sent what and when. Writes go through the server only. Safe to run again.

create table if not exists offer_sends (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  patient_id    uuid references clinic_patients(id) on delete set null,
  treatment_id  uuid references treatment_info(id) on delete set null,
  phone         text,
  status        text not null check (status in ('sent','failed','link')),
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists offer_sends_clinic_idx on offer_sends (clinic_id, created_at desc);
create index if not exists offer_sends_patient_idx on offer_sends (patient_id, created_at desc);

alter table offer_sends enable row level security;
drop policy if exists "Staff read offer_sends" on offer_sends;
create policy "Staff read offer_sends" on offer_sends for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));
