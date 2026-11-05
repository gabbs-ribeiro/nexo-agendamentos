-- 1) Janela de agendamento do cliente: de 30 para 60 dias.
-- 2) Agendamento manual pelo painel SEM limite de data (para arrumar a agenda de meses a frente).
--
-- Janela do cliente: businesses.max_days_ahead (padrao 30 -> 60). Todas as funcoes publicas ja
-- leem esse valor (horarios, hospedagem, creche), entao basta o dado. Estabelecimentos que
-- estao com 30 (o padrao antigo) passam para 60; quem configurou outro valor e mantido.
--
-- Painel: o agendamento por horario ja nao tinha limite de data no banco (admin_create_booking usa
-- compute_slots em modo administrador), mas o diálogo listava os horarios pela funcao PUBLICA,
-- que respeita a janela do cliente. Aqui entram versoes administrativas, sem janela:
--   admin_get_available_slots, admin_get_period_quote, admin_get_timed_stay_options
-- e as criacoes de creche e hospedagem pelo painel passam a usa-las. As funcoes publicas NAO mudam.
-- Continuam valendo: nao agendar no passado, vagas/capacidade e horarios de funcionamento.
--
-- Idempotente: pode ser aplicada mesmo que admin_create_period_booking / admin_create_timed_stay
-- ja existam (create or replace).
--
-- NAO EXECUTADO. Aplicar primeiro no DEV, depois rodar os testes 19 e 04.

do $$
begin
  if pg_catalog.to_regprocedure('app_private.compute_slots(uuid, integer, date, boolean, uuid)') is null
     or pg_catalog.to_regprocedure('app_private.daycare_peak_occupancy(uuid, timestamptz, timestamptz)') is null
     or pg_catalog.to_regprocedure('app_private.timed_stay_peak_occupancy(uuid, timestamptz, timestamptz)') is null
     or pg_catalog.to_regprocedure('app_private.is_member(uuid)') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'businesses' and column_name = 'stay_capacity') then
    raise exception 'Pre-requisito ausente: aplique as migrations ate 20261023000002 antes desta';
  end if;
end;
$$;

-- 1) Janela do cliente
alter table public.businesses alter column max_days_ahead set default 60;
update public.businesses set max_days_ahead = 60 where max_days_ahead = 30;

-- Reservas feitas pelo painel: origem 'admin' e consentimento opcional (o consentimento e do formulario publico)
alter table public.stay_bookings alter column consent_at drop not null;
alter table public.stay_bookings drop constraint if exists stay_bookings_created_by_check;
alter table public.stay_bookings add constraint stay_bookings_created_by_check check (created_by in ('customer', 'admin'));
alter table public.stay_bookings drop constraint if exists stay_bookings_consent_required;
alter table public.stay_bookings add constraint stay_bookings_consent_required check (created_by = 'admin' or consent_at is not null);

alter table public.daycare_bookings add column if not exists created_by text not null default 'customer';
alter table public.daycare_bookings drop constraint if exists daycare_bookings_created_by_check;
alter table public.daycare_bookings add constraint daycare_bookings_created_by_check check (created_by in ('customer', 'admin'));
alter table public.daycare_bookings alter column consent_at drop not null;
alter table public.daycare_bookings drop constraint if exists daycare_bookings_consent_required;
alter table public.daycare_bookings add constraint daycare_bookings_consent_required check (created_by = 'admin' or consent_at is not null);

-- 2a) Horarios livres (agendamento por horario) sem janela
create or replace function public.admin_get_available_slots(
  p_business_id uuid, p_option_id uuid, p_date date)
