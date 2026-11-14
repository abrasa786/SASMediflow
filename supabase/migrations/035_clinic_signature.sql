-- Authorised signature, printed beside the stamp at the bottom right of every invoice.
alter table clinics add column if not exists signature_url text;
