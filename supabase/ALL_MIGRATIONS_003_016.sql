-- Mediflow: all migrations 003-016 in order, safe to run again. Paste into Supabase -> SQL Editor -> Run.

-- ===== supabase/migrations/003_builder_engine.sql =====
-- ============================================================
-- Mediflow AI Builder — metadata + safe DDL engine
-- Run AFTER 001_schema.sql.
--
-- Design:
--  * Metadata (apps, objects, fields, tabs) lives in public.builder_* tables.
--  * Custom objects get REAL tables in the private schema `tenant_data`
--    (not exposed through PostgREST). All data access goes through the
--    Next.js API, which enforces profile / permission-set / record security.
--  * Only these validated functions create or alter tables. The AI never
--    supplies raw SQL; it supplies a JSON plan that is checked here.
--  * Every change is part of a changeset, written to an audit log, and
--    can be rolled back.
--  * Functions are executable by service_role only (the API checks that the
--    caller is a clinic admin first).
-- ============================================================

create schema if not exists tenant_data;
revoke all on schema tenant_data from public, anon, authenticated;

-- ─── Metadata tables ─────────────────────────────────────────
create table if not exists builder_apps (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  api_name    text not null,
  label       text not null,
  icon        text default '🧩',
  description text,
  status      text not null default 'active' check (status in ('active','archived')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (clinic_id, api_name)
);

create table if not exists builder_objects (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  api_name     text not null,
  label        text not null,
  plural_label text not null,
  description  text,
  icon         text default '📄',
  table_name   text not null,
  name_field   text not null default 'name',
  is_system    boolean not null default false,
  status       text not null default 'active' check (status in ('active','archived')),
  created_by   uuid,
  created_at   timestamptz not null default now(),
  unique (clinic_id, api_name)
);

create table if not exists builder_fields (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  object_id        uuid not null references builder_objects(id) on delete cascade,
  api_name         text not null,
  column_name      text not null,
  label            text not null,
  data_type        text not null check (data_type in
    ('text','long_text','number','currency','date','datetime','boolean','picklist','email','phone','url','lookup')),
  required         boolean not null default false,
  is_unique        boolean not null default false,
  picklist_values  jsonb,
  lookup_object_id uuid references builder_objects(id) on delete set null,
  help_text        text,
  sort_order       int not null default 0,
  status           text not null default 'active' check (status in ('active','hidden')),
  created_at       timestamptz not null default now(),
  unique (object_id, api_name)
);

create table if not exists builder_tabs (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references clinics(id) on delete cascade,
  app_id     uuid not null references builder_apps(id) on delete cascade,
  kind       text not null default 'object' check (kind in ('object','dashboard','report','page')),
  object_id  uuid references builder_objects(id) on delete cascade,
  label      text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists builder_changesets (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  requested_by uuid,
  prompt       text,
  plan         jsonb not null,
  status       text not null check (status in ('applied','failed','rolled_back')),
  error        text,
  created_at   timestamptz not null default now()
);

create table if not exists builder_audit (
  seq         bigint generated always as identity primary key,
  clinic_id   uuid not null references clinics(id) on delete cascade,
  changeset_id uuid references builder_changesets(id) on delete cascade,
  actor       uuid,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  target_name text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists builder_fields_object_idx on builder_fields(object_id);
create index if not exists builder_audit_cs_idx on builder_audit(changeset_id);

-- Metadata is readable by clinic staff; writes happen only through the
-- service-role functions below.
alter table builder_apps       enable row level security;
alter table builder_objects    enable row level security;
alter table builder_fields     enable row level security;
alter table builder_tabs       enable row level security;
alter table builder_changesets enable row level security;
alter table builder_audit      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['builder_apps','builder_objects','builder_fields','builder_tabs','builder_changesets','builder_audit']
  loop
    execute format('drop policy if exists "Staff read %1$s" on %1$I', t);
    execute format('create policy "Staff read %1$s" on %1$I for select using (is_clinic_staff(clinic_id))', t);
  end loop;
end $$;

-- ─── Helpers ─────────────────────────────────────────────────
create or replace function builder_pg_type(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'text' then 'text' when 'long_text' then 'text'
    when 'number' then 'numeric' when 'currency' then 'numeric(12,2)'
    when 'date' then 'date' when 'datetime' then 'timestamptz'
    when 'boolean' then 'boolean' when 'picklist' then 'text'
    when 'email' then 'text' when 'phone' then 'text' when 'url' then 'text'
    when 'lookup' then 'uuid'
    else null end;
$$;

create or replace function builder_check_name(p text, p_what text)
returns void language plpgsql immutable as $$
begin
  if p is null or p !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception '% "%" must use lowercase letters, digits and underscores, start with a letter, and be 2-41 characters', p_what, coalesce(p,'(missing)');
  end if;
end $$;

create or replace function tenant_data.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace function builder_log(
  p_clinic uuid, p_cs uuid, p_actor uuid, p_action text,
  p_type text, p_id uuid, p_name text, p_detail jsonb default null
) returns void language sql as $$
  insert into builder_audit (clinic_id, changeset_id, actor, action, target_type, target_id, target_name, detail)
  values (p_clinic, p_cs, p_actor, p_action, p_type, p_id, p_name, p_detail);
$$;

-- ─── Add a field ─────────────────────────────────────────────
create or replace function builder_add_field_internal(
  p_clinic uuid, p_actor uuid, p_cs uuid, p_object_id uuid, p jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o builder_objects%rowtype;
  l builder_objects%rowtype;
  v_api text := p->>'api_name';
  v_type text := coalesce(p->>'data_type','text');
  v_col text;
  v_label text := coalesce(nullif(p->>'label',''), initcap(replace(p->>'api_name','_',' ')));
  v_req boolean := coalesce((p->>'required')::boolean,false);
  v_uni boolean := coalesce((p->>'unique')::boolean,false);
  v_cnt int;
  v_id uuid;
  v_empty boolean;
begin
  select * into o from builder_objects where id = p_object_id and clinic_id = p_clinic and status = 'active';
  if not found then raise exception 'Object not found'; end if;

  perform builder_check_name(v_api, 'Field name');
  if builder_pg_type(v_type) is null then
    raise exception 'Unsupported field type "%". Allowed: text, long_text, number, currency, date, datetime, boolean, picklist, email, phone, url, lookup', v_type;
  end if;

  select count(*) into v_cnt from builder_fields where object_id = o.id and status = 'active';
  if v_cnt >= 60 then raise exception 'Object "%" already has the maximum of 60 fields', o.api_name; end if;
  if exists (select 1 from builder_fields where object_id = o.id and api_name = v_api) then
    raise exception 'Field "%" already exists on "%"', v_api, o.api_name;
  end if;

  v_col := 'f_' || v_api;

  if v_type = 'picklist' and coalesce(jsonb_typeof(p->'picklist_values'),'') <> 'array' then
    raise exception 'Picklist field "%" needs a picklist_values array', v_api;
  end if;

  if v_type = 'lookup' then
    select * into l from builder_objects
      where clinic_id = p_clinic and api_name = p->>'lookup_object' and status = 'active';
    if not found then raise exception 'Lookup target object "%" does not exist', coalesce(p->>'lookup_object','(missing)'); end if;
    execute format('alter table tenant_data.%I add column %I uuid references tenant_data.%I(id) on delete set null',
                   o.table_name, v_col, l.table_name);
  else
    execute format('alter table tenant_data.%I add column %I %s', o.table_name, v_col, builder_pg_type(v_type));
  end if;

  if v_req then
    execute format('select not exists (select 1 from tenant_data.%I)', o.table_name) into v_empty;
    if v_empty then
      execute format('alter table tenant_data.%I alter column %I set not null', o.table_name, v_col);
    end if;
  end if;
  if v_uni then
    execute format('create unique index on tenant_data.%I (clinic_id, %I) where %I is not null', o.table_name, v_col, v_col);
  end if;

  insert into builder_fields (clinic_id, object_id, api_name, column_name, label, data_type, required, is_unique,
                              picklist_values, lookup_object_id, help_text, sort_order)
  values (p_clinic, o.id, v_api, v_col, v_label, v_type, v_req, v_uni,
          case when v_type = 'picklist' then p->'picklist_values' end,
          case when v_type = 'lookup' then l.id end,
          p->>'help_text', v_cnt + 1)
  returning id into v_id;

  perform builder_log(p_clinic, p_cs, p_actor, 'add_field', 'field', v_id, o.api_name || '.' || v_api,
                      jsonb_build_object('data_type', v_type, 'required', v_req));
  return v_id;
end $$;

-- ─── Create an object (real table + metadata) ────────────────
create or replace function builder_create_object_internal(
  p_clinic uuid, p_actor uuid, p_cs uuid, p jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_api text := p->>'api_name';
  v_label text := coalesce(nullif(p->>'label',''), initcap(replace(p->>'api_name','_',' ')));
  v_table text;
  v_id uuid;
  v_cnt int;
  f jsonb;
  v_fields jsonb := coalesce(p->'fields','[]'::jsonb);
begin
  perform builder_check_name(v_api, 'Object name');
  select count(*) into v_cnt from builder_objects where clinic_id = p_clinic and status = 'active' and not is_system;
  if v_cnt >= 25 then raise exception 'This clinic already has the maximum of 25 custom objects'; end if;
  if exists (select 1 from builder_objects where clinic_id = p_clinic and api_name = v_api) then
    raise exception 'Object "%" already exists', v_api;
  end if;

  v_table := 'o_' || substr(replace(p_clinic::text,'-',''),1,8) || '_' || v_api;

  execute format($t$create table tenant_data.%I (
      id         uuid primary key default gen_random_uuid(),
      clinic_id  uuid not null references public.clinics(id) on delete cascade,
      owner_id   uuid,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )$t$, v_table);
  execute format('create index on tenant_data.%I (clinic_id)', v_table);
  execute format('alter table tenant_data.%I enable row level security', v_table);
  execute format('revoke all on tenant_data.%I from public, anon, authenticated', v_table);
  execute format('create trigger touch_updated_at before update on tenant_data.%I for each row execute function tenant_data.touch_updated_at()', v_table);

  insert into builder_objects (clinic_id, api_name, label, plural_label, description, icon, table_name, created_by)
  values (p_clinic, v_api, v_label, coalesce(nullif(p->>'plural_label',''), v_label || 's'),
          p->>'description', coalesce(nullif(p->>'icon',''),'📄'), v_table, p_actor)
  returning id into v_id;

  if not exists (select 1 from jsonb_array_elements(v_fields) x where x->>'api_name' = 'name') then
    v_fields := jsonb_build_array(jsonb_build_object('api_name','name','label','Name','data_type','text','required',true)) || v_fields;
  end if;
  for f in select * from jsonb_array_elements(v_fields) loop
    perform builder_add_field_internal(p_clinic, p_actor, p_cs, v_id, f);
  end loop;

  perform builder_log(p_clinic, p_cs, p_actor, 'create_object', 'object', v_id, v_api,
                      jsonb_build_object('table', v_table, 'fields', jsonb_array_length(v_fields)));
  return v_id;
end $$;

-- ─── Hide a field (soft delete; data is kept) ────────────────
create or replace function builder_hide_field_internal(
  p_clinic uuid, p_actor uuid, p_cs uuid, p_object_api text, p_field_api text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  update builder_fields f set status = 'hidden'
   from builder_objects o
   where f.object_id = o.id and o.clinic_id = p_clinic and o.api_name = p_object_api
     and f.api_name = p_field_api and f.status = 'active' and f.api_name <> 'name'
   returning f.id into v_id;
  if v_id is null then raise exception 'Active field "%.%" not found (the Name field cannot be hidden)', p_object_api, p_field_api; end if;
  perform builder_log(p_clinic, p_cs, p_actor, 'hide_field', 'field', v_id, p_object_api || '.' || p_field_api);
end $$;

-- ─── Apps and tabs ───────────────────────────────────────────
create or replace function builder_add_tab_internal(
  p_clinic uuid, p_actor uuid, p_cs uuid, p_app_api text, p jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare a builder_apps%rowtype; o builder_objects%rowtype; v_kind text := coalesce(p->>'kind','object'); v_id uuid; v_n int; v_label text;
begin
  select * into a from builder_apps where clinic_id = p_clinic and api_name = p_app_api and status = 'active';
  if not found then raise exception 'App "%" not found', p_app_api; end if;
  if v_kind not in ('object','dashboard','report','page') then raise exception 'Unsupported tab kind "%"', v_kind; end if;
  if v_kind = 'object' then
    select * into o from builder_objects where clinic_id = p_clinic and api_name = p->>'object' and status = 'active';
    if not found then raise exception 'Tab object "%" not found', coalesce(p->>'object','(missing)'); end if;
  end if;
  v_label := coalesce(nullif(p->>'label',''), o.plural_label, 'Tab');
  select count(*) into v_n from builder_tabs where app_id = a.id;
  if v_n >= 20 then raise exception 'App "%" already has the maximum of 20 tabs', p_app_api; end if;
  insert into builder_tabs (clinic_id, app_id, kind, object_id, label, sort_order)
  values (p_clinic, a.id, v_kind, o.id, v_label, v_n + 1) returning id into v_id;
  perform builder_log(p_clinic, p_cs, p_actor, 'add_tab', 'tab', v_id, p_app_api || ':' || v_label);
  return v_id;
end $$;

create or replace function builder_create_app_internal(
  p_clinic uuid, p_actor uuid, p_cs uuid, p jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_api text := p->>'api_name'; v_id uuid; v_obj text; v_cnt int;
begin
  perform builder_check_name(v_api, 'App name');
  select count(*) into v_cnt from builder_apps where clinic_id = p_clinic and status = 'active';
  if v_cnt >= 15 then raise exception 'This clinic already has the maximum of 15 apps'; end if;
  if exists (select 1 from builder_apps where clinic_id = p_clinic and api_name = v_api) then
    raise exception 'App "%" already exists', v_api;
  end if;
  insert into builder_apps (clinic_id, api_name, label, icon, description, created_by)
  values (p_clinic, v_api, coalesce(nullif(p->>'label',''), initcap(replace(v_api,'_',' '))),
          coalesce(nullif(p->>'icon',''),'🧩'), p->>'description', p_actor)
  returning id into v_id;
  perform builder_log(p_clinic, p_cs, p_actor, 'create_app', 'app', v_id, v_api);
  for v_obj in select jsonb_array_elements_text(coalesce(p->'objects','[]'::jsonb)) loop
    perform builder_add_tab_internal(p_clinic, p_actor, p_cs, v_api, jsonb_build_object('kind','object','object',v_obj));
  end loop;
  return v_id;
end $$;

-- ─── Apply a whole plan atomically ───────────────────────────
-- p_plan = {"steps":[{"tool":"create_object","args":{...}}, ...]}
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
      else
        raise exception 'Unknown builder tool "%"', coalesce(s->>'tool','(missing)');
    end case;
  end loop;
  return v_cs;
end $$;

create or replace function builder_record_failure(
  p_clinic uuid, p_actor uuid, p_prompt text, p_plan jsonb, p_error text
) returns void language sql security definer set search_path = public, pg_temp as $$
  insert into builder_changesets (clinic_id, requested_by, prompt, plan, status, error)
  values (p_clinic, p_actor, left(p_prompt,4000), coalesce(p_plan,'{}'::jsonb), 'failed', left(p_error,2000));
$$;

-- ─── Roll back a changeset ───────────────────────────────────
-- Empty tables/columns are dropped. Anything holding data is archived/hidden
-- instead, so rolling back can never destroy records.
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
    if r.action = 'add_tab' then
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

-- ─── Schema snapshot for the agent and the UI ────────────────
create or replace function builder_get_schema(p_clinic uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'api_name', o.api_name, 'label', o.label, 'plural_label', o.plural_label, 'icon', o.icon,
        'is_system', o.is_system, 'status', o.status,
        'fields', coalesce((select jsonb_agg(jsonb_build_object(
            'api_name', f.api_name, 'label', f.label, 'data_type', f.data_type, 'required', f.required,
            'picklist_values', f.picklist_values,
            'lookup_object', (select api_name from builder_objects lo where lo.id = f.lookup_object_id))
            order by f.sort_order) from builder_fields f where f.object_id = o.id and f.status = 'active'), '[]'::jsonb))
        order by o.created_at) from builder_objects o where o.clinic_id = p_clinic and o.status = 'active'), '[]'::jsonb),
    'apps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'api_name', a.api_name, 'label', a.label, 'icon', a.icon,
        'tabs', coalesce((select jsonb_agg(jsonb_build_object('label', t.label, 'kind', t.kind,
            'object', (select tobj.api_name from builder_objects tobj where tobj.id = t.object_id)) order by t.sort_order)
            from builder_tabs t where t.app_id = a.id), '[]'::jsonb))
        order by a.created_at) from builder_apps a where a.clinic_id = p_clinic and a.status = 'active'), '[]'::jsonb)
  );
$$;

-- ─── Lock the functions down to the service role ─────────────
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'builder\_%' escape '\'
      and p.proname not in ('builder_pg_type','builder_check_name')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;


-- ===== supabase/migrations/004_appointment_flow.sql =====
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


-- ===== supabase/migrations/005_tenant_safety_and_treatments.sql =====
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

-- doctor profile: years of experience (set from the AI assistant or the staff page)
alter table doctors add column if not exists experience_years smallint check (experience_years is null or experience_years between 0 and 70);

-- new role: intern (read-only clinical access; cannot bill, change stock or complete treatments)
do $$
declare c text;
begin
  for c in select conname from pg_constraint where conrelid = 'clinic_staff'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table clinic_staff drop constraint %I', c);
  end loop;
  alter table clinic_staff add constraint clinic_staff_role_check check (role in ('admin','doctor','intern','nurse','receptionist'));
end $$;

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

-- interns may read invoices and stock but not change them
drop policy if exists "Staff can CRUD invoices" on invoices;
drop policy if exists "Staff read invoices" on invoices;
drop policy if exists "Staff write invoices" on invoices;
create policy "Staff read invoices"  on invoices for select using (is_clinic_staff(clinic_id));
create policy "Staff write invoices" on invoices for all using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']))
                                                with check (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));
