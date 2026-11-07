-- Smart Parking Kampus - schema database (Supabase self-hosted "storage")
-- Semua tabel diberi prefix `parking_` agar aman di schema public yang dipakai bersama.
-- Akses dari browser hanya lewat fungsi RPC (SECURITY DEFINER); tabel dikunci RLS.
--
-- Terapkan dengan:
--   docker exec -i supabase-db psql -U postgres -d postgres < supabase/schema.sql

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------------

create table if not exists public.parking_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  faculty text not null,
  capacity integer not null check (capacity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.parking_bookings (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  plate text not null,
  plate_locked text,
  vehicle_type text not null default 'unknown',
  zone_id uuid references public.parking_zones(id),
  eta timestamptz not null,
  etd timestamptz not null,
  phone text,
  status text not null default 'booked',
  session_code text not null unique,
  exit_code text unique,
  entry_at timestamptz,
  entry_confidence numeric,
  parked_at timestamptz,
  checkout_at timestamptz,
  paid_at timestamptz,
  exit_at timestamptz,
  base_fee integer not null default 2000,
  violation_fee integer not null default 0,
  total_fee integer not null default 0,
  payment_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parking_bookings_status_check check (
    status in ('booked', 'active', 'parked', 'checkout', 'paid', 'closed', 'expired', 'cancelled')
  )
);

create index if not exists parking_bookings_device_idx on public.parking_bookings (device_id, created_at desc);
create index if not exists parking_bookings_zone_idx on public.parking_bookings (zone_id, status);
create index if not exists parking_bookings_status_idx on public.parking_bookings (status);

create table if not exists public.parking_loyalty (
  device_id text primary key,
  points integer not null default 0,
  sessions integer not null default 0,
  violations integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.parking_events (
  id bigserial primary key,
  booking_id uuid references public.parking_bookings(id) on delete cascade,
  kind text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists parking_events_booking_idx on public.parking_events (booking_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------

create or replace function public.parking_norm_plate(p_plate text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(upper(coalesce(p_plate, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.parking_new_code(p_prefix text)
returns text
language sql
volatile
as $$
  select p_prefix || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

-- Bentuk JSON booking yang dikirim ke aplikasi (aman: tanpa data sensitif lain).
create or replace function public.parking_booking_out(b public.parking_bookings)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(b)
    || jsonb_build_object(
         'zone_name', z.name,
         'zone_faculty', z.faculty,
         'zone_public_code', z.code,
         'loyalty_points', coalesce(l.points, 0),
         'overstay', (b.checkout_at is not null and b.violation_fee > 0)
       )
  from public.parking_zones z
  left join public.parking_loyalty l on l.device_id = b.device_id
  where z.id = b.zone_id;
$$;

-- ---------------------------------------------------------------------------
-- RPC untuk aplikasi
-- ---------------------------------------------------------------------------

-- Daftar zona + ketersediaan real-time. Sekaligus menandai booking telat datang.
create or replace function public.parking_zones_list()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_zones jsonb;
begin
  update public.parking_bookings
     set status = 'expired', updated_at = now()
   where status = 'booked'
     and eta + interval '10 minutes' < now();

  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb)
    into v_zones
  from (
    select jsonb_build_object(
             'id', z.id,
             'code', z.code,
             'name', z.name,
             'faculty', z.faculty,
             'capacity', z.capacity,
             'occupied', count(b.id) filter (where b.status in ('active', 'parked', 'checkout')),
             'available', z.capacity - count(b.id) filter (where b.status in ('active', 'parked', 'checkout'))
           ) as x
      from public.parking_zones z
      left join public.parking_bookings b on b.zone_id = z.id
     where z.is_active
     group by z.id
  ) s;

  return jsonb_build_object('ok', true, 'zones', v_zones);
end;
$$;

-- Buat booking baru + QR sesi.
create or replace function public.parking_booking_create(
  p_device text,
  p_plate text,
  p_zone uuid,
  p_eta timestamptz,
  p_etd timestamptz,
  p_phone text default null,
  p_vehicle_type text default 'unknown'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone public.parking_zones;
  v_occupied integer;
  v_open public.parking_bookings;
  v_b public.parking_bookings;
  v_plate text;
begin
  v_plate := public.parking_norm_plate(p_plate);

  if p_device is null or length(btrim(p_device)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'device_invalid');
  end if;
  if v_plate = '' then
    return jsonb_build_object('ok', false, 'error', 'plate_required');
  end if;
  if p_eta is null or p_etd is null or p_etd <= p_eta then
    return jsonb_build_object('ok', false, 'error', 'time_invalid');
  end if;

  select * into v_zone from public.parking_zones where id = p_zone and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'zone_not_found');
  end if;

  update public.parking_bookings
     set status = 'expired', updated_at = now()
   where status = 'booked'
     and eta + interval '10 minutes' < now();

  select count(*) into v_occupied
    from public.parking_bookings
   where zone_id = p_zone
     and status in ('active', 'parked', 'checkout');

  if v_occupied >= v_zone.capacity then
    return jsonb_build_object('ok', false, 'error', 'zone_full', 'zone', v_zone.name);
  end if;

  select * into v_open
    from public.parking_bookings
   where device_id = btrim(p_device)
     and status in ('booked', 'active', 'parked', 'checkout', 'paid')
   order by created_at desc
   limit 1;

  if found then
    return jsonb_build_object('ok', false, 'error', 'has_open_booking', 'booking', public.parking_booking_out(v_open));
  end if;

  insert into public.parking_bookings (device_id, plate, vehicle_type, zone_id, eta, etd, phone, session_code)
  values (
    btrim(p_device),
    v_plate,
    coalesce(nullif(btrim(p_vehicle_type), ''), 'unknown'),
    p_zone,
    p_eta,
    p_etd,
    nullif(btrim(coalesce(p_phone, '')), ''),
    public.parking_new_code('SP')
  )
  returning * into v_b;

  insert into public.parking_events (booking_id, kind, detail)
  values (v_b.id, 'created', jsonb_build_object('zone', v_zone.code, 'eta', p_eta, 'etd', p_etd, 'plate', v_plate));

  return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
end;
$$;

-- Ambil booking berdasarkan kode sesi atau kode keluar.
create or replace function public.parking_booking_get(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.parking_bookings;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'code_required');
  end if;

  select * into v_b
    from public.parking_bookings
   where session_code = v_code or exit_code = v_code
   order by created_at desc
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
end;
$$;

-- Riwayat booking untuk satu perangkat (device id disimpan di browser).
create or replace function public.parking_booking_list(p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  if p_device is null or length(btrim(p_device)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'device_invalid', 'items', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
    into v_items
  from (
    select public.parking_booking_out(b) as x
      from public.parking_bookings b
     where b.device_id = btrim(p_device)
     order by b.created_at desc
     limit 20
  ) s;

  return jsonb_build_object('ok', true, 'items', v_items);
end;
$$;

-- Gate masuk: validasi QR sesi + plat hasil VLM, lalu kunci sesi ke plat.
create or replace function public.parking_gate_entry(
  p_code text,
  p_plate text,
  p_confidence numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.parking_bookings;
  v_plate text := public.parking_norm_plate(p_plate);
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into v_b
    from public.parking_bookings
   where session_code = v_code
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_b.status = 'booked' and now() > v_b.eta + interval '10 minutes' then
    update public.parking_bookings
       set status = 'expired', updated_at = now()
     where id = v_b.id;
    insert into public.parking_events (booking_id, kind, detail)
    values (v_b.id, 'expired_late', jsonb_build_object('eta', v_b.eta, 'now', now()));
    return jsonb_build_object('ok', false, 'error', 'expired_late', 'booking', public.parking_booking_out(v_b));
  end if;

  if v_b.status not in ('booked', 'active') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_b.status);
  end if;

  if v_plate = '' then
    return jsonb_build_object('ok', false, 'error', 'plate_required');
  end if;

  -- Plat harus cocok dengan booking. VLM bisa salah baca: petugas dapat mengulang foto.
  if v_plate <> v_b.plate then
    insert into public.parking_events (booking_id, kind, detail)
    values (v_b.id, 'entry_plate_mismatch', jsonb_build_object('expected', v_b.plate, 'detected', v_plate, 'confidence', p_confidence));
    return jsonb_build_object(
      'ok', false,
      'error', 'plate_mismatch',
      'expected', v_b.plate,
      'detected', v_plate
    );
  end if;

  update public.parking_bookings
     set status = 'active',
         entry_at = coalesce(entry_at, now()),
         plate_locked = v_plate,
         entry_confidence = p_confidence,
         updated_at = now()
   where id = v_b.id
   returning * into v_b;

  insert into public.parking_events (booking_id, kind, detail)
  values (v_b.id, 'gate_entry', jsonb_build_object('plate', v_plate, 'confidence', p_confidence));

  return jsonb_build_object('ok', true, 'gate', 'open', 'booking', public.parking_booking_out(v_b));
end;
$$;

-- Scan QR zona: konfirmasi kendaraan sudah terparkir di zona yang benar.
create or replace function public.parking_zone_confirm(p_code text, p_zone_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.parking_bookings;
  v_zone public.parking_zones;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_zone_code text := upper(btrim(coalesce(p_zone_code, '')));
begin
  select * into v_b from public.parking_bookings where session_code = v_code limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_zone from public.parking_zones where id = v_b.zone_id;

  if v_zone_code <> '' and upper(v_zone.code) <> v_zone_code then
    return jsonb_build_object('ok', false, 'error', 'zone_mismatch', 'expected', v_zone.code);
  end if;

  if v_b.status = 'parked' then
    return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
  end if;

  if v_b.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_b.status);
  end if;

  update public.parking_bookings
     set status = 'parked', parked_at = now(), updated_at = now()
   where id = v_b.id
   returning * into v_b;

  insert into public.parking_events (booking_id, kind, detail)
  values (v_b.id, 'zone_parked', jsonb_build_object('zone', v_zone.code));

  return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
end;
$$;

-- Scan QR zona kedua kali: mulai checkout & hitung bill (normal / overstay).
create or replace function public.parking_checkout_start(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.parking_bookings;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_overstay boolean;
  v_violation integer := 0;
begin
  select * into v_b from public.parking_bookings where session_code = v_code limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_b.status = 'checkout' then
    return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
  end if;

  if v_b.status <> 'parked' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_b.status);
  end if;

  -- Grace overstay 10 menit dari ETD (dapat diubah di sini bila kebijakan final berbeda).
  v_overstay := now() > v_b.etd + interval '10 minutes';
  if v_overstay then
    v_violation := 1000;
  end if;

  update public.parking_bookings
     set status = 'checkout',
         checkout_at = now(),
         violation_fee = v_violation,
         total_fee = base_fee + v_violation,
         updated_at = now()
   where id = v_b.id
   returning * into v_b;

  if v_overstay then
    insert into public.parking_events (booking_id, kind, detail)
    values (v_b.id, 'overstay', jsonb_build_object('etd', v_b.etd, 'checkout_at', v_b.checkout_at, 'fee', v_violation));
  end if;

  insert into public.parking_events (booking_id, kind, detail)
  values (v_b.id, 'checkout_started', jsonb_build_object('total_fee', v_b.total_fee));

  return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
end;
$$;

-- Bayar di aplikasi (simulasi QRIS): lunas -> terbitkan kode keluar.
create or replace function public.parking_pay(p_code text, p_method text default 'qris')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.parking_bookings;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_exit text;
begin
  select * into v_b from public.parking_bookings where session_code = v_code limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_b.status = 'paid' or v_b.status = 'closed' then
    return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
  end if;

  if v_b.status <> 'checkout' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_b.status);
  end if;

  v_exit := public.parking_new_code('EX');

  update public.parking_bookings
     set status = 'paid',
         paid_at = now(),
         payment_method = coalesce(nullif(btrim(p_method), ''), 'qris'),
         exit_code = v_exit,
         updated_at = now()
   where id = v_b.id
   returning * into v_b;

  insert into public.parking_loyalty (device_id, points, sessions, violations, updated_at)
  values (
    v_b.device_id,
    case when v_b.violation_fee > 0 then 0 else 2 end,
    1,
    case when v_b.violation_fee > 0 then 1 else 0 end,
    now()
  )
  on conflict (device_id) do update
     set points = greatest(0, public.parking_loyalty.points + case when v_b.violation_fee > 0 then -1 else 2 end),
         sessions = public.parking_loyalty.sessions + 1,
         violations = public.parking_loyalty.violations + case when v_b.violation_fee > 0 then 1 else 0 end,
         updated_at = now();

  insert into public.parking_events (booking_id, kind, detail)
  values (v_b.id, 'paid', jsonb_build_object('method', v_b.payment_method, 'total', v_b.total_fee, 'exit_code', v_exit));

  return jsonb_build_object('ok', true, 'booking', public.parking_booking_out(v_b));
end;
$$;

-- Gate keluar: verifikasi kode keluar + plat harus sama dengan yang dikunci saat masuk.
create or replace function public.parking_gate_exit(
  p_code text,
  p_plate text,
  p_confidence numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.parking_bookings;
  v_plate text := public.parking_norm_plate(p_plate);
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  select * into v_b from public.parking_bookings where exit_code = v_code limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_b.status = 'closed' then
    return jsonb_build_object('ok', true, 'gate', 'open', 'booking', public.parking_booking_out(v_b));
  end if;

  if v_b.status <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_b.status);
  end if;

  if v_plate = '' then
    return jsonb_build_object('ok', false, 'error', 'plate_required');
  end if;

  if v_plate <> coalesce(v_b.plate_locked, v_b.plate) then
    insert into public.parking_events (booking_id, kind, detail)
    values (v_b.id, 'exit_plate_mismatch', jsonb_build_object('expected', coalesce(v_b.plate_locked, v_b.plate), 'detected', v_plate, 'confidence', p_confidence));
    return jsonb_build_object(
      'ok', false,
      'error', 'plate_mismatch',
      'expected', coalesce(v_b.plate_locked, v_b.plate),
      'detected', v_plate
    );
  end if;

  update public.parking_bookings
     set status = 'closed', exit_at = now(), updated_at = now()
   where id = v_b.id
   returning * into v_b;

  insert into public.parking_events (booking_id, kind, detail)
  values (v_b.id, 'gate_exit', jsonb_build_object('plate', v_plate, 'confidence', p_confidence));

  return jsonb_build_object('ok', true, 'gate', 'open', 'booking', public.parking_booking_out(v_b));
end;
$$;

-- ---------------------------------------------------------------------------
-- Keamanan: tabel tertutup, akses hanya lewat RPC di atas.
-- ---------------------------------------------------------------------------

alter table public.parking_zones enable row level security;
alter table public.parking_bookings enable row level security;
alter table public.parking_loyalty enable row level security;
alter table public.parking_events enable row level security;

revoke all on public.parking_zones, public.parking_bookings, public.parking_loyalty, public.parking_events from anon, authenticated;
revoke all on sequence public.parking_events_id_seq from anon, authenticated;

grant usage on schema public to anon, authenticated;

grant execute on function public.parking_zones_list() to anon, authenticated;
grant execute on function public.parking_booking_create(text, text, uuid, timestamptz, timestamptz, text, text) to anon, authenticated;
grant execute on function public.parking_booking_get(text) to anon, authenticated;
grant execute on function public.parking_booking_list(text) to anon, authenticated;
grant execute on function public.parking_gate_entry(text, text, numeric) to anon, authenticated;
grant execute on function public.parking_zone_confirm(text, text) to anon, authenticated;
grant execute on function public.parking_checkout_start(text) to anon, authenticated;
grant execute on function public.parking_pay(text, text) to anon, authenticated;
grant execute on function public.parking_gate_exit(text, text, numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed zona (aman dijalankan ulang)
-- ---------------------------------------------------------------------------

insert into public.parking_zones (code, name, faculty, capacity)
values
  ('ZONE-TEKNIK-01', 'Parkir Teknik', 'Fakultas Teknik', 40),
  ('ZONE-FEB-01', 'Parkir FEB', 'Fakultas Ekonomi & Bisnis', 30),
  ('ZONE-FKIP-01', 'Parkir FKIP', 'Fakultas Keguruan & Ilmu Pendidikan', 35),
  ('ZONE-SAINS-01', 'Parkir Sains', 'Fakultas Sains & Teknologi', 25),
  ('ZONE-REKTORAT-01', 'Parkir Rektorat', 'Area Rektorat', 20)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
