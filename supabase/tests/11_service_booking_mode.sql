-- TESTE 11 — modo de agendamento do servico (horario x diaria).
-- Rodar SOMENTE em DEV apos a migration 20261022000001_service_booking_mode.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000011', 'dono-modo@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000011', 'loja-modo', 'Loja Modo');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000011', '70000000-0000-0000-0000-000000000011');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000011', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000011","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000011';
  v_date date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid;
  v_hourly uuid;
  v_daily uuid;
  v_hourly_opt uuid;
  v_daily_opt uuid;
  v_mode text;
  v_result jsonb;
  v_count int;
begin
  select id into v_category from public.service_categories
   where business_id = c_biz order by sort_order limit 1;

  -- padrao: servico novo e por horario
  insert into public.services (business_id, category_id, name)
    values (c_biz, v_category, 'Banho') returning id into v_hourly;
  select booking_mode into v_mode from public.services where id = v_hourly;
  assert v_mode = 'hourly', 'servico novo deveria nascer por horario: ' || coalesce(v_mode, 'null');

  -- o painel pode criar servico por diaria
  insert into public.services (business_id, category_id, name, booking_mode)
    values (c_biz, v_category, 'Hospedagem', 'daily') returning id into v_daily;

  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_hourly, 'small', 5000, 60) returning id into v_hourly_opt;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_daily, 'small', 12000, 30) returning id into v_daily_opt;

  -- valor invalido e recusado pelo banco
  begin
    update public.services set booking_mode = 'weekly' where id = v_daily and business_id = c_biz;
    raise exception 'FAIL: modo invalido foi aceito';
  exception when check_violation then
    null;
  end;

  -- catalogo publico devolve o modo
  select count(*) into v_count
    from jsonb_array_elements(public.list_public_services('loja-modo')) svc
   where svc->>'name' = 'Hospedagem' and svc->>'booking_mode' = 'daily';
  assert v_count = 1, 'list_public_services nao devolveu booking_mode daily';
  select count(*) into v_count
    from jsonb_array_elements(public.list_public_services('loja-modo')) svc
   where svc->>'name' = 'Banho' and svc->>'booking_mode' = 'hourly';
  assert v_count = 1, 'list_public_services nao devolveu booking_mode hourly';
  select count(*) into v_count
    from jsonb_array_elements(public.list_public_service_categories('loja-modo')) cat
    cross join lateral jsonb_array_elements(cat->'services') svc
   where svc->>'name' = 'Hospedagem' and svc->>'booking_mode' = 'daily';
  assert v_count = 1, 'list_public_service_categories nao devolveu booking_mode daily';

  -- servico por horario continua oferecendo horarios; por diaria nao
  select count(*) into v_count from public.get_available_slots('loja-modo', v_hourly_opt, v_date);
  assert v_count > 0, 'servico por horario deixou de oferecer horarios';
  select count(*) into v_count from public.get_available_slots('loja-modo', v_daily_opt, v_date);
  assert v_count = 0, 'servico por diaria ofereceu horarios';

  -- reserva por horario em servico por diaria e recusada (admin e publico)
  v_result := public.admin_create_booking(
    c_biz, v_daily_opt, (v_date + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990011', 'Rex');
  assert not coalesce((v_result->>'ok')::boolean, false)
     and v_result->>'error' = 'SERVICE_UNAVAILABLE',
    'admin_create_booking aceitou servico por diaria: ' || v_result::text;
  v_result := public.create_public_booking(
    'loja-modo', v_daily_opt, (v_date + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990011', 'Rex', null, null, true, gen_random_uuid());
  assert not coalesce((v_result->>'ok')::boolean, false)
     and v_result->>'error' = 'SERVICE_UNAVAILABLE',
    'create_public_booking aceitou servico por diaria: ' || v_result::text;

  -- o servico por horario ainda reserva normalmente
  v_result := public.admin_create_booking(
    c_biz, v_hourly_opt, (v_date + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990011', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false),
    'servico por horario deixou de aceitar reserva: ' || v_result::text;

  -- trocar o modo de volta libera os horarios (e a reserva existente nao muda)
  update public.services set booking_mode = 'hourly' where id = v_daily and business_id = c_biz;
  select count(*) into v_count from public.get_available_slots('loja-modo', v_daily_opt, v_date);
  assert v_count > 0, 'servico trocado para horario nao ofereceu horarios';
  select count(*) into v_count from public.bookings
   where business_id = c_biz and service_id = v_hourly and price_cents = 5000 and duration_minutes = 60;
  assert v_count = 1, 'reserva existente foi alterada';

  raise notice 'PASS: modo de agendamento (padrao, check, catalogo publico, horarios e reservas)';
end $$;

-- anon nao pode alterar o modo
reset role;
set local role anon;
do $$
begin
  begin
    update public.services set booking_mode = 'daily'
     where business_id = '70000000-0000-0000-0000-000000000011';
    raise exception 'FAIL: anon conseguiu atualizar services';
  exception when insufficient_privilege then
    raise notice 'PASS: anon nao altera booking_mode';
  end;
end $$;

reset role;
rollback;
