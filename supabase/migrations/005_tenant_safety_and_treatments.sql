-- ============================================================
-- Mediflow — Tenant safety, starter setup, multi-sitting treatments
-- Run AFTER 001 and 004 (003 is independent). Safe to re-run.
--
-- 1. Tenant safety (clinics can never see or link to each other's data)
--    * is_clinic_staff() hardened (fixed search_path), is_clinic_role() added
--    * clinic_id made NOT NULL on every clinic table
--    * a trigger refuses any row that points at another clinic's doctor / patient / appointment
--    * invoice numbers are now per clinic (INV-2026-0001 for each clinic), not one global counter
--    * tenant_isolation_audit() lists every public table and whether it is protected
-- 2. Starter setup: clinic_provision(clinic, specialty) seeds the defaults every new
--    clinic gets (booking rules, price list, treatment templates, stock item names) and NO patient data.
-- 3. Multi-sitting treatment plans: templates, plans, sittings, stock movements and
--    tx_create_plan / tx_complete_sitting / tx_pay_sitting.
-- ============================================================

create extension if not exists btree_gist;

-- ─── 1a. helpers ─────────────────────────────────────────────
create or replace function is_clinic_staff(p_clinic_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from clinic_staff
    where clinic_id = p_clinic_id and user_id = auth.uid() and is_active = true
  );
$$;

create or replace function is_clinic_role(p_clinic_id uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from clinic_staff
    where clinic_id = p_clinic_id and user_id = auth.uid() and is_active = true and role = any (p_roles)
  );
$$;

-- ─── 1b. clinic_id can never be empty ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['clinic_staff','doctors','clinic_patients','appointments','invoices','stock_items','clinic_tasks']
  loop
    if to_regclass('public.' || t) is not null then
      begin
        execute format('alter table %I alter column clinic_id set not null', t);
      exception when others then
        raise notice 'clinic_id on % still has empty rows; clean them and re-run (%).', t, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- ─── 1c. a row may only point at things of its own clinic ────
create or replace function tenant_same_clinic() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare i int := 0; col text; ref text; v uuid; c uuid;
begin
  while i < TG_NARGS loop
    col := TG_ARGV[i]; ref := TG_ARGV[i + 1]; i := i + 2;
    v := nullif(to_jsonb(new) ->> col, '')::uuid;
    if v is not null then
      execute format('select clinic_id from public.%I where id = $1', ref) into c using v;
      if c is distinct from new.clinic_id then
        raise exception 'TENANT_MISMATCH: % belongs to a different clinic', col;
      end if;
    end if;
  end loop;
  return new;
end $$;

-- ─── 2. new tables (created before the guards so the guards can cover them) ──
create table if not exists price_list (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  name       text not null,
  category   text not null default 'procedure',
  price      numeric(10,2) not null default 0 check (price >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, name)
);

-- sittings = [{label, gap_days, share, duration_minutes, consumables:[{item, qty}]}]
--   gap_days: days after the PREVIOUS sitting (0 for the first)
--   share:    percent of the plan total billed for this sitting (shares add up to 100)
create table if not exists treatment_templates (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  name         text not null,
  description  text,
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  sittings     jsonb not null default '[]'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (clinic_id, name)
);

create table if not exists treatment_plans (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references clinics(id) on delete cascade,
  clinic_patient_id uuid not null references clinic_patients(id) on delete cascade,
  doctor_id         uuid references doctors(id) on delete set null,
  template_id       uuid references treatment_templates(id) on delete set null,
  title             text not null,
  total_amount      numeric(10,2) not null check (total_amount >= 0),
  discount          numeric(10,2) not null default 0 check (discount >= 0),
  status            text not null default 'active' check (status in ('active','completed','cancelled')),
  notes             text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  check (discount <= total_amount)
);
create index if not exists treatment_plans_idx on treatment_plans (clinic_id, clinic_patient_id);

create table if not exists treatment_sittings (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id) on delete cascade,
  plan_id        uuid not null references treatment_plans(id) on delete cascade,
  seq            int not null,
  label          text not null,
  target_date    date not null,          -- the date the template asked for
  appointment_id uuid references appointments(id) on delete set null,
  amount         numeric(10,2) not null, -- list price of this sitting
  due_amount     numeric(10,2) not null, -- what is billed after the plan discount
  paid_amount    numeric(10,2) not null default 0,
  consumables    jsonb not null default '[]'::jsonb,
  status         text not null default 'pending' check (status in ('pending','done','missed','cancelled')),
  invoice_id     uuid references invoices(id) on delete set null,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (plan_id, seq)
);
create index if not exists treatment_sittings_idx on treatment_sittings (clinic_id, plan_id);

