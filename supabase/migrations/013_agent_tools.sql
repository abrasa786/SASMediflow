-- 013: the agent can do more. The AI Builder plan now also supports
--   create_report, create_dashboard, set_booking_rule, create_permission_set
-- on top of create_object / add_field / hide_field / create_app / add_tab. Every step is validated, applied in ONE transaction,
-- audited, and undone with the same rollback as before (reports, dashboards and permission sets are removed; a booking rule is restored).
-- Admin-only (the API enforces it). Re-runnable. Requires 003, 004, 008.

create or replace function builder_create_report_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text := btrim(coalesce(a->>'name', '')); v_spec jsonb := coalesce(a->'spec', '{}'::jsonb); v_chart text := coalesce(nullif(a->>'chart', ''), 'table');
begin
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'VALIDATION: give the report a name'; end if;
  if v_chart not in ('table', 'bar', 'pie', 'number') then raise exception 'VALIDATION: chart must be table, bar, pie or number'; end if;
  perform builder_query(p_clinic, p_actor, v_spec || jsonb_build_object('limit', 1));      -- reject a broken report now, not when someone opens it
  insert into saved_reports (clinic_id, name, description, spec, chart, created_by)
  values (p_clinic, v_name, nullif(a->>'description', ''), v_spec, v_chart, p_actor) returning id into v_id;
  perform builder_log(p_clinic, p_cs, p_actor, 'create_report', 'report', v_id, v_name);
  return v_id;
end $$;

create or replace function builder_create_dashboard_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text := btrim(coalesce(a->>'name', '')); v_widgets jsonb := '[]'::jsonb; n text; rid uuid;
begin
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'VALIDATION: give the dashboard a name'; end if;
  for n in select jsonb_array_elements_text(coalesce(a->'reports', '[]'::jsonb)) loop
    select id into rid from saved_reports where clinic_id = p_clinic and lower(name) = lower(btrim(n)) order by created_at desc limit 1;
    if rid is null then raise exception 'NOT_FOUND: report "%" does not exist', n; end if;
    v_widgets := v_widgets || jsonb_build_object('report_id', rid, 'width', 'half');
  end loop;
  if jsonb_array_length(v_widgets) > 12 then raise exception 'VALIDATION: a dashboard can hold at most 12 reports'; end if;
  insert into saved_dashboards (clinic_id, name, description, widgets, created_by)
  values (p_clinic, v_name, nullif(a->>'description', ''), v_widgets, p_actor) returning id into v_id;
  perform builder_log(p_clinic, p_cs, p_actor, 'create_dashboard', 'dashboard', v_id, v_name);
  return v_id;
end $$;

create or replace function builder_set_booking_rule_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prev jsonb; v_patch jsonb := '{}'::jsonb; v_m int;
begin
  if a ? 'doctor_rule' then
    if a->>'doctor_rule' not in ('usual_then_free', 'least_loaded', 'ask') then raise exception 'VALIDATION: doctor rule must be usual_then_free, least_loaded or ask'; end if;
    v_patch := v_patch || jsonb_build_object('doctor_rule', a->>'doctor_rule');
  end if;
  if a ? 'slot_minutes' then
    v_m := (a->>'slot_minutes')::int;
    if v_m < 5 or v_m > 120 then raise exception 'VALIDATION: slot length must be 5 to 120 minutes'; end if;
    v_patch := v_patch || jsonb_build_object('slot_minutes', v_m);
  end if;
  if v_patch = '{}'::jsonb then raise exception 'VALIDATION: nothing to change'; end if;
  select coalesce(settings->'booking', '{}'::jsonb) into v_prev from clinics where id = p_clinic;
  update clinics set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{booking}', v_prev || v_patch) where id = p_clinic;
  perform builder_log(p_clinic, p_cs, p_actor, 'set_booking_rule', 'setting', null, 'booking', jsonb_build_object('previous', v_prev, 'now', v_prev || v_patch));
end $$;

