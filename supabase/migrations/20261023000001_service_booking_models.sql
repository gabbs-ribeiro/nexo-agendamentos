-- Additional service models: capacity-based periods and configurable timed stays.
-- Existing hourly and date-only daily bookings remain valid and untouched.

do $$
begin
  if pg_catalog.to_regclass('public.services') is null
     or pg_catalog.to_regclass('public.service_options') is null
     or pg_catalog.to_regclass('public.stay_bookings') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'services'
          and column_name = 'booking_mode'
     ) then
    raise exception 'Apply migrations through 20261022000002 before this migration';
  end if;
end;
$$;

alter table public.services drop constraint if exists services_booking_mode_check;
alter table public.services add constraint services_booking_mode_check
  check (booking_mode in ('hourly', 'daily', 'periods', 'stay'));
grant insert (booking_mode) on public.services to authenticated;
grant update (booking_mode) on public.services to authenticated;

update public.businesses set stay_capacity = 4 where stay_capacity > 4;
alter table public.businesses drop constraint if exists businesses_stay_capacity;
alter table public.businesses add constraint businesses_stay_capacity
  check (stay_capacity between 1 and 4);

alter table public.service_options
  add column if not exists morning_price_cents integer
    check (morning_price_cents is null or morning_price_cents >= 0),
  add column if not exists afternoon_price_cents integer
    check (afternoon_price_cents is null or afternoon_price_cents >= 0),
  add column if not exists full_day_price_cents integer
    check (full_day_price_cents is null or full_day_price_cents >= 0);
grant insert (morning_price_cents, afternoon_price_cents, full_day_price_cents)
  on public.service_options to authenticated;
grant update (morning_price_cents, afternoon_price_cents, full_day_price_cents)
  on public.service_options to authenticated;

create table public.service_booking_settings (
  service_id uuid primary key,
  business_id uuid not null references public.businesses (id) on delete restrict,
  morning_start time,
  morning_end time,
  afternoon_start time,
  afternoon_end time,
  check_in_times time[],
  check_out_times time[],
  updated_at timestamptz not null default now(),
  foreign key (service_id, business_id)
    references public.services (id, business_id) on delete restrict,
  constraint service_booking_settings_periods check (
    (morning_start is null and morning_end is null
      and afternoon_start is null and afternoon_end is null)
    or (morning_start is not null and morning_end > morning_start
      and afternoon_start is not null and afternoon_end > afternoon_start
      and morning_end <= afternoon_start)
  ),
  constraint service_booking_settings_stay check (
    (check_in_times is null and check_out_times is null)
    or (cardinality(check_in_times) between 1 and 20
      and cardinality(check_out_times) between 1 and 20)
  )
);

alter table public.service_booking_settings enable row level security;
revoke all on public.service_booking_settings from public, anon, authenticated;
grant select on public.service_booking_settings to authenticated;
create policy service_booking_settings_select on public.service_booking_settings
  for select to authenticated
  using (business_id in (
    select m.business_id from public.business_members m
     where m.user_id = (select auth.uid())
  ));

create table public.daycare_bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  service_id uuid not null,
  service_option_id uuid not null,
  period text not null check (period in ('morning', 'afternoon', 'full_day')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'completed')),
  service_name text not null,
  size text not null,
  size_label text not null,
  price_cents integer not null check (price_cents >= 0),
  customer_name text not null check (char_length(customer_name) between 2 and 100),
  customer_phone text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  pet_name text not null check (char_length(pet_name) between 1 and 60),
  pet_breed text check (pet_breed is null or char_length(pet_breed) <= 60),
  notes text check (notes is null or char_length(notes) <= 500),
  consent_at timestamptz not null,
  idempotency_key uuid,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daycare_bookings_range check (ends_at > starts_at),
  constraint daycare_bookings_cancel_consistency
    check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (service_option_id, service_id, business_id)
    references public.service_options (id, service_id, business_id) on delete restrict,
  constraint daycare_bookings_id_idempotency unique (business_id, idempotency_key)
);
create index daycare_bookings_business_range_idx
  on public.daycare_bookings (business_id, starts_at, ends_at)
  where status = 'confirmed';
