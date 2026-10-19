-- ============================================================
-- Mediflow — Purchasing, attendance and leave management
-- Run AFTER 005_tenant_safety_and_treatments.sql. Safe to re-run.
--
--  Purchasing : suppliers -> purchase orders (PO-2026-0001 per clinic) -> receive stock
--               (stock quantities go UP, with a movement log) -> supplier bills -> payments
--  Attendance : one row per person per day (check-in / check-out, late minutes for doctors)
--  Leave      : requests, yearly balances, approval; an approved doctor's leave blocks bookings
-- All writes go through server-only functions; staff can read what their role allows.
-- ============================================================

-- ─── numbering (PO-YYYY-NNNN, per clinic) ────────────────────
create table if not exists doc_counters (
  clinic_id uuid not null references clinics(id) on delete cascade,
  kind      text not null,
  yr        int  not null,
  last_no   int  not null default 0,
  primary key (clinic_id, kind, yr)
);
alter table doc_counters enable row level security;      -- no policies: definer functions only

create or replace function next_doc_number(p_clinic uuid, p_kind text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; y int := extract(year from now())::int;
begin
  insert into doc_counters (clinic_id, kind, yr, last_no) values (p_clinic, p_kind, y, 1)
  on conflict (clinic_id, kind, yr) do update set last_no = doc_counters.last_no + 1
  returning last_no into n;
  return p_kind || '-' || y || '-' || lpad(n::text, 4, '0');
end $$;

-- ─── purchasing tables ───────────────────────────────────────
create table if not exists suppliers (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  name         text not null,
  contact_name text,
  phone        text,
  email        text,
  address      text,
  gstin        text,
  payment_terms_days int not null default 0 check (payment_terms_days between 0 and 365),
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (clinic_id, name)
);

create table if not exists purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  po_number     text not null,
  supplier_id   uuid not null references suppliers(id),
  status        text not null default 'ordered' check (status in ('draft','ordered','partially_received','received','cancelled')),
  order_date    date not null default current_date,
  expected_date date,
  notes         text,
  subtotal      numeric(12,2) not null default 0,
  gst_amount    numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (clinic_id, po_number)
);
create index if not exists purchase_orders_idx on purchase_orders (clinic_id, status, order_date desc);

create table if not exists purchase_order_items (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  po_id         uuid not null references purchase_orders(id) on delete cascade,
  stock_item_id uuid references stock_items(id) on delete set null,
  name          text not null,
  unit          text not null default 'pcs',
  qty_ordered   integer not null check (qty_ordered > 0),
  qty_received  integer not null default 0 check (qty_received >= 0),
  unit_price    numeric(10,2) not null default 0 check (unit_price >= 0),
  gst_percent   numeric(5,2) not null default 12 check (gst_percent between 0 and 40),
  check (qty_received <= qty_ordered)
);
create index if not exists po_items_idx on purchase_order_items (po_id);

create table if not exists supplier_bills (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  po_id        uuid references purchase_orders(id) on delete set null,
  supplier_id  uuid not null references suppliers(id),
  bill_number  text,                       -- the supplier's own invoice number
  bill_date    date not null default current_date,
  due_date     date,
  amount       numeric(12,2) not null check (amount >= 0),
  paid_amount  numeric(12,2) not null default 0 check (paid_amount >= 0),
  status       text not null default 'unpaid' check (status in ('unpaid','partial','paid')),
  notes        text,
  created_at   timestamptz not null default now(),
  check (paid_amount <= amount)
);
create index if not exists supplier_bills_idx on supplier_bills (clinic_id, status, due_date);

