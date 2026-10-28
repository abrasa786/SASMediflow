-- 032: a treatment is linked to the patient; its sittings are added one at a time, each with its own name and price.
--   A treatment has an estimate (e.g. 40,000). Each sitting is billed on its own invoice (e.g. "Tooth removal" 2,000).
--   Paying a sitting's invoice (any way: the invoice page, "payment received", or the treatment screen) updates that sitting, and the treatment:
--     unpaid -> part_paid -> paid; a flexible treatment closes by itself once the doctor marks it finished (or the estimate is fully paid) and every sitting is paid.
--   Editing the price on a sitting's invoice changes the sitting's price too.
--   An appointment can be an enquiry, a consultation, or a treatment visit (appointments.visit_kind); a sitting attached to it makes it a treatment visit.
--   Equipment used (stock) stays on the sitting (treatment_sittings.consumables) and is taken off the stock when the sitting is completed (unchanged).
-- Needs 005, 025, 026. Safe to run again.

alter table treatment_plans add column if not exists mode text not null default 'planned';
alter table treatment_plans add column if not exists payment_status text not null default 'unpaid';
alter table treatment_plans add column if not exists finish_requested boolean not null default false;
alter table treatment_plans add column if not exists closed_at timestamptz;
do $$ begin alter table treatment_plans add constraint treatment_plans_mode_chk check (mode in ('planned','flexible')); exception when duplicate_object then null; end $$;
do $$ begin alter table treatment_plans add constraint treatment_plans_paystatus_chk check (payment_status in ('unpaid','part_paid','paid')); exception when duplicate_object then null; end $$;

alter table appointments add column if not exists visit_kind text not null default 'consultation';
do $$ begin alter table appointments add constraint appointments_visit_kind_chk check (visit_kind in ('enquiry','consultation','treatment')); exception when duplicate_object then null; end $$;
update appointments set visit_kind = 'treatment' where treatment_plan_id is not null and visit_kind = 'consultation';

