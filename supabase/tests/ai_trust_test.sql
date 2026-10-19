\set ON_ERROR_STOP 1
create or replace function pg_temp.fails(sql text, expect text) returns void language plpgsql as $$
begin execute sql; raise exception 'EXPECTED FAILURE (%)', expect;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  if position(expect in sqlerrm) = 0 then raise exception 'wanted "%", got "%"', expect, sqlerrm; end if;
end $$;

do $$
declare c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); a1 uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
        s1 uuid := gen_random_uuid(); id1 uuid; n int; r jsonb;
begin
  insert into auth.users(id) values (a1),(u1),(u2),(a2);
  insert into clinics(id,name) values (c1,'AI1'),(c2,'AI2');
  insert into clinic_staff(clinic_id,user_id,role) values (c1,a1,'admin'),(c1,u1,'nurse'),(c1,u2,'doctor'),(c2,a2,'admin');

  -- default policy: external AI OFF, 30 days
  r := ai_policy(c1);
  assert (r->>'external_enabled')::boolean = false and (r->>'retention_days')::int = 30, 'safe defaults: '||r::text;

  -- log and read back
  id1 := ai_log(jsonb_build_object('clinic_id',c1,'user_id',u1,'session_id',s1,'module','assistant','question','How many patients today?','answer','12','source','local'));
  assert id1 is not null;
  perform ai_log(jsonb_build_object('clinic_id',c1,'user_id',u2,'session_id',gen_random_uuid(),'module','assistant','question','revenue?','answer','Rs 5','source','local'));
  -- a non-member cannot be logged into a clinic (tenant check)
  perform pg_temp.fails(format($f$select ai_log('{"clinic_id":"%s","user_id":"%s","session_id":"%s","module":"assistant","question":"x"}'::jsonb)$f$, c2, u1, s1), 'NOT_ALLOWED');

  -- delete: own question vanishes; someone else's cannot be deleted by a non-admin
  assert ai_delete(c1, u1, jsonb_build_object('scope','one','id',id1)) = 1;
  assert (select count(*) from ai_questionnaire where id = id1) = 0, 'deleted means gone';
  assert ai_delete(c1, u1, jsonb_build_object('scope','mine')) = 0, 'u1 has nothing left, u2 untouched';
  assert (select count(*) from ai_questionnaire where clinic_id = c1) = 1;
  perform pg_temp.fails(format($f$select ai_delete('%s','%s','{"scope":"all"}'::jsonb)$f$, c1, u1), 'FORBIDDEN');
  -- another clinic's admin cannot touch this clinic
  perform pg_temp.fails(format($f$select ai_delete('%s','%s','{"scope":"all"}'::jsonb)$f$, c1, a2), 'NOT_ALLOWED');
  assert ai_delete(c1, a1, '{"scope":"all"}'::jsonb) = 1;
  assert (select count(*) from ai_questionnaire where clinic_id = c1) = 0;

  -- retention 0 = store nothing
  perform ai_set_policy(c1, '{"retention_days":0}'::jsonb);
  assert ai_log(jsonb_build_object('clinic_id',c1,'user_id',u1,'session_id',s1,'module','assistant','question','secret','answer','x')) is null, 'nothing stored at 0 days';
  assert (select count(*) from ai_questionnaire where clinic_id = c1) = 0;
  perform pg_temp.fails(format($f$select ai_set_policy('%s','{"retention_days":9999}'::jsonb)$f$, c1), 'VALIDATION');

  -- purge honours each clinic's own retention
  perform ai_set_policy(c1, '{"retention_days":7}'::jsonb);
  perform ai_set_policy(c2, '{"retention_days":90}'::jsonb);
  perform ai_log(jsonb_build_object('clinic_id',c1,'user_id',u1,'session_id',s1,'module','assistant','question','old1','answer','x'));
  perform ai_log(jsonb_build_object('clinic_id',c2,'user_id',a2,'session_id',s1,'module','assistant','question','old2','answer','x'));
  update ai_questionnaire set created_at = now() - interval '30 days' where clinic_id in (c1, c2);
  r := ai_purge();
  assert (select count(*) from ai_questionnaire where clinic_id = c1) = 0, 'c1 (7 days) purged';
  assert (select count(*) from ai_questionnaire where clinic_id = c2) = 1, 'c2 (90 days) kept';

  -- external AI toggle
  perform ai_set_policy(c1, '{"external_enabled":true}'::jsonb);
  assert (ai_policy(c1)->>'external_enabled')::boolean and (ai_policy(c2)->>'external_enabled')::boolean = false, 'policy is per clinic';

  -- rate limit
  for n in 1..3 loop perform ai_rate_check(c1, u1, 3); end loop;
  perform pg_temp.fails(format($f$select ai_rate_check('%s','%s',3)$f$, c1, u1), 'RATE_LIMIT');
  perform ai_rate_check(c1, u2, 3);

  -- deleting a clinic removes its AI history
  delete from clinics where id = c2;
  assert (select count(*) from ai_questionnaire where clinic_id = c2) = 0;
  raise notice 'ALL AI TRUST TESTS PASSED';
end $$;
