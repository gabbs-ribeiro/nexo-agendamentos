-- =====================================================================
-- Nexo Agendamentos — Etapa 3 — 001: schema, tabelas, constraints, triggers
-- NAO EXECUTADO ainda. Revisar antes de rodar (primeiro no projeto de DEV).
-- =====================================================================

-- btree_gist permite exclusion constraints combinando "=" (uuid) com "&&" (intervalo).
create extension if not exists btree_gist with schema extensions;

-- Schema interno: NAO fica exposto pela API (PostgREST so expoe "public").
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Funcoes de trigger
-- ---------------------------------------------------------------------
create or replace function app_private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- business_id nunca pode mudar depois de criado (evita "mover" linhas entre negocios).
create or replace function app_private.forbid_business_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'business_id e imutavel' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app_private.validate_business()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone) then
    raise exception 'timezone invalido' using errcode = '22023';
  end if;
  return new;
end $$;

-- occupied_ends_at = fim do servico + gap. timestamptz + interval nao e IMMUTABLE,
-- por isso nao usamos coluna gerada; um trigger garante a consistencia.
create or replace function app_private.bookings_set_occupied()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.occupied_ends_at := new.ends_at + new.buffer_minutes * interval '1 minute';
  return new;
end $$;

-- ---------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------
create table public.businesses (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  name                  text not null,
  logo_path             text,
  primary_color         text not null default '#2563eb',
  timezone              text not null default 'America/Sao_Paulo',
  buffer_minutes        int  not null default 10,
  slot_step_minutes     int  not null default 30,
  min_notice_minutes    int  not null default 120,
  max_days_ahead        int  not null default 30,
  allow_end_after_close boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint businesses_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  -- slugs que colidiriam com rotas do frontend
  constraint businesses_slug_reserved check (slug not in ('admin','login','api','assets','static','agendar','confirmado')),
  constraint businesses_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint businesses_color_hex check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint businesses_logo_path check (
    logo_path is null
    or (char_length(logo_path) <= 200 and logo_path like id::text || '/%' and logo_path !~ '\.\.')
  ),
  constraint businesses_buffer check (buffer_minutes between 0 and 120),
  constraint businesses_step check (slot_step_minutes between 5 and 240),
  constraint businesses_notice check (min_notice_minutes between 0 and 20160),
  constraint businesses_days check (max_days_ahead between 1 and 365)
);
create trigger trg_businesses_validate before insert or update on public.businesses
  for each row execute function app_private.validate_business();
create trigger trg_businesses_updated before update on public.businesses
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------
-- business_members (quem administra qual negocio)
-- ---------------------------------------------------------------------
create table public.business_members (
  user_id     uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  role        text not null default 'owner' check (role in ('owner')),
  created_at  timestamptz not null default now(),
  primary key (user_id, business_id)
);
create index business_members_business_idx on public.business_members (business_id);

-- ---------------------------------------------------------------------
-- services (arquivamento em vez de exclusao: ha historico)
-- ---------------------------------------------------------------------
create table public.services (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete restrict,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  is_active   boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, business_id)
);
create unique index services_name_uq on public.services (business_id, lower(btrim(name))) where archived_at is null;
create trigger trg_services_bizlock before update on public.services
  for each row execute function app_private.forbid_business_change();
create trigger trg_services_updated before update on public.services
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------
-- service_options (porte + preco + duracao de cada servico)
-- ---------------------------------------------------------------------
create table public.service_options (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null,
  service_id       uuid not null,
  size             text not null check (size in ('small','medium','large')),
  price_cents      int  not null check (price_cents >= 0),
  duration_minutes int  not null check (duration_minutes between 5 and 720),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (service_id, size),
  unique (id, service_id, business_id),
  -- a opcao so pode apontar para um servico do MESMO negocio
  foreign key (service_id, business_id) references public.services (id, business_id) on delete restrict
);
create trigger trg_options_bizlock before update on public.service_options
  for each row execute function app_private.forbid_business_change();