drop policy if exists "Staff can CRUD stock" on stock_items;
drop policy if exists "Staff read stock" on stock_items;
drop policy if exists "Staff write stock" on stock_items;
create policy "Staff read stock"  on stock_items for select using (is_clinic_staff(clinic_id));
create policy "Staff write stock" on stock_items for all using (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']))
                                              with check (is_clinic_role(clinic_id, array['admin','doctor','nurse','receptionist']));

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


-- ===== supabase/migrations/006_purchasing_attendance_leave.sql =====
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


-- ===== supabase/migrations/007_branding_and_domains.sql =====
-- 007: clinic branding (logo, colour, tagline), public web address (slug) and custom domain.
-- Safe to re-run.

alter table clinics add column if not exists slug              text;
alter table clinics add column if not exists custom_domain     text;
alter table clinics add column if not exists domain_verified   boolean not null default false;
alter table clinics add column if not exists domain_token      text;
alter table clinics add column if not exists domain_verified_at timestamptz;
alter table clinics add column if not exists primary_color     text;
alter table clinics add column if not exists tagline           text;
alter table clinics add column if not exists website           text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinics_primary_color_chk') then
    alter table clinics add constraint clinics_primary_color_chk check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinics_slug_chk') then
    alter table clinics add constraint clinics_slug_chk check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
  end if;
end $$;

-- One public address per clinic. A custom domain is exclusive only once it is verified,
-- so nobody can block the real owner of a domain by typing it in first.
create unique index if not exists clinics_slug_uidx on clinics (lower(slug)) where slug is not null;
create unique index if not exists clinics_domain_verified_uidx on clinics (lower(custom_domain)) where domain_verified and custom_domain is not null;
create index if not exists clinics_domain_idx on clinics (lower(custom_domain)) where custom_domain is not null;

create or replace function clinic_make_slug(p_name text, p_self uuid default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare base text; cand text; n int := 1;
begin
  base := lower(regexp_replace(coalesce(p_name, 'clinic'), '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  if length(base) < 3 then base := 'clinic'; end if;
  base := left(base, 30); base := trim(both '-' from base);
  if base in ('www','app','api','admin','login','signup','demo','c','setup','dashboard','static','mail','help','support','billing','settings') then base := base || '-clinic'; end if;
  cand := base;
  while exists (select 1 from clinics where lower(slug) = cand and (p_self is null or id <> p_self)) loop
    n := n + 1; cand := left(base, 30) || '-' || n;
    if n > 500 then cand := base || '-' || substr(md5(random()::text), 1, 6); exit; end if;
  end loop;
  return cand;
end $$;

create or replace function clinics_default_slug() returns trigger language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then new.slug := clinic_make_slug(coalesce(new.brand_name, new.name), new.id); end if;
  return new;
end $$;
drop trigger if exists clinics_default_slug_trg on clinics;
create trigger clinics_default_slug_trg before insert on clinics for each row execute function clinics_default_slug();

-- existing clinics get an address too
do $$ declare r record; begin
  for r in select id, coalesce(brand_name, name) as nm from clinics where slug is null loop
    update clinics set slug = clinic_make_slug(r.nm, r.id) where id = r.id;
  end loop;
end $$;

-- What a visitor (not signed in) may see about a clinic: found by slug, or by a VERIFIED custom domain.
create or replace function public_clinic(p_slug text, p_host text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinics%rowtype;
begin
  if coalesce(p_slug, '') <> '' then
    select * into c from clinics where lower(slug) = lower(p_slug) and coalesce(is_active, true);
  elsif coalesce(p_host, '') <> '' then
    select * into c from clinics where lower(custom_domain) = lower(p_host) and domain_verified and coalesce(is_active, true);
  end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'slug', c.slug, 'name', coalesce(c.brand_name, c.name), 'legal_name', c.name, 'tagline', c.tagline,
    'logo_url', c.logo_url, 'primary_color', c.primary_color, 'address', c.address, 'city', c.city,
    'phone', c.phone, 'email', c.email, 'website', c.website, 'specialty', c.specialty,
    'custom_domain', case when c.domain_verified then c.custom_domain end,
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'specialty', coalesce(d.specialty, d.speciality), 'experience_years', d.experience_years) order by d.name)
                           from doctors d where d.clinic_id = c.id and coalesce(d.is_active, true)), '[]'::jsonb));
