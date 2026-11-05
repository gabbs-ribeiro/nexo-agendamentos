-- TESTE 19 — janela do cliente (60 dias) e painel sem limite de data.
-- Rodar SOMENTE em DEV apos as migrations 20261028000001 e 20261105000001.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000059', 'dono-janela@teste.local'),
  ('77777777-0000-0000-0000-000000000060', 'outro-janela@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000059', 'loja-janela', 'Loja Janela');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000059', '70000000-0000-0000-0000-000000000059');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000059', d, 480, 720 from generate_series(0, 6) d;

-- cadastro dos servicos (como superusuario: as configuracoes dos modelos nao tem escrita direta)
create temp table ids (name text primary key, id uuid);
grant all on ids to public;
do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000059';
  v_category uuid; v_s uuid; v_o uuid;
begin
  select id into v_category from public.service_categories where business_id = c_biz order by sort_order limit 1;

  insert into public.services (business_id, category_id, name) values (c_biz, v_category, 'Banho') returning id into v_s;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_s, 'small', 5000, 60) returning id into v_o;
  insert into ids values ('hourly', v_o);

  insert into public.services (business_id, category_id, name, booking_mode) values (c_biz, v_category, 'Creche', 'periods') returning id into v_s;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes,
                                      morning_price_cents, afternoon_price_cents, full_day_price_cents)
    values (c_biz, v_s, 'small', 3000, 30, 3000, 3000, 5000) returning id into v_o;
  insert into public.service_booking_settings (service_id, business_id, morning_start, morning_end, afternoon_start, afternoon_end)
    values (v_s, c_biz, '07:00', '12:00', '13:00', '18:00');
  insert into ids values ('periods', v_o);

  insert into public.services (business_id, category_id, name, booking_mode) values (c_biz, v_category, 'Hotel', 'stay') returning id into v_s;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_s, 'small', 5000, 30) returning id into v_o;
  insert into public.service_booking_settings (service_id, business_id, check_in_start, check_in_end, check_out_start, check_out_end)
    values (v_s, c_biz, '08:00', '20:00', '07:00', '22:00');
  insert into ids values ('stay', v_o);
end $$;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000059","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000059';
  c_tz constant text := 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_d55 date := v_today + 55;
  v_d70 date := v_today + 70;
  v_hourly uuid; v_periods uuid; v_stay uuid;
  v_result jsonb; v_count int; v_text text; v_i int;
  v_out_date text; v_out_time text;
