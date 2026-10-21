-- =====================================================================
-- TESTE 03 — funcoes administrativas: criar, remarcar, mudar status, editar dados, bloqueios
-- Rodar SOMENTE no projeto de DEV (SQL Editor, como postgres), depois das migrations.
-- Transacao com ROLLBACK. Esperado: so "PASS", nenhuma excecao.
-- Cenario: aberto todos os dias 08:00-12:00, grade 30 min, gap 10 min, servico de 45 min.
-- =====================================================================
begin;

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'dono-admin@teste.local');
insert into public.businesses (id, slug, name) values
  ('e0000000-0000-0000-0000-0000000000e1', 'loja-admin', 'Loja Admin');
insert into public.business_members (user_id, business_id) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'e0000000-0000-0000-0000-0000000000e1');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select 'e0000000-0000-0000-0000-0000000000e1', d, 480, 720 from generate_series(0, 6) d;
insert into public.services (id, business_id, name) values
  ('e0000000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-0000000000e1', 'Banho'),
  ('e0000000-0000-0000-0000-0000000000e9', 'e0000000-0000-0000-0000-0000000000e1', 'Servico inativo');
update public.services set is_active = false where id = 'e0000000-0000-0000-0000-0000000000e9';
insert into public.service_options (id, business_id, service_id, size, price_cents, duration_minutes) values
  ('e0000000-0000-0000-0000-0000000000e3', 'e0000000-0000-0000-0000-0000000000e1',
   'e0000000-0000-0000-0000-0000000000e2', 'small', 6000, 45),
  ('e0000000-0000-0000-0000-0000000000e8', 'e0000000-0000-0000-0000-0000000000e1',
   'e0000000-0000-0000-0000-0000000000e9', 'small', 6000, 45);

-- agendamento no PASSADO (so o postgres consegue criar assim) para testar "concluido"/"faltou"
insert into public.bookings (
  id, business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
  service_name, size, price_cents, duration_minutes, customer_name, customer_phone, pet_name, created_by)
values (
  'e0000000-0000-0000-0000-0000000000f1', 'e0000000-0000-0000-0000-0000000000e1',
  'e0000000-0000-0000-0000-0000000000e2', 'e0000000-0000-0000-0000-0000000000e3',
  now() - interval '2 days', now() - interval '2 days' + interval '45 minutes', 10,
  now() - interval '2 days' + interval '55 minutes',
  'Banho', 'small', 6000, 45, 'Cliente Passado', '41999991111', 'Rex', 'admin');

select set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-0000-0000-0000-00000000000e","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := 'e0000000-0000-0000-0000-0000000000e1';
  c_opt constant uuid := 'e0000000-0000-0000-0000-0000000000e3';
  v_date date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  r jsonb; n int;
  v_a uuid; v_b uuid; v_blk uuid;
