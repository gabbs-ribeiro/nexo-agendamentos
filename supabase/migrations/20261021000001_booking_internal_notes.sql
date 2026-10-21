-- Notas internas sao distintas das observacoes informadas pelo tutor.
alter table public.bookings
  add column internal_notes text not null default ''
  check (char_length(internal_notes) <= 2000);

create or replace function public.admin_update_booking_internal_notes(
  p_booking_id uuid,
  p_internal_notes text)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_notes text := btrim(coalesce(p_internal_notes, ''));
  v_rows int;
begin
  if p_booking_id is null or char_length(v_notes) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  update public.bookings k
     set internal_notes = v_notes
   where k.id = p_booking_id and app_private.is_member(k.business_id);
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  return jsonb_build_object('ok', true);
exception
  when others then
    raise log 'admin_update_booking_internal_notes falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

revoke execute on function public.admin_update_booking_internal_notes(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_booking_internal_notes(uuid, text)
  to authenticated;

-- Remarcacao altera somente inicio e fim do servico. O gap original e snapshot
-- e nao deve ser substituido pela configuracao atual do negocio.
create or replace function public.admin_reschedule_booking(
  p_booking_id uuid, p_new_starts_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_b public.bookings%rowtype;
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
     set starts_at = p_new_starts_at, ends_at = v_end
   where id = v_b.id;

  return jsonb_build_object('ok', true, 'starts_at', p_new_starts_at, 'ends_at', v_end);
exception
  when exclusion_violation then
    return jsonb_build_object('ok', false, 'error', 'SLOT_UNAVAILABLE');
  when others then
    raise log 'admin_reschedule_booking falhou: sqlstate=% msg=%', sqlstate, sqlerrm;
    return jsonb_build_object('ok', false, 'error', 'INTERNAL_ERROR');
end $$;

revoke execute on function public.admin_reschedule_booking(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_reschedule_booking(uuid, timestamptz)
  to authenticated;