create index daycare_bookings_phone_idx
  on public.daycare_bookings (business_id, customer_phone, starts_at)
  where status = 'confirmed';
create trigger trg_daycare_bookings_bizlock before update on public.daycare_bookings
  for each row execute function app_private.forbid_business_change();
create trigger trg_daycare_bookings_updated before update on public.daycare_bookings
  for each row execute function app_private.set_updated_at();
alter table public.daycare_bookings enable row level security;
revoke all on public.daycare_bookings from public, anon, authenticated;
grant select on public.daycare_bookings to authenticated;
create policy daycare_bookings_select on public.daycare_bookings for select to authenticated
  using (business_id in (
    select m.business_id from public.business_members m
     where m.user_id = (select auth.uid())
  ));

-- Time-based stays coexist with old date-only rows in stay_bookings.
alter table public.stay_bookings
  add column check_in_at timestamptz,
  add column check_out_at timestamptz,
  add column duration_minutes integer,
  add column charge_units numeric(5,1);
alter table public.stay_bookings drop constraint if exists stay_bookings_dates;
alter table public.stay_bookings drop constraint if exists stay_bookings_nights;
alter table public.stay_bookings drop constraint if exists stay_bookings_nights_check;
alter table public.stay_bookings
  add constraint stay_bookings_dates check (
    (check_in_at is null and check_out_at is null and check_out > check_in)
    or (check_in_at is not null and check_out_at > check_in_at)
  ),
  add constraint stay_bookings_nights check (
    (check_in_at is null and nights = check_out - check_in)
    or (check_in_at is not null and nights between 0 and 30)
  ),
  add constraint stay_bookings_timed_snapshot check (
    (check_in_at is null and check_out_at is null
      and duration_minutes is null and charge_units is null)
    or (check_in_at is not null and check_out_at is not null
      and duration_minutes between 1 and 43200
      and duration_minutes = extract(epoch from (check_out_at - check_in_at)) / 60
      and charge_units between 1 and 30
      and charge_units = case
        when duration_minutes <= 1440 then 1
        else 1 + ((duration_minutes - 1440) / 720.0) * 0.5
      end
      and total_price_cents = round(daily_price_cents * charge_units)::integer)
  );
create index stay_bookings_business_timed_range_idx
  on public.stay_bookings (business_id, check_in_at, check_out_at)
  where status = 'confirmed' and check_in_at is not null;

