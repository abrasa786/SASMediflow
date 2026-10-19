-- Restores admin access for an account that was accidentally changed to another role.
-- Edit the email, then run in the Supabase SQL editor.
update clinic_staff set role = 'admin', is_active = true
 where user_id = (select id from auth.users where email = 'azimrahim068@gmail.com');
select cs.role, c.name as clinic from clinic_staff cs join clinics c on c.id = cs.clinic_id
 where cs.user_id = (select id from auth.users where email = 'azimrahim068@gmail.com');
