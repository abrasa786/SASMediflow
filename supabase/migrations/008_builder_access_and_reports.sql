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
