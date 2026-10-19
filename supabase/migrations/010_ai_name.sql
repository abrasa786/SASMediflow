-- 010: the clinic names its AI assistant; the name shows on the assistant, the builder and the public page.
-- Safe to re-run.
alter table clinics add column if not exists ai_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinics_ai_name_chk') then
    alter table clinics add constraint clinics_ai_name_chk check (ai_name is null or ai_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,23}$');
  end if;
end $$;

create or replace function public_clinic(p_slug text, p_host text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinics%rowtype;
begin
  if coalesce(p_slug, '') <> '' then
    select * into c from clinics where lower(slug) = lower(p_slug) and coalesce(is_active, true);
  elsif coalesce(p_host, '') <> '' then
    select * into c from clinics where lower(custom_domain) = lower(p_host) and domain_verified and coalesce(is_active, true);
  end if;
  if not found then return null; end if;
  return jsonb_build_object(
    'slug', c.slug, 'name', coalesce(c.brand_name, c.name), 'legal_name', c.name, 'tagline', c.tagline, 'ai_name', c.ai_name,
    'logo_url', c.logo_url, 'primary_color', c.primary_color, 'address', c.address, 'city', c.city,
    'phone', c.phone, 'email', c.email, 'website', c.website, 'specialty', c.specialty,
    'custom_domain', case when c.domain_verified then c.custom_domain end,
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'specialty', coalesce(d.specialty, d.speciality), 'experience_years', d.experience_years) order by d.name)
                           from doctors d where d.clinic_id = c.id and coalesce(d.is_active, true)), '[]'::jsonb));
end $$;
revoke all on function public_clinic(text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function public_clinic(text, text) to service_role; end if;
end $$;
