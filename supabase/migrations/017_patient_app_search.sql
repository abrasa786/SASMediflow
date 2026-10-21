-- 017: let the Mediflow patient app find clinics.
--   clinics.latitude / longitude   where the clinic is (set in Settings)
--   clinics.listed_in_app          the clinic's own choice to appear in the patient app (off by default)
--   public_clinic_search           nearby clinics, within a fee limit, with the lowest doctor fee. Public facts only, never patient data.
-- Safe to run again.

alter table clinics add column if not exists latitude  double precision;
alter table clinics add column if not exists longitude double precision;
alter table clinics add column if not exists listed_in_app boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinics_geo_chk') then
    alter table clinics add constraint clinics_geo_chk check ((latitude is null or latitude between -90 and 90) and (longitude is null or longitude between -180 and 180));
  end if;
end $$;
create index if not exists clinics_listed_idx on clinics (listed_in_app) where listed_in_app;

create or replace function public_clinic_search(
  p_lat double precision default null, p_lng double precision default null, p_radius_km double precision default 25,
  p_max_fee numeric default null, p_specialty text default null, p_q text default null,
  p_include_unknown boolean default true, p_limit int default 20
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with base as (
    select c.id, c.slug, coalesce(c.brand_name, c.name) as name, c.specialty, c.address, c.city, c.phone, c.logo_url, c.latitude, c.longitude,
           f.min_fee, f.doctors,
           coalesce((c.settings->'online_booking'->>'enabled')::boolean, false) as bookable,
           coalesce(nullif(c.settings->'online_booking'->>'fee', '')::numeric, 0) as booking_fee,
           case when p_lat is null or p_lng is null then null else
             6371 * 2 * asin(least(1, sqrt(power(sin(radians(c.latitude - p_lat) / 2), 2)
               + cos(radians(p_lat)) * cos(radians(c.latitude)) * power(sin(radians(c.longitude - p_lng) / 2), 2)))) end as km
    from clinics c
    cross join lateral (select min(d.consultation_fee) filter (where d.consultation_fee > 0) as min_fee, count(*)::int as doctors
                          from doctors d where d.clinic_id = c.id and coalesce(d.is_active, true)) f
    where c.listed_in_app and coalesce(c.is_active, true) and c.slug is not null and c.latitude is not null and c.longitude is not null
      and (p_specialty is null or coalesce(c.specialty, '') ~* p_specialty      -- p_specialty is a case-insensitive pattern built by the server, e.g. 'eye|ophthal'
           or exists (select 1 from doctors d where d.clinic_id = c.id and coalesce(d.is_active, true)
                        and coalesce(d.specialty, d.speciality, '') ~* p_specialty))
      and (p_q is null or c.name ilike '%' || p_q || '%' or coalesce(c.brand_name, '') ilike '%' || p_q || '%' or coalesce(c.city, '') ilike '%' || p_q || '%' or coalesce(c.address, '') ilike '%' || p_q || '%')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'slug', slug, 'name', name, 'specialty', specialty, 'address', address, 'city', city, 'phone', phone, 'logo_url', logo_url,
      'lat', latitude, 'lng', longitude, 'distance_km', round(km::numeric, 1), 'min_fee', min_fee, 'doctors', doctors,
      'online_booking', bookable, 'booking_fee', booking_fee) order by bookable desc, km nulls last, min_fee nulls last, name), '[]'::jsonb)
  from (select * from base
         where (km is null or p_radius_km is null or km <= p_radius_km)
           and (p_max_fee is null or (min_fee is null and coalesce(p_include_unknown, true)) or min_fee <= p_max_fee)
         order by bookable desc, km nulls last, min_fee nulls last, name
         limit least(greatest(coalesce(p_limit, 20), 1), 50)) x;
$$;

revoke all on function public_clinic_search(double precision, double precision, double precision, numeric, text, text, boolean, int) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public_clinic_search(double precision, double precision, double precision, numeric, text, text, boolean, int) to service_role;
  end if;
end $$;
