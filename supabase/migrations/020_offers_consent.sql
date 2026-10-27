-- 020: patients can say yes to occasional tips and offers on WhatsApp (and stop any time).
-- The date and where they agreed are kept, so the clinic can show consent was given.
-- Nothing is sent to a patient unless marketing_opt_in is true. Safe to run again.

alter table clinic_patients add column if not exists marketing_opt_in boolean not null default false;
alter table clinic_patients add column if not exists marketing_opt_in_at timestamptz;
alter table clinic_patients add column if not exists marketing_opt_in_source text;   -- 'online_booking', 'front_desk', ...
alter table clinic_patients add column if not exists marketing_opt_out_at timestamptz;
