-- 030: saved list views (like "Unpaid bills" or "Today's no-shows"): each person keeps their own filters, columns and sort per list.
create table if not exists list_views (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  entity     text not null,
  name       text not null,
  config     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (clinic_id, user_id, entity, name)
);
alter table list_views enable row level security;
drop policy if exists list_views_own on list_views;
create policy list_views_own on list_views for all using (user_id = auth.uid() and is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist','intern']))
  with check (user_id = auth.uid() and is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist','intern']));
