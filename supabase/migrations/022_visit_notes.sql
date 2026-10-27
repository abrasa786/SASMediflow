-- 022: what was done at each visit, and what the dentist found, kept with the patient for every future visit.
--   visit_notes   one row per treatment or finding: tooth, treatment done, findings, the patient's concerns,
--                 conditions noticed (e.g. "weak inner bone"), an alert shown at EVERY future appointment, and a follow-up.
-- Staff can read. Writes go through the server (/api/visits/note), which checks role and clinic. Safe to run again.

create table if not exists visit_notes (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics(id) on delete cascade,
  clinic_patient_id uuid not null references clinic_patients(id) on delete cascade,
  appointment_id    uuid references appointments(id) on delete set null,
  doctor_id         uuid references doctors(id) on delete set null,
  visit_date        date not null default current_date,
  tooth             text,                  -- e.g. "46" or "upper left molar"
  treatment         text not null,         -- what was done
  findings          text,                  -- what the dentist saw
  concerns          text,                  -- what the patient is worried about
  conditions        text,                  -- e.g. "inner bone is weak"
  alert             text,                  -- shown in a warning box at every future appointment
  follow_up         text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists visit_notes_patient_idx on visit_notes (clinic_id, clinic_patient_id, visit_date desc);
create index if not exists visit_notes_appt_idx on visit_notes (appointment_id);

alter table visit_notes enable row level security;
drop policy if exists "Staff read visit_notes" on visit_notes;
create policy "Staff read visit_notes" on visit_notes for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));
