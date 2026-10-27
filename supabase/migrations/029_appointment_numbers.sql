-- 029: a short, readable number for every appointment (APT-00001), shown in the appointments list and found by search.
-- Existing appointments are numbered oldest first. Safe to run again.
create sequence if not exists appointment_seq;
alter table appointments add column if not exists appt_no text;

with ordered as (select id, row_number() over (order by created_at nulls first, id) as n from appointments where appt_no is null)
update appointments a set appt_no = 'APT-' || lpad((select nextval('appointment_seq'))::text, 5, '0') from ordered o where a.id = o.id;

create or replace function set_appt_no() returns trigger language plpgsql as $$
begin
  if new.appt_no is null then new.appt_no := 'APT-' || lpad(nextval('appointment_seq')::text, 5, '0'); end if;
  return new;
end $$;
drop trigger if exists trg_appt_no on appointments;
create trigger trg_appt_no before insert on appointments for each row execute function set_appt_no();

create index if not exists appointments_clinic_created_idx on appointments (clinic_id, created_at desc);
create index if not exists appointments_appt_no_idx on appointments (clinic_id, appt_no);
