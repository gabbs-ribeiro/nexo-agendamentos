-- TESTE 09 — perfil do negocio, servicos com descricao e portes configuraveis.
-- Rodar SOMENTE em DEV apos 20261021000002_admin_control_catalog.sql.
-- Transacao com ROLLBACK; esperado: PASS e nenhuma excecao.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000007', 'dono-catalogo@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000007', 'loja-catalogo', 'Loja Catalogo');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000007');
insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select '70000000-0000-0000-0000-000000000007', d, 480, 720 from generate_series(0, 6) d;

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000007","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000007';
  v_date date := ((now() at time zone 'America/Sao_Paulo')::date) + 3;
  v_service uuid;
  v_option uuid;
  v_booking uuid;
  v_result jsonb;
  v_count int;
begin
  select count(*) into v_count from public.business_sizes where business_id = c_biz;
  assert v_count = 3, 'novo negocio nao recebeu os portes padrao';

  insert into public.business_sizes (business_id, code, name, sort_order)
    values (c_biz, 'extra-grande-test09', 'Extra grande', 3);
  insert into public.services (business_id, name, description)
    values (c_biz, 'Banho especial', 'Banho para pets de porte extra grande')
    returning id into v_service;
  insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values (c_biz, v_service, 'extra-grande-test09', 15500, 90)
    returning id into v_option;

  v_result := public.admin_create_booking(
    c_biz, v_option, (v_date + time '08:00') at time zone 'America/Sao_Paulo',
    'Ana Costa', '41999990001', 'Rex');
  assert (v_result->>'ok')::boolean, 'agendamento para porte customizado falhou: ' || v_result::text;
  v_booking := (v_result->>'booking_ref')::uuid;
  assert v_result->>'size_label' = 'Extra grande', 'reserva nao devolveu o rotulo do porte';
  assert v_result->>'price_cents' = '15500', 'preco customizado nao foi registrado';
  assert v_result->>'ends_at' is not null, 'reserva nao devolveu horario final';

  update public.business_sizes set name = 'Gigante' where business_id = c_biz and code = 'extra-grande-test09';
  select count(*) into v_count from public.bookings
   where id = v_booking and size = 'extra-grande-test09'
     and size_label = 'Extra grande' and duration_minutes = 90
     and ends_at = starts_at + interval '90 minutes' and price_cents = 15500;
  assert v_count = 1, 'editar nome do porte alterou snapshot do agendamento';

  select count(*) into v_count
    from jsonb_array_elements(public.list_public_services('loja-catalogo')) svc
    cross join lateral jsonb_array_elements(svc->'options') opt
   where svc->>'description' = 'Banho para pets de porte extra grande'
     and opt->>'size_label' = 'Gigante';
  assert v_count = 1, 'catalogo publico nao exibiu descricao ou rotulo atualizado';

  select count(*) into v_count from public.get_available_slots(
    'loja-catalogo', v_option, v_date) slots
   where slots.starts_at = (v_date + time '10:00') at time zone 'America/Sao_Paulo';
  assert v_count = 1, 'opcao ativa nao apareceu na disponibilidade';

  update public.business_sizes set is_active = false
   where business_id = c_biz and code = 'extra-grande-test09';
  select count(*) into v_count from public.get_available_slots(
    'loja-catalogo', v_option, v_date);
  assert v_count = 0, 'porte desativado continuou disponivel para novas reservas';

  update public.businesses set name = 'Loja Atualizada', logo_path = c_biz::text || '/logo.png'
   where id = c_biz;
  select count(*) into v_count from public.businesses
   where id = c_biz and name = 'Loja Atualizada' and logo_path = c_biz::text || '/logo.png';
  assert v_count = 1, 'perfil publico nao pode ser editado';
  v_result := public.get_public_business('loja-catalogo');
  assert v_result->>'name' = 'Loja Atualizada'
     and v_result->>'logo_path' = c_biz::text || '/logo.png',
    'perfil atualizado nao apareceu na pagina publica';
  raise notice 'PASS: perfil, descricoes, catalogo customizado, disponibilidade e snapshots';
end $$;

reset role;
rollback;
