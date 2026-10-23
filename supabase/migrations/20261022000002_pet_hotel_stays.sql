-- Hospedagem por diaria (pet hotel), INDEPENDENTE da agenda de horarios.
--
-- * Estadias ficam em public.stay_bookings, tabela propria. Nao tocam em
--   public.bookings, no gap, no expediente, nas folgas (time_blocks) nem na
--   exclusion constraint da agenda: banho e tosa e hotel acontecem ao mesmo tempo.
-- * Capacidade: businesses.stay_capacity (padrao 4 pets por vez). Uma estadia
--   ocupa 1 vaga em cada NOITE de [entrada, saida). A noite da saida nao conta.
-- * Concorrencia: advisory lock proprio das estadias (chave diferente da agenda).
-- * Escrita somente por funcoes; anon nao le tabelas.
--
-- Exige 20261022000001_service_booking_mode.sql.
-- NAO EXECUTADO. Aplicar primeiro no DEV, depois rodar os testes 12, 04, 09 e 11.

do $$
begin
  if not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'services'
          and column_name = 'booking_mode'
     )
     or pg_catalog.to_regclass('public.business_sizes') is null
     or pg_catalog.to_regclass('public.service_options') is null then
    raise exception 'Pre-requisito ausente: aplique 20261022000001_service_booking_mode.sql antes desta migration';
  end if;
end;
$$;

-- 1) Capacidade do hotel por negocio. Sem grant de UPDATE: ajuste so pelo desenvolvedor.
alter table public.businesses
  add column if not exists stay_capacity int not null default 4
    constraint businesses_stay_capacity check (stay_capacity between 1 and 100);

-- 2) Estadias
create table public.stay_bookings (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete restrict,
  service_id        uuid not null,
  service_option_id uuid not null,
  status            text not null default 'confirmed'
                      check (status in ('confirmed', 'cancelled', 'completed')),
  check_in          date not null,
  check_out         date not null,
  nights            int  not null check (nights between 1 and 30),
  -- snapshot: editar o servico depois nao altera o historico
  service_name      text not null,
  size              text not null,
  size_label        text not null,
  daily_price_cents int  not null check (daily_price_cents >= 0),
  total_price_cents int  not null check (total_price_cents >= 0),
  customer_name     text not null check (char_length(customer_name) between 2 and 100),
  customer_phone    text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  pet_name          text not null check (char_length(pet_name) between 1 and 60),
  pet_breed         text check (pet_breed is null or char_length(pet_breed) <= 60),
  notes             text check (notes is null or char_length(notes) <= 500),
  created_by        text not null default 'customer' check (created_by in ('customer')),
  consent_at        timestamptz not null,
  idempotency_key   uuid,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint stay_bookings_dates check (check_out > check_in),
  constraint stay_bookings_nights check (nights = check_out - check_in),
  constraint stay_bookings_cancel_consistency check ((status = 'cancelled') = (cancelled_at is not null)),
  foreign key (service_option_id, service_id, business_id)
    references public.service_options (id, service_id, business_id) on delete restrict
);

create unique index stay_bookings_idempotency_uq on public.stay_bookings (business_id, idempotency_key)
  where idempotency_key is not null;
create index stay_bookings_business_in_idx on public.stay_bookings (business_id, check_in);
create index stay_bookings_business_out_idx on public.stay_bookings (business_id, check_out);
create index stay_bookings_phone_idx on public.stay_bookings (business_id, customer_phone)
  where status = 'confirmed';

create trigger trg_stay_bookings_bizlock before update on public.stay_bookings
  for each row execute function app_private.forbid_business_change();
create trigger trg_stay_bookings_updated before update on public.stay_bookings
  for each row execute function app_private.set_updated_at();

-- 3) RLS e grants: so leitura direta pelos membros; escrita somente por funcoes
alter table public.stay_bookings enable row level security;
revoke all on public.stay_bookings from public, anon, authenticated;
grant select on public.stay_bookings to authenticated;

