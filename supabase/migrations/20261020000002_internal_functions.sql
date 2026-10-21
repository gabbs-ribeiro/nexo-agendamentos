-- =====================================================================
-- 002: funcoes INTERNAS (schema app_private, nao expostas pela API)
-- Concentram as regras de negocio num unico caminho de codigo.
-- =====================================================================

-- O usuario logado administra este negocio?
create or replace function app_private.is_member(p_business_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function app_private.require_member(p_business_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if not app_private.is_member(p_business_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;

-- Telefone: somente digitos, sem o 55 do pais (so remove quando o total e 12 ou 13 digitos).
create or replace function app_private.normalize_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case when s.d ~ '^55[0-9]{10,11}$' then substr(s.d, 3) else s.d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s;
$$;

-- ---------------------------------------------------------------------
-- compute_slots: UNICA fonte de verdade para "este horario esta livre?".
-- Usada tanto para listar horarios quanto para validar a reserva.
--
-- Regras:
--  * inicios possiveis = abertura + k * passo da grade (dentro de cada faixa do dia)
--  * duracao real do servico (sem arredondar)
--  * por padrao o SERVICO precisa terminar ate o fechamento;
--    com allow_end_after_close = true basta INICIAR antes do fechamento
--  * gap: ocupa o horario depois do servico; pode passar do fechamento
--    (nao e atendimento) e NAO conflita com bloqueios, so com outros agendamentos
--  * bloqueios conflitam com o intervalo do SERVICO
--  * cliente: antecedencia minima e maxima; admin: ignora as duas (nao agenda no passado)
-- ---------------------------------------------------------------------
create or replace function app_private.compute_slots(
  p_business_id      uuid,
  p_duration_minutes int,
  p_date             date,
  p_admin            boolean default false,
  p_exclude_booking  uuid    default null
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable set search_path = '' as $$
declare
  b       record;
  v_today date;
  v_dow   int;
begin
  select bz.timezone, bz.buffer_minutes, bz.slot_step_minutes, bz.min_notice_minutes,
         bz.max_days_ahead, bz.allow_end_after_close
    into b
    from public.businesses bz
   where bz.id = p_business_id;

  if not found or p_date is null or p_duration_minutes is null or p_duration_minutes <= 0 then
    return;
  end if;

  v_today := (now() at time zone b.timezone)::date;
  if p_date < v_today then return; end if;
  if not p_admin and p_date > v_today + b.max_days_ahead then return; end if;

  v_dow := extract(dow from p_date)::int;

  return query
  select c.s, c.e
  from (
    select
      ((p_date::timestamp + m * interval '1 minute') at time zone b.timezone) as s,
      ((p_date::timestamp + m * interval '1 minute') at time zone b.timezone)
        + p_duration_minutes * interval '1 minute' as e
    from public.business_hours h
    cross join lateral generate_series(
      h.opens_minute::int,
      case when b.allow_end_after_close
           then h.closes_minute::int - 1
           else h.closes_minute::int - p_duration_minutes end,
      b.slot_step_minutes
    ) as m
    where h.business_id = p_business_id
      and h.day_of_week = v_dow
  ) c
  where c.s >= case when p_admin then now()
                    else now() + b.min_notice_minutes * interval '1 minute' end
    and not exists (
      select 1 from public.bookings k
      where k.business_id = p_business_id
        and k.status <> 'cancelled'
        and (p_exclude_booking is null or k.id <> p_exclude_booking)
        and tstzrange(k.starts_at, k.occupied_ends_at, '[)')
            && tstzrange(c.s, c.e + b.buffer_minutes * interval '1 minute', '[)')
    )
    and not exists (
      select 1 from public.time_blocks t
      where t.business_id = p_business_id
        and t.starts_at < c.e
        and t.ends_at   > c.s
    )
  order by c.s;
end $$;

-- ---------------------------------------------------------------------
-- create_booking: caminho UNICO de criacao (publico e admin chamam esta funcao).
-- Concorrencia:
--  1) advisory lock transacional por negocio serializa reservas e bloqueios;
--  2) a exclusion constraint em bookings e a rede de seguranca final.
-- Requer READ COMMITTED (padrao do Postgres/PostgREST): depois do lock, cada
-- comando enxerga o que a transacao anterior ja confirmou.
-- Erros esperados voltam como {"ok":false,"error":"CODIGO"}; nunca erro bruto.
-- ---------------------------------------------------------------------
create or replace function app_private.create_booking(
  p_business_id     uuid,
  p_option_id       uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_pet_name        text,
  p_pet_breed       text,
  p_notes           text,
  p_created_by      text,        -- 'customer' | 'admin'
  p_consent_at      timestamptz, -- obrigatorio para 'customer'
  p_idempotency_key uuid         -- obrigatorio para 'customer'
)
returns jsonb
language plpgsql set search_path = '' as $$
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
  -- 1) validacao de entrada (antes de qualquer lock)
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

  -- 2) serializa tudo que mexe na agenda deste negocio
  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text, 0));

  -- 3) idempotencia (retry de rede / clique duplo)
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
        'size', v_existing.size, 'starts_at', v_existing.starts_at,
        'ends_at', v_existing.ends_at, 'price_cents', v_existing.price_cents,
        'timezone', v_biz.timezone);
    end if;
  end if;

  -- 4) servico e opcao: ativos, nao arquivados, do mesmo negocio
  select so.service_id, so.size, so.price_cents, so.duration_minutes, s.name as service_name
    into v_opt
    from public.service_options so
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id
     and so.business_id = v_biz.id
     and so.is_active and s.is_active and s.archived_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE');
  end if;

  -- 5) o horario precisa estar entre os horarios livres calculados
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

  -- 6) anti-abuso (so cliente publico): max. 2 agendamentos futuros por telefone
  if p_created_by = 'customer' and (
       select count(*) from public.bookings k
        where k.business_id = v_biz.id and k.customer_phone = v_phone
          and k.status = 'confirmed' and k.starts_at > now()
     ) >= 2
  then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED');
  end if;

  -- 7) grava (snapshot de servico, preco, duracao e gap)
  v_end := p_starts_at + v_opt.duration_minutes * interval '1 minute';

  insert into public.bookings (
    business_id, service_id, service_option_id, starts_at, ends_at,
    buffer_minutes, occupied_ends_at,
    service_name, size, price_cents, duration_minutes,
    customer_name, customer_phone, pet_name, pet_breed, notes,
    created_by, consent_at, idempotency_key)
  values (
    v_biz.id, v_opt.service_id, p_option_id, p_starts_at, v_end,
    v_biz.buffer_minutes, v_end,
    v_opt.service_name, v_opt.size, v_opt.price_cents, v_opt.duration_minutes,
    v_name, v_phone, v_pet, v_breed, v_notes,
    p_created_by, p_consent_at, p_idempotency_key)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_opt.service_name,
    'size', v_opt.size, 'starts_at', p_starts_at, 'ends_at', v_end,
    'price_cents', v_opt.price_cents, 'timezone', v_biz.timezone);

exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  when others then
    -- detalhe fica so no log do servidor; o cliente recebe um codigo generico
    raise log 'create_booking falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

revoke all on all functions in schema app_private from public, anon, authenticated;
