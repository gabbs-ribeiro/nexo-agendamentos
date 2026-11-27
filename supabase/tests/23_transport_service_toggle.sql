-- TESTE 23 — disponibilidade geral do leva e traz e preservacao dos pedidos existentes.
-- Rodar SOMENTE em DEV apos a migration 20261127000001_transport_service_toggle.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000023', 'admin-transporte-toggle@teste.local'),
  ('77777777-0000-0000-0000-000000000024', 'sem-vinculo-transporte@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000023', 'loja-transporte-toggle', 'Loja Transporte Toggle');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000023', '70000000-0000-0000-0000-000000000023');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000023', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000023","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000023';
  v_d date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid;
  v_service uuid;
  v_option uuid;
  v_first_booking uuid;
  v_second_booking uuid;
  v_request uuid;
  v_result jsonb;
  v_enabled boolean;
  v_count int;
  v_status text;
  v_street text;
  v_default text;
  v_nullable text;
begin
  select column_default, is_nullable into v_default, v_nullable
    from information_schema.columns
   where table_schema = 'public' and table_name = 'businesses'
     and column_name = 'transport_service_enabled';
  assert v_default is not null and v_default ilike '%true%', 'novos negocios devem iniciar com leva e traz ativo';
  assert v_nullable = 'NO', 'a disponibilidade geral nao pode ser nula';

  select transport_service_enabled into v_enabled from public.businesses where id = c_biz;
  assert v_enabled, 'novo negocio deveria iniciar com leva e traz ativo';

  select id into v_category from public.service_categories where business_id = c_biz order by sort_order limit 1;
  insert into public.services (business_id, category_id, name, transport_enabled)
    values (c_biz, v_category, 'Banho', true) returning id into v_service;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_service, 'small', 5000, 60) returning id into v_option;

  v_result := public.admin_create_booking(c_biz, v_option,
    (v_d + time '08:00') at time zone 'America/Sao_Paulo', 'Ana Costa', '41999990023', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false), 'primeira reserva falhou: ' || v_result::text;
  v_first_booking := (v_result->>'booking_ref')::uuid;
  v_result := public.admin_create_booking(c_biz, v_option,
    (v_d + time '10:00') at time zone 'America/Sao_Paulo', 'Bia Lima', '41999990024', 'Luna');
  assert coalesce((v_result->>'ok')::boolean, false), 'segunda reserva falhou: ' || v_result::text;
  v_second_booking := (v_result->>'booking_ref')::uuid;

  v_result := public.request_transport('loja-transporte-toggle', 'booking', v_first_booking,
    'Rua das Flores', '123', 'Centro', null, null, null);
  assert coalesce((v_result->>'ok')::boolean, false), 'pedido inicial falhou: ' || v_result::text;
  select id into v_request from public.transport_requests where booking_id = v_first_booking;
  assert v_request is not null, 'pedido inicial nao foi persistido';

  v_result := public.admin_set_transport_availability(c_biz, false);
  assert coalesce((v_result->>'ok')::boolean, false), 'administrador nao conseguiu desativar: ' || v_result::text;
  select transport_service_enabled into v_enabled from public.businesses where id = c_biz;
  assert not v_enabled, 'desativacao nao permaneceu salva';

  v_result := public.get_transport_state('loja-transporte-toggle', 'booking', v_first_booking);
  assert (v_result->>'offered')::boolean and not (v_result->>'enabled')::boolean
     and v_result->>'request_status' = 'requested',
    'estado publico desativado incorreto: ' || v_result::text;

  v_result := public.request_transport('loja-transporte-toggle', 'booking', v_second_booking,
    'Rua Nova', '5', 'Centro', null, null, null);
  assert v_result->>'error' = 'TRANSPORT_UNAVAILABLE', 'pedido novo passou pela validacao do banco';
  v_result := public.request_transport('loja-transporte-toggle', 'booking', v_first_booking,
    'Rua Alterada', '9', 'Centro', null, null, null);
  assert v_result->>'error' = 'TRANSPORT_UNAVAILABLE', 'pedido existente foi alterado enquanto desativado';
  select status, street into v_status, v_street from public.transport_requests where id = v_request;
  assert v_status = 'requested' and v_street = 'Rua das Flores',
    'desativar alterou um pedido que ja estava registrado';
  select count(*) into v_count from public.transport_requests where booking_id = v_first_booking;
  assert v_count = 1, 'pedido existente foi removido ou duplicado';
  v_result := public.admin_save_transport_quote('booking', v_first_booking, 'Rua das Flores', '123',
    'Centro', null, null, null, 2, 500, 100);
  assert coalesce((v_result->>'ok')::boolean, false),
    'administrador nao conseguiu gerenciar pedido anterior enquanto desativado: ' || v_result::text;

  v_result := public.admin_set_transport_availability(c_biz, true);
  assert coalesce((v_result->>'ok')::boolean, false), 'administrador nao conseguiu reativar: ' || v_result::text;
  select transport_service_enabled into v_enabled from public.businesses where id = c_biz;
  assert v_enabled, 'reativacao nao permaneceu salva';
  v_result := public.request_transport('loja-transporte-toggle', 'booking', v_second_booking,
    'Rua Nova', '5', 'Centro', null, null, null);
  assert coalesce((v_result->>'ok')::boolean, false), 'solicitacao nao voltou a funcionar: ' || v_result::text;

  perform set_config('request.jwt.claims',
    '{"sub":"77777777-0000-0000-0000-000000000024","role":"authenticated"}', true);
  v_result := public.admin_set_transport_availability(c_biz, false);
  assert v_result->>'error' = 'NOT_FOUND', 'usuario sem vinculo alterou disponibilidade';

  raise notice 'PASS: padrao ativo, persistencia, desativacao/reativacao, bloqueio no backend, preservacao e autorizacao';
end $$;

reset role;
set local role anon;
do $$
begin
  begin
    perform public.admin_set_transport_availability('70000000-0000-0000-0000-000000000023', false);
    raise exception 'FAIL: anon executou admin_set_transport_availability';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon nao pode alterar disponibilidade do leva e traz';
end $$;

reset role;
rollback;
