-- 034: bring patients over from another app (Practo and others) by file. Every import is one batch, so a mistake can be undone for the whole batch.
create table if not exists import_batches (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  kind       text not null default 'patients',
  file_name  text,
  total      int not null default 0,
  added      int not null default 0,
  duplicates int not null default 0,
  failed     int not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  undone_at  timestamptz
);
create index if not exists import_batches_clinic_idx on import_batches (clinic_id, created_at desc);
alter table import_batches enable row level security;
drop policy if exists import_batches_admin on import_batches;
create policy import_batches_admin on import_batches for select using (is_clinic_role(clinic_id, array['admin']));

alter table clinic_patients add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
create index if not exists clinic_patients_batch_idx on clinic_patients (import_batch_id) where import_batch_id is not null;
