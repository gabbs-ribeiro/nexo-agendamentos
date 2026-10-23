alter table public.service_booking_settings
  add column check_in_start time,
  add column check_in_end time,
  add column check_out_start time,
  add column check_out_end time;

update public.service_booking_settings c
   set check_in_start = (select min(times.value) from unnest(c.check_in_times) as times(value)),
       check_in_end = (select max(times.value) from unnest(c.check_in_times) as times(value)),
       check_out_start = (select min(times.value) from unnest(c.check_out_times) as times(value)),
       check_out_end = (select max(times.value) from unnest(c.check_out_times) as times(value))
 where c.check_in_times is not null and c.check_out_times is not null;

alter table public.service_booking_settings
  drop constraint service_booking_settings_stay,
  add constraint service_booking_settings_stay_ranges check (
    (check_in_start is null and check_in_end is null
      and check_out_start is null and check_out_end is null)
    or (check_in_start is not null and check_in_end >= check_in_start
      and check_out_start is not null and check_out_end >= check_out_start)
  );

create or replace function public.admin_delete_service_category(p_category_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_category public.service_categories%rowtype;
begin
  select * into v_category from public.service_categories c
   where c.id = p_category_id and app_private.is_member(c.business_id)
   for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;
  if exists (
    select 1 from public.services s
     where s.business_id = v_category.business_id
       and s.category_id = v_category.id
  ) then
    return jsonb_build_object('ok', false, 'error', 'CATEGORY_HAS_SERVICES');
  end if;
  delete from public.service_categories c
   where c.id = v_category.id and c.business_id = v_category.business_id;
  return jsonb_build_object('ok', true);
exception
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'error', 'CATEGORY_HAS_SERVICES');
  when others then
    raise log 'admin_delete_service_category failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke all on function public.admin_delete_service_category(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_delete_service_category(uuid)
  to authenticated;

create or replace function public.admin_save_service_booking_settings(
  p_service_id uuid, p_config jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_service public.services%rowtype;
  v_morning_start time;
  v_morning_end time;
  v_afternoon_start time;
  v_afternoon_end time;
  v_check_in_start time;
  v_check_in_end time;
  v_check_out_start time;
  v_check_out_end time;
begin
  select * into v_service from public.services s
   where s.id = p_service_id and app_private.is_member(s.business_id)
   for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  if v_service.booking_mode = 'periods' then
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
       or v_morning_end > v_afternoon_start
       or exists (
         select 1 from public.service_options o
          where o.service_id = v_service.id and o.is_active
            and (o.morning_price_cents is null
              or o.afternoon_price_cents is null
              or o.full_day_price_cents is null)
       ) then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
  elsif v_service.booking_mode = 'stay' then
    if jsonb_typeof(p_config) is distinct from 'object'
       or coalesce(p_config->>'check_in_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_config->>'check_in_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_config->>'check_out_start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(p_config->>'check_out_end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
    v_check_in_start := (p_config->>'check_in_start')::time;
    v_check_in_end := (p_config->>'check_in_end')::time;
    v_check_out_start := (p_config->>'check_out_start')::time;
    v_check_out_end := (p_config->>'check_out_end')::time;
    if v_check_in_end < v_check_in_start
       or v_check_out_end < v_check_out_start
       or extract(second from v_check_in_start) <> 0
       or extract(second from v_check_in_end) <> 0
       or extract(second from v_check_out_start) <> 0
       or extract(second from v_check_out_end) <> 0 then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
  else
    delete from public.service_booking_settings where service_id = v_service.id;
    return jsonb_build_object('ok', true);
  end if;

  insert into public.service_booking_settings (
    service_id, business_id, morning_start, morning_end,
    afternoon_start, afternoon_end, check_in_times, check_out_times,
    check_in_start, check_in_end, check_out_start, check_out_end, updated_at)
  values (
    v_service.id, v_service.business_id, v_morning_start, v_morning_end,
    v_afternoon_start, v_afternoon_end, null, null,
    v_check_in_start, v_check_in_end, v_check_out_start, v_check_out_end, now())
  on conflict (service_id) do update set
    business_id = excluded.business_id,
    morning_start = excluded.morning_start,
    morning_end = excluded.morning_end,
    afternoon_start = excluded.afternoon_start,
    afternoon_end = excluded.afternoon_end,
    check_in_times = excluded.check_in_times,
    check_out_times = excluded.check_out_times,
    check_in_start = excluded.check_in_start,
    check_in_end = excluded.check_in_end,
    check_out_start = excluded.check_out_start,
    check_out_end = excluded.check_out_end,
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
        'check_in_start', cfg.check_in_start,
        'check_in_end', cfg.check_in_end,
        'check_out_start', cfg.check_out_start,
        'check_out_end', cfg.check_out_end)
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
  v_i integer;
  v_checkout_local timestamp;
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
  if p_check_in is null or p_check_in < v_today
     or p_check_in > v_today + v_biz.max_days_ahead then
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
    raise log 'get_timed_stay_options failed: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;
revoke execute on function public.get_timed_stay_options(text, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.get_timed_stay_options(text, uuid, date, text)
  to anon, authenticated;