end $$;

revoke all on function public_clinic(text, text) from public, anon, authenticated;
revoke all on function clinic_make_slug(text, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public_clinic(text, text) to service_role;
    grant execute on function clinic_make_slug(text, uuid) to service_role;
  end if;
end $$;


-- ===== supabase/migrations/008_builder_access_and_reports.sql =====
-- 008: AI Builder access control and reporting.
--   * Permission sets: named bundles of "who can read / create / edit / delete which table", assignable to staff.
--   * Record-level access: a set can limit someone to records they own (read_scope / edit_scope = 'own').
--   * Records engine for tables built with the AI Builder (list / save / delete), enforcing the above.
--   * Saved reports and dashboards over builder tables and the built-in appointments, invoices, patients and stock.
-- Safe to re-run. Requires 003 (builder) and 005 (is_clinic_role).

create table if not exists permission_sets (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 60),
  description text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (clinic_id, name),
  unique (id, clinic_id)
);

create table if not exists permission_set_objects (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null,
  set_id          uuid not null,
  object_api_name text not null,
  can_read        boolean not null default false,
  can_create      boolean not null default false,
  can_edit        boolean not null default false,
  can_delete      boolean not null default false,
  read_scope      text not null default 'all' check (read_scope in ('all','own')),
  edit_scope      text not null default 'own' check (edit_scope in ('all','own')),
  unique (set_id, object_api_name),
  foreign key (set_id, clinic_id) references permission_sets (id, clinic_id) on delete cascade
);

create table if not exists permission_set_users (
  set_id      uuid not null,
  clinic_id   uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid,
  created_at  timestamptz not null default now(),
  primary key (set_id, user_id),
  foreign key (set_id, clinic_id) references permission_sets (id, clinic_id) on delete cascade
);
create index if not exists permission_set_users_user_idx on permission_set_users (clinic_id, user_id);

create table if not exists saved_reports (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 80),
  description text,
  spec        jsonb not null,
  chart       text not null default 'table' check (chart in ('table','bar','pie','number')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, clinic_id)
);
create table if not exists saved_dashboards (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 2 and 80),
  description text,
  widgets     jsonb not null default '[]'::jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table permission_sets        enable row level security;
alter table permission_set_objects enable row level security;
alter table permission_set_users   enable row level security;
alter table saved_reports          enable row level security;
alter table saved_dashboards       enable row level security;

drop policy if exists "Admin read permission_sets" on permission_sets;
create policy "Admin read permission_sets" on permission_sets for select using (is_clinic_role(clinic_id, array['admin']));
drop policy if exists "Admin read permission_set_objects" on permission_set_objects;
create policy "Admin read permission_set_objects" on permission_set_objects for select using (is_clinic_role(clinic_id, array['admin']));
drop policy if exists "Own or admin read permission_set_users" on permission_set_users;
create policy "Own or admin read permission_set_users" on permission_set_users for select using (user_id = auth.uid() or is_clinic_role(clinic_id, array['admin']));
drop policy if exists "Staff read saved_reports" on saved_reports;
create policy "Staff read saved_reports" on saved_reports for select using (is_clinic_staff(clinic_id));
drop policy if exists "Staff read saved_dashboards" on saved_dashboards;
create policy "Staff read saved_dashboards" on saved_dashboards for select using (is_clinic_staff(clinic_id));

-- ─── Data sources ───────────────────────────────────────────
-- A source is either a builder table (tenant_data.*) or one of four built-in tables.
create or replace function builder_src(p_clinic uuid, p_object text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o builder_objects%rowtype; v_fields jsonb;
begin
  if p_object = 'appointments' then
    return jsonb_build_object('builtin', true, 'label', 'Appointments', 'table', 'public.appointments', 'fields', jsonb_build_array(
      jsonb_build_object('api','appointment_date','label','Date','type','date','expr','t.appointment_date'),
      jsonb_build_object('api','status','label','Status','type','text','expr','t.status'),
      jsonb_build_object('api','mode','label','Mode','type','text','expr','t.mode'),
      jsonb_build_object('api','source','label','Booked via','type','text','expr','t.source'),
      jsonb_build_object('api','doctor','label','Doctor','type','text','expr','(select d.name from doctors d where d.id = t.doctor_id)'),
      jsonb_build_object('api','patient','label','Patient','type','text','expr','(select p.name from clinic_patients p where p.id = t.clinic_patient_id)'),
      jsonb_build_object('api','consultation_fee','label','Fee','type','currency','expr','t.consultation_fee'),
      jsonb_build_object('api','created_at','label','Created','type','datetime','expr','t.created_at')));
  elsif p_object = 'invoices' then
    return jsonb_build_object('builtin', true, 'label', 'Invoices', 'table', 'public.invoices', 'fields', jsonb_build_array(
      jsonb_build_object('api','invoice_number','label','Invoice no.','type','text','expr','t.invoice_number'),
      jsonb_build_object('api','patient','label','Patient','type','text','expr','(select p.name from clinic_patients p where p.id = t.clinic_patient_id)'),
      jsonb_build_object('api','status','label','Status','type','text','expr','t.status'),
      jsonb_build_object('api','payment_method','label','Payment method','type','text','expr','t.payment_method'),
      jsonb_build_object('api','subtotal','label','Subtotal','type','currency','expr','t.subtotal'),
      jsonb_build_object('api','gst_amount','label','GST','type','currency','expr','t.gst_amount'),
      jsonb_build_object('api','total','label','Total','type','currency','expr','t.total'),
      jsonb_build_object('api','paid_amount','label','Paid','type','currency','expr','t.paid_amount'),
      jsonb_build_object('api','created_at','label','Date','type','datetime','expr','t.created_at')));
  elsif p_object = 'patients' then
    return jsonb_build_object('builtin', true, 'label', 'Patients', 'table', 'public.clinic_patients', 'fields', jsonb_build_array(
      jsonb_build_object('api','name','label','Name','type','text','expr','t.name'),
      jsonb_build_object('api','phone','label','Phone','type','text','expr','t.phone'),
      jsonb_build_object('api','gender','label','Gender','type','text','expr','t.gender'),
      jsonb_build_object('api','blood_group','label','Blood group','type','text','expr','t.blood_group'),
      jsonb_build_object('api','created_at','label','Registered','type','datetime','expr','t.created_at')));
  elsif p_object = 'stock' then
    return jsonb_build_object('builtin', true, 'label', 'Stock', 'table', 'public.stock_items', 'fields', jsonb_build_array(
      jsonb_build_object('api','name','label','Item','type','text','expr','t.name'),
      jsonb_build_object('api','category','label','Category','type','text','expr','t.category'),
      jsonb_build_object('api','quantity','label','Quantity','type','number','expr','t.quantity'),
      jsonb_build_object('api','min_quantity','label','Minimum','type','number','expr','t.min_quantity'),
      jsonb_build_object('api','unit_price','label','Unit price','type','currency','expr','t.unit_price'),
      jsonb_build_object('api','supplier','label','Supplier','type','text','expr','t.supplier'),
      jsonb_build_object('api','expiry_date','label','Expiry','type','date','expr','t.expiry_date'),
      jsonb_build_object('api','created_at','label','Added','type','datetime','expr','t.created_at')));
  end if;
  select * into o from builder_objects where clinic_id = p_clinic and api_name = p_object and status = 'active' and not is_system;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('api', f.api_name, 'label', f.label, 'type', f.data_type, 'expr', format('t.%I', f.column_name), 'required', f.required,
           'picklist_values', f.picklist_values,
           'lookup_object', (select lo.api_name from builder_objects lo where lo.id = f.lookup_object_id)) order by f.sort_order), '[]'::jsonb)
    into v_fields from builder_fields f where f.object_id = o.id and f.status = 'active';
  return jsonb_build_object('builtin', false, 'label', o.label, 'plural_label', o.plural_label, 'icon', o.icon, 'table', format('tenant_data.%I', o.table_name),
                            'table_name', o.table_name, 'name_field', o.name_field, 'fields', v_fields);
