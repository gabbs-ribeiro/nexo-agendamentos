-- TESTE 08 — snapshots historicos, anotacoes internas, autorizacao e cancelamento.
-- Rodar SOMENTE no projeto de DEV (SQL Editor, como postgres), apos a migration 20261021000001.
-- Transacao com ROLLBACK. Esperado: mensagens PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('88888888-0000-0000-0000-000000000008', 'dono-historico@teste.local'),
  ('99999999-0000-0000-0000-000000000009', 'sem-vinculo-historico@teste.local');
insert into public.businesses (id, slug, name) values
  ('80000000-0000-0000-0000-000000000008', 'loja-historico', 'Loja Historico');
insert into public.business_members (user_id, business_id) values
  ('88888888-0000-0000-0000-000000000008', '80000000-0000-0000-0000-000000000008');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '80000000-0000-0000-0000-000000000008', d, 480, 720 from generate_series(0, 6) d;
insert into public.services (id, business_id, name) values
  ('80000000-0000-0000-0000-000000000009', '80000000-0000-0000-0000-000000000008', 'Banho');
insert into public.service_options (id, business_id, service_id, size, price_cents, duration_minutes) values
  ('80000000-0000-0000-0000-00000000000a', '80000000-0000-0000-0000-000000000008',
   '80000000-0000-0000-0000-000000000009', 'small', 6000, 45);

select set_config('request.jwt.claims',
  '{"sub":"88888888-0000-0000-0000-000000000008","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '80000000-0000-0000-0000-000000000008';
  c_service constant uuid := '80000000-0000-0000-0000-000000000009';
  c_option constant uuid := '80000000-0000-0000-0000-00000000000a';
  v_date date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_booking uuid;
  v_new_booking uuid;
  v_result jsonb;
  v_count int;
begin
  v_result := public.admin_create_booking(
    c_biz, c_option, (v_date + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990001', 'Rex', 'Poodle', 'Alergia informada pelo tutor');
  assert (v_result->>'ok')::boolean, 'criacao inicial falhou: ' || v_result::text;
  v_booking := (v_result->>'booking_ref')::uuid;

  update public.services set name = 'Banho Premium' where id = c_service;
  update public.service_options
     set price_cents = 12000, duration_minutes = 75
   where id = c_option;
  select count(*) into v_count from public.bookings
   where id = v_booking and service_name = 'Banho' and size = 'small'
     and price_cents = 6000 and duration_minutes = 45
     and ends_at = starts_at + interval '45 minutes' and buffer_minutes = 10;
  assert v_count = 1, 'alterar ou arquivar servico mudou os snapshots existentes';

  v_result := public.admin_create_booking(
    c_biz, c_option, (v_date + time '10:00') at time zone 'America/Sao_Paulo',
    'Bia Lima', '41999990002', 'Mel');
  assert (v_result->>'ok')::boolean, 'novo agendamento com opcao atualizada falhou: ' || v_result::text;
  v_new_booking := (v_result->>'booking_ref')::uuid;
  select count(*) into v_count from public.bookings
   where id = v_new_booking and service_name = 'Banho Premium' and price_cents = 12000
     and duration_minutes = 75 and ends_at = starts_at + interval '75 minutes';
  assert v_count = 1, 'novo agendamento nao usou as configuracoes atuais';

  update public.services set is_active = false, archived_at = now() where id = c_service;
  update public.service_options set is_active = false where id = c_option;
  select count(*) into v_count from public.bookings
   where service_id = c_service and service_option_id = c_option;
  assert v_count = 2, 'arquivar servico eliminou ou desvinculou o historico';
  select count(*) into v_count from public.bookings
   where id = v_booking and service_name = 'Banho' and size = 'small'
     and price_cents = 6000 and duration_minutes = 45
     and ends_at = starts_at + interval '45 minutes' and buffer_minutes = 10;
  assert v_count = 1, 'alterar ou arquivar servico mudou os snapshots existentes';
  raise notice 'PASS: alteracoes valem para novos agendamentos e arquivamento preserva o historico';

  v_result := public.admin_update_booking_internal_notes(v_booking, 'Ligar antes da chegada');
  assert (v_result->>'ok')::boolean, 'salvar anotacao interna falhou: ' || v_result::text;
  select count(*) into v_count from public.bookings
   where id = v_booking and internal_notes = 'Ligar antes da chegada'
     and notes = 'Alergia informada pelo tutor'
     and price_cents = 6000 and duration_minutes = 45;
  assert v_count = 1, 'anotacao interna alterou observacoes publicas ou snapshot';
  v_result := public.admin_update_booking_internal_notes(v_booking, repeat('x', 2001));
  assert v_result->>'error' = 'INVALID_INPUT', 'anotacao interna acima do limite foi aceita';
  raise notice 'PASS: anotacoes internas sao separadas, limitadas e nao alteram snapshots';

  update public.businesses set buffer_minutes = 20 where id = c_biz;
  v_result := public.admin_reschedule_booking(
    v_booking, (v_date + time '08:30') at time zone 'America/Sao_Paulo');
  assert (v_result->>'ok')::boolean, 'remarcacao com novos parametros falhou: ' || v_result::text;
  select count(*) into v_count from public.bookings
   where id = v_booking and starts_at = (v_date + time '08:30') at time zone 'America/Sao_Paulo'
     and ends_at = starts_at + interval '45 minutes'
     and buffer_minutes = 10 and duration_minutes = 45 and price_cents = 6000;
  assert v_count = 1, 'remarcacao substituiu o gap historico ou alterou snapshots do servico';
  raise notice 'PASS: remarcacao preserva gap, preco e duracao historicos';

  perform set_config('request.jwt.claims',
    '{"sub":"99999999-0000-0000-0000-000000000009","role":"authenticated"}', true);
  v_result := public.admin_update_booking_internal_notes(v_booking, 'Tentativa sem vinculo');
  assert v_result->>'error' = 'NOT_FOUND', 'usuario sem vinculo acessou agendamento';
  perform set_config('request.jwt.claims',
    '{"sub":"88888888-0000-0000-0000-000000000008","role":"authenticated"}', true);
  raise notice 'PASS: alteracao de anotacoes respeita o vinculo e isolamento';

  v_result := public.admin_set_booking_status(v_booking, 'cancelled');
  assert (v_result->>'ok')::boolean, 'cancelamento falhou: ' || v_result::text;
  select count(*) into v_count from public.bookings
   where id = v_booking and status = 'cancelled' and cancelled_at is not null
     and service_name = 'Banho' and size = 'small' and price_cents = 6000
     and duration_minutes = 45 and internal_notes = 'Ligar antes da chegada';
  assert v_count = 1, 'cancelamento apagou a linha ou alterou o historico';
  v_result := public.admin_set_booking_status(v_booking, 'confirmed');
  assert v_result->>'error' = 'INVALID_TRANSITION', 'cancelamento definitivo foi revertido';
  raise notice 'PASS: cancelamento preserva historico e e definitivo';
end $$;

reset role;

do $$
declare
  c_biz constant uuid := '80000000-0000-0000-0000-000000000008';
  v_date date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_count int;
begin
  select count(*) into v_count
    from app_private.compute_slots(c_biz, 45, v_date, true) s
   where s.slot_start = (v_date + time '08:30') at time zone 'America/Sao_Paulo';
  assert v_count = 1, 'cancelamento nao liberou o horario na agenda';
  raise notice 'PASS: cancelamento libera o horario para novas reservas';
end $$;

rollback;
