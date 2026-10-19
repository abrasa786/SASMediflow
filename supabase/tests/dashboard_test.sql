-- 012: dashboard numbers are right, and clinic-scoped.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','a@d.in');
insert into clinics(id,name,specialty) values ('aaaaaaaa-0000-0000-0000-000000000001','Clinic D','Dentistry'),('bbbbbbbb-0000-0000-0000-000000000002','Clinic E','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','admin','Admin');
insert into doctors(id,clinic_id,name) values ('d0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Dr A'),('d0000000-0000-0000-0000-00000000000b','aaaaaaaa-0000-0000-0000-000000000001','Dr B');
insert into clinic_patients(id,clinic_id,name,phone) values ('c0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','P1','9845012345');
do $$ declare d date := (now() at time zone 'Asia/Kolkata')::date; s jsonb; w int := extract(dow from d)::int; begin
  -- Dr A works 09:00-17:00 with a 1h break = 420 min; Dr B has the same hours but is on leave today
  insert into doctor_schedules(clinic_id,doctor_id,weekday,start_time,end_time,break_start,break_end) values
    ('aaaaaaaa-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a',w,'09:00','17:00','13:00','14:00'),
    ('aaaaaaaa-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000b',w,'09:00','17:00','13:00','14:00');
  insert into doctor_leaves(clinic_id,doctor_id,from_date,to_date) values ('aaaaaaaa-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000b',d,d);
  -- 2 booked x 42 min = 84 min of 420 = 20%
  insert into appointments(clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time,start_time,duration_minutes,status) values
    ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000a',d,'9:00 AM','09:00',42,'confirmed'),
    ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000a',d,'10:00 AM','10:00',42,'completed'),
    ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000a',d,'11:00 AM','11:00',30,'cancelled'),
    ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000a',d-3,'11:00 AM','11:00',30,'no_show'),
    ('aaaaaaaa-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000a',d-2,'11:00 AM','11:00',30,'completed');
  insert into invoices(clinic_id,total,paid_amount,status) values
    ('aaaaaaaa-0000-0000-0000-000000000001',1000,1000,'paid'),
    ('aaaaaaaa-0000-0000-0000-000000000001',3000,500,'partially_paid'),
    ('aaaaaaaa-0000-0000-0000-000000000001',700,0,'cancelled'),
    ('bbbbbbbb-0000-0000-0000-000000000002',9999,0,'sent');
  insert into stock_items(clinic_id,name,quantity,min_quantity) values ('aaaaaaaa-0000-0000-0000-000000000001','Gloves',2,10),('aaaaaaaa-0000-0000-0000-000000000001','Masks',50,10);
  s := dashboard_stats('aaaaaaaa-0000-0000-0000-000000000001');
  assert (s->>'appointments_today')::int = 2, format('appointments today (cancelled excluded) %s', s);
  assert (s->>'completed_today')::int = 1, 'completed';
  assert (s->>'billed_today')::numeric = 4000 and (s->>'collected_today')::numeric = 1500, format('billed/collected %s', s);
  assert (s->>'collection_rate')::int = 38, 'collection rate 1500/4000 rounds to 38';
  assert (s->>'outstanding')::numeric = 2500 and (s->>'outstanding_invoices')::int = 1, 'outstanding only counts the open invoice, not other clinics';
  assert (s->>'utilisation_pct')::int = 20, format('utilisation %s', s);
  assert (s->>'no_show_pct')::int = 33, 'no-show rate = 1 no-show of 3 seen (2 completed + 1 no-show)';
end $$;
rollback;
\echo ALL DASHBOARD TESTS PASSED
