-- Perfil publico, descricoes de servicos e catalogo de portes por negocio.
-- Aplicar somente depois de 20261021000001_booking_internal_notes.sql.

alter table public.services
  add column description text not null default '',
  add constraint services_description_len check (char_length(description) <= 300);

alter table public.businesses
  alter column primary_color set default '#ef906b';

update public.businesses
   set primary_color = '#ef906b'
 where primary_color = '#2563eb';

create table public.business_sizes (
  business_id uuid not null references public.businesses (id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, code),
  constraint business_sizes_code check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(code) <= 60),
  constraint business_sizes_name check (char_length(btrim(name)) between 1 and 40),
  constraint business_sizes_order check (sort_order >= 0)
);

create unique index business_sizes_name_uq
  on public.business_sizes (business_id, lower(btrim(name)));

create trigger trg_business_sizes_bizlock before update on public.business_sizes
  for each row execute function app_private.forbid_business_change();
create trigger trg_business_sizes_updated before update on public.business_sizes
  for each row execute function app_private.set_updated_at();

alter table public.business_sizes enable row level security;

insert into public.business_sizes (business_id, code, name, sort_order)
select b.id, size.code, size.name, size.sort_order
  from public.businesses b
 cross join (values
   ('small', 'Pequeno', 0),
   ('medium', 'Médio', 1),
   ('large', 'Grande', 2)
 ) as size(code, name, sort_order);

create function app_private.seed_business_sizes()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_sizes (business_id, code, name, sort_order)
  values
    (new.id, 'small', 'Pequeno', 0),
    (new.id, 'medium', 'Médio', 1),
    (new.id, 'large', 'Grande', 2);
  return new;
end $$;

revoke all on function app_private.seed_business_sizes() from public, anon, authenticated;
create trigger trg_businesses_seed_sizes after insert on public.businesses
  for each row execute function app_private.seed_business_sizes();

alter table public.service_options
  drop constraint service_options_size_check,
  add constraint service_options_size_format
    check (size ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(size) <= 60),
  add constraint service_options_size_business_fk
    foreign key (business_id, size)
    references public.business_sizes (business_id, code) on delete restrict;

alter table public.bookings
  drop constraint bookings_size_check,
  add constraint bookings_size_format
    check (size ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(size) <= 60),
  add column size_label text not null default '';

update public.bookings
   set size_label = case size
     when 'small' then 'Pequeno'
     when 'medium' then 'Médio'
     when 'large' then 'Grande'
     else size
   end;

alter table public.services
  drop constraint services_name_check;

alter table public.services
  add constraint services_name_len check (char_length(btrim(name)) between 1 and 80);

revoke all on public.business_sizes from public, anon, authenticated;
grant select on public.business_sizes to authenticated;
grant insert (business_id, code, name, sort_order) on public.business_sizes to authenticated;
grant update (name, sort_order, is_active) on public.business_sizes to authenticated;

create policy business_sizes_select on public.business_sizes for select to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy business_sizes_insert on public.business_sizes for insert to authenticated
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy business_sizes_update on public.business_sizes for update to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())))
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

grant insert (business_id, name, description, is_active) on public.services to authenticated;
grant update (name, description, is_active, archived_at) on public.services to authenticated;

-- Toda reserva nova salva o nome do porte como snapshot; renomear o catalogo
-- nao altera os detalhes de agendamentos existentes.
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
end $$;

revoke all on function app_private.create_booking(uuid, uuid, timestamptz, text, text, text, text, text, text, timestamptz, uuid)
  from public, anon, authenticated;

create or replace function public.list_public_services(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'service_id', s.id, 'name', s.name, 'description', s.description, 'options', o.opts)
           order by s.name), '[]'::jsonb)
    from public.businesses b
    join public.services s
      on s.business_id = b.id and s.is_active and s.archived_at is null
    cross join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'option_id', so.id, 'size', so.size, 'size_label', bs.name,
                 'price_cents', so.price_cents, 'duration_minutes', so.duration_minutes)
               order by bs.sort_order, bs.name) as opts
        from public.service_options so
        join public.business_sizes bs
          on bs.business_id = so.business_id and bs.code = so.size and bs.is_active
       where so.service_id = s.id and so.is_active
    ) o
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active
     and o.opts is not null;
$$;

revoke execute on function public.list_public_services(text) from public, anon, authenticated;
grant execute on function public.list_public_services(text) to anon, authenticated;

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
    join public.business_sizes bs
      on bs.business_id = so.business_id and bs.code = so.size and bs.is_active
    join public.services s on s.id = so.service_id and s.business_id = so.business_id
   where so.id = p_option_id and so.business_id = v_biz.id
     and so.is_active and s.is_active and s.archived_at is null;
  if v_dur is null then return; end if;

  return query
    select cs.slot_start,
           to_char(cs.slot_start at time zone v_biz.timezone, 'HH24:MI')
      from app_private.compute_slots(v_biz.id, v_dur, p_date) cs;
end $$;

revoke execute on function public.get_available_slots(text, uuid, date) from public, anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date) to anon, authenticated;
