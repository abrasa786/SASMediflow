-- 015: WhatsApp two-way chat and patient recall.
--   wa_inbound       every incoming message once (so a retry from WhatsApp never acts twice) and a per-phone rate limit
--   wa_conversations where a patient is in a multi-step chat (choosing a slot, confirming a cancel)
--   recall_log       every recall message and what happened to it (also the cool-down so nobody is nagged)
--   recall_candidates  who is due a nudge: a treatment with nothing booked, or a patient who has not visited for a long time
-- Safe to run again.

alter table clinic_patients add column if not exists wa_opt_out boolean not null default false;
alter table clinic_patients add column if not exists wa_opt_out_at timestamptz;

create table if not exists wa_inbound (
  message_id  text primary key,
  phone       text not null,
  clinic_id   uuid,
  received_at timestamptz not null default now()
);
create index if not exists wa_inbound_phone_idx on wa_inbound (phone, received_at desc);

create table if not exists wa_conversations (
  phone       text primary key,
  clinic_id   uuid references clinics(id) on delete cascade,
  state       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists recall_log (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  patient_id  uuid not null references clinic_patients(id) on delete cascade,
  reason      text not null check (reason in ('treatment_pending','lapsed')),
  channel     text not null default 'whatsapp' check (channel in ('whatsapp','link')),
  status      text not null check (status in ('sent','link','failed','skipped')),
  link        text,
  error       text,
  sent_by     uuid,
  auto        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists recall_log_idx on recall_log (clinic_id, patient_id, created_at desc);

alter table wa_inbound enable row level security;
alter table wa_conversations enable row level security;
alter table recall_log enable row level security;
drop policy if exists "Staff read recall_log" on recall_log;
create policy "Staff read recall_log" on recall_log for select using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));

-- Who is due a nudge. Not for people who opted out, have no phone, or were nudged within the cool-down.
create or replace function recall_candidates(p_clinic uuid, p_days int default 180, p_cooldown int default 30)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with future as (
    select distinct clinic_patient_id from appointments
    where clinic_id = p_clinic and status = 'confirmed' and appointment_date >= current_date and clinic_patient_id is not null
  ), last_visit as (
    select clinic_patient_id, max(appointment_date) as d from appointments
    where clinic_id = p_clinic and status = 'completed' and clinic_patient_id is not null group by 1
  ), pending as (
    select tp.clinic_patient_id, string_agg(tp.title, ', ' order by tp.created_at) as detail
    from treatment_plans tp where tp.clinic_id = p_clinic and tp.status = 'active' group by 1
  ), recent as (
    select distinct patient_id from recall_log where clinic_id = p_clinic and status in ('sent','link') and created_at > now() - make_interval(days => greatest(p_cooldown, 1))
  ), rows as (
    select p.id as patient_id, p.name, p.phone,
           case when pe.clinic_patient_id is not null then 'treatment_pending' else 'lapsed' end as reason,
           coalesce(pe.detail, 'No visit since ' || to_char(lv.d, 'DD Mon YYYY')) as detail,
           lv.d as last_visit, (current_date - lv.d) as days_since
    from clinic_patients p
    left join pending pe on pe.clinic_patient_id = p.id
    left join last_visit lv on lv.clinic_patient_id = p.id
    where p.clinic_id = p_clinic and not p.wa_opt_out and coalesce(btrim(p.phone), '') <> ''
      and not exists (select 1 from future f where f.clinic_patient_id = p.id)
      and not exists (select 1 from recent r where r.patient_id = p.id)
      and (pe.clinic_patient_id is not null or (lv.d is not null and lv.d < current_date - greatest(p_days, 30)))
    order by (pe.clinic_patient_id is null), lv.d nulls last
    limit 200
  )
  select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb) from rows;
$$;

-- Which patients (in which clinics) use this phone number?  Matches on the last 10 digits.
create or replace function wa_find_patients(p_phone text)
returns table (clinic_id uuid, clinic_name text, patient_id uuid, patient_name text, opted_out boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.clinic_id, coalesce(c.brand_name, c.name), p.id, p.name, p.wa_opt_out
  from clinic_patients p join clinics c on c.id = p.clinic_id and coalesce(c.is_active, true)
  where length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 10
    and right(regexp_replace(p.phone, '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
  order by c.name, p.name
  limit 20;
$$;

do $$ declare fn text; begin
  foreach fn in array array['recall_candidates(uuid,int,int)','wa_find_patients(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;
