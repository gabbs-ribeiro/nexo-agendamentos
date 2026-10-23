-- Modo de agendamento por servico: 'hourly' (por horario, como banho e tosa)
-- ou 'daily' (por diaria, como pet hotel).
--
-- Escopo desta migration: guardar o modo no servico, expor o modo no catalogo
-- publico e impedir que um servico por diaria seja reservado pelo fluxo por
-- horario. A reserva por diaria (entrada/saida, capacidade, calculo de
-- diarias) NAO existe ainda; ate la, o servico por diaria aparece no link
-- publico apenas como informativo.
--
-- Para servicos por diaria, service_options.price_cents e o preco de UMA diaria.
-- service_options.duration_minutes continua obrigatorio (5 a 720) por causa da
-- constraint existente, mas e ignorado para esses servicos.
--
-- NAO EXECUTADO. Aplicar primeiro no DEV, depois rodar os testes 04, 09 e 11.

do $$
begin
  if pg_catalog.to_regclass('public.services') is null
     or pg_catalog.to_regclass('public.service_options') is null
     or pg_catalog.to_regclass('public.business_sizes') is null
     or pg_catalog.to_regclass('public.service_categories') is null
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'bookings'
          and column_name = 'size_label'
     ) then
    raise exception 'Pre-requisito ausente: aplique as migrations 20261021000002 a 20261021000008 antes desta';
  end if;
end;
$$;

-- 1) Coluna e permissoes (o painel grava direto em services, sob RLS)
alter table public.services
  add column if not exists booking_mode text not null default 'hourly'
    constraint services_booking_mode_check check (booking_mode in ('hourly', 'daily'));

grant insert (booking_mode) on public.services to authenticated;
grant update (booking_mode) on public.services to authenticated;

-- 2) Catalogo publico: devolve o modo de cada servico
create or replace function public.list_public_services(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'service_id', s.id,
             'name', s.name,
             'description', s.description,
             'booking_mode', s.booking_mode,
             'options', o.opts)
           order by s.name), '[]'::jsonb)
    from public.businesses b
    join public.services s
      on s.business_id = b.id and s.is_active and s.archived_at is null
    cross join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'option_id', so.id,
                 'size', so.size,
                 'size_label', bs.name,
                 'price_cents', so.price_cents,
                 'duration_minutes', so.duration_minutes)
               order by bs.sort_order, bs.name) as opts
        from public.service_options so
        join public.business_sizes bs
          on bs.business_id = so.business_id
         and bs.code = so.size
         and bs.is_active
       where so.service_id = s.id and so.is_active
    ) o
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active
     and o.opts is not null;
$$;

revoke execute on function public.list_public_services(text)
  from public, anon, authenticated;
grant execute on function public.list_public_services(text)
  to anon, authenticated;

create or replace function public.list_public_service_categories(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category_id', c.id,
      'name', c.name,
      'description', c.description,
      'services', coalesce(s.items, '[]'::jsonb))
    order by c.sort_order, c.name), '[]'::jsonb)
    from public.businesses b
    join public.service_categories c on c.business_id = b.id
    cross join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'service_id', service.id,
          'name', service.name,
          'description', service.description,
          'booking_mode', service.booking_mode,
          'options', options.items)
        order by service.name) as items
        from public.services service
        cross join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'option_id', option.id,
              'size', option.size,
              'size_label', size.name,
              'price_cents', option.price_cents,
              'duration_minutes', option.duration_minutes)
            order by size.sort_order, size.name) as items
            from public.service_options option
            join public.business_sizes size
              on size.business_id = option.business_id
             and size.code = option.size
             and size.is_active
           where option.service_id = service.id
             and option.business_id = b.id
             and option.is_active
        ) options
       where service.business_id = b.id
         and service.category_id = c.id
         and service.is_active
         and service.archived_at is null
         and options.items is not null
    ) s
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active;
$$;

revoke execute on function public.list_public_service_categories(text) from public, anon, authenticated;
grant execute on function public.list_public_service_categories(text) to anon, authenticated;

-- 3) Horarios: servico por diaria nao tem grade de horarios
create or replace function public.get_available_slots(
  p_slug text,
  p_option_id uuid,
  p_date date)
returns table (starts_at timestamptz, local_time text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz public.businesses%rowtype;
  v_duration int;
begin
  select *
    into v_biz
    from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active;
  if not found then
    return;
  end if;

  select so.duration_minutes
    into v_duration
    from public.service_options so
    join public.business_sizes bs
      on bs.business_id = so.business_id
     and bs.code = so.size
     and bs.is_active
    join public.services s
      on s.id = so.service_id
     and s.business_id = so.business_id
   where so.id = p_option_id
     and so.business_id = v_biz.id
     and so.is_active
     and s.is_active
     and s.archived_at is null
     and s.booking_mode = 'hourly';
  if v_duration is null then
    return;
  end if;

  return query
    select cs.slot_start,
           to_char(cs.slot_start at time zone v_biz.timezone, 'HH24:MI')
      from app_private.compute_slots(v_biz.id, v_duration, p_date) cs;
end;
$$;

revoke execute on function public.get_available_slots(text, uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date)
  to anon, authenticated;

-- 4) Reserva (publica e admin passam por aqui): so servico por horario
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
     and so.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'hourly';
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
