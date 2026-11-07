-- Durable history for Smart Parking (optional Supabase/Postgres persistence)
-- The API writes here when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.

create table if not exists public.parking_history (
  id bigserial primary key,
  kind text not null default 'session',
  session_code text not null,
  status text,
  zone_id text,
  domain_id text,
  vehicle_type text,
  plate text,
  bill_total integer,
  penalty_total integer default 0,
  eta text,
  created_at timestamptz,
  entry_time timestamptz,
  exit_time timestamptz,
  recorded_at timestamptz not null default now(),
  payload jsonb
);

create index if not exists parking_history_session_idx on public.parking_history (session_code);
create index if not exists parking_history_recorded_idx on public.parking_history (recorded_at desc);
create index if not exists parking_history_zone_idx on public.parking_history (zone_id, recorded_at desc);

alter table public.parking_history enable row level security;
-- The backend uses the service-role key, which bypasses RLS.