begin
  ---------------------------------------------------------------- criar (admin)
  r := public.admin_create_booking(c_biz, c_opt, (v_date + time '08:00') at time zone 'America/Sao_Paulo',
        'Ana Costa', '(41) 98888-1111', 'Mel', 'Poodle', 'medo de secador');
  assert (r->>'ok')::boolean, 'admin_create_booking falhou: ' || r::text;
  v_a := (r->>'booking_ref')::uuid;
  r := public.admin_create_booking(c_biz, c_opt, (v_date + time '10:00') at time zone 'America/Sao_Paulo',
        'Bia Lima', '41988882222', 'Thor');
  assert (r->>'ok')::boolean, 'segundo agendamento admin falhou: ' || r::text;
  v_b := (r->>'booking_ref')::uuid;

  -- mesmas regras do publico: conflito, fora da grade, servico inativo
  r := public.admin_create_booking(c_biz, c_opt, (v_date + time '08:30') at time zone 'America/Sao_Paulo',
        'Carlos', '41988883333', 'Bob');
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'admin furou o gap: ' || r::text;
  r := public.admin_create_booking(c_biz, c_opt, (v_date + time '09:10') at time zone 'America/Sao_Paulo',
        'Carlos', '41988883333', 'Bob');
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'admin agendou fora da grade: ' || r::text;
  r := public.admin_create_booking(c_biz, 'e0000000-0000-0000-0000-0000000000e8',
        (v_date + time '11:00') at time zone 'America/Sao_Paulo', 'Carlos', '41988883333', 'Bob');
  assert r->>'error' = 'SERVICE_UNAVAILABLE', 'admin agendou servico inativo: ' || r::text;
  r := public.admin_create_booking(c_biz, c_opt, now() - interval '1 day', 'Carlos', '41988883333', 'Bob');
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'admin agendou no passado: ' || r::text;
  raise notice 'PASS: admin cria agendamentos e as regras de agenda valem para ele tambem';

  ---------------------------------------------------------------- remarcar
  -- 08:00 -> 08:30: sobrepoe o PROPRIO horario antigo, mas isso deve ser permitido
  r := public.admin_reschedule_booking(v_a, (v_date + time '08:30') at time zone 'America/Sao_Paulo');
  assert (r->>'ok')::boolean, 'remarcar sobre o proprio horario falhou: ' || r::text;
  -- para cima do 10:00 de outra pessoa: recusado e nada muda
  r := public.admin_reschedule_booking(v_a, (v_date + time '10:00') at time zone 'America/Sao_Paulo');
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'remarcou para horario ocupado: ' || r::text;
  r := public.admin_reschedule_booking(v_a, (v_date + time '09:10') at time zone 'America/Sao_Paulo');
  assert r->>'error' = 'SLOT_UNAVAILABLE', 'remarcou fora da grade: ' || r::text;
  select count(*) into n from public.bookings
   where id = v_a and starts_at = (v_date + time '08:30') at time zone 'America/Sao_Paulo';
  assert n = 1, 'remarcacao recusada alterou o agendamento';
  raise notice 'PASS: remarcar funciona, inclusive sobre o proprio horario, e recusa conflitos';

  -- a remarcacao mantem o gap snapshot do agendamento, mesmo se a configuracao mudar
  update public.businesses set buffer_minutes = 20 where id = c_biz;
  -- 08:00 com gap snapshot de 10 min continua antes do agendamento das 10:00
  r := public.admin_reschedule_booking(v_a, (v_date + time '08:00') at time zone 'America/Sao_Paulo');
  assert (r->>'ok')::boolean, 'remarcar com novo gap falhou: ' || r::text;
  select count(*) into n from public.bookings where id = v_a and buffer_minutes = 10;
  assert n = 1, 'remarcacao alterou o gap historico';
  raise notice 'PASS: ao remarcar, o gap historico e preservado';

  ---------------------------------------------------------------- editar dados
  r := public.admin_update_booking_details(v_a, 'Ana Costa Souza', '123', 'Mel');
  assert r->>'error' = 'INVALID_INPUT', 'telefone invalido aceito: ' || r::text;
  r := public.admin_update_booking_details(v_a, 'Ana Costa Souza', '+55 (41) 97777-0000', 'Mel II', null, 'novo');
  assert (r->>'ok')::boolean, 'editar dados falhou: ' || r::text;
  select count(*) into n from public.bookings
   where id = v_a and customer_phone = '41977770000' and pet_name = 'Mel II' and pet_breed is null;
  assert n = 1, 'dados nao foram gravados/normalizados como esperado';
  raise notice 'PASS: edicao de dados valida e normaliza o telefone';

  ---------------------------------------------------------------- status
  r := public.admin_set_booking_status(v_a, 'completed');
  assert r->>'error' = 'INVALID_TRANSITION', 'concluiu agendamento futuro: ' || r::text;
  r := public.admin_set_booking_status(v_a, 'banana');
  assert r->>'error' = 'INVALID_INPUT', 'status invalido aceito: ' || r::text;
  r := public.admin_set_booking_status('e0000000-0000-0000-0000-0000000000f1', 'completed');
  assert (r->>'ok')::boolean, 'concluir agendamento passado falhou: ' || r::text;
  r := public.admin_set_booking_status('e0000000-0000-0000-0000-0000000000f1', 'no_show');
  assert (r->>'ok')::boolean, 'completed -> no_show falhou: ' || r::text;
  r := public.admin_set_booking_status('e0000000-0000-0000-0000-0000000000f1', 'confirmed');
  assert (r->>'ok')::boolean, 'reabrir falhou: ' || r::text;
  r := public.admin_set_booking_status(v_b, 'cancelled');
  assert (r->>'ok')::boolean, 'cancelar falhou: ' || r::text;
  select count(*) into n from public.bookings where id = v_b and status = 'cancelled' and cancelled_at is not null;
  assert n = 1, 'cancelled_at nao preenchido';
  r := public.admin_reschedule_booking(v_b, (v_date + time '11:00') at time zone 'America/Sao_Paulo');
  assert r->>'error' = 'INVALID_TRANSITION', 'remarcou agendamento cancelado: ' || r::text;
  raise notice 'PASS: transicoes de status validas e invalidas';

  ---------------------------------------------------------------- bloqueios: criar e apagar
  r := public.admin_create_time_block(c_biz, (v_date + time '11:00') at time zone 'America/Sao_Paulo',
        (v_date + time '12:00') at time zone 'America/Sao_Paulo', 'veterinario');
  assert (r->>'ok')::boolean, 'criar bloqueio falhou: ' || r::text;
  v_blk := (r->>'block_id')::uuid;
  r := public.admin_create_time_block(c_biz, (v_date + time '12:00') at time zone 'America/Sao_Paulo',
        (v_date + time '11:00') at time zone 'America/Sao_Paulo');
  assert r->>'error' = 'INVALID_INPUT', 'bloqueio invertido aceito: ' || r::text;
  r := public.admin_create_time_block(c_biz, now() - interval '3 days', now() - interval '2 days');
  assert r->>'error' = 'INVALID_INPUT', 'bloqueio inteiramente no passado aceito: ' || r::text;

  delete from public.time_blocks where id = v_blk;
  get diagnostics n = row_count;
  assert n = 1, 'admin nao conseguiu apagar o proprio bloqueio';
  raise notice 'PASS: bloqueios criados pela funcao e apagados via RLS';
end $$;

reset role;
rollback;