create or replace function builder_create_permission_set_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text := btrim(coalesce(a->>'name', '')); o jsonb; n text; v_uid uuid; v_assigned int := 0;
begin
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'VALIDATION: give the permission set a name'; end if;
  if exists (select 1 from permission_sets where clinic_id = p_clinic and lower(name) = lower(v_name)) then raise exception 'ALREADY: a permission set called "%" already exists', v_name; end if;
  if jsonb_typeof(a->'objects') <> 'array' or jsonb_array_length(a->'objects') = 0 then raise exception 'VALIDATION: choose at least one table'; end if;
  insert into permission_sets (clinic_id, name, description, created_by) values (p_clinic, v_name, nullif(a->>'description', ''), p_actor) returning id into v_id;
  for o in select * from jsonb_array_elements(a->'objects') loop
    if builder_src(p_clinic, o->>'object') is null then raise exception 'NOT_FOUND: table "%" does not exist', o->>'object'; end if;
    insert into permission_set_objects (clinic_id, set_id, object_api_name, can_read, can_create, can_edit, can_delete, read_scope, edit_scope)
    values (p_clinic, v_id, o->>'object',
            coalesce((o->>'read')::boolean, true) or coalesce((o->>'create')::boolean, false) or coalesce((o->>'edit')::boolean, false) or coalesce((o->>'delete')::boolean, false),
            coalesce((o->>'create')::boolean, false), coalesce((o->>'edit')::boolean, false), coalesce((o->>'delete')::boolean, false),
            coalesce(nullif(o->>'read_scope', ''), 'all'), coalesce(nullif(o->>'edit_scope', ''), 'own'));
  end loop;
  for n in select jsonb_array_elements_text(coalesce(a->'assign_to', '[]'::jsonb)) loop
    select user_id into v_uid from clinic_staff where clinic_id = p_clinic and lower(name) = lower(btrim(n)) and coalesce(is_active, true) limit 1;
    if v_uid is null then raise exception 'NOT_FOUND: no team member named "%"', n; end if;
    insert into permission_set_users (set_id, clinic_id, user_id, assigned_by) values (v_id, p_clinic, v_uid, p_actor) on conflict do nothing; v_assigned := v_assigned + 1;
  end loop;
  for n in select jsonb_array_elements_text(coalesce(a->'assign_roles', '[]'::jsonb)) loop
    if n not in ('doctor', 'intern', 'nurse', 'receptionist') then raise exception 'VALIDATION: role must be doctor, intern, nurse or receptionist'; end if;
    insert into permission_set_users (set_id, clinic_id, user_id, assigned_by)
    select v_id, p_clinic, user_id, p_actor from clinic_staff where clinic_id = p_clinic and role = n and coalesce(is_active, true) on conflict do nothing;
  end loop;
  perform builder_log(p_clinic, p_cs, p_actor, 'create_permission_set', 'permission_set', v_id, v_name);
  return v_id;
end $$;


