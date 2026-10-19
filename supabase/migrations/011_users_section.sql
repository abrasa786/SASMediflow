-- 011: "Users" section. Everyone in a clinic can see who belongs to it; ONLY an admin of that clinic can remove a user.
-- Removal is enforced in the database (not just the screen): service-role-only function, admin check, no self-removal,
-- never the last admin. History (attendance, leave, invoices, appointments) is kept; the person simply loses access.
-- Re-runnable.

create table if not exists user_removals (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics(id) on delete cascade,
  removed_user uuid not null,
  removed_name text,
  removed_role text,
  removed_by  uuid not null,
  removed_at  timestamptz not null default now()
);
create index if not exists user_removals_clinic_idx on user_removals(clinic_id, removed_at desc);
alter table user_removals enable row level security;
drop policy if exists "Admin read user_removals" on user_removals;
create policy "Admin read user_removals" on user_removals for select using (is_clinic_role(clinic_id, array['admin']));

create or replace function users_remove(p_clinic uuid, p_actor uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare m clinic_staff; admins int;
begin
  if not exists (select 1 from clinic_staff where clinic_id = p_clinic and user_id = p_actor and role = 'admin' and coalesce(is_active, true))
    then raise exception 'FORBIDDEN: only a clinic admin can delete users'; end if;
  if p_actor = p_user then raise exception 'NOT_ALLOWED: you cannot delete your own account here'; end if;
  select * into m from clinic_staff where clinic_id = p_clinic and user_id = p_user for update;
  if not found then raise exception 'NOT_FOUND: that user is not part of this clinic'; end if;
  if m.role = 'admin' then
    select count(*) into admins from clinic_staff where clinic_id = p_clinic and role = 'admin' and coalesce(is_active, true);
    if admins <= 1 then raise exception 'NOT_ALLOWED: a clinic must keep at least one admin'; end if;
  end if;
  delete from clinic_staff where id = m.id;
  update doctors set user_id = null, is_active = false where clinic_id = p_clinic and user_id = p_user;
  insert into user_removals(clinic_id, removed_user, removed_name, removed_role, removed_by) values (p_clinic, p_user, m.name, m.role, p_actor);
  return jsonb_build_object('removed', p_user, 'role', m.role);
end $$;
revoke all on function users_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function users_remove(uuid, uuid, uuid) to service_role;