end $$;

-- ─── Access ──────────────────────────────────────────────────
create or replace function builder_access(p_clinic uuid, p_user uuid, p_object text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text; r record; v_base boolean := false;
begin
  select role into v_role from clinic_staff where clinic_id = p_clinic and user_id = p_user and coalesce(is_active, true);
  if v_role is null then return jsonb_build_object('read',false,'create',false,'edit',false,'delete',false,'read_scope','own','edit_scope','own'); end if;
  if v_role = 'admin' then return jsonb_build_object('read',true,'create',true,'edit',true,'delete',true,'read_scope','all','edit_scope','all'); end if;
  -- built-in tables: readable by sensible roles even without a permission set
  v_base := case p_object
    when 'appointments' then true
    when 'patients'     then true
    when 'invoices'     then v_role in ('doctor','nurse','receptionist')
    when 'stock'        then true
    else false end;
  select coalesce(bool_or(o.can_read), false) as c_read, coalesce(bool_or(o.can_create), false) as c_create,
         coalesce(bool_or(o.can_edit), false) as c_edit, coalesce(bool_or(o.can_delete), false) as c_delete,
         coalesce(bool_or(o.can_read and o.read_scope = 'all'), false) as read_all,
         coalesce(bool_or((o.can_edit or o.can_delete) and o.edit_scope = 'all'), false) as edit_all
    into r
    from permission_set_objects o join permission_set_users u on u.set_id = o.set_id and u.clinic_id = o.clinic_id
   where o.clinic_id = p_clinic and u.user_id = p_user and o.object_api_name = p_object;
  return jsonb_build_object('read', v_base or r.c_read, 'create', r.c_create, 'edit', r.c_edit, 'delete', r.c_delete,
                            'read_scope', case when v_base or r.read_all then 'all' else 'own' end,
                            'edit_scope', case when r.edit_all then 'all' else 'own' end);
end $$;

-- every table this person can open (used to fill pickers)
create or replace function builder_accessible(p_clinic uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare out jsonb := '[]'::jsonb; n text; a jsonb; s jsonb;
begin
  for n in select x from unnest(array['appointments','invoices','patients','stock']) x
           union all select api_name from builder_objects where clinic_id = p_clinic and status = 'active' and not is_system loop
    a := builder_access(p_clinic, p_user, n);
    if (a->>'read')::boolean or (a->>'create')::boolean then
      s := builder_src(p_clinic, n);
      out := out || jsonb_build_object('api_name', n, 'label', s->>'label', 'plural_label', coalesce(s->>'plural_label', s->>'label'), 'icon', s->>'icon', 'builtin', (s->>'builtin')::boolean,
                                        'access', a, 'fields', (select jsonb_agg(f - 'expr') from jsonb_array_elements(s->'fields') f));
    end if;
  end loop;
  return out;
end $$;

-- ─── Filters ─────────────────────────────────────────────────
create or replace function builder_where(p_src jsonb, p_filters jsonb, p_search text default null) returns text
language plpgsql stable set search_path = public, pg_temp as $$
declare w text := ''; fl jsonb; f jsonb; v_op text; v_val text; sym text; v_n int := 0;
begin
  if p_filters is not null and jsonb_typeof(p_filters) = 'array' then
    for fl in select * from jsonb_array_elements(p_filters) loop
      v_n := v_n + 1; if v_n > 10 then raise exception 'VALIDATION: use at most 10 filters'; end if;
      select x into f from jsonb_array_elements(p_src->'fields') x where x->>'api' = fl->>'field';
      if f is null then raise exception 'VALIDATION: unknown field "%" in a filter', coalesce(fl->>'field','(missing)'); end if;
      v_op := coalesce(fl->>'op', 'eq'); v_val := fl->>'value';
      if v_op = 'empty' then w := w || format(' and (%s is null or %s::text = '''')', f->>'expr', f->>'expr');
      elsif v_op = 'notempty' then w := w || format(' and (%s is not null and %s::text <> '''')', f->>'expr', f->>'expr');
      else
        if v_val is null or v_val = '' then raise exception 'VALIDATION: give a value for the "%" filter', f->>'label'; end if;
        if v_op = 'contains' then w := w || format(' and %s::text ilike %L', f->>'expr', '%' || replace(replace(v_val, '%', '\%'), '_', '\_') || '%');
        else
          sym := case v_op when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end;
          if sym is null then raise exception 'VALIDATION: unknown filter "%"', v_op; end if;
          w := w || format(' and %s %s %L::%s', f->>'expr', sym, v_val, builder_pg_type(f->>'type'));
        end if;
      end if;
    end loop;
  end if;
  if coalesce(p_search, '') <> '' and p_src->>'name_field' is not null then
    select x into f from jsonb_array_elements(p_src->'fields') x where x->>'api' = p_src->>'name_field';
    if f is not null then w := w || format(' and %s::text ilike %L', f->>'expr', '%' || replace(replace(p_search, '%', '\%'), '_', '\_') || '%'); end if;
  end if;
  return w;
end $$;

-- ─── Records ─────────────────────────────────────────────────
create or replace function builder_rec_list(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_actor uuid := (p->>'actor')::uuid; src jsonb; acc jsonb; w text; v_total bigint; v_rows jsonb;
        v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 200); v_off int := greatest(coalesce((p->>'offset')::int, 0), 0);
begin
  src := builder_src(v_clinic, p->>'object');
  if src is null or (src->>'builtin')::boolean then raise exception 'NOT_FOUND: that table does not exist'; end if;
  acc := builder_access(v_clinic, v_actor, p->>'object');
  if not (acc->>'read')::boolean then raise exception 'FORBIDDEN: you do not have access to %', src->>'label'; end if;
  w := builder_where(src, p->'filters', p->>'search');
  if acc->>'read_scope' <> 'all' then w := w || format(' and (t.owner_id = %L or t.created_by = %L)', v_actor, v_actor); end if;
  begin
    execute format('select count(*) from %s t where t.clinic_id = %L %s', src->>'table', v_clinic, w) into v_total;
    execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (select t.* from %s t where t.clinic_id = %L %s order by t.created_at desc limit %s offset %s) q',
                   src->>'table', v_clinic, w, v_limit, v_off) into v_rows;
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'VALIDATION: a filter value has the wrong format';
  end;
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'access', acc);
end $$;

create or replace function builder_rec_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_actor uuid := (p->>'actor')::uuid; o builder_objects%rowtype; acc jsonb;
        v_id uuid := nullif(p->>'id','')::uuid; vals jsonb := coalesce(p->'values', '{}'::jsonb); f builder_fields%rowtype; k text; v text; v_lit text;
        cols text[] := '{}'; exprs text[] := '{}'; sets text[] := '{}'; v_own boolean; v_new uuid;