create trigger trg_options_updated before update on public.service_options
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------
-- business_hours (minutos desde 00:00 no fuso do negocio; 0 = domingo)
-- varias faixas por dia sao permitidas (almoco), sem sobreposicao
-- ---------------------------------------------------------------------
create table public.business_hours (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  day_of_week   smallint not null check (day_of_week between 0 and 6),
  opens_minute  smallint not null check (opens_minute between 0 and 1439),
  closes_minute smallint not null check (closes_minute between 1 and 1440),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint business_hours_order check (opens_minute < closes_minute),
  constraint business_hours_no_overlap exclude using gist (
    business_id with =,
    day_of_week with =,
    int4range(opens_minute::int, closes_minute::int, '[)') with &&
  )
);
create trigger trg_hours_bizlock before update on public.business_hours
  for each row execute function app_private.forbid_business_change();
create trigger trg_hours_updated before update on public.business_hours
  for each row execute function app_private.set_updated_at();

-- ---------------------------------------------------------------------
-- time_blocks (folgas e bloqueios pontuais)
-- ---------------------------------------------------------------------
create table public.time_blocks (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text check (reason is null or char_length(reason) <= 200),
  created_at  timestamptz not null default now(),
  constraint time_blocks_order check (ends_at > starts_at),
  constraint time_blocks_max_len check (ends_at - starts_at <= interval '366 days')
);
create index time_blocks_business_idx on public.time_blocks (business_id, starts_at);
create trigger trg_blocks_bizlock before update on public.time_blocks
  for each row execute function app_private.forbid_business_change();

-- ---------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------
create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete restrict,
  service_id        uuid not null,
  service_option_id uuid not null,
  status            text not null default 'confirmed'
                      check (status in ('confirmed','cancelled','completed','no_show')),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,       -- fim do SERVICO
  buffer_minutes    int not null check (buffer_minutes between 0 and 120),
  occupied_ends_at  timestamptz not null,       -- fim do servico + gap (preenchido por trigger)
  -- snapshot: editar o servico depois nao altera o historico
  service_name      text not null,
  size              text not null check (size in ('small','medium','large')),
  price_cents       int  not null check (price_cents >= 0),
  duration_minutes  int  not null check (duration_minutes between 5 and 720),
  -- cliente e pet (decisao D3: gravados no proprio agendamento)
  customer_name     text not null check (char_length(customer_name) between 2 and 100),
  customer_phone    text not null check (customer_phone ~ '^[0-9]{10,11}$'),
  pet_name          text not null check (char_length(pet_name) between 1 and 60),
  pet_breed         text check (pet_breed is null or char_length(pet_breed) <= 60),
  notes             text check (notes is null or char_length(notes) <= 500),
  created_by        text not null check (created_by in ('customer','admin')),
  consent_at        timestamptz,
  idempotency_key   uuid,
  cancelled_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint bookings_time_order check (ends_at > starts_at),
  constraint bookings_occupied_order check (occupied_ends_at >= ends_at),
  constraint bookings_consent check (created_by <> 'customer' or consent_at is not null),
  constraint bookings_cancel_consistency check ((status = 'cancelled') = (cancelled_at is not null)),
  -- opcao, servico e negocio precisam ser coerentes entre si
  foreign key (service_option_id, service_id, business_id)
    references public.service_options (id, service_id, business_id) on delete restrict,
  -- GARANTIA FINAL contra sobreposicao (inclui o gap) entre agendamentos nao cancelados
  constraint bookings_no_overlap exclude using gist (
    business_id with =,
    tstzrange(starts_at, occupied_ends_at, '[)') with &&
  ) where (status <> 'cancelled')
);
create unique index bookings_idempotency_uq on public.bookings (business_id, idempotency_key)
  where idempotency_key is not null;
create index bookings_business_start_idx on public.bookings (business_id, starts_at);
create index bookings_phone_idx on public.bookings (business_id, customer_phone) where status = 'confirmed';

create trigger trg_bookings_occupied before insert or update on public.bookings
  for each row execute function app_private.bookings_set_occupied();
create trigger trg_bookings_bizlock before update on public.bookings
  for each row execute function app_private.forbid_business_change();
create trigger trg_bookings_updated before update on public.bookings
  for each row execute function app_private.set_updated_at();
