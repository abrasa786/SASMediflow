-- Self-test for 032 (run after every migration). Raises on any failure and prints PASSED at the end.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000f1','f@x.in'),('00000000-0000-0000-0000-0000000000f2','g@x.in');
insert into clinics(id,name,specialty) values ('f1000000-0000-0000-0000-000000000001','Clinic F','Dentistry'),('f2000000-0000-0000-0000-000000000002','Clinic G','Dentistry');
insert into clinic_staff(clinic_id,user_id,role,name) values
 ('f1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','admin','F admin'),
 ('f2000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000f2','admin','G admin');
select clinic_provision('f1000000-0000-0000-0000-000000000001');
select clinic_provision('f2000000-0000-0000-0000-000000000002');
insert into doctors(id,clinic_id,name) values ('d1000000-0000-0000-0000-00000000000f','f1000000-0000-0000-0000-000000000001','Dr F');
insert into clinic_patients(id,clinic_id,name,phone) values ('c1000000-0000-0000-0000-00000000000f','f1000000-0000-0000-0000-000000000001','Abdul Rahim','9187983647'),
                                                           ('c2000000-0000-0000-0000-00000000000f','f2000000-0000-0000-0000-000000000002','Other Pat','9845012399');
update stock_items set quantity = 10 where clinic_id = 'f1000000-0000-0000-0000-000000000001' and name = 'Gloves';
insert into appointments(id,clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time) values
 ('a1000000-0000-0000-0000-00000000000f','f1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-00000000000f',current_date,'10:00'),
 ('a2000000-0000-0000-0000-00000000000f','f1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-00000000000f',current_date+1,'10:00'),
 ('a3000000-0000-0000-0000-00000000000f','f1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-00000000000f','d1000000-0000-0000-0000-00000000000f',current_date+2,'11:00');

do $$
declare C uuid := 'f1000000-0000-0000-0000-000000000001'; P uuid := 'c1000000-0000-0000-0000-00000000000f';
  r jsonb; plan uuid; s1 uuid; s2 uuid; res jsonb; inv uuid; gl int; tpl uuid;