begin
  select * into o from builder_objects where clinic_id = v_clinic and api_name = p->>'object' and status = 'active' and not is_system;
  if not found then raise exception 'NOT_FOUND: that table does not exist'; end if;
  if jsonb_typeof(vals) <> 'object' then raise exception 'VALIDATION: values must be an object'; end if;
  acc := builder_access(v_clinic, v_actor, o.api_name);
  for k in select jsonb_object_keys(vals) loop
    if not exists (select 1 from builder_fields where object_id = o.id and api_name = k and status = 'active') then raise exception 'VALIDATION: unknown field "%"', k; end if;
  end loop;
  if v_id is null then
    if not (acc->>'create')::boolean then raise exception 'FORBIDDEN: you cannot add % records', o.plural_label; end if;
  else
    if not (acc->>'edit')::boolean then raise exception 'FORBIDDEN: you cannot edit % records', o.plural_label; end if;
    execute format('select (owner_id = %L or created_by = %L) from tenant_data.%I where id = %L and clinic_id = %L', v_actor, v_actor, o.table_name, v_id, v_clinic) into v_own;
    if v_own is null then raise exception 'NOT_FOUND: that record no longer exists'; end if;
    if acc->>'edit_scope' <> 'all' and not v_own then raise exception 'FORBIDDEN: you can only edit records you own'; end if;
  end if;
  for f in select * from builder_fields where object_id = o.id and status = 'active' order by sort_order loop
    if vals ? f.api_name then
      v := vals->>f.api_name;
      if v is null or btrim(v) = '' then
        if f.required then raise exception 'VALIDATION: % is required', f.label; end if;
        v_lit := 'null';
      else
        if f.data_type = 'picklist' and not (coalesce(f.picklist_values, '[]'::jsonb) ? v) then raise exception 'VALIDATION: "%" is not an option for %', v, f.label; end if;
        v_lit := format('%L::%s', v, builder_pg_type(f.data_type));
      end if;
      cols := cols || quote_ident(f.column_name); exprs := exprs || v_lit; sets := sets || format('%I = %s', f.column_name, v_lit);
    elsif v_id is null and f.required then
      raise exception 'VALIDATION: % is required', f.label;
    end if;
  end loop;
  begin
    if v_id is null then
      execute format('insert into tenant_data.%I (clinic_id, owner_id, created_by%s) values (%L, %L, %L%s) returning id', o.table_name,
                     case when cardinality(cols) > 0 then ', ' || array_to_string(cols, ', ') else '' end, v_clinic, v_actor, v_actor,
                     case when cardinality(exprs) > 0 then ', ' || array_to_string(exprs, ', ') else '' end) into v_new;
    else
      if cardinality(sets) = 0 then raise exception 'VALIDATION: nothing to change'; end if;
      execute format('update tenant_data.%I set %s where id = %L and clinic_id = %L', o.table_name, array_to_string(sets, ', '), v_id, v_clinic);
      v_new := v_id;
    end if;
  exception
    when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format or invalid_parameter_value then
      raise exception 'VALIDATION: a value has the wrong format (check numbers and dates)';
    when unique_violation then raise exception 'ALREADY: a record with that value already exists';
    when foreign_key_violation then raise exception 'VALIDATION: the linked record does not exist';
    when not_null_violation then raise exception 'VALIDATION: a required value is missing';
  end;
  return jsonb_build_object('id', v_new);
end $$;

