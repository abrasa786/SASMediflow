-- Local self-test for 006 (after 001, 004, 005, 006). Raises on any failure.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','a@x.in'),('00000000-0000-0000-0000-0000000000b1','b@x.in'),('00000000-0000-0000-0000-0000000000d1','d@x.in');
insert into clinics(id,name,specialty) values ('aaaaaaaa-0000-0000-0000-000000000001','Clinic A','Dentistry'),('bbbbbbbb-0000-0000-0000-000000000002','Clinic B','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','admin','A admin'),
 ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','doctor','Dr D'),
 ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','admin','B admin');
insert into doctors(id,clinic_id,user_id,name) values ('d0000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','Dr D');
insert into suppliers(id,clinic_id,name,payment_terms_days) values ('50000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','DentalCo',30),('50000000-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','OtherCo',0);
insert into stock_items(id,clinic_id,name,quantity,min_quantity) values ('51000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','Gloves',4,10);

do $$ declare r jsonb; r2 jsonb; po uuid; l1 uuid; l2 uuid; res jsonb; b uuid; begin
  -- another clinic's supplier is refused
  begin perform po_create(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','supplier_id','50000000-0000-0000-0000-00000000000b','items','[{"name":"x","qty":1,"unit_price":1}]'::jsonb)); raise exception 'FAIL';
  exception when others then if sqlerrm not like 'SUPPLIER_REQUIRED%' then raise; end if; end;
  r := po_create(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','supplier_id','50000000-0000-0000-0000-00000000000a','actor','00000000-0000-0000-0000-0000000000a1',
        'items', jsonb_build_array(jsonb_build_object('stock_item_id','51000000-0000-0000-0000-00000000000a','qty',100,'unit_price',10,'gst_percent',12), jsonb_build_object('name','Masks','qty',50,'unit_price',2,'gst_percent',5))));
  po := (r->>'po_id')::uuid;
  assert r->>'po_number' like 'PO-%-0001', 'po number';
  assert (r->>'subtotal')::numeric = 1100 and (r->>'gst')::numeric = 125 and (r->>'total')::numeric = 1225, format('totals %s', r);
  r2 := po_create(jsonb_build_object('clinic_id','bbbbbbbb-0000-0000-0000-000000000002','supplier_id','50000000-0000-0000-0000-00000000000b','items','[{"name":"y","qty":1,"unit_price":1}]'::jsonb));
  assert r2->>'po_number' like 'PO-%-0001', 'numbering is per clinic';
  select id into l1 from purchase_order_items where po_id = po and name = 'Gloves';
  select id into l2 from purchase_order_items where po_id = po and name = 'Masks';
  -- partial receive
  res := po_receive('aaaaaaaa-0000-0000-0000-000000000001', null, po, jsonb_build_array(jsonb_build_object('item_id',l1,'qty',60)), 'SUP-77', current_date, null);
  assert res->>'po_status' = 'partially_received', 'partial';
  assert (select quantity from stock_items where id='51000000-0000-0000-0000-00000000000a') = 64, 'stock went up by 60';
  assert (res->>'bill_amount')::numeric = 672, format('bill for 60x10 +12%% = 672, got %s', res->>'bill_amount');
  assert (select due_date from supplier_bills where id=(res->>'bill_id')::uuid) = current_date + 30, 'due date from supplier terms';
  begin perform po_receive('aaaaaaaa-0000-0000-0000-000000000001', null, po, jsonb_build_array(jsonb_build_object('item_id',l1,'qty',41)), null); raise exception 'FAIL over-receive';
  exception when others then if sqlerrm not like 'QTY_INVALID%' then raise; end if; end;
  res := po_receive('aaaaaaaa-0000-0000-0000-000000000001', null, po, jsonb_build_array(jsonb_build_object('item_id',l1,'qty',40),jsonb_build_object('item_id',l2,'qty',50)), null);
  assert res->>'po_status' = 'received', 'fully received';
  assert (select quantity from stock_items where name='Masks' and clinic_id='aaaaaaaa-0000-0000-0000-000000000001') = 50, 'new shelf item created from the PO';
  begin perform po_cancel('aaaaaaaa-0000-0000-0000-000000000001', po); raise exception 'FAIL cancel received';
  exception when others then if sqlerrm not like 'NOT_ALLOWED%' then raise; end if; end;
  -- pay the first bill in two parts
  select id into b from supplier_bills where bill_number = 'SUP-77';
  res := bill_pay('aaaaaaaa-0000-0000-0000-000000000001', null, b, 200, 'upi', 'ref1');
  assert (res->>'balance')::numeric = 472 and res->>'status' = 'partial', 'part payment';
  res := bill_pay('aaaaaaaa-0000-0000-0000-000000000001', null, b);
  assert res->>'status' = 'paid', 'paid in full';
  begin perform bill_pay('bbbbbbbb-0000-0000-0000-000000000002', null, b, 1); raise exception 'FAIL cross-clinic pay';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
