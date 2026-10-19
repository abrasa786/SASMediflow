-- 014: apps with tabs, who can see them, home dashboards, built-in apps; undo restores visibility.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000c1','a@g.in'),('00000000-0000-0000-0000-0000000000c2','n@g.in'),('00000000-0000-0000-0000-0000000000c3','r@g.in');
insert into clinics(id,name,specialty) values ('cccccccc-0000-0000-0000-000000000001','Clinic M','Dentistry'),('dddddddd-0000-0000-0000-000000000002','Clinic N','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values
 ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c1','admin','Admin'),
 ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','nurse','Nina'),
 ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c3','receptionist','Ravi');
do $$ declare c uuid := 'cccccccc-0000-0000-0000-000000000001'; a uuid := '00000000-0000-0000-0000-0000000000c1'; n uuid := '00000000-0000-0000-0000-0000000000c2'; rc uuid := '00000000-0000-0000-0000-0000000000c3';
  cs uuid; cs2 uuid; v jsonb; begin
  v := apps_for_user(c, a);
  assert (select count(*) from jsonb_array_elements(v) x where (x->>'is_system')::boolean) = 6, 'six built-in apps for the admin';
  assert apps_for_user(c, a) = v, 'built-in apps are created once';
  assert (select count(*) from builder_apps where clinic_id = 'dddddddd-0000-0000-0000-000000000002') = 0, 'other clinic untouched until it asks';
  -- the nurse does not get admin-only tabs
  v := apps_for_user(c, n);
  assert not exists (select 1 from jsonb_array_elements(v) x, jsonb_array_elements(x->'tabs') t where t->>'label' in ('Staff','Settings','Build with AI')), 'nurse never sees admin-only tabs';
  assert exists (select 1 from jsonb_array_elements(v) x, jsonb_array_elements(x->'tabs') t where t->>'label' = 'Distributors'), 'nurse sees distributors';
  -- a custom app with two tabs, visible only to nurses
  cs := builder_apply_plan(c, a, 'app', '{"steps":[
    {"tool":"create_object","args":{"api_name":"ward","label":"Ward","fields":[{"api_name":"floor","data_type":"number"}]}},
    {"tool":"create_app","args":{"api_name":"inpatient","label":"Inpatient","objects":["ward"]}},
    {"tool":"create_permission_set","args":{"name":"Ward staff","objects":[{"object":"ward","read":true,"create":true}],"assign_roles":["nurse"]}},
    {"tool":"configure_app","args":{"app":"inpatient","roles":["nurse"]}}]}'::jsonb);
  assert exists (select 1 from jsonb_array_elements(apps_for_user(c, n)) x where x->>'api_name' = 'inpatient'), 'nurse sees the app';
  assert not exists (select 1 from jsonb_array_elements(apps_for_user(c, rc)) x where x->>'api_name' = 'inpatient'), 'receptionist does not';
  assert exists (select 1 from jsonb_array_elements(apps_for_user(c, a)) x where x->>'api_name' = 'inpatient'), 'admin always sees it';
  assert not exists (select 1 from jsonb_array_elements(builder_get_schema(c)->'apps') x where x->>'api_name' like 'sys\_%'), 'built-in apps stay out of the builder schema';
  -- one tab only for admins
  cs2 := builder_apply_plan(c, a, 'tab', '{"steps":[{"tool":"configure_app","args":{"app":"inpatient","tab":"Wards","roles":["admin"]}}]}'::jsonb);
  assert not exists (select 1 from jsonb_array_elements(apps_for_user(c, n)) x where x->>'api_name' = 'inpatient' and jsonb_array_length(x->'tabs') > 0), 'tab hidden from nurse, so nothing left to show';
  perform builder_rollback(c, a, cs2);
  assert exists (select 1 from jsonb_array_elements(apps_for_user(c, n)) x, jsonb_array_elements(x->'tabs') t where x->>'api_name' = 'inpatient' and t->>'label' = 'Wards'), 'undo restores the tab';
  -- a home dashboard
  perform builder_apply_plan(c, a, 'home', '{"steps":[{"tool":"create_report","args":{"name":"Wards by floor","spec":{"object":"ward","group_by":"floor"}}},{"tool":"create_dashboard","args":{"name":"Inpatient home","reports":["Wards by floor"]}},{"tool":"configure_app","args":{"app":"inpatient","home_dashboard":"Inpatient home"}}]}'::jsonb);
  assert (select home_dashboard_id from builder_apps where clinic_id = c and api_name = 'inpatient') is not null, 'home dashboard set';
  -- bad input
  begin perform builder_apply_plan(c, a, 'x', '{"steps":[{"tool":"configure_app","args":{"app":"ghost","roles":["nurse"]}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
  begin perform builder_apply_plan(c, a, 'x', '{"steps":[{"tool":"configure_app","args":{"app":"inpatient","roles":["wizard"]}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
  -- undo of the whole app change restores "everyone"
  perform builder_rollback(c, a, cs);
  assert not exists (select 1 from builder_apps where clinic_id = c and api_name = 'inpatient'), 'app removed by undo';
  -- people outside the clinic get nothing
  begin perform apps_for_user('dddddddd-0000-0000-0000-000000000002', a); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
end $$;
rollback;
\echo ALL APP MANAGER TESTS PASSED
