-- Busca de reservas por codigo, nome do tutor ou nome do pet.
-- NAO EXECUTADO. Aplicar primeiro no DEV, depois rodar os testes 21 e 04.

do $$
begin
  if pg_catalog.to_regclass('public.daycare_bookings') is null
     or pg_catalog.to_regclass('public.stay_bookings') is null
     or pg_catalog.to_regprocedure('app_private.is_member(uuid)') is null then
    raise exception 'Pre-requisito ausente: aplique as migrations anteriores antes desta';
  end if;
end;
$$;

create or replace function app_private.search_norm(p_text text)
returns text
language sql immutable set search_path = '' as $$
  select lower(translate(coalesce(p_text, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'));
$$;

revoke all on function app_private.search_norm(text) from public, anon, authenticated;

create or replace function public.admin_search_reservations(p_business_id uuid, p_query text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_text     text := btrim(coalesce(p_query, ''));
  v_code     text := lower(regexp_replace(v_text, '[^0-9a-fA-F]', '', 'g'));
  v_name     text := regexp_replace(btrim(app_private.search_norm(v_text)), '\s+', ' ', 'g');
  v_use_code boolean;
  v_use_name boolean;
  v_tz       text;
  v_rows     jsonb;
  v_count    int;
begin
  if p_business_id is null or not app_private.is_member(p_business_id) then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  v_use_code := v_text ~ '^[0-9a-fA-F[:space:]-]+$' and char_length(v_code) between 4 and 32;
  v_use_name := char_length(v_name) between 2 and 80;
  if not v_use_code and not v_use_name then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  select b.timezone into v_tz from public.businesses b where b.id = p_business_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.starts_at desc), '[]'::jsonb), count(*)
    into v_rows, v_count
    from (
      select * from (
        select 'booking'::text as kind, b.id, b.status, b.customer_name, b.customer_phone,
               b.pet_name, b.pet_breed, b.service_name, b.size_label,
               b.price_cents, b.starts_at, b.ends_at
          from public.bookings b
         where b.business_id = p_business_id
           and ((v_use_code and replace(b.id::text, '-', '') like v_code || '%')
             or (v_use_name and (position(v_name in app_private.search_norm(b.customer_name)) > 0
                              or position(v_name in app_private.search_norm(b.pet_name)) > 0)))
        union all
        select 'stay', s.id, s.status, s.customer_name, s.customer_phone,
               s.pet_name, s.pet_breed, s.service_name, s.size_label,
               s.total_price_cents,
               coalesce(s.check_in_at, (s.check_in::timestamp at time zone v_tz)),
               coalesce(s.check_out_at, (s.check_out::timestamp at time zone v_tz))
          from public.stay_bookings s
         where s.business_id = p_business_id
           and ((v_use_code and replace(s.id::text, '-', '') like v_code || '%')
             or (v_use_name and (position(v_name in app_private.search_norm(s.customer_name)) > 0
                              or position(v_name in app_private.search_norm(s.pet_name)) > 0)))
        union all
        select 'daycare', d.id, d.status, d.customer_name, d.customer_phone,
               d.pet_name, d.pet_breed, d.service_name, d.size_label,
               d.price_cents, d.starts_at, d.ends_at
          from public.daycare_bookings d
         where d.business_id = p_business_id
           and ((v_use_code and replace(d.id::text, '-', '') like v_code || '%')
             or (v_use_name and (position(v_name in app_private.search_norm(d.customer_name)) > 0
                              or position(v_name in app_private.search_norm(d.pet_name)) > 0)))
      ) found
      order by found.starts_at desc
      limit 31
    ) r;

  if v_count > 30 then
    select jsonb_agg(e.value order by e.ord) into v_rows
      from jsonb_array_elements(v_rows) with ordinality as e(value, ord)
     where e.ord <= 30;
  end if;

  return jsonb_build_object('ok', true, 'results', v_rows, 'truncated', v_count > 30);
end $$;

revoke execute on function public.admin_search_reservations(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_search_reservations(uuid, text) to authenticated;
