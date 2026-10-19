-- ============================================================
-- Mediflow — Insurance & Claims (cashless claims desk)
-- Run AFTER 015_whatsapp_recall.sql. Safe to re-run.
--
--  Payers     : insurers, TPAs and government schemes the clinic works with
--  Policies   : a patient's policy (insurer, TPA, policy no., sum insured, ABHA)
--  Claims     : CLM-YYYY-NNNN per clinic, moving through
--               draft → preauth_sent → approved → discharge_sent → settled
--               (query / rejected / cancelled on the way)
--  Checklist  : the papers each stage needs; a stage cannot be sent with a required paper missing
--  Timeline   : every status change, insurer query, reply and note
--  Deductions : money the insurer did not pay, with the reason and whether it was won back
-- IRDAI timelines are tracked: 1 hour for a cashless pre-authorisation decision,
-- 3 hours for the final discharge authorisation.
-- All writes go through server-only functions; staff can read what their role allows.
-- ============================================================

-- ─── tables ──────────────────────────────────────────────────
create table if not exists insurance_payers (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  name        text not null,
  kind        text not null default 'insurer' check (kind in ('insurer','tpa','government','corporate')),
  portal_url  text,
  phone       text,
  email       text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (clinic_id, name)
);

create table if not exists patient_policies (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  patient_id    uuid not null references clinic_patients(id) on delete cascade,
  payer_id      uuid not null references insurance_payers(id),
  tpa_id        uuid references insurance_payers(id),
  policy_number text not null,
  member_id     text,
  holder_name   text,
  sum_insured   numeric(12,2) check (sum_insured is null or sum_insured >= 0),
  valid_from    date,
  valid_to      date,
  abha_id       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index if not exists patient_policies_idx on patient_policies (clinic_id, patient_id);

create table if not exists claims (
  id                   uuid primary key default gen_random_uuid(),
  clinic_id            uuid not null references clinics(id) on delete cascade,
  claim_number         text not null,
  patient_id           uuid not null references clinic_patients(id),
  policy_id            uuid not null references patient_policies(id),
  payer_id             uuid not null references insurance_payers(id),
  invoice_id           uuid references invoices(id) on delete set null,
  insurer_ref          text,                                   -- the insurer's / TPA's own claim or pre-auth number
  procedure            text not null,
  admission_date       date,
  discharge_date       date,
  status               text not null default 'draft'
                         check (status in ('draft','preauth_sent','query','approved','discharge_sent','settled','rejected','cancelled')),
  query_from           text check (query_from in ('preauth_sent','discharge_sent')),  -- the stage a query came from
  estimated_amount     numeric(12,2) not null default 0 check (estimated_amount >= 0),
  approved_amount      numeric(12,2) check (approved_amount is null or approved_amount >= 0),
  billed_amount        numeric(12,2) check (billed_amount is null or billed_amount >= 0),
  settled_amount       numeric(12,2) check (settled_amount is null or settled_amount >= 0),
  preauth_sent_at      timestamptz,
  preauth_decided_at   timestamptz,
  discharge_sent_at    timestamptz,
  discharge_decided_at timestamptz,
  settled_at           timestamptz,
  notes                text,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (clinic_id, claim_number),
  check (discharge_date is null or admission_date is null or discharge_date >= admission_date)
);
create index if not exists claims_idx on claims (clinic_id, status, created_at desc);
create index if not exists claims_patient_idx on claims (clinic_id, patient_id);

create table if not exists claim_documents (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  claim_id    uuid not null references claims(id) on delete cascade,
  stage       text not null check (stage in ('preauth','discharge')),
  name        text not null,
  required    boolean not null default true,
  received    boolean not null default false,
  received_at timestamptz,
  note        text,
  sort_order  int not null default 0,
  unique (claim_id, stage, name)
);
create index if not exists claim_documents_idx on claim_documents (claim_id, stage, sort_order);

create table if not exists claim_events (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  claim_id    uuid not null references claims(id) on delete cascade,
  kind        text not null check (kind in ('created','status','query','reply','note','deduction')),
  from_status text,
  to_status   text,
  message     text,
  amount      numeric(12,2),
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists claim_events_idx on claim_events (claim_id, created_at);

create table if not exists claim_deductions (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  claim_id         uuid not null references claims(id) on delete cascade,
  category         text not null default 'other'
                     check (category in ('non_payable','room_rent','co_pay','tariff','documentation','policy_limit','other')),
  reason           text not null,
  amount           numeric(12,2) not null check (amount > 0),
  outcome          text not null default 'open' check (outcome in ('open','disputed','recovered','accepted')),
  recovered_amount numeric(12,2) not null default 0 check (recovered_amount >= 0),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  check (recovered_amount <= amount)
);
create index if not exists claim_deductions_idx on claim_deductions (clinic_id, claim_id);

-- ─── isolation guards + RLS ──────────────────────────────────
do $$
declare spec text; parts text[]; t text; args text[]; i int;
begin
  foreach spec in array array[
    'patient_policies|patient_id:clinic_patients|payer_id:insurance_payers|tpa_id:insurance_payers',
    'claims|patient_id:clinic_patients|policy_id:patient_policies|payer_id:insurance_payers|invoice_id:invoices',
    'claim_documents|claim_id:claims',
    'claim_events|claim_id:claims',
    'claim_deductions|claim_id:claims'
  ] loop
    parts := string_to_array(spec, '|'); t := parts[1]; args := '{}';
    for i in 2 .. array_length(parts, 1) loop args := args || string_to_array(parts[i], ':'); end loop;
    execute format('drop trigger if exists trg_tenant_guard on %I', t);
    execute format('create trigger trg_tenant_guard before insert or update on %I for each row execute function tenant_same_clinic(%s)',
                   t, (select string_agg(quote_literal(a), ',') from unnest(args) a));
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['insurance_payers','patient_policies','claims','claim_documents','claim_events','claim_deductions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "Claims desk read %1$s" on %1$I', t);
    execute format('create policy "Claims desk read %1$s" on %1$I for select using (is_clinic_role(clinic_id, array[''admin'',''doctor'',''nurse'',''receptionist'']))', t);
  end loop;
end $$;

-- ─── helpers ─────────────────────────────────────────────────
-- the standard papers for each stage (Indian cashless practice); staff can add more on a claim
create or replace function claim_default_docs() returns table (stage text, name text, required boolean, ord int)
language sql immutable as $$
  select * from (values
    ('preauth',   'Pre-authorisation form (signed by doctor and patient)', true,  1),
    ('preauth',   'Insurance e-card or policy copy',                        true,  2),
    ('preauth',   'Patient photo ID (Aadhaar / PAN)',                       true,  3),
    ('preauth',   'Doctor''s consultation notes and diagnosis',             true,  4),
    ('preauth',   'Investigation reports supporting the diagnosis',         true,  5),
    ('preauth',   'Estimate of cost',                                       true,  6),
    ('preauth',   'Previous treatment records (if any)',                    false, 7),
    ('discharge', 'Discharge summary',                                      true,  1),
    ('discharge', 'Final bill (itemised)',                                  true,  2),
    ('discharge', 'Pharmacy and consumables bills',                         true,  3),
    ('discharge', 'Final investigation reports',                            true,  4),
    ('discharge', 'Implant sticker / invoice (if used)',                    false, 5)
  ) as d(stage, name, required, ord)
$$;

create or replace function claim_log(p_clinic uuid, p_claim uuid, p_actor uuid, p_kind text, p_from text, p_to text, p_msg text default null, p_amount numeric default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into claim_events (clinic_id, claim_id, kind, from_status, to_status, message, amount, actor)
  values (p_clinic, p_claim, p_kind, p_from, p_to, nullif(left(p_msg, 1000), ''), p_amount, p_actor)
$$;

-- ─── payers & policies ───────────────────────────────────────
-- p = {clinic_id, id?, name, kind?, portal_url?, phone?, email?, notes?}
create or replace function payer_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_id uuid := nullif(p->>'id','')::uuid; v_name text := nullif(trim(left(p->>'name', 100)), '');
        v_kind text := coalesce(nullif(p->>'kind',''), 'insurer');
begin
  if v_name is null or length(v_name) < 2 then raise exception 'NAME_REQUIRED: enter the insurer or TPA name'; end if;
  if v_kind not in ('insurer','tpa','government','corporate') then raise exception 'KIND_INVALID: choose insurer, TPA, government or corporate'; end if;
  if exists (select 1 from insurance_payers where clinic_id = v_clinic and lower(name) = lower(v_name) and id is distinct from v_id) then
    raise exception 'ALREADY: % is already in your list', v_name;
  end if;
  if v_id is null then
    insert into insurance_payers (clinic_id, name, kind, portal_url, phone, email, notes)
    values (v_clinic, v_name, v_kind, nullif(trim(left(p->>'portal_url',300)),''), nullif(trim(left(p->>'phone',20)),''), nullif(trim(left(p->>'email',120)),''), nullif(trim(left(p->>'notes',300)),''))
    returning id into v_id;
  else
    update insurance_payers set name = v_name, kind = v_kind, portal_url = nullif(trim(left(p->>'portal_url',300)),''), phone = nullif(trim(left(p->>'phone',20)),''),
           email = nullif(trim(left(p->>'email',120)),''), notes = nullif(trim(left(p->>'notes',300)),''), is_active = true
     where id = v_id and clinic_id = v_clinic;
    if not found then raise exception 'NOT_FOUND: insurer not found'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- p = {clinic_id, patient_id, payer_id, tpa_id?, policy_number, member_id?, holder_name?, sum_insured?, valid_from?, valid_to?, abha_id?}
create or replace function policy_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_pat uuid := nullif(p->>'patient_id','')::uuid; v_payer uuid := nullif(p->>'payer_id','')::uuid;
        v_tpa uuid := nullif(p->>'tpa_id','')::uuid; v_no text := nullif(trim(left(p->>'policy_number', 60)), ''); v_id uuid; v_abha text;
begin
  if not exists (select 1 from clinic_patients where id = v_pat and clinic_id = v_clinic) then raise exception 'PATIENT_NOT_FOUND: choose a patient of this clinic'; end if;
  if not exists (select 1 from insurance_payers where id = v_payer and clinic_id = v_clinic and is_active) then raise exception 'PAYER_REQUIRED: choose the insurer'; end if;
  if v_tpa is not null and not exists (select 1 from insurance_payers where id = v_tpa and clinic_id = v_clinic and is_active) then raise exception 'PAYER_REQUIRED: that TPA is not in your list'; end if;
  if v_no is null then raise exception 'POLICY_REQUIRED: enter the policy number'; end if;
  v_abha := nullif(regexp_replace(coalesce(p->>'abha_id',''), '[^0-9A-Za-z@.]', '', 'g'), '');
  if v_abha is not null and v_abha !~ '@' and length(regexp_replace(v_abha, '\D', '', 'g')) <> 14 then raise exception 'ABHA_INVALID: an ABHA number has 14 digits (or use the ABHA address, like name@abdm)'; end if;
  select id into v_id from patient_policies where clinic_id = v_clinic and patient_id = v_pat and payer_id = v_payer and policy_number = v_no;
  if v_id is null then
    insert into patient_policies (clinic_id, patient_id, payer_id, tpa_id, policy_number, member_id, holder_name, sum_insured, valid_from, valid_to, abha_id)
    values (v_clinic, v_pat, v_payer, v_tpa, v_no, nullif(trim(left(p->>'member_id',60)),''), nullif(trim(left(p->>'holder_name',100)),''),
            nullif(p->>'sum_insured','')::numeric, nullif(p->>'valid_from','')::date, nullif(p->>'valid_to','')::date, v_abha)
    returning id into v_id;
  else
    -- only the fields that were sent are changed
    update patient_policies set
           tpa_id      = case when p ? 'tpa_id'      then v_tpa else tpa_id end,
           member_id   = case when p ? 'member_id'   then nullif(trim(left(p->>'member_id',60)),'') else member_id end,
           holder_name = case when p ? 'holder_name' then nullif(trim(left(p->>'holder_name',100)),'') else holder_name end,
           sum_insured = case when p ? 'sum_insured' then nullif(p->>'sum_insured','')::numeric else sum_insured end,
           valid_from  = case when p ? 'valid_from'  then nullif(p->>'valid_from','')::date else valid_from end,
           valid_to    = case when p ? 'valid_to'    then nullif(p->>'valid_to','')::date else valid_to end,
           abha_id     = case when p ? 'abha_id'     then v_abha else abha_id end,
           is_active = true
     where id = v_id;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

-- ─── claims ──────────────────────────────────────────────────
-- p = {clinic_id, actor, policy_id, procedure, admission_date?, estimated_amount?, invoice_id?, notes?}
create or replace function claim_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_actor uuid := nullif(p->>'actor','')::uuid; pol patient_policies%rowtype;
        v_proc text := nullif(trim(left(p->>'procedure', 200)), ''); v_est numeric := coalesce(nullif(p->>'estimated_amount','')::numeric, 0);
        v_inv uuid := nullif(p->>'invoice_id','')::uuid; v_id uuid; v_no text; v_adm date := nullif(p->>'admission_date','')::date;
begin
  select * into pol from patient_policies where id = nullif(p->>'policy_id','')::uuid and clinic_id = v_clinic and is_active;
  if not found then raise exception 'POLICY_REQUIRED: choose or add the patient''s policy'; end if;
  if v_proc is null then raise exception 'PROCEDURE_REQUIRED: enter the treatment or procedure'; end if;
  if v_est < 0 then raise exception 'AMOUNT_INVALID: the estimate cannot be negative'; end if;
  if pol.valid_to is not null and coalesce(v_adm, current_date) > pol.valid_to then raise exception 'NOT_ALLOWED: this policy expired on %', to_char(pol.valid_to, 'DD Mon YYYY'); end if;
  if v_inv is not null and not exists (select 1 from invoices where id = v_inv and clinic_id = v_clinic and clinic_patient_id = pol.patient_id) then
    raise exception 'NOT_FOUND: that invoice is not this patient''s';
  end if;
  v_no := next_doc_number(v_clinic, 'CLM');
  insert into claims (clinic_id, claim_number, patient_id, policy_id, payer_id, invoice_id, procedure, admission_date, estimated_amount, notes, created_by)
  values (v_clinic, v_no, pol.patient_id, pol.id, coalesce(pol.tpa_id, pol.payer_id), v_inv, v_proc, v_adm, v_est, nullif(trim(left(p->>'notes', 1000)), ''), v_actor)
  returning id into v_id;
  insert into claim_documents (clinic_id, claim_id, stage, name, required, sort_order)
  select v_clinic, v_id, d.stage, d.name, d.required, d.ord from claim_default_docs() d;
  perform claim_log(v_clinic, v_id, v_actor, 'created', null, 'draft', v_proc, v_est);
  return jsonb_build_object('claim_id', v_id, 'claim_number', v_no);
end $$;

-- Move a claim forward. p = {approved_amount?, billed_amount?, settled_amount?, insurer_ref?, discharge_date?, note?}
--   draft          → preauth_sent (all required pre-auth papers in), cancelled
--   preauth_sent   → approved (approved_amount), rejected
--   approved       → discharge_sent (billed_amount, all required discharge papers in), cancelled
--   discharge_sent → settled (settled_amount ≤ billed), rejected
--   rejected       → preauth_sent (resubmit)
create or replace function claim_advance(p_clinic uuid, p_actor uuid, p_claim uuid, p_to text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims%rowtype; v_missing text; v_amt numeric; v_note text := nullif(trim(left(p->>'note', 1000)), ''); v_gap numeric;
begin
  select * into c from claims where id = p_claim and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: claim not found'; end if;
  if not (
       (c.status = 'draft'          and p_to in ('preauth_sent','cancelled'))
    or (c.status = 'preauth_sent'   and p_to in ('approved','rejected'))
    or (c.status = 'approved'       and p_to in ('discharge_sent','cancelled'))
    or (c.status = 'discharge_sent' and p_to in ('settled','rejected'))
    or (c.status = 'rejected'       and p_to = 'preauth_sent')
  ) then
    raise exception 'NOT_ALLOWED: a % claim cannot move to %', replace(c.status, '_', ' '), replace(p_to, '_', ' ');
  end if;

  if p_to in ('preauth_sent','discharge_sent') then
    select string_agg(name, '; ' order by sort_order) into v_missing from claim_documents
     where claim_id = c.id and stage = case when p_to = 'preauth_sent' then 'preauth' else 'discharge' end and required and not received;
    if v_missing is not null then raise exception 'DOCS_MISSING: still missing: %', v_missing; end if;
  end if;

  if p_to = 'preauth_sent' then
    update claims set status = p_to, query_from = null, preauth_sent_at = now(), preauth_decided_at = null,
           insurer_ref = coalesce(nullif(trim(left(p->>'insurer_ref', 60)), ''), insurer_ref), updated_at = now() where id = c.id;
  elsif p_to = 'approved' then
    v_amt := nullif(p->>'approved_amount','')::numeric;
    if v_amt is null or v_amt <= 0 then raise exception 'AMOUNT_REQUIRED: enter the amount the insurer approved'; end if;
    update claims set status = p_to, approved_amount = v_amt, preauth_decided_at = now(),
           insurer_ref = coalesce(nullif(trim(left(p->>'insurer_ref', 60)), ''), insurer_ref), updated_at = now() where id = c.id;
  elsif p_to = 'discharge_sent' then
    v_amt := nullif(p->>'billed_amount','')::numeric;
    if v_amt is null or v_amt <= 0 then raise exception 'AMOUNT_REQUIRED: enter the final bill amount'; end if;
    update claims set status = p_to, billed_amount = v_amt, discharge_sent_at = now(), discharge_decided_at = null, query_from = null,
           discharge_date = coalesce(nullif(p->>'discharge_date','')::date, discharge_date, current_date), updated_at = now() where id = c.id;
  elsif p_to = 'settled' then
    v_amt := nullif(p->>'settled_amount','')::numeric;
    if v_amt is null or v_amt < 0 then raise exception 'AMOUNT_REQUIRED: enter the amount the insurer paid'; end if;
    if v_amt > c.billed_amount then raise exception 'AMOUNT_INVALID: the insurer cannot pay more than the bill (%)', c.billed_amount; end if;
    update claims set status = p_to, settled_amount = v_amt, discharge_decided_at = coalesce(discharge_decided_at, now()), settled_at = now(), updated_at = now() where id = c.id;
    v_gap := c.billed_amount - v_amt;
  elsif p_to = 'rejected' then
    if v_note is null then raise exception 'REASON_REQUIRED: write the reason the insurer gave'; end if;
    update claims set status = p_to,
           preauth_decided_at = case when c.status = 'preauth_sent' then now() else preauth_decided_at end,
           discharge_decided_at = case when c.status = 'discharge_sent' then now() else discharge_decided_at end, updated_at = now() where id = c.id;
  else
    update claims set status = p_to, updated_at = now() where id = c.id;
  end if;

  perform claim_log(p_clinic, c.id, p_actor, 'status', c.status, p_to, v_note, v_amt);
  return jsonb_build_object('status', p_to, 'unexplained_gap', v_gap);
end $$;

-- The insurer asked a question: the clock pauses in "query" until the hospital replies.
create or replace function claim_query(p_clinic uuid, p_actor uuid, p_claim uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims%rowtype;
begin
  select * into c from claims where id = p_claim and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: claim not found'; end if;
  if c.status not in ('preauth_sent','discharge_sent') then raise exception 'NOT_ALLOWED: queries come in while the insurer is reviewing'; end if;
  if nullif(trim(p_message), '') is null then raise exception 'MESSAGE_REQUIRED: write what the insurer asked for'; end if;
  update claims set status = 'query', query_from = c.status, updated_at = now() where id = c.id;
  perform claim_log(p_clinic, c.id, p_actor, 'query', c.status, 'query', p_message);
  return jsonb_build_object('status', 'query');
end $$;

-- The hospital answered: back to the stage it came from, with a fresh clock.
create or replace function claim_reply(p_clinic uuid, p_actor uuid, p_claim uuid, p_message text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims%rowtype;
begin
  select * into c from claims where id = p_claim and clinic_id = p_clinic for update;
  if not found then raise exception 'NOT_FOUND: claim not found'; end if;
  if c.status <> 'query' then raise exception 'NOT_ALLOWED: there is no open query on this claim'; end if;
  if nullif(trim(p_message), '') is null then raise exception 'MESSAGE_REQUIRED: write what you sent back'; end if;
  update claims set status = c.query_from, query_from = null,
         preauth_sent_at = case when c.query_from = 'preauth_sent' then now() else preauth_sent_at end,
         discharge_sent_at = case when c.query_from = 'discharge_sent' then now() else discharge_sent_at end,
         updated_at = now() where id = c.id;
  perform claim_log(p_clinic, c.id, p_actor, 'reply', 'query', c.query_from, p_message);
  return jsonb_build_object('status', c.query_from);
end $$;

create or replace function claim_note(p_clinic uuid, p_actor uuid, p_claim uuid, p_message text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from claims where id = p_claim and clinic_id = p_clinic) then raise exception 'NOT_FOUND: claim not found'; end if;
  if nullif(trim(p_message), '') is null then raise exception 'MESSAGE_REQUIRED: write a note'; end if;
  perform claim_log(p_clinic, p_claim, p_actor, 'note', null, null, p_message);
end $$;

-- tick a paper as received (or not), or add a new one: p = {doc_id?, received?, stage?, name?, required?, note?}
create or replace function claim_doc_set(p_clinic uuid, p_claim uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'doc_id','')::uuid; v_name text := nullif(trim(left(p->>'name', 150)), ''); v_stage text := coalesce(nullif(p->>'stage',''), 'preauth'); v_rcv boolean;
begin
  if not exists (select 1 from claims where id = p_claim and clinic_id = p_clinic and status not in ('settled','cancelled')) then
    raise exception 'NOT_ALLOWED: this claim is closed';
  end if;
  if v_id is null then
    if v_name is null then raise exception 'NAME_REQUIRED: enter the paper''s name'; end if;
    if v_stage not in ('preauth','discharge') then raise exception 'STAGE_INVALID: choose pre-auth or discharge'; end if;
    insert into claim_documents (clinic_id, claim_id, stage, name, required, sort_order)
    values (p_clinic, p_claim, v_stage, v_name, coalesce((p->>'required')::boolean, true),
            coalesce((select max(sort_order) + 1 from claim_documents where claim_id = p_claim and stage = v_stage), 1))
    on conflict (claim_id, stage, name) do nothing
    returning id into v_id;
    if v_id is null then raise exception 'ALREADY: that paper is already on the list'; end if;
    return jsonb_build_object('doc_id', v_id);
  end if;
  v_rcv := coalesce((p->>'received')::boolean, true);
  update claim_documents set received = v_rcv, received_at = case when v_rcv then now() end,
         note = coalesce(nullif(trim(left(p->>'note', 300)), ''), note)
   where id = v_id and claim_id = p_claim;
  if not found then raise exception 'NOT_FOUND: paper not found on this claim'; end if;
  return jsonb_build_object('doc_id', v_id, 'received', v_rcv);
end $$;

-- record money the insurer cut, or update its outcome: p = {deduction_id?, category?, reason?, amount?, outcome?, recovered_amount?}
create or replace function claim_deduction_save(p_clinic uuid, p_actor uuid, p_claim uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c claims%rowtype; v_id uuid := nullif(p->>'deduction_id','')::uuid; v_amt numeric; v_out text; v_rec numeric; d claim_deductions%rowtype; v_total numeric;
begin
  select * into c from claims where id = p_claim and clinic_id = p_clinic;
  if not found then raise exception 'NOT_FOUND: claim not found'; end if;
  if v_id is null then
    if c.status not in ('approved','discharge_sent','query','settled') then raise exception 'NOT_ALLOWED: deductions are recorded once the insurer has approved or paid'; end if;
    v_amt := nullif(p->>'amount','')::numeric;
    if v_amt is null or v_amt <= 0 then raise exception 'AMOUNT_REQUIRED: enter the amount that was cut'; end if;
    if nullif(trim(p->>'reason'), '') is null then raise exception 'REASON_REQUIRED: write the reason the insurer gave'; end if;
    select coalesce(sum(amount), 0) into v_total from claim_deductions where claim_id = c.id;
    if coalesce(c.billed_amount, c.approved_amount, c.estimated_amount) > 0 and v_total + v_amt > coalesce(c.billed_amount, c.approved_amount, c.estimated_amount) then
      raise exception 'AMOUNT_INVALID: deductions would add up to more than the bill';
    end if;
    insert into claim_deductions (clinic_id, claim_id, category, reason, amount, created_by)
    values (p_clinic, c.id, coalesce(nullif(p->>'category',''), 'other'), trim(left(p->>'reason', 300)), v_amt, p_actor)
    returning id into v_id;
    perform claim_log(p_clinic, c.id, p_actor, 'deduction', null, null, trim(left(p->>'reason', 300)), v_amt);
    return jsonb_build_object('deduction_id', v_id);
  end if;
  select * into d from claim_deductions where id = v_id and claim_id = c.id for update;
  if not found then raise exception 'NOT_FOUND: deduction not found'; end if;
  v_out := coalesce(nullif(p->>'outcome',''), d.outcome);
  if v_out not in ('open','disputed','recovered','accepted') then raise exception 'OUTCOME_INVALID: choose open, disputed, recovered or accepted'; end if;
  v_rec := case when v_out = 'recovered' then coalesce(nullif(p->>'recovered_amount','')::numeric, d.amount) when v_out = 'accepted' then 0 else d.recovered_amount end;
  if v_rec < 0 or v_rec > d.amount then raise exception 'AMOUNT_INVALID: recovered amount must be between 0 and %', d.amount; end if;
  update claim_deductions set outcome = v_out, recovered_amount = v_rec where id = d.id;
  perform claim_log(p_clinic, c.id, p_actor, 'deduction', d.outcome, v_out, d.reason, v_rec);
  return jsonb_build_object('deduction_id', d.id, 'outcome', v_out, 'recovered_amount', v_rec);
end $$;

-- ─── the claims desk numbers ─────────────────────────────────
-- p_from / p_to bound when the claim was created; SLA counts are always "right now".
create or replace function claims_summary(p_clinic uuid, p_from date default null, p_to date default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (
    select * from claims where clinic_id = p_clinic and status <> 'cancelled'
       and (p_from is null or created_at::date >= p_from) and (p_to is null or created_at::date <= p_to)
  ), d as (
    select x.* from claim_deductions x join c on c.id = x.claim_id
  )
  select jsonb_build_object(
    'open',            (select count(*) from c where status in ('draft','preauth_sent','query','approved','discharge_sent')),
    'waiting_insurer', (select count(*) from c where status in ('preauth_sent','discharge_sent')),
    'queries',         (select count(*) from c where status = 'query'),
    'preauth_overdue', (select count(*) from c where status = 'preauth_sent' and preauth_sent_at < now() - interval '1 hour'),
    'discharge_overdue',(select count(*) from c where status = 'discharge_sent' and discharge_sent_at < now() - interval '3 hours'),
    'billed',          coalesce((select sum(billed_amount) from c where status = 'settled'), 0),
    'settled',         coalesce((select sum(settled_amount) from c where status = 'settled'), 0),
    'deducted',        coalesce((select sum(amount) from d), 0),
    'recovered',       coalesce((select sum(recovered_amount) from d), 0),
    'disputable',      coalesce((select sum(amount) from d where outcome in ('open','disputed')), 0),
    'rejected',        (select count(*) from c where status = 'rejected'),
    'by_category',     coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amt) order by amt desc)
                                   from (select category, sum(amount) amt from d group by 1) z), '[]'::jsonb),
    'by_payer',        coalesce((select jsonb_agg(jsonb_build_object('payer', name, 'claims', n, 'billed', billed, 'settled', settled,
                                                                     'deducted', deducted, 'avg_preauth_minutes', avg_pre) order by n desc)
                                   from (select p.name, count(*) n,
                                                coalesce(sum(c.billed_amount) filter (where c.status = 'settled'), 0) billed,
                                                coalesce(sum(c.settled_amount) filter (where c.status = 'settled'), 0) settled,
                                                coalesce((select sum(x.amount) from d x where x.claim_id = any(array_agg(c.id))), 0) deducted,
                                                round(avg(extract(epoch from (c.preauth_decided_at - c.preauth_sent_at)) / 60)
                                                      filter (where c.preauth_decided_at is not null and c.preauth_sent_at is not null))::int avg_pre
                                           from c join insurance_payers p on p.id = c.payer_id group by p.name) y), '[]'::jsonb)
  )
$$;

-- ─── Claims tab in the Payments app (existing clinics now, new clinics when their apps are created) ──
create or replace function apps_add_claims_tab() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.api_name = 'sys_payments' and not exists (select 1 from builder_tabs where app_id = new.id and path = '/claims') then
    insert into builder_tabs (clinic_id, app_id, kind, label, sort_order, path, visible_roles)
    values (new.clinic_id, new.id, 'page', 'Insurance claims', 50, '/claims', '{admin,doctor,nurse,receptionist}');
  end if;
  return new;
end $$;
drop trigger if exists trg_apps_claims_tab on builder_apps;
create trigger trg_apps_claims_tab after insert on builder_apps for each row execute function apps_add_claims_tab();

insert into builder_tabs (clinic_id, app_id, kind, label, sort_order, path, visible_roles)
select a.clinic_id, a.id, 'page', 'Insurance claims', 50, '/claims', '{admin,doctor,nurse,receptionist}'
  from builder_apps a
 where a.api_name = 'sys_payments' and not exists (select 1 from builder_tabs t where t.app_id = a.id and t.path = '/claims');

-- ─── Permissions: server-only functions ──────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'claim_log(uuid,uuid,uuid,text,text,text,text,numeric)', 'payer_save(jsonb)', 'policy_save(jsonb)', 'claim_create(jsonb)',
    'claim_advance(uuid,uuid,uuid,text,jsonb)', 'claim_query(uuid,uuid,uuid,text)', 'claim_reply(uuid,uuid,uuid,text)',
    'claim_note(uuid,uuid,uuid,text)', 'claim_doc_set(uuid,uuid,jsonb)', 'claim_deduction_save(uuid,uuid,uuid,jsonb)',
    'claims_summary(uuid,date,date)', 'apps_add_claims_tab()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end $$;