create policy stay_bookings_select on public.stay_bookings for select to authenticated
  using (business_id in (
    select m.business_id from public.business_members m where m.user_id = (select auth.uid())
  ));

-- 4) Maior ocupacao (pets ao mesmo tempo) em qualquer noite de [entrada, saida)
create or replace function app_private.stay_peak_occupancy(
  p_business_id uuid,
  p_check_in    date,
  p_check_out   date)
returns int
language sql stable set search_path = '' as $$
  select coalesce(max(c.cnt), 0)::int
    from (
      select (
        select count(*)
          from public.stay_bookings s
         where s.business_id = p_business_id
           and s.status = 'confirmed'
           and s.check_in <= n.night
           and s.check_out > n.night
      ) as cnt
        from (
          select g::date as night
            from generate_series(p_check_in::timestamp, (p_check_out - 1)::timestamp, interval '1 day') g
        ) n
    ) c;
$$;

revoke all on function app_private.stay_peak_occupancy(uuid, date, date)
  from public, anon, authenticated;

-- 5) Orcamento publico: disponibilidade, numero de diarias e valor
create or replace function public.get_stay_quote(
  p_slug      text,
  p_option_id uuid,
  p_check_in  date,
  p_check_out date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz   public.businesses%rowtype;
  v_opt   record;
  v_today date;
  v_nights int;
  v_peak  int;
begin
  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select so.price_cents, so.size, bs.name as size_label, s.name as service_name
    into v_opt
    from public.service_options so
    join public.business_sizes bs
      on bs.business_id = so.business_id and bs.code = so.size and bs.is_active
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id
     and so.business_id = v_biz.id
     and so.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'daily';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE');
  end if;

  v_today := (now() at time zone v_biz.timezone)::date;
  if p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  v_nights := p_check_out - p_check_in;
  if v_nights > 30 or p_check_in < v_today or p_check_in > v_today + v_biz.max_days_ahead then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  v_peak := app_private.stay_peak_occupancy(v_biz.id, p_check_in, p_check_out);

  return jsonb_build_object(
    'ok', true,
    'available', v_peak < v_biz.stay_capacity,
    'nights', v_nights,
    'daily_price_cents', v_opt.price_cents,
    'total_price_cents', v_opt.price_cents * v_nights);
end $$;

-- 6) Reserva publica da estadia
create or replace function public.create_public_stay(
  p_slug            text,
  p_option_id       uuid,
  p_check_in        date,
  p_check_out       date,
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
  v_biz      public.businesses%rowtype;
  v_opt      record;
  v_existing public.stay_bookings%rowtype;
  v_name     text := btrim(coalesce(p_customer_name, ''));
  v_pet      text := btrim(coalesce(p_pet_name, ''));
  v_breed    text := nullif(btrim(coalesce(p_pet_breed, '')), '');
  v_notes    text := nullif(btrim(coalesce(p_notes, '')), '');
  v_phone    text := app_private.normalize_phone(p_customer_phone);
  v_today    date;
  v_nights   int;
  v_id       uuid;
begin
  if p_consent is not true then
    return jsonb_build_object('ok', false, 'error', 'CONSENT_REQUIRED');
  end if;

  if p_option_id is null or p_check_in is null or p_check_out is null
     or p_check_out <= p_check_in or p_idempotency_key is null
     or char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(v_breed, '')) > 60
     or char_length(coalesce(v_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$'
  then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_biz from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- lock PROPRIO das estadias: nao espera nem bloqueia a agenda de horarios
  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':stay', 0));

  select * into v_existing from public.stay_bookings k
   where k.business_id = v_biz.id and k.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.status <> 'confirmed' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent', true,
      'booking_ref', v_existing.id, 'service_name', v_existing.service_name,
      'size', v_existing.size, 'size_label', v_existing.size_label,
      'check_in', v_existing.check_in, 'check_out', v_existing.check_out,
      'nights', v_existing.nights,
      'daily_price_cents', v_existing.daily_price_cents,
      'total_price_cents', v_existing.total_price_cents,
      'timezone', v_biz.timezone);
  end if;

  select so.service_id, so.size, bs.name as size_label,
         so.price_cents, s.name as service_name
    into v_opt
    from public.service_options so
    join public.business_sizes bs
      on bs.business_id = so.business_id and bs.code = so.size and bs.is_active
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id
     and so.business_id = v_biz.id
     and so.is_active and s.is_active and s.archived_at is null
     and s.booking_mode = 'daily';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'SERVICE_UNAVAILABLE');
  end if;

  v_today := (now() at time zone v_biz.timezone)::date;
  v_nights := p_check_out - p_check_in;
  if v_nights > 30 or p_check_in < v_today or p_check_in > v_today + v_biz.max_days_ahead then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  if app_private.stay_peak_occupancy(v_biz.id, p_check_in, p_check_out) >= v_biz.stay_capacity then
    return jsonb_build_object('ok', false, 'error', 'STAY_FULL');
  end if;

  if (
       select count(*) from public.stay_bookings k
        where k.business_id = v_biz.id and k.customer_phone = v_phone
          and k.status = 'confirmed' and k.check_out > v_today
     ) >= 2
  then
    return jsonb_build_object('ok', false, 'error', 'LIMIT_REACHED');
  end if;

  insert into public.stay_bookings (
    business_id, service_id, service_option_id, check_in, check_out, nights,
    service_name, size, size_label, daily_price_cents, total_price_cents,
    customer_name, customer_phone, pet_name, pet_breed, notes,
    created_by, consent_at, idempotency_key)
  values (
    v_biz.id, v_opt.service_id, p_option_id, p_check_in, p_check_out, v_nights,
    v_opt.service_name, v_opt.size, v_opt.size_label, v_opt.price_cents, v_opt.price_cents * v_nights,
    v_name, v_phone, v_pet, v_breed, v_notes,
    'customer', now(), p_idempotency_key)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'booking_ref', v_id, 'service_name', v_opt.service_name,
    'size', v_opt.size, 'size_label', v_opt.size_label,
    'check_in', p_check_in, 'check_out', p_check_out, 'nights', v_nights,
    'daily_price_cents', v_opt.price_cents,
    'total_price_cents', v_opt.price_cents * v_nights,
    'timezone', v_biz.timezone);
