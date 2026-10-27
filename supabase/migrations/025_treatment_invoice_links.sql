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
