-- 016: online booking. A slot is held while paying, confirmed once, never double-booked, and rate limited.
\set ON_ERROR_STOP on
begin;
insert into clinics(id,name,specialty,settings) values
 ('aaaaaaaa-1600-0000-0000-000000000001','Clinic O','Dentistry','{"online_booking":{"enabled":true,"fee":200,"hold_minutes":10,"advance_days":30}}'),
 ('bbbbbbbb-1600-0000-0000-000000000002','Clinic P','Dentistry','{}');
insert into doctors(id,clinic_id,name,consultation_fee) values
 ('d1600000-0000-0000-0000-00000000000a','aaaaaaaa-1600-0000-0000-000000000001','Dr O',500),
 ('d1600000-0000-0000-0000-00000000000b','bbbbbbbb-1600-0000-0000-000000000002','Dr P',300);
insert into doctor_schedules(clinic_id,doctor_id,weekday,start_time,end_time,slot_minutes)
 select 'aaaaaaaa-1600-0000-0000-000000000001','d1600000-0000-0000-0000-00000000000a', w, '09:00','17:00',30 from generate_series(0,6) w;
do $$ declare
  c uuid := 'aaaaaaaa-1600-0000-0000-000000000001'; d uuid := 'd1600000-0000-0000-0000-00000000000a';
  day date := current_date + 3; h jsonb; h2 jsonb; r jsonb; n int; ok boolean;
  pl jsonb := '{"name":"Asha Rao","phone":"98450 12345"}';
begin
  -- the slot is free before anyone holds it
  assert exists (select 1 from appt_slots(c, day, d) where s_time = '10:00 AM'), '10:00 is free to begin with';

  h := online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '10:00', 'patient', pl));
  assert (h->>'amount')::numeric = 200, 'confirmation fee comes from the clinic setting';
  assert (h->>'fee')::numeric = 500, 'consultation fee comes from the doctor';
  assert not exists (select 1 from appt_slots(c, day, d) where s_time = '10:00 AM'), 'a held slot disappears from the free list';

  -- someone else cannot hold or book the same slot
  begin perform online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '10:00', 'patient', '{"name":"Other One","phone":"9000000001"}'::jsonb)); ok := false;
  exception when others then ok := sqlerrm like 'SLOT_UNAVAILABLE%'; end;
  assert ok, 'second hold on the same slot is refused';
  begin perform appt_book(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '10:00', 'patient', '{"name":"Staff Pick","phone":"9000000002"}'::jsonb)); ok := false;
  exception when others then ok := sqlerrm like 'SLOT_UNAVAILABLE%'; end;
  assert ok, 'staff cannot book a held slot either';

  -- pay: the appointment, the patient, the invoice and the payment record all appear together
  r := online_confirm((h->>'hold_id')::uuid, 'order_T1', 'pay_T1');
  assert r#>>'{appointment,date}' = day::text and r#>>'{appointment,time}' = '10:00 AM', 'appointment is on the held slot';
  assert (select source from appointments where id = (r#>>'{appointment,id}')::uuid) = 'online', 'marked as an online booking';
  assert (select advance_paid from appointments where id = (r#>>'{appointment,id}')::uuid) = 200, 'advance recorded on the appointment';
  assert (select count(*) from clinic_patients where clinic_id = c and name = 'Asha Rao') = 1, 'patient record created';
  assert (select status from invoices where appointment_id = (r#>>'{appointment,id}')::uuid) = 'paid', 'paid invoice for the booking fee';
  assert (select amount from booking_payments where order_id = 'order_T1') = 200, 'payment logged';
  assert (select count(*) from booking_holds where clinic_id = c) = 0, 'hold released';

  -- the browser and the webhook may both confirm: the second call changes nothing
  r := online_confirm((h->>'hold_id')::uuid, 'order_T1', 'pay_T1');
  assert (r->>'already')::boolean, 'a repeat confirmation is recognised';
  assert (select count(*) from appointments where clinic_id = c) = 1, 'still one appointment';
  assert (select count(*) from invoices where clinic_id = c) = 1, 'still one invoice';

  -- an expired hold frees the slot again
  h2 := online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '11:00', 'patient', '{"name":"Late Lata","phone":"9111111111"}'::jsonb));
  update booking_holds set expires_at = now() - interval '1 minute' where id = (h2->>'hold_id')::uuid;
  assert exists (select 1 from appt_slots(c, day, d) where s_time = '11:00 AM'), 'expired hold no longer blocks the slot';

  -- paid after the hold expired AND someone took the slot: refuse so the server can refund
  perform appt_book(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '11:00', 'patient', '{"name":"Walk In","phone":"9222222222"}'::jsonb));
  begin perform online_confirm((h2->>'hold_id')::uuid, 'order_T2', 'pay_T2'); ok := false;
  exception when others then ok := sqlerrm like 'SLOT_LOST%'; end;
  assert ok, 'lost slot is reported';
  assert (select count(*) from appointments where clinic_id = c) = 2, 'no extra appointment was made';

  -- a fee of zero books straight away with no invoice
  update clinics set settings = '{"online_booking":{"enabled":true,"fee":0}}' where id = c;
  h := online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '12:00', 'patient', '{"name":"Free Fiona","phone":"9333333333"}'::jsonb));
  r := online_confirm((h->>'hold_id')::uuid, null, null);
  assert (select count(*) from invoices where clinic_id = c) = 1, 'no invoice when nothing was charged';

  -- rate limit: at most three open holds per phone
  for n in 1..3 loop
    perform online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', (array['13:00','13:30','14:00'])[n], 'patient', '{"name":"Spam Sam","phone":"9444444444"}'::jsonb));
  end loop;
  begin perform online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '14:30', 'patient', '{"name":"Spam Sam","phone":"9444444444"}'::jsonb)); ok := false;
  exception when others then ok := sqlerrm like 'TOO_MANY%'; end;
  assert ok, 'a fourth open hold for one phone is refused';

  -- guard rails
  begin perform online_hold(jsonb_build_object('clinic_id', 'bbbbbbbb-1600-0000-0000-000000000002', 'doctor_id', 'd1600000-0000-0000-0000-00000000000b', 'date', day, 'time', '10:00', 'patient', pl)); ok := false;
  exception when others then ok := sqlerrm like 'ONLINE_OFF%'; end;
  assert ok, 'a clinic that has not switched it on cannot be booked online';
  begin perform online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', 'd1600000-0000-0000-0000-00000000000b', 'date', day, 'time', '10:00', 'patient', pl)); ok := false;
  exception when others then ok := sqlerrm like 'DOCTOR_REQUIRED%'; end;
  assert ok, 'another clinic''s doctor cannot be used';
  begin perform online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', current_date + 90, 'time', '10:00', 'patient', pl)); ok := false;
  exception when others then ok := sqlerrm like 'TOO_FAR%'; end;
  assert ok, 'too far ahead is refused';
  begin perform online_hold(jsonb_build_object('clinic_id', c, 'doctor_id', d, 'date', day, 'time', '15:00', 'patient', '{"name":"No Phone","phone":"123"}'::jsonb)); ok := false;
  exception when others then ok := sqlerrm like 'PHONE_INVALID%'; end;
  assert ok, 'a bad phone number is refused';
end $$;
rollback;
\echo ALL ONLINE BOOKING TESTS PASSED