create or replace function public.admin_save_service_booking_settings(
  p_service_id uuid,
  p_config jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_service public.services%rowtype;
  v_mode text;
  v_morning_start time;
  v_morning_end time;
  v_afternoon_start time;
  v_afternoon_end time;
  v_check_in time[];
  v_check_out time[];
begin
  select * into v_service from public.services s
   where s.id = p_service_id and app_private.is_member(s.business_id)
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  v_mode := v_service.booking_mode;

  if v_mode = 'periods' then
    if jsonb_typeof(p_config) is distinct from 'object'
       or coalesce(p_config->>'morning_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_config->>'morning_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_config->>'afternoon_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_config->>'afternoon_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
    v_morning_start := (p_config->>'morning_start')::time;
    v_morning_end := (p_config->>'morning_end')::time;
    v_afternoon_start := (p_config->>'afternoon_start')::time;
    v_afternoon_end := (p_config->>'afternoon_end')::time;
    if v_morning_end <= v_morning_start
       or v_afternoon_end <= v_afternoon_start
       or v_morning_end > v_afternoon_start then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
    if exists (
      select 1 from public.service_options o
       where o.service_id = v_service.id and o.is_active
         and (o.morning_price_cents is null
           or o.afternoon_price_cents is null
           or o.full_day_price_cents is null)
    ) then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
  elsif v_mode = 'stay' then
    if jsonb_typeof(p_config) is distinct from 'object'
       or jsonb_typeof(p_config->'check_in_times') is distinct from 'array'
       or jsonb_typeof(p_config->'check_out_times') is distinct from 'array'
       or coalesce(jsonb_array_length(p_config->'check_in_times'), 0) not between 1 and 20
       or coalesce(jsonb_array_length(p_config->'check_out_times'), 0) not between 1 and 20
       or exists (
         select 1
           from jsonb_array_elements_text(p_config->'check_in_times') t(value)
          where t.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       )
       or exists (
         select 1
           from jsonb_array_elements_text(p_config->'check_out_times') t(value)
          where t.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       )
    then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
    select array_agg(distinct t.value::time order by t.value::time)
      into v_check_in from jsonb_array_elements_text(p_config->'check_in_times') t(value);
    select array_agg(distinct t.value::time order by t.value::time)
      into v_check_out from jsonb_array_elements_text(p_config->'check_out_times') t(value);
    if cardinality(v_check_in) <> jsonb_array_length(p_config->'check_in_times')
       or cardinality(v_check_out) <> jsonb_array_length(p_config->'check_out_times') then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
  else
    delete from public.service_booking_settings where service_id = v_service.id;
    return jsonb_build_object('ok', true);
  end if;

  insert into public.service_booking_settings (
    service_id, business_id, morning_start, morning_end,
    afternoon_start, afternoon_end, check_in_times, check_out_times, updated_at)
  values (
    v_service.id, v_service.business_id, v_morning_start, v_morning_end,
    v_afternoon_start, v_afternoon_end, v_check_in, v_check_out, now())
  on conflict (service_id) do update set
    business_id = excluded.business_id,
    morning_start = excluded.morning_start,
    morning_end = excluded.morning_end,
    afternoon_start = excluded.afternoon_start,
    afternoon_end = excluded.afternoon_end,
    check_in_times = excluded.check_in_times,
    check_out_times = excluded.check_out_times,
    updated_at = now();
  return jsonb_build_object('ok', true);
exception
  when others then
    raise log 'admin_save_service_booking_settings failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke all on function public.admin_save_service_booking_settings(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_save_service_booking_settings(uuid, jsonb)
  to authenticated;

create or replace function public.get_public_booking_models(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'service_id', s.id,
    'booking_mode', s.booking_mode,
    'settings', case
      when cfg.service_id is null then null
      else jsonb_build_object(
        'morning_start', cfg.morning_start,
        'morning_end', cfg.morning_end,
        'afternoon_start', cfg.afternoon_start,
        'afternoon_end', cfg.afternoon_end,
        'check_in_times', cfg.check_in_times,
        'check_out_times', cfg.check_out_times)
    end,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'option_id', o.id,
        'morning_price_cents', o.morning_price_cents,
        'afternoon_price_cents', o.afternoon_price_cents,
        'full_day_price_cents', o.full_day_price_cents)
        order by o.size)
        from public.service_options o
        join public.business_sizes bs
          on bs.business_id = o.business_id and bs.code = o.size and bs.is_active
       where o.service_id = s.id and o.business_id = b.id
         and o.is_active
    ), '[]'::jsonb)
  ) order by s.name), '[]'::jsonb)
    from public.businesses b
    join public.services s on s.business_id = b.id
    left join public.service_booking_settings cfg
      on cfg.service_id = s.id and cfg.business_id = b.id
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active and s.is_active and s.archived_at is null;
$$;
revoke execute on function public.get_public_booking_models(text)
  from public, anon, authenticated;
grant execute on function public.get_public_booking_models(text)
  to anon, authenticated;

