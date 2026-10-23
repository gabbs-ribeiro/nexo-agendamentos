-- TESTE 12 — hospedagem por diaria (pet hotel): capacidade, independencia da agenda,
-- idempotencia, limites, permissoes e isolamento.
-- Rodar SOMENTE em DEV apos as migrations 20261022000001 e 20261022000002.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000012', 'dono-hotel@teste.local'),
  ('77777777-0000-0000-0000-000000000013', 'outro-hotel@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000012', 'loja-hotel', 'Loja Hotel');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000012', '70000000-0000-0000-0000-000000000012');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000012', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000012","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000012';
  v_d date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid;
  v_hotel uuid;
  v_bath uuid;
  v_hotel_opt uuid;
  v_bath_opt uuid;
  v_result jsonb;
  v_first uuid;
  v_key uuid := gen_random_uuid();
  v_count int;
  v_i int;
begin
  select id into v_category from public.service_categories
   where business_id = c_biz order by sort_order limit 1;
  insert into public.services (business_id, category_id, name, booking_mode)
    values (c_biz, v_category, 'Hospedagem', 'daily') returning id into v_hotel;
  insert into public.services (business_id, category_id, name)
    values (c_biz, v_category, 'Banho') returning id into v_bath;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_hotel, 'small', 9000, 30) returning id into v_hotel_opt;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_bath, 'small', 5000, 60) returning id into v_bath_opt;

  -- capacidade padrao
  select stay_capacity into v_count from public.businesses where id = c_biz;
  assert v_count = 4, 'capacidade padrao deveria ser 4: ' || v_count;

  -- orcamento
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d, v_d + 3);
  assert (v_result->>'ok')::boolean and (v_result->>'available')::boolean
     and (v_result->>'nights')::int = 3 and (v_result->>'total_price_cents')::int = 27000
     and (v_result->>'daily_price_cents')::int = 9000,
    'orcamento incorreto: ' || v_result::text;

  -- 4 estadias nas mesmas datas: todas entram; a 5a esgota
  for v_i in 1..4 loop
    v_result := public.create_public_stay(
      'loja-hotel', v_hotel_opt, v_d, v_d + 3,
      'Tutor ' || v_i, '4199999100' || v_i, 'Pet ' || v_i, null, null, true,
      case when v_i = 1 then v_key else gen_random_uuid() end);
    assert coalesce((v_result->>'ok')::boolean, false), 'estadia ' || v_i || ' falhou: ' || v_result::text;
    if v_i = 1 then v_first := (v_result->>'booking_ref')::uuid; end if;
  end loop;
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d, v_d + 3,
    'Tutor 5', '41999991005', 'Pet 5', null, null, true, gen_random_uuid());
  assert not coalesce((v_result->>'ok')::boolean, false) and v_result->>'error' = 'STAY_FULL',
    'a quinta estadia deveria esgotar: ' || v_result::text;
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d, v_d + 3);
  assert (v_result->>'ok')::boolean and not (v_result->>'available')::boolean,
    'orcamento deveria indicar esgotado: ' || v_result::text;

  -- sobreposicao parcial esgota; a noite da saida nao conta
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d + 2, v_d + 5);
  assert not (v_result->>'available')::boolean, 'sobreposicao parcial deveria esgotar';
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d + 3, v_d + 5);
  assert (v_result->>'available')::boolean, 'entrada no dia da saida deveria ter vaga';
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d - 1, v_d);
  assert (v_result->>'available')::boolean, 'noite anterior deveria ter vaga';

  -- idempotencia: repetir a mesma chave nao cria outra estadia
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d, v_d + 3,
    'Tutor 1', '41999991001', 'Pet 1', null, null, true, v_key);
  assert coalesce((v_result->>'ok')::boolean, false) and (v_result->>'idempotent')::boolean
     and (v_result->>'booking_ref')::uuid = v_first,
    'repeticao com a mesma chave deveria devolver a mesma estadia: ' || v_result::text;
  select count(*) into v_count from public.stay_bookings where business_id = c_biz;
  assert v_count = 4, 'idempotencia criou estadia duplicada: ' || v_count;

  -- INDEPENDENCIA: com o hotel lotado, banho e tosa segue reservando o mesmo dia
  v_result := public.admin_create_booking(
    c_biz, v_bath_opt, (v_d + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990012', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false),
    'hotel lotado nao pode bloquear banho e tosa: ' || v_result::text;
  select count(*) into v_count from public.bookings where business_id = c_biz;
  assert v_count = 1, 'estadias nao devem criar linhas em bookings: ' || v_count;
  -- e a agenda ocupada nao reduz as vagas do hotel
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d + 10, v_d + 12);
  assert (v_result->>'available')::boolean, 'banho e tosa nao pode consumir vagas do hotel';
  -- folga (bloqueio) da agenda nao afeta o hotel
  v_result := public.admin_create_time_block(
    c_biz, (v_d + 10 + time '00:00') at time zone 'America/Sao_Paulo',
    (v_d + 11 + time '00:00') at time zone 'America/Sao_Paulo', 'folga');
  assert coalesce((v_result->>'ok')::boolean, false), 'bloqueio falhou: ' || v_result::text;
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d + 10, v_d + 12,
    'Tutor 6', '41999991006', 'Pet 6', null, null, true, gen_random_uuid());
  assert coalesce((v_result->>'ok')::boolean, false), 'folga da agenda bloqueou o hotel: ' || v_result::text;

  -- limite por telefone (2 estadias futuras)
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d + 14, v_d + 15,
    'Tutor 6', '41999991006', 'Pet 6', null, null, true, gen_random_uuid());
  assert coalesce((v_result->>'ok')::boolean, false), 'segunda estadia do telefone falhou: ' || v_result::text;
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d + 16, v_d + 17,
    'Tutor 6', '41999991006', 'Pet 6', null, null, true, gen_random_uuid());
  assert v_result->>'error' = 'LIMIT_REACHED', 'limite por telefone nao funcionou: ' || v_result::text;

  -- entradas invalidas
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d - 10, v_d - 8,
    'Tutor 7', '41999991007', 'Pet 7', null, null, true, gen_random_uuid());
  assert v_result->>'error' = 'INVALID_INPUT', 'data no passado deveria ser recusada: ' || v_result::text;
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d + 20, v_d + 20,
    'Tutor 7', '41999991007', 'Pet 7', null, null, true, gen_random_uuid());
  assert v_result->>'error' = 'INVALID_INPUT', 'saida igual a entrada deveria ser recusada';
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d + 20, v_d + 51,
    'Tutor 7', '41999991007', 'Pet 7', null, null, true, gen_random_uuid());
  assert v_result->>'error' = 'INVALID_INPUT', 'mais de 30 diarias deveria ser recusado';
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d + 20, v_d + 22,
    'Tutor 7', '41999991007', 'Pet 7', null, null, false, gen_random_uuid());
  assert v_result->>'error' = 'CONSENT_REQUIRED', 'sem consentimento deveria ser recusado';
  v_result := public.create_public_stay(
    'loja-hotel', v_bath_opt, v_d + 20, v_d + 22,
    'Tutor 7', '41999991007', 'Pet 7', null, null, true, gen_random_uuid());
  assert v_result->>'error' = 'SERVICE_UNAVAILABLE', 'servico por horario nao pode virar estadia';
  v_result := public.get_stay_quote('loja-hotel', v_bath_opt, v_d + 20, v_d + 22);
  assert v_result->>'error' = 'SERVICE_UNAVAILABLE', 'orcamento aceitou servico por horario';

  -- snapshot de preco
  update public.service_options set price_cents = 20000 where id = v_hotel_opt and business_id = c_biz;
  select count(*) into v_count from public.stay_bookings
   where id = v_first and daily_price_cents = 9000 and total_price_cents = 27000 and nights = 3;
  assert v_count = 1, 'editar o preco alterou o snapshot da estadia';
  update public.service_options set price_cents = 9000 where id = v_hotel_opt and business_id = c_biz;

  -- concluir antes da saida e recusado; cancelar libera a vaga; cancelado e definitivo
  v_result := public.admin_set_stay_status(v_first, 'completed');
  assert v_result->>'error' = 'INVALID_TRANSITION', 'concluir antes da saida deveria ser recusado';
  v_result := public.admin_set_stay_status(v_first, 'cancelled');
  assert coalesce((v_result->>'ok')::boolean, false), 'cancelar falhou: ' || v_result::text;
  v_result := public.admin_set_stay_status(v_first, 'cancelled');
  assert v_result->>'error' = 'INVALID_TRANSITION', 'cancelar duas vezes deveria ser recusado';
  v_result := public.admin_set_stay_status(v_first, 'weird');
  assert v_result->>'error' = 'INVALID_INPUT', 'status invalido deveria ser recusado';
  v_result := public.get_stay_quote('loja-hotel', v_hotel_opt, v_d, v_d + 3);
  assert (v_result->>'available')::boolean, 'cancelamento nao liberou a vaga';
  v_result := public.create_public_stay(
    'loja-hotel', v_hotel_opt, v_d, v_d + 3,
    'Tutor 8', '41999991008', 'Pet 8', null, null, true, gen_random_uuid());
  assert coalesce((v_result->>'ok')::boolean, false), 'vaga liberada nao aceitou nova estadia: ' || v_result::text;

  -- escrita direta nao existe para o painel
  begin
    insert into public.stay_bookings (business_id, service_id, service_option_id, check_in, check_out, nights,
      service_name, size, size_label, daily_price_cents, total_price_cents,
      customer_name, customer_phone, pet_name, consent_at)
    values (c_biz, v_hotel, v_hotel_opt, v_d + 30, v_d + 31, 1, 'x', 'small', 'Pequeno', 1, 1,
      'Fulano', '41999990000', 'Pet', now());
    raise exception 'FAIL: insert direto em stay_bookings foi aceito';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.stay_bookings set status = 'confirmed' where id = v_first;
    raise exception 'FAIL: update direto em stay_bookings foi aceito';
  exception when insufficient_privilege then
    null;
  end;

  -- membro ve as proprias estadias
  select count(*) into v_count from public.stay_bookings;
  assert v_count >= 5, 'membro nao enxergou as estadias do negocio: ' || v_count;

  -- usuario sem vinculo: 0 linhas e NOT_FOUND
  perform set_config('request.jwt.claims',
    '{"sub":"77777777-0000-0000-0000-000000000013","role":"authenticated"}', true);
  select count(*) into v_count from public.stay_bookings;
  assert v_count = 0, 'usuario sem vinculo leu estadias: ' || v_count;
  v_result := public.admin_set_stay_status(v_first, 'cancelled');
  assert v_result->>'error' = 'NOT_FOUND', 'usuario sem vinculo alterou estadia: ' || v_result::text;

  raise notice 'PASS: hospedagem (capacidade 4, noite da saida, independencia da agenda, idempotencia, limites, snapshots, permissoes e isolamento)';
end $$;

-- anon: sem acesso a tabela; funcoes publicas funcionam
reset role;
set local role anon;
do $$
declare
  v_result jsonb;
  v_opt uuid;
begin
  begin
    perform 1 from public.stay_bookings limit 1;
    raise exception 'FAIL: anon leu stay_bookings';
  exception when insufficient_privilege then
    null;
  end;
  v_result := public.get_stay_quote('loja-hotel', gen_random_uuid(), current_date + 3, current_date + 4);
  assert v_result->>'error' = 'SERVICE_UNAVAILABLE', 'anon nao conseguiu chamar get_stay_quote: ' || v_result::text;
  begin
    perform public.admin_set_stay_status(gen_random_uuid(), 'cancelled');
    raise exception 'FAIL: anon executou admin_set_stay_status';
  exception when insufficient_privilege then
    null;
  end;
  raise notice 'PASS: anon sem acesso a stay_bookings nem a funcao admin';
end $$;

reset role;
rollback;
