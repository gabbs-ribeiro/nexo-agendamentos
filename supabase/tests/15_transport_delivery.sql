-- TESTE 15 — leva e traz: pedido do cliente, cotacao manual, confirmacao, permissoes e isolamento.
-- Rodar SOMENTE em DEV apos a migration 20261024000001_transport_delivery.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000015', 'dono-transporte@teste.local'),
  ('77777777-0000-0000-0000-000000000016', 'outro-transporte@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000015', 'loja-leva-traz', 'Loja Leva e Traz');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000015', '70000000-0000-0000-0000-000000000015');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000015', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000015","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000015';
  v_d date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid;
  v_bath uuid; v_plain uuid; v_bath_opt uuid; v_plain_opt uuid;
  v_result jsonb;
  v_booking uuid; v_plain_booking uuid;
  v_req uuid;
  v_count int; v_int int; v_bool boolean; v_text text;
begin
  -- padroes do negocio e do servico
  select transport_start_fee_cents, transport_km_price_cents into v_int, v_count from public.businesses where id = c_biz;
  assert v_int = 500 and v_count = 100, 'padroes do negocio deveriam ser 500 e 100';

  select id into v_category from public.service_categories where business_id = c_biz order by sort_order limit 1;
  insert into public.services (business_id, category_id, name, transport_enabled)
    values (c_biz, v_category, 'Banho', true) returning id into v_bath;
  insert into public.services (business_id, category_id, name)
    values (c_biz, v_category, 'Tosa') returning id into v_plain;
  select transport_enabled into v_bool from public.services where id = v_plain;
  assert v_bool = false, 'servico novo deveria nascer sem leva e traz';
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_bath, 'small', 5000, 60) returning id into v_bath_opt;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_plain, 'small', 4000, 60) returning id into v_plain_opt;

  -- o painel pode ajustar os padroes; valor fora da faixa e recusado
  update public.businesses set transport_start_fee_cents = 600, transport_km_price_cents = 150 where id = c_biz;
  begin
    update public.businesses set transport_km_price_cents = -1 where id = c_biz;
    raise exception 'FAIL: valor por km negativo foi aceito';
  exception when check_violation then null;
  end;
  update public.businesses set transport_start_fee_cents = 500, transport_km_price_cents = 100 where id = c_biz;

  -- duas reservas de horario
  v_result := public.admin_create_booking(c_biz, v_bath_opt,
    (v_d + time '08:00') at time zone 'America/Sao_Paulo', 'Ana Costa', '41999990015', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false), 'reserva falhou: ' || v_result::text;
  v_booking := (v_result->>'booking_ref')::uuid;
  v_result := public.admin_create_booking(c_biz, v_plain_opt,
    (v_d + time '09:30') at time zone 'America/Sao_Paulo', 'Bia Lima', '41999990016', 'Luna');
  v_plain_booking := (v_result->>'booking_ref')::uuid;

  -- estado para o cliente: habilitado so no servico com a flag
  v_result := public.get_transport_state('loja-leva-traz', 'booking', v_booking);
  assert (v_result->>'ok')::boolean and (v_result->>'enabled')::boolean and v_result->'request_status' = 'null'::jsonb,
    'estado inicial incorreto: ' || v_result::text;
  v_result := public.get_transport_state('loja-leva-traz', 'booking', v_plain_booking);
  assert not (v_result->>'enabled')::boolean, 'servico sem a flag nao deveria oferecer leva e traz';
  v_result := public.get_transport_state('outro-slug', 'booking', v_booking);
  assert v_result->>'error' = 'NOT_FOUND', 'slug errado deveria dar NOT_FOUND';
  v_result := public.get_transport_state('loja-leva-traz', 'booking', gen_random_uuid());
  assert v_result->>'error' = 'NOT_FOUND', 'reserva inexistente deveria dar NOT_FOUND';

  -- cliente solicita (sem valor); servico sem a flag e recusado
  v_result := public.request_transport('loja-leva-traz', 'booking', v_plain_booking,
    'Rua A', '10', 'Centro', null, null, null);
  assert v_result->>'error' = 'TRANSPORT_UNAVAILABLE', 'servico sem a flag aceitou pedido: ' || v_result::text;
  v_result := public.request_transport('loja-leva-traz', 'booking', v_booking, 'R', '10', 'Centro', null, null, null);
  assert v_result->>'error' = 'INVALID_INPUT', 'rua curta deveria ser recusada';
  v_result := public.request_transport('loja-leva-traz', 'booking', v_booking, 'Rua das Flores', '', 'Centro', null, null, null);
  assert v_result->>'error' = 'INVALID_INPUT', 'sem numero deveria ser recusado';
  v_result := public.request_transport('loja-leva-traz', 'booking', v_booking,
    'Rua das Flores', '123', 'Centro', 'Colombo', 'Casa 2', 'Perto da padaria');
  assert coalesce((v_result->>'ok')::boolean, false), 'pedido do cliente falhou: ' || v_result::text;
  -- reenviar enquanto nao cotado atualiza o endereco, sem duplicar
  v_result := public.request_transport('loja-leva-traz', 'booking', v_booking,
    'Rua das Flores', '125', 'Centro', 'Colombo', null, null);
  assert coalesce((v_result->>'ok')::boolean, false), 'reenvio falhou';
  select count(*) into v_count from public.transport_requests where booking_id = v_booking;
  assert v_count = 1, 'pedido duplicado: ' || v_count;
  select id, street_number into v_req, v_text from public.transport_requests where booking_id = v_booking;
  assert v_text = '125', 'endereco nao foi atualizado';

  -- cotacao: 6 km, 500 + 6*4*100 = 2900; confirmar/desfazer
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro',
    'Colombo', null, null, 6, 500, 100);
  assert coalesce((v_result->>'ok')::boolean, false) and (v_result->>'freight_cents')::int = 2900,
    'frete de 6 km deveria ser 2900: ' || v_result::text;
  -- cotacao nao soma: status quoted
  select status into v_text from public.transport_requests where id = v_req;
  assert v_text = 'quoted', 'cotacao deveria ficar quoted';
  -- cliente nao mexe mais no endereco depois da cotacao
  v_result := public.request_transport('loja-leva-traz', 'booking', v_booking, 'Rua Nova', '1', 'Centro', null, null, null);
  assert v_result->>'error' = 'TRANSPORT_LOCKED', 'cliente alterou pedido cotado: ' || v_result::text;
  -- decimais e valor por km customizado: 6,5 km x 4 x 75 + 500 = 2450
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro',
    null, null, null, 6.5, 500, 75);
  assert (v_result->>'freight_cents')::int = 2450, 'frete 6,5 km x 75 deveria ser 2450: ' || v_result::text;
  -- valores invalidos
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro', null, null, null, 0, 500, 100);
  assert v_result->>'error' = 'INVALID_INPUT', 'km zero deveria ser recusado';
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro', null, null, null, 250, 500, 100);
  assert v_result->>'error' = 'INVALID_INPUT', 'km acima de 200 deveria ser recusado';
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro', null, null, null, 5, -1, 100);
  assert v_result->>'error' = 'INVALID_INPUT', 'taxa negativa deveria ser recusada';

  -- confirmar soma no total; recalcular exige desfazer a confirmacao
  v_result := public.admin_set_transport_status(v_req, 'confirmed');
  assert coalesce((v_result->>'ok')::boolean, false), 'confirmar falhou: ' || v_result::text;
  select status, freight_cents into v_text, v_int from public.transport_requests where id = v_req;
  assert v_text = 'confirmed' and v_int = 2450, 'confirmacao incorreta';
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro', null, null, null, 3, 500, 100);
  assert v_result->>'error' = 'TRANSPORT_LOCKED', 'recalculou pedido confirmado: ' || v_result::text;
  v_result := public.admin_set_transport_status(v_req, 'confirmed');
  assert v_result->>'error' = 'INVALID_TRANSITION', 'confirmar duas vezes deveria ser recusado';
  v_result := public.admin_set_transport_status(v_req, 'quoted');
  assert coalesce((v_result->>'ok')::boolean, false), 'desfazer confirmacao falhou';
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro', null, null, null, 3, 500, 100);
  assert (v_result->>'freight_cents')::int = 1700, 'recalculo 3 km deveria dar 1700: ' || v_result::text;

  -- cancelar o pedido e reabrir cotando de novo
  v_result := public.admin_set_transport_status(v_req, 'cancelled');
  assert coalesce((v_result->>'ok')::boolean, false), 'cancelar falhou';
  v_result := public.admin_set_transport_status(v_req, 'confirmed');
  assert v_result->>'error' = 'INVALID_TRANSITION', 'cancelado nao confirma sem nova cotacao';
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua das Flores', '125', 'Centro', null, null, null, 4, 500, 100);
  assert coalesce((v_result->>'ok')::boolean, false), 'reabrir pela cotacao falhou: ' || v_result::text;

  -- painel adiciona leva e traz num servico SEM a flag e sem pedido previo (cliente pediu por fora)
  v_result := public.admin_save_transport_quote('booking', v_plain_booking, 'Rua B', '55', 'Alto', null, null, null, 2, 500, 100);
  assert coalesce((v_result->>'ok')::boolean, false) and (v_result->>'freight_cents')::int = 1300,
    'painel nao conseguiu cotar do zero: ' || v_result::text;
  select requested_by into v_text from public.transport_requests where booking_id = v_plain_booking;
  assert v_text = 'admin', 'pedido criado pelo painel deveria ser requested_by admin';

  -- reserva cancelada nao recebe cotacao nem confirmacao
  perform public.admin_set_booking_status(v_plain_booking, 'cancelled');
  v_result := public.admin_save_transport_quote('booking', v_plain_booking, 'Rua B', '55', 'Alto', null, null, null, 2, 500, 100);
  assert v_result->>'error' = 'INVALID_TRANSITION', 'cotou reserva cancelada: ' || v_result::text;

  -- hospedagem (servico por diaria antigo) tambem aceita o pedido
  declare v_stay_service uuid; v_stay_opt uuid; v_stay uuid;
  begin
    insert into public.services (business_id, category_id, name, booking_mode, transport_enabled)
      values (c_biz, v_category, 'Hospedagem', 'daily', true) returning id into v_stay_service;
    insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
      values (c_biz, v_stay_service, 'small', 9000, 30) returning id into v_stay_opt;
    v_result := public.create_public_stay('loja-leva-traz', v_stay_opt, v_d + 5, v_d + 7,
      'Carla Souza', '41999990017', 'Thor', null, null, true, gen_random_uuid());
    if coalesce((v_result->>'ok')::boolean, false) then
      v_stay := (v_result->>'booking_ref')::uuid;
      v_result := public.request_transport('loja-leva-traz', 'stay', v_stay, 'Rua C', '9', 'Bairro', null, null, null);
      assert coalesce((v_result->>'ok')::boolean, false), 'pedido de hospedagem falhou: ' || v_result::text;
      select count(*) into v_count from public.transport_requests where stay_id = v_stay;
      assert v_count = 1, 'pedido de hospedagem nao foi criado';
    end if;
  end;

  -- escrita direta nao existe para o painel
  begin
    insert into public.transport_requests (business_id, booking_id, requested_by, street)
      values (c_biz, v_booking, 'admin', 'Rua X');
    raise exception 'FAIL: insert direto em transport_requests foi aceito';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.transport_requests set status = 'confirmed' where id = v_req;
    raise exception 'FAIL: update direto em transport_requests foi aceito';
  exception when insufficient_privilege then null;
  end;

  -- usuario sem vinculo: 0 linhas e NOT_FOUND
  perform set_config('request.jwt.claims',
    '{"sub":"77777777-0000-0000-0000-000000000016","role":"authenticated"}', true);
  select count(*) into v_count from public.transport_requests;
  assert v_count = 0, 'usuario sem vinculo leu pedidos: ' || v_count;
  v_result := public.admin_set_transport_status(v_req, 'cancelled');
  assert v_result->>'error' = 'NOT_FOUND', 'usuario sem vinculo alterou pedido';
  v_result := public.admin_save_transport_quote('booking', v_booking, 'Rua D', '1', 'X', null, null, null, 3, 500, 100);
  assert v_result->>'error' = 'NOT_FOUND', 'usuario sem vinculo cotou reserva alheia';

  raise notice 'PASS: leva e traz (padroes, flag, pedido do cliente, cotacao, confirmacao, travas, permissoes e isolamento)';
end $$;

-- anon: sem acesso a tabela; so as funcoes publicas
reset role;
set local role anon;
do $$
declare v_result jsonb;
begin
  begin
    perform 1 from public.transport_requests limit 1;
    raise exception 'FAIL: anon leu transport_requests';
  exception when insufficient_privilege then null;
  end;
  v_result := public.get_transport_state('loja-leva-traz', 'booking', gen_random_uuid());
  assert v_result->>'error' = 'NOT_FOUND', 'anon nao conseguiu chamar get_transport_state';
  begin
    perform public.admin_set_transport_status(gen_random_uuid(), 'cancelled');
    raise exception 'FAIL: anon executou admin_set_transport_status';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_save_transport_quote('booking', gen_random_uuid(), 'Rua', '1', 'B', null, null, null, 3, 500, 100);
    raise exception 'FAIL: anon executou admin_save_transport_quote';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon sem acesso a transport_requests nem as funcoes do painel';
end $$;

reset role;
rollback;
