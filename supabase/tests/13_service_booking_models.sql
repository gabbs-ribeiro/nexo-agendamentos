-- TESTE 13 — períodos de creche, preços por modalidade e hospedagem por horário.
-- Rodar SOMENTE em DEV após a migration 20261023000001.
-- Transação com ROLLBACK; esperado: PASS e nenhuma exceção.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000014', 'modelos@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000014', 'loja-modelos', 'Loja Modelos');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000014', '70000000-0000-0000-0000-000000000014');

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000014","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000014';
  v_day date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_category uuid;
  v_period_service uuid;
  v_stay_service uuid;
  v_period_option uuid;
  v_stay_option uuid;
  v_result jsonb;
  v_count int;
  v_i int;
  v_key uuid := gen_random_uuid();
begin
  select id into v_category from public.service_categories
   where business_id = c_biz order by sort_order limit 1;
  assert v_category is not null, 'negócio de teste precisa de categoria inicial';

  insert into public.services (business_id, category_id, name, booking_mode)
    values (c_biz, v_category, 'Creche', 'periods') returning id into v_period_service;
  insert into public.service_options (
    business_id, service_id, size, price_cents, duration_minutes,
    morning_price_cents, afternoon_price_cents, full_day_price_cents)
    values (c_biz, v_period_service, 'small', 5000, 30, 5000, 5500, 9000)
    returning id into v_period_option;
  v_result := public.admin_save_service_booking_settings(v_period_service, '{
    "morning_start":"08:00","morning_end":"13:00",
    "afternoon_start":"13:00","afternoon_end":"18:00"
  }'::jsonb);
  assert (v_result->>'ok')::boolean, 'configuração da creche falhou: ' || v_result::text;

  for v_i in 1..4 loop
    v_result := public.create_public_period_booking(
      'loja-modelos', v_period_option, v_day, 'morning',
      'Tutor ' || v_i, '4199999300' || v_i, 'Pet ' || v_i,
      null, null, true, gen_random_uuid());
    assert coalesce((v_result->>'ok')::boolean, false),
      'reserva da manhã ' || v_i || ' falhou: ' || v_result::text;
  end loop;
  v_result := public.get_period_quote('loja-modelos', v_period_option, v_day, 'morning');
  assert not (v_result->>'available')::boolean
     and v_result->>'local_start' = '08:00'
     and v_result->>'local_end' = '13:00',
    'a quinta reserva da manhã deve esgotar apenas a manhã: ' || v_result::text;
  v_result := public.create_public_period_booking(
    'loja-modelos', v_period_option, v_day, 'morning',
    'Tutor M5', '41999993005', 'Pet M5', null, null, true, v_key);
  assert v_result->>'error' = 'DAYCARE_FULL',
    'quinta reserva da manhã deve ser recusada no banco: ' || v_result::text;
  for v_i in 1..4 loop
    v_result := public.create_public_period_booking(
      'loja-modelos', v_period_option, v_day, 'afternoon',
      'Tutor T' || v_i, '4199999400' || v_i, 'Pet T' || v_i,
      null, null, true, gen_random_uuid());
    assert coalesce((v_result->>'ok')::boolean, false),
      'períodos vespertinos devem ter capacidade independente: ' || v_result::text;
  end loop;

  for v_i in 1..2 loop
    v_result := public.create_public_period_booking(
      'loja-modelos', v_period_option, v_day + 1, 'full_day',
      'Tutor I' || v_i, '4199999500' || v_i, 'Pet I' || v_i,
      null, null, true, gen_random_uuid());
    assert coalesce((v_result->>'ok')::boolean, false),
      'reserva integral ' || v_i || ' falhou: ' || v_result::text;
  end loop;
  for v_i in 1..2 loop
    v_result := public.create_public_period_booking(
      'loja-modelos', v_period_option, v_day + 1, 'morning',
      'Tutor M' || v_i, '4199999600' || v_i, 'Pet M' || v_i,
      null, null, true, gen_random_uuid());
    assert coalesce((v_result->>'ok')::boolean, false),
      'duas reservas integrais e duas matinais devem caber: ' || v_result::text;
  end loop;
  v_result := public.get_period_quote('loja-modelos', v_period_option, v_day + 1, 'morning');
  assert not (v_result->>'available')::boolean and (v_result->>'price_cents')::int = 5000,
    'manhã deveria estar cheia e manter seu preço';
  v_result := public.get_period_quote('loja-modelos', v_period_option, v_day + 1, 'afternoon');
  assert (v_result->>'available')::boolean and (v_result->>'price_cents')::int = 5500,
    'tarde deve continuar com vagas e usar seu próprio preço';
  v_result := public.create_public_period_booking(
    'loja-modelos', v_period_option, v_day + 2, 'morning',
    'Tutor idempotente', '41999996888', 'Pet idempotente',
    null, null, true, v_key);
  assert coalesce((v_result->>'ok')::boolean, false),
    'reserva inicial para teste de idempotência falhou: ' || v_result::text;
  v_result := public.create_public_period_booking(
    'loja-modelos', v_period_option, v_day + 2, 'morning',
    'Tutor idempotente', '41999996888', 'Pet idempotente',
    null, null, true, v_key);
  assert coalesce((v_result->>'ok')::boolean, false)
     and coalesce((v_result->>'idempotent')::boolean, false),
    'repetir a mesma chave deve retornar reserva já criada: ' || v_result::text;

  insert into public.services (business_id, category_id, name, booking_mode)
    values (c_biz, v_category, 'Hospedagem', 'stay') returning id into v_stay_service;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_stay_service, 'small', 10000, 30) returning id into v_stay_option;
  v_result := public.admin_save_service_booking_settings(v_stay_service, '{
    "check_in_times":["08:00"],
    "check_out_times":["08:00","14:00","20:00"]
  }'::jsonb);
  assert (v_result->>'ok')::boolean, 'configuração da hospedagem falhou: ' || v_result::text;

  v_result := public.get_timed_stay_options('loja-modelos', v_stay_option, v_day, '08:00');
  assert (select count(*) from jsonb_array_elements(v_result->'options') o
           where o->>'check_out' = (v_day + 1)::text
             and o->>'check_out_time' = '08:00'
             and (o->>'charge_units')::numeric = 1
             and (o->>'total_price_cents')::int = 10000) = 1,
    '24 horas devem cobrar uma diária: ' || v_result::text;
  assert (select count(*) from jsonb_array_elements(v_result->'options') o
           where o->>'check_out' = (v_day + 1)::text
             and o->>'check_out_time' = '20:00'
             and (o->>'charge_units')::numeric = 1.5
             and (o->>'total_price_cents')::int = 15000) = 1,
    '36 horas devem cobrar uma diária e meia: ' || v_result::text;
  assert not exists (
    select 1 from jsonb_array_elements(v_result->'options') o
     where o->>'check_out' = (v_day + 1)::text and o->>'check_out_time' = '14:00'
  ), 'duração arbitrária de 30 horas não deve aparecer';

  for v_i in 1..4 loop
    v_result := public.create_public_timed_stay(
      'loja-modelos', v_stay_option, v_day, '08:00', v_day + 1, '08:00',
      'Tutor H' || v_i, '4199999700' || v_i, 'Pet H' || v_i,
      null, null, true, gen_random_uuid());
    assert coalesce((v_result->>'ok')::boolean, false),
      'hospedagem temporizada ' || v_i || ' falhou: ' || v_result::text;
  end loop;
  v_result := public.create_public_timed_stay(
    'loja-modelos', v_stay_option, v_day, '08:00', v_day + 1, '08:00',
    'Tutor H5', '41999997005', 'Pet H5', null, null, true, gen_random_uuid());
  assert v_result->>'error' = 'STAY_FULL',
    'quinta hospedagem simultânea deve ser recusada: ' || v_result::text;

  select count(*) into v_count from public.stay_bookings
   where business_id = c_biz and check_in_at is not null;
  assert v_count = 4, 'hospedagens por horário devem preservar os snapshots: ' || v_count;
  raise notice 'PASS: modelos por período, capacidade compartilhada, tarifas e estadias temporizadas';
end;
$$;

rollback;