-- ─── the treatment's money status and closing ────────────────────────────────
create or replace function plan_refresh(p_plan uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl treatment_plans%rowtype; v_n int; v_due numeric; v_paid numeric; v_basis numeric; v_status text;
begin
  select * into pl from treatment_plans where id = p_plan;
  if not found then return; end if;
  select count(*), coalesce(sum(due_amount), 0), coalesce(sum(least(paid_amount, due_amount)), 0)
    into v_n, v_due, v_paid from treatment_sittings where plan_id = p_plan and status <> 'cancelled';
  -- an open flexible treatment is measured against its estimate, so one paid sitting of a 40,000 treatment reads "part paid", not "paid"
  v_basis := case when pl.mode = 'flexible' and not pl.finish_requested then greatest(v_due, pl.total_amount - pl.discount) else v_due end;
  v_status := case when v_n = 0 then 'unpaid' when v_basis > 0 and v_paid >= v_basis then 'paid' when v_paid > 0 then 'part_paid' else 'unpaid' end;
  if pl.payment_status is distinct from v_status then update treatment_plans set payment_status = v_status where id = p_plan; end if;

  if pl.mode = 'flexible' and pl.status <> 'cancelled' then
    perform set_config('mediflow.plan_close', '1', true);
    if v_status = 'paid' and v_n > 0 and (pl.finish_requested or (pl.total_amount > 0 and v_paid >= pl.total_amount)) then
      if pl.status <> 'completed' then update treatment_plans set status = 'completed', closed_at = now() where id = p_plan; end if;
    elsif pl.status = 'completed' then
      update treatment_plans set status = 'active', closed_at = null where id = p_plan;
    end if;
    perform set_config('mediflow.plan_close', '0', true);
  end if;
end $$;

-- a flexible treatment is only ever closed by plan_refresh (completing the last sitting must not close it: more sittings may follow)
create or replace function trg_plan_close_guard() returns trigger language plpgsql as $$
begin
  if new.mode = 'flexible' and new.status = 'completed' and old.status is distinct from 'completed' and coalesce(current_setting('mediflow.plan_close', true), '0') <> '1' then
    new.status := old.status;
  end if;
  return new;
end $$;
drop trigger if exists plan_close_guard on treatment_plans;
create trigger plan_close_guard before update of status on treatment_plans for each row execute function trg_plan_close_guard();

create or replace function trg_sitting_refresh_plan() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform plan_refresh(case when tg_op = 'DELETE' then old.plan_id else new.plan_id end);
  return null;
end $$;
drop trigger if exists sitting_refresh_plan on treatment_sittings;
create trigger sitting_refresh_plan after insert or delete or update of due_amount, paid_amount, status on treatment_sittings for each row execute function trg_sitting_refresh_plan();

create or replace function trg_plan_refresh_self() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform plan_refresh(new.id); return null; end $$;
drop trigger if exists plan_refresh_self on treatment_plans;
create trigger plan_refresh_self after update of total_amount, discount, finish_requested on treatment_plans for each row execute function trg_plan_refresh_self();

-- ─── an invoice for one sitting keeps that sitting's price and payment in step ───
create or replace function trg_invoice_to_sitting() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cnt int; v_sit uuid;
begin
  select count(*), min(sitting_id::text)::uuid into v_cnt, v_sit from invoice_sittings where invoice_id = new.id;
  if v_cnt = 1 and new.status <> 'cancelled' then
    update treatment_sittings set due_amount = new.total, amount = new.total, paid_amount = least(new.paid_amount, new.total)
     where id = v_sit and (due_amount is distinct from new.total or paid_amount is distinct from least(new.paid_amount, new.total));
    update invoice_sittings set amount = new.total where invoice_id = new.id and amount is distinct from new.total;
  end if;
  return null;
end $$;
drop trigger if exists invoice_to_sitting on invoices;
create trigger invoice_to_sitting after update of total, paid_amount, status on invoices for each row execute function trg_invoice_to_sitting();

-- a sitting on an appointment makes it a treatment visit
create or replace function trg_sitting_visit_kind() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.appointment_id is not null then update appointments set visit_kind = 'treatment' where id = new.appointment_id and visit_kind <> 'treatment'; end if;
  return null;
end $$;
drop trigger if exists sitting_visit_kind on treatment_sittings;
create trigger sitting_visit_kind after insert or update of appointment_id on treatment_sittings for each row execute function trg_sitting_visit_kind();

-- ─── add a sitting (to an open treatment, or start a treatment with its first sitting) ───
-- p = {clinic_id, actor?, plan_id? | patient_id? + title + estimated_total? + template_id?, appointment_id?, label, price, materials?:[{item, qty}], date?}
create or replace function tx_add_sitting(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid; v_actor uuid := nullif(p->>'actor','')::uuid;
  v_plan uuid := nullif(p->>'plan_id','')::uuid; v_appt uuid := nullif(p->>'appointment_id','')::uuid; v_pat uuid := nullif(p->>'patient_id','')::uuid;
  v_label text := nullif(trim(p->>'label'),''); v_price numeric := nullif(p->>'price','')::numeric;
  v_title text := nullif(trim(p->>'title'),''); v_est numeric := coalesce(nullif(p->>'estimated_total','')::numeric, 0);
  v_tpl uuid := nullif(p->>'template_id','')::uuid; v_date date := nullif(p->>'date','')::date;
  ap appointments%rowtype; pl treatment_plans%rowtype; v_seq int; v_id uuid; v_cons jsonb := '[]'::jsonb; m jsonb; v_nm text; v_q int; v_cnt int := 0; v_created boolean := false;
begin
  if v_label is null then raise exception 'VALIDATION: give this sitting a name, for example "Tooth removal"'; end if;
  if v_price is null or v_price < 0 or v_price > 10000000 then raise exception 'VALIDATION: enter the cost of this sitting (0 to 1,00,00,000)'; end if;
  if v_est < 0 or v_est > 100000000 then raise exception 'VALIDATION: enter a treatment estimate between 0 and 10,00,00,000'; end if;

  if v_appt is not null then
    select * into ap from appointments where id = v_appt and clinic_id = v_clinic;
    if not found then raise exception 'NOT_FOUND: appointment not found'; end if;
    if exists (select 1 from treatment_sittings where appointment_id = v_appt and status <> 'cancelled') then raise exception 'ALREADY: this visit already has a sitting'; end if;
    if ap.clinic_patient_id is null then raise exception 'NOT_ALLOWED: this appointment has no patient record'; end if;
    if v_pat is not null and v_pat <> ap.clinic_patient_id then raise exception 'TENANT_MISMATCH: this appointment belongs to another patient'; end if;
    v_pat := ap.clinic_patient_id;
  end if;

  if v_plan is not null then
    select * into pl from treatment_plans where id = v_plan and clinic_id = v_clinic for update;
    if not found then raise exception 'NOT_FOUND: treatment not found'; end if;
    if v_pat is not null and pl.clinic_patient_id <> v_pat then raise exception 'TENANT_MISMATCH: this treatment belongs to another patient'; end if;
    if pl.status = 'cancelled' then raise exception 'NOT_ALLOWED: this treatment was cancelled'; end if;
  else
    if v_pat is null then raise exception 'VALIDATION: choose the patient'; end if;
    if not exists (select 1 from clinic_patients where id = v_pat and clinic_id = v_clinic) then raise exception 'NOT_FOUND: patient not found'; end if;
    if v_title is null and v_tpl is not null then select name into v_title from treatment_templates where id = v_tpl and clinic_id = v_clinic; end if;
    if v_title is null then raise exception 'VALIDATION: name the treatment, for example "Dental implant"'; end if;
    insert into treatment_plans (clinic_id, clinic_patient_id, doctor_id, template_id, title, total_amount, discount, created_by, appointment_id, mode)
    values (v_clinic, v_pat, ap.doctor_id, v_tpl, v_title, v_est, 0, v_actor, v_appt, 'flexible') returning * into pl;
    v_created := true;
  end if;

  if jsonb_typeof(p->'materials') = 'array' then
    for m in select * from jsonb_array_elements(p->'materials') loop
      v_nm := nullif(trim(m->>'item'), ''); v_q := nullif(m->>'qty','')::int;
      if v_nm is null or v_q is null or v_q < 1 or v_q > 100000 then continue; end if;
      v_cnt := v_cnt + 1; if v_cnt > 40 then exit; end if;
      v_cons := v_cons || jsonb_build_array(jsonb_build_object('item', left(v_nm, 120), 'qty', v_q));
    end loop;
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq from treatment_sittings where plan_id = pl.id;
  insert into treatment_sittings (clinic_id, plan_id, seq, label, target_date, appointment_id, amount, due_amount, consumables)
  values (v_clinic, pl.id, v_seq, left(v_label, 120), coalesce(v_date, ap.appointment_date, current_date), v_appt, v_price, v_price, v_cons) returning id into v_id;

  -- more work after a closed treatment reopens it
  if pl.finish_requested or pl.status <> 'active' or pl.closed_at is not null then
    perform set_config('mediflow.plan_close', '1', true);
    update treatment_plans set status = 'active', finish_requested = false, closed_at = null where id = pl.id;
    perform set_config('mediflow.plan_close', '0', true);
  end if;
  perform plan_refresh(pl.id);
  return jsonb_build_object('plan_id', pl.id, 'title', pl.title, 'sitting_id', v_id, 'seq', v_seq, 'label', v_label, 'price', v_price, 'plan_created', v_created);
end $$;

-- change a sitting before it is done (name and equipment; the price once it is billed is changed on its invoice)
-- p = {clinic_id, sitting_id, label?, price?, materials?}
create or replace function tx_update_sitting(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_clinic uuid := (p->>'clinic_id')::uuid; st treatment_sittings%rowtype; v_price numeric := nullif(p->>'price','')::numeric;
  v_cons jsonb; m jsonb; v_nm text; v_q int; v_cnt int := 0;
begin
  select * into st from treatment_sittings where id = (p->>'sitting_id')::uuid and clinic_id = v_clinic for update;
  if not found then raise exception 'NOT_FOUND: sitting not found'; end if;
  if st.status <> 'pending' and (p ? 'price' or p ? 'materials') then raise exception 'NOT_ALLOWED: this sitting is already done, so its price and equipment are locked'; end if;
  if p ? 'price' then
    if v_price is null or v_price < 0 or v_price > 10000000 then raise exception 'VALIDATION: enter the cost of this sitting (0 to 1,00,00,000)'; end if;
    if st.invoice_id is not null then raise exception 'NOT_ALLOWED: this sitting is already billed. Change the price on its invoice'; end if;
    update treatment_sittings set amount = v_price, due_amount = v_price where id = st.id;
  end if;
  if p ? 'label' then
    if nullif(trim(p->>'label'), '') is null then raise exception 'VALIDATION: give this sitting a name'; end if;
    update treatment_sittings set label = left(trim(p->>'label'), 120) where id = st.id;
  end if;
  if p ? 'materials' and jsonb_typeof(p->'materials') = 'array' then
    v_cons := '[]'::jsonb;
    for m in select * from jsonb_array_elements(p->'materials') loop
      v_nm := nullif(trim(m->>'item'), ''); v_q := nullif(m->>'qty','')::int;
      if v_nm is null or v_q is null or v_q < 1 or v_q > 100000 then continue; end if;
      v_cnt := v_cnt + 1; if v_cnt > 40 then exit; end if;
      v_cons := v_cons || jsonb_build_array(jsonb_build_object('item', left(v_nm, 120), 'qty', v_q));
    end loop;
    update treatment_sittings set consumables = v_cons where id = st.id;
  end if;
  return (select to_jsonb(x) from (select id, plan_id, seq, label, amount, due_amount, consumables from treatment_sittings where id = st.id) x);
end $$;

-- the doctor says "no more sittings": the treatment closes as soon as everything is paid (now, if it already is)
create or replace function tx_finish_plan(p_clinic uuid, p_plan uuid, p_finish boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare pl treatment_plans%rowtype;
begin
  select * into pl from treatment_plans where id = p_plan and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: treatment not found'; end if;
  if pl.status = 'cancelled' then raise exception 'NOT_ALLOWED: this treatment was cancelled'; end if;
  update treatment_plans set finish_requested = p_finish where id = p_plan;
  perform plan_refresh(p_plan);
  select * into pl from treatment_plans where id = p_plan;
  return jsonb_build_object('plan_id', pl.id, 'status', pl.status, 'payment_status', pl.payment_status, 'finish_requested', pl.finish_requested);
end $$;

revoke all on function plan_refresh(uuid), tx_add_sitting(jsonb), tx_update_sitting(jsonb), tx_finish_plan(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function plan_refresh(uuid), tx_add_sitting(jsonb), tx_update_sitting(jsonb), tx_finish_plan(uuid, uuid, boolean) to service_role;

-- bring what already exists up to date
select plan_refresh(id) from treatment_plans;
create index if not exists treatment_sittings_clinic_status_idx on treatment_sittings (clinic_id, status, target_date);
