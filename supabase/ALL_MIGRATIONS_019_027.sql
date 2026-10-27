-- Mediflow: migrations 019-026 in order, safe to run again. Paste into Supabase -> SQL Editor -> Run.

-- ===== supabase/migrations/019_treatment_info.sql =====
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

-- ===== supabase/migrations/020_offers_consent.sql =====
-- 020: patients can say yes to occasional tips and offers on WhatsApp (and stop any time).
-- The date and where they agreed are kept, so the clinic can show consent was given.
-- Nothing is sent to a patient unless marketing_opt_in is true. Safe to run again.

alter table clinic_patients add column if not exists marketing_opt_in boolean not null default false;
alter table clinic_patients add column if not exists marketing_opt_in_at timestamptz;
alter table clinic_patients add column if not exists marketing_opt_in_source text;   -- 'online_booking', 'front_desk', ...
alter table clinic_patients add column if not exists marketing_opt_out_at timestamptz;

-- ===== supabase/migrations/021_offer_sends.sql =====
-- 021: a record of every tip/offer message sent to a patient, so nobody is messaged too often
-- and the clinic can show who was sent what and when. Writes go through the server only. Safe to run again.

create table if not exists offer_sends (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  patient_id    uuid references clinic_patients(id) on delete set null,
  treatment_id  uuid references treatment_info(id) on delete set null,
  phone         text,
  status        text not null check (status in ('sent','failed','link')),
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists offer_sends_clinic_idx on offer_sends (clinic_id, created_at desc);
create index if not exists offer_sends_patient_idx on offer_sends (patient_id, created_at desc);

alter table offer_sends enable row level security;
drop policy if exists "Staff read offer_sends" on offer_sends;
create policy "Staff read offer_sends" on offer_sends for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));

-- ===== supabase/migrations/022_visit_notes.sql =====
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

-- ===== supabase/migrations/023_visit_note_orders.sql =====
-- 023: a doctor can say "this patient needs X (zirconium tooth, aligners…) before the next visit".
-- Saving the note makes two tasks: order it in time, and check it arrived the day before the appointment.
--   visit_notes.order_item / needed_by    what to order, and the appointment date it must be here by
--   visit_notes.order_task_id / check_task_id   the two tasks, so editing the note updates them instead of adding more
--   clinic_tasks.kind                     'order_material' or 'check_material' (the Stock page lists the open ones)
--   clinic_tasks.auto_closed_by_po        set when a purchase order for the item closed the task by itself
-- Safe to run again.

alter table clinic_tasks add column if not exists kind text;
-- a task that was closed by itself because a purchase order covers it (so cancelling that order can bring it back)
alter table clinic_tasks add column if not exists auto_closed_by_po uuid references purchase_orders(id) on delete set null;
create index if not exists clinic_tasks_kind_idx on clinic_tasks (clinic_id, kind) where kind is not null;

alter table visit_notes add column if not exists order_item text;
alter table visit_notes add column if not exists needed_by date;
alter table visit_notes add column if not exists order_task_id uuid references clinic_tasks(id) on delete set null;
alter table visit_notes add column if not exists check_task_id uuid references clinic_tasks(id) on delete set null;

-- ===== supabase/migrations/024_custom_fields_on_builtin.sql =====
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

-- ===== supabase/migrations/025_treatment_invoice_links.sql =====
-- 025: treatments, appointments, patients and invoices point at each other, and the appointment's money status follows its invoices by itself.
--   invoice_sittings        one row per (invoice, sitting): one invoice can cover many sittings, and one sitting can be billed over several invoices
--   invoices.treatment_plan_id, appointments.treatment_plan_id, treatment_plans.appointment_id   direct lookups
--   appointments.billing_status   none / invoiced / part_paid / paid, kept up to date by a trigger on invoices; "paid" also completes the visit
-- Staff can read. Writes go through the server. Safe to run again.

alter table invoices         add column if not exists treatment_plan_id uuid references treatment_plans(id) on delete set null;
alter table appointments     add column if not exists treatment_plan_id uuid references treatment_plans(id) on delete set null;
alter table treatment_plans  add column if not exists appointment_id    uuid references appointments(id)    on delete set null;
alter table appointments     add column if not exists billing_status text not null default 'none';
do $$ begin
  alter table appointments add constraint appointments_billing_status_chk check (billing_status in ('none','invoiced','part_paid','paid'));
exception when duplicate_object then null; end $$;
create index if not exists invoices_plan_idx on invoices (treatment_plan_id) where treatment_plan_id is not null;
create index if not exists appointments_plan_idx on appointments (treatment_plan_id) where treatment_plan_id is not null;

create table if not exists invoice_sittings (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  sitting_id  uuid not null references treatment_sittings(id) on delete cascade,
  amount      numeric(10,2) not null check (amount >= 0),
  created_at  timestamptz not null default now(),
  unique (invoice_id, sitting_id)
);
create index if not exists invoice_sittings_sitting_idx on invoice_sittings (sitting_id);
alter table invoice_sittings enable row level security;
drop policy if exists "Staff read invoice_sittings" on invoice_sittings;
create policy "Staff read invoice_sittings" on invoice_sittings for select
  using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));

