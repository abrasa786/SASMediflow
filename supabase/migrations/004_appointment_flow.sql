-- ============================================================
-- Mediflow — Appointment flow engine
-- Run AFTER 001_schema.sql (independent of 003_builder_engine.sql).
--
-- What this adds
--  * doctor_schedules / doctor_leaves   : weekly availability and time off
--  * patient_doctor_assignments         : who is a patient's primary / consulting doctor
--  * appointment_notifications          : log of WhatsApp messages (sent / failed / link)
--  * appointments.start_time/end_time   : real time columns (the text time is kept for the UI)
--  * appt_book()        atomic: upsert patient -> check availability -> pick doctor
--                       -> create appointment -> assign doctor to patient
--  * appt_slots()       free slots per doctor for a date
--  * appt_reschedule(), appt_set_status(), appt_set_schedule()
--  * an exclusion constraint so a doctor can never be double-booked, even in a race
--
-- Booking rules (per clinic, in clinics.settings -> 'booking'):
--    doctor_rule : 'usual_then_free' (default) | 'least_loaded' | 'ask'
--    slot_minutes: default slot length (15)
--    timezone    : default 'Asia/Kolkata'
-- All functions are executable by service_role only; the API checks the caller first.
-- ============================================================

create extension if not exists btree_gist;

-- ─── Columns on existing tables ──────────────────────────────
alter table clinic_patients add column if not exists age_years smallint;
alter table clinic_patients add column if not exists phone_norm text
  generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;
create index if not exists clinic_patients_phone_idx on clinic_patients (clinic_id, phone_norm);

alter table doctors add column if not exists consultation_fee numeric(10,2);
alter table doctors add column if not exists slot_minutes int;

alter table appointments add column if not exists duration_minutes int not null default 15;
alter table appointments add column if not exists start_time time;
alter table appointments add column if not exists end_time time;
alter table appointments add column if not exists assigned_by text default 'manual';
alter table appointments add column if not exists cancel_reason text;
alter table appointments add column if not exists reschedule_count int not null default 0;

-- ─── New tables ──────────────────────────────────────────────
create table if not exists doctor_schedules (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  doctor_id     uuid not null references doctors(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),   -- 0 = Sunday
  start_time    time not null,
  end_time      time not null,
  break_start   time,
  break_end     time,
  slot_minutes  int check (slot_minutes is null or slot_minutes between 5 and 120),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  check (end_time > start_time),
  check ((break_start is null) = (break_end is null)),
  check (break_start is null or (break_end > break_start and break_start >= start_time and break_end <= end_time))
);
create index if not exists doctor_schedules_idx on doctor_schedules (doctor_id, weekday);

