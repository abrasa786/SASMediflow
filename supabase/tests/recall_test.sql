-- 015: who gets a recall nudge, who does not; phone matching for WhatsApp chat.
\set ON_ERROR_STOP on
begin;
insert into clinics(id,name,specialty) values ('eeeeeeee-0000-0000-0000-000000000001','Clinic R','Dentistry'),('ffffffff-0000-0000-0000-000000000002','Clinic S','Dentistry');
insert into doctors(id,clinic_id,name) values ('d1000000-0000-0000-0000-00000000000a','eeeeeeee-0000-0000-0000-000000000001','Dr R');
insert into clinic_patients(id,clinic_id,name,phone,wa_opt_out) values
 ('c1000000-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','Lapsed Lata','98450 11111',false),
 ('c1000000-0000-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000001','Recent Ravi','9845022222',false),
 ('c1000000-0000-0000-0000-000000000003','eeeeeeee-0000-0000-0000-000000000001','Pending Priya','9845033333',false),
 ('c1000000-0000-0000-0000-000000000004','eeeeeeee-0000-0000-0000-000000000001','Optout Om','9845044444',true),
 ('c1000000-0000-0000-0000-000000000005','eeeeeeee-0000-0000-0000-000000000001','Booked Bina','9845055555',false),
 ('c1000000-0000-0000-0000-000000000006','eeeeeeee-0000-0000-0000-000000000001','Nophone Nina',null,false),
 ('c2000000-0000-0000-0000-000000000001','ffffffff-0000-0000-0000-000000000002','Same Number','9845011111',false);
insert into appointments(clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time,status) values
 ('eeeeeeee-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000a',current_date-300,'10:00','completed'),
 ('eeeeeeee-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002','d1000000-0000-0000-0000-00000000000a',current_date-20,'10:00','completed'),
 ('eeeeeeee-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000004','d1000000-0000-0000-0000-00000000000a',current_date-400,'10:00','completed'),
 ('eeeeeeee-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-00000000000a',current_date-400,'10:00','completed'),
 ('eeeeeeee-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000005','d1000000-0000-0000-0000-00000000000a',current_date+3,'10:00','confirmed');
insert into treatment_plans(clinic_id,clinic_patient_id,doctor_id,title,total_amount,status) values
 ('eeeeeeee-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000003','d1000000-0000-0000-0000-00000000000a','Root canal',9000,'active');
do $$ declare c uuid := 'eeeeeeee-0000-0000-0000-000000000001'; r jsonb; begin
  r := recall_candidates(c);
  assert (select count(*) from jsonb_array_elements(r)) = 2, 'only the lapsed patient and the one with a pending treatment';
  assert exists (select 1 from jsonb_array_elements(r) x where x->>'name' = 'Lapsed Lata' and x->>'reason' = 'lapsed'), 'lapsed patient is listed';
  assert exists (select 1 from jsonb_array_elements(r) x where x->>'name' = 'Pending Priya' and x->>'reason' = 'treatment_pending' and x->>'detail' = 'Root canal'), 'pending treatment is listed';
  assert not exists (select 1 from jsonb_array_elements(r) x where x->>'name' in ('Recent Ravi','Optout Om','Booked Bina','Nophone Nina','Same Number')), 'recent, opted-out, already booked, no phone and other clinics are left out';
  -- the cool-down: after a nudge, the same person is not listed again
  insert into recall_log(clinic_id, patient_id, reason, status) values (c, 'c1000000-0000-0000-0000-000000000001', 'lapsed', 'sent');
  assert (select count(*) from jsonb_array_elements(recall_candidates(c))) = 1, 'nudged patient is left alone during the cool-down';
  assert (select count(*) from jsonb_array_elements(recall_candidates(c, 180, 0))) >= 1, 'cool-down can be shortened';
  -- phone matching: the same last 10 digits in two clinics, whatever the formatting
  assert (select count(*) from wa_find_patients('+91 98450 11111')) = 2, 'one phone, two clinics';
  assert (select count(*) from wa_find_patients('9845099999')) = 0, 'unknown phone';
  assert (select count(*) from wa_find_patients('12345')) = 0, 'too short to match';
end $$;
rollback;
\echo ALL RECALL TESTS PASSED