-- a sitting booked on an appointment tells the appointment which treatment it belongs to
create or replace function trg_sitting_to_appointment() returns trigger language plpgsql as $$
begin
  if new.appointment_id is not null then
    update appointments set treatment_plan_id = new.plan_id where id = new.appointment_id and treatment_plan_id is distinct from new.plan_id;
  end if;
  return new;
end $$;
drop trigger if exists sitting_to_appointment on treatment_sittings;
create trigger sitting_to_appointment after insert or update of appointment_id on treatment_sittings for each row execute function trg_sitting_to_appointment();

-- the money status of an appointment follows its invoices
create or replace function refresh_appointment_billing(p_appt uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total numeric; v_paid numeric; v_n int; v_status text;
begin
  if p_appt is null then return; end if;
  select count(*), coalesce(sum(total),0), coalesce(sum(paid_amount),0) into v_n, v_total, v_paid from invoices where appointment_id = p_appt and status <> 'cancelled';
  v_status := case when v_n = 0 then 'none' when v_total > 0 and v_paid >= v_total then 'paid' when v_paid > 0 then 'part_paid' else 'invoiced' end;
  update appointments set billing_status = v_status where id = p_appt and billing_status is distinct from v_status;
  if v_status = 'paid' then update appointments set status = 'completed' where id = p_appt and status = 'confirmed'; end if;
end $$;

create or replace function trg_invoice_billing() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then perform refresh_appointment_billing(old.appointment_id); return old; end if;
  perform refresh_appointment_billing(new.appointment_id);
  if tg_op = 'UPDATE' and old.appointment_id is distinct from new.appointment_id then perform refresh_appointment_billing(old.appointment_id); end if;
  return new;
end $$;
drop trigger if exists invoice_billing on invoices;
create trigger invoice_billing after insert or delete or update of appointment_id, total, paid_amount, status on invoices for each row execute function trg_invoice_billing();

-- fill in the new column for what already exists
update appointments a set billing_status = s.st from (
  select appointment_id, case when sum(total) > 0 and sum(paid_amount) >= sum(total) then 'paid' when sum(paid_amount) > 0 then 'part_paid' else 'invoiced' end as st
  from invoices where appointment_id is not null and status <> 'cancelled' group by appointment_id) s where a.id = s.appointment_id;
update appointments a set treatment_plan_id = t.plan_id from (select appointment_id, min(plan_id::text)::uuid as plan_id from treatment_sittings where appointment_id is not null group by appointment_id) t where a.id = t.appointment_id and a.treatment_plan_id is null;

-- ===== supabase/migrations/026_treatment_from_visit.sql =====
-- 026: the doctor records the treatment on the appointment itself.
--   Pick a treatment template on the visit: the patient's open treatment is found (or started), this visit becomes its next sitting,
--   the price comes from the template and can be changed for this sitting, and the materials used are listed (prefilled from the template).
--   Completing the sitting (existing button) raises the bill and takes the materials off the stock; materials never show on the invoice.
--   visit_notes.template_id / sitting_id / open_points    what the note is about, and what is still open for the next visit
--   invoice_sittings is filled automatically whenever a sitting gets its invoice
-- Needs 022 and 025. Safe to run again.

alter table visit_notes add column if not exists template_id uuid references treatment_templates(id) on delete set null;
alter table visit_notes add column if not exists sitting_id  uuid references treatment_sittings(id)  on delete set null;
alter table visit_notes add column if not exists open_points text;

create or replace function visit_attach_treatment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid; v_actor uuid := nullif(p->>'actor','')::uuid; v_appt uuid := (p->>'appointment_id')::uuid;
  v_tpl_id uuid := nullif(p->>'template_id','')::uuid; v_price numeric := nullif(p->>'price','')::numeric;
  ap appointments%rowtype; tpl treatment_templates%rowtype; pl treatment_plans%rowtype; st treatment_sittings%rowtype;
  v_sit jsonb; v_n int; i int; s jsonb; v_share numeric; v_amt numeric; v_sum numeric := 0; v_prev date; v_total numeric; v_created boolean := false;
  v_cons jsonb := null; m jsonb; v_nm text; v_q int; v_cnt int;
begin
  select * into ap from appointments where id = v_appt and clinic_id = v_clinic;
  if not found then raise exception 'NOT_FOUND: appointment not found'; end if;
  if ap.clinic_patient_id is null then raise exception 'NOT_ALLOWED: this appointment has no patient record'; end if;
  if v_price is not null and (v_price < 0 or v_price > 10000000) then raise exception 'VALIDATION: enter a price between 0 and 1,00,00,000'; end if;

  select * into st from treatment_sittings where appointment_id = v_appt and clinic_id = v_clinic order by seq limit 1;
  if found then
    select * into pl from treatment_plans where id = st.plan_id;
  else
    if v_tpl_id is null then raise exception 'VALIDATION: choose a treatment template'; end if;
    select * into tpl from treatment_templates where id = v_tpl_id and clinic_id = v_clinic and is_active;
    if not found then raise exception 'TEMPLATE_NOT_FOUND: treatment template not found'; end if;

    select tp.* into pl from treatment_plans tp
     where tp.clinic_id = v_clinic and tp.clinic_patient_id = ap.clinic_patient_id and tp.template_id = tpl.id and tp.status = 'active'
       and exists (select 1 from treatment_sittings x where x.plan_id = tp.id and x.status = 'pending' and x.appointment_id is null)
     order by tp.created_at limit 1;
    if not found then
      v_sit := case when coalesce(jsonb_array_length(tpl.sittings), 0) = 0 then '[{"label":"Visit","share":100}]'::jsonb else tpl.sittings end;
      v_n := jsonb_array_length(v_sit); v_total := tpl.total_amount;
      if v_n > 12 then raise exception 'SITTINGS_INVALID: a treatment can have at most 12 sittings'; end if;
      insert into treatment_plans (clinic_id, clinic_patient_id, doctor_id, template_id, title, total_amount, discount, created_by, appointment_id)
      values (v_clinic, ap.clinic_patient_id, ap.doctor_id, tpl.id, tpl.name, v_total, 0, v_actor, v_appt) returning * into pl;
      v_prev := null;
      for i in 0 .. v_n - 1 loop
        s := v_sit -> i;
        v_share := coalesce(nullif(s->>'share','')::numeric, round(100.0 / v_n, 2));
        v_amt := case when i = v_n - 1 then v_total - v_sum else round(v_total * v_share / 100.0, 2) end;
        v_sum := v_sum + v_amt;
        v_prev := case when i = 0 then ap.appointment_date else v_prev + coalesce(nullif(s->>'gap_days','')::int, 7) end;
        insert into treatment_sittings (clinic_id, plan_id, seq, label, target_date, amount, due_amount, consumables)
        values (v_clinic, pl.id, i + 1, coalesce(nullif(s->>'label',''), 'Sitting ' || (i + 1)), v_prev, v_amt, v_amt, coalesce(s->'consumables', '[]'::jsonb));
      end loop;
      v_created := true;
    end if;
    select * into st from treatment_sittings where plan_id = pl.id and status = 'pending' and appointment_id is null order by seq limit 1;
    update treatment_sittings set appointment_id = v_appt where id = st.id;
    update appointments set treatment_plan_id = pl.id where id = v_appt and clinic_id = v_clinic;
  end if;

  if st.status <> 'pending' and (v_price is not null or p ? 'materials') then raise exception 'NOT_ALLOWED: this sitting is already complete, so its price and materials are locked'; end if;
  if v_price is not null then
    update treatment_sittings set amount = v_price, due_amount = v_price where id = st.id;
    update treatment_plans set total_amount = (select coalesce(sum(amount), 0) from treatment_sittings where plan_id = pl.id) where id = pl.id;
  end if;
  if p ? 'materials' and jsonb_typeof(p->'materials') = 'array' then
    v_cons := '[]'::jsonb; v_cnt := 0;
    for m in select * from jsonb_array_elements(p->'materials') loop
      v_nm := nullif(trim(m->>'item'), ''); v_q := nullif(m->>'qty','')::int;
      if v_nm is null or v_q is null or v_q < 1 or v_q > 100000 then continue; end if;
      v_cnt := v_cnt + 1; if v_cnt > 40 then exit; end if;
      v_cons := v_cons || jsonb_build_array(jsonb_build_object('item', left(v_nm, 120), 'qty', v_q));
    end loop;
    update treatment_sittings set consumables = v_cons where id = st.id;
  end if;

  select * into st from treatment_sittings where id = st.id;
  return jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'sitting_id', st.id, 'seq', st.seq, 'label', st.label,
    'of', (select count(*) from treatment_sittings where plan_id = pl.id), 'price', st.due_amount, 'materials', st.consumables,
    'plan_created', v_created, 'template_id', pl.template_id);
end $$;
revoke all on function visit_attach_treatment(jsonb) from public, anon, authenticated;
grant execute on function visit_attach_treatment(jsonb) to service_role;

-- a sitting that gets its invoice is listed on that invoice
create or replace function trg_sitting_invoice_link() returns trigger language plpgsql as $$
begin
  if new.invoice_id is not null and new.invoice_id is distinct from old.invoice_id then
    insert into invoice_sittings (clinic_id, invoice_id, sitting_id, amount) values (new.clinic_id, new.invoice_id, new.id, new.due_amount) on conflict (invoice_id, sitting_id) do nothing;
    update invoices set treatment_plan_id = new.plan_id where id = new.invoice_id and treatment_plan_id is null;
  end if;
  return new;
end $$;
drop trigger if exists sitting_invoice_link on treatment_sittings;
create trigger sitting_invoice_link after update of invoice_id on treatment_sittings for each row execute function trg_sitting_invoice_link();

insert into invoice_sittings (clinic_id, invoice_id, sitting_id, amount)
select clinic_id, invoice_id, id, due_amount from treatment_sittings where invoice_id is not null on conflict (invoice_id, sitting_id) do nothing;


-- ===== 027_treatment_durations.sql =====
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