create or replace function app_private.daycare_peak_occupancy(
  p_business_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns integer
language sql stable set search_path = '' as $$
  select coalesce(max((
    select count(*)
      from public.daycare_bookings d
     where d.business_id = p_business_id
       and d.status = 'confirmed'
       and d.starts_at <= points.at_time
       and d.ends_at > points.at_time
  )), 0)::integer
    from (
      select p_starts_at as at_time
      union
      select d.starts_at from public.daycare_bookings d
       where d.business_id = p_business_id and d.status = 'confirmed'
         and d.starts_at >= p_starts_at and d.starts_at < p_ends_at
    ) points;
$$;
revoke all on function app_private.daycare_peak_occupancy(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function public.get_period_quote(
  p_slug text, p_option_id uuid, p_date date, p_period text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz public.businesses%rowtype;
  v_service public.services%rowtype;
  v_settings public.service_booking_settings%rowtype;
  v_opt record;
  v_start time;
  v_end time;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_price integer;
  v_today date;
begin
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  select s.* into v_service
    from public.service_options o join public.services s
      on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
     and o.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'periods';
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  select * into v_settings from public.service_booking_settings c
   where c.service_id = v_service.id and c.business_id = v_biz.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  select o.morning_price_cents, o.afternoon_price_cents, o.full_day_price_cents,
         o.size, bs.name as size_label, s.name as service_name
    into v_opt
    from public.service_options o join public.business_sizes bs
      on bs.business_id = o.business_id and bs.code = o.size and bs.is_active
    join public.services s on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id and o.is_active
     and s.is_active and s.archived_at is null and s.booking_mode = 'periods';
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  if p_period = 'morning' then
    v_start := v_settings.morning_start; v_end := v_settings.morning_end;
    v_price := v_opt.morning_price_cents;
  elsif p_period = 'afternoon' then
    v_start := v_settings.afternoon_start; v_end := v_settings.afternoon_end;
    v_price := v_opt.afternoon_price_cents;
  elsif p_period = 'full_day' then
    v_start := v_settings.morning_start; v_end := v_settings.afternoon_end;
    v_price := v_opt.full_day_price_cents;
  else
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  if v_start is null or v_end is null or v_price is null then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE');
  end if;
  v_today := (now() at time zone v_biz.timezone)::date;
  if p_date is null or p_date < v_today
     or p_date > v_today + v_biz.max_days_ahead then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  v_starts_at := (p_date + v_start) at time zone v_biz.timezone;
  v_ends_at := (p_date + v_end) at time zone v_biz.timezone;
  if v_starts_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  return jsonb_build_object(
    'ok', true,
    'available', app_private.daycare_peak_occupancy(v_biz.id, v_starts_at, v_ends_at) < 4,
    'service_name', v_opt.service_name,
    'size', v_opt.size,
    'size_label', v_opt.size_label,
    'period', p_period,
    'starts_at', v_starts_at,
    'ends_at', v_ends_at,
    'local_start', to_char(v_start, 'HH24:MI'),
    'local_end', to_char(v_end, 'HH24:MI'),
    'price_cents', v_price);
end;
$$;
revoke execute on function public.get_period_quote(text, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.get_period_quote(text, uuid, date, text)
  to anon, authenticated;

create or replace function public.create_public_period_booking(
  p_slug text, p_option_id uuid, p_date date, p_period text,
  p_customer_name text, p_customer_phone text, p_pet_name text,
  p_pet_breed text, p_notes text, p_consent boolean, p_idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_biz public.businesses%rowtype;
  v_quote jsonb;
  v_existing public.daycare_bookings%rowtype;
  v_phone text := app_private.normalize_phone(p_customer_phone);
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_pet text := btrim(coalesce(p_pet_name, ''));
  v_id uuid;
begin
  if p_consent is not true then return jsonb_build_object('ok', false, 'error', 'CONSENT_REQUIRED'); end if;
  if p_option_id is null or p_date is null or p_idempotency_key is null
     or char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(p_pet_breed, '')) > 60
     or char_length(coalesce(p_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':daycare', 0));
  select * into v_existing from public.daycare_bookings d
   where d.business_id = v_biz.id and d.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.status <> 'confirmed' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'booking_ref', v_existing.id,
      'service_name', v_existing.service_name, 'size_label', v_existing.size_label,
      'period', v_existing.period, 'starts_at', v_existing.starts_at,
      'ends_at', v_existing.ends_at,
      'date', (v_existing.starts_at at time zone v_biz.timezone)::date,
      'local_start', to_char(v_existing.starts_at at time zone v_biz.timezone, 'HH24:MI'),
      'local_end', to_char(v_existing.ends_at at time zone v_biz.timezone, 'HH24:MI'),
      'price_cents', v_existing.price_cents,
      'timezone', v_biz.timezone);
  end if;
  perform 1
    from public.service_options o
    join public.services s on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
     and o.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'periods'
   for share of o, s;
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  v_quote := public.get_period_quote(p_slug, p_option_id, p_date, p_period);
  if v_quote->>'ok' is distinct from 'true' then return v_quote; end if;
  if v_quote->>'available' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'error', 'DAYCARE_FULL');
  end if;
  if (select count(*) from public.daycare_bookings d
       where d.business_id = v_biz.id and d.customer_phone = v_phone
         and d.status = 'confirmed' and d.starts_at > now()) >= 2 then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED');
  end if;
  insert into public.daycare_bookings (
    business_id, service_id, service_option_id, period, starts_at, ends_at,
    service_name, size, size_label, price_cents, customer_name, customer_phone,
    pet_name, pet_breed, notes, consent_at, idempotency_key)
  select v_biz.id, s.id, o.id, p_period, (v_quote->>'starts_at')::timestamptz,
         (v_quote->>'ends_at')::timestamptz, s.name, o.size, v_quote->>'size_label',
         (v_quote->>'price_cents')::integer, v_name, v_phone, v_pet,
         nullif(btrim(coalesce(p_pet_breed, '')), ''),
         nullif(btrim(coalesce(p_notes, '')), ''), now(), p_idempotency_key
    from public.service_options o join public.services s
      on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
  returning id into v_id;
  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_quote->>'service_name',
    'size_label', v_quote->>'size_label', 'period', p_period,
    'date', p_date,
    'starts_at', v_quote->'starts_at', 'ends_at', v_quote->'ends_at',
    'local_start', v_quote->>'local_start', 'local_end', v_quote->>'local_end',
    'price_cents', v_quote->'price_cents', 'timezone', v_biz.timezone);
exception
  when others then
    raise log 'create_public_period_booking failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke execute on function public.create_public_period_booking(
  text, uuid, date, text, text, text, text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_public_period_booking(
  text, uuid, date, text, text, text, text, text, text, boolean, uuid)
  to anon, authenticated;

create or replace function public.admin_list_daycare_on_date(
  p_business_id uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_timezone text;
begin
  if not app_private.is_member(p_business_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  select b.timezone into v_timezone from public.businesses b where b.id = p_business_id;
  if v_timezone is null or p_date is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  return jsonb_build_object('ok', true, 'bookings', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'status', d.status, 'period', d.period,
      'starts_at', d.starts_at, 'ends_at', d.ends_at,
      'service_name', d.service_name, 'size_label', d.size_label,
      'price_cents', d.price_cents, 'customer_name', d.customer_name,
      'customer_phone', d.customer_phone, 'pet_name', d.pet_name,
      'pet_breed', d.pet_breed, 'notes', d.notes)
      order by d.starts_at, d.pet_name)
      from public.daycare_bookings d
     where d.business_id = p_business_id
       and d.status in ('confirmed', 'completed')
       and d.starts_at < ((p_date + 1)::timestamp at time zone v_timezone)
       and d.ends_at > (p_date::timestamp at time zone v_timezone)
  ), '[]'::jsonb));
