-- Restaura o snapshot do nome do porte na criacao de novas reservas.
-- A definicao instalada em alguns ambientes ainda usa a versao anterior a
-- 20261021000002_admin_control_catalog.sql.

do $$
begin
  if pg_catalog.to_regclass('public.business_sizes') is null
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'bookings'
          and column_name = 'size_label'
     ) then
    raise exception 'Pre-requisito ausente: aplique/verifique 20261021000002_admin_control_catalog.sql antes desta migration';
  end if;
end;
$$;

create or replace function app_private.create_booking(
  p_business_id     uuid,
  p_option_id       uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_pet_name        text,
  p_pet_breed       text,
  p_notes           text,
  p_created_by      text,
  p_consent_at      timestamptz,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_biz      public.businesses%rowtype;
  v_opt      record;
  v_existing public.bookings%rowtype;
  v_name     text := btrim(coalesce(p_customer_name, ''));
  v_pet      text := btrim(coalesce(p_pet_name, ''));
  v_breed    text := nullif(btrim(coalesce(p_pet_breed, '')), '');
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_phone    text := app_private.normalize_phone(p_customer_phone);
  v_end      timestamptz;
  v_id       uuid;
begin
  if p_created_by not in ('customer', 'admin')
     or p_option_id is null or p_starts_at is null
     or char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(v_breed, '')) > 60
     or char_length(coalesce(v_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$'
     or (p_created_by = 'customer' and (p_idempotency_key is null or p_consent_at is null))
  then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_biz from public.businesses b where b.id = p_business_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text, 0));

  if p_idempotency_key is not null then
    select * into v_existing from public.bookings k
     where k.business_id = v_biz.id and k.idempotency_key = p_idempotency_key;
    if found then
      if v_existing.status <> 'confirmed' then
        return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
      end if;
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'booking_ref', v_existing.id, 'service_name', v_existing.service_name,
        'size', v_existing.size, 'size_label', v_existing.size_label,
        'starts_at', v_existing.starts_at, 'ends_at', v_existing.ends_at,
        'price_cents', v_existing.price_cents, 'timezone', v_biz.timezone);
    end if;
  end if;

  select so.service_id, so.size, bs.name as size_label,
         so.price_cents, so.duration_minutes, s.name as service_name
    into v_opt
    from public.service_options so
    join public.business_sizes bs
      on bs.business_id = so.business_id and bs.code = so.size and bs.is_active
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id
     and so.business_id = v_biz.id
     and so.is_active and s.is_active and s.archived_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE');
  end if;

  if not exists (
    select 1
      from app_private.compute_slots(
             v_biz.id, v_opt.duration_minutes,
             (p_starts_at at time zone v_biz.timezone)::date,
             (p_created_by = 'admin')) cs
     where cs.slot_start = p_starts_at
  ) then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  end if;

  if p_created_by = 'customer' and (
       select count(*) from public.bookings k
        where k.business_id = v_biz.id and k.customer_phone = v_phone
          and k.status = 'confirmed' and k.starts_at > now()
     ) >= 2
  then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED');
  end if;

  v_end := p_starts_at + v_opt.duration_minutes * interval '1 minute';

  insert into public.bookings (
    business_id, service_id, service_option_id, starts_at, ends_at,
    buffer_minutes, occupied_ends_at,
    service_name, size, size_label, price_cents, duration_minutes,
    customer_name, customer_phone, pet_name, pet_breed, notes,
    created_by, consent_at, idempotency_key)
  values (
    v_biz.id, v_opt.service_id, p_option_id, p_starts_at, v_end,
    v_biz.buffer_minutes, v_end,
    v_opt.service_name, v_opt.size, v_opt.size_label, v_opt.price_cents, v_opt.duration_minutes,
    v_name, v_phone, v_pet, v_breed, v_notes,
    p_created_by, p_consent_at, p_idempotency_key)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_opt.service_name,
    'size', v_opt.size, 'size_label', v_opt.size_label,
    'starts_at', p_starts_at, 'ends_at', v_end,
    'price_cents', v_opt.price_cents, 'timezone', v_biz.timezone);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  when others then
    raise log 'create_booking falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end;
$$;

revoke all on function app_private.create_booking(
  uuid, uuid, timestamptz, text, text, text, text, text, text, timestamptz, uuid
) from public, anon, authenticated;
