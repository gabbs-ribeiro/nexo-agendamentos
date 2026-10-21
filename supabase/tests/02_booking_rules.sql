-- =====================================================================
-- TESTE 02 — regras de agenda: grade, duracao real, gap, bloqueios, fuso,
-- servicos inativos, limites, idempotencia e constraint anti-sobreposicao.
-- Rodar SOMENTE no projeto de DEV (SQL Editor, como postgres), depois das migrations.
-- Transacao com ROLLBACK no final. Esperado: so "PASS", nenhuma excecao.
--
-- Cenario: negocio aberto TODOS os dias das 08:00 as 12:00, grade de 30 min, gap de 10 min,
-- antecedencia minima 2 h. Servico de 45 min (duracao real, sem arredondar).
-- Data de teste = hoje (fuso do negocio) + 3 dias.
-- =====================================================================
begin;

insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-00000000000d', 'dono-regras@teste.local');
insert into public.businesses (id, slug, name) values
  ('d0000000-0000-0000-0000-0000000000d1', 'loja-regras', 'Loja Regras');
insert into public.business_members (user_id, business_id) values
  ('dddddddd-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-0000000000d1');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select 'd0000000-0000-0000-0000-0000000000d1', d, 480, 720 from generate_series(0, 6) d;
insert into public.services (id, business_id, name) values
  ('d0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d1', 'Banho');
insert into public.service_options (id, business_id, service_id, size, price_cents, duration_minutes) values
  ('d0000000-0000-0000-0000-0000000000d3', 'd0000000-0000-0000-0000-0000000000d1',
   'd0000000-0000-0000-0000-0000000000d2', 'small', 6000, 45);

do $$
declare
  c_opt   constant uuid := 'd0000000-0000-0000-0000-0000000000d3';
  c_biz   constant uuid := 'd0000000-0000-0000-0000-0000000000d1';
  c_user  constant text := 'dddddddd-0000-0000-0000-00000000000d';
  v_date  date;
  v_arr   text[];
  v_arr2  text[];
  r       jsonb;
  n       int;
  v_ref   uuid;
  v_key   uuid;
