-- 012: owner dashboard numbers, computed live in one place so the screen and the demo describe the same maths.
--   appointments today   = confirmed + completed on the clinic's calendar day (cancelled / no-show excluded)
--   billed today         = invoices raised today (not cancelled); collected = what has been paid on them
--   outstanding          = unpaid balance on all open invoices (sent / partially paid), including treatment-sitting invoices
--   chair utilisation    = booked minutes / available minutes (working hours minus breaks, doctors on leave count zero)
--   no-show rate         = last 30 days: no_show / (completed + no_show)
--   trend                = invoices paid amount by day, last 7 days
-- Service-role only; the API checks the caller. Re-runnable.

create or replace function dashboard_stats(p_clinic uuid, p_actor uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  tz text := appt_clinic_tz(p_clinic);
  d date := (now() at time zone appt_clinic_tz(p_clinic))::date;
  r jsonb;
begin
  with
  appts as (select * from appointments where clinic_id = p_clinic and appointment_date = d),
  booked as (select coalesce(sum(duration_minutes), 0) as m from appts where status in ('confirmed', 'completed')),
  avail as (
    select coalesce(sum(extract(epoch from (s.end_time - s.start_time)) / 60
                        - coalesce(extract(epoch from (s.break_end - s.break_start)) / 60, 0)), 0) as m
    from doctor_schedules s join doctors dr on dr.id = s.doctor_id and coalesce(dr.is_active, true)
    where s.clinic_id = p_clinic and s.is_active and s.weekday = extract(dow from d)::int
      and not exists (select 1 from doctor_leaves l where l.doctor_id = s.doctor_id and d between l.from_date and l.to_date)
  ),
  inv_today as (
    select coalesce(sum(total), 0) as billed, coalesce(sum(least(paid_amount, total)), 0) as collected
    from invoices where clinic_id = p_clinic and status <> 'cancelled' and (created_at at time zone tz)::date = d
  ),
  outst as (
    select coalesce(sum(total - paid_amount), 0) as amt, count(*) as n
    from invoices where clinic_id = p_clinic and status in ('sent', 'partially_paid') and total > paid_amount
  ),
  ns as (
    select count(*) filter (where status = 'no_show') as no_show, count(*) filter (where status in ('completed', 'no_show')) as seen
    from appointments where clinic_id = p_clinic and appointment_date between d - 30 and d
  ),
  days as (select generate_series(d - 6, d, interval '1 day')::date as day),
  trend as (
    select days.day, coalesce(sum(least(i.paid_amount, i.total)), 0) as collected
    from days left join invoices i on i.clinic_id = p_clinic and i.status <> 'cancelled' and (i.created_at at time zone tz)::date = days.day
    group by days.day order by days.day
  ),
  load as (
    select dr.name, count(a.id) filter (where a.status in ('confirmed', 'completed')) as appointments,
           coalesce(sum(a.duration_minutes) filter (where a.status in ('confirmed', 'completed')), 0) as minutes
    from doctors dr left join appts a on a.doctor_id = dr.id
    where dr.clinic_id = p_clinic and coalesce(dr.is_active, true) group by dr.id, dr.name order by dr.name
  ),
  stock as (
    select count(*) filter (where min_quantity is not null and quantity <= min_quantity) as low,
           coalesce(jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'min', min_quantity) order by quantity)
                    filter (where min_quantity is not null and quantity <= min_quantity), '[]'::jsonb) as items
    from stock_items where clinic_id = p_clinic
  )
  select jsonb_build_object(
    'day', d,
    'appointments_today', (select count(*) from appts where status in ('confirmed', 'completed')),
    'completed_today', (select count(*) from appts where status = 'completed'),
    'total_patients', (select count(*) from clinic_patients where clinic_id = p_clinic),
    'billed_today', (select billed from inv_today),
    'collected_today', (select collected from inv_today),
    'collection_rate', (select case when billed > 0 then round(collected / billed * 100) end from inv_today),
    'outstanding', (select amt from outst), 'outstanding_invoices', (select n from outst),
    'utilisation_pct', (select case when (select m from avail) > 0 then least(100, round((select m from booked) / (select m from avail) * 100)) end),
    'booked_minutes', (select m from booked), 'available_minutes', (select m from avail),
    'no_show_pct', (select case when seen > 0 then round(no_show::numeric / seen * 100) end from ns),
    'no_shows_30d', (select no_show from ns),
    'trend', (select jsonb_agg(jsonb_build_object('day', day, 'collected', collected) order by day) from trend),
    'doctors', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'appointments', appointments, 'minutes', minutes) order by name), '[]'::jsonb) from load),
    'low_stock', (select low from stock), 'low_stock_items', (select items from stock)
  ) into r;
  return r;
end $$;
revoke all on function dashboard_stats(uuid, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function dashboard_stats(uuid, uuid) to service_role; end if;
end $$;
