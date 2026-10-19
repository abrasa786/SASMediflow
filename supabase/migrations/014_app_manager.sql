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
