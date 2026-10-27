-- 027: how long a visit takes depends on what it is for (a cleaning is not an implant), and the clinic does not have to tell us.
--   treatment_durations   one row per kind of visit (normalised reason, e.g. "root canal"):
--                         minutes  = what the clinic set (optional), samples = how long the last 10 such visits really took
--   Whenever a visit is completed on its own day, the time from its start to completion is added to its samples (ignored if under 10 or over 180 minutes,
--   so a visit closed late in the evening does not spoil the average). Booking suggests the middle (median) of the samples once there are 3.
-- Staff can read; the trigger writes. Safe to run again.

create table if not exists treatment_durations (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  key        text not null,
  label      text,
  minutes    int check (minutes is null or minutes between 5 and 240),
  samples    jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (clinic_id, key)
);
alter table treatment_durations enable row level security;
drop policy if exists "Staff read treatment_durations" on treatment_durations;
create policy "Staff read treatment_durations" on treatment_durations for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));

create or replace function trg_learn_duration() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_txt text; v_key text; v_start timestamp; v_now timestamp := now() at time zone 'Asia/Kolkata'; v_min int;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.start_time is not null and new.appointment_date = v_now::date then
    v_start := new.appointment_date + new.start_time;
    v_min := round(extract(epoch from (v_now - v_start)) / 60.0)::int;
    if v_min >= 10 and v_min <= 180 then
      select coalesce((select title from treatment_plans where id = new.treatment_plan_id), new.symptoms) into v_txt;
      v_key := left(trim(regexp_replace(lower(coalesce(v_txt, '')), '[^a-z0-9]+', ' ', 'g')), 60);
      if length(v_key) >= 3 then
        insert into treatment_durations (clinic_id, key, label, samples) values (new.clinic_id, v_key, left(v_txt, 80), jsonb_build_array(v_min))
        on conflict (clinic_id, key) do update set updated_at = now(),
          samples = (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(treatment_durations.samples || jsonb_build_array(v_min)) with ordinality t(x, n) order by n desc limit 10) q);
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists learn_duration on appointments;
create trigger learn_duration after update of status on appointments for each row execute function trg_learn_duration();
