-- Busca de reservas pelo CODIGO que o cliente recebe (os 8 primeiros caracteres do id da reserva).
--
-- * Procura nas tres tabelas de reserva (horario, hospedagem e creche) do negocio informado,
--   incluindo reservas passadas e canceladas.
-- * O codigo NAO e garantidamente unico (sao 8 caracteres hexadecimais, 32 bits): a funcao devolve
--   TODAS as reservas que comecam com o codigo (maximo 10) e a tela mostra todas.
-- * Somente membros do negocio. Aceita maiusculas/minusculas e ignora tracos e espacos.
--
-- NAO EXECUTADO. Aplicar primeiro no DEV, depois rodar os testes 20 e 04.

do $$
begin
  if pg_catalog.to_regclass('public.daycare_bookings') is null
     or pg_catalog.to_regclass('public.stay_bookings') is null
     or pg_catalog.to_regprocedure('app_private.is_member(uuid)') is null then
    raise exception 'Pre-requisito ausente: aplique as migrations anteriores antes desta';
  end if;
end;
$$;

create or replace function public.admin_find_reservations_by_code(p_business_id uuid, p_code text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_code    text := lower(regexp_replace(coalesce(p_code, ''), '[^0-9a-fA-F]', '', 'g'));
  v_tz      text;
  v_results jsonb;
begin
  if p_business_id is null or not app_private.is_member(p_business_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if char_length(v_code) < 4 or char_length(v_code) > 32 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select b.timezone into v_tz from public.businesses b where b.id = p_business_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.starts_at desc), '[]'::jsonb)
    into v_results
    from (
      select * from (
        select 'booking'::text as kind, b.id, b.status, b.customer_name, b.customer_phone,
               b.pet_name, b.pet_breed, b.service_name, b.size_label,
               b.price_cents, b.starts_at, b.ends_at
          from public.bookings b
         where b.business_id = p_business_id and replace(b.id::text, '-', '') like v_code || '%'
        union all
        select 'stay', s.id, s.status, s.customer_name, s.customer_phone,
               s.pet_name, s.pet_breed, s.service_name, s.size_label,
               s.total_price_cents,
               coalesce(s.check_in_at, (s.check_in::timestamp at time zone v_tz)),
               coalesce(s.check_out_at, (s.check_out::timestamp at time zone v_tz))
          from public.stay_bookings s
         where s.business_id = p_business_id and replace(s.id::text, '-', '') like v_code || '%'
        union all
        select 'daycare', d.id, d.status, d.customer_name, d.customer_phone,
               d.pet_name, d.pet_breed, d.service_name, d.size_label,
               d.price_cents, d.starts_at, d.ends_at
          from public.daycare_bookings d
         where d.business_id = p_business_id and replace(d.id::text, '-', '') like v_code || '%'
      ) found
      order by found.starts_at desc
      limit 10
    ) r;

  return jsonb_build_object('ok', true, 'results', v_results);
end $$;

revoke execute on function public.admin_find_reservations_by_code(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_find_reservations_by_code(uuid, text) to authenticated;
