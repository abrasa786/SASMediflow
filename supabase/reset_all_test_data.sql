-- ============================================================================
-- RESET: deletes EVERY clinic and EVERY user in this Supabase project.
-- Use only on the SASMediflow project, before the first real clinic joins.
-- It cannot be undone. Run it ONCE, then onboard the real clinic.
--
-- To run: change 'NO' to 'DELETE EVERYTHING' on the next line, then press Run.
-- ============================================================================
do $$
declare
  confirm text := 'NO';          -- <-- change to: DELETE EVERYTHING
  t record;
  n bigint;
begin
  if confirm <> 'DELETE EVERYTHING' then
    raise exception 'Nothing was deleted. Change confirm to DELETE EVERYTHING to run this.';
  end if;

  -- 1. Every clinic, which removes its patients, appointments, invoices, staff records, holds, payments, etc.
  --    (all clinic tables are linked to clinics with ON DELETE CASCADE)
  delete from public.clinics;

  -- 2. Any table that still has rows and a clinic_id column (belt and braces for tables added later without a cascade)
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'clinic_id'
  loop
    execute format('delete from public.%I', t.table_name);
  end loop;

  -- 3. Every login (admins, doctors, nurses, receptionists). Their sessions and identities go with them.
  delete from auth.users;

  -- 4. Uploaded clinic logos
  begin
    delete from storage.objects where bucket_id in (select id from storage.buckets where name ilike '%logo%' or name ilike '%clinic%');
  exception when others then null;
  end;

  select count(*) into n from public.clinics;
  raise notice 'Done. Clinics left: %. Users left: %.', n, (select count(*) from auth.users);
end $$;
