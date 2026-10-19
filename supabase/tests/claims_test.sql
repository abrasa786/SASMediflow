-- 016: insurance claims desk — policies, the claim journey, papers, queries, deductions, isolation.
\set ON_ERROR_STOP on
begin;
insert into clinics(id,name,specialty) values ('aaaaaaaa-0000-0000-0000-0000000000c1','Clinic C','General'),('bbbbbbbb-0000-0000-0000-0000000000c2','Clinic D','General');
insert into clinic_patients(id,clinic_id,name,phone) values
 ('c1000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-0000000000c1','Ravi Kumar','9845000001'),
 ('c2000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-0000000000c2','Other Clinic Patient','9845000002');

do $$
declare c uuid := 'aaaaaaaa-0000-0000-0000-0000000000c1'; other uuid := 'bbbbbbbb-0000-0000-0000-0000000000c2';
        pat uuid := 'c1000000-0000-0000-0000-0000000000a1'; star uuid; tpa uuid; pol uuid; cl uuid; r jsonb; ok boolean; d uuid; s jsonb; ded uuid;
begin
  -- payers: names unique per clinic, case-insensitively
  star := (payer_save(jsonb_build_object('clinic_id', c, 'name', 'Star Health'))->>'id')::uuid;
  tpa  := (payer_save(jsonb_build_object('clinic_id', c, 'name', 'Medi Assist', 'kind', 'tpa'))->>'id')::uuid;
  begin perform payer_save(jsonb_build_object('clinic_id', c, 'name', 'star health')); ok := false; exception when others then ok := sqlerrm like 'ALREADY:%'; end;
  assert ok, 'duplicate insurer refused';
  perform payer_save(jsonb_build_object('clinic_id', other, 'name', 'Star Health'));   -- another clinic may use the same name

  -- policy: ABHA checked, patient must be this clinic's
  begin perform policy_save(jsonb_build_object('clinic_id', c, 'patient_id', pat, 'payer_id', star, 'policy_number', 'P1', 'abha_id', '1234')); ok := false; exception when others then ok := sqlerrm like 'ABHA_INVALID:%'; end;
  assert ok, 'short ABHA refused';
  begin perform policy_save(jsonb_build_object('clinic_id', c, 'patient_id', 'c2000000-0000-0000-0000-0000000000b1', 'payer_id', star, 'policy_number', 'P1')); ok := false; exception when others then ok := sqlerrm like 'PATIENT_NOT_FOUND:%'; end;
  assert ok, 'another clinic''s patient refused';
  pol := (policy_save(jsonb_build_object('clinic_id', c, 'patient_id', pat, 'payer_id', star, 'tpa_id', tpa, 'policy_number', 'SH-001', 'sum_insured', 500000, 'abha_id', '91-1234-5678-9012'))->>'id')::uuid;
  assert (policy_save(jsonb_build_object('clinic_id', c, 'patient_id', pat, 'payer_id', star, 'policy_number', 'SH-001', 'sum_insured', 300000))->>'id')::uuid = pol, 'same policy is updated, not duplicated';

  -- claim: numbered, routed to the TPA, with the standard checklist
  r := claim_create(jsonb_build_object('clinic_id', c, 'policy_id', pol, 'procedure', 'Appendectomy', 'estimated_amount', 60000, 'admission_date', current_date));
  cl := (r->>'claim_id')::uuid;
  assert r->>'claim_number' like 'CLM-%-0001', 'claim numbered per clinic';
  assert (select payer_id from claims where id = cl) = tpa, 'claim goes to the TPA when there is one';
  assert (select count(*) from claim_documents where claim_id = cl and stage = 'preauth' and required) = 6, 'pre-auth checklist created';

  -- cannot skip steps, cannot send with papers missing
  begin perform claim_advance(c, null, cl, 'settled'); ok := false; exception when others then ok := sqlerrm like 'NOT_ALLOWED:%'; end;
  assert ok, 'draft cannot jump to settled';
  begin perform claim_advance(c, null, cl, 'preauth_sent'); ok := false; exception when others then ok := sqlerrm like 'DOCS_MISSING:%Estimate of cost%'; end;
  assert ok, 'missing papers are named';
  for d in select id from claim_documents where claim_id = cl and stage = 'preauth' and required loop perform claim_doc_set(c, cl, jsonb_build_object('doc_id', d, 'received', true)); end loop;
  perform claim_advance(c, null, cl, 'preauth_sent', '{"insurer_ref":"PA-778"}');
  assert (select status = 'preauth_sent' and preauth_sent_at is not null and insurer_ref = 'PA-778' from claims where id = cl), 'pre-auth sent';

  -- query pauses, reply resumes at the same stage
  perform claim_query(c, null, cl, 'Send USG report');
  assert (select status = 'query' and query_from = 'preauth_sent' from claims where id = cl), 'query open';
  perform claim_reply(c, null, cl, 'USG report uploaded');
  assert (select status from claims where id = cl) = 'preauth_sent', 'back to pre-auth after reply';

  -- approve needs an amount
  begin perform claim_advance(c, null, cl, 'approved'); ok := false; exception when others then ok := sqlerrm like 'AMOUNT_REQUIRED:%'; end;
  assert ok, 'approval needs the amount';
  perform claim_advance(c, null, cl, 'approved', '{"approved_amount":55000}');

  -- discharge papers, then the final bill
  for d in select id from claim_documents where claim_id = cl and stage = 'discharge' and required loop perform claim_doc_set(c, cl, jsonb_build_object('doc_id', d)); end loop;
  perform claim_advance(c, null, cl, 'discharge_sent', '{"billed_amount":58000}');
  begin perform claim_advance(c, null, cl, 'settled', '{"settled_amount":59000}'); ok := false; exception when others then ok := sqlerrm like 'AMOUNT_INVALID:%'; end;
  assert ok, 'cannot be paid more than the bill';
  r := claim_advance(c, null, cl, 'settled', '{"settled_amount":51000}');
  assert (r->>'unexplained_gap')::numeric = 7000, 'gap between bill and payment reported';

  -- deductions and the money won back
  ded := (claim_deduction_save(c, null, cl, '{"category":"non_payable","reason":"Gloves and masks","amount":2000}')->>'deduction_id')::uuid;
  perform claim_deduction_save(c, null, cl, '{"category":"room_rent","reason":"Room above eligibility","amount":5000}');
  begin perform claim_deduction_save(c, null, cl, '{"reason":"too much","amount":60000}'); ok := false; exception when others then ok := sqlerrm like 'AMOUNT_INVALID:%'; end;
  assert ok, 'deductions cannot exceed the bill';
  perform claim_deduction_save(c, null, cl, jsonb_build_object('deduction_id', ded, 'outcome', 'recovered', 'recovered_amount', 1500));

  s := claims_summary(c);
  assert (s->>'settled')::numeric = 51000 and (s->>'billed')::numeric = 58000, 'summary money';
  assert (s->>'deducted')::numeric = 7000 and (s->>'recovered')::numeric = 1500 and (s->>'disputable')::numeric = 5000, 'summary deductions';
  assert (s->'by_payer'->0->>'payer') = 'Medi Assist' and (s->'by_payer'->0->>'avg_preauth_minutes') is not null, 'per payer view';
  assert (select count(*) from claim_events where claim_id = cl) >= 8, 'timeline recorded';

  -- closed claims stay closed
  begin perform claim_doc_set(c, cl, '{"name":"Late paper"}'); ok := false; exception when others then ok := sqlerrm like 'NOT_ALLOWED:%'; end;
  assert ok, 'no new papers on a settled claim';

  -- isolation: another clinic cannot touch this claim, links across clinics are refused
  begin perform claim_advance(other, null, cl, 'cancelled'); ok := false; exception when others then ok := sqlerrm like 'NOT_FOUND:%'; end;
  assert ok, 'other clinic cannot see the claim';
  begin insert into claim_events (clinic_id, claim_id, kind) values (other, cl, 'note'); ok := false; exception when others then ok := sqlerrm like 'TENANT_MISMATCH:%'; end;
  assert ok, 'cross-clinic link refused';
  assert (s->>'open')::int = 0, 'nothing open';
  assert (select count(*) from claims_summary(other) x) = 1 and (claims_summary(other)->>'open')::int = 0, 'other clinic sees nothing';
end $$;

-- the Claims tab is added to the Payments app
select apps_ensure_builtin('aaaaaaaa-0000-0000-0000-0000000000c1');
do $$ begin
  assert exists (select 1 from builder_tabs t join builder_apps a on a.id = t.app_id where a.clinic_id = 'aaaaaaaa-0000-0000-0000-0000000000c1' and a.api_name = 'sys_payments' and t.path = '/claims'), 'claims tab added';
end $$;
select table_name, verdict from tenant_isolation_audit() where verdict <> 'ok' and table_name like any (array['claim%','insurance%','patient_policies']);
rollback;
\echo ALL CLAIMS TESTS PASSED
