

-- ===== 028_ai_memory.sql =====
-- 028: the Builder (and later the phone agent) learns from what the clinic approves, so nobody has to train it.
-- Every plan an admin approves is remembered for that clinic. Next time the same or a very similar request comes in,
-- it is answered straight from memory (and re-checked against the clinic's current setup first). Server-only table. Safe to run again.
create table if not exists ai_memory (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  module       text not null default 'builder',
  key          text not null,
  prompt       text not null,
  plan         jsonb not null,
  uses         int  not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (clinic_id, module, key)
);
create index if not exists ai_memory_clinic_idx on ai_memory (clinic_id, module, last_used_at desc);
alter table ai_memory enable row level security;   -- no policy: only the server reads and writes it


-- ===== 029_appointment_numbers.sql =====
-- 029: a short, readable number for every appointment (APT-00001), shown in the appointments list and found by search.
-- Existing appointments are numbered oldest first. Safe to run again.
create sequence if not exists appointment_seq;
alter table appointments add column if not exists appt_no text;

with ordered as (select id, row_number() over (order by created_at nulls first, id) as n from appointments where appt_no is null)
update appointments a set appt_no = 'APT-' || lpad((select nextval('appointment_seq'))::text, 5, '0') from ordered o where a.id = o.id;

create or replace function set_appt_no() returns trigger language plpgsql as $$
begin
  if new.appt_no is null then new.appt_no := 'APT-' || lpad(nextval('appointment_seq')::text, 5, '0'); end if;
  return new;
end $$;
drop trigger if exists trg_appt_no on appointments;
create trigger trg_appt_no before insert on appointments for each row execute function set_appt_no();

create index if not exists appointments_clinic_created_idx on appointments (clinic_id, created_at desc);
create index if not exists appointments_appt_no_idx on appointments (clinic_id, appt_no);


-- ===== 030_list_views.sql =====
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
