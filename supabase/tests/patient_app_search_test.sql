-- 017: only clinics that chose to be listed appear; nearest and bookable first; fee filter; no private data.
\set ON_ERROR_STOP on
begin;
insert into clinics(id,name,slug,specialty,city,is_active,listed_in_app,latitude,longitude,settings) values
 ('a1700000-0000-0000-0000-000000000001','Near Dental','near-dental','Dentistry','Bengaluru',true,true,12.9352,77.6245,'{"online_booking":{"enabled":true,"fee":100}}'),
 ('a1700000-0000-0000-0000-000000000002','Far Dental','far-dental','Dentistry','Bengaluru',true,true,13.0827,77.5877,'{}'),
 ('a1700000-0000-0000-0000-000000000003','Hidden Clinic','hidden','Dentistry','Bengaluru',true,false,12.9352,77.6245,'{}'),
 ('a1700000-0000-0000-0000-000000000004','Closed Clinic','closed','Dentistry','Bengaluru',false,true,12.9352,77.6245,'{}'),
 ('a1700000-0000-0000-0000-000000000005','No Fee Eye','no-fee-eye','Ophthalmology','Bengaluru',true,true,12.9400,77.6200,'{}'),
 ('a1700000-0000-0000-0000-000000000006','Other City Dental','other-city','Dentistry','Chennai',true,true,13.0827,80.2707,'{}');
insert into doctors(clinic_id,name,consultation_fee) values
 ('a1700000-0000-0000-0000-000000000001','Dr N1',500),('a1700000-0000-0000-0000-000000000001','Dr N2',300),
 ('a1700000-0000-0000-0000-000000000002','Dr F',200),
 ('a1700000-0000-0000-0000-000000000003','Dr H',100),
 ('a1700000-0000-0000-0000-000000000006','Dr C',100);
do $$ declare r jsonb; begin
  r := public_clinic_search(12.9300, 77.6200, 25);
  assert (select count(*) from jsonb_array_elements(r)) = 3, 'listed, active, within 25 km: near, far, no-fee (not hidden, closed or Chennai)';
  assert r->0->>'slug' = 'near-dental', 'bookable clinic first, and it is also the nearest';
  assert (r->0->>'min_fee')::numeric = 300, 'lowest doctor fee';
  assert (r->0->>'online_booking')::boolean and (r->0->>'booking_fee')::numeric = 100, 'booking flag and fee';
  assert (r->0->>'distance_km')::numeric < 2, 'distance in km';
  r := public_clinic_search(12.9300, 77.6200, 25, 250);
  assert (select array_agg(x->>'slug' order by x->>'slug') from jsonb_array_elements(r) x) = array['far-dental','no-fee-eye'], 'fee filter keeps cheaper clinics and unknown fees';
  r := public_clinic_search(12.9300, 77.6200, 25, 250, null, null, false);
  assert (select count(*) from jsonb_array_elements(r)) = 1, 'unknown fees can be left out';
  r := public_clinic_search(12.9300, 77.6200, 25, null, 'eye|ophthal');
  assert (select count(*) from jsonb_array_elements(r)) = 1 and r->0->>'slug' = 'no-fee-eye', 'specialty filter';
  r := public_clinic_search(12.9300, 77.6200, 25, null, '\yent\y');
  assert (select count(*) from jsonb_array_elements(r)) = 0, 'ENT does not match Dentistry';
  r := public_clinic_search(null, null, null, null, null, 'chennai');
  assert (select count(*) from jsonb_array_elements(r)) = 1, 'text search works without a location';
  r := public_clinic_search(12.9300, 77.6200, 25);
  assert not (r::text ~* 'settings|email|gst|domain_token'), 'no private fields leak';
end $$;
rollback;
\echo ALL PATIENT APP SEARCH TESTS PASSED
