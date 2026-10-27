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