begin
  v_date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;

  -- helper inline: timestamptz de um horario local do dia de teste
  -- (usado como: (v_date + time 'HH:MM') at time zone 'America/Sao_Paulo')

  ---------------------------------------------------------------- 1) grade e duracao real
  set local role anon;
  select array_agg(local_time order by starts_at) into v_arr
    from public.get_available_slots('loja-regras', c_opt, v_date);
  assert v_arr = array['08:00','08:30','09:00','09:30','10:00','10:30','11:00'],
    'grade inicial inesperada: ' || coalesce(v_arr::text, 'null');
  -- 11:30 + 45 min = 12:15 > fechamento: nao e oferecido (padrao)
  raise notice 'PASS: grade de 30 min, duracao real de 45 min, servico nao passa do fechamento';

  ---------------------------------------------------------------- 2) independe do fuso da sessao
  set local timezone = 'Asia/Tokyo';
  select array_agg(local_time order by starts_at) into v_arr2
    from public.get_available_slots('loja-regras', c_opt, v_date);
  assert v_arr2 = v_arr, 'horarios mudaram com o fuso da sessao: ' || v_arr2::text;
  reset timezone;
  raise notice 'PASS: horarios dependem do fuso do NEGOCIO, nao da sessao/navegador';

  ---------------------------------------------------------------- 3) reserva valida + gap
  v_key := gen_random_uuid();
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '08:00') at time zone 'America/Sao_Paulo',
        'Maria Silva', '(41) 99999-0001', 'Rex', 'SRD', 'alergico', true, v_key);
  assert (r->>'ok')::boolean, 'reserva valida falhou: ' || r::text;
  v_ref := (r->>'booking_ref')::uuid;
  assert not (r ? 'customer_phone') and not (r ? 'customer_name'), 'resposta publica vazou dado pessoal';

  select array_agg(local_time order by starts_at) into v_arr
    from public.get_available_slots('loja-regras', c_opt, v_date);
  -- 08:00-08:45 + gap ate 08:55 => 08:30 some; 09:00 ja e permitido
  assert v_arr = array['09:00','09:30','10:00','10:30','11:00'],
    'gap nao respeitado: ' || v_arr::text;
  raise notice 'PASS: gap de 10 min bloqueia 08:30 e libera 09:00';

  ---------------------------------------------------------------- 4) idempotencia
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '08:00') at time zone 'America/Sao_Paulo',
        'Maria Silva', '41999990001', 'Rex', 'SRD', 'alergico', true, v_key);
  assert (r->>'ok')::boolean and (r->>'idempotent')::boolean and (r->>'booking_ref')::uuid = v_ref,
    'retry com a mesma chave deveria devolver a mesma reserva: ' || r::text;
  reset role;
  select count(*) into n from public.bookings where business_id = c_biz;
  assert n = 1, 'retry criou reserva duplicada';
  set local role anon;
  raise notice 'PASS: retry com mesma chave nao duplica';

  ---------------------------------------------------------------- 5) conflito, fora da grade, fora do horario
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '08:00') at time zone 'America/Sao_Paulo',
        'Outro Cliente', '41999990002', 'Bob', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'mesmo horario deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '08:30') at time zone 'America/Sao_Paulo',
        'Outro Cliente', '41999990002', 'Bob', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'horario dentro do gap deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '09:10') at time zone 'America/Sao_Paulo',
        'Outro Cliente', '41999990002', 'Bob', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'horario fora da grade deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '07:00') at time zone 'America/Sao_Paulo',
        'Outro Cliente', '41999990002', 'Bob', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'antes da abertura deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '11:30') at time zone 'America/Sao_Paulo',
        'Outro Cliente', '41999990002', 'Bob', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'servico que passa do fechamento deveria falhar: ' || r::text;
  raise notice 'PASS: conflito, gap, fora da grade e fora do horario recusados';

  ---------------------------------------------------------------- 6) validacao de entrada
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '09:00') at time zone 'America/Sao_Paulo',
        'Maria', '41999990003', 'Rex', null, null, false, gen_random_uuid());
  assert r->>'error' = 'CONSENT_REQUIRED', 'sem consentimento deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '09:00') at time zone 'America/Sao_Paulo',
        'Maria', '123', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'INVALID_INPUT', 'telefone invalido deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '09:00') at time zone 'America/Sao_Paulo',
        'M', '41999990003', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'INVALID_INPUT', 'nome curto deveria falhar: ' || r::text;
  r := public.create_public_booking('slug-inexistente', c_opt,
        (v_date + time '09:00') at time zone 'America/Sao_Paulo',
        'Maria', '41999990003', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'NOT_FOUND', 'slug inexistente deveria falhar: ' || r::text;
  r := public.create_public_booking('loja-regras', gen_random_uuid(),
        (v_date + time '09:00') at time zone 'America/Sao_Paulo',
        'Maria', '41999990003', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SERVICE_UNAVAILABLE', 'opcao inexistente deveria falhar: ' || r::text;
  raise notice 'PASS: validacoes (consentimento, telefone, nome, slug, opcao)';

  ---------------------------------------------------------------- 7) bloqueios (admin)
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  set local role authenticated;

  r := public.admin_create_time_block(c_biz,
        (v_date + time '10:00') at time zone 'America/Sao_Paulo',
        (v_date + time '10:30') at time zone 'America/Sao_Paulo', 'almoco antecipado');
  assert (r->>'ok')::boolean, 'bloqueio valido falhou: ' || r::text;

  -- bloqueio sobre agendamento existente (08:00) e rejeitado (decisao D9)
  r := public.admin_create_time_block(c_biz,
        (v_date + time '08:30') at time zone 'America/Sao_Paulo',
        (v_date + time '09:00') at time zone 'America/Sao_Paulo', 'conflito');
  assert r->>'error' = 'BOOKING_CONFLICT', 'bloqueio sobre agendamento deveria ser rejeitado: ' || r::text;

  reset role;
  set local role anon;
  select array_agg(local_time order by starts_at) into v_arr
    from public.get_available_slots('loja-regras', c_opt, v_date);
  -- 09:30 (servico 09:30-10:15) e 10:00 invadem o bloqueio 10:00-10:30
  assert v_arr = array['09:00','10:30','11:00'], 'bloqueio nao respeitado: ' || v_arr::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '10:00') at time zone 'America/Sao_Paulo',
        'Maria', '41999990009', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'reserva em horario bloqueado deveria falhar: ' || r::text;
  raise notice 'PASS: bloqueios respeitados; bloqueio sobre agendamento recusado';

  ---------------------------------------------------------------- 8) limite por telefone (2 futuros)
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '09:00') at time zone 'America/Sao_Paulo',
        'Maria Silva', '+55 41 99999-0001', 'Luna', null, null, true, gen_random_uuid());
  assert (r->>'ok')::boolean, 'segundo agendamento do mesmo telefone deveria passar: ' || r::text;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '10:30') at time zone 'America/Sao_Paulo',
        'Maria Silva', '41999990001', 'Thor', null, null, true, gen_random_uuid());
  assert r->>'error' = 'LIMIT_REACHED', 'terceiro agendamento do mesmo telefone deveria falhar: ' || r::text;
  raise notice 'PASS: limite de 2 agendamentos futuros por telefone (+55 normalizado)';

  ---------------------------------------------------------------- 9) servico/opcao inativos
  reset role;
  update public.service_options set is_active = false where id = c_opt;
  set local role anon;
  select count(*) into n from public.get_available_slots('loja-regras', c_opt, v_date);
  assert n = 0, 'opcao inativa ainda oferece horarios';
  assert jsonb_array_length(public.list_public_services('loja-regras')) = 0, 'opcao inativa listada';
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '11:00') at time zone 'America/Sao_Paulo',
        'Joao Souza', '41999990010', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SERVICE_UNAVAILABLE', 'opcao inativa aceitou reserva: ' || r::text;
  reset role;
  update public.service_options set is_active = true where id = c_opt;
  update public.services set is_active = false where id = 'd0000000-0000-0000-0000-0000000000d2';
  set local role anon;
  r := public.create_public_booking('loja-regras', c_opt,
        (v_date + time '11:00') at time zone 'America/Sao_Paulo',
        'Joao Souza', '41999990010', 'Rex', null, null, true, gen_random_uuid());
  assert r->>'error' = 'SERVICE_UNAVAILABLE', 'servico inativo aceitou reserva: ' || r::text;
  reset role;
  update public.services set is_active = true where id = 'd0000000-0000-0000-0000-0000000000d2';
  raise notice 'PASS: servico/porte inativo nao recebe reservas';

  ---------------------------------------------------------------- 10) cancelar libera o horario
  perform set_config('request.jwt.claims',
    json_build_object('sub', c_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.admin_set_booking_status(v_ref, 'cancelled');
  assert (r->>'ok')::boolean, 'cancelar falhou: ' || r::text;
  r := public.admin_set_booking_status(v_ref, 'cancelled');
  assert r->>'error' = 'INVALID_TRANSITION', 'cancelar duas vezes deveria falhar';
  r := public.admin_set_booking_status(v_ref, 'confirmed');
  assert r->>'error' = 'INVALID_TRANSITION', 'reabrir cancelado deveria falhar';
  reset role;
  set local role anon;
  select array_agg(local_time order by starts_at) into v_arr
    from public.get_available_slots('loja-regras', c_opt, v_date);
  assert v_arr[1] = '08:00', 'cancelamento nao liberou 08:00: ' || v_arr::text;
  raise notice 'PASS: cancelamento libera o horario; cancelado e definitivo';

  ---------------------------------------------------------------- 11) fechamento configuravel
  reset role;
  update public.businesses set allow_end_after_close = true where id = c_biz;
  set local role anon;
  select array_agg(local_time order by starts_at) into v_arr
    from public.get_available_slots('loja-regras', c_opt, v_date);
  assert '11:30' = any(v_arr), 'allow_end_after_close=true deveria oferecer 11:30: ' || v_arr::text;
  assert not ('12:00' = any(v_arr)), 'nao pode INICIAR apos o fechamento';
  reset role;
  update public.businesses set allow_end_after_close = false where id = c_biz;
  raise notice 'PASS: terminar apos o fechamento so quando configurado; iniciar apos fechar nunca';

  ---------------------------------------------------------------- 12) janela de antecedencia
  set local role anon;
  select count(*) into n from public.get_available_slots('loja-regras', c_opt,
        ((now() at time zone 'America/Sao_Paulo')::date) - 1);
  assert n = 0, 'oferece horarios no passado';
  select count(*) into n from public.get_available_slots('loja-regras', c_opt,
        ((now() at time zone 'America/Sao_Paulo')::date) + 31);
  assert n = 0, 'oferece horarios alem de max_days_ahead';
  select count(*) into n from public.get_available_slots('loja-regras', c_opt,
        (now() at time zone 'America/Sao_Paulo')::date)
   where starts_at < now() + interval '120 minutes';
  assert n = 0, 'oferece horarios antes da antecedencia minima';
  raise notice 'PASS: passado, alem de 30 dias e antes de 2 h de antecedencia nao sao oferecidos';
  reset role;