exception
  when others then
    raise log 'create_public_stay falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- 7) Admin: cancelar ou concluir uma estadia. Cancelado e definitivo.
create or replace function public.admin_set_stay_status(
  p_stay_id uuid, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_s     public.stay_bookings%rowtype;
  v_today date;
begin
  if p_status is null or p_status not in ('cancelled', 'completed') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_s from public.stay_bookings k
   where k.id = p_stay_id and app_private.is_member(k.business_id);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_s.business_id::text || ':stay', 0));
  select * into v_s from public.stay_bookings k where k.id = p_stay_id for update;

  if v_s.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;

  select (now() at time zone b.timezone)::date into v_today
    from public.businesses b where b.id = v_s.business_id;
  if p_status = 'completed' and v_s.check_out > v_today then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;

  update public.stay_bookings
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled' then now() else null end
   where id = p_stay_id;

  return jsonb_build_object('ok', true, 'status', p_status);
exception
  when others then
    raise log 'admin_set_stay_status falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- 8) Permissoes de execucao (funcao nova em public nasce executavel por PUBLIC)
revoke execute on function public.get_stay_quote(text, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.get_stay_quote(text, uuid, date, date)
  to anon, authenticated;

revoke execute on function public.create_public_stay(
  text, uuid, date, date, text, text, text, text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.create_public_stay(
  text, uuid, date, date, text, text, text, text, text, boolean, uuid)
  to anon, authenticated;

revoke execute on function public.admin_set_stay_status(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_stay_status(uuid, text)
  to authenticated;
