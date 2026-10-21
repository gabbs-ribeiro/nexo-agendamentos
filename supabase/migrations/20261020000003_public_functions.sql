-- =====================================================================
-- 003: funcoes PUBLICAS (unica porta de entrada do cliente sem conta)
-- O papel "anon" NAO tem acesso a nenhuma tabela; so executa estas funcoes.
-- Todas sao SECURITY DEFINER com search_path vazio, entram por "slug" e
-- devolvem somente o minimo necessario (nunca ids de negocio, nunca dados
-- de outros clientes, nunca se um horario esta "ocupado" ou "bloqueado").
-- =====================================================================

-- Dados de marca do negocio. Retorna NULL se nao existir ou estiver inativo.
create or replace function public.get_public_business(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'slug', b.slug,
           'name', b.name,
           'logo_path', b.logo_path,
           'primary_color', b.primary_color,
           'timezone', b.timezone,
           'max_days_ahead', b.max_days_ahead)
    from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
$$;

-- Servicos ativos com seus portes ativos (preco e duracao).
create or replace function public.list_public_services(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('service_id', s.id, 'name', s.name, 'options', o.opts)
           order by s.name), '[]'::jsonb)
    from public.businesses b
    join public.services s
      on s.business_id = b.id and s.is_active and s.archived_at is null
    cross join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'option_id', so.id, 'size', so.size,
                 'price_cents', so.price_cents, 'duration_minutes', so.duration_minutes)
               order by case so.size when 'small' then 1 when 'medium' then 2 else 3 end) as opts
        from public.service_options so
       where so.service_id = s.id and so.is_active
    ) o
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active
     and o.opts is not null;
$$;

-- Horarios de INICIO livres para uma opcao de servico em uma data (no fuso do negocio).
create or replace function public.get_available_slots(
  p_slug text, p_option_id uuid, p_date date)
returns table (starts_at timestamptz, local_time text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz public.businesses%rowtype;
  v_dur int;
begin
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then return; end if;

  select so.duration_minutes into v_dur
    from public.service_options so
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id and so.business_id = v_biz.id
     and so.is_active and s.is_active and s.archived_at is null;
  if v_dur is null then return; end if;

  return query
    select cs.slot_start,
           to_char(cs.slot_start at time zone v_biz.timezone, 'HH24:MI')
      from app_private.compute_slots(v_biz.id, v_dur, p_date) cs;
end $$;

-- Cria a reserva. Retorna SEMPRE jsonb: {"ok":true,...} ou {"ok":false,"error":"CODIGO"}.
-- Codigos: INVALID_INPUT, CONSENT_REQUIRED, NOT_FOUND, SERVICE_UNAVAILABLE,
--          SLOT_UNAVAILABLE, LIMIT_REACHED, INTERNAL_ERROR.
create or replace function public.create_public_booking(
  p_slug            text,
  p_option_id       uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_pet_name        text,
  p_pet_breed       text,
  p_notes           text,
  p_consent         boolean,
  p_idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_business_id uuid;
begin
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'error', 'CONSENT_REQUIRED');
  end if;

  select b.id into v_business_id from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if v_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  return app_private.create_booking(
    v_business_id, p_option_id, p_starts_at,
    p_customer_name, p_customer_phone, p_pet_name, p_pet_breed, p_notes,
    'customer', now(), p_idempotency_key);
end $$;
