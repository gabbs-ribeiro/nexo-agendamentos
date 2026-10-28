-- Leva e traz (frete) por reserva.
--
-- Regras:
-- * Cada servico pode oferecer leva e traz (services.transport_enabled, padrao false).
-- * A responsavel informa MANUALMENTE a distancia de IDA em km (sem servico de mapas).
--   frete = taxa de partida + distancia de ida x 4 x valor por km
--   (busca: ida e volta; entrega: ida e volta). Sempre os dois trechos.
-- * Taxa de partida e valor por km tem padrao por negocio (businesses.transport_*),
--   editaveis no Controle; cada cotacao guarda o snapshot dos valores usados.
-- * O pedido nasce 'requested' (cliente pediu), vira 'quoted' (cotado, NAO soma no total)
--   e so entra no total da reserva quando a responsavel clica em confirmar ('confirmed').
-- * O calculo e feito AQUI, no banco. O navegador nunca envia o valor do frete.
-- * Funciona para os tres tipos de reserva: bookings (horario), stay_bookings (hospedagem)
--   e daycare_bookings (creche por periodo). A reserva em si nao e alterada.
--
-- NAO EXECUTADO. Aplicar primeiro no DEV, depois rodar os testes 15 e 04.

do $$
begin
  if pg_catalog.to_regclass('public.bookings') is null
     or pg_catalog.to_regclass('public.stay_bookings') is null
     or pg_catalog.to_regclass('public.daycare_bookings') is null
     or pg_catalog.to_regprocedure('app_private.is_member(uuid)') is null then
    raise exception 'Pre-requisito ausente: aplique as migrations anteriores (ate 20261023000002) antes desta';
  end if;
end;
$$;

-- 1) Valores padrao do negocio (editaveis no Controle) e flag por servico
alter table public.businesses
  add column if not exists transport_start_fee_cents int not null default 500
    constraint businesses_transport_start_fee check (transport_start_fee_cents between 0 and 100000),
  add column if not exists transport_km_price_cents int not null default 100
    constraint businesses_transport_km_price check (transport_km_price_cents between 0 and 100000);

grant update (transport_start_fee_cents, transport_km_price_cents) on public.businesses to authenticated;

alter table public.services
  add column if not exists transport_enabled boolean not null default false;

grant insert (transport_enabled) on public.services to authenticated;
grant update (transport_enabled) on public.services to authenticated;

-- 2) Pedidos de leva e traz (um por reserva)
create table public.transport_requests (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete restrict,
  booking_id    uuid references public.bookings (id) on delete restrict,
  stay_id       uuid references public.stay_bookings (id) on delete restrict,
  daycare_id    uuid references public.daycare_bookings (id) on delete restrict,
  status        text not null default 'requested'
                  check (status in ('requested', 'quoted', 'confirmed', 'cancelled')),
  requested_by  text not null check (requested_by in ('customer', 'admin')),
  street        text not null check (char_length(street) between 2 and 120),
  street_number text check (street_number is null or char_length(street_number) <= 20),
  neighborhood  text check (neighborhood is null or char_length(neighborhood) <= 80),
  city          text check (city is null or char_length(city) <= 80),
  complement    text check (complement is null or char_length(complement) <= 80),
  reference     text check (reference is null or char_length(reference) <= 120),
  -- cotacao (snapshot dos valores usados)
  distance_km     numeric(6, 1) check (distance_km is null or (distance_km > 0 and distance_km <= 200)),
  start_fee_cents int check (start_fee_cents is null or start_fee_cents between 0 and 100000),
  km_price_cents  int check (km_price_cents is null or km_price_cents between 0 and 100000),
  freight_cents   int check (freight_cents is null or freight_cents >= 0),
  quoted_at     timestamptz,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint transport_one_reservation check (num_nonnulls(booking_id, stay_id, daycare_id) = 1),
  constraint transport_quote_complete check (
    (distance_km is null) = (freight_cents is null)
    and (distance_km is null) = (start_fee_cents is null)
    and (distance_km is null) = (km_price_cents is null)),
  constraint transport_status_needs_quote check (
    status in ('requested', 'cancelled') or freight_cents is not null),
  constraint transport_confirmed_at check ((status = 'confirmed') = (confirmed_at is not null))
);