returns table (starts_at timestamptz, local_time text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz       text;
  v_duration int;
begin
  select b.timezone into v_tz from public.businesses b
   where b.id = p_business_id and app_private.is_member(b.id);
  if not found then return; end if;

  select so.duration_minutes into v_duration
    from public.service_options so
    join public.business_sizes bs
      on bs.business_id = so.business_id and bs.code = so.size and bs.is_active
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id and so.business_id = p_business_id
     and so.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'hourly';
  if v_duration is null then return; end if;

  return query
    select cs.slot_start, to_char(cs.slot_start at time zone v_tz, 'HH24:MI')
      from app_private.compute_slots(p_business_id, v_duration, p_date, true) cs;
end;
$$;

-- 2b) Cotacao da creche sem janela (mesma conta da funcao publica; sem a checagem de dias a frente)
create or replace function public.admin_get_period_quote(
  p_business_id uuid, p_option_id uuid, p_date date, p_period text)
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
   where b.id = p_business_id and app_private.is_member(b.id);
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
  -- painel: sem limite de dias a frente; so nao agenda no passado
  if p_date is null or p_date < v_today then
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

-- 2c) Opcoes de saida da hospedagem sem janela (mesma conta da funcao publica)
create or replace function public.admin_get_timed_stay_options(
  p_business_id uuid, p_option_id uuid, p_check_in date, p_entry_time text)
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
  v_i integer;
  v_checkout_local timestamp;
begin
  select * into v_biz from public.businesses b
   where b.id = p_business_id and app_private.is_member(b.id);
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
  if not found
     or v_settings.check_in_start is null
     or v_entry < v_settings.check_in_start
     or v_entry > v_settings.check_in_end
     or (extract(epoch from (v_entry - v_settings.check_in_start))::integer / 60) % 30 <> 0 then
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
  -- painel: sem limite de dias a frente; so nao agenda no passado
  if p_check_in is null or p_check_in < v_today then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  v_start := (p_check_in + v_entry) at time zone v_biz.timezone;
  if v_start <= now() then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TIME_OPTIONS');
  end if;

  for v_i in 1..60 loop
    v_end := v_start + (v_i * interval '12 hours');
    v_checkout_local := v_end at time zone v_biz.timezone;
    v_date := v_checkout_local::date;
    v_exit := v_checkout_local::time;
    if v_date > p_check_in + 30
       or v_exit < v_settings.check_out_start
       or v_exit > v_settings.check_out_end then
      continue;
    end if;
    v_duration_seconds := extract(epoch from (v_end - v_start))::bigint;
    v_hours := v_duration_seconds / 3600.0;
    v_units := v_i / 2.0;
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
  return jsonb_build_object('ok', true, 'service_name', v_opt.service_name,
    'size', v_opt.size, 'size_label', v_opt.size_label, 'check_in', p_check_in,
    'check_in_time', to_char(v_entry, 'HH24:MI'), 'options', v_options);
exception
  when others then
    raise log 'admin_get_timed_stay_options failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;

-- 3) Criacao pelo painel (creche e hospedagem) usando as cotacoes sem janela
create or replace function public.admin_create_period_booking(
  p_business_id uuid, p_option_id uuid, p_date date, p_period text,
  p_customer_name text, p_customer_phone text, p_pet_name text,
  p_pet_breed text, p_notes text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_biz   public.businesses%rowtype;
  v_quote jsonb;
  v_phone text := app_private.normalize_phone(p_customer_phone);
  v_name  text := btrim(coalesce(p_customer_name, ''));
  v_pet   text := btrim(coalesce(p_pet_name, ''));
  v_id    uuid;
begin
  if p_business_id is null or p_option_id is null or p_date is null or p_period is null
     or char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(p_pet_breed, '')) > 60
     or char_length(coalesce(p_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  select * into v_biz from public.businesses b
   where b.id = p_business_id and app_private.is_member(b.id);
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':daycare', 0));
  perform 1
    from public.service_options o
    join public.services s on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
     and o.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'periods'
   for share of o, s;
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;

  v_quote := public.admin_get_period_quote(v_biz.id, p_option_id, p_date, p_period);
  if v_quote->>'ok' is distinct from 'true' then return v_quote; end if;
  if v_quote->>'available' is distinct from 'true' then
    return jsonb_build_object('ok', false, 'error', 'DAYCARE_FULL');
  end if;

  insert into public.daycare_bookings (
    business_id, service_id, service_option_id, period, starts_at, ends_at,
    service_name, size, size_label, price_cents, customer_name, customer_phone,
    pet_name, pet_breed, notes, created_by, consent_at, idempotency_key)
  select v_biz.id, s.id, o.id, p_period, (v_quote->>'starts_at')::timestamptz,
         (v_quote->>'ends_at')::timestamptz, s.name, o.size, v_quote->>'size_label',
         (v_quote->>'price_cents')::integer, v_name, v_phone, v_pet,
         nullif(btrim(coalesce(p_pet_breed, '')), ''),
         nullif(btrim(coalesce(p_notes, '')), ''), 'admin', null, null
    from public.service_options o join public.services s
      on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_quote->>'service_name',
    'size_label', v_quote->>'size_label', 'period', p_period, 'date', p_date,
    'local_start', v_quote->>'local_start', 'local_end', v_quote->>'local_end',
    'price_cents', v_quote->'price_cents', 'timezone', v_biz.timezone);
