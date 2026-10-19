\set ON_ERROR_STOP 1
create or replace function pg_temp.fails(sql text, expect text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'EXPECTED FAILURE (%) but it succeeded: %', expect, sql;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if position(expect in sqlerrm) = 0 then raise exception 'wanted "%", got "%" for %', expect, sqlerrm, sql; end if;
end $$;

do $$
declare c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  adm uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid(); itn uuid := gen_random_uuid(); adm2 uuid := gen_random_uuid();
  s_doc uuid; s_int uuid; r jsonb; r1 jsonb; r2 jsonb; cs uuid;
begin
  insert into auth.users(id) values (adm),(d1),(d2),(itn),(adm2);
  insert into clinics(id,name) values (c1,'C1'),(c2,'C2');
  insert into clinic_staff(clinic_id,user_id,role,name) values (c1,adm,'admin','A'),(c1,d1,'doctor','D1'),(c1,d2,'doctor','D2'),(c1,itn,'intern','I'),(c2,adm2,'admin','A2');
  cs := builder_apply_plan(c1, adm, 't', '{"summary":"x","steps":[{"tool":"create_object","args":{"api_name":"lab_test","fields":[
     {"api_name":"price","data_type":"currency"},{"api_name":"kind","data_type":"picklist","picklist_values":["blood","urine"]}]}}]}'::jsonb);

  -- nobody but the admin has access to a new table
  perform pg_temp.fails(format($f$select builder_rec_list('{"clinic_id":"%s","actor":"%s","object":"lab_test"}'::jsonb)$f$, c1, d1), 'FORBIDDEN');
  r := builder_rec_save(jsonb_build_object('clinic_id',c1,'actor',adm,'object','lab_test','values',jsonb_build_object('name','CBC','price','350','kind','blood')));
  assert r ? 'id';

  -- permission sets
  insert into permission_sets(clinic_id,name) values (c1,'Doctors') returning id into s_doc;
  insert into permission_set_objects(clinic_id,set_id,object_api_name,can_read,can_create,can_edit,read_scope,edit_scope) values (c1,s_doc,'lab_test',true,true,true,'all','own');
  insert into permission_set_users(clinic_id,set_id,user_id) values (c1,s_doc,d1),(c1,s_doc,d2);
  insert into permission_sets(clinic_id,name) values (c1,'Interns') returning id into s_int;
  insert into permission_set_objects(clinic_id,set_id,object_api_name,can_read,can_create,read_scope) values (c1,s_int,'lab_test',true,true,'own');
  insert into permission_set_users(clinic_id,set_id,user_id) values (c1,s_int,itn);

  r1 := builder_rec_list(jsonb_build_object('clinic_id',c1,'actor',d1,'object','lab_test'));
  assert (r1->>'total')::int = 1, 'doctor reads all records';
  -- record-level: doctor 1 and doctor 2 each create one
  r1 := builder_rec_save(jsonb_build_object('clinic_id',c1,'actor',d1,'object','lab_test','values',jsonb_build_object('name','LFT','price','500','kind','blood')));
  r2 := builder_rec_save(jsonb_build_object('clinic_id',c1,'actor',d2,'object','lab_test','values',jsonb_build_object('name','Urine R/M','price','120','kind','urine')));
  -- d1 may edit own but not d2's
  perform builder_rec_save(jsonb_build_object('clinic_id',c1,'actor',d1,'object','lab_test','id',r1->>'id','values',jsonb_build_object('price','550')));
  perform pg_temp.fails(format($f$select builder_rec_save('{"clinic_id":"%s","actor":"%s","object":"lab_test","id":"%s","values":{"price":"1"}}'::jsonb)$f$, c1, d1, r2->>'id'), 'only edit records you own');
  -- admin may edit anything
  perform builder_rec_save(jsonb_build_object('clinic_id',c1,'actor',adm,'object','lab_test','id',r2->>'id','values',jsonb_build_object('price','125')));
  -- delete needs can_delete
  perform pg_temp.fails(format($f$select builder_rec_delete('%s','%s','lab_test','%s')$f$, c1, d1, r1->>'id'), 'cannot delete');
  -- intern: create, then sees only own
  perform builder_rec_save(jsonb_build_object('clinic_id',c1,'actor',itn,'object','lab_test','values',jsonb_build_object('name','Intern entry','kind','urine')));
  r := builder_rec_list(jsonb_build_object('clinic_id',c1,'actor',itn,'object','lab_test'));
  assert (r->>'total')::int = 1, 'intern sees only own: '||(r->>'total');
  -- validation
  perform pg_temp.fails(format($f$select builder_rec_save('{"clinic_id":"%s","actor":"%s","object":"lab_test","values":{"price":"5"}}'::jsonb)$f$, c1, adm), 'Name is required');
  perform pg_temp.fails(format($f$select builder_rec_save('{"clinic_id":"%s","actor":"%s","object":"lab_test","values":{"name":"x","kind":"stool"}}'::jsonb)$f$, c1, adm), 'not an option');
  perform pg_temp.fails(format($f$select builder_rec_save('{"clinic_id":"%s","actor":"%s","object":"lab_test","values":{"name":"x","price":"abc"}}'::jsonb)$f$, c1, adm), 'wrong format');
  perform pg_temp.fails(format($f$select builder_rec_save('{"clinic_id":"%s","actor":"%s","object":"lab_test","values":{"name":"x","bogus":"1"}}'::jsonb)$f$, c1, adm), 'unknown field');
  -- tenant isolation: the other clinic cannot see or touch this table
  perform pg_temp.fails(format($f$select builder_rec_list('{"clinic_id":"%s","actor":"%s","object":"lab_test"}'::jsonb)$f$, c2, adm2), 'NOT_FOUND');
  perform pg_temp.fails(format($f$select builder_rec_list('{"clinic_id":"%s","actor":"%s","object":"lab_test"}'::jsonb)$f$, c1, adm2), 'FORBIDDEN');
  perform pg_temp.fails(format($f$select builder_rec_save('{"clinic_id":"%s","actor":"%s","object":"lab_test","id":"%s","values":{"price":"1"}}'::jsonb)$f$, c2, adm2, r1->>'id'), 'NOT_FOUND');

  -- reports: grouped, number, rows, filters
  r := builder_query(c1, adm, '{"object":"lab_test","group_by":"kind","aggregate":"sum","agg_field":"price"}'::jsonb);
  assert r->>'kind' = 'grouped' and jsonb_array_length(r->'rows') = 2, r::text;
  r := builder_query(c1, adm, '{"object":"lab_test","kind":"number","aggregate":"avg","agg_field":"price"}'::jsonb);
  assert (r->>'value') is not null, r::text;
  r := builder_query(c1, adm, '{"object":"lab_test","columns":["name","price"],"filters":[{"field":"price","op":"gte","value":"300"}]}'::jsonb);
  assert (r->>'total')::int = 2, 'filter gte 300: '||r::text;
  r := builder_query(c1, adm, '{"object":"lab_test","filters":[{"field":"name","op":"contains","value":"cb"}]}'::jsonb);
  assert (r->>'total')::int = 1, 'contains: '||r::text;
  -- intern report respects own-scope
  r := builder_query(c1, itn, '{"object":"lab_test"}'::jsonb);
  assert (r->>'total')::int = 1, 'intern report own-scope';
  perform pg_temp.fails(format($f$select builder_query('%s','%s','{"object":"lab_test","group_by":"price","aggregate":"sum","agg_field":"name"}'::jsonb)$f$, c1, adm), 'needs a number');
  perform pg_temp.fails(format($f$select builder_query('%s','%s','{"object":"lab_test","filters":[{"field":"x;drop","op":"eq","value":"1"}]}'::jsonb)$f$, c1, adm), 'unknown field');
  -- injection attempt through a value is just a literal
  r := builder_query(c1, adm, $q${"object":"lab_test","filters":[{"field":"name","op":"eq","value":"x'; drop table clinics; --"}]}$q$::jsonb);
  assert (r->>'total')::int = 0;

  -- built-in sources
  insert into appointments(clinic_id, appointment_date, appointment_time, status) values (c1, current_date, '10:00', 'completed'),(c1, current_date, '11:00', 'cancelled'),(c2, current_date, '10:00', 'completed');
  r := builder_query(c1, d1, '{"object":"appointments","group_by":"status"}'::jsonb);
  assert jsonb_array_length(r->'rows') = 2, 'builtin grouped (clinic-scoped): '||r::text;
  r := builder_query(c1, d1, '{"object":"appointments","group_by":"appointment_date","bucket":"month"}'::jsonb);
  assert (r->'rows'->0->>'value')::int = 2;
  perform pg_temp.fails(format($f$select builder_query('%s','%s','{"object":"invoices"}'::jsonb)$f$, c1, itn), 'FORBIDDEN');
  assert jsonb_array_length(builder_accessible(c1, itn)) >= 3;
  assert (select count(*) from jsonb_array_elements(builder_accessible(c1, adm2)) x where x->>'api_name' = 'lab_test') = 0, 'other clinic must not list lab_test';

  raise notice 'ALL BUILDER ACCESS + REPORT TESTS PASSED';
end $$;
