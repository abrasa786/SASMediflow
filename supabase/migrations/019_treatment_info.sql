-- 019: the treatment library - patient-friendly explainers the clinic can send on WhatsApp and turn into posters.
--   treatment_info   one row per service (name, why it is needed, steps, pain, aftercare, price, questions, offer)
-- Writes go through the server (/api/treatments/info). Staff can read. Published rows are shown to anyone with the link
-- through a server page (/t/<id>), never through direct table access.
-- Safe to run again.

create table if not exists treatment_info (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  name          text not null,
  category      text,
  summary       text,                       -- one friendly line
  why_needed    text,                       -- why the dentist advises it
  steps         jsonb not null default '[]', -- ["Numbing", "Procedure", ...]
  duration_text text,                       -- "30 to 45 minutes, one visit"
  pain_text     text,                       -- "Numbed first, so you should feel pressure, not pain"
  aftercare     text,
  delay_risk    text,                       -- what can happen if it is put off
  price_from    numeric(10,2),
  price_to      numeric(10,2),
  emi_note      text,
  faqs          jsonb not null default '[]', -- [{"q": "...", "a": "..."}]
  offer_text    text,                       -- shown on the poster, e.g. "Free check-up this month"
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists treatment_info_clinic_idx on treatment_info (clinic_id, name);

alter table treatment_info enable row level security;
drop policy if exists "Staff read treatment_info" on treatment_info;
create policy "Staff read treatment_info" on treatment_info for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));
