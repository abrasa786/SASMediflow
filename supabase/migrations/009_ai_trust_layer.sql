-- 009: AI trust layer.
--   * ai_questionnaire: every question a clinic asks the AI, and its answer, stored in OUR database only
--     (per clinic, encrypted by the app when AI_DATA_KEY is set). It is the AI's only memory:
--     delete a row and the AI no longer knows it.
--   * Per-clinic AI policy in clinics.settings.ai: external AI is OFF unless an admin turns it on;
--     retention_days controls auto-deletion (0 = store nothing).
--   * ai_usage: tiny rate-limit ledger.
-- Safe to re-run. Requires 005 (is_clinic_role).

create table if not exists ai_questionnaire (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  session_id  uuid not null,
  module      text not null check (module in ('assistant','builder')),
  question    text not null,
  answer      text,
  sent_text   text,                       -- exactly what left our system (after redaction), when anything did
  encrypted   boolean not null default false,
  intent      text,
  source      text not null default 'local' check (source in ('local','rules','external')),
  redactions  int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists ai_q_session_idx on ai_questionnaire (clinic_id, user_id, session_id, created_at);
create index if not exists ai_q_clinic_idx  on ai_questionnaire (clinic_id, created_at desc);

create table if not exists ai_usage (
  id         bigserial primary key,
  clinic_id  uuid not null references clinics(id) on delete cascade,
  user_id    uuid not null,
  at         timestamptz not null default now()
);
create index if not exists ai_usage_idx on ai_usage (clinic_id, user_id, at desc);

alter table ai_questionnaire enable row level security;
alter table ai_usage         enable row level security;

-- A person reads their own questions; the clinic admin can read the clinic's. Nobody can write directly.
drop policy if exists "Own or admin read ai_questionnaire" on ai_questionnaire;
create policy "Own or admin read ai_questionnaire" on ai_questionnaire for select
  using (user_id = auth.uid() or is_clinic_role(clinic_id, array['admin']));
revoke insert, update, delete on ai_questionnaire from anon, authenticated;
revoke all on ai_usage from anon, authenticated;

-- ─── Policy ──────────────────────────────────────────────────
create or replace function ai_policy(p_clinic uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'external_enabled', coalesce((c.settings->'ai'->>'external_enabled')::boolean, false),
    'retention_days',   coalesce((c.settings->'ai'->>'retention_days')::int, 30))
  from clinics c where c.id = p_clinic
$$;

create or replace function ai_set_policy(p_clinic uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_days int := coalesce((p->>'retention_days')::int, (ai_policy(p_clinic)->>'retention_days')::int);
        v_ext boolean := coalesce((p->>'external_enabled')::boolean, (ai_policy(p_clinic)->>'external_enabled')::boolean);
begin
  if v_days < 0 or v_days > 365 then raise exception 'VALIDATION: keep history for 0 to 365 days'; end if;
  update clinics set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ai}', jsonb_build_object('external_enabled', v_ext, 'retention_days', v_days), true) where id = p_clinic;
  if not found then raise exception 'NOT_FOUND: clinic not found'; end if;
  if v_days = 0 then delete from ai_questionnaire where clinic_id = p_clinic; end if;  -- "store nothing" also clears what is stored
  return ai_policy(p_clinic);
end $$;

-- ─── Write one Q&A (service role only) ───────────────────────
create or replace function ai_log(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_clinic uuid := (p->>'clinic_id')::uuid; v_user uuid := (p->>'user_id')::uuid; v_id uuid;
begin
  if not exists (select 1 from clinic_staff where clinic_id = v_clinic and user_id = v_user and coalesce(is_active, true)) then
    raise exception 'NOT_ALLOWED: not a member of this clinic';
  end if;
  if (ai_policy(v_clinic)->>'retention_days')::int = 0 then return null; end if;     -- clinic chose to store nothing
  insert into ai_questionnaire (clinic_id, user_id, session_id, module, question, answer, sent_text, encrypted, intent, source, redactions)
  values (v_clinic, v_user, (p->>'session_id')::uuid, p->>'module', p->>'question', p->>'answer', p->>'sent_text',
          coalesce((p->>'encrypted')::boolean, false), p->>'intent', coalesce(p->>'source', 'local'), coalesce((p->>'redactions')::int, 0))
  returning id into v_id;
  return v_id;
end $$;

-- ─── Delete: from our database, which is the AI's only memory ──
-- scope: 'one' (id), 'session' (session_id), 'mine' (all of my own), 'all' (admin: the whole clinic)
create or replace function ai_delete(p_clinic uuid, p_actor uuid, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text; v_n int; v_scope text := p->>'scope';
begin
  select role into v_role from clinic_staff where clinic_id = p_clinic and user_id = p_actor and coalesce(is_active, true);
  if v_role is null then raise exception 'NOT_ALLOWED: not a member of this clinic'; end if;
  if v_scope = 'all' then
    if v_role <> 'admin' then raise exception 'FORBIDDEN: only the admin can clear the whole clinic''s AI history'; end if;
    delete from ai_questionnaire where clinic_id = p_clinic;
  elsif v_scope = 'mine' then
    delete from ai_questionnaire where clinic_id = p_clinic and user_id = p_actor;
  elsif v_scope = 'session' then
    delete from ai_questionnaire where clinic_id = p_clinic and session_id = (p->>'session_id')::uuid and (user_id = p_actor or v_role = 'admin');
  elsif v_scope = 'one' then
    delete from ai_questionnaire where clinic_id = p_clinic and id = (p->>'id')::uuid and (user_id = p_actor or v_role = 'admin');
  else raise exception 'VALIDATION: unknown delete scope'; end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ─── Rate limit ──────────────────────────────────────────────
create or replace function ai_rate_check(p_clinic uuid, p_user uuid, p_per_minute int default 20) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select count(*) from ai_usage where clinic_id = p_clinic and user_id = p_user and at > now() - interval '1 minute') >= p_per_minute then
    raise exception 'RATE_LIMIT: too many AI requests, wait a minute';
  end if;
  insert into ai_usage (clinic_id, user_id) values (p_clinic, p_user);
end $$;

-- ─── Retention (run daily) ───────────────────────────────────
create or replace function ai_purge() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_q int; v_u int;
begin
  delete from ai_questionnaire q using clinics c
   where c.id = q.clinic_id and q.created_at < now() - make_interval(days => coalesce((c.settings->'ai'->>'retention_days')::int, 30));
  get diagnostics v_q = row_count;
  delete from ai_usage where at < now() - interval '1 day';
  get diagnostics v_u = row_count;
  return jsonb_build_object('questions_deleted', v_q, 'usage_deleted', v_u);
end $$;

do $$
declare fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ai_policy','ai_set_policy','ai_log','ai_delete','ai_rate_check','ai_purge')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
end $$;
