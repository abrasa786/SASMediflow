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
