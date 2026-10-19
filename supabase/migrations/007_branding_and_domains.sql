-- 007: clinic branding (logo, colour, tagline), public web address (slug) and custom domain.
-- Safe to re-run.

alter table clinics add column if not exists slug              text;
alter table clinics add column if not exists custom_domain     text;
alter table clinics add column if not exists domain_verified   boolean not null default false;
alter table clinics add column if not exists domain_token      text;
alter table clinics add column if not exists domain_verified_at timestamptz;
alter table clinics add column if not exists primary_color     text;
alter table clinics add column if not exists tagline           text;
alter table clinics add column if not exists website           text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clinics_primary_color_chk') then
    alter table clinics add constraint clinics_primary_color_chk check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clinics_slug_chk') then
    alter table clinics add constraint clinics_slug_chk check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
  end if;
end $$;

-- One public address per clinic. A custom domain is exclusive only once it is verified,
-- so nobody can block the real owner of a domain by typing it in first.
create unique index if not exists clinics_slug_uidx on clinics (lower(slug)) where slug is not null;
create unique index if not exists clinics_domain_verified_uidx on clinics (lower(custom_domain)) where domain_verified and custom_domain is not null;
create index if not exists clinics_domain_idx on clinics (lower(custom_domain)) where custom_domain is not null;

create or replace function clinic_make_slug(p_name text, p_self uuid default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare base text; cand text; n int := 1;
begin
  base := lower(regexp_replace(coalesce(p_name, 'clinic'), '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  if length(base) < 3 then base := 'clinic'; end if;
  base := left(base, 30); base := trim(both '-' from base);
  if base in ('www','app','api','admin','login','signup','demo','c','setup','dashboard','static','mail','help','support','billing','settings') then base := base || '-clinic'; end if;
  cand := base;
  while exists (select 1 from clinics where lower(slug) = cand and (p_self is null or id <> p_self)) loop
    n := n + 1; cand := left(base, 30) || '-' || n;
    if n > 500 then cand := base || '-' || substr(md5(random()::text), 1, 6); exit; end if;
  end loop;
  return cand;
end $$;

create or replace function clinics_default_slug() returns trigger language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then new.slug := clinic_make_slug(coalesce(new.brand_name, new.name), new.id); end if;
  return new;
end $$;
drop trigger if exists clinics_default_slug_trg on clinics;
create trigger clinics_default_slug_trg before insert on clinics for each row execute function clinics_default_slug();

-- existing clinics get an address too
do $$ declare r record; begin
  for r in select id, coalesce(brand_name, name) as nm from clinics where slug is null loop
    update clinics set slug = clinic_make_slug(r.nm, r.id) where id = r.id;
  end loop;
end $$;

-- What a visitor (not signed in) may see about a clinic: found by slug, or by a VERIFIED custom domain.
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
    'slug', c.slug, 'name', coalesce(c.brand_name, c.name), 'legal_name', c.name, 'tagline', c.tagline,
    'logo_url', c.logo_url, 'primary_color', c.primary_color, 'address', c.address, 'city', c.city,
    'phone', c.phone, 'email', c.email, 'website', c.website, 'specialty', c.specialty,
    'custom_domain', case when c.domain_verified then c.custom_domain end,
    'doctors', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'specialty', coalesce(d.specialty, d.speciality), 'experience_years', d.experience_years) order by d.name)
                           from doctors d where d.clinic_id = c.id and coalesce(d.is_active, true)), '[]'::jsonb));
end $$;

revoke all on function public_clinic(text, text) from public, anon, authenticated;
revoke all on function clinic_make_slug(text, uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public_clinic(text, text) to service_role;
    grant execute on function clinic_make_slug(text, uuid) to service_role;
  end if;
end $$;
