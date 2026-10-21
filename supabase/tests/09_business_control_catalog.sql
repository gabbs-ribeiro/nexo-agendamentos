-- TESTE 09 — perfil do negocio, servicos com descricao e portes configuraveis.
-- Rodar SOMENTE em DEV apos 20261021000004_service_categories.sql.
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
  v_category uuid;
  v_bath_category uuid;
  v_result jsonb;
  v_count int;
begin
  select count(*) into v_count from public.business_sizes where business_id = c_biz;
  assert v_count = 3, 'novo negocio nao recebeu os portes padrao';

  select count(*) into v_count from public.service_categories where business_id = c_biz;
  assert v_count = 2, 'novo negocio nao recebeu as categorias padrao';
  insert into public.service_categories (business_id, name, description, sort_order)
    values (c_biz, 'Servicos especiais', 'Categoria para testar o catalogo.', 2)
    returning id into v_category;

  insert into public.business_sizes (business_id, code, name, sort_order)
    values (c_biz, 'extra-grande-test09', 'Extra grande', 3);
  insert into public.services (business_id, category_id, name, description)
    values (c_biz, v_category, 'Banho especial', 'Banho para pets de porte extra grande')
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

  update public.service_categories
     set name = 'Pet Hotel e creche', description = 'Atendimento e cuidado para o pet.'
   where id = v_category and business_id = c_biz;
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

  v_result := public.list_public_service_categories('loja-catalogo');
  select count(*) into v_count
    from jsonb_array_elements(v_result) category
   where category->>'category_id' = v_category::text
     and category->>'name' = 'Pet Hotel e creche'
     and category->>'description' = 'Atendimento e cuidado para o pet.'
     and jsonb_array_length(category->'services') = 1
     and category->'services'->0->>'name' = 'Banho especial';
  assert v_count = 1, 'categoria editada ou servico associado nao apareceu no catalogo publico';
  select count(*) into v_count
    from jsonb_array_elements(v_result) category
   where category->>'name' = 'Banho e tosa'
     and jsonb_array_length(category->'services') = 0;
  assert v_count = 1, 'categoria vazia nao foi preservada no catalogo publico';

  select id into v_bath_category from public.service_categories
   where business_id = c_biz and name = 'Banho e tosa';
  update public.services set category_id = v_bath_category
   where business_id = c_biz and id = v_service;
  select count(*) into v_count from public.bookings
   where id = v_booking and service_name = 'Banho especial'
     and size_label = 'Extra grande' and duration_minutes = 90
     and ends_at = starts_at + interval '90 minutes' and price_cents = 15500;
  assert v_count = 1, 'mover o servico entre categorias alterou o snapshot do agendamento';

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
