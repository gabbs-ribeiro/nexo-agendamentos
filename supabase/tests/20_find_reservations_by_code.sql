-- TESTE 20 — busca de reservas pelo codigo: formato, varios tipos, isolamento e permissoes.
-- Rodar SOMENTE em DEV apos a migration 20261106000001_find_reservations_by_code.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000048', 'dono-codigo@teste.local'),
  ('77777777-0000-0000-0000-000000000049', 'outro-codigo@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000048', 'loja-codigo', 'Loja Codigo'),
  ('70000000-0000-0000-0000-000000000049', 'loja-codigo-2', 'Loja Codigo 2');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000048', '70000000-0000-0000-0000-000000000048'),
  ('77777777-0000-0000-0000-000000000049', '70000000-0000-0000-0000-000000000049');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000048', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000048","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000048';
  v_d date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid; v_service uuid; v_opt uuid;
  v_result jsonb; v_ref uuid; v_code text;
begin
  select id into v_category from public.service_categories where business_id = c_biz order by sort_order limit 1;
  insert into public.services (business_id, category_id, name) values (c_biz, v_category, 'Banho') returning id into v_service;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_service, 'small', 5000, 60) returning id into v_opt;
  v_result := public.admin_create_booking(c_biz, v_opt, (v_d + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990048', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false), 'reserva falhou: ' || v_result::text;
  v_ref := (v_result->>'booking_ref')::uuid;
  v_code := upper(substr(v_ref::text, 1, 8));

  -- codigo exato (como o cliente ve), minusculo com traco e com espacos
  v_result := public.admin_find_reservations_by_code(c_biz, v_code);
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 1
     and v_result->'results'->0->>'kind' = 'booking' and (v_result->'results'->0->>'id')::uuid = v_ref,
    'busca pelo codigo exato falhou: ' || v_result::text;
  v_result := public.admin_find_reservations_by_code(c_biz, lower(substr(v_code, 1, 4)) || '-' || lower(substr(v_code, 5)));
  assert jsonb_array_length(v_result->'results') >= 1, 'busca com traco/minusculas falhou';
  v_result := public.admin_find_reservations_by_code(c_biz, ' ' || v_code || ' ');
  assert jsonb_array_length(v_result->'results') >= 1, 'busca com espacos falhou';
  assert (v_result->'results'->0->>'pet_name') = 'Rex' and (v_result->'results'->0->>'price_cents')::int = 5000,
    'campos da reserva incorretos';

  -- reserva cancelada continua encontrada
  perform public.admin_set_booking_status(v_ref, 'cancelled');
  v_result := public.admin_find_reservations_by_code(c_biz, v_code);
  assert jsonb_array_length(v_result->'results') = 1 and v_result->'results'->0->>'status' = 'cancelled',
    'reserva cancelada deveria ser encontrada';

  -- inexistente, curto e invalido
  v_result := public.admin_find_reservations_by_code(c_biz, 'ffffffff');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 0, 'codigo inexistente deveria dar lista vazia';
  v_result := public.admin_find_reservations_by_code(c_biz, 'ab1');
  assert v_result->>'error' = 'INVALID_INPUT', 'codigo curto deveria ser recusado';
  v_result := public.admin_find_reservations_by_code(c_biz, 'zzzz!!');
  assert v_result->>'error' = 'INVALID_INPUT', 'codigo sem caracteres hexadecimais deveria ser recusado';

  -- outro negocio nao enxerga
  perform set_config('request.jwt.claims',
    '{"sub":"77777777-0000-0000-0000-000000000049","role":"authenticated"}', true);
  v_result := public.admin_find_reservations_by_code(c_biz, v_code);
  assert v_result->>'error' = 'NOT_FOUND', 'usuario de outro negocio acessou a busca: ' || v_result::text;
  v_result := public.admin_find_reservations_by_code('70000000-0000-0000-0000-000000000049', v_code);
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 0,
    'a busca no proprio negocio nao deveria achar reserva de outro';

  raise notice 'PASS: busca por codigo (formato, cancelada, invalidos e isolamento)';
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.admin_find_reservations_by_code('70000000-0000-0000-0000-000000000048', 'abcd1234');
    raise exception 'FAIL: anon executou admin_find_reservations_by_code';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon sem acesso a busca por codigo';
end $$;

reset role;
rollback;
