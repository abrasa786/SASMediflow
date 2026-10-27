-- 028: the Builder (and later the phone agent) learns from what the clinic approves, so nobody has to train it.
-- Every plan an admin approves is remembered for that clinic. Next time the same or a very similar request comes in,
-- it is answered straight from memory (and re-checked against the clinic's current setup first). Server-only table. Safe to run again.
create table if not exists ai_memory (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics(id) on delete cascade,
  module       text not null default 'builder',
  key          text not null,
  prompt       text not null,
  plan         jsonb not null,
  uses         int  not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (clinic_id, module, key)
);
create index if not exists ai_memory_clinic_idx on ai_memory (clinic_id, module, last_used_at desc);
alter table ai_memory enable row level security;   -- no policy: only the server reads and writes it