create or replace function builder_rec_delete(p_clinic uuid, p_actor uuid, p_object text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o builder_objects%rowtype; acc jsonb; v_own boolean;
begin
  select * into o from builder_objects where clinic_id = p_clinic and api_name = p_object and status = 'active' and not is_system;
  if not found then raise exception 'NOT_FOUND: that table does not exist'; end if;
  acc := builder_access(p_clinic, p_actor, p_object);
  if not (acc->>'delete')::boolean then raise exception 'FORBIDDEN: you cannot delete % records', o.plural_label; end if;
  execute format('select (owner_id = %L or created_by = %L) from tenant_data.%I where id = %L and clinic_id = %L', p_actor, p_actor, o.table_name, p_id, p_clinic) into v_own;
  if v_own is null then raise exception 'NOT_FOUND: that record no longer exists'; end if;
  if acc->>'edit_scope' <> 'all' and not v_own then raise exception 'FORBIDDEN: you can only delete records you own'; end if;
  execute format('delete from tenant_data.%I where id = %L and clinic_id = %L', o.table_name, p_id, p_clinic);
  return jsonb_build_object('deleted', true);
end $$;

-- ─── Reports ─────────────────────────────────────────────────
-- spec: { object, columns[], filters[], group_by, bucket ('day'|'month'), aggregate ('count'|'sum'|'avg'|'min'|'max'), agg_field, limit }
create or replace function builder_query(p_clinic uuid, p_actor uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare src jsonb; acc jsonb; w text; f jsonb; g jsonb; a jsonb; v_agg text := coalesce(nullif(p->>'aggregate',''), 'count'); v_gexpr text; v_vexpr text;
        v_cols jsonb := '[]'::jsonb; v_pairs text := ''; v_c text; v_rows jsonb; v_total bigint; v_limit int := least(greatest(coalesce((p->>'limit')::int, 100), 1), 500); v_ord text;
begin
  src := builder_src(p_clinic, p->>'object');
  if src is null then raise exception 'NOT_FOUND: that table does not exist'; end if;
  acc := builder_access(p_clinic, p_actor, p->>'object');
  if not (acc->>'read')::boolean then raise exception 'FORBIDDEN: you do not have access to %', src->>'label'; end if;
  w := builder_where(src, p->'filters', null);
  if not (src->>'builtin')::boolean and acc->>'read_scope' <> 'all' then w := w || format(' and (t.owner_id = %L or t.created_by = %L)', p_actor, p_actor); end if;
  if v_agg not in ('count','sum','avg','min','max') then raise exception 'VALIDATION: unknown calculation "%"', v_agg; end if;
  begin
    if coalesce(p->>'group_by','') <> '' or p->>'kind' = 'number' then
      if v_agg = 'count' then v_vexpr := 'count(*)::numeric';
      else
        select x into a from jsonb_array_elements(src->'fields') x where x->>'api' = p->>'agg_field';
        if a is null or a->>'type' not in ('number','currency') then raise exception 'VALIDATION: % needs a number or currency field', v_agg; end if;
        v_vexpr := format('%s((%s)::numeric)', v_agg, a->>'expr');
      end if;
    end if;
    if coalesce(p->>'group_by','') <> '' then
      select x into g from jsonb_array_elements(src->'fields') x where x->>'api' = p->>'group_by';
      if g is null then raise exception 'VALIDATION: unknown field "%" to group by', p->>'group_by'; end if;
      v_gexpr := case when g->>'type' in ('date','datetime') and p->>'bucket' = 'month' then format('to_char(%s, ''YYYY-MM'')', g->>'expr')
                      when g->>'type' in ('date','datetime') and p->>'bucket' = 'day' then format('to_char(%s, ''YYYY-MM-DD'')', g->>'expr')
                      else g->>'expr' end;
      v_ord := case when g->>'type' in ('date','datetime') then 'k asc' else 'v desc' end;
      execute format('select coalesce(jsonb_agg(jsonb_build_object(''key'', k, ''value'', v)), ''[]''::jsonb) from (select coalesce((%s)::text, ''(empty)'') k, %s v from %s t where t.clinic_id = %L %s group by 1 order by %s limit 60) q',
                     v_gexpr, v_vexpr, src->>'table', p_clinic, w, v_ord) into v_rows;
      return jsonb_build_object('kind', 'grouped', 'label', src->>'label', 'group_label', g->>'label', 'aggregate', v_agg, 'agg_label', coalesce(a->>'label', 'Count'), 'rows', v_rows);
    elsif p->>'kind' = 'number' then
      execute format('select jsonb_build_object(''value'', %s) from %s t where t.clinic_id = %L %s', v_vexpr, src->>'table', p_clinic, w) into v_rows;
      return jsonb_build_object('kind', 'number', 'label', src->>'label', 'aggregate', v_agg, 'agg_label', coalesce(a->>'label', 'Count'), 'value', v_rows->'value');
    end if;
    -- plain rows
    for v_c in select jsonb_array_elements_text(case when jsonb_typeof(p->'columns') = 'array' and jsonb_array_length(p->'columns') > 0 then p->'columns'
                                                      else (select jsonb_agg(x->>'api') from (select x from jsonb_array_elements(src->'fields') x limit 6) y) end) loop
      select x into f from jsonb_array_elements(src->'fields') x where x->>'api' = v_c;
      if f is null then raise exception 'VALIDATION: unknown column "%"', v_c; end if;
      v_cols := v_cols || jsonb_build_object('api', f->>'api', 'label', f->>'label', 'type', f->>'type');
      v_pairs := v_pairs || format(', %L, %s', f->>'api', f->>'expr');
    end loop;
    if jsonb_array_length(v_cols) > 20 then raise exception 'VALIDATION: choose at most 20 columns'; end if;
    execute format('select count(*) from %s t where t.clinic_id = %L %s', src->>'table', p_clinic, w) into v_total;
    execute format('select coalesce(jsonb_agg(r), ''[]''::jsonb) from (select jsonb_build_object(''id'', t.id%s) r from %s t where t.clinic_id = %L %s order by t.created_at desc limit %s) q',
                   v_pairs, src->>'table', p_clinic, w, v_limit) into v_rows;
    return jsonb_build_object('kind', 'rows', 'label', src->>'label', 'columns', v_cols, 'rows', v_rows, 'total', v_total);
  exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'VALIDATION: a filter value has the wrong format';
  end;
end $$;

-- ─── Lock down ───────────────────────────────────────────────
do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('builder_src','builder_access','builder_accessible','builder_where','builder_rec_list','builder_rec_save','builder_rec_delete','builder_query')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;


-- ===== supabase/migrations/009_ai_trust_layer.sql =====
-- 009: AI trust layer.
--   * ai_questionnaire: every question a clinic asks the AI, and its answer, stored in OUR database only
--     (per clinic, encrypted by the app when AI_DATA_KEY is set). It is the AI's only memory:
--     delete a row and the AI no longer knows it.
--   * Per-clinic AI policy in clinics.settings.ai: external AI is OFF unless an admin turns it on;
--     retention_days controls auto-deletion (0 = store nothing).
--   * ai_usage: tiny rate-limit ledger.
-- Safe to re-run. Requires 005 (is_clinic_role).

create table if not exists ai_questionnaire (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid not null,
  module      text not null check (module in ('assistant','builder')),
  question    text not null,
  answer      text,
  sent_text   text,                       -- exactly what left our system (after redaction), when anything did
  encrypted   boolean not null default false,
  intent      text,
  source      text not null default 'local' check (source in ('local','rules','external')),
  redactions  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ai_q_session_idx on ai_questionnaire (clinic_id, user_id, session_id, created_at);
create index if not exists ai_q_clinic_idx  on ai_questionnaire (clinic_id, created_at desc);

create table if not exists ai_usage (
  id         bigserial primary key,
  clinic_id  uuid not null references clinics(id) on delete cascade,
  user_id    uuid not null,
  at         timestamptz not null default now()
);
create index if not exists ai_usage_idx on ai_usage (clinic_id, user_id, at desc);

alter table ai_questionnaire enable row level security;
alter table ai_usage         enable row level security;

-- A person reads their own questions; the clinic admin can read the clinic's. Nobody can write directly.
drop policy if exists "Own or admin read ai_questionnaire" on ai_questionnaire;
create policy "Own or admin read ai_questionnaire" on ai_questionnaire for select
  using (user_id = auth.uid() or is_clinic_role(clinic_id, array['admin']));
revoke insert, update, delete on ai_questionnaire from anon, authenticated;
revoke all on ai_usage from anon, authenticated;

-- ─── Policy ──────────────────────────────────────────────────
create or replace function ai_policy(p_clinic uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'external_enabled', coalesce((c.settings->'ai'->>'external_enabled')::boolean, false),
    'retention_days',   coalesce((c.settings->'ai'->>'retention_days')::int, 30))
  from clinics c where c.id = p_clinic
$$;

create or replace function ai_set_policy(p_clinic uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_days int := coalesce((p->>'retention_days')::int, (ai_policy(p_clinic)->>'retention_days')::int);
        v_ext boolean := coalesce((p->>'external_enabled')::boolean, (ai_policy(p_clinic)->>'external_enabled')::boolean);
begin
  if v_days < 0 or v_days > 365 then raise exception 'VALIDATION: keep history for 0 to 365 days'; end if;
  update clinics set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ai}', jsonb_build_object('external_enabled', v_ext, 'retention_days', v_days), true) where id = p_clinic;
  if not found then raise exception 'NOT_FOUND: clinic not found'; end if;
  if v_days = 0 then delete from ai_questionnaire where clinic_id = p_clinic; end if;  -- "store nothing" also clears what is stored
  return ai_policy(p_clinic);
end $$;

-- ─── Write one Q&A (service role only) ───────────────────────
create or replace function ai_log(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_user uuid := (p->>'user_id')::uuid; v_id uuid;
begin
  if not exists (select 1 from clinic_staff where clinic_id = v_clinic and user_id = v_user and coalesce(is_active, true)) then
    raise exception 'NOT_ALLOWED: not a member of this clinic';
  end if;
  if (ai_policy(v_clinic)->>'retention_days')::int = 0 then return null; end if;     -- clinic chose to store nothing
  insert into ai_questionnaire (clinic_id, user_id, session_id, module, question, answer, sent_text, encrypted, intent, source, redactions)
  values (v_clinic, v_user, (p->>'session_id')::uuid, p->>'module', p->>'question', p->>'answer', p->>'sent_text',
          coalesce((p->>'encrypted')::boolean, false), p->>'intent', coalesce(p->>'source', 'local'), coalesce((p->>'redactions')::int, 0))
  returning id into v_id;
  return v_id;
end $$;

-- ─── Delete: from our database, which is the AI's only memory ──
-- scope: 'one' (id), 'session' (session_id), 'mine' (all of my own), 'all' (admin: the whole clinic)
create or replace function ai_delete(p_clinic uuid, p_actor uuid, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_n int; v_scope text := p->>'scope';
begin
  select role into v_role from clinic_staff where clinic_id = p_clinic and user_id = p_actor and coalesce(is_active, true);
  if v_role is null then raise exception 'NOT_ALLOWED: not a member of this clinic'; end if;
  if v_scope = 'all' then
    if v_role <> 'admin' then raise exception 'FORBIDDEN: only the admin can clear the whole clinic''s AI history'; end if;
    delete from ai_questionnaire where clinic_id = p_clinic;
  elsif v_scope = 'mine' then
    delete from ai_questionnaire where clinic_id = p_clinic and user_id = p_actor;
  elsif v_scope = 'session' then
    delete from ai_questionnaire where clinic_id = p_clinic and session_id = (p->>'session_id')::uuid and (user_id = p_actor or v_role = 'admin');
  elsif v_scope = 'one' then
    delete from ai_questionnaire where clinic_id = p_clinic and id = (p->>'id')::uuid and (user_id = p_actor or v_role = 'admin');
  else raise exception 'VALIDATION: unknown delete scope'; end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─── Rate limit ──────────────────────────────────────────────
create or replace function ai_rate_check(p_clinic uuid, p_user uuid, p_per_minute int default 20) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from ai_usage where clinic_id = p_clinic and user_id = p_user and at > now() - interval '1 minute') >= p_per_minute then
    raise exception 'RATE_LIMIT: too many AI requests, wait a minute';
  end if;
  insert into ai_usage (clinic_id, user_id) values (p_clinic, p_user);
end $$;

-- ─── Retention (run daily) ───────────────────────────────────
create or replace function ai_purge() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_q int; v_u int;
begin
  delete from ai_questionnaire q using clinics c
   where c.id = q.clinic_id and q.created_at < now() - make_interval(days => coalesce((c.settings->'ai'->>'retention_days')::int, 30));
  get diagnostics v_q = row_count;
  delete from ai_usage where at < now() - interval '1 day';
  get diagnostics v_u = row_count;
  return jsonb_build_object('questions_deleted', v_q, 'usage_deleted', v_u);
end $$;

do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ai_policy','ai_set_policy','ai_log','ai_delete','ai_rate_check','ai_purge')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;


-- ===== supabase/migrations/010_ai_name.sql =====
-- 010: the clinic names its AI assistant; the name shows on the assistant, the builder and the public page.
-- Safe to re-run.
alter table clinics add column if not exists ai_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinics_ai_name_chk') then
    alter table clinics add constraint clinics_ai_name_chk check (ai_name is null or ai_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,23}$');
  end if;
end $$;

create or replace function public_clinic(p_slug text, p_host text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinics%rowtype;
begin
  if coalesce(p_slug, '') <> '' then
    select * into c from clinics where lower(slug) = lower(p_slug) and coalesce(is_active, true);
  elsif coalesce(p_host, '') <> '' then
    select * into c from clinics where lower(custom_domain) = lower(p_host) and domain_verified and coalesce(is_active, true);
  end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'slug', c.slug, 'name', coalesce(c.brand_name, c.name), 'legal_name', c.name, 'tagline', c.tagline, 'ai_name', c.ai_name,
    'logo_url', c.logo_url, 'primary_color', c.primary_color, 'address', c.address, 'city', c.city,
    'phone', c.phone, 'email', c.email, 'website', c.website, 'specialty', c.specialty,
    'custom_domain', case when c.domain_verified then c.custom_domain end,
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'specialty', coalesce(d.specialty, d.speciality), 'experience_years', d.experience_years) order by d.name)
                           from doctors d where d.clinic_id = c.id and coalesce(d.is_active, true)), '[]'::jsonb));