create unique index transport_requests_booking_uq on public.transport_requests (booking_id)
  where booking_id is not null;
create unique index transport_requests_stay_uq on public.transport_requests (stay_id)
  where stay_id is not null;
create unique index transport_requests_daycare_uq on public.transport_requests (daycare_id)
  where daycare_id is not null;
create index transport_requests_open_idx on public.transport_requests (business_id, status, created_at);

create trigger trg_transport_requests_bizlock before update on public.transport_requests
  for each row execute function app_private.forbid_business_change();
create trigger trg_transport_requests_updated before update on public.transport_requests
  for each row execute function app_private.set_updated_at();

alter table public.transport_requests enable row level security;
revoke all on public.transport_requests from public, anon, authenticated;
grant select on public.transport_requests to authenticated;
create policy transport_requests_select on public.transport_requests for select to authenticated
  using (business_id in (
    select m.business_id from public.business_members m where m.user_id = (select auth.uid())
  ));

-- 3) Localiza a reserva (qualquer tipo) e devolve negocio, status e servico
create or replace function app_private.transport_reservation(p_kind text, p_id uuid)
returns table (business_id uuid, status text, service_id uuid)
language plpgsql stable set search_path = '' as $$
begin
  if p_kind = 'booking' then
    return query select b.business_id, b.status, b.service_id from public.bookings b where b.id = p_id;
  elsif p_kind = 'stay' then
    return query select s.business_id, s.status, s.service_id from public.stay_bookings s where s.id = p_id;
  elsif p_kind = 'daycare' then
    return query select d.business_id, d.status, d.service_id from public.daycare_bookings d where d.id = p_id;
  end if;
end $$;

revoke all on function app_private.transport_reservation(text, uuid) from public, anon, authenticated;

-- 4) Cliente: o servico oferece leva e traz? ja existe pedido?
create or replace function public.get_transport_state(p_slug text, p_kind text, p_ref uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz     public.businesses%rowtype;
  v_res     record;
  v_enabled boolean;
  v_status  text;
begin
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found or p_ref is null or p_kind not in ('booking', 'stay', 'daycare') then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select * into v_res from app_private.transport_reservation(p_kind, p_ref);
  if not found or v_res.business_id <> v_biz.id then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select s.transport_enabled into v_enabled from public.services s
   where s.id = v_res.service_id and s.business_id = v_biz.id;

  select t.status into v_status from public.transport_requests t
   where t.business_id = v_biz.id
     and ((p_kind = 'booking' and t.booking_id = p_ref)
       or (p_kind = 'stay' and t.stay_id = p_ref)
       or (p_kind = 'daycare' and t.daycare_id = p_ref));

  return jsonb_build_object(
    'ok', true,
    'enabled', coalesce(v_enabled, false) and v_res.status = 'confirmed',
    'request_status', v_status);
end $$;

-- 5) Cliente: solicita o leva e traz informando o endereco (sem valor: quem cota e a responsavel)
create or replace function public.request_transport(
  p_slug         text,
  p_kind         text,
  p_ref          uuid,
  p_street       text,
  p_number       text,
  p_neighborhood text,
  p_city         text,
  p_complement   text,
  p_reference    text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_biz      public.businesses%rowtype;
  v_res      record;
  v_enabled  boolean;
  v_street   text := btrim(coalesce(p_street, ''));
  v_number   text := btrim(coalesce(p_number, ''));
  v_hood     text := btrim(coalesce(p_neighborhood, ''));
  v_city     text := nullif(btrim(coalesce(p_city, '')), '');
  v_compl    text := nullif(btrim(coalesce(p_complement, '')), '');
  v_ref      text := nullif(btrim(coalesce(p_reference, '')), '');
  v_existing public.transport_requests%rowtype;
begin
  if p_kind not in ('booking', 'stay', 'daycare') or p_ref is null
     or char_length(v_street) not between 2 and 120
     or char_length(v_number) not between 1 and 20
     or char_length(v_hood) not between 2 and 80
     or char_length(coalesce(v_city, '')) > 80
     or char_length(coalesce(v_compl, '')) > 80
     or char_length(coalesce(v_ref, '')) > 120 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  select * into v_res from app_private.transport_reservation(p_kind, p_ref);
  if not found or v_res.business_id <> v_biz.id then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select s.transport_enabled into v_enabled from public.services s
   where s.id = v_res.service_id and s.business_id = v_biz.id;
  if not coalesce(v_enabled, false) or v_res.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'TRANSPORT_UNAVAILABLE');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':transport', 0));

  select * into v_existing from public.transport_requests t
   where t.business_id = v_biz.id
     and ((p_kind = 'booking' and t.booking_id = p_ref)
       or (p_kind = 'stay' and t.stay_id = p_ref)
       or (p_kind = 'daycare' and t.daycare_id = p_ref));

  if found then
    -- depois que a responsavel cotou, o endereco so muda pelo painel
    if v_existing.status <> 'requested' then
      return jsonb_build_object('ok', false, 'error', 'TRANSPORT_LOCKED');
    end if;
    update public.transport_requests
       set street = v_street, street_number = v_number, neighborhood = v_hood,
           city = v_city, complement = v_compl, reference = v_ref
     where id = v_existing.id;
  else
    insert into public.transport_requests (
      business_id, booking_id, stay_id, daycare_id, requested_by,
      street, street_number, neighborhood, city, complement, reference)
    values (
      v_biz.id,
      case when p_kind = 'booking' then p_ref end,
      case when p_kind = 'stay' then p_ref end,
      case when p_kind = 'daycare' then p_ref end,
      'customer', v_street, v_number, v_hood, v_city, v_compl, v_ref);
  end if;

  return jsonb_build_object('ok', true, 'request_status', 'requested');
