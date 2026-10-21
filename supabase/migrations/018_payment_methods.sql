-- Payment methods the clinic uses at the counter: physical (cash or card at the desk), QR, UPI and online (a payment link).
-- Only "physical" is switched on in the app for now; the others are accepted by the database so they can be enabled later.
-- Safe to run again.
alter table invoices drop constraint if exists invoices_payment_method_check;
alter table invoices add constraint invoices_payment_method_check
  check (payment_method is null or payment_method in ('cash','upi','card','insurance','other','physical','qr','online'));
alter table invoices alter column payment_method set default 'physical';
