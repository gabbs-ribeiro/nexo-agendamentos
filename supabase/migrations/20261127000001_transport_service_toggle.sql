-- Permite pausar novas solicitacoes de leva e traz por estabelecimento.
-- O padrao true preserva a disponibilidade dos negocios existentes.

alter table public.businesses
  add column transport_service_enabled boolean not null default true;

create or replace function public.admin_set_transport_availability(
  p_business_id uuid, p_enabled boolean)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_business_id is null or p_enabled is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;
  if not app_private.is_member(p_business_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':transport', 0));
  update public.businesses
     set transport_service_enabled = p_enabled
   where id = p_business_id;

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
exception
  when others then
    raise log 'admin_set_transport_availability falhou: sqlstate=%', sqlstate;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

create or replace function public.get_transport_state(p_slug text, p_kind text, p_ref uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_biz     public.businesses%rowtype;
  v_res     record;
  v_service_enabled boolean;
  v_status  text;
  v_offered boolean;
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

  select s.transport_enabled into v_service_enabled from public.services s
   where s.id = v_res.service_id and s.business_id = v_biz.id;
  v_offered := coalesce(v_service_enabled, false) and v_res.status = 'confirmed';

  select t.status into v_status from public.transport_requests t
   where t.business_id = v_biz.id
     and ((p_kind = 'booking' and t.booking_id = p_ref)
       or (p_kind = 'stay' and t.stay_id = p_ref)
       or (p_kind = 'daycare' and t.daycare_id = p_ref));

  return jsonb_build_object(
    'ok', true,
    'offered', v_offered,
    'enabled', v_offered and v_biz.transport_service_enabled,
    'request_status', v_status);
end $$;

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

  perform pg_advisory_xact_lock(hashtextextended(v_biz.id::text || ':transport', 0));
  select * into v_biz from public.businesses b
   where b.id = v_biz.id and b.is_active;
  if not found then return jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); end if;

  select s.transport_enabled into v_enabled from public.services s
   where s.id = v_res.service_id and s.business_id = v_biz.id;
  if not coalesce(v_enabled, false) or v_res.status <> 'confirmed'
     or not v_biz.transport_service_enabled then
    return jsonb_build_object('ok', false, 'error', 'TRANSPORT_UNAVAILABLE');
  end if;

  select * into v_existing from public.transport_requests t
   where t.business_id = v_biz.id
     and ((p_kind = 'booking' and t.booking_id = p_ref)
       or (p_kind = 'stay' and t.stay_id = p_ref)
       or (p_kind = 'daycare' and t.daycare_id = p_ref));

  if found then
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

revoke execute on function public.admin_set_transport_availability(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_transport_availability(uuid, boolean) to authenticated;

revoke execute on function public.get_transport_state(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.get_transport_state(text, text, uuid) to anon, authenticated;

revoke execute on function public.request_transport(text, text, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.request_transport(text, text, uuid, text, text, text, text, text, text)
  to anon, authenticated;