create table if not exists supplier_payments (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  bill_id    uuid not null references supplier_bills(id) on delete cascade,
  amount     numeric(12,2) not null check (amount > 0),
  method     text not null default 'bank' check (method in ('cash','upi','bank','card','cheque','other')),
  reference  text,
  paid_on    date not null default current_date,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ─── attendance & leave tables ───────────────────────────────
create table if not exists attendance (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  work_date     date not null,
  check_in      timestamptz,
  check_out     timestamptz,
  late_minutes  int,
  source        text not null default 'self' check (source in ('self','admin')),
  note          text,
  created_at    timestamptz not null default now(),
  unique (clinic_id, user_id, work_date),
  check (check_out is null or check_in is null or check_out >= check_in)
);
create index if not exists attendance_idx on attendance (clinic_id, work_date);

create table if not exists staff_leaves (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  leave_type    text not null default 'casual' check (leave_type in ('casual','sick','earned','unpaid','other')),
  from_date     date not null,
  to_date       date not null,
  days          numeric(5,1) not null check (days > 0),
  half_day      boolean not null default false,
  reason        text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid,
  decided_at    timestamptz,
  decision_note text,
  doctor_leave_id uuid references doctor_leaves(id) on delete set null,
  created_at    timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists staff_leaves_idx on staff_leaves (clinic_id, status, from_date);

-- ─── isolation guards + RLS ──────────────────────────────────
do $$
declare spec text; parts text[]; t text; args text[]; i int;
begin
  foreach spec in array array[
    'purchase_orders|supplier_id:suppliers',
    'purchase_order_items|po_id:purchase_orders|stock_item_id:stock_items',
    'supplier_bills|po_id:purchase_orders|supplier_id:suppliers',
    'supplier_payments|bill_id:supplier_bills',
    'staff_leaves|doctor_leave_id:doctor_leaves'
  ] loop
    parts := string_to_array(spec, '|'); t := parts[1]; args := '{}';
    for i in 2 .. array_length(parts, 1) loop args := args || string_to_array(parts[i], ':'); end loop;
    execute format('drop trigger if exists trg_tenant_guard on %I', t);
    execute format('create trigger trg_tenant_guard before insert or update on %I for each row execute function tenant_same_clinic(%s)',
                   t, (select string_agg(quote_literal(a), ',') from unnest(args) a));
  end loop;
end $$;

alter table suppliers            enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_items enable row level security;
alter table supplier_bills       enable row level security;
alter table supplier_payments    enable row level security;
alter table attendance           enable row level security;
alter table staff_leaves         enable row level security;

do $$
declare t text;
begin
  -- buying side: admin, nurse, receptionist can look (interns and doctors do not need it)
  foreach t in array array['suppliers','purchase_orders','purchase_order_items','supplier_bills','supplier_payments']
  loop
    execute format('drop policy if exists "Buyers read %1$s" on %1$I', t);
    execute format('create policy "Buyers read %1$s" on %1$I for select using (is_clinic_role(clinic_id, array[''admin'',''nurse'',''receptionist'']))', t);
  end loop;
  -- own rows, or everything for the admin
  foreach t in array array['attendance','staff_leaves']
  loop
    execute format('drop policy if exists "Own or admin read %1$s" on %1$I', t);
    execute format('create policy "Own or admin read %1$s" on %1$I for select using (user_id = auth.uid() and is_clinic_staff(clinic_id) or is_clinic_role(clinic_id, array[''admin'']))', t);
  end loop;
end $$;

-- ─── PURCHASING functions ────────────────────────────────────
-- p = {clinic_id, actor, supplier_id, order_date?, expected_date?, notes?, items:[{stock_item_id?, name, unit?, qty, unit_price, gst_percent?}]}
create or replace function po_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid; v_sup uuid := nullif(p->>'supplier_id','')::uuid;
  v_po uuid; v_no text; it jsonb; v_sub numeric := 0; v_gst numeric := 0; v_n int := 0;
  v_qty int; v_price numeric; v_g numeric; v_name text; v_si uuid; v_unit text; s stock_items%rowtype;
begin
  if not exists (select 1 from suppliers where id = v_sup and clinic_id = v_clinic and is_active) then raise exception 'SUPPLIER_REQUIRED: choose a supplier'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'ITEMS_REQUIRED: add at least one item'; end if;
  if jsonb_array_length(p->'items') > 100 then raise exception 'ITEMS_INVALID: too many items'; end if;
  v_no := next_doc_number(v_clinic, 'PO');
  insert into purchase_orders (clinic_id, po_number, supplier_id, order_date, expected_date, notes, created_by)
  values (v_clinic, v_no, v_sup, coalesce(nullif(p->>'order_date','')::date, current_date), nullif(p->>'expected_date','')::date, nullif(p->>'notes',''), nullif(p->>'actor','')::uuid)
  returning id into v_po;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_si := nullif(it->>'stock_item_id','')::uuid; v_name := nullif(trim(it->>'name'),''); v_unit := coalesce(nullif(it->>'unit',''),'pcs');
    if v_si is not null then
      select * into s from stock_items where id = v_si and clinic_id = v_clinic;
      if not found then raise exception 'ITEM_NOT_FOUND: a stock item is not in this clinic'; end if;
      v_name := coalesce(v_name, s.name); v_unit := coalesce(nullif(it->>'unit',''), s.unit, 'pcs');
    end if;
    if v_name is null then raise exception 'ITEMS_INVALID: every line needs an item name'; end if;
    v_qty := nullif(it->>'qty','')::int; v_price := coalesce(nullif(it->>'unit_price','')::numeric, 0); v_g := coalesce(nullif(it->>'gst_percent','')::numeric, 12);
    if v_qty is null or v_qty < 1 or v_qty > 100000 then raise exception 'ITEMS_INVALID: quantity for "%" must be 1 or more', v_name; end if;
    if v_price < 0 then raise exception 'ITEMS_INVALID: price for "%" cannot be negative', v_name; end if;
    insert into purchase_order_items (clinic_id, po_id, stock_item_id, name, unit, qty_ordered, unit_price, gst_percent)
    values (v_clinic, v_po, v_si, v_name, v_unit, v_qty, v_price, v_g);
    v_sub := v_sub + v_qty * v_price; v_gst := v_gst + round(v_qty * v_price * v_g / 100, 2); v_n := v_n + 1;
  end loop;
  update purchase_orders set subtotal = round(v_sub,2), gst_amount = v_gst, total = round(v_sub,2) + v_gst where id = v_po;
  return jsonb_build_object('po_id', v_po, 'po_number', v_no, 'lines', v_n, 'subtotal', round(v_sub,2), 'gst', v_gst, 'total', round(v_sub,2) + v_gst);
end $$;

-- p_lines = [{item_id, qty}] (qty received now); optional supplier bill details.
-- Stock goes up, the PO moves to partially_received/received, and a supplier bill is raised for what arrived.
create or replace function po_receive(p_clinic uuid, p_actor uuid, p_po uuid, p_lines jsonb, p_bill_no text default null, p_bill_date date default null, p_due date default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po purchase_orders%rowtype; l jsonb; it purchase_order_items%rowtype; v_q int; v_amt numeric := 0; v_stock jsonb := '[]'::jsonb;
  v_sid uuid; v_left int; v_bill uuid; v_terms int; v_open int; v_total_recv int := 0; si stock_items%rowtype;
begin
  select * into po from purchase_orders where id = p_po and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: purchase order not found'; end if;
  if po.status in ('received','cancelled','draft') then raise exception 'NOT_ALLOWED: this order is %', po.status; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'ITEMS_REQUIRED: enter the quantities that arrived'; end if;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from purchase_order_items where id = (l->>'item_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'NOT_FOUND: order line not found'; end if;
    v_q := coalesce(nullif(l->>'qty','')::int, 0);
    if v_q < 0 then raise exception 'QTY_INVALID: quantity cannot be negative'; end if;
    if v_q = 0 then continue; end if;
    if it.qty_received + v_q > it.qty_ordered then raise exception 'QTY_INVALID: only % more of "%" can be received', it.qty_ordered - it.qty_received, it.name; end if;

    update purchase_order_items set qty_received = qty_received + v_q where id = it.id;
    v_amt := v_amt + round(v_q * it.unit_price * (1 + it.gst_percent / 100), 2);
    v_total_recv := v_total_recv + v_q;

    -- find or create the shelf item, then add the stock
    v_sid := it.stock_item_id;
    if v_sid is null then
      select id into v_sid from stock_items where clinic_id = p_clinic and lower(name) = lower(it.name) limit 1;
      if v_sid is null then
        insert into stock_items (clinic_id, name, category, quantity, min_quantity, unit, unit_price, supplier)
        values (p_clinic, it.name, 'consumable', 0, 5, it.unit, it.unit_price, (select name from suppliers where id = po.supplier_id)) returning id into v_sid;
      end if;
      update purchase_order_items set stock_item_id = v_sid where id = it.id;
    end if;
    select * into si from stock_items where id = v_sid for update;
    update stock_items set quantity = quantity + v_q, unit_price = it.unit_price, supplier = coalesce((select name from suppliers where id = po.supplier_id), supplier), updated_at = now()
     where id = v_sid returning quantity into v_left;
    insert into stock_movements (clinic_id, stock_item_id, delta, reason) values (p_clinic, v_sid, v_q, 'Received on ' || po.po_number);
    v_stock := v_stock || jsonb_build_array(jsonb_build_object('name', it.name, 'added', v_q, 'now', v_left));
  end loop;

  if v_total_recv = 0 then raise exception 'ITEMS_REQUIRED: enter at least one quantity above zero'; end if;

  select count(*) into v_open from purchase_order_items where po_id = p_po and qty_received < qty_ordered;
  update purchase_orders set status = case when v_open = 0 then 'received' else 'partially_received' end where id = p_po;

  select payment_terms_days into v_terms from suppliers where id = po.supplier_id;
  insert into supplier_bills (clinic_id, po_id, supplier_id, bill_number, bill_date, due_date, amount)
  values (p_clinic, p_po, po.supplier_id, nullif(trim(p_bill_no),''), coalesce(p_bill_date, current_date),
          coalesce(p_due, coalesce(p_bill_date, current_date) + coalesce(v_terms, 0)), v_amt)
  returning id into v_bill;

  return jsonb_build_object('po_status', case when v_open = 0 then 'received' else 'partially_received' end, 'bill_id', v_bill, 'bill_amount', v_amt, 'stock', v_stock);
end $$;

create or replace function po_cancel(p_clinic uuid, p_po uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare po purchase_orders%rowtype;
begin
  select * into po from purchase_orders where id = p_po and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: purchase order not found'; end if;
  if po.status not in ('draft','ordered') then raise exception 'NOT_ALLOWED: only an order with nothing received can be cancelled'; end if;
  if exists (select 1 from purchase_order_items where po_id = p_po and qty_received > 0) then raise exception 'NOT_ALLOWED: some items were already received'; end if;
  update purchase_orders set status = 'cancelled' where id = p_po;
end $$;

create or replace function bill_pay(p_clinic uuid, p_actor uuid, p_bill uuid, p_amount numeric default null, p_method text default 'bank', p_ref text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare b supplier_bills%rowtype; v_amt numeric; v_paid numeric;
begin
  if p_method not in ('cash','upi','bank','card','cheque','other') then raise exception 'INVALID_METHOD: unknown payment method'; end if;
  select * into b from supplier_bills where id = p_bill and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: bill not found'; end if;
  v_amt := coalesce(p_amount, b.amount - b.paid_amount);
  if v_amt <= 0 then raise exception 'AMOUNT_INVALID: enter an amount above zero'; end if;
  if v_amt > b.amount - b.paid_amount then raise exception 'AMOUNT_INVALID: that is more than the balance (%)', b.amount - b.paid_amount; end if;
  v_paid := b.paid_amount + v_amt;
  insert into supplier_payments (clinic_id, bill_id, amount, method, reference, created_by) values (p_clinic, p_bill, v_amt, p_method, nullif(trim(p_ref),''), p_actor);
  update supplier_bills set paid_amount = v_paid, status = case when v_paid >= amount then 'paid' else 'partial' end where id = p_bill;
  return jsonb_build_object('paid_now', v_amt, 'balance', b.amount - v_paid, 'status', case when v_paid >= b.amount then 'paid' else 'partial' end);
end $$;

-- ─── ATTENDANCE functions ────────────────────────────────────
create or replace function att_today(p_clinic uuid) returns date language sql stable as $$
  select (now() at time zone appt_clinic_tz(p_clinic))::date
$$;

create or replace function att_check_in(p_clinic uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := att_today(p_clinic); v_now timestamptz := now(); a attendance%rowtype; v_late int; v_start time; v_local time;
begin
  if not exists (select 1 from clinic_staff where clinic_id = p_clinic and user_id = p_user and is_active) then raise exception 'NOT_ALLOWED: you are not part of this clinic'; end if;
  select * into a from attendance where clinic_id = p_clinic and user_id = p_user and work_date = v_today;
  if found and a.check_in is not null then raise exception 'ALREADY: you checked in at %', to_char(a.check_in at time zone appt_clinic_tz(p_clinic), 'HH12:MI AM'); end if;
  -- late minutes only when this person is a doctor with a schedule today
  select min(s.start_time) into v_start from doctor_schedules s join doctors d on d.id = s.doctor_id
   where d.clinic_id = p_clinic and d.user_id = p_user and s.is_active and s.weekday = extract(dow from v_today)::int;
  v_local := (v_now at time zone appt_clinic_tz(p_clinic))::time;
  v_late := case when v_start is not null and v_local > v_start + interval '10 minutes' then (extract(epoch from (v_local - v_start)) / 60)::int end;
  insert into attendance (clinic_id, user_id, work_date, check_in, late_minutes) values (p_clinic, p_user, v_today, v_now, v_late)
  on conflict (clinic_id, user_id, work_date) do update set check_in = excluded.check_in, late_minutes = excluded.late_minutes;
  return jsonb_build_object('check_in', v_now, 'late_minutes', v_late);
end $$;

create or replace function att_check_out(p_clinic uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_today date := att_today(p_clinic); a attendance%rowtype;
begin
  select * into a from attendance where clinic_id = p_clinic and user_id = p_user and work_date = v_today for update;
  if not found or a.check_in is null then raise exception 'NOT_ALLOWED: check in first'; end if;
  if a.check_out is not null then raise exception 'ALREADY: you already checked out'; end if;
  update attendance set check_out = now() where id = a.id;
  return jsonb_build_object('check_in', a.check_in, 'check_out', now(), 'minutes', (extract(epoch from (now() - a.check_in)) / 60)::int);
end $$;

-- admin correction: p = {clinic_id, user_id, work_date, check_in?: 'HH:MM', check_out?: 'HH:MM', note?}
create or replace function att_correct(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_user uuid := (p->>'user_id')::uuid; v_date date := (p->>'work_date')::date;
        v_tz text := appt_clinic_tz((p->>'clinic_id')::uuid); v_in timestamptz; v_out timestamptz;
begin
  if not exists (select 1 from clinic_staff where clinic_id = v_clinic and user_id = v_user) then raise exception 'NOT_FOUND: that person is not in this clinic'; end if;
  if v_date > att_today(v_clinic) then raise exception 'DATE_INVALID: cannot record attendance for a future day'; end if;
  if nullif(p->>'check_in','') is not null then v_in := ((v_date::text || ' ' || (p->>'check_in'))::timestamp) at time zone v_tz; end if;
  if nullif(p->>'check_out','') is not null then v_out := ((v_date::text || ' ' || (p->>'check_out'))::timestamp) at time zone v_tz; end if;
  if v_in is not null and v_out is not null and v_out < v_in then raise exception 'TIME_INVALID: check-out must be after check-in'; end if;
  insert into attendance (clinic_id, user_id, work_date, check_in, check_out, source, note) values (v_clinic, v_user, v_date, v_in, v_out, 'admin', nullif(p->>'note',''))
  on conflict (clinic_id, user_id, work_date) do update set check_in = coalesce(excluded.check_in, attendance.check_in), check_out = coalesce(excluded.check_out, attendance.check_out),
         source = 'admin', note = coalesce(excluded.note, attendance.note), late_minutes = case when excluded.check_in is not null then null else attendance.late_minutes end;
  return jsonb_build_object('saved', true);
end $$;

-- ─── LEAVE functions ─────────────────────────────────────────
-- yearly allowance lives in clinics.settings.leave.quota; unpaid/other leave has no cap
create or replace function leave_balance(p_clinic uuid, p_user uuid, p_year int default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare y int := coalesce(p_year, extract(year from now())::int); q jsonb; t text; v_used numeric; out jsonb := '{}'::jsonb; v_q numeric;
begin
  select coalesce(settings->'leave'->'quota', '{"casual":12,"sick":8,"earned":15}'::jsonb) into q from clinics where id = p_clinic;
  foreach t in array array['casual','sick','earned'] loop
    v_q := coalesce((q->>t)::numeric, 0);
    select coalesce(sum(days), 0) into v_used from staff_leaves
     where clinic_id = p_clinic and user_id = p_user and leave_type = t and status in ('approved','pending') and extract(year from from_date) = y;
    out := out || jsonb_build_object(t, jsonb_build_object('quota', v_q, 'used', v_used, 'left', v_q - v_used));
  end loop;
  return out;
end $$;

-- p = {clinic_id, user_id, leave_type, from_date, to_date, half_day?, reason?}
create or replace function leave_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_user uuid := (p->>'user_id')::uuid; v_type text := coalesce(nullif(p->>'leave_type',''), 'casual');
        v_from date := (p->>'from_date')::date; v_to date := (p->>'to_date')::date; v_half boolean := coalesce((p->>'half_day')::boolean, false);
        v_days numeric; v_id uuid; v_left numeric; v_tz text := appt_clinic_tz((p->>'clinic_id')::uuid);
begin
  if not exists (select 1 from clinic_staff where clinic_id = v_clinic and user_id = v_user and is_active) then raise exception 'NOT_ALLOWED: you are not part of this clinic'; end if;
  if v_from is null or v_to is null or v_to < v_from then raise exception 'DATES_INVALID: choose a valid date range'; end if;
  if v_from < (now() at time zone v_tz)::date - 7 then raise exception 'DATES_INVALID: leave cannot start more than 7 days in the past'; end if;
  if v_half and v_from <> v_to then raise exception 'DATES_INVALID: a half day must be a single date'; end if;
  v_days := case when v_half then 0.5 else (v_to - v_from + 1) end;
  if v_days > 60 then raise exception 'DATES_INVALID: that is too long for one request (max 60 days)'; end if;
  if exists (select 1 from staff_leaves where clinic_id = v_clinic and user_id = v_user and status in ('pending','approved') and from_date <= v_to and to_date >= v_from) then
    raise exception 'OVERLAP: you already have leave in those dates';
  end if;
  if v_type in ('casual','sick','earned') then
    v_left := ((leave_balance(v_clinic, v_user, extract(year from v_from)::int)->v_type)->>'left')::numeric;
    if v_days > v_left then raise exception 'BALANCE: only % day(s) of % leave left this year; request unpaid leave for the rest', v_left, v_type; end if;
  end if;
  insert into staff_leaves (clinic_id, user_id, leave_type, from_date, to_date, days, half_day, reason)
  values (v_clinic, v_user, v_type, v_from, v_to, v_days, v_half, nullif(left(p->>'reason', 300), '')) returning id into v_id;
  return jsonb_build_object('leave_id', v_id, 'days', v_days);
end $$;

-- approve / reject (admin) or cancel (owner). Approving a doctor's leave blocks their bookings.
create or replace function leave_decide(p_clinic uuid, p_actor uuid, p_leave uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l staff_leaves%rowtype; v_doc uuid; v_dl uuid; v_affected int := 0;
begin
  if p_status not in ('approved','rejected','cancelled') then raise exception 'INVALID_STATUS: unknown decision'; end if;
  select * into l from staff_leaves where id = p_leave and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: leave request not found'; end if;
  if p_status = 'cancelled' then
    if l.user_id <> p_actor and not exists (select 1 from clinic_staff where clinic_id = p_clinic and user_id = p_actor and role = 'admin') then raise exception 'NOT_ALLOWED: you can only cancel your own leave'; end if;
    if l.status not in ('pending','approved') then raise exception 'NOT_ALLOWED: this request is already %', l.status; end if;
    if l.doctor_leave_id is not null then delete from doctor_leaves where id = l.doctor_leave_id; end if;
    update staff_leaves set status = 'cancelled', doctor_leave_id = null where id = l.id;
    return jsonb_build_object('status', 'cancelled');
  end if;
  if not exists (select 1 from clinic_staff where clinic_id = p_clinic and user_id = p_actor and role = 'admin' and is_active) then raise exception 'NOT_ALLOWED: only the admin can approve or reject leave'; end if;
  if l.status <> 'pending' then raise exception 'NOT_ALLOWED: this request is already %', l.status; end if;
  if p_status = 'approved' then
    select id into v_doc from doctors where clinic_id = p_clinic and user_id = l.user_id and coalesce(is_active, true) limit 1;
    if v_doc is not null then
      insert into doctor_leaves (clinic_id, doctor_id, from_date, to_date, reason, created_by)
      values (p_clinic, v_doc, l.from_date, l.to_date, coalesce(l.reason, initcap(l.leave_type) || ' leave'), p_actor) returning id into v_dl;
      select count(*) into v_affected from appointments where clinic_id = p_clinic and doctor_id = v_doc and status = 'confirmed' and appointment_date between l.from_date and l.to_date;
    end if;
  end if;
  update staff_leaves set status = p_status, decided_by = p_actor, decided_at = now(), decision_note = nullif(left(p_note, 300), ''), doctor_leave_id = v_dl where id = l.id;
  return jsonb_build_object('status', p_status, 'blocks_bookings', v_dl is not null, 'appointments_to_move', v_affected);
end $$;

-- starter leave quota for every clinic that has none yet
update clinics set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{leave}', '{"quota":{"casual":12,"sick":8,"earned":15}}'::jsonb)
 where coalesce(settings, '{}'::jsonb) -> 'leave' is null;

create or replace function clinic_provision_defaults_leave() returns trigger language plpgsql as $$
begin
  if coalesce(new.settings, '{}'::jsonb) -> 'leave' is null then
    new.settings := jsonb_set(coalesce(new.settings, '{}'::jsonb), '{leave}', '{"quota":{"casual":12,"sick":8,"earned":15}}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists trg_clinic_leave_defaults on clinics;
create trigger trg_clinic_leave_defaults before insert on clinics for each row execute function clinic_provision_defaults_leave();

-- ─── Permissions: server-only functions ──────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'next_doc_number(uuid,text)', 'po_create(jsonb)', 'po_receive(uuid,uuid,uuid,jsonb,text,date,date)', 'po_cancel(uuid,uuid)',
    'bill_pay(uuid,uuid,uuid,numeric,text,text)', 'att_check_in(uuid,uuid)', 'att_check_out(uuid,uuid)', 'att_correct(jsonb)',
    'leave_balance(uuid,uuid,int)', 'leave_request(jsonb)', 'leave_decide(uuid,uuid,uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