exception
  when others then
    raise log 'request_transport falhou: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- 6) Painel: salva a cotacao (cria o pedido se a cliente pediu depois, por fora do site)
create or replace function public.admin_save_transport_quote(
  p_kind          text,
  p_reservation_id uuid,
  p_street        text,
  p_number        text,
  p_neighborhood  text,
  p_city          text,
  p_complement    text,
  p_reference     text,
  p_distance_km   numeric,
  p_start_fee_cents int,
  p_km_price_cents  int)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_res      record;
  v_street   text := btrim(coalesce(p_street, ''));
  v_number   text := nullif(btrim(coalesce(p_number, '')), '');
  v_hood     text := nullif(btrim(coalesce(p_neighborhood, '')), '');
  v_city     text := nullif(btrim(coalesce(p_city, '')), '');
  v_compl    text := nullif(btrim(coalesce(p_complement, '')), '');
  v_ref      text := nullif(btrim(coalesce(p_reference, '')), '');
  v_km       numeric(6, 1);
  v_freight  int;
  v_existing public.transport_requests%rowtype;
  v_id       uuid;
begin
  if p_kind not in ('booking', 'stay', 'daycare') or p_reservation_id is null
     or p_distance_km is null or p_start_fee_cents is null or p_km_price_cents is null
     or p_distance_km <= 0 or p_distance_km > 200
     or p_start_fee_cents not between 0 and 100000
     or p_km_price_cents not between 0 and 100000
     or char_length(v_street) not between 2 and 120
     or char_length(coalesce(v_number, '')) > 20
     or char_length(coalesce(v_hood, '')) > 80
     or char_length(coalesce(v_city, '')) > 80
     or char_length(coalesce(v_compl, '')) > 80
     or char_length(coalesce(v_ref, '')) > 120 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_res from app_private.transport_reservation(p_kind, p_reservation_id);
  if not found or not app_private.is_member(v_res.business_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_res.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_res.business_id::text || ':transport', 0));

  -- distancia com 1 casa; frete = taxa + ida x 4 x valor por km (arredondado ao centavo)
  v_km := round(p_distance_km, 1);
  if v_km <= 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  v_freight := p_start_fee_cents + round(v_km * 4 * p_km_price_cents)::int;

  select * into v_existing from public.transport_requests t
   where t.business_id = v_res.business_id
     and ((p_kind = 'booking' and t.booking_id = p_reservation_id)
       or (p_kind = 'stay' and t.stay_id = p_reservation_id)
       or (p_kind = 'daycare' and t.daycare_id = p_reservation_id))
   for update;

  if found then
    -- cotacao confirmada ja esta no total: desfazer a confirmacao antes de recalcular
    if v_existing.status = 'confirmed' then
      return jsonb_build_object('ok', false, 'error', 'TRANSPORT_LOCKED');
    end if;
    update public.transport_requests
       set street = v_street, street_number = v_number, neighborhood = v_hood,
           city = v_city, complement = v_compl, reference = v_ref,
           distance_km = v_km, start_fee_cents = p_start_fee_cents,
           km_price_cents = p_km_price_cents, freight_cents = v_freight,
           status = 'quoted', quoted_at = now()
     where id = v_existing.id
     returning id into v_id;
  else
    insert into public.transport_requests (
      business_id, booking_id, stay_id, daycare_id, requested_by, status,
      street, street_number, neighborhood, city, complement, reference,
      distance_km, start_fee_cents, km_price_cents, freight_cents, quoted_at)
    values (
      v_res.business_id,
      case when p_kind = 'booking' then p_reservation_id end,
      case when p_kind = 'stay' then p_reservation_id end,
      case when p_kind = 'daycare' then p_reservation_id end,
      'admin', 'quoted',
      v_street, v_number, v_hood, v_city, v_compl, v_ref,
      v_km, p_start_fee_cents, p_km_price_cents, v_freight, now())
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'request_id', v_id, 'status', 'quoted',
    'distance_km', v_km, 'freight_cents', v_freight);
