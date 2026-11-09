create or replace function app_private.has_time_block_overlap(
  p_business_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
      from public.time_blocks t
     where t.business_id = p_business_id
       and t.starts_at < p_ends_at
       and t.ends_at > p_starts_at
  );
$$;
revoke all on function app_private.has_time_block_overlap(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function app_private.daycare_peak_occupancy(
  p_business_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns integer
language sql stable set search_path = '' as $$
  select case
    when app_private.has_time_block_overlap(p_business_id, p_starts_at, p_ends_at) then 4
    else coalesce(max((
      select count(*)
        from public.daycare_bookings d
       where d.business_id = p_business_id
         and d.status = 'confirmed'
         and d.starts_at <= points.at_time
         and d.ends_at > points.at_time
    )), 0)::integer
  end
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

create or replace function app_private.timed_stay_peak_occupancy(
  p_business_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns integer
language sql stable set search_path = '' as $$
  select case
    when app_private.has_time_block_overlap(p_business_id, p_starts_at, p_ends_at)
      then b.stay_capacity
    else coalesce((
      select max((
        select count(*)
          from public.stay_bookings k
          join public.businesses biz on biz.id = k.business_id
         where k.business_id = p_business_id
           and k.status = 'confirmed'
           and coalesce(k.check_in_at, k.check_in::timestamp at time zone biz.timezone) <= points.at_time
           and coalesce(k.check_out_at, k.check_out::timestamp at time zone biz.timezone) > points.at_time
      ))
        from (
          select p_starts_at as at_time
          union
          select coalesce(k.check_in_at, k.check_in::timestamp at time zone biz.timezone)
            from public.stay_bookings k
            join public.businesses biz on biz.id = k.business_id
           where k.business_id = p_business_id and k.status = 'confirmed'
             and coalesce(k.check_in_at, k.check_in::timestamp at time zone biz.timezone) >= p_starts_at
             and coalesce(k.check_in_at, k.check_in::timestamp at time zone biz.timezone) < p_ends_at
        ) points
    ), 0)::integer
  end
    from public.businesses b
   where b.id = p_business_id;
$$;
revoke all on function app_private.timed_stay_peak_occupancy(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;

create or replace function public.admin_create_time_block(
  p_business_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_reason      text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id uuid;
begin
  perform app_private.require_member(p_business_id);

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at <= now()
     or p_ends_at - p_starts_at > interval '366 days'
     or char_length(coalesce(v_reason, '')) > 200 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':daycare', 0));
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':stay', 0));

  if exists (
    select 1 from public.bookings k
     where k.business_id = p_business_id
       and k.status <> 'cancelled'
       and k.starts_at < p_ends_at
       and k.ends_at > p_starts_at
  ) or exists (
    select 1 from public.daycare_bookings d
     where d.business_id = p_business_id
       and d.status <> 'cancelled'
       and d.starts_at < p_ends_at
       and d.ends_at > p_starts_at
  ) or exists (
    select 1
      from public.stay_bookings k
      join public.businesses b on b.id = k.business_id
     where k.business_id = p_business_id
       and k.status <> 'cancelled'
       and coalesce(k.check_in_at, k.check_in::timestamp at time zone b.timezone) < p_ends_at
       and coalesce(k.check_out_at, k.check_out::timestamp at time zone b.timezone) > p_starts_at
  ) then
    return jsonb_build_object('ok', false, 'error', 'BOOKING_CONFLICT');
  end if;

  insert into public.time_blocks (business_id, starts_at, ends_at, reason)
  values (p_business_id, p_starts_at, p_ends_at, v_reason)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'block_id', v_id);
end;
$$;
revoke execute on function public.admin_create_time_block(uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_time_block(uuid, timestamptz, timestamptz, text)
  to authenticated;