end $$;
revoke all on function public_clinic(text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public_clinic(text, text) to service_role; end if;
end $$;


-- ===== supabase/migrations/011_users_section.sql =====
-- 011: "Users" section. Everyone in a clinic can see who belongs to it; ONLY an admin of that clinic can remove a user.
-- Removal is enforced in the database (not just the screen): service-role-only function, admin check, no self-removal,
-- never the last admin. History (attendance, leave, invoices, appointments) is kept; the person simply loses access.
-- Re-runnable.

create table if not exists user_removals (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  removed_user uuid not null,
  removed_name text,
  removed_role text,
  removed_by  uuid not null,
  removed_at  timestamptz not null default now()
);
create index if not exists user_removals_clinic_idx on user_removals(clinic_id, removed_at desc);
alter table user_removals enable row level security;
drop policy if exists "Admin read user_removals" on user_removals;
create policy "Admin read user_removals" on user_removals for select using (is_clinic_role(clinic_id, array['admin']));

create or replace function users_remove(p_clinic uuid, p_actor uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m clinic_staff; admins int;
begin
  if not exists (select 1 from clinic_staff where clinic_id = p_clinic and user_id = p_actor and role = 'admin' and coalesce(is_active, true))
    then raise exception 'FORBIDDEN: only a clinic admin can delete users'; end if;
  if p_actor = p_user then raise exception 'NOT_ALLOWED: you cannot delete your own account here'; end if;
  select * into m from clinic_staff where clinic_id = p_clinic and user_id = p_user for update;
  if not found then raise exception 'NOT_FOUND: that user is not part of this clinic'; end if;
  if m.role = 'admin' then
    select count(*) into admins from clinic_staff where clinic_id = p_clinic and role = 'admin' and coalesce(is_active, true);
    if admins <= 1 then raise exception 'NOT_ALLOWED: a clinic must keep at least one admin'; end if;
  end if;
  delete from clinic_staff where id = m.id;
  update doctors set user_id = null, is_active = false where clinic_id = p_clinic and user_id = p_user;
  insert into user_removals(clinic_id, removed_user, removed_name, removed_role, removed_by) values (p_clinic, p_user, m.name, m.role, p_actor);
  return jsonb_build_object('removed', p_user, 'role', m.role);
end $$;
revoke all on function users_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function users_remove(uuid, uuid, uuid) to service_role;


-- ===== supabase/migrations/012_dashboard_stats.sql =====
-- 012: owner dashboard numbers, computed live in one place so the screen and the demo describe the same maths.
--   appointments today   = confirmed + completed on the clinic's calendar day (cancelled / no-show excluded)
--   billed today         = invoices raised today (not cancelled); collected = what has been paid on them
--   outstanding          = unpaid balance on all open invoices (sent / partially paid), including treatment-sitting invoices
--   chair utilisation    = booked minutes / available minutes (working hours minus breaks, doctors on leave count zero)
--   no-show rate         = last 30 days: no_show / (completed + no_show)
--   trend                = invoices paid amount by day, last 7 days
-- Service-role only; the API checks the caller. Re-runnable.

create or replace function dashboard_stats(p_clinic uuid, p_actor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := appt_clinic_tz(p_clinic);
  d date := (now() at time zone appt_clinic_tz(p_clinic))::date;
  r jsonb;
begin
  with
  appts as (select * from appointments where clinic_id = p_clinic and appointment_date = d),
  booked as (select coalesce(sum(duration_minutes), 0) as m from appts where status in ('confirmed', 'completed')),
  avail as (
    select coalesce(sum(extract(epoch from (s.end_time - s.start_time)) / 60
                        - coalesce(extract(epoch from (s.break_end - s.break_start)) / 60, 0)), 0) as m
    from doctor_schedules s join doctors dr on dr.id = s.doctor_id and coalesce(dr.is_active, true)
    where s.clinic_id = p_clinic and s.is_active and s.weekday = extract(dow from d)::int
      and not exists (select 1 from doctor_leaves l where l.doctor_id = s.doctor_id and d between l.from_date and l.to_date)
  ),
  inv_today as (
    select coalesce(sum(total), 0) as billed, coalesce(sum(least(paid_amount, total)), 0) as collected
    from invoices where clinic_id = p_clinic and status <> 'cancelled' and (created_at at time zone tz)::date = d
  ),
  outst as (
    select coalesce(sum(total - paid_amount), 0) as amt, count(*) as n
    from invoices where clinic_id = p_clinic and status in ('sent', 'partially_paid') and total > paid_amount
  ),
  ns as (
    select count(*) filter (where status = 'no_show') as no_show, count(*) filter (where status in ('completed', 'no_show')) as seen
    from appointments where clinic_id = p_clinic and appointment_date between d - 30 and d
  ),
  days as (select generate_series(d - 6, d, interval '1 day')::date as day),
  trend as (
    select days.day, coalesce(sum(least(i.paid_amount, i.total)), 0) as collected
    from days left join invoices i on i.clinic_id = p_clinic and i.status <> 'cancelled' and (i.created_at at time zone tz)::date = days.day
    group by days.day order by days.day
  ),
  load as (
    select dr.name, count(a.id) filter (where a.status in ('confirmed', 'completed')) as appointments,
           coalesce(sum(a.duration_minutes) filter (where a.status in ('confirmed', 'completed')), 0) as minutes
    from doctors dr left join appts a on a.doctor_id = dr.id
    where dr.clinic_id = p_clinic and coalesce(dr.is_active, true) group by dr.id, dr.name order by dr.name
  ),
  stock as (
    select count(*) filter (where min_quantity is not null and quantity <= min_quantity) as low,
           coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'min', min_quantity) order by quantity)
                    filter (where min_quantity is not null and quantity <= min_quantity), '[]'::jsonb) as items
    from stock_items where clinic_id = p_clinic
  )
  select jsonb_build_object(
    'day', d,
    'appointments_today', (select count(*) from appts where status in ('confirmed', 'completed')),
    'completed_today', (select count(*) from appts where status = 'completed'),
    'total_patients', (select count(*) from clinic_patients where clinic_id = p_clinic),
    'billed_today', (select billed from inv_today),
    'collected_today', (select collected from inv_today),
    'collection_rate', (select case when billed > 0 then round(collected / billed * 100) end from inv_today),
    'outstanding', (select amt from outst), 'outstanding_invoices', (select n from outst),
    'utilisation_pct', (select case when (select m from avail) > 0 then least(100, round((select m from booked) / (select m from avail) * 100)) end),
    'booked_minutes', (select m from booked), 'available_minutes', (select m from avail),
    'no_show_pct', (select case when seen > 0 then round(no_show::numeric / seen * 100) end from ns),
    'no_shows_30d', (select no_show from ns),
    'trend', (select jsonb_agg(jsonb_build_object('day', day, 'collected', collected) order by day) from trend),
    'doctors', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'appointments', appointments, 'minutes', minutes) order by name), '[]'::jsonb) from load),
    'low_stock', (select low from stock), 'low_stock_items', (select items from stock)
  ) into r;
  return r;
end $$;
revoke all on function dashboard_stats(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function dashboard_stats(uuid, uuid) to service_role; end if;
end $$;


-- ===== supabase/migrations/013_agent_tools.sql =====
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


-- ===== supabase/migrations/014_app_manager.sql =====
-- 014: App Manager. Apps with tabs, who can see each app/tab, a home screen per app, and built-in apps
-- (Booking, Clinical, Inventory, Payments, Administration, Builder) that group the existing screens.
-- Visibility is a navigation layer: custom tables stay protected by permission sets, built-in screens by their own role checks.
-- Safe to run again.

alter table builder_apps add column if not exists is_system boolean not null default false;
alter table builder_apps add column if not exists sort_order int not null default 100;
alter table builder_apps add column if not exists visible_roles text[];
alter table builder_apps add column if not exists visible_sets uuid[];
alter table builder_apps add column if not exists home_dashboard_id uuid;
alter table builder_tabs add column if not exists path text;
alter table builder_tabs add column if not exists icon text;
alter table builder_tabs add column if not exists visible_roles text[];
alter table builder_tabs add column if not exists visible_sets uuid[];

create or replace function builder_get_schema(p_clinic uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'objects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'api_name', o.api_name, 'label', o.label, 'plural_label', o.plural_label, 'icon', o.icon,
        'is_system', o.is_system, 'status', o.status,
        'fields', coalesce((select jsonb_agg(jsonb_build_object(
            'api_name', f.api_name, 'label', f.label, 'data_type', f.data_type, 'required', f.required,
            'picklist_values', f.picklist_values,
            'lookup_object', (select api_name from builder_objects lo where lo.id = f.lookup_object_id))
            order by f.sort_order) from builder_fields f where f.object_id = o.id and f.status = 'active'), '[]'::jsonb))
        order by o.created_at) from builder_objects o where o.clinic_id = p_clinic and o.status = 'active'), '[]'::jsonb),
    'apps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'api_name', a.api_name, 'label', a.label, 'icon', a.icon,
        'tabs', coalesce((select jsonb_agg(jsonb_build_object('label', t.label, 'kind', t.kind,
            'object', (select tobj.api_name from builder_objects tobj where tobj.id = t.object_id)) order by t.sort_order)
            from builder_tabs t where t.app_id = a.id), '[]'::jsonb))
        order by a.created_at) from builder_apps a where a.clinic_id = p_clinic and a.status = 'active' and not coalesce(a.is_system, false)), '[]'::jsonb)
  );
$$;