begin
  -- an appointment is an enquiry/consultation until a sitting is attached
  assert (select visit_kind from appointments where id='a1000000-0000-0000-0000-00000000000f')='consultation', 'plain visit is a consultation';

  -- validation
  begin perform tx_add_sitting(jsonb_build_object('clinic_id',C,'patient_id',P,'title','Implant','label','','price',2000)); raise exception 'FAIL no name';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
  begin perform tx_add_sitting(jsonb_build_object('clinic_id',C,'patient_id',P,'title','Implant','label','x','price',-1)); raise exception 'FAIL negative';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
  begin perform tx_add_sitting(jsonb_build_object('clinic_id',C,'patient_id',P,'label','x','price',10)); raise exception 'FAIL no treatment name';
  exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;

  -- a 40,000 treatment, first sitting "Tooth removal" 2,000 on today's appointment, equipment: gloves x2
  r := tx_add_sitting(jsonb_build_object('clinic_id',C,'patient_id',P,'appointment_id','a1000000-0000-0000-0000-00000000000f','title','Dental implant','estimated_total',40000,
        'label','Tooth removal','price',2000,'materials',jsonb_build_array(jsonb_build_object('item','Gloves','qty',2))));
  plan := (r->>'plan_id')::uuid; s1 := (r->>'sitting_id')::uuid;
  assert (select clinic_patient_id from treatment_plans where id=plan)=P, 'treatment is linked to the patient';
  assert (select mode from treatment_plans where id=plan)='flexible', 'flexible treatment';
  assert (select total_amount from treatment_plans where id=plan)=40000, 'estimate kept';
  assert (select due_amount from treatment_sittings where id=s1)=2000, 'sitting costs 2000, not a share of 40000';
  assert (select visit_kind from appointments where id='a1000000-0000-0000-0000-00000000000f')='treatment', 'appointment became a treatment visit';
  assert (select treatment_plan_id from appointments where id='a1000000-0000-0000-0000-00000000000f')=plan, 'appointment points at the treatment';
  assert (select payment_status from treatment_plans where id=plan)='unpaid', 'unpaid at first';
  begin perform tx_add_sitting(jsonb_build_object('clinic_id',C,'plan_id',plan,'appointment_id','a1000000-0000-0000-0000-00000000000f','label','again','price',1)); raise exception 'FAIL one visit, two sittings';
  exception when others then if sqlerrm not like 'ALREADY%' then raise; end if; end;

  -- complete the sitting: invoice for 2000, equipment taken off the stock, treatment stays open (more sittings may follow)
  res := tx_complete_sitting(C, null, s1);
  inv := (res->>'invoice_id')::uuid;
  assert (select total from invoices where id=inv)=2000, 'invoice is for this sitting only';
  select quantity into gl from stock_items where clinic_id=C and name='Gloves'; assert gl=8, 'gloves 10 - 2 = 8';
  assert (select status from treatment_plans where id=plan)='active', 'treatment stays open after its first sitting is done';
  assert (select appointment_id from invoices where id=inv)='a1000000-0000-0000-0000-00000000000f', 'invoice is on the appointment';

  -- the price is edited on the invoice: the sitting follows
  update invoices set subtotal=2500, total=2500 where id=inv;
  assert (select due_amount from treatment_sittings where id=s1)=2500, 'invoice price edit changes the sitting';

  -- pay 1000 of it: part paid; then the rest on the invoice page (not through the treatment screen)
  res := tx_pay_sitting(C, null, s1, 1000, 'upi');
  assert (select payment_status from treatment_plans where id=plan)='part_paid', 'part paid';
  update invoices set paid_amount=2500, status='paid' where id=inv;
  assert (select paid_amount from treatment_sittings where id=s1)=2500, 'payment on the invoice reaches the sitting';
  assert (select payment_status from treatment_plans where id=plan)='part_paid', 'still part paid: 2,500 of a 40,000 estimate';
  assert (select status from treatment_plans where id=plan)='active', 'not closed';

  -- sitting 2 is added later, billed and paid; then the doctor finishes the treatment: fully paid and closed
  r := tx_add_sitting(jsonb_build_object('clinic_id',C,'plan_id',plan,'appointment_id','a2000000-0000-0000-0000-00000000000f','label','Implant placement','price',30000));
  s2 := (r->>'sitting_id')::uuid; assert (r->>'seq')::int = 2, 'second sitting';
  res := tx_complete_sitting(C, null, s2);
  res := tx_pay_sitting(C, null, s2, null, 'cash');
  assert (select payment_status from treatment_plans where id=plan)='part_paid', 'estimate 40000, paid 32500: still part paid';
  res := tx_finish_plan(C, plan, true);
  assert (res->>'status')='completed' and (res->>'payment_status')='paid', 'finished + everything paid = paid and closed';
  assert (select closed_at from treatment_plans where id=plan) is not null, 'closed time saved';

  -- more work reopens it
  r := tx_add_sitting(jsonb_build_object('clinic_id',C,'plan_id',plan,'appointment_id','a3000000-0000-0000-0000-00000000000f','label','Crown fitting','price',5000));
  assert (select status from treatment_plans where id=plan)='active' and (select payment_status from treatment_plans where id=plan)='part_paid', 'a new sitting reopens the treatment';

  -- finishing while something is unpaid waits for the payment, then closes by itself
  res := tx_finish_plan(C, plan, true);
  assert (res->>'status')='active', 'cannot close with an unpaid sitting';
  res := tx_complete_sitting(C, null, (r->>'sitting_id')::uuid);
  res := tx_pay_sitting(C, null, (r->>'sitting_id')::uuid, null, 'cash');
  assert (select status from treatment_plans where id=plan)='completed' and (select payment_status from treatment_plans where id=plan)='paid', 'closes by itself when the last payment arrives';

  -- a second treatment, left unpaid, beside the first (Abdul: two paid, one not)
  r := tx_add_sitting(jsonb_build_object('clinic_id',C,'patient_id',P,'title','Root canal','estimated_total',9000,'label','Consultation + X-ray','price',800));
  assert (select count(*) from treatment_plans where clinic_patient_id=P)=2, 'two treatments on the patient';
  assert (select payment_status from treatment_plans where id=(r->>'plan_id')::uuid)='unpaid', 'second treatment unpaid';

  -- update a pending sitting: name, equipment, price before billing; price locked once billed
  res := tx_update_sitting(jsonb_build_object('clinic_id',C,'sitting_id',r->>'sitting_id','label','Consultation','price',900,'materials',jsonb_build_array(jsonb_build_object('item','Gloves','qty',4))));
  assert (res->>'due_amount')::numeric=900 and res->>'label'='Consultation', 'pending sitting editable';
  res := tx_complete_sitting(C, null, (r->>'sitting_id')::uuid);
  begin perform tx_update_sitting(jsonb_build_object('clinic_id',C,'sitting_id',r->>'sitting_id','price',1)); raise exception 'FAIL done sitting edited';
  exception when others then if sqlerrm not like 'NOT_ALLOWED%' then raise; end if; end;

  -- another clinic can never touch this treatment
  begin perform tx_add_sitting(jsonb_build_object('clinic_id','f2000000-0000-0000-0000-000000000002','plan_id',plan,'label','x','price',1)); raise exception 'FAIL cross-clinic';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
  begin perform tx_finish_plan('f2000000-0000-0000-0000-000000000002', plan, true); raise exception 'FAIL cross-clinic finish';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;
  begin perform tx_add_sitting(jsonb_build_object('clinic_id',C,'patient_id','c2000000-0000-0000-0000-00000000000f','title','x','label','x','price',1)); raise exception 'FAIL cross-clinic patient';
  exception when others then if sqlerrm not like 'NOT_FOUND%' then raise; end if; end;

  -- the older "pick a template on the visit" path still works (this is what "Add to this visit" calls)
  select id into tpl from treatment_templates where clinic_id=C and name like 'Root canal%' limit 1;
  insert into appointments(id,clinic_id,clinic_patient_id,doctor_id,appointment_date,appointment_time) values ('a4000000-0000-0000-0000-00000000000f',C,P,'d1000000-0000-0000-0000-00000000000f',current_date+3,'12:00');
  res := visit_attach_treatment(jsonb_build_object('clinic_id',C,'actor',null,'appointment_id','a4000000-0000-0000-0000-00000000000f','template_id',tpl,'price',1600,
          'materials',jsonb_build_array(jsonb_build_object('item','Gloves','qty',2))));
  assert (res->>'seq')::int = 1 and (res->>'price')::numeric = 1600, 'template path: sitting 1 at the chosen price';
end $$;
rollback;
select 'PASSED';