exception
  when others then
    raise log 'admin_save_transport_quote falhou: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- 7) Painel: confirmar (soma no total), desfazer a confirmacao ou cancelar o pedido
create or replace function public.admin_set_transport_status(
  p_request_id uuid, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_req public.transport_requests%rowtype;
  v_res record;
  v_kind text;
  v_rid uuid;
begin
  if p_status is null or p_status not in ('confirmed', 'quoted', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_req from public.transport_requests t
   where t.id = p_request_id and app_private.is_member(t.business_id);
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  perform pg_advisory_xact_lock(hashtextextended(v_req.business_id::text || ':transport', 0));
  select * into v_req from public.transport_requests t where t.id = p_request_id for update;

  if v_req.status = 'cancelled'
     or (p_status = 'confirmed' and v_req.status <> 'quoted')
     or (p_status = 'quoted' and v_req.status <> 'confirmed') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;

  if p_status = 'confirmed' then
    v_kind := case when v_req.booking_id is not null then 'booking'
                   when v_req.stay_id is not null then 'stay' else 'daycare' end;
    v_rid := coalesce(v_req.booking_id, v_req.stay_id, v_req.daycare_id);
    select * into v_res from app_private.transport_reservation(v_kind, v_rid);
    if not found or v_res.status <> 'confirmed' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
    end if;
  end if;

  update public.transport_requests
     set status = p_status,
         confirmed_at = case when p_status = 'confirmed' then now() else null end
   where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', p_status);
exception
  when others then
    raise log 'admin_set_transport_status falhou: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- 8) Permissoes de execucao
revoke execute on function public.get_transport_state(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_transport_state(text, text, uuid) to anon, authenticated;

revoke execute on function public.request_transport(text, text, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_transport(text, text, uuid, text, text, text, text, text, text)
  to anon, authenticated;

revoke execute on function public.admin_save_transport_quote(
  text, uuid, text, text, text, text, text, text, numeric, int, int)
  from public, anon, authenticated;
grant execute on function public.admin_save_transport_quote(
  text, uuid, text, text, text, text, text, text, numeric, int, int)
  to authenticated;

revoke execute on function public.admin_set_transport_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_transport_status(uuid, text) to authenticated;
