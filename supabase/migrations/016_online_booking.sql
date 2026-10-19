-- 016: online booking by patients, with a confirmation fee.
--   booking_holds     a slot held for a few minutes while the patient pays (nobody else can take it)
--   booking_payments  every online payment and what happened to it (paid, refunded)
--   appt_check_slot   now also treats a live hold as "booked"
--   online_hold       validates and holds a slot (rate limited per phone)
--   online_confirm    after payment: books through the normal engine, records the payment and an invoice, in one step
-- Clinic settings live in clinics.settings.online_booking {enabled, fee, hold_minutes, advance_days, notice}.
-- Safe to run again.

alter table appointments add column if not exists advance_paid numeric(10,2) not null default 0;
alter table appointments add column if not exists advance_invoice uuid references invoices(id) on delete set null;   -- the final bill that deducted the advance

create table if not exists booking_holds (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  doctor_id        uuid not null references doctors(id) on delete cascade,
  appointment_date date not null,
  start_time       time not null,
  end_time         time not null,
  duration_minutes int  not null,
  patient          jsonb not null,
  symptoms         text,
  fee              numeric(10,2) not null default 0,   -- the consultation fee
  amount           numeric(10,2) not null default 0,   -- the confirmation fee charged now
  order_id         text,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);
create index if not exists booking_holds_slot_idx on booking_holds (doctor_id, appointment_date, expires_at);
create index if not exists booking_holds_order_idx on booking_holds (order_id);

create table if not exists booking_payments (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  invoice_id     uuid references invoices(id) on delete set null,
  provider       text not null default 'razorpay',
  order_id       text not null,
  payment_id     text,
  amount         numeric(10,2) not null,
  currency       text not null default 'INR',
  status         text not null default 'paid' check (status in ('paid','refunded','refund_failed')),
  refund_id      text,
  note           text,
  patient_phone  text,
  created_at     timestamptz not null default now(),
  unique (provider, order_id)
);
create index if not exists booking_payments_clinic_idx on booking_payments (clinic_id, created_at desc);

alter table booking_holds enable row level security;      -- no policy: only the server (service role) touches holds
alter table booking_payments enable row level security;
drop policy if exists "Staff read booking_payments" on booking_payments;
create policy "Staff read booking_payments" on booking_payments for select using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));

-- ─── Is this slot bookable? (as before, plus: a live hold counts as taken) ───
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
  if exists (select 1 from booking_holds h
              where h.doctor_id = p_doctor and h.appointment_date = p_date and h.expires_at > now()
                and h.id is distinct from p_exclude and h.start_time < v_end and h.end_time > p_start) then
    return 'booked';
  end if;
  return null;
end $$;

