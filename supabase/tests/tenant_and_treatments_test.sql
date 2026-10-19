-- Local self-test for 005 (run on a scratch database after 001, 004, 005). Raises on any failure.
-- Needs auth.uid() to read request.jwt.claim.sub (true on Supabase).
\set ON_ERROR_STOP on
begin;
create temp table t(k text primary key, v text);
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','a@x.in'),('00000000-0000-0000-0000-0000000000b1','b@x.in');
insert into clinics(id,name,specialty) values ('aaaaaaaa-0000-0000-0000-000000000001','Clinic A','Dentistry'),('bbbbbbbb-0000-0000-0000-000000000002','Clinic B','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','admin','A admin'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','admin','B admin');
select clinic_provision('aaaaaaaa-0000-0000-0000-000000000001');
select clinic_provision('bbbbbbbb-0000-0000-0000-000000000002');
select clinic_provision('aaaaaaaa-0000-0000-0000-000000000001');  -- idempotent
do $$ begin
  assert (select count(*) from price_list where clinic_id='aaaaaaaa-0000-0000-0000-000000000001')=7, 'price list seeded once';
  assert (select count(*) from treatment_templates where clinic_id='aaaaaaaa-0000-0000-0000-000000000001')=2, 'templates seeded once';
  assert (select count(*) from clinic_patients)=0 and (select count(*) from appointments)=0, 'no patient data is seeded';
end $$;

insert into doctors(id,clinic_id,name) values ('d0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Dr A'),('d0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Dr B');
insert into clinic_patients(id,clinic_id,name,phone) values ('c0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Pat A','9845012345'),('c0000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','Pat B','9845012345');
update stock_items set quantity=10 where clinic_id='aaaaaaaa-0000-0000-0000-000000000001' and name='Gloves';

-- cross-clinic link is refused
do $$ begin
  begin insert into appointments(clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time) values ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000b',current_date+5,'10:00');
    raise exception 'FAIL cross-clinic doctor was accepted';
  exception when others then if sqlerrm not like 'TENANT_MISMATCH%' then raise; end if; end;
  begin insert into appointments(clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time) values ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000b','d0000000-0000-0000-0000-00000000000a',current_date+5,'10:00');
    raise exception 'FAIL cross-clinic patient was accepted';
  exception when others then if sqlerrm not like 'TENANT_MISMATCH%' then raise; end if; end;
end $$;

-- invoice numbers are per clinic
insert into invoices(clinic_id) values ('aaaaaaaa-0000-0000-0000-000000000001'),('aaaaaaaa-0000-0000-0000-000000000001'),('bbbbbbbb-0000-0000-0000-000000000002');
do $$ declare a text; b text; begin
  select string_agg(invoice_number,',' order by invoice_number) into a from invoices where clinic_id='aaaaaaaa-0000-0000-0000-000000000001';
  select string_agg(invoice_number,',') into b from invoices where clinic_id='bbbbbbbb-0000-0000-0000-000000000002';
  assert a like '%-0001,%-0002' and b like '%-0001', format('per-clinic numbering broken: A=%s B=%s', a, b);
end $$;

-- treatment plan: 3 sittings, sums, stock, payment
do $$ declare r jsonb; d date := current_date + 3; s1 uuid; res jsonb; n int; tpl uuid; begin
  while extract(dow from d) = 0 loop d := d + 1; end loop;
  select id into tpl from treatment_templates where clinic_id='aaaaaaaa-0000-0000-0000-000000000001' and name like 'Root canal%';
  r := tx_create_plan(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','patient_id','c0000000-0000-0000-0000-00000000000a',
        'doctor_id','d0000000-0000-0000-0000-00000000000a','template_id',tpl,'start_date',d,'time','10:00','discount',900));
  assert jsonb_array_length(r->'sittings')=3, 'three sittings';
  assert (select sum(due_amount) from treatment_sittings where plan_id=(r->>'plan_id')::uuid)=8100, 'dues add up to total - discount';
  assert (select count(*) from appointments where source='plan' and clinic_id='aaaaaaaa-0000-0000-0000-000000000001')=3, 'three appointments booked';
  select id into s1 from treatment_sittings where plan_id=(r->>'plan_id')::uuid and seq=1;
  begin perform tx_complete_sitting('aaaaaaaa-0000-0000-0000-000000000001',null,(select id from treatment_sittings where plan_id=(r->>'plan_id')::uuid and seq=2)); raise exception 'FAIL order not enforced';
  exception when others then if sqlerrm not like 'ORDER%' then raise; end if; end;
  res := tx_complete_sitting('aaaaaaaa-0000-0000-0000-000000000001',null,s1);
  assert (select quantity from stock_items where clinic_id='aaaaaaaa-0000-0000-0000-000000000001' and name='Gloves')=8, 'gloves deducted by 2';
  assert (select a.status from appointments a join treatment_sittings t on t.appointment_id=a.id where t.id=s1)='completed', 'appointment completed';
  assert (res->'next'->>'seq')::int=2, 'next sitting reported';
  res := tx_pay_sitting('aaaaaaaa-0000-0000-0000-000000000001',null,s1,1000,'upi');
  assert (res->>'plan_balance')::numeric = 8100-1000, 'part payment moves balance';
  res := tx_pay_sitting('aaaaaaaa-0000-0000-0000-000000000001',null,s1,null,'cash');
  assert (select i.status from invoices i join treatment_sittings t on t.invoice_id=i.id where t.id=s1)='paid', 'invoice paid';
  -- clinic B cannot touch clinic A's sitting
  begin perform tx_complete_sitting('bbbbbbbb-0000-0000-0000-000000000002',null,(select id from treatment_sittings where plan_id=(r->>'plan_id')::uuid and seq=2)); raise exception 'FAIL cross-clinic complete';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
end $$;

-- RLS as the signed-in users
grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
do $$ begin
  assert (select count(*) from clinic_patients)=1 and (select name from clinic_patients)='Pat A', 'A sees only own patients';
  assert (select count(*) from clinics)=1, 'A sees only own clinic';
  assert (select count(*) from treatment_plans)=1 and (select count(*) from price_list)=7, 'A sees only own plans/prices';
  assert (select count(*) from invoices)=3, 'A sees only own invoices';
  begin insert into clinic_patients(clinic_id,name) values ('bbbbbbbb-0000-0000-0000-000000000002','Intruder'); raise exception 'FAIL insert into other clinic';
  exception when insufficient_privilege or check_violation then null; when others then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
do $$ begin
  assert (select count(*) from clinic_patients)=1 and (select name from clinic_patients)='Pat B', 'B sees only own patients';
  assert (select count(*) from treatment_plans)=0, 'B sees no plans of A';
  assert (select count(*) from stock_items where name='Gloves')=0 or (select quantity from stock_items where name='Gloves')=0, 'B sees only own stock';
end $$;
reset role;
select table_name, verdict from tenant_isolation_audit() where verdict <> 'ok';
rollback;
\echo ALL TENANT + TREATMENT TESTS PASSED
