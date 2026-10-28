-- Clinic stamp / seal image, printed at the bottom right of every invoice.
alter table clinics add column if not exists stamp_url text;