-- ─── Hold a slot while the patient pays ───
create or replace function online_hold(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid;
  v_doc    uuid := nullif(p->>'doctor_id', '')::uuid;
  v_date   date := nullif(p->>'date', '')::date;
  v_start  time := appt_parse_time(p->>'time');
  v_name   text := nullif(trim(p#>>'{patient,name}'), '');
  v_phone  text := nullif(trim(p#>>'{patient,phone}'), '');
  v_pn     text;
  s        jsonb;
  d        doctors%rowtype;
  v_dur    int; v_sm int; v_fee numeric; v_amount numeric; v_mins int; v_ahead int;
  v_reason text; v_id uuid; v_exp timestamptz;
begin
  select coalesce(settings->'online_booking', '{}'::jsonb) into s from clinics where id = v_clinic and coalesce(is_active, true);
  if not found then raise exception 'CLINIC_NOT_FOUND: clinic not found'; end if;
  if coalesce((s->>'enabled')::boolean, false) is not true then raise exception 'ONLINE_OFF: online booking is not switched on for this clinic'; end if;
  if v_date is null or v_start is null then raise exception 'SLOT_REQUIRED: please choose a date and time'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'NAME_REQUIRED: please enter your name'; end if;
  v_pn := appt_norm_phone(v_phone);
  if length(v_pn) <> 10 then raise exception 'PHONE_INVALID: enter a 10-digit mobile number'; end if;
  v_ahead := coalesce(nullif(s->>'advance_days', '')::int, 30);
  if v_date > current_date + v_ahead then raise exception 'TOO_FAR: bookings open % days ahead', v_ahead; end if;

  select * into d from doctors where id = v_doc and clinic_id = v_clinic and coalesce(is_active, true);
  if not found then raise exception 'DOCTOR_REQUIRED: please choose a doctor'; end if;

  delete from booking_holds where expires_at < now() - interval '1 day';

  perform pg_advisory_xact_lock(hashtext('appt:' || v_clinic::text || ':' || v_date::text));   -- same lock as appt_book

  -- the step this doctor uses at this time (schedule window first, as the slot list does)
  select ds.slot_minutes into v_sm from doctor_schedules ds
   where ds.doctor_id = v_doc and ds.is_active and ds.weekday = extract(dow from v_date)::int
     and ds.start_time <= v_start and ds.end_time > v_start order by ds.start_time limit 1;
  v_dur := coalesce(v_sm, d.slot_minutes, nullif((select settings->'booking'->>'slot_minutes' from clinics where id = v_clinic), '')::int, 15);

  v_reason := appt_check_slot(v_clinic, v_doc, v_date, v_start, v_dur);
  if v_reason is not null then raise exception 'SLOT_UNAVAILABLE: %', v_reason; end if;

  -- abuse limits: a few open holds, and a few upcoming online bookings, per phone
  if (select count(*) from booking_holds h where h.clinic_id = v_clinic and h.expires_at > now()
        and appt_norm_phone(h.patient->>'phone') = v_pn) >= 3 then
    raise exception 'TOO_MANY: you already have bookings waiting for payment. Please finish or wait a few minutes';
  end if;
  if (select count(*) from appointments a join clinic_patients cp on cp.id = a.clinic_patient_id
       where a.clinic_id = v_clinic and a.source = 'online' and a.status = 'confirmed' and a.appointment_date >= current_date
         and cp.phone_norm = v_pn) >= 4 then
    raise exception 'TOO_MANY: this number already has several upcoming bookings. Please call the clinic';
  end if;

  v_fee := coalesce(d.consultation_fee, 0);
  v_amount := greatest(coalesce(nullif(s->>'fee', '')::numeric, 0), 0);
  v_mins := least(greatest(coalesce(nullif(s->>'hold_minutes', '')::int, 10), 3), 30);
  v_exp := now() + make_interval(mins => v_mins);

  insert into booking_holds (clinic_id, doctor_id, appointment_date, start_time, end_time, duration_minutes, patient, symptoms, fee, amount, expires_at)
  values (v_clinic, v_doc, v_date, v_start, v_start + make_interval(mins => v_dur), v_dur,
          jsonb_build_object('name', v_name, 'phone', v_phone, 'email', nullif(trim(p#>>'{patient,email}'), '')),
          nullif(left(trim(coalesce(p->>'symptoms', '')), 300), ''), v_fee, v_amount, v_exp)
  returning id into v_id;

  return jsonb_build_object('hold_id', v_id, 'amount', v_amount, 'fee', v_fee, 'expires_at', v_exp, 'minutes', v_mins,
                            'doctor', d.name, 'date', v_date, 'time', appt_time_text(v_start), 'duration', v_dur);
end $$;

-- ─── After payment (or straight away when the clinic charges nothing): make the real appointment ───
create or replace function online_confirm(p_hold uuid, p_order text, p_payment text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  h booking_holds%rowtype; v_res jsonb; v_appt uuid; v_inv uuid; v_prev booking_payments%rowtype;
  v_pat uuid;
begin
  if p_order is not null then
    select * into v_prev from booking_payments where provider = 'razorpay' and order_id = p_order;
    if found and v_prev.appointment_id is not null then            -- already confirmed (the browser and the webhook both call this)
      return appt_details(v_prev.appointment_id) || jsonb_build_object('already', true);
    end if;
  end if;

  select * into h from booking_holds where id = p_hold for update;
  if not found then raise exception 'HOLD_GONE: this booking is no longer held'; end if;
  perform pg_advisory_xact_lock(hashtext('appt:' || h.clinic_id::text || ':' || h.appointment_date::text));

  delete from booking_holds where id = h.id;                       -- release our own hold, then book through the normal engine
  begin
    v_res := appt_book(jsonb_build_object(
      'clinic_id', h.clinic_id, 'patient', h.patient, 'doctor_id', h.doctor_id, 'date', h.appointment_date,
      'time', appt_time_text(h.start_time), 'duration_minutes', h.duration_minutes, 'mode', 'in_clinic',
      'symptoms', h.symptoms, 'fee', h.fee, 'source', 'online'));
  exception when others then
    if sqlerrm like 'SLOT_UNAVAILABLE%' then raise exception 'SLOT_LOST: the slot was taken before payment completed'; end if;
    raise;
  end;
  v_appt := (v_res#>>'{appointment,id}')::uuid;

  if h.amount > 0 then
    update appointments set advance_paid = h.amount where id = v_appt;
    select clinic_patient_id into v_pat from appointments where id = v_appt;
    insert into invoices (clinic_id, clinic_patient_id, appointment_id, items, subtotal, discount, gst_percent, gst_amount, total, paid_amount, status, payment_method, notes)
    values (h.clinic_id, v_pat, v_appt,
            jsonb_build_array(jsonb_build_object('name', 'Online booking fee (adjusted in your final bill)', 'qty', 1, 'unit_price', h.amount, 'amount', h.amount)),
            h.amount, 0, 0, 0, h.amount, h.amount, 'paid', 'other', 'Online booking fee, Razorpay ' || coalesce(p_payment, ''))
    returning id into v_inv;
    insert into booking_payments (clinic_id, appointment_id, invoice_id, order_id, payment_id, amount, status, patient_phone)
    values (h.clinic_id, v_appt, v_inv, coalesce(p_order, 'free-' || h.id), p_payment, h.amount, 'paid', h.patient->>'phone')
    on conflict (provider, order_id) do update set appointment_id = excluded.appointment_id, invoice_id = excluded.invoice_id, payment_id = excluded.payment_id;
  end if;
  return appt_details(v_appt) || jsonb_build_object('advance_paid', h.amount);
end $$;

-- ─── Mark a payment refunded (called after the gateway refund succeeds or fails) ───
create or replace function online_note_refund(p_clinic uuid, p_order text, p_payment text, p_amount numeric, p_refund text, p_ok boolean, p_note text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into booking_payments (clinic_id, order_id, payment_id, amount, status, refund_id, note)
  values (p_clinic, p_order, p_payment, p_amount, case when p_ok then 'refunded' else 'refund_failed' end, p_refund, p_note)
  on conflict (provider, order_id) do update set status = excluded.status, refund_id = excluded.refund_id, note = excluded.note;
$$;

do $$ declare fn text; begin
  foreach fn in array array['online_hold(jsonb)','online_confirm(uuid,text,text)','online_note_refund(uuid,text,text,numeric,text,boolean,text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;
