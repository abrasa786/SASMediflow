-- 013: the agent can create reports, dashboards, permission sets and change the booking rule, atomically and undoably.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','a@g.in'),('00000000-0000-0000-0000-0000000000a2','n@g.in');
insert into clinics(id,name,specialty) values ('aaaaaaaa-0000-0000-0000-000000000001','Clinic G','Dentistry'),('bbbbbbbb-0000-0000-0000-000000000002','Clinic H','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','admin','Admin'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a2','nurse','Nina');
do $$ declare cs uuid; cs2 uuid; r jsonb; c text := 'aaaaaaaa-0000-0000-0000-000000000001'; a uuid := '00000000-0000-0000-0000-0000000000a1'; begin
  cs := builder_apply_plan(c::uuid, a, 'test', '{"steps":[
    {"tool":"create_object","args":{"api_name":"aligner","label":"Aligner","fields":[{"api_name":"stage","data_type":"picklist","picklist_values":["New","Fitted"]}]}},
    {"tool":"create_report","args":{"name":"Appointments by doctor","chart":"bar","spec":{"object":"appointments","group_by":"doctor","aggregate":"count"}}},
    {"tool":"create_report","args":{"name":"Unpaid invoices","chart":"number","spec":{"object":"invoices","kind":"number","aggregate":"sum","agg_field":"total","filters":[{"field":"status","op":"eq","value":"sent"}]}}},
    {"tool":"create_dashboard","args":{"name":"Daily ops","reports":["Appointments by doctor","unpaid invoices"]}},
    {"tool":"set_booking_rule","args":{"doctor_rule":"least_loaded","slot_minutes":20}},
    {"tool":"create_permission_set","args":{"name":"Nurses see aligners","objects":[{"object":"aligner","read":true,"create":true}],"assign_roles":["nurse"]}}
  ]}'::jsonb);
  assert (select count(*) from saved_reports where clinic_id = c::uuid) = 2, 'two reports';
  assert (select jsonb_array_length(widgets) from saved_dashboards where clinic_id = c::uuid and name = 'Daily ops') = 2, 'dashboard has both reports (name match ignores case)';
  assert (select settings->'booking'->>'doctor_rule' from clinics where id = c::uuid) = 'least_loaded' and (select (settings->'booking'->>'slot_minutes')::int from clinics where id = c::uuid) = 20, 'booking rule set';
  assert (select count(*) from permission_set_users where clinic_id = c::uuid and user_id = '00000000-0000-0000-0000-0000000000a2') = 1, 'nurse got the set';
  assert (select can_read and can_create and not can_delete from permission_set_objects where clinic_id = c::uuid), 'rights as asked';
  -- a broken step rolls the whole plan back
  begin perform builder_apply_plan(c::uuid, a, 'bad', '{"steps":[{"tool":"create_report","args":{"name":"Ok report","spec":{"object":"patients","group_by":"name"}}},{"tool":"create_report","args":{"name":"Bad","spec":{"object":"nope"}}}]}'::jsonb); raise exception 'FAIL bad plan applied';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;
  assert (select count(*) from saved_reports where clinic_id = c::uuid) = 2, 'failed plan left nothing behind';
  -- other clinic untouched
  assert (select count(*) from saved_reports where clinic_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0, 'other clinic untouched';
  -- unknown report in a dashboard / unknown person in a set
  begin perform builder_apply_plan(c::uuid, a, 'x', '{"steps":[{"tool":"create_dashboard","args":{"name":"Empty","reports":["ghost"]}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
  begin perform builder_apply_plan(c::uuid, a, 'x', '{"steps":[{"tool":"set_booking_rule","args":{"slot_minutes":3}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
  -- flows
  cs2 := builder_apply_plan(c::uuid, a, 'flow', '{"steps":[
    {"tool":"create_flow","args":{"name":"Remind the day before","trigger":{"event":"day_before_appointment"},"actions":[{"type":"send_whatsapp","to":"patient","template":"reminder"}]}},
    {"tool":"create_flow","args":{"name":"Chase unpaid","trigger":{"event":"invoice_paid"},"actions":[{"type":"create_task","title":"Thank {{patient}}"}]}}]}'::jsonb);
  assert (select count(*) from flows where clinic_id = c::uuid) = 2, 'two flows';
  begin perform builder_apply_plan(c::uuid, a, 'x', '{"steps":[{"tool":"create_flow","args":{"name":"remind the day before","trigger":{"event":"daily"},"actions":[{"type":"create_task","title":"x1"}]}}]}'::jsonb); raise exception 'FAIL dup';
  exception when others then if sqlerrm not like 'ALREADY%' then raise; end if; end;
  begin perform builder_apply_plan(c::uuid, a, 'x', '{"steps":[{"tool":"create_flow","args":{"name":"Bad action","trigger":{"event":"daily"},"actions":[{"type":"delete_everything"}]}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
  perform builder_apply_plan(c::uuid, a, 'pause', '{"steps":[{"tool":"set_flow_active","args":{"name":"Chase unpaid","active":false}}]}'::jsonb);
  assert (select not is_active from flows where name = 'Chase unpaid'), 'paused';
  r := builder_rollback(c::uuid, a, cs2);
  assert (select count(*) from flows where clinic_id = c::uuid) = 0, 'flows removed by undo';
  -- events are queued only when a flow wants them, from any path
  insert into clinic_patients(id,clinic_id,name,phone) values ('c0000000-0000-0000-0000-00000000000a', c::uuid, 'Pat', '9845012345');
  insert into doctors(id,clinic_id,name) values ('d0000000-0000-0000-0000-00000000000a', c::uuid, 'Dr A');
  insert into invoices(clinic_id,total,paid_amount,status) values (c::uuid, 100, 100, 'paid');
  assert (select count(*) from flow_events where clinic_id = c::uuid) = 0, 'no flow, no event';
  perform builder_apply_plan(c::uuid, a, 'f', '{"steps":[{"tool":"create_flow","args":{"name":"On paid","trigger":{"event":"invoice_paid"},"actions":[{"type":"create_task","title":"x1"}]}},
     {"tool":"create_flow","args":{"name":"On cancel","trigger":{"event":"appointment_cancelled"},"actions":[{"type":"create_task","title":"x2"}]}}]}'::jsonb);
  insert into invoices(id,clinic_id,total,paid_amount,status) values ('11111111-0000-0000-0000-000000000001', c::uuid, 100, 0, 'sent');
  update invoices set status = 'paid', paid_amount = 100 where id = '11111111-0000-0000-0000-000000000001';
  insert into appointments(id,clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time,start_time,status) values ('22222222-0000-0000-0000-000000000001', c::uuid,'c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-00000000000a',current_date+9,'10:00 AM','10:00','confirmed');
  assert (select count(*) from flow_events where event = 'appointment_booked') = 0, 'booked has no flow, so no event';
  update appointments set status = 'cancelled' where id = '22222222-0000-0000-0000-000000000001';
  assert (select count(*) from flow_events where clinic_id = c::uuid and event = 'invoice_paid') = 1, 'paid event queued once';
  assert (select count(*) from flow_events where clinic_id = c::uuid and event = 'appointment_cancelled') = 1, 'cancel event queued';
  assert (select count(*) from flow_claim(c::uuid, 10)) = 2, 'claim returns both';
  assert (select count(*) from flow_claim(c::uuid, 10)) = 0, 'claimed events are not handed out twice';
  assert (flow_invoice_details('11111111-0000-0000-0000-000000000001')->'patient') is not null, 'invoice details';
  delete from flows where clinic_id = c::uuid; delete from flow_events where clinic_id = c::uuid;
  -- the assistant may save reports for any member, but nothing else
  perform assistant_apply(c::uuid, '00000000-0000-0000-0000-0000000000a2', 'nurse report', '{"steps":[{"tool":"create_report","args":{"name":"My appts","spec":{"object":"appointments","group_by":"status"}}}]}'::jsonb);
  assert (select count(*) from saved_reports where clinic_id = c::uuid and created_by = '00000000-0000-0000-0000-0000000000a2') = 1, 'nurse saved a report';
  begin perform assistant_apply(c::uuid, '00000000-0000-0000-0000-0000000000a2', 'x', '{"steps":[{"tool":"create_object","args":{"api_name":"x"}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform assistant_apply(c::uuid, '00000000-0000-0000-0000-0000000000a9', 'x', '{"steps":[{"tool":"create_report","args":{"name":"Hack","spec":{"object":"appointments"}}}]}'::jsonb); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  delete from saved_reports where created_by = '00000000-0000-0000-0000-0000000000a2';
  -- undo restores everything
  r := builder_rollback(c::uuid, a, cs);
  assert (select count(*) from saved_reports where clinic_id = c::uuid) = 0 and (select count(*) from saved_dashboards where clinic_id = c::uuid) = 0, 'reports and dashboards removed';
  assert (select count(*) from permission_sets where clinic_id = c::uuid) = 0, 'permission set removed';
  assert coalesce(nullif((select settings->'booking'->>'doctor_rule' from clinics where id = c::uuid), ''), 'none') = 'none', 'booking rule restored';
end $$;
rollback;
\echo ALL AGENT TOOL TESTS PASSED