begin
  select id into v_hourly from ids where name = 'hourly';
  select id into v_periods from ids where name = 'periods';
  select id into v_stay from ids where name = 'stay';

  -- janela do cliente: padrao de 60 dias
  select max_days_ahead into v_count from public.businesses where id = c_biz;
  assert v_count = 60, 'janela padrao deveria ser 60 dias: ' || v_count;

  -- HORARIO: cliente ve ate 60 dias; o painel ve depois
  select count(*) into v_count from public.get_available_slots('loja-janela', v_hourly, v_d55);
  assert v_count > 0, 'cliente deveria ver horarios a 55 dias';
  select count(*) into v_count from public.get_available_slots('loja-janela', v_hourly, v_d70);
  assert v_count = 0, 'cliente nao deveria ver horarios a 70 dias';
  select count(*) into v_count from public.admin_get_available_slots(c_biz, v_hourly, v_d70);
  assert v_count > 0, 'painel deveria ver horarios a 70 dias';
  v_result := public.admin_create_booking(c_biz, v_hourly, (v_d70 + time '08:00') at time zone c_tz,
    'Ana Costa', '41999990059', 'Rex');
  assert coalesce((v_result->>'ok')::boolean, false), 'painel deveria agendar a 70 dias: ' || v_result::text;
  -- o horario ocupado some da lista do painel
  select count(*) into v_count from public.admin_get_available_slots(c_biz, v_hourly, v_d70) where local_time = '08:00';
  assert v_count = 0, 'horario ocupado ainda aparece para o painel';
  -- passado continua fora
  select count(*) into v_count from public.admin_get_available_slots(c_biz, v_hourly, v_today - 1);
  assert v_count = 0, 'painel nao deveria listar horarios no passado';

  -- CRECHE: cliente limitado a 60 dias; painel sem limite
  v_result := public.get_period_quote('loja-janela', v_periods, v_d55, 'morning');
  assert (v_result->>'ok')::boolean and (v_result->>'available')::boolean, 'cliente deveria cotar a 55 dias: ' || v_result::text;
  v_result := public.get_period_quote('loja-janela', v_periods, v_d70, 'morning');
  assert v_result->>'error' = 'INVALID_INPUT', 'cliente nao deveria cotar a 70 dias: ' || v_result::text;
  v_result := public.admin_get_period_quote(c_biz, v_periods, v_d70, 'morning');
  assert (v_result->>'ok')::boolean and (v_result->>'available')::boolean and (v_result->>'price_cents')::int = 3000,
    'painel deveria cotar a 70 dias: ' || v_result::text;
  v_result := public.admin_get_period_quote(c_biz, v_periods, v_today - 1, 'morning');
  assert v_result->>'error' = 'INVALID_INPUT', 'painel nao deveria cotar no passado';
  for v_i in 1..4 loop
    v_result := public.admin_create_period_booking(c_biz, v_periods, v_d70, 'morning',
      'Tutor ' || v_i, '4199999006' || v_i, 'Pet ' || v_i, null, null);
    assert coalesce((v_result->>'ok')::boolean, false), 'creche ' || v_i || ' a 70 dias falhou: ' || v_result::text;
  end loop;
  v_result := public.admin_create_period_booking(c_biz, v_periods, v_d70, 'morning', 'Tutor 5', '41999990065', 'Pet 5', null, null);
  assert v_result->>'error' = 'DAYCARE_FULL', 'a capacidade da creche continua valendo no painel: ' || v_result::text;
  select count(*) into v_count from public.daycare_bookings
   where business_id = c_biz and created_by = 'admin' and consent_at is null;
  assert v_count = 4, 'reservas do painel deveriam ter origem admin sem consentimento: ' || v_count;

  -- HOSPEDAGEM: cliente limitado a 60 dias; painel sem limite
  v_result := public.get_timed_stay_options('loja-janela', v_stay, v_d55, '10:00');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'options') > 0, 'cliente deveria ver saidas a 55 dias: ' || v_result::text;
  v_result := public.get_timed_stay_options('loja-janela', v_stay, v_d70, '10:00');
  assert v_result->>'error' = 'INVALID_INPUT', 'cliente nao deveria ver saidas a 70 dias: ' || v_result::text;
  v_result := public.admin_get_timed_stay_options(c_biz, v_stay, v_d70, '10:00');
  assert (v_result->>'ok')::boolean and jsonb_array_length(v_result->'options') > 0, 'painel deveria ver saidas a 70 dias: ' || v_result::text;
  v_out_date := v_result->'options'->0->>'check_out';
  v_out_time := v_result->'options'->0->>'check_out_time';
  assert (v_result->'options'->0->>'duration_hours')::numeric = 12
     and (v_result->'options'->0->>'charge_units')::numeric = 0.5
     and (v_result->'options'->0->>'total_price_cents')::integer = 2500,
    'a primeira opcao de hospedagem deveria cobrar meia diaria em 12 horas: ' || v_result::text;
  v_result := public.admin_create_timed_stay(c_biz, v_stay, v_d70, '10:00', v_out_date::date, v_out_time,
    'Carla Souza', '41999990066', 'Thor', null, null);
  assert coalesce((v_result->>'ok')::boolean, false), 'hospedagem a 70 dias falhou: ' || v_result::text;
  assert (v_result->>'duration_minutes')::integer = 720
     and (v_result->>'charge_units')::numeric = 0.5
     and (v_result->>'total_price_cents')::integer = 2500,
    'hospedagem de 12 horas deveria ser criada por meia diaria: ' || v_result::text;
  select count(*) into v_count from public.stay_bookings
   where business_id = c_biz and created_by = 'admin' and consent_at is null and check_in = v_d70;
  assert v_count = 1, 'hospedagem do painel deveria ter origem admin sem consentimento';
  v_result := public.admin_get_timed_stay_options(c_biz, v_stay, v_today - 1, '10:00');
  assert v_result->>'error' = 'INVALID_INPUT', 'painel nao deveria cotar hospedagem no passado';

  -- usuario sem vinculo: nada
  perform set_config('request.jwt.claims',
    '{"sub":"77777777-0000-0000-0000-000000000060","role":"authenticated"}', true);
  select count(*) into v_count from public.admin_get_available_slots(c_biz, v_hourly, v_d70);
  assert v_count = 0, 'usuario sem vinculo listou horarios';
  assert public.admin_get_period_quote(c_biz, v_periods, v_d70, 'morning')->>'error' = 'NOT_FOUND', 'usuario sem vinculo cotou creche';
  assert public.admin_get_timed_stay_options(c_biz, v_stay, v_d70, '10:00')->>'error' = 'NOT_FOUND', 'usuario sem vinculo cotou hospedagem';
  assert public.admin_create_period_booking(c_biz, v_periods, v_d70, 'afternoon', 'Ana Costa', '41999990067', 'Rex', null, null)->>'error' = 'NOT_FOUND',
    'usuario sem vinculo criou creche';
  assert public.admin_create_timed_stay(c_biz, v_stay, v_d70, '10:00', v_out_date::date, v_out_time, 'Ana Costa', '41999990067', 'Rex', null, null)->>'error' = 'NOT_FOUND',
    'usuario sem vinculo criou hospedagem';

  raise notice 'PASS: janela de 60 dias para o cliente e painel sem limite (horario, creche e hospedagem)';
end $$;

-- anon: funcoes publicas funcionam, as do painel nao
reset role;
set local role anon;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.get_available_slots('loja-janela', gen_random_uuid(), current_date + 3);
  begin
    perform public.admin_get_period_quote('70000000-0000-0000-0000-000000000059', gen_random_uuid(), current_date + 3, 'morning');
    raise exception 'FAIL: anon executou admin_get_period_quote';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.admin_get_available_slots('70000000-0000-0000-0000-000000000059', gen_random_uuid(), current_date + 3);
    raise exception 'FAIL: anon executou admin_get_available_slots';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_get_timed_stay_options('70000000-0000-0000-0000-000000000059', gen_random_uuid(), current_date + 3, '10:00');
    raise exception 'FAIL: anon executou admin_get_timed_stay_options';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon sem acesso as funcoes administrativas';
end $$;

reset role;
rollback;