end $$;

-- attendance
do $$ declare r jsonb; begin
  r := att_check_in('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1');
  begin perform att_check_in('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1'); raise exception 'FAIL double check-in';
  exception when others then if sqlerrm not like 'ALREADY%' then raise; end if; end;
  r := att_check_out('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1');
  begin perform att_check_in('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1'); raise exception 'FAIL outsider check-in';
  exception when others then if sqlerrm not like 'NOT_ALLOWED%' then raise; end if; end;
  perform att_correct(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','user_id','00000000-0000-0000-0000-0000000000a1','work_date',current_date - 1,'check_in','09:00','check_out','17:30'));
  assert (select count(*) from attendance where clinic_id='aaaaaaaa-0000-0000-0000-000000000001') = 2, 'two attendance rows';
end $$;

-- leave
do $$ declare r jsonb; id1 uuid; d date := current_date + 10; begin
  r := leave_request(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','user_id','00000000-0000-0000-0000-0000000000d1','leave_type','casual','from_date',d,'to_date',d+2));
  assert (r->>'days')::numeric = 3, 'three days';
  id1 := (r->>'leave_id')::uuid;
  begin perform leave_request(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','user_id','00000000-0000-0000-0000-0000000000d1','from_date',d+1,'to_date',d+3)); raise exception 'FAIL overlap';
  exception when others then if sqlerrm not like 'OVERLAP%' then raise; end if; end;
  begin perform leave_request(jsonb_build_object('clinic_id','aaaaaaaa-0000-0000-0000-000000000001','user_id','00000000-0000-0000-0000-0000000000d1','from_date',d+20,'to_date',d+40)); raise exception 'FAIL balance';
  exception when others then if sqlerrm not like 'BALANCE%' then raise; end if; end;
  begin perform leave_decide('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1',id1,'approved'); raise exception 'FAIL self-approve';
  exception when others then if sqlerrm not like 'NOT_ALLOWED%' then raise; end if; end;
  r := leave_decide('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',id1,'approved','ok');
  assert (r->>'blocks_bookings')::boolean, 'doctor leave created';
  assert exists (select 1 from doctor_leaves where doctor_id='d0000000-0000-0000-0000-00000000000a' and from_date=d), 'bookings blocked';
  assert appt_check_slot('aaaaaaaa-0000-0000-0000-000000000001','d0000000-0000-0000-0000-00000000000a', d+1, '10:00', 15) = 'on_leave', 'slot refused during approved leave';
  assert ((leave_balance('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1', extract(year from d)::int)->'casual')->>'left')::numeric = 9, 'balance 12 - 3';
  r := leave_decide('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1',id1,'cancelled');
  assert not exists (select 1 from doctor_leaves where doctor_id='d0000000-0000-0000-0000-00000000000a' and from_date=d), 'cancel frees the doctor';
end $$;

-- RLS
grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000d1',true);
do $$ begin
  assert (select count(*) from suppliers)=0, 'a doctor cannot see suppliers';
  assert (select count(*) from attendance where user_id <> '00000000-0000-0000-0000-0000000000d1')=0, 'a doctor sees only own attendance';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true);
do $$ begin
  assert (select count(*) from suppliers)=1 and (select name from suppliers)='DentalCo', 'admin A sees only A suppliers';
  assert (select count(*) from attendance)=2, 'admin sees all attendance of the clinic';
  assert (select count(*) from purchase_orders)=1, 'admin A sees only A orders';
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',true);
do $$ begin assert (select count(*) from suppliers)=1 and (select name from suppliers)='OtherCo', 'B sees only B'; assert (select count(*) from attendance)=0 and (select count(*) from supplier_bills)=0, 'B sees none of A'; end $$;
reset role;
select table_name, verdict from tenant_isolation_audit() where verdict <> 'ok';
rollback;
\echo ALL PURCHASING + ATTENDANCE + LEAVE TESTS PASSED
