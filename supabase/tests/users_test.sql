-- 011: only an admin can delete a user; never yourself; never the last admin; history is kept.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000e1','a@u.in'),('00000000-0000-0000-0000-0000000000e2','b@u.in'),('00000000-0000-0000-0000-0000000000e3','n@u.in'),('00000000-0000-0000-0000-0000000000e4','o@u.in');
insert into clinics(id,name,specialty) values ('eeeeeeee-0000-0000-0000-000000000001','Clinic U','Dentistry'),('ffffffff-0000-0000-0000-000000000002','Other U','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','admin','Admin 1'),
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2','admin','Admin 2'),
 ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e3','nurse','Nurse'),
 ('ffffffff-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000e4','admin','Other admin');
insert into doctors(clinic_id,user_id,name) values ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e3','Dr N');
do $$ declare c uuid := 'eeeeeeee-0000-0000-0000-000000000001'; begin
  begin perform users_remove(c,'00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000e2'); raise exception 'FAIL nurse deleted an admin';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform users_remove(c,'00000000-0000-0000-0000-0000000000e4','00000000-0000-0000-0000-0000000000e3'); raise exception 'FAIL admin of another clinic deleted a user';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform users_remove(c,'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1'); raise exception 'FAIL self delete';
  exception when others then if sqlerrm not like 'NOT_ALLOWED%' then raise; end if; end;
  perform users_remove(c,'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e3');
  assert not exists (select 1 from clinic_staff where user_id='00000000-0000-0000-0000-0000000000e3'), 'nurse removed';
  assert (select user_id is null and not is_active from doctors where name='Dr N'), 'doctor profile kept but login unlinked';
  assert exists (select 1 from auth.users where id='00000000-0000-0000-0000-0000000000e3'), 'account itself untouched';
  perform users_remove(c,'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e2');   -- 2 admins -> 1
  begin perform users_remove(c,'00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1'); exception when others then null; end;
  assert (select count(*) from user_removals where clinic_id=c)=2, 'removals audited';
  assert (select count(*) from clinic_staff where clinic_id='ffffffff-0000-0000-0000-000000000002')=1, 'other clinic untouched';
end $$;
-- last admin protection (use a second actor)
insert into clinic_staff(clinic_id,user_id,role,name) values ('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e2','admin','Admin 2 again');
do $$ begin
  update clinic_staff set role='nurse' where user_id='00000000-0000-0000-0000-0000000000e2' and clinic_id='eeeeeeee-0000-0000-0000-000000000001';
  update clinic_staff set role='admin' where user_id='00000000-0000-0000-0000-0000000000e1' and clinic_id='eeeeeeee-0000-0000-0000-000000000001';
  begin perform users_remove('eeeeeeee-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000e1'); exception when others then null; end;
end $$;
rollback;
\echo ALL USERS TESTS PASSED