-- ─── Flows: "when X happens, do Y" ───────────────────────────
-- A flow has a trigger (an event in the clinic), optional conditions, and 1 to 5 actions.
-- Events are raised by the app (appointments, invoices, records, stock) and by a daily job (day_before_appointment, daily).
-- Actions: send_whatsapp (patient / doctor / admin) and create_task. Every run is logged in flow_runs.
create table if not exists flows (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 2 and 80),
  description   text,
  trigger_event text not null check (trigger_event in ('appointment_booked','appointment_cancelled','appointment_completed','appointment_no_show',
                                                       'invoice_paid','record_created','record_updated','stock_low','day_before_appointment','daily')),
  trigger_object text,
  conditions    jsonb not null default '[]'::jsonb,
  actions       jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 5),
  is_active     boolean not null default true,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  unique (id, clinic_id)
);
create unique index if not exists flows_name_idx on flows (clinic_id, lower(name));
create index if not exists flows_trigger_idx on flows (clinic_id, trigger_event) where is_active;
create table if not exists flow_runs (
  id        uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  flow_id   uuid references flows(id) on delete set null,
  flow_name text,
  event     text not null,
  status    text not null check (status in ('ok','failed','skipped')),
  detail    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists flow_runs_idx on flow_runs (clinic_id, created_at desc);
alter table flows enable row level security;
alter table flow_runs enable row level security;
drop policy if exists "Staff read flows" on flows;
create policy "Staff read flows" on flows for select using (is_clinic_staff(clinic_id));
drop policy if exists "Admin read flow_runs" on flow_runs;
create policy "Admin read flow_runs" on flow_runs for select using (is_clinic_role(clinic_id, array['admin']));

create or replace function builder_create_flow_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_name text := btrim(coalesce(a->>'name', '')); v_ev text := a->'trigger'->>'event'; v_obj text := nullif(a->'trigger'->>'object', ''); x jsonb;
begin
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'VALIDATION: give the flow a name'; end if;
  if v_ev is null or v_ev not in ('appointment_booked','appointment_cancelled','appointment_completed','appointment_no_show','invoice_paid','record_created','record_updated','stock_low','day_before_appointment','daily')
    then raise exception 'VALIDATION: unknown trigger "%"', coalesce(v_ev, '(missing)'); end if;
  if v_ev in ('record_created', 'record_updated') then
    if v_obj is null or builder_src(p_clinic, v_obj) is null then raise exception 'NOT_FOUND: choose a table for this trigger'; end if;
  else v_obj := null; end if;
  if jsonb_typeof(a->'actions') <> 'array' or jsonb_array_length(a->'actions') not between 1 and 5 then raise exception 'VALIDATION: a flow needs 1 to 5 actions'; end if;
  for x in select * from jsonb_array_elements(a->'actions') loop
    if x->>'type' = 'send_whatsapp' then
      if coalesce(x->>'to', 'patient') not in ('patient', 'doctor', 'admin') then raise exception 'VALIDATION: send to patient, doctor or admin'; end if;
      if x->>'template' is null and coalesce(x->>'text', '') = '' then raise exception 'VALIDATION: a message needs a template or text'; end if;
      if x->>'template' is not null and x->>'template' not in ('confirmation', 'reminder', 'cancellation', 'thanks') then raise exception 'VALIDATION: unknown message template'; end if;
    elsif x->>'type' = 'create_task' then
      if length(btrim(coalesce(x->>'title', ''))) < 2 then raise exception 'VALIDATION: a task needs a title'; end if;
    else raise exception 'VALIDATION: unknown action "%"', coalesce(x->>'type', '(missing)'); end if;
  end loop;
  if exists (select 1 from flows where clinic_id = p_clinic and lower(name) = lower(v_name)) then raise exception 'ALREADY: a flow called "%" already exists', v_name; end if;
  if (select count(*) from flows where clinic_id = p_clinic) >= 50 then raise exception 'VALIDATION: a clinic can have at most 50 flows'; end if;
  insert into flows (clinic_id, name, description, trigger_event, trigger_object, conditions, actions, created_by)
  values (p_clinic, v_name, nullif(a->>'description', ''), v_ev, v_obj, coalesce(a->'conditions', '[]'::jsonb), a->'actions', p_actor) returning id into v_id;
  perform builder_log(p_clinic, p_cs, p_actor, 'create_flow', 'flow', v_id, v_name);
  return v_id;
end $$;

create or replace function builder_set_flow_active_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f flows%rowtype; v_on boolean := coalesce((a->>'active')::boolean, true);
begin
  select * into f from flows where clinic_id = p_clinic and lower(name) = lower(btrim(coalesce(a->>'name', '')));
  if not found then raise exception 'NOT_FOUND: no flow called "%"', coalesce(a->>'name', ''); end if;
  update flows set is_active = v_on where id = f.id;
  perform builder_log(p_clinic, p_cs, p_actor, 'set_flow_active', 'flow', f.id, f.name, jsonb_build_object('previous', f.is_active));
end $$;

create or replace function flow_log(p_clinic uuid, p_flow uuid, p_name text, p_event text, p_status text, p_detail jsonb default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into flow_runs (clinic_id, flow_id, flow_name, event, status, detail) values (p_clinic, p_flow, left(p_name, 80), p_event, p_status, p_detail);
$$;
revoke all on function flow_log(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function flow_log(uuid, uuid, text, text, text, jsonb) to service_role; end if; end $$;


-- ─── Flow events (the outbox) ────────────────────────────────
-- Database triggers drop an event here when an appointment is booked / cancelled / completed / missed or an invoice is paid,
-- from ANY path (chat, screens, API). The app claims and runs them straight after the action, and a daily job catches the rest.
-- An event is only queued when the clinic has an active flow for it, so clinics without flows pay nothing.
create table if not exists flow_events (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  event        text not null,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists flow_events_pending_idx on flow_events (clinic_id, created_at) where processed_at is null;
alter table flow_events enable row level security;

create or replace function flow_enqueue(p_clinic uuid, p_event text, p_payload jsonb) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from flows where clinic_id = p_clinic and is_active and trigger_event = p_event
                   and (trigger_object is null or trigger_object = p_payload->>'object')) then return false; end if;
  insert into flow_events (clinic_id, event, payload) values (p_clinic, p_event, p_payload);
  return true;
end $$;

create or replace function flow_claim(p_clinic uuid default null, p_limit int default 50) returns setof flow_events
language sql security definer set search_path = public, pg_temp as $$
  update flow_events e set processed_at = now()
  where e.id in (select id from flow_events where processed_at is null and (p_clinic is null or clinic_id = p_clinic)
                 order by created_at limit least(greatest(p_limit, 1), 200) for update skip locked)
  returning e.*
$$;

create or replace function flow_appt_trigger() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ev text;
begin
  if tg_op = 'INSERT' then v_ev := case when new.status = 'cancelled' then null else 'appointment_booked' end;
  elsif new.status is distinct from old.status then
    v_ev := case new.status when 'cancelled' then 'appointment_cancelled' when 'completed' then 'appointment_completed' when 'no_show' then 'appointment_no_show' else null end;
  end if;
  if v_ev is not null then perform flow_enqueue(new.clinic_id, v_ev, jsonb_build_object('appointment_id', new.id)); end if;
  return new;
end $$;
drop trigger if exists flow_appt on appointments;
create trigger flow_appt after insert or update of status on appointments for each row execute function flow_appt_trigger();

create or replace function flow_invoice_trigger() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
    perform flow_enqueue(new.clinic_id, 'invoice_paid', jsonb_build_object('invoice_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists flow_invoice on invoices;
create trigger flow_invoice after insert or update of status on invoices for each row execute function flow_invoice_trigger();

revoke all on function flow_enqueue(uuid, text, jsonb), flow_claim(uuid, int), flow_appt_trigger(), flow_invoice_trigger() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function flow_enqueue(uuid, text, jsonb), flow_claim(uuid, int) to service_role; end if; end $$;

-- a small read model for the processor: the invoice with who it was for
create or replace function flow_invoice_details(p_invoice uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('invoice', jsonb_build_object('id', i.id, 'number', i.invoice_number, 'total', i.total, 'paid', i.paid_amount, 'status', i.status, 'method', i.payment_method),
    'patient', jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone),
    'clinic', jsonb_build_object('name', coalesce(c.brand_name, c.name), 'address', c.address, 'phone', c.phone))
  from invoices i join clinics c on c.id = i.clinic_id left join clinic_patients p on p.id = i.clinic_patient_id where i.id = p_invoice
$$;
revoke all on function flow_invoice_details(uuid) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function flow_invoice_details(uuid) to service_role; end if; end $$;

create or replace function builder_apply_plan(
  p_clinic uuid, p_actor uuid, p_prompt text, p_plan jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cs uuid;
  s jsonb;
  v_args jsonb;
  v_obj uuid;
  v_n int;
begin
  if jsonb_typeof(p_plan->'steps') <> 'array' or jsonb_array_length(p_plan->'steps') = 0 then
    raise exception 'The plan has no steps';
  end if;
  if jsonb_array_length(p_plan->'steps') > 40 then raise exception 'A plan may contain at most 40 steps'; end if;

  insert into builder_changesets (clinic_id, requested_by, prompt, plan, status)
  values (p_clinic, p_actor, left(p_prompt, 4000), p_plan, 'applied') returning id into v_cs;

  for s in select * from jsonb_array_elements(p_plan->'steps') loop
    v_args := coalesce(s->'args','{}'::jsonb);
    case s->>'tool'
      when 'create_object' then
        perform builder_create_object_internal(p_clinic, p_actor, v_cs, v_args);
      when 'add_field' then
        select id into v_obj from builder_objects
          where clinic_id = p_clinic and api_name = v_args->>'object' and status = 'active';
        if v_obj is null then raise exception 'Object "%" not found for add_field', coalesce(v_args->>'object','(missing)'); end if;
        perform builder_add_field_internal(p_clinic, p_actor, v_cs, v_obj, v_args->'field');
      when 'hide_field' then
        perform builder_hide_field_internal(p_clinic, p_actor, v_cs, v_args->>'object', v_args->>'field');
      when 'create_app' then
        perform builder_create_app_internal(p_clinic, p_actor, v_cs, v_args);
      when 'add_tab' then
        perform builder_add_tab_internal(p_clinic, p_actor, v_cs, v_args->>'app', v_args);
      when 'create_report' then
        perform builder_create_report_internal(p_clinic, p_actor, v_cs, v_args);
      when 'create_dashboard' then
        perform builder_create_dashboard_internal(p_clinic, p_actor, v_cs, v_args);
      when 'set_booking_rule' then
        perform builder_set_booking_rule_internal(p_clinic, p_actor, v_cs, v_args);
      when 'create_permission_set' then
        perform builder_create_permission_set_internal(p_clinic, p_actor, v_cs, v_args);
      when 'create_flow' then
        perform builder_create_flow_internal(p_clinic, p_actor, v_cs, v_args);
      when 'set_flow_active' then
        perform builder_set_flow_active_internal(p_clinic, p_actor, v_cs, v_args);
      else
        raise exception 'Unknown builder tool "%"', coalesce(s->>'tool','(missing)');
    end case;
  end loop;
  return v_cs;
end $$;


create or replace function builder_rollback(p_clinic uuid, p_actor uuid, p_changeset uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; f builder_fields%rowtype; o builder_objects%rowtype;
  v_has boolean; v_kept int := 0; v_removed int := 0;
begin
  if not exists (select 1 from builder_changesets where id = p_changeset and clinic_id = p_clinic and status = 'applied') then
    raise exception 'Changeset not found or already rolled back';
  end if;

  for r in select * from builder_audit where changeset_id = p_changeset and clinic_id = p_clinic order by seq desc loop
    if r.action = 'create_report' then
      delete from saved_reports where id = r.target_id and clinic_id = p_clinic; v_removed := v_removed + 1;
    elsif r.action = 'create_dashboard' then
      delete from saved_dashboards where id = r.target_id and clinic_id = p_clinic; v_removed := v_removed + 1;
    elsif r.action = 'create_permission_set' then
      delete from permission_sets where id = r.target_id and clinic_id = p_clinic; v_removed := v_removed + 1;
    elsif r.action = 'create_flow' then
      delete from flows where id = r.target_id and clinic_id = p_clinic; v_removed := v_removed + 1;
    elsif r.action = 'set_flow_active' then
      update flows set is_active = coalesce((r.detail->>'previous')::boolean, true) where id = r.target_id and clinic_id = p_clinic; v_removed := v_removed + 1;
    elsif r.action = 'set_booking_rule' then
      update clinics set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{booking}', coalesce(r.detail->'previous', '{}'::jsonb)) where id = p_clinic; v_removed := v_removed + 1;
    elsif r.action = 'add_tab' then
      delete from builder_tabs where id = r.target_id; v_removed := v_removed + 1;
    elsif r.action = 'create_app' then
      delete from builder_apps where id = r.target_id; v_removed := v_removed + 1;
    elsif r.action = 'hide_field' then
      update builder_fields set status = 'active' where id = r.target_id;
    elsif r.action = 'add_field' then
      select * into f from builder_fields where id = r.target_id;
      if found then
        select * into o from builder_objects where id = f.object_id;
        if exists (select 1 from information_schema.tables where table_schema = 'tenant_data' and table_name = o.table_name) then
          if exists (select 1 from builder_audit where changeset_id = p_changeset and action = 'create_object' and target_id = o.id) then
            -- object created in this same changeset: keep all of its fields together if it holds any rows
            execute format('select exists (select 1 from tenant_data.%I)', o.table_name) into v_has;
          else
            execute format('select exists (select 1 from tenant_data.%I where %I is not null)', o.table_name, f.column_name) into v_has;
          end if;
        else v_has := false; end if;
        if v_has then
          update builder_fields set status = 'hidden' where id = f.id; v_kept := v_kept + 1;
        else
          if exists (select 1 from information_schema.tables where table_schema = 'tenant_data' and table_name = o.table_name) then
            execute format('alter table tenant_data.%I drop column if exists %I cascade', o.table_name, f.column_name);
          end if;
          delete from builder_fields where id = f.id; v_removed := v_removed + 1;
        end if;
      end if;
    elsif r.action = 'create_object' then
      select * into o from builder_objects where id = r.target_id;
      if found then
        execute format('select exists (select 1 from tenant_data.%I)', o.table_name) into v_has;
        if v_has then
          update builder_objects set status = 'archived' where id = o.id; v_kept := v_kept + 1;
        else
          execute format('drop table if exists tenant_data.%I cascade', o.table_name);
          delete from builder_objects where id = o.id; v_removed := v_removed + 1;
        end if;
      end if;
    end if;
  end loop;

  update builder_changesets set status = 'rolled_back' where id = p_changeset;
  insert into builder_audit (clinic_id, changeset_id, actor, action, target_type, target_name, detail)
  values (p_clinic, p_changeset, p_actor, 'rollback', 'changeset', p_changeset::text,
          jsonb_build_object('removed', v_removed, 'kept_because_data_exists', v_kept));
  return jsonb_build_object('removed', v_removed, 'kept', v_kept);
end $$;


revoke all on function builder_create_flow_internal(uuid, uuid, uuid, jsonb), builder_set_flow_active_internal(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function builder_create_report_internal(uuid, uuid, uuid, jsonb), builder_create_dashboard_internal(uuid, uuid, uuid, jsonb),
  builder_set_booking_rule_internal(uuid, uuid, uuid, jsonb), builder_create_permission_set_internal(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ─── The assistant (every user) may save reports and dashboards over data they can read ───
create or replace function assistant_apply(p_clinic uuid, p_actor uuid, p_prompt text, p_plan jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cs uuid; s jsonb;
begin
  if not exists (select 1 from clinic_staff where clinic_id = p_clinic and user_id = p_actor and coalesce(is_active, true)) then raise exception 'FORBIDDEN: you are not part of this clinic'; end if;
  if jsonb_typeof(p_plan->'steps') <> 'array' or jsonb_array_length(p_plan->'steps') not between 1 and 15 then raise exception 'VALIDATION: the request has no steps'; end if;
  for s in select * from jsonb_array_elements(p_plan->'steps') loop
    if s->>'tool' not in ('create_report', 'create_dashboard') then raise exception 'FORBIDDEN: the assistant cannot do "%" for you. Ask an admin to use the Builder.', coalesce(s->>'tool', '(missing)'); end if;
  end loop;
  insert into builder_changesets (clinic_id, requested_by, prompt, plan, status) values (p_clinic, p_actor, left(p_prompt, 4000), p_plan, 'applied') returning id into v_cs;
  for s in select * from jsonb_array_elements(p_plan->'steps') loop
    if s->>'tool' = 'create_report' then perform builder_create_report_internal(p_clinic, p_actor, v_cs, coalesce(s->'args', '{}'::jsonb));
    else perform builder_create_dashboard_internal(p_clinic, p_actor, v_cs, coalesce(s->'args', '{}'::jsonb)); end if;
  end loop;
  return v_cs;
end $$;
revoke all on function assistant_apply(uuid, uuid, text, jsonb) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function assistant_apply(uuid, uuid, text, jsonb) to service_role; end if; end $$;
