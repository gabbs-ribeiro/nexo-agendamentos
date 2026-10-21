-- =====================================================================
-- 004: funcoes de ADMINISTRACAO (somente "authenticated" executa)
-- Escrita em bookings e time_blocks acontece SOMENTE aqui (nao ha INSERT/UPDATE
-- direto para o papel authenticated). Toda funcao confere o vinculo do usuario
-- com o negocio no banco (business_members), nunca por dado vindo do cliente.
-- Para registros existentes, "nao e seu" e "nao existe" retornam o mesmo
-- NOT_FOUND (nao revela a existencia de dados de outro negocio).
-- =====================================================================

create or replace function public.admin_create_booking(
  p_business_id    uuid,
  p_option_id      uuid,
  p_starts_at      timestamptz,
  p_customer_name  text,
  p_customer_phone text,
  p_pet_name       text,
  p_pet_breed      text default null,
  p_notes          text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app_private.require_member(p_business_id);
  return app_private.create_booking(
    p_business_id, p_option_id, p_starts_at,
    p_customer_name, p_customer_phone, p_pet_name, p_pet_breed, p_notes,
    'admin', null, null);
end $$;

-- Cancelar / concluir / faltou / reabrir (completed|no_show -> confirmed).
-- Cancelado e definitivo: para reagendar, crie um novo agendamento.
create or replace function public.admin_set_booking_status(
  p_booking_id uuid, p_status text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_b public.bookings%rowtype;
begin
  if p_status is null or p_status not in ('confirmed','cancelled','completed','no_show') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_b from public.bookings k
   where k.id = p_booking_id and app_private.is_member(k.business_id);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_b.business_id::text, 0));
  select * into v_b from public.bookings k where k.id = p_booking_id for update;

  if v_b.status = 'cancelled' or p_status = v_b.status then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;
  if p_status in ('completed','no_show') and v_b.starts_at > now() then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;

  update public.bookings
     set status = p_status,
         cancelled_at = case when p_status = 'cancelled' then now() else null end
   where id = p_booking_id;

  return jsonb_build_object('ok', true, 'status', p_status);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  when others then
    raise log 'admin_set_booking_status falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- Remarcar: mantem servico, preco e duracao originais; passa a usar o gap atual do negocio.
create or replace function public.admin_reschedule_booking(
  p_booking_id uuid, p_new_starts_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_b   public.bookings%rowtype;
  v_biz public.businesses%rowtype;
  v_end timestamptz;
begin
  if p_new_starts_at is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select * into v_b from public.bookings k
   where k.id = p_booking_id and app_private.is_member(k.business_id);
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_b.business_id::text, 0));
  select * into v_b from public.bookings k where k.id = p_booking_id for update;
  select * into v_biz from public.businesses b where b.id = v_b.business_id;

  if v_b.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TRANSITION');
  end if;

  if not exists (
    select 1
      from app_private.compute_slots(
             v_b.business_id, v_b.duration_minutes,
             (p_new_starts_at at time zone v_biz.timezone)::date,
             true, v_b.id) cs
     where cs.slot_start = p_new_starts_at
  ) then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  end if;

  v_end := p_new_starts_at + v_b.duration_minutes * interval '1 minute';
  update public.bookings
     set starts_at = p_new_starts_at, ends_at = v_end, buffer_minutes = v_biz.buffer_minutes
   where id = v_b.id;

  return jsonb_build_object('ok', true, 'starts_at', p_new_starts_at, 'ends_at', v_end);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  when others then
    raise log 'admin_reschedule_booking falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

-- Corrigir dados do cliente/pet de um agendamento existente.
create or replace function public.admin_update_booking_details(
  p_booking_id     uuid,
  p_customer_name  text,
  p_customer_phone text,
  p_pet_name       text,
  p_pet_breed      text default null,
  p_notes          text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_name  text := btrim(coalesce(p_customer_name, ''));
  v_pet   text := btrim(coalesce(p_pet_name, ''));
  v_breed text := nullif(btrim(coalesce(p_pet_breed, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_phone text := app_private.normalize_phone(p_customer_phone);
  v_n     int;
begin
  if char_length(v_name) not between 2 and 100
     or char_length(v_pet) not between 1 and 60
     or char_length(coalesce(v_breed, '')) > 60
     or char_length(coalesce(v_notes, '')) > 500
     or v_phone !~ '^[0-9]{10,11}$' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  update public.bookings k
     set customer_name = v_name, customer_phone = v_phone,
         pet_name = v_pet, pet_breed = v_breed, notes = v_notes
   where k.id = p_booking_id and app_private.is_member(k.business_id);
  get diagnostics v_n = row_count;

  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Bloqueio de horario/folga. Rejeita se atingir um agendamento ativo (decisao D9).
create or replace function public.admin_create_time_block(
  p_business_id uuid,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_reason      text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid;
begin
  perform app_private.require_member(p_business_id);

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_ends_at <= now()
     or p_ends_at - p_starts_at > interval '366 days'
     or char_length(coalesce(v_reason, '')) > 200 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  if exists (
    select 1 from public.bookings k
     where k.business_id = p_business_id
       and k.status <> 'cancelled'
       and k.starts_at < p_ends_at
       and k.ends_at   > p_starts_at
  ) then
    return jsonb_build_object('ok', false, 'error', 'BOOKING_CONFLICT');
  end if;

  insert into public.time_blocks (business_id, starts_at, ends_at, reason)
  values (p_business_id, p_starts_at, p_ends_at, v_reason)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'block_id', v_id);
end $$;
