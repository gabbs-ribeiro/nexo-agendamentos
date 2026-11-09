-- TESTE 22 — busca por codigo, tutor ou pet: acentos, partes do nome, limites e permissoes.
-- Rodar SOMENTE em DEV apos a migration 20261107000002_search_reservations.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000051', 'dono-busca@teste.local'),
  ('77777777-0000-0000-0000-000000000052', 'outro-busca@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000051', 'loja-busca', 'Loja Busca'),
  ('70000000-0000-0000-0000-000000000052', 'loja-busca-2', 'Loja Busca 2');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000051', '70000000-0000-0000-0000-000000000051'),
  ('77777777-0000-0000-0000-000000000052', '70000000-0000-0000-0000-000000000052');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000051', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000051","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000051';
  v_d date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid; v_service uuid; v_opt uuid;
  v_result jsonb; v_ana uuid; v_joao uuid; v_code text; v_i integer;
begin
  select id into v_category from public.service_categories where business_id = c_biz order by sort_order limit 1;
  insert into public.services (business_id, category_id, name) values (c_biz, v_category, 'Banho') returning id into v_service;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_service, 'small', 5000, 60) returning id into v_opt;
  v_result := public.admin_create_booking(c_biz, v_opt, (v_d + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990051', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false), 'reserva 1 falhou: ' || v_result::text;
  v_ana := (v_result->>'booking_ref')::uuid;
  v_result := public.admin_create_booking(c_biz, v_opt, ((v_d + 1) + time '09:00') at time zone 'America/Sao_Paulo',
    'João Pêra', '41999990052', 'Pérola');
  assert coalesce((v_result->>'ok')::boolean, false), 'reserva 2 falhou: ' || v_result::text;
  v_joao := (v_result->>'booking_ref')::uuid;

  v_result := public.admin_search_reservations(c_biz, 'ana');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 1
     and (v_result->'results'->0->>'id')::uuid = v_ana, 'busca por "ana" falhou: ' || v_result::text;
  v_result := public.admin_search_reservations(c_biz, 'COSTA');
  assert jsonb_array_length(v_result->'results') = 1, 'busca por sobrenome em maiusculas falhou';
  v_result := public.admin_search_reservations(c_biz, 'ana  costa');
  assert jsonb_array_length(v_result->'results') = 1, 'busca por nome completo (espacos duplos) falhou';
  v_result := public.admin_search_reservations(c_biz, 'joao');
  assert jsonb_array_length(v_result->'results') = 1 and (v_result->'results'->0->>'id')::uuid = v_joao, 'busca sem acento falhou';
  v_result := public.admin_search_reservations(c_biz, 'PÊRA');
  assert jsonb_array_length(v_result->'results') = 1, 'busca com acento falhou';
  v_result := public.admin_search_reservations(c_biz, 'perola');
  assert jsonb_array_length(v_result->'results') = 1 and (v_result->'results'->0->>'id')::uuid = v_joao, 'busca pelo pet falhou';
  v_result := public.admin_search_reservations(c_biz, 'zelia');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 0 and not (v_result->>'truncated')::boolean,
    'nome inexistente deveria dar lista vazia';

  v_code := upper(substr(v_ana::text, 1, 8));
  v_result := public.admin_search_reservations(c_biz, v_code);
  assert jsonb_array_length(v_result->'results') >= 1
     and exists (select 1 from jsonb_array_elements(v_result->'results') e where (e->>'id')::uuid = v_ana), 'busca pelo codigo falhou';
  v_result := public.admin_search_reservations(c_biz, lower(substr(v_code, 1, 4)) || '-' || lower(substr(v_code, 5)));
  assert exists (select 1 from jsonb_array_elements(v_result->'results') e where (e->>'id')::uuid = v_ana), 'codigo com traco falhou';
  v_result := public.admin_search_reservations(c_biz, substr(v_code, 1, 5));
  assert exists (select 1 from jsonb_array_elements(v_result->'results') e where (e->>'id')::uuid = v_ana), 'comeco do codigo falhou';

  perform public.admin_set_booking_status(v_ana, 'cancelled');
  v_result := public.admin_search_reservations(c_biz, 'ana costa');
  assert jsonb_array_length(v_result->'results') = 1 and v_result->'results'->0->>'status' = 'cancelled', 'reserva cancelada deveria ser encontrada';

  v_result := public.admin_search_reservations(c_biz, 'a');
  assert v_result->>'error' = 'INVALID_INPUT', 'um caractere deveria ser recusado: ' || v_result::text;
  v_result := public.admin_search_reservations(c_biz, '  ');
  assert v_result->>'error' = 'INVALID_INPUT', 'texto vazio deveria ser recusado';
  v_result := public.admin_search_reservations(c_biz, null);
  assert v_result->>'error' = 'INVALID_INPUT', 'nulo deveria ser recusado';
  v_result := public.admin_search_reservations(c_biz, '%%');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 0, '%% nao pode virar curinga';
  v_result := public.admin_search_reservations(c_biz, repeat('a', 81));
  assert v_result->>'error' = 'INVALID_INPUT', 'nome acima de 80 caracteres deveria ser recusado';

  for v_i in 1..31 loop
    v_result := public.admin_create_booking(c_biz, v_opt,
      (((v_d + 5 + ((v_i - 1) / 3)) + (time '08:00' + ((v_i - 1) % 3) * interval '90 minutes'))
        at time zone 'America/Sao_Paulo'),
      'Cliente Limite ' || v_i,
      '4199999' || lpad(v_i::text, 4, '0'),
      'Pet Limite ' || v_i);
    assert coalesce((v_result->>'ok')::boolean, false), 'reserva para teste do limite falhou: ' || v_result::text;
  end loop;
  v_result := public.admin_search_reservations(c_biz, 'limite');
  assert (v_result->>'ok')::boolean
     and jsonb_array_length(v_result->'results') = 30
     and (v_result->>'truncated')::boolean,
    'busca deveria limitar a 30 resultados e sinalizar truncamento: ' || v_result::text;

  perform set_config('request.jwt.claims',
    '{"sub":"77777777-0000-0000-0000-000000000052","role":"authenticated"}', true);
  v_result := public.admin_search_reservations(c_biz, 'ana');
  assert v_result->>'error' = 'NOT_FOUND', 'usuario de outro negocio acessou a busca: ' || v_result::text;
  v_result := public.admin_search_reservations('70000000-0000-0000-0000-000000000052', 'ana');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'results') = 0, 'a busca no proprio negocio nao deveria achar reserva de outro';

  raise notice 'PASS: busca por codigo, tutor e pet (acentos, partes do nome, cancelada, invalidos e isolamento)';
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.admin_search_reservations('70000000-0000-0000-0000-000000000051', 'ana');
    raise exception 'FAIL: anon executou admin_search_reservations';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon sem acesso a busca';
end $$;

reset role;
rollback;