end;
$$;
revoke execute on function public.admin_list_daycare_on_date(uuid, date)
  from public, anon, authenticated;
grant execute on function public.admin_list_daycare_on_date(uuid, date)
  to authenticated;

create or replace function public.admin_set_daycare_status(
  p_booking_id uuid, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_booking public.daycare_bookings%rowtype;
begin
  if p_status is null or p_status not in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  select * into v_booking from public.daycare_bookings d
   where d.id = p_booking_id and app_private.is_member(d.business_id);
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.business_id::text || ':daycare', 0));
  select * into v_booking from public.daycare_bookings d
   where d.id = p_booking_id for update;
  if v_booking.status <> 'confirmed'
     or (p_status = 'completed' and v_booking.ends_at > now()) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;
  update public.daycare_bookings set status = p_status,
    cancelled_at = case when p_status = 'cancelled' then now() else null end
   where id = p_booking_id;
  return jsonb_build_object('ok', true, 'status', p_status);
exception
  when others then
    raise log 'admin_set_daycare_status failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke execute on function public.admin_set_daycare_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_daycare_status(uuid, text)
  to authenticated;

create or replace function app_private.timed_stay_peak_occupancy(
  p_business_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns integer
language sql stable set search_path = '' as $$
  select coalesce(max((
    select count(*)
      from public.stay_bookings k
      join public.businesses b on b.id = k.business_id
     where k.business_id = p_business_id
       and k.status = 'confirmed'
       and coalesce(k.check_in_at, k.check_in::timestamp at time zone b.timezone) <= points.at_time
       and coalesce(k.check_out_at, k.check_out::timestamp at time zone b.timezone) > points.at_time
  )), 0)::integer
    from (
      select p_starts_at as at_time
      union
      select coalesce(k.check_in_at, k.check_in::timestamp at time zone b.timezone)
        from public.stay_bookings k
        join public.businesses b on b.id = k.business_id
       where k.business_id = p_business_id and k.status = 'confirmed'
         and coalesce(k.check_in_at, k.check_in::timestamp at time zone b.timezone) >= p_starts_at
         and coalesce(k.check_in_at, k.check_in::timestamp at time zone b.timezone) < p_ends_at
    ) points;
$$;
revoke all on function app_private.timed_stay_peak_occupancy(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function app_private.stay_peak_occupancy(
  p_business_id uuid, p_check_in date, p_check_out date)
returns integer
language sql stable set search_path = '' as $$
  select app_private.timed_stay_peak_occupancy(
    p_business_id,
    p_check_in::timestamp at time zone b.timezone,
    p_check_out::timestamp at time zone b.timezone)
    from public.businesses b where b.id = p_business_id;
$$;
revoke all on function app_private.stay_peak_occupancy(uuid, date, date)
  from public, anon, authenticated;

create or replace function public.get_timed_stay_options(
  p_slug text, p_option_id uuid, p_check_in date, p_entry_time text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz public.businesses%rowtype;
  v_service public.services%rowtype;
  v_settings public.service_booking_settings%rowtype;
  v_opt record;
  v_entry time;
  v_start timestamptz;
  v_end timestamptz;
  v_duration_seconds bigint;
  v_hours numeric;
  v_units numeric(5,1);
  v_today date;
  v_options jsonb := '[]'::jsonb;
  v_date date;
  v_exit time;
begin
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if p_entry_time is null or p_entry_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  v_entry := p_entry_time::time;
  select s.* into v_service
    from public.service_options o join public.services s
      on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
     and o.is_active and s.is_active and s.archived_at is null and s.booking_mode = 'stay';
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  select * into v_settings from public.service_booking_settings c
   where c.service_id = v_service.id and c.business_id = v_biz.id;
  if not found or not (v_entry = any(v_settings.check_in_times)) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TIME_OPTIONS');
  end if;
  select o.price_cents, o.size, bs.name as size_label, s.name as service_name
    into v_opt from public.service_options o
    join public.business_sizes bs on bs.business_id = o.business_id
      and bs.code = o.size and bs.is_active
    join public.services s on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id and o.is_active
     and s.is_active and s.archived_at is null and s.booking_mode = 'stay';
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  v_today := (now() at time zone v_biz.timezone)::date;
  if p_check_in is null or p_check_in < v_today
     or p_check_in > v_today + v_biz.max_days_ahead then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  v_start := (p_check_in + v_entry) at time zone v_biz.timezone;
  if v_start <= now() then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TIME_OPTIONS');
  end if;
  for v_date in select generate_series(p_check_in, p_check_in + 30, interval '1 day')::date loop
    foreach v_exit in array v_settings.check_out_times loop
      v_end := (v_date + v_exit) at time zone v_biz.timezone;
      v_duration_seconds := extract(epoch from (v_end - v_start))::bigint;
      if v_duration_seconds <= 0 or v_duration_seconds > 2592000
         or v_duration_seconds % 3600 <> 0 then
        continue;
      end if;
      v_hours := v_duration_seconds / 3600.0;
      if v_hours > 24 and mod(v_hours - 24, 12) <> 0 then
        continue;
      end if;
      v_units := case when v_hours <= 24 then 1
                      else 1 + ((v_hours - 24) / 12) * 0.5 end;
      if v_opt.price_cents::numeric * v_units > 2147483647 then
        continue;
      end if;
      v_options := v_options || jsonb_build_array(jsonb_build_object(
        'check_out', v_date,
        'check_out_time', to_char(v_exit, 'HH24:MI'),
        'check_in_at', v_start,
        'check_out_at', v_end,
        'duration_hours', v_hours,
        'charge_units', v_units,
        'available', app_private.timed_stay_peak_occupancy(v_biz.id, v_start, v_end) < v_biz.stay_capacity,
        'daily_price_cents', v_opt.price_cents,
        'total_price_cents', round(v_opt.price_cents * v_units)::integer));
    end loop;
  end loop;
  return jsonb_build_object('ok', true, 'service_name', v_opt.service_name,
    'size', v_opt.size, 'size_label', v_opt.size_label, 'check_in', p_check_in,
    'check_in_time', to_char(v_entry, 'HH24:MI'), 'options', v_options);
exception
  when others then
    raise log 'get_timed_stay_options failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke execute on function public.get_timed_stay_options(text, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.get_timed_stay_options(text, uuid, date, text)
  to anon, authenticated;

create or replace function public.create_public_timed_stay(
  p_slug text, p_option_id uuid, p_check_in date, p_entry_time text,
  p_check_out date, p_exit_time text, p_customer_name text, p_customer_phone text,
  p_pet_name text, p_pet_breed text, p_notes text, p_consent boolean,
  p_idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_biz public.businesses%rowtype;
  v_existing public.stay_bookings%rowtype;
  v_options jsonb;
  v_selected jsonb;
  v_quote jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_duration integer;
  v_units numeric(5,1);
  v_daily_price integer;
  v_total integer;
  v_phone text := app_private.normalize_phone(p_customer_phone);
  v_name text := btrim(coalesce(p_customer_name, ''));
  v_pet text := btrim(coalesce(p_pet_name, ''));
  v_id uuid;
begin
  if p_consent is not true then return jsonb_build_object('ok', false, 'error', 'CONSENT_REQUIRED'); end if;
  if p_idempotency_key is null or p_check_in is null or p_check_out is null
     or p_entry_time is null or p_exit_time is null
     or char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(p_pet_breed, '')) > 60
     or char_length(coalesce(p_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':stay', 0));
  select * into v_existing from public.stay_bookings k
   where k.business_id = v_biz.id and k.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.status <> 'confirmed' then return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT'); end if;
    return jsonb_build_object('ok', true, 'idempotent', true,
      'booking_ref', v_existing.id, 'service_name', v_existing.service_name,
      'size_label', v_existing.size_label, 'check_in_at', v_existing.check_in_at,
      'check_out_at', v_existing.check_out_at, 'duration_minutes', v_existing.duration_minutes,
      'charge_units', v_existing.charge_units, 'daily_price_cents', v_existing.daily_price_cents,
      'total_price_cents', v_existing.total_price_cents,
      'check_in', (v_existing.check_in_at at time zone v_biz.timezone)::date,
      'check_out', (v_existing.check_out_at at time zone v_biz.timezone)::date,
      'check_in_time', to_char(v_existing.check_in_at at time zone v_biz.timezone, 'HH24:MI'),
      'check_out_time', to_char(v_existing.check_out_at at time zone v_biz.timezone, 'HH24:MI'),
      'timezone', v_biz.timezone);
  end if;
  perform 1
    from public.service_options o
    join public.services s on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
     and o.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'stay'
   for share of o, s;
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;
  perform 1 from public.service_booking_settings c
   where c.business_id = v_biz.id
     and c.service_id = (
       select o.service_id from public.service_options o
        where o.id = p_option_id and o.business_id = v_biz.id
     )
   for share;
  v_quote := public.get_timed_stay_options(p_slug, p_option_id, p_check_in, p_entry_time);
  if v_quote->>'ok' is distinct from 'true' then return v_quote; end if;
  select candidate.value into v_selected
    from jsonb_array_elements(v_quote->'options') as candidate(value)
   where candidate.value->>'check_out' = p_check_out::text
     and candidate.value->>'check_out_time' = p_exit_time;
  if v_selected is null then return jsonb_build_object('ok', false, 'error', 'INVALID_TIME_OPTIONS'); end if;
  if v_selected->>'available' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'error', 'STAY_FULL');
  end if;
  v_start := (v_selected->>'check_in_at')::timestamptz;
  v_end := (v_selected->>'check_out_at')::timestamptz;
  v_duration := (v_selected->>'duration_hours')::numeric * 60;
  v_units := (v_selected->>'charge_units')::numeric;
  v_daily_price := (v_selected->>'daily_price_cents')::integer;
  v_total := (v_selected->>'total_price_cents')::integer;
  if (select count(*) from public.stay_bookings k
       where k.business_id = v_biz.id and k.customer_phone = v_phone
         and k.status = 'confirmed'
         and coalesce(k.check_out_at, k.check_out::timestamp at time zone v_biz.timezone) > now()) >= 2 then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED');
  end if;
  if app_private.timed_stay_peak_occupancy(v_biz.id, v_start, v_end) >= v_biz.stay_capacity then
    return jsonb_build_object('ok', false, 'error', 'STAY_FULL');
  end if;
  insert into public.stay_bookings (
    business_id, service_id, service_option_id, check_in, check_out, nights,
    check_in_at, check_out_at, duration_minutes, charge_units,
    service_name, size, size_label, daily_price_cents, total_price_cents,
    customer_name, customer_phone, pet_name, pet_breed, notes,
    created_by, consent_at, idempotency_key)
  select v_biz.id, s.id, o.id,
    (v_start at time zone v_biz.timezone)::date,
    (v_end at time zone v_biz.timezone)::date,
    greatest(0, (v_end at time zone v_biz.timezone)::date - (v_start at time zone v_biz.timezone)::date),
    v_start, v_end, v_duration, v_units,
    s.name, o.size, v_quote->>'size_label', v_daily_price, v_total,
    v_name, v_phone, v_pet, nullif(btrim(coalesce(p_pet_breed, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), 'customer', now(), p_idempotency_key
    from public.service_options o join public.services s
      on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
  returning id into v_id;
  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_quote->>'service_name',
    'size_label', v_quote->>'size_label', 'check_in', p_check_in,
    'check_out', p_check_out, 'check_in_time', p_entry_time,
    'check_out_time', p_exit_time, 'check_in_at', v_start, 'check_out_at', v_end,
    'duration_minutes', v_duration, 'charge_units', v_units,
    'daily_price_cents', v_daily_price, 'total_price_cents', v_total,
    'timezone', v_biz.timezone);
exception
  when others then
    raise log 'create_public_timed_stay failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke execute on function public.create_public_timed_stay(
  text, uuid, date, text, date, text, text, text, text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_public_timed_stay(
  text, uuid, date, text, date, text, text, text, text, text, text, boolean, uuid)
  to anon, authenticated;

create or replace function public.admin_set_stay_status(
  p_stay_id uuid, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s public.stay_bookings%rowtype;
begin
  if p_status is null or p_status not in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  select * into v_s from public.stay_bookings k
   where k.id = p_stay_id and app_private.is_member(k.business_id);
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_s.business_id::text || ':stay', 0));
  select * into v_s from public.stay_bookings k where k.id = p_stay_id for update;
  if v_s.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;
  if p_status = 'completed'
     and coalesce(v_s.check_out_at,
       v_s.check_out::timestamp at time zone
         (select b.timezone from public.businesses b where b.id = v_s.business_id)) > now() then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;
  update public.stay_bookings set status = p_status,
    cancelled_at = case when p_status = 'cancelled' then now() else null end
   where id = p_stay_id;
  return jsonb_build_object('ok', true, 'status', p_status);
exception
  when others then
    raise log 'admin_set_stay_status failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke execute on function public.admin_set_stay_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_stay_status(uuid, text)
  to authenticated;

revoke all on public.service_booking_settings from public, anon;
revoke all on public.daycare_bookings from public, anon;