exception
  when others then
    raise log 'admin_create_period_booking failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;

create or replace function public.admin_create_timed_stay(
  p_business_id uuid, p_option_id uuid, p_check_in date, p_entry_time text,
  p_check_out date, p_exit_time text, p_customer_name text, p_customer_phone text,
  p_pet_name text, p_pet_breed text, p_notes text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_biz      public.businesses%rowtype;
  v_quote    jsonb;
  v_selected jsonb;
  v_start    timestamptz;
  v_end      timestamptz;
  v_duration integer;
  v_units    numeric(5,1);
  v_daily    integer;
  v_total    integer;
  v_phone    text := app_private.normalize_phone(p_customer_phone);
  v_name     text := btrim(coalesce(p_customer_name, ''));
  v_pet      text := btrim(coalesce(p_pet_name, ''));
  v_id       uuid;
begin
  if p_business_id is null or p_option_id is null or p_check_in is null or p_check_out is null
     or p_entry_time is null or p_exit_time is null
     or char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(p_pet_breed, '')) > 60
     or char_length(coalesce(p_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  select * into v_biz from public.businesses b
   where b.id = p_business_id and app_private.is_member(b.id);
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':stay', 0));
  perform 1
    from public.service_options o
    join public.services s on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
     and o.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'stay'
   for share of o, s;
  if not found then return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE'); end if;

  v_quote := public.admin_get_timed_stay_options(v_biz.id, p_option_id, p_check_in, p_entry_time);
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
  v_daily := (v_selected->>'daily_price_cents')::integer;
  v_total := (v_selected->>'total_price_cents')::integer;
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
    s.name, o.size, v_quote->>'size_label', v_daily, v_total,
    v_name, v_phone, v_pet, nullif(btrim(coalesce(p_pet_breed, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''), 'admin', null, null
    from public.service_options o join public.services s
      on s.id = o.service_id and s.business_id = o.business_id
   where o.id = p_option_id and o.business_id = v_biz.id
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_quote->>'service_name',
    'size_label', v_quote->>'size_label', 'check_in', p_check_in, 'check_out', p_check_out,
    'check_in_time', p_entry_time, 'check_out_time', p_exit_time,
    'duration_minutes', v_duration, 'charge_units', v_units,
    'daily_price_cents', v_daily, 'total_price_cents', v_total, 'timezone', v_biz.timezone);
exception
  when others then
    raise log 'admin_create_timed_stay failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;

-- 4) Permissoes: so usuarios logados (e, dentro, so membros do negocio)
revoke execute on function public.admin_get_available_slots(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.admin_get_available_slots(uuid, uuid, date) to authenticated;
revoke execute on function public.admin_get_period_quote(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.admin_get_period_quote(uuid, uuid, date, text) to authenticated;
revoke execute on function public.admin_get_timed_stay_options(uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.admin_get_timed_stay_options(uuid, uuid, date, text) to authenticated;
revoke execute on function public.admin_create_period_booking(uuid, uuid, date, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_period_booking(uuid, uuid, date, text, text, text, text, text, text) to authenticated;
revoke execute on function public.admin_create_timed_stay(uuid, uuid, date, text, date, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_timed_stay(uuid, uuid, date, text, date, text, text, text, text, text, text) to authenticated;