end $$;

-- ---------------------------------------------------------------- 13) constraints do banco (rede de seguranca)
-- Aqui ignoramos as funcoes de proposito: o BANCO sozinho precisa impedir sobreposicao.
do $$
declare
  c_biz constant uuid := 'd0000000-0000-0000-0000-0000000000d1';
  v_base timestamptz := date_trunc('day', now()) + interval '20 days 10 hours';
begin
  insert into public.bookings (
    business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
    service_name, size, price_cents, duration_minutes, customer_name, customer_phone, pet_name, created_by)
  values (c_biz, 'd0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d3',
    v_base, v_base + interval '45 minutes', 10, v_base + interval '55 minutes',
    'Banho', 'small', 6000, 45, 'Teste Constraint', '41999990020', 'Rex', 'admin');

  -- sobreposicao direta
  begin
    insert into public.bookings (
      business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
      service_name, size, price_cents, duration_minutes, customer_name, customer_phone, pet_name, created_by)
    values (c_biz, 'd0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d3',
      v_base + interval '30 minutes', v_base + interval '75 minutes', 10, v_base + interval '85 minutes',
      'Banho', 'small', 6000, 45, 'Teste 2', '41999990021', 'Bob', 'admin');
    raise exception 'FAIL: o banco aceitou agendamentos sobrepostos';
  exception when exclusion_violation then
    raise notice 'PASS: exclusion constraint barra sobreposicao';
  end;

  -- dentro do gap (comeca 5 min depois do fim do servico)
  begin
    insert into public.bookings (
      business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
      service_name, size, price_cents, duration_minutes, customer_name, customer_phone, pet_name, created_by)
    values (c_biz, 'd0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d3',
      v_base + interval '50 minutes', v_base + interval '95 minutes', 10, v_base + interval '105 minutes',
      'Banho', 'small', 6000, 45, 'Teste 3', '41999990022', 'Bob', 'admin');
    raise exception 'FAIL: o banco aceitou agendamento dentro do gap';
  exception when exclusion_violation then
    raise notice 'PASS: exclusion constraint considera o gap';
  end;

  -- encostado depois do gap: permitido
  insert into public.bookings (
    business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
    service_name, size, price_cents, duration_minutes, customer_name, customer_phone, pet_name, created_by)
  values (c_biz, 'd0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d3',
    v_base + interval '55 minutes', v_base + interval '100 minutes', 10, v_base + interval '110 minutes',
    'Banho', 'small', 6000, 45, 'Teste 4', '41999990023', 'Bob', 'admin');
  raise notice 'PASS: agendamento logo apos o gap e aceito';

  -- cancelado nao ocupa horario
  update public.bookings set status = 'cancelled', cancelled_at = now()
   where business_id = c_biz and customer_name = 'Teste Constraint';
  insert into public.bookings (
    business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
    service_name, size, price_cents, duration_minutes, customer_name, customer_phone, pet_name, created_by)
  values (c_biz, 'd0000000-0000-0000-0000-0000000000d2', 'd0000000-0000-0000-0000-0000000000d3',
    v_base, v_base + interval '45 minutes', 10, v_base + interval '55 minutes',
    'Banho', 'small', 6000, 45, 'Teste 5', '41999990024', 'Bob', 'admin');
  raise notice 'PASS: agendamento cancelado nao ocupa horario';

  -- horarios de funcionamento sobrepostos no mesmo dia
  begin
    insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
    values (c_biz, 1, 600, 800);
    raise exception 'FAIL: faixas de funcionamento sobrepostas aceitas';
  exception when exclusion_violation then
    raise notice 'PASS: faixas de funcionamento nao se sobrepoem';
  end;

  -- slug reservado, cor invalida, fuso invalido
  begin
    insert into public.businesses (slug, name) values ('admin', 'X');
    raise exception 'FAIL: slug reservado aceito';
  exception when check_violation then raise notice 'PASS: slug reservado recusado'; end;
  begin
    insert into public.businesses (slug, name, primary_color) values ('cor-ruim', 'X', 'red');
    raise exception 'FAIL: cor invalida aceita';
  exception when check_violation then raise notice 'PASS: cor invalida recusada'; end;
  begin
    insert into public.businesses (slug, name, timezone) values ('fuso-ruim', 'X', 'Marte/Olimpo');
    raise exception 'FAIL: fuso invalido aceito';
  exception when invalid_parameter_value then raise notice 'PASS: fuso invalido recusado'; end;
end $$;

rollback;