-- ─── Built-in apps: created for each clinic the first time they are needed ─────────────────────
create or replace function apps_ensure_builtin(p_clinic uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare d record; t record; v_app uuid; v_i int;
begin
  for d in select * from (values
    ('sys_booking',  'Booking',        '📅', 10, 'Patients, appointments and the calendar'),
    ('sys_clinical', 'Clinical',       '🦷', 20, 'Treatment plans and clinical tasks'),
    ('sys_payments', 'Payments',       '🧾', 30, 'Invoices, pending payments and payment history'),
    ('sys_inventory','Inventory',      '💊', 40, 'Stock, purchase orders, distributors and supplier bills'),
    ('sys_admin',    'Administration', '🔐', 50, 'Users, staff, permissions, attendance, leave and settings'),
    ('sys_builder',  'Builder',        '🛠', 60, 'Build with AI, data, reports, access control and automation flows')
  ) as x(api, label, icon, ord, descr) loop
    select id into v_app from builder_apps where clinic_id = p_clinic and api_name = d.api;
    if v_app is null then
      insert into builder_apps (clinic_id, api_name, label, icon, description, is_system, sort_order)
      values (p_clinic, d.api, d.label, d.icon, d.descr, true, d.ord) returning id into v_app;
      v_i := 0;
      for t in select * from (values
        ('sys_booking','Home','/apps/sys_booking',null),('sys_booking','Patients','/patients',null),('sys_booking','Appointments','/appointments',null),('sys_booking','Calendar','/calendar',null),('sys_booking','Availability','/availability','{admin,doctor}'),('sys_booking','Recall','/recall','{admin,doctor,nurse,receptionist}'),
        ('sys_clinical','Home','/apps/sys_clinical',null),('sys_clinical','Treatments','/treatments','{admin,doctor,nurse,receptionist}'),('sys_clinical','Tasks','/tasks',null),
        ('sys_payments','Home','/apps/sys_payments',null),('sys_payments','Invoices','/billing',null),('sys_payments','Pending payments','/billing?filter=pending',null),('sys_payments','Payment history','/billing?filter=paid',null),
        ('sys_inventory','Home','/apps/sys_inventory',null),('sys_inventory','Stock','/stock',null),('sys_inventory','Purchase orders','/purchasing','{admin,nurse,receptionist}'),('sys_inventory','Distributors','/purchasing?tab=suppliers','{admin,nurse,receptionist}'),('sys_inventory','Supplier bills','/purchasing?tab=bills','{admin,nurse,receptionist}'),
        ('sys_admin','Home','/apps/sys_admin',null),('sys_admin','Users','/users',null),('sys_admin','Staff','/staff','{admin}'),('sys_admin','Permissions','/builder/access','{admin}'),('sys_admin','Attendance','/attendance',null),('sys_admin','Leave','/leave',null),('sys_admin','Settings','/settings','{admin}'),
        ('sys_builder','Build with AI','/builder','{admin}'),('sys_builder','Data','/builder/data',null),('sys_builder','Reports & dashboards','/builder/reports',null),('sys_builder','Automation flows','/builder/flows','{admin}')
      ) as y(app, label, path, roles) where y.app = d.api loop
        v_i := v_i + 1;
        insert into builder_tabs (clinic_id, app_id, kind, label, sort_order, path, visible_roles)
        values (p_clinic, v_app, 'page', t.label, v_i, t.path, t.roles::text[]);
      end loop;
    end if;
  end loop;
end $$;

-- is this person allowed to see something restricted to these roles / permission sets?  (admins see everything)
create or replace function app_visible(p_clinic uuid, p_user uuid, p_roles text[], p_sets uuid[]) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_role text;
begin
  select role into v_role from clinic_staff where clinic_id = p_clinic and user_id = p_user and coalesce(is_active, true) limit 1;
  if v_role is null then return false; end if;
  if v_role = 'admin' then return true; end if;
  if p_roles is null and p_sets is null then return true; end if;
  if p_roles is not null and v_role = any(p_roles) then return true; end if;
  if p_sets is not null and exists (select 1 from permission_set_users u where u.clinic_id = p_clinic and u.user_id = p_user and u.set_id = any(p_sets)) then return true; end if;
  return false;
end $$;

-- the apps and tabs this person can see, in order, with each app's home dashboard
create or replace function apps_for_user(p_clinic uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_acc jsonb; v_role text; v_out jsonb;
begin
  perform apps_ensure_builtin(p_clinic);
  select role into v_role from clinic_staff where clinic_id = p_clinic and user_id = p_user and coalesce(is_active, true) limit 1;
  if v_role is null then raise exception 'FORBIDDEN: you are not part of this clinic'; end if;
  v_acc := builder_accessible(p_clinic, p_user);
  select coalesce(jsonb_agg(app order by (app->>'sort_order')::int, app->>'label'), '[]'::jsonb) into v_out from (
    select jsonb_build_object('api_name', a.api_name, 'label', a.label, 'icon', a.icon, 'description', a.description, 'is_system', a.is_system, 'sort_order', a.sort_order,
      'home_dashboard_id', a.home_dashboard_id, 'visible_roles', a.visible_roles, 'visible_sets', a.visible_sets,
      'tabs', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'kind', t.kind, 'path', t.path,
          'object', o.api_name, 'visible_roles', t.visible_roles, 'visible_sets', t.visible_sets) order by t.sort_order)
        from builder_tabs t left join builder_objects o on o.id = t.object_id
        where t.app_id = a.id and app_visible(p_clinic, p_user, t.visible_roles, t.visible_sets)
          and (t.kind <> 'object' or v_role = 'admin' or exists (select 1 from jsonb_array_elements(v_acc) e where e->>'api_name' = o.api_name))), '[]'::jsonb)) as app
    from builder_apps a
    where a.clinic_id = p_clinic and a.status = 'active' and app_visible(p_clinic, p_user, a.visible_roles, a.visible_sets)
  ) q
  where jsonb_array_length(app->'tabs') > 0 or v_role = 'admin';
  return v_out;
end $$;

-- builder tool: who can see an app or one tab, and which dashboard is the app's home
create or replace function builder_configure_app_internal(p_clinic uuid, p_actor uuid, p_cs uuid, a jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_app builder_apps%rowtype; v_tab builder_tabs%rowtype; v_roles text[]; v_sets uuid[]; v_n text; v_id uuid; v_prev jsonb; v_dash uuid; v_set_roles boolean := false; v_set_sets boolean := false;
begin
  select * into v_app from builder_apps where clinic_id = p_clinic and api_name = a->>'app' and status = 'active';
  if not found then raise exception 'VALIDATION: app "%" not found', coalesce(a->>'app', '(missing)'); end if;
  if coalesce((a->>'everyone')::boolean, false) then v_set_roles := true; v_set_sets := true; v_roles := null; v_sets := null;
  else
    if a ? 'roles' and jsonb_typeof(a->'roles') = 'array' and jsonb_array_length(a->'roles') > 0 then
      v_roles := array(select jsonb_array_elements_text(a->'roles')); v_set_roles := true;
      if exists (select 1 from unnest(v_roles) r where r not in ('admin','doctor','nurse','receptionist','intern')) then raise exception 'VALIDATION: roles can be admin, doctor, nurse, receptionist or intern'; end if;
    end if;
    if a ? 'permission_sets' and jsonb_typeof(a->'permission_sets') = 'array' and jsonb_array_length(a->'permission_sets') > 0 then
      v_sets := array[]::uuid[];
      for v_n in select jsonb_array_elements_text(a->'permission_sets') loop
        select id into v_id from permission_sets where clinic_id = p_clinic and lower(name) = lower(v_n);
        if v_id is null then raise exception 'VALIDATION: permission set "%" does not exist', v_n; end if;
        v_sets := v_sets || v_id;
      end loop;
      v_set_sets := true;
    end if;
  end if;
  if a ? 'tab' and nullif(a->>'tab','') is not null then
    select * into v_tab from builder_tabs where app_id = v_app.id and lower(label) = lower(a->>'tab');
    if not found then raise exception 'VALIDATION: tab "%" not found in %', a->>'tab', v_app.label; end if;
    if not (v_set_roles or v_set_sets) then raise exception 'VALIDATION: say who can see the tab'; end if;
    v_prev := jsonb_build_object('roles', to_jsonb(v_tab.visible_roles), 'sets', to_jsonb(v_tab.visible_sets));
    update builder_tabs set visible_roles = case when v_set_roles then v_roles else visible_roles end, visible_sets = case when v_set_sets then v_sets else visible_sets end where id = v_tab.id;
    perform builder_log(p_clinic, p_cs, p_actor, 'configure_app', 'tab', v_tab.id, v_app.api_name || ':' || v_tab.label, jsonb_build_object('kind', 'tab', 'previous', v_prev));
    return;
  end if;
  if a ? 'home_dashboard' and nullif(a->>'home_dashboard','') is not null then
    select id into v_dash from saved_dashboards where clinic_id = p_clinic and lower(name) = lower(a->>'home_dashboard') order by created_at desc limit 1;
    if v_dash is null then raise exception 'VALIDATION: dashboard "%" does not exist', a->>'home_dashboard'; end if;
  end if;
  if not (v_set_roles or v_set_sets or v_dash is not null) then raise exception 'VALIDATION: nothing to change for the app'; end if;
  v_prev := jsonb_build_object('roles', to_jsonb(v_app.visible_roles), 'sets', to_jsonb(v_app.visible_sets), 'home', v_app.home_dashboard_id);
  update builder_apps set visible_roles = case when v_set_roles then v_roles else visible_roles end, visible_sets = case when v_set_sets then v_sets else visible_sets end, home_dashboard_id = coalesce(v_dash, home_dashboard_id) where id = v_app.id;
  perform builder_log(p_clinic, p_cs, p_actor, 'configure_app', 'app', v_app.id, v_app.api_name, jsonb_build_object('kind', 'app', 'previous', v_prev));
end $$;

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
      when 'configure_app' then
        perform builder_configure_app_internal(p_clinic, p_actor, v_cs, v_args);
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
    elsif r.action = 'configure_app' then
      if r.detail->>'kind' = 'tab' then update builder_tabs set visible_roles = case when r.detail->'previous'->'roles' = 'null'::jsonb then null else array(select jsonb_array_elements_text(r.detail->'previous'->'roles')) end, visible_sets = case when r.detail->'previous'->'sets' = 'null'::jsonb then null else array(select (jsonb_array_elements_text(r.detail->'previous'->'sets'))::uuid) end where id = r.target_id;
      else update builder_apps set visible_roles = case when r.detail->'previous'->'roles' = 'null'::jsonb then null else array(select jsonb_array_elements_text(r.detail->'previous'->'roles')) end, visible_sets = case when r.detail->'previous'->'sets' = 'null'::jsonb then null else array(select (jsonb_array_elements_text(r.detail->'previous'->'sets'))::uuid) end, home_dashboard_id = nullif(r.detail->'previous'->>'home','')::uuid where id = r.target_id; end if; v_removed := v_removed + 1;
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

do $$ declare fn text; begin
  foreach fn in array array['apps_ensure_builtin(uuid)','app_visible(uuid,uuid,text[],uuid[])','apps_for_user(uuid,uuid)','builder_configure_app_internal(uuid,uuid,uuid,jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;


-- ===== supabase/migrations/015_whatsapp_recall.sql =====
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


-- ===== supabase/migrations/016_online_booking.sql =====
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

