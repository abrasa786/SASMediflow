-- 024: custom fields on the built-in records (patients, appointments, invoices, stock, tasks, doctors), and a list of
-- Builder requests it could not handle yet.
--   <table>.custom        the values of the fields the clinic added, as {"field_name": value}. No schema change is needed per field.
--   custom_field_defs     which fields exist for which record type (label, type, dropdown choices, required)
--   builder_unhandled     what an admin asked the Builder that it could not do, so it can be taught to do it
-- The Builder writes custom_field_defs through the server after the admin approves a plan. Staff can read. Safe to run again.

alter table clinic_patients add column if not exists custom jsonb not null default '{}'::jsonb;
alter table appointments    add column if not exists custom jsonb not null default '{}'::jsonb;
alter table invoices        add column if not exists custom jsonb not null default '{}'::jsonb;
alter table stock_items     add column if not exists custom jsonb not null default '{}'::jsonb;
alter table clinic_tasks    add column if not exists custom jsonb not null default '{}'::jsonb;
alter table doctors         add column if not exists custom jsonb not null default '{}'::jsonb;

create table if not exists custom_field_defs (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics(id) on delete cascade,
  entity          text not null check (entity in ('patients','appointments','invoices','stock','tasks','doctors')),
  api_name        text not null check (api_name ~ '^[a-z][a-z0-9_]{0,40}$'),
  label           text not null,
  data_type       text not null check (data_type in ('text','long_text','number','currency','date','datetime','boolean','picklist','email','phone','url')),
  required        boolean not null default false,
  picklist_values jsonb,
  help_text       text,
  sort_order      int not null default 0,
  status          text not null default 'active' check (status in ('active','hidden')),
  created_by      uuid,
  created_at      timestamptz not null default now(),
  unique (clinic_id, entity, api_name)
);
alter table custom_field_defs enable row level security;
drop policy if exists "Staff read custom_field_defs" on custom_field_defs;
create policy "Staff read custom_field_defs" on custom_field_defs for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist','intern']));

create table if not exists builder_unhandled (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid references clinics(id) on delete cascade,
  user_id    uuid,
  prompt     text not null,
  created_at timestamptz not null default now()
);
alter table builder_unhandled enable row level security;      -- no policy: only the server reads and writes it
