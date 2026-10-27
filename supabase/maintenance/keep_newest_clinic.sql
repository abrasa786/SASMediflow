-- Delete every clinic except the NEWEST one, with all their data, and the staff logins that belonged only to the deleted clinics.
-- This cannot be undone. Run it in Supabase -> SQL Editor, one STEP at a time, top to bottom.
-- Patients who only use the patient app are NOT touched: only people who were staff of a deleted clinic are removed.

-- ═══ STEP 1: look first. Nothing is changed. Check the KEEP row is the clinic you want. ═══
select id, name, created_at,
       case when id = (select id from clinics order by created_at desc limit 1) then 'KEEP' else 'DELETE' end as action
from clinics order by created_at desc;

-- ═══ STEP 2: rehearsal. Does everything, shows the counts, then undoes it (ROLLBACK). Run this whole block at once. ═══
begin;
create temp table _keep on commit drop as select id from clinics order by created_at desc limit 1;
create temp table _gone_users on commit drop as
  select distinct s.user_id from clinic_staff s
  where s.clinic_id not in (select id from _keep)
    and not exists (select 1 from clinic_staff k where k.user_id = s.user_id and k.clinic_id in (select id from _keep));
delete from clinics where id not in (select id from _keep);
delete from auth.users where id in (select user_id from _gone_users);
select (select count(*) from clinics)        as clinics_left,
       (select count(*) from clinic_patients) as patients_left,
       (select count(*) from appointments)    as appointments_left,
       (select count(*) from invoices)        as invoices_left,
       (select count(*) from _gone_users)     as logins_removed;
rollback;   -- nothing was saved

-- ═══ STEP 3: the real thing. Same block, ending in COMMIT. Only run after STEP 2 finished with no error and the numbers look right. ═══
-- begin;
-- create temp table _keep on commit drop as select id from clinics order by created_at desc limit 1;
-- create temp table _gone_users on commit drop as
--   select distinct s.user_id from clinic_staff s
--   where s.clinic_id not in (select id from _keep)
--     and not exists (select 1 from clinic_staff k where k.user_id = s.user_id and k.clinic_id in (select id from _keep));
-- delete from clinics where id not in (select id from _keep);
-- delete from auth.users where id in (select user_id from _gone_users);
-- commit;