create table if not exists stock_movements (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  delta         integer not null,
  reason        text,
  sitting_id    uuid references treatment_sittings(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists stock_movements_idx on stock_movements (clinic_id, stock_item_id);

create table if not exists invoice_counters (
  clinic_id uuid not null references clinics(id) on delete cascade,
  yr        int  not null,
  last_no   int  not null default 0,
  primary key (clinic_id, yr)
);

-- ─── 1d. install the guards ──────────────────────────────────
do $$
declare spec text; parts text[]; t text; args text[]; i int;
begin
  -- 'table|column:referenced_table|column:referenced_table…'
  foreach spec in array array[
    'appointments|doctor_id:doctors|clinic_patient_id:clinic_patients',
    'invoices|clinic_patient_id:clinic_patients|appointment_id:appointments',
    'patient_doctor_assignments|clinic_patient_id:clinic_patients|doctor_id:doctors|source_appointment_id:appointments',
    'doctor_schedules|doctor_id:doctors',
    'doctor_leaves|doctor_id:doctors',
    'appointment_notifications|appointment_id:appointments',
    'treatment_plans|clinic_patient_id:clinic_patients|doctor_id:doctors|template_id:treatment_templates',
    'treatment_sittings|plan_id:treatment_plans|appointment_id:appointments|invoice_id:invoices',
    'stock_movements|stock_item_id:stock_items|sitting_id:treatment_sittings'
  ]
  loop
    parts := string_to_array(spec, '|');
    t := parts[1];
    if to_regclass('public.' || t) is null then continue; end if;
    args := '{}';
    for i in 2 .. array_length(parts, 1) loop
      args := args || string_to_array(parts[i], ':');
    end loop;
    execute format('drop trigger if exists trg_tenant_guard on %I', t);
    execute format('create trigger trg_tenant_guard before insert or update on %I for each row execute function tenant_same_clinic(%s)',
                   t, (select string_agg(quote_literal(a), ',') from unnest(args) a));
  end loop;
end $$;

-- ─── 1e. invoice numbers: one counter per clinic per year ────
alter table invoices drop constraint if exists invoices_invoice_number_key;
create unique index if not exists invoices_clinic_number_uq on invoices (clinic_id, invoice_number);

insert into invoice_counters (clinic_id, yr, last_no)
select clinic_id,
       substring(invoice_number from '^INV-(\d{4})-')::int,
       max(substring(invoice_number from '-(\d+)$')::int)
  from invoices
 where invoice_number ~ '^INV-\d{4}-\d+$' and clinic_id is not null
 group by 1, 2
on conflict (clinic_id, yr) do update set last_no = greatest(invoice_counters.last_no, excluded.last_no);

create or replace function set_invoice_number() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; y int := extract(year from now())::int;
begin
  if new.invoice_number is null then
    insert into invoice_counters (clinic_id, yr, last_no) values (new.clinic_id, y, 1)
    on conflict (clinic_id, yr) do update set last_no = invoice_counters.last_no + 1
    returning last_no into n;
    new.invoice_number := 'INV-' || y || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end $$;

-- ─── RLS for the new tables ──────────────────────────────────
alter table price_list           enable row level security;
alter table treatment_templates  enable row level security;
alter table treatment_plans      enable row level security;
alter table treatment_sittings   enable row level security;
alter table stock_movements      enable row level security;
alter table invoice_counters     enable row level security;   -- no policies: service role / definer functions only

do $$
declare t text;
begin
  foreach t in array array['price_list','treatment_templates','treatment_plans','treatment_sittings','stock_movements']
  loop
    execute format('drop policy if exists "Staff read %1$s" on %1$I', t);
    execute format('create policy "Staff read %1$s" on %1$I for select using (is_clinic_staff(clinic_id))', t);
  end loop;
  foreach t in array array['price_list','treatment_templates']
  loop
    execute format('drop policy if exists "Admin manage %1$s" on %1$I', t);
    execute format('create policy "Admin manage %1$s" on %1$I for all using (is_clinic_role(clinic_id, array[''admin''])) with check (is_clinic_role(clinic_id, array[''admin'']))', t);
  end loop;
end $$;

-- ─── 3. Starter setup for a brand-new clinic (NO patient data) ───
create or replace function clinic_provision(p_clinic uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c clinics%rowtype; v_dental boolean; v_items int := 0; v_tpl int := 0; v_stock int := 0; n int; v_nm text;
begin
  select * into c from clinics where id = p_clinic;
  if not found then raise exception 'CLINIC_NOT_FOUND: clinic not found'; end if;
  v_dental := coalesce(c.specialty, '') ilike '%dent%';

  -- booking + notification defaults (never overwrite what the admin already changed)
  update clinics set settings = jsonb_build_object(
      'booking',       jsonb_build_object('doctor_rule', 'usual_then_free', 'slot_minutes', 15, 'timezone', 'Asia/Kolkata'),
      'notifications', jsonb_build_object('whatsapp', true, 'reminder_hours', 24, 'notify_doctor', true),
      'setup',         jsonb_build_object('version', 1, 'provisioned_at', now(), 'dismissed', false)
    ) || coalesce(settings, '{}'::jsonb)
  where id = p_clinic;

  -- price list
  if v_dental then
    insert into price_list (clinic_id, name, category, price) values
      (p_clinic, 'Consultation',            'consultation', 500),
      (p_clinic, 'Scaling & polishing',     'procedure',   1200),
      (p_clinic, 'Tooth-coloured filling',  'procedure',   1500),
      (p_clinic, 'Tooth extraction',        'procedure',    800),
      (p_clinic, 'Root canal (3 sittings)', 'procedure',   9000),
      (p_clinic, 'Crown (per tooth)',       'procedure',   6000),
      (p_clinic, 'Dental implant',          'procedure',  40000)
    on conflict (clinic_id, name) do nothing;
  else
    insert into price_list (clinic_id, name, category, price) values
      (p_clinic, 'Consultation', 'consultation', 500),
      (p_clinic, 'Follow-up',    'consultation', 300)
    on conflict (clinic_id, name) do nothing;
  end if;
  get diagnostics v_items = row_count;

  -- treatment templates (multi-sitting)
  if v_dental then
    insert into treatment_templates (clinic_id, name, description, total_amount, sittings) values
     (p_clinic, 'Root canal (3 sittings)', 'Molar root canal treatment', 9000, jsonb_build_array(
        jsonb_build_object('label','Access opening & cleaning','gap_days',0,'share',35,'duration_minutes',45,
          'consumables', jsonb_build_array(jsonb_build_object('item','Anaesthetic cartridge','qty',1), jsonb_build_object('item','Gloves','qty',2), jsonb_build_object('item','Endodontic files','qty',1))),
        jsonb_build_object('label','Shaping & medication','gap_days',7,'share',30,'duration_minutes',30,
          'consumables', jsonb_build_array(jsonb_build_object('item','Gloves','qty',2), jsonb_build_object('item','Cotton rolls','qty',4))),
        jsonb_build_object('label','Filling & sealing','gap_days',7,'share',35,'duration_minutes',30,
          'consumables', jsonb_build_array(jsonb_build_object('item','Gloves','qty',2), jsonb_build_object('item','Composite','qty',1))))),
     (p_clinic, 'Dental implant (3 stages)', 'Placement, healing check, crown', 40000, jsonb_build_array(
        jsonb_build_object('label','Implant placement','gap_days',0,'share',40,'duration_minutes',60,
          'consumables', jsonb_build_array(jsonb_build_object('item','Anaesthetic cartridge','qty',2), jsonb_build_object('item','Gloves','qty',4))),
        jsonb_build_object('label','Healing check','gap_days',14,'share',20,'duration_minutes',20,
          'consumables', jsonb_build_array(jsonb_build_object('item','Gloves','qty',2))),
        jsonb_build_object('label','Crown fitting','gap_days',90,'share',40,'duration_minutes',45,
          'consumables', jsonb_build_array(jsonb_build_object('item','Gloves','qty',2)))))
    on conflict (clinic_id, name) do nothing;
    get diagnostics v_tpl = row_count;

    -- empty stock shelves with the right names, so usage can be deducted once quantities are entered
    foreach v_nm in array array['Gloves','Anaesthetic cartridge','Endodontic files','Cotton rolls','Composite']
    loop
      insert into stock_items (clinic_id, name, category, quantity, min_quantity, unit)
      select p_clinic, v_nm, case when v_nm in ('Composite','Anaesthetic cartridge') then 'medicine' else 'consumable' end, 0, 10, 'pcs'
       where not exists (select 1 from stock_items s where s.clinic_id = p_clinic and lower(s.name) = lower(v_nm));
      get diagnostics n = row_count; v_stock := v_stock + n;
    end loop;
  end if;

  return jsonb_build_object('price_items', v_items, 'templates', v_tpl, 'stock_items', v_stock);
end $$;

-- ─── Treatment plans ─────────────────────────────────────────
-- p = {clinic_id, actor?, patient_id, doctor_id, template_id? | sittings?, title?, total_amount?, discount?, start_date, time}
create or replace function tx_create_plan(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid;
  v_actor  uuid := nullif(p->>'actor','')::uuid;
  v_pat    uuid := nullif(p->>'patient_id','')::uuid;
  v_doc    uuid := nullif(p->>'doctor_id','')::uuid;
  v_tpl    treatment_templates%rowtype;
  v_sit    jsonb;
  v_title  text;
  v_total  numeric;
  v_disc   numeric := coalesce(nullif(p->>'discount','')::numeric, 0);
  v_start  date := nullif(p->>'start_date','')::date;
  v_time   time;
  v_plan   uuid;
  v_n      int; i int;
  s        jsonb; v_share numeric; v_amt numeric; v_due numeric; v_sum_due numeric := 0; v_f numeric;
  v_target date; v_cand date; v_prev date; v_dur int; v_try int; v_reason text; v_res jsonb; v_appt uuid;
  v_out    jsonb := '[]'::jsonb; v_sid uuid; v_cons jsonb;
begin
  if not exists (select 1 from clinic_patients where id = v_pat and clinic_id = v_clinic) then raise exception 'PATIENT_NOT_FOUND: patient not found in this clinic'; end if;
  if v_doc is null or not exists (select 1 from doctors where id = v_doc and clinic_id = v_clinic and coalesce(is_active, true)) then raise exception 'DOCTOR_REQUIRED: choose a doctor for this treatment'; end if;
  if v_start is null then raise exception 'DATE_REQUIRED: choose the first sitting date'; end if;
  v_time := appt_parse_time(p->>'time');
  if v_time is null then raise exception 'TIME_REQUIRED: choose a time'; end if;

  if nullif(p->>'template_id','') is not null then
    select * into v_tpl from treatment_templates where id = (p->>'template_id')::uuid and clinic_id = v_clinic and is_active;
    if not found then raise exception 'TEMPLATE_NOT_FOUND: treatment template not found'; end if;
    v_sit := v_tpl.sittings; v_title := v_tpl.name; v_total := v_tpl.total_amount;
  else
    v_sit := p->'sittings'; v_title := nullif(p->>'title','');
  end if;
  v_title := coalesce(nullif(p->>'title',''), v_title);
  v_total := coalesce(nullif(p->>'total_amount','')::numeric, v_total);
  v_n := coalesce(jsonb_array_length(v_sit), 0);
  if v_n < 1 or v_n > 12 then raise exception 'SITTINGS_INVALID: a plan needs 1 to 12 sittings'; end if;
  if v_title is null then raise exception 'TITLE_REQUIRED: give the treatment a name'; end if;
  if v_total is null or v_total < 0 then raise exception 'TOTAL_REQUIRED: enter the plan amount'; end if;
  if v_disc < 0 or v_disc > v_total then raise exception 'DISCOUNT_INVALID: discount cannot exceed the total'; end if;
  v_f := case when v_total = 0 then 1 else (v_total - v_disc) / v_total end;

  perform pg_advisory_xact_lock(hashtext('plan:' || v_clinic::text));
  insert into treatment_plans (clinic_id, clinic_patient_id, doctor_id, template_id, title, total_amount, discount, created_by)
  values (v_clinic, v_pat, v_doc, v_tpl.id, v_title, v_total, v_disc, v_actor) returning id into v_plan;

  v_prev := null;
  for i in 0 .. v_n - 1 loop
    s := v_sit -> i;
    v_share := coalesce(nullif(s->>'share','')::numeric, round(100.0 / v_n, 2));
    v_amt := round(v_total * v_share / 100.0, 2);
    v_due := case when i = v_n - 1 then (v_total - v_disc) - v_sum_due else round(v_amt * v_f, 2) end;
    v_sum_due := v_sum_due + v_due;
    v_dur := coalesce(nullif(s->>'duration_minutes','')::int, 30);
    v_cons := coalesce(s->'consumables', '[]'::jsonb);

    v_target := case when i = 0 then v_start else v_prev + coalesce(nullif(s->>'gap_days','')::int, 7) end;
    -- the doctor must be free: move forward day by day (max 60) and say so
    v_cand := v_target; v_try := 0;
    loop
      v_reason := appt_check_slot(v_clinic, v_doc, v_cand, v_time, v_dur);
      exit when v_reason is null or v_try >= 60;
      v_cand := v_cand + 1; v_try := v_try + 1;
    end loop;
    if v_reason is not null then raise exception 'SLOT_UNAVAILABLE: no free day found for sitting % within 60 days', i + 1; end if;

    v_res := appt_book(jsonb_build_object('clinic_id', v_clinic, 'actor', v_actor, 'patient', jsonb_build_object('id', v_pat),
              'doctor_id', v_doc, 'date', v_cand, 'time', to_char(v_time, 'HH24:MI'), 'duration_minutes', v_dur,
              'symptoms', v_title || ' · sitting ' || (i + 1) || ' of ' || v_n || ' (' || (s->>'label') || ')', 'source', 'plan'));
    v_appt := (v_res->'appointment'->>'id')::uuid;

    insert into treatment_sittings (clinic_id, plan_id, seq, label, target_date, appointment_id, amount, due_amount, consumables)
    values (v_clinic, v_plan, i + 1, coalesce(s->>'label', 'Sitting ' || (i + 1)), v_target, v_appt, v_amt, v_due, v_cons)
    returning id into v_sid;

    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_sid, 'seq', i + 1, 'label', s->>'label', 'target_date', v_target,
              'date', v_cand, 'moved', v_cand <> v_target, 'appointment_id', v_appt, 'due', v_due));
    v_prev := v_cand;
  end loop;

  return jsonb_build_object('plan_id', v_plan, 'title', v_title, 'total', v_total, 'discount', v_disc, 'payable', v_total - v_disc, 'sittings', v_out);
end $$;

-- Mark a sitting done: appointment completed, invoice raised, stock deducted, plan closed when finished.
create or replace function tx_complete_sitting(p_clinic uuid, p_actor uuid, p_sitting uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  st treatment_sittings%rowtype; pl treatment_plans%rowtype; v_inv uuid; v_stock jsonb := '[]'::jsonb;
  c jsonb; si stock_items%rowtype; v_used int; v_next record; v_left int;
begin
  select * into st from treatment_sittings where id = p_sitting and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: sitting not found'; end if;
  if st.status = 'done' then raise exception 'NOT_ALLOWED: this sitting is already complete'; end if;
  if st.status <> 'pending' then raise exception 'NOT_ALLOWED: this sitting is %', st.status; end if;
  select * into pl from treatment_plans where id = st.plan_id for update;
  if pl.status <> 'active' then raise exception 'NOT_ALLOWED: this plan is %', pl.status; end if;
  if exists (select 1 from treatment_sittings where plan_id = st.plan_id and seq < st.seq and status = 'pending') then
    raise exception 'ORDER: complete the earlier sitting first';
  end if;

  if st.appointment_id is not null then
    begin
      perform appt_set_status(p_clinic, p_actor, st.appointment_id, 'completed');
    exception when others then
      if sqlerrm not like 'NOT_ALLOWED%' then raise; end if;
    end;
  end if;

  insert into invoices (clinic_id, clinic_patient_id, appointment_id, items, subtotal, discount, gst_percent, gst_amount, total, paid_amount, status, notes)
  values (p_clinic, pl.clinic_patient_id, st.appointment_id,
          jsonb_build_array(jsonb_build_object('description', pl.title || ' · ' || st.label, 'qty', 1, 'price', st.due_amount, 'amount', st.due_amount)),
          st.due_amount, 0, 0, 0, st.due_amount, 0, 'sent',
          'Treatment plan sitting ' || st.seq)
  returning id into v_inv;

  for c in select * from jsonb_array_elements(st.consumables) loop
    select * into si from stock_items where clinic_id = p_clinic and lower(name) = lower(c->>'item') limit 1 for update;
    if found then
      v_used := least(si.quantity, greatest(coalesce(nullif(c->>'qty','')::int, 0), 0));
      update stock_items set quantity = quantity - v_used, updated_at = now() where id = si.id returning quantity into v_left;
      if v_used > 0 then
        insert into stock_movements (clinic_id, stock_item_id, delta, reason, sitting_id) values (p_clinic, si.id, -v_used, pl.title || ' · ' || st.label, st.id);
      end if;
      v_stock := v_stock || jsonb_build_array(jsonb_build_object('name', si.name, 'wanted', (c->>'qty')::int, 'used', v_used, 'left', v_left, 'low', v_left < si.min_quantity));
    else
      v_stock := v_stock || jsonb_build_array(jsonb_build_object('name', c->>'item', 'wanted', (c->>'qty')::int, 'used', 0, 'left', null, 'missing', true));
    end if;
  end loop;

  update treatment_sittings set status = 'done', completed_at = now(), invoice_id = v_inv where id = st.id;
  if not exists (select 1 from treatment_sittings where plan_id = st.plan_id and status in ('pending')) then
    update treatment_plans set status = 'completed' where id = st.plan_id;
  end if;

  select ts.id, ts.seq, ts.label, a.appointment_date as d, a.appointment_time as t into v_next
    from treatment_sittings ts left join appointments a on a.id = ts.appointment_id
   where ts.plan_id = st.plan_id and ts.status = 'pending' order by ts.seq limit 1;

  return jsonb_build_object('sitting_id', st.id, 'invoice_id', v_inv, 'amount', st.due_amount, 'stock', v_stock,
    'plan_done', v_next.id is null,
    'next', case when v_next.id is null then null else jsonb_build_object('id', v_next.id, 'seq', v_next.seq, 'label', v_next.label, 'date', v_next.d, 'time', v_next.t) end);
end $$;

-- Record a payment against one sitting's invoice (part-payments allowed).
create or replace function tx_pay_sitting(p_clinic uuid, p_actor uuid, p_sitting uuid, p_amount numeric default null, p_method text default 'cash') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare st treatment_sittings%rowtype; inv invoices%rowtype; v_amt numeric; v_paid numeric; v_plan_paid numeric; v_plan_due numeric;
begin
  if p_method not in ('cash','upi','card','insurance','other') then raise exception 'INVALID_METHOD: unknown payment method'; end if;
  select * into st from treatment_sittings where id = p_sitting and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: sitting not found'; end if;
  if st.invoice_id is null then raise exception 'NOT_ALLOWED: complete the sitting first, then take the payment'; end if;
  select * into inv from invoices where id = st.invoice_id for update;
  v_amt := coalesce(p_amount, inv.total - inv.paid_amount);
  if v_amt <= 0 then raise exception 'AMOUNT_INVALID: enter an amount above zero'; end if;
  if v_amt > inv.total - inv.paid_amount then raise exception 'AMOUNT_INVALID: that is more than the balance (%)', inv.total - inv.paid_amount; end if;
  v_paid := inv.paid_amount + v_amt;
  update invoices set paid_amount = v_paid, payment_method = p_method,
         status = case when v_paid >= total then 'paid' else 'partially_paid' end where id = inv.id;
  update treatment_sittings set paid_amount = v_paid where id = st.id;
  select coalesce(sum(paid_amount),0), coalesce(sum(due_amount),0) into v_plan_paid, v_plan_due from treatment_sittings where plan_id = st.plan_id;
  return jsonb_build_object('sitting_id', st.id, 'paid_now', v_amt, 'sitting_balance', inv.total - v_paid, 'plan_paid', v_plan_paid, 'plan_balance', v_plan_due - v_plan_paid);
end $$;

-- ─── Audit: is every table protected? ────────────────────────
create or replace function tenant_isolation_audit()
returns table (table_name text, rls_enabled boolean, has_clinic_id boolean, policies int, verdict text)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.relname::text, c.relrowsecurity,
         exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'clinic_id'),
         (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
         case when not c.relrowsecurity then 'FAIL: row level security is off'
              when c.relname in ('clinics') or exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'clinic_id') then 'ok'
              else 'REVIEW: no clinic_id column' end
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 5 desc, 1;
$$;

-- ─── Permissions: server-only functions ──────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'clinic_provision(uuid)',
    'tx_create_plan(jsonb)',
    'tx_complete_sitting(uuid,uuid,uuid)',
    'tx_pay_sitting(uuid,uuid,uuid,numeric,text)',
    'tenant_isolation_audit()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
