-- TESTE 10 — varios intervalos de expediente e folga por dia.
-- Rodar SOMENTE em DEV apos 20261021000005_admin_business_hours.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('10101010-0000-0000-0000-000000000010', 'dono-expediente@teste.local');
insert into public.businesses (id, slug, name, timezone) values
  ('10100000-0000-0000-0000-000000000010', 'loja-expediente', 'Loja Expediente', 'America/Sao_Paulo');
insert into public.business_members (user_id, business_id) values
  ('10101010-0000-0000-0000-000000000010', '10100000-0000-0000-0000-000000000010');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '10100000-0000-0000-0000-000000000010', d, 480, 1020 from generate_series(0, 6) d;
insert into public.services (id, business_id, name) values
  ('10100000-0000-0000-0000-000000000011', '10100000-0000-0000-0000-000000000010', 'Banho');
insert into public.service_options (id, business_id, service_id, size, price_cents, duration_minutes)
  values ('10100000-0000-0000-0000-000000000012', '10100000-0000-0000-0000-000000000010',
    '10100000-0000-0000-0000-000000000011', 'small', 6000, 45);

select set_config('request.jwt.claims',
  '{"sub":"10101010-0000-0000-0000-000000000010","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '10100000-0000-0000-0000-000000000010';
  c_option constant uuid := '10100000-0000-0000-0000-000000000012';
  v_date date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_hours jsonb;
  v_result jsonb;
  v_booking uuid;
  v_count int;
begin
  select jsonb_agg(jsonb_build_object(
    'day_of_week', day_of_week, 'opens_minute', opens_minute, 'closes_minute', closes_minute))
    into v_hours
    from (
      select d as day_of_week, 480 as opens_minute, 720 as closes_minute from generate_series(0, 6) d
      union all
      select d, 780, 1020 from generate_series(0, 6) d
    ) intervals;

  v_result := public.admin_replace_business_hours(c_biz, v_hours);
  assert (v_result->>'ok')::boolean, 'configuracao de varios periodos falhou: ' || v_result::text;
  select count(*) into v_count from public.business_hours where business_id = c_biz;
  assert v_count = 14, 'nao foram salvos dois periodos em cada dia';

  v_result := public.admin_replace_business_hours(c_biz, jsonb_build_array(
    jsonb_build_object('day_of_week', 1, 'opens_minute', 480, 'closes_minute', 720),
    jsonb_build_object('day_of_week', 1, 'opens_minute', 700, 'closes_minute', 800)));
  assert v_result->>'error' = 'INVALID_INPUT', 'faixas sobrepostas foram aceitas';
  select count(*) into v_count from public.business_hours where business_id = c_biz;
  assert v_count = 14, 'falha ao salvar horarios apagou o expediente anterior';

  v_result := public.admin_create_booking(
    c_biz, c_option, (v_date + time '10:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990010', 'Rex');
  assert (v_result->>'ok')::boolean, 'agendamento de teste falhou: ' || v_result::text;
  v_booking := (v_result->>'booking_ref')::uuid;

  v_result := public.admin_create_time_block(
    c_biz,
    (v_date + time '00:00') at time zone 'America/Sao_Paulo',
    ((v_date + 1) + time '00:00') at time zone 'America/Sao_Paulo',
    'Folga');
  assert v_result->>'error' = 'BOOKING_CONFLICT', 'folga foi criada sobre agendamento: ' || v_result::text;

  v_result := public.admin_set_booking_status(v_booking, 'cancelled');
  assert (v_result->>'ok')::boolean, 'cancelamento de teste falhou: ' || v_result::text;
  v_result := public.admin_create_time_block(
    c_biz,
    (v_date + time '00:00') at time zone 'America/Sao_Paulo',
    ((v_date + 1) + time '00:00') at time zone 'America/Sao_Paulo',
    'Folga');
  assert (v_result->>'ok')::boolean, 'folga nao foi criada apos cancelar a reserva: ' || v_result::text;

  select count(*) into v_count from public.time_blocks
   where business_id = c_biz
     and starts_at = (v_date + time '00:00') at time zone 'America/Sao_Paulo'
     and ends_at = ((v_date + 1) + time '00:00') at time zone 'America/Sao_Paulo';
  assert v_count = 1, 'bloqueio nao cobriu o dia no fuso do negocio';
  raise notice 'PASS: expediente com multiplos periodos, atualizacao atomica e folga com conflito';
end $$;

reset role;
rollback;
