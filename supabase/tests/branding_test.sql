\set ON_ERROR_STOP 1
do $$ declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); sa text; sb text; j jsonb;
begin
  insert into clinics(id,name,specialty) values (a,'The Tooth Clinic','Dental'),(b,'The Tooth Clinic','Dental');
  select slug into sa from clinics where id=a; select slug into sb from clinics where id=b;
  assert sa = 'the-tooth-clinic', 'slug a '||sa;
  assert sb = 'the-tooth-clinic-2', 'slug b '||sb;
  assert (public_clinic('the-tooth-clinic', null)->>'name') is not null;
  update clinics set custom_domain='tooth.example.com', domain_verified=false where id=a;
  assert public_clinic(null,'tooth.example.com') is null, 'unverified domain must not resolve';
  update clinics set domain_verified=true where id=a;
  assert public_clinic(null,'TOOTH.example.com')->>'slug' = 'the-tooth-clinic';
  begin update clinics set custom_domain='tooth.example.com', domain_verified=true where id=b; raise exception 'should fail';
  exception when unique_violation then null; end;
  begin update clinics set primary_color='red' where id=a; raise exception 'should fail';
  exception when check_violation then null; end;
  assert clinic_make_slug('www') = 'www-clinic';
  raise notice 'ALL BRANDING TESTS PASSED';
end $$;