create table if not exists doctor_leaves (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  doctor_id  uuid not null references doctors(id) on delete cascade,
  from_date  date not null,
  to_date    date not null,
  reason     text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists doctor_leaves_idx on doctor_leaves (doctor_id, from_date, to_date);

create table if not exists patient_doctor_assignments (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references clinics(id) on delete cascade,
  clinic_patient_id     uuid not null references clinic_patients(id) on delete cascade,
  doctor_id             uuid not null references doctors(id) on delete cascade,
  role                  text not null default 'primary' check (role in ('primary','consulting')),
  is_active             boolean not null default true,
  assigned_on           date not null default current_date,
  source_appointment_id uuid references appointments(id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (clinic_patient_id, doctor_id)
);
create index if not exists pda_doctor_idx on patient_doctor_assignments (doctor_id) where is_active;

create table if not exists appointment_notifications (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references clinics(id) on delete cascade,
  appointment_id      uuid references appointments(id) on delete cascade,
  recipient           text not null check (recipient in ('patient','doctor')),
  phone               text,
  kind                text not null check (kind in ('confirmation','reschedule','cancellation','reminder','no_show')),
  channel             text not null check (channel in ('whatsapp','link')),
  status              text not null check (status in ('sent','failed','link','skipped')),
  provider_message_id text,
  link                text,
  error               text,
  created_at          timestamptz not null default now()
);
create index if not exists appt_notif_idx on appointment_notifications (appointment_id);

alter table doctor_schedules            enable row level security;
alter table doctor_leaves               enable row level security;
alter table patient_doctor_assignments  enable row level security;
alter table appointment_notifications   enable row level security;
do $$
declare t text;
begin
  foreach t in array array['doctor_schedules','doctor_leaves','patient_doctor_assignments','appointment_notifications']
  loop
    execute format('drop policy if exists "Staff read %1$s" on %1$I', t);
    execute format('create policy "Staff read %1$s" on %1$I for select using (is_clinic_staff(clinic_id))', t);
  end loop;
end $$;

-- ─── Small helpers ───────────────────────────────────────────
create or replace function appt_norm_phone(p text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

create or replace function appt_parse_time(t text) returns time language plpgsql immutable as $$
declare m text[]; h int; mi int;
begin
  m := regexp_match(trim(coalesce(t, '')), '^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$');
  if m is null then return null; end if;
  h := m[1]::int; mi := m[2]::int;
  if mi > 59 then return null; end if;
  if m[3] is not null then
    if h < 1 or h > 12 then return null; end if;
    if upper(m[3]) = 'PM' and h < 12 then h := h + 12;
    elsif upper(m[3]) = 'AM' and h = 12 then h := 0; end if;
  elsif h > 23 then return null; end if;
  return make_time(h, mi, 0);
end $$;

create or replace function appt_time_text(t time) returns text language sql immutable as $$
  select ltrim(to_char(t, 'HH12:MI AM'), '0')
$$;

create or replace function appt_clinic_tz(p_clinic uuid) returns text language sql stable as $$
  select coalesce(nullif((select settings->'booking'->>'timezone' from clinics where id = p_clinic), ''), 'Asia/Kolkata')
$$;

-- "Priya" matches "Priya Sharma"; "Priya Sharma" does not match "Rahul Sharma"
create or replace function appt_name_match(a text, b text) returns boolean language sql immutable as $$
  with n as (select lower(regexp_replace(trim(coalesce(a,'')), '\s+', ' ', 'g')) x,
                    lower(regexp_replace(trim(coalesce(b,'')), '\s+', ' ', 'g')) y)
  select x <> '' and y <> '' and (x = y or x like y || ' %' or y like x || ' %') from n
$$;

-- Keep start_time / end_time in sync with the text time + duration
create or replace function appt_set_times() returns trigger language plpgsql as $$
begin
  new.start_time := appt_parse_time(new.appointment_time);
  if new.start_time is null then raise exception 'INVALID_TIME: "%" is not a valid time', new.appointment_time; end if;
  new.duration_minutes := coalesce(new.duration_minutes, 15);
  if extract(epoch from new.start_time) / 60 + new.duration_minutes > 1440 then
    raise exception 'INVALID_TIME: appointment runs past midnight';
  end if;
  new.end_time := new.start_time + make_interval(mins => new.duration_minutes);
  return new;
end $$;

drop trigger if exists trg_appt_times on appointments;
create trigger trg_appt_times before insert or update of appointment_time, duration_minutes on appointments
  for each row execute function appt_set_times();

-- Backfill existing rows one by one, so a single unreadable time cannot block the rest.
do $$
declare r record; bad int := 0;
begin
  for r in select id from appointments where start_time is null loop
    begin
      update appointments set duration_minutes = duration_minutes where id = r.id;
    exception when others then
      bad := bad + 1;
    end;
  end loop;
  if bad > 0 then
    raise warning '% existing appointment(s) have a time that cannot be read and will not block new bookings. Find them with: select id, appointment_date, appointment_time from appointments where start_time is null;', bad;
  end if;
end $$;

-- A doctor cannot hold two confirmed appointments that overlap in time.
do $$
begin
  alter table appointments add constraint appointments_no_doctor_overlap exclude using gist (
    doctor_id with =,
    tsrange(appointment_date + start_time, appointment_date + end_time) with &&
  ) where (status = 'confirmed' and doctor_id is not null and start_time is not null);
exception
  when duplicate_object or duplicate_table then null;   -- already installed
  when exclusion_violation then
    raise warning 'Overlap guard NOT installed because existing appointments already overlap (%). Fix those appointments, then re-run this file.', sqlerrm;
  when others then
    raise warning 'Overlap guard NOT installed: %', sqlerrm;
end $$;

-- ─── Is this slot bookable? returns NULL if yes, otherwise a reason code ──
create or replace function appt_check_slot(
  p_clinic uuid, p_doctor uuid, p_date date, p_start time, p_dur int, p_exclude uuid default null
) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d doctors%rowtype; v_end time; v_wk int := extract(dow from p_date)::int;
  v_has_sched boolean; v_ok boolean; wh jsonb; v_open time; v_close time;
begin
  select * into d from doctors where id = p_doctor and clinic_id = p_clinic;
  if not found or coalesce(d.is_active, true) = false then return 'doctor_inactive'; end if;
  if (p_date + p_start) <= (now() at time zone appt_clinic_tz(p_clinic)) then return 'past'; end if;
  if extract(epoch from p_start) / 60 + p_dur > 1440 then return 'outside_hours'; end if;
  v_end := p_start + make_interval(mins => p_dur);

  if exists (select 1 from doctor_leaves l where l.doctor_id = p_doctor and p_date between l.from_date and l.to_date) then
    return 'on_leave';
  end if;

  select exists (select 1 from doctor_schedules s where s.doctor_id = p_doctor and s.is_active) into v_has_sched;
  if v_has_sched then
    select exists (select 1 from doctor_schedules s
                    where s.doctor_id = p_doctor and s.is_active and s.weekday = v_wk
                      and s.start_time <= p_start and s.end_time >= v_end) into v_ok;
    if not v_ok then return 'outside_hours'; end if;
    if exists (select 1 from doctor_schedules s
                where s.doctor_id = p_doctor and s.is_active and s.weekday = v_wk
                  and s.break_start is not null and p_start < s.break_end and v_end > s.break_start) then
      return 'break';
    end if;
  else
    -- no personal schedule: fall back to the clinic's working hours
    select working_hours into wh from clinics where id = p_clinic;
    if wh is null or not jsonb_exists(coalesce(wh->'days', '[]'::jsonb), trim(to_char(p_date, 'Day'))) then return 'clinic_closed'; end if;
    v_open  := coalesce(nullif(wh->>'open',  '')::time, '09:00');
    v_close := coalesce(nullif(wh->>'close', '')::time, '18:00');
    if p_start < v_open or v_end > v_close then return 'outside_hours'; end if;
  end if;

  if exists (select 1 from appointments a
              where a.doctor_id = p_doctor and a.appointment_date = p_date and a.status = 'confirmed'
                and a.id is distinct from p_exclude and a.start_time < v_end and a.end_time > p_start) then
    return 'booked';
  end if;
  return null;
end $$;

-- ─── Free slots for a date (one doctor, or all doctors) ──────
create or replace function appt_slots(
  p_clinic uuid, p_date date, p_doctor uuid default null, p_dur int default null
) returns table (s_doctor_id uuid, s_doctor_name text, s_time text, s_start time)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  d record; w record; wh jsonb; v_def int; v_step int; v_dur int; m int; m_end int; v_wk int := extract(dow from p_date)::int;
begin
  select c.working_hours, coalesce(nullif(c.settings->'booking'->>'slot_minutes', '')::int, 15)
    into wh, v_def from clinics c where c.id = p_clinic;

  for d in select * from doctors x where x.clinic_id = p_clinic and coalesce(x.is_active, true)
                                       and (p_doctor is null or x.id = p_doctor) order by x.name
  loop
    if exists (select 1 from doctor_schedules s where s.doctor_id = d.id and s.is_active) then
      for w in select s.start_time st, s.end_time en, s.slot_minutes sm from doctor_schedules s
                where s.doctor_id = d.id and s.is_active and s.weekday = v_wk order by s.start_time
      loop
        v_step := coalesce(w.sm, d.slot_minutes, v_def); v_dur := coalesce(p_dur, v_step);
        m := (extract(epoch from w.st) / 60)::int; m_end := (extract(epoch from w.en) / 60)::int;
        while m + v_dur <= m_end loop
          if appt_check_slot(p_clinic, d.id, p_date, make_time(m / 60, m % 60, 0), v_dur) is null then
            s_doctor_id := d.id; s_doctor_name := d.name; s_start := make_time(m / 60, m % 60, 0);
            s_time := appt_time_text(s_start); return next;
          end if;
          m := m + v_step;
        end loop;
      end loop;
    elsif wh is not null and jsonb_exists(coalesce(wh->'days', '[]'::jsonb), trim(to_char(p_date, 'Day'))) then
      v_step := coalesce(d.slot_minutes, v_def); v_dur := coalesce(p_dur, v_step);
      m := (extract(epoch from coalesce(nullif(wh->>'open', '')::time, '09:00')) / 60)::int;
      m_end := (extract(epoch from coalesce(nullif(wh->>'close', '')::time, '18:00')) / 60)::int;
      while m + v_dur <= m_end loop
        if appt_check_slot(p_clinic, d.id, p_date, make_time(m / 60, m % 60, 0), v_dur) is null then
          s_doctor_id := d.id; s_doctor_name := d.name; s_start := make_time(m / 60, m % 60, 0);
          s_time := appt_time_text(s_start); return next;
        end if;
        m := m + v_step;
      end loop;
    end if;
  end loop;
end $$;

-- ─── Pick a doctor when none was named ───────────────────────
create or replace function appt_resolve_doctor(
  p_clinic uuid, p_patient uuid, p_date date, p_start time, p_dur int, p_specialty text default null
) returns table (r_doctor_id uuid, r_how text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rule text; v_doc uuid; v_has_spec boolean;
begin
  select coalesce(nullif(settings->'booking'->>'doctor_rule', ''), 'usual_then_free') into v_rule from clinics where id = p_clinic;
  if v_rule = 'ask' then return; end if;

  if v_rule = 'usual_then_free' then
    select a.doctor_id into v_doc from patient_doctor_assignments a
     where a.clinic_patient_id = p_patient and a.is_active and a.role = 'primary'
       and appt_check_slot(p_clinic, a.doctor_id, p_date, p_start, p_dur) is null
     limit 1;
    if v_doc is not null then r_doctor_id := v_doc; r_how := 'auto_usual'; return next; return; end if;
  end if;

  select exists (select 1 from doctors d where d.clinic_id = p_clinic and coalesce(d.is_active, true)
                   and p_specialty is not null and lower(coalesce(d.specialty, d.speciality, '')) like '%' || lower(p_specialty) || '%')
    into v_has_spec;

  select d.id into v_doc from doctors d
   where d.clinic_id = p_clinic and coalesce(d.is_active, true)
     and (not v_has_spec or lower(coalesce(d.specialty, d.speciality, '')) like '%' || lower(p_specialty) || '%')
     and appt_check_slot(p_clinic, d.id, p_date, p_start, p_dur) is null
   order by (select count(*) from appointments a where a.doctor_id = d.id and a.appointment_date = p_date and a.status = 'confirmed'), d.name
   limit 1;
  if v_doc is not null then r_doctor_id := v_doc; r_how := 'auto_free'; return next; end if;
end $$;

-- ─── Everything a notification needs about an appointment ────
create or replace function appt_details(p_appt uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'appointment', jsonb_build_object('id', a.id, 'clinic_id', a.clinic_id, 'date', a.appointment_date, 'time', a.appointment_time,
        'duration_minutes', a.duration_minutes, 'status', a.status, 'mode', a.mode, 'fee', a.consultation_fee,
        'symptoms', a.symptoms, 'source', a.source, 'assigned_by', a.assigned_by, 'video_room', a.video_room,
        'cancel_reason', a.cancel_reason, 'reschedule_count', a.reschedule_count),
    'patient', jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone),
    'doctor',  case when d.id is null then null else jsonb_build_object('id', d.id, 'name', d.name, 'phone', d.phone) end,
    'clinic',  jsonb_build_object('name', coalesce(c.brand_name, c.name), 'address', c.address, 'phone', c.phone))
  from appointments a
  join clinics c on c.id = a.clinic_id
  left join clinic_patients p on p.id = a.clinic_patient_id
  left join doctors d on d.id = a.doctor_id
  where a.id = p_appt
$$;

-- ─── BOOK: the single entry point for forms, API and bot ─────
-- p = {clinic_id, actor?, patient:{id | name, phone, age?, gender?, email?, allergies?},
--      doctor_id?, specialty?, date, time, duration_minutes?, mode?, symptoms?, notes?, fee?, source?}
create or replace function appt_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid;
  v_actor  uuid := nullif(p->>'actor', '')::uuid;
  pt       jsonb := coalesce(p->'patient', '{}'::jsonb);
  v_name   text := nullif(trim(pt->>'name'), '');
  v_phone  text := nullif(trim(pt->>'phone'), '');
  v_pnorm  text;
  cp       clinic_patients%rowtype;
  v_have   boolean := false;
  v_created boolean := false;
  v_shared boolean := false;
  v_date   date := nullif(p->>'date', '')::date;
  v_start  time;
  v_dur    int;
  v_doc    uuid := nullif(p->>'doctor_id', '')::uuid;
  v_how    text := 'manual';
  v_reason text;
  v_fee    numeric;
  v_mode   text := coalesce(nullif(p->>'mode', ''), 'in_clinic');
  v_appt   uuid;
  v_role   text;
  v_new_assign boolean := false;
  dr       doctors%rowtype;
  v_age    smallint := nullif(pt->>'age', '')::smallint;
begin
  if not exists (select 1 from clinics where id = v_clinic and coalesce(is_active, true)) then raise exception 'CLINIC_NOT_FOUND: clinic not found'; end if;
  if v_date is null then raise exception 'DATE_REQUIRED: please choose a date'; end if;
  v_start := appt_parse_time(p->>'time');
  if v_start is null then raise exception 'TIME_REQUIRED: please choose a time'; end if;
  if v_mode not in ('in_clinic', 'video') then raise exception 'INVALID_MODE: mode must be in_clinic or video'; end if;

  v_dur := coalesce(nullif(p->>'duration_minutes', '')::int,
                    (select slot_minutes from doctors where id = v_doc),
                    (select nullif(settings->'booking'->>'slot_minutes', '')::int from clinics where id = v_clinic), 15);
  if v_dur < 5 or v_dur > 240 then raise exception 'INVALID_DURATION: duration must be 5-240 minutes'; end if;

  -- one booking at a time per clinic-day keeps availability checks honest
  perform pg_advisory_xact_lock(hashtext('appt:' || v_clinic::text || ':' || v_date::text));

  -- ── 1. patient: find or create (upsert) ──
  if nullif(pt->>'id', '') is not null then
    select * into cp from clinic_patients where id = (pt->>'id')::uuid and clinic_id = v_clinic;
    if not found then raise exception 'PATIENT_NOT_FOUND: patient not found in this clinic'; end if;
    v_have := true;
  else
    if v_name is null then raise exception 'NAME_REQUIRED: patient name is required'; end if;
    v_pnorm := appt_norm_phone(v_phone);
    if v_phone is not null and length(v_pnorm) <> 10 then raise exception 'PHONE_INVALID: enter a 10-digit mobile number'; end if;
    if length(v_pnorm) = 10 then
      perform pg_advisory_xact_lock(hashtext('pt:' || v_clinic::text || ':' || v_pnorm));
      select * into cp from clinic_patients
       where clinic_id = v_clinic and phone_norm = v_pnorm and appt_name_match(name, v_name)
       order by length(name) desc, created_at limit 1;
      v_have := found;
      if not v_have then
        v_shared := exists (select 1 from clinic_patients where clinic_id = v_clinic and phone_norm = v_pnorm);
      end if;
    end if;
    if not v_have then
      insert into clinic_patients (clinic_id, name, phone, email, gender, allergies, age_years, notes)
      values (v_clinic, v_name, v_phone, nullif(pt->>'email', ''), nullif(pt->>'gender', ''), nullif(pt->>'allergies', ''), v_age,
              case when coalesce(p->>'source', 'clinic') = 'bot' then 'Created from booking chat' end)
      returning * into cp;
      v_created := true;
    else
      update clinic_patients set
        name      = case when length(v_name) > length(name) and appt_name_match(name, v_name) then v_name else name end,
        email     = coalesce(email, nullif(pt->>'email', '')),
        gender    = coalesce(gender, nullif(pt->>'gender', '')),
        allergies = coalesce(allergies, nullif(pt->>'allergies', '')),
        age_years = coalesce(v_age, age_years),
        phone     = coalesce(phone, v_phone)
       where id = cp.id returning * into cp;
    end if;
  end if;

  -- ── 2. doctor: named (must be free) or auto-assigned ──
  if v_doc is not null then
    v_reason := appt_check_slot(v_clinic, v_doc, v_date, v_start, v_dur);
    if v_reason is not null then raise exception 'SLOT_UNAVAILABLE: %', v_reason; end if;
  else
    select r_doctor_id, r_how into v_doc, v_how from appt_resolve_doctor(v_clinic, cp.id, v_date, v_start, v_dur, nullif(p->>'specialty', ''));
    if v_doc is null then
      if exists (select 1 from clinics where id = v_clinic and settings->'booking'->>'doctor_rule' = 'ask') then
        raise exception 'DOCTOR_REQUIRED: this clinic asks for a doctor to be chosen';
      end if;
      raise exception 'SLOT_UNAVAILABLE: no_doctor_free';
    end if;
  end if;
  select * into dr from doctors where id = v_doc;
  v_fee := coalesce(nullif(p->>'fee', '')::numeric, dr.consultation_fee, 0);

  -- ── 3. appointment ──
  begin
    insert into appointments (clinic_id, clinic_patient_id, doctor_id, appointment_date, appointment_time, duration_minutes,
                              status, mode, symptoms, notes, consultation_fee, source, created_by, assigned_by, video_room)
    values (v_clinic, cp.id, v_doc, v_date, appt_time_text(v_start), v_dur,
            'confirmed', v_mode, nullif(p->>'symptoms', ''), nullif(p->>'notes', ''), v_fee,
            coalesce(nullif(p->>'source', ''), 'clinic'), v_actor, v_how,
            case when v_mode = 'video' then 'mf-' || substr(md5(random()::text), 1, 8) end)
    returning id into v_appt;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE: booked';
  end;

  -- ── 4. patient <-> doctor assignment ──
  if not exists (select 1 from patient_doctor_assignments where clinic_patient_id = cp.id and doctor_id = v_doc) then
    v_new_assign := true;
    v_role := case when exists (select 1 from patient_doctor_assignments
                                 where clinic_patient_id = cp.id and is_active and role = 'primary')
                   then 'consulting' else 'primary' end;
    insert into patient_doctor_assignments (clinic_id, clinic_patient_id, doctor_id, role, source_appointment_id)
    values (v_clinic, cp.id, v_doc, v_role, v_appt);
  else
    update patient_doctor_assignments set is_active = true where clinic_patient_id = cp.id and doctor_id = v_doc
      returning role into v_role;
  end if;

  return appt_details(v_appt) || jsonb_build_object(
    'patient_created', v_created, 'phone_shared', v_shared, 'assigned_how', v_how,
    'assignment', jsonb_build_object('role', v_role, 'new', v_new_assign));
end $$;

-- ─── RESCHEDULE (optionally to another doctor) ───────────────
create or replace function appt_reschedule(
  p_clinic uuid, p_actor uuid, p_appt uuid, p_date date, p_time text, p_doctor uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype; v_start time := appt_parse_time(p_time); v_doc uuid; v_reason text; v_old jsonb; v_role text;
begin
  if p_date is null then raise exception 'DATE_REQUIRED: please choose a date'; end if;
  if v_start is null then raise exception 'TIME_REQUIRED: please choose a time'; end if;
  perform pg_advisory_xact_lock(hashtext('appt:' || p_clinic::text || ':' || p_date::text));
  select * into a from appointments where id = p_appt and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: appointment not found'; end if;
  if a.status <> 'confirmed' then raise exception 'NOT_ALLOWED: only confirmed appointments can be rescheduled'; end if;

  v_doc := coalesce(p_doctor, a.doctor_id);
  if v_doc is null then raise exception 'DOCTOR_REQUIRED: choose a doctor'; end if;
  v_reason := appt_check_slot(p_clinic, v_doc, p_date, v_start, a.duration_minutes, a.id);
  if v_reason is not null then raise exception 'SLOT_UNAVAILABLE: %', v_reason; end if;

  v_old := jsonb_build_object('date', a.appointment_date, 'time', a.appointment_time, 'doctor_id', a.doctor_id);
  begin
    update appointments set appointment_date = p_date, appointment_time = appt_time_text(v_start), doctor_id = v_doc,
           reschedule_count = reschedule_count + 1, assigned_by = case when p_doctor is not null and p_doctor is distinct from a.doctor_id then 'manual' else assigned_by end
     where id = a.id;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE: booked';
  end;

  if v_doc is distinct from a.doctor_id and a.clinic_patient_id is not null then
    v_role := case when exists (select 1 from patient_doctor_assignments where clinic_patient_id = a.clinic_patient_id and is_active and role = 'primary')
                   then 'consulting' else 'primary' end;
    insert into patient_doctor_assignments (clinic_id, clinic_patient_id, doctor_id, role, source_appointment_id)
    values (p_clinic, a.clinic_patient_id, v_doc, v_role, a.id)
    on conflict (clinic_patient_id, doctor_id) do update set is_active = true;
  end if;
  return appt_details(a.id) || jsonb_build_object('previous', v_old);
end $$;

-- ─── STATUS: complete / cancel / no-show / reopen ────────────
create or replace function appt_set_status(
  p_clinic uuid, p_actor uuid, p_appt uuid, p_status text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype; v_reason text;
begin
  if p_status not in ('confirmed','completed','cancelled','no_show') then raise exception 'INVALID_STATUS: unknown status "%"', p_status; end if;
  select * into a from appointments where id = p_appt and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: appointment not found'; end if;
  if a.status = p_status then return appt_details(a.id) || jsonb_build_object('changed', false); end if;

  if a.status = 'completed' then raise exception 'NOT_ALLOWED: a completed appointment cannot be changed'; end if;
  if p_status = 'confirmed' then
    -- reopening needs the slot to still be free
    perform pg_advisory_xact_lock(hashtext('appt:' || p_clinic::text || ':' || a.appointment_date::text));
    if a.doctor_id is not null then
      v_reason := appt_check_slot(p_clinic, a.doctor_id, a.appointment_date, a.start_time, a.duration_minutes, a.id);
      if v_reason is not null then raise exception 'SLOT_UNAVAILABLE: %', v_reason; end if;
    end if;
  end if;

  begin
    update appointments set status = p_status,
           cancel_reason = case when p_status = 'cancelled' then left(p_reason, 300) else null end
     where id = a.id;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE: booked';
  end;
  return appt_details(a.id) || jsonb_build_object('changed', true, 'previous_status', a.status);
end $$;

-- ─── Weekly schedule (replace all rows for a doctor atomically) ──
-- p_rows = [{weekday, start, end, break_start?, break_end?, slot_minutes?}]
create or replace function appt_set_schedule(p_clinic uuid, p_doctor uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; n int := 0; v_s time; v_e time; v_bs time; v_be time;
begin
  if not exists (select 1 from doctors where id = p_doctor and clinic_id = p_clinic) then raise exception 'NOT_FOUND: doctor not found'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'INVALID: rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 28 then raise exception 'INVALID: too many schedule rows'; end if;
  delete from doctor_schedules where doctor_id = p_doctor and clinic_id = p_clinic;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_s := appt_parse_time(r->>'start'); v_e := appt_parse_time(r->>'end');
    v_bs := appt_parse_time(r->>'break_start'); v_be := appt_parse_time(r->>'break_end');
    if v_s is null or v_e is null or v_e <= v_s then raise exception 'INVALID: each row needs a start time before its end time'; end if;
    if (v_bs is null) <> (v_be is null) then raise exception 'INVALID: a break needs both a start and an end'; end if;
    insert into doctor_schedules (clinic_id, doctor_id, weekday, start_time, end_time, break_start, break_end, slot_minutes)
    values (p_clinic, p_doctor, (r->>'weekday')::smallint, v_s, v_e, v_bs, v_be, nullif(r->>'slot_minutes', '')::int);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ─── Lock functions down to the service role ─────────────────
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('appt_check_slot','appt_slots','appt_resolve_doctor','appt_details','appt_book','appt_reschedule','appt_set_status','appt_set_schedule')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
