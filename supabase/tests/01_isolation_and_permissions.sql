-- =====================================================================
-- TESTE 01 — isolamento entre negocios e permissoes por papel
-- Rodar SOMENTE no projeto de DEV, no SQL Editor (como postgres), DEPOIS das migrations.
-- Tudo roda dentro de uma transacao e termina em ROLLBACK: nao deixa dados.
-- Resultado esperado: varias mensagens "PASS" e nenhuma excecao.
-- Qualquer "FAIL" ou ASSERTION FAILED = problema de seguranca a corrigir ANTES do uso real.
-- =====================================================================
begin;

-- ---------- preparacao (como postgres, ignora RLS) ----------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'user-a@teste.local'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'user-b@teste.local'),
  ('cccccccc-0000-0000-0000-00000000000c', 'user-c-sem-negocio@teste.local');

insert into public.businesses (id, slug, name) values
  ('a0000000-0000-0000-0000-0000000000a1', 'loja-a', 'Loja A'),
  ('b0000000-0000-0000-0000-0000000000b1', 'loja-b', 'Loja B');

insert into public.business_members (user_id, business_id) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-0000000000a1'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-0000000000b1');

insert into public.services (id, business_id, name, is_active) values
  ('a0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-0000000000a1', 'Banho A', true),
  ('a0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-0000000000a1', 'Servico inativo A', false),
  ('b0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-0000000000b1', 'Banho B', true);

insert into public.service_options (id, business_id, service_id, size, price_cents, duration_minutes) values
  ('a0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a2', 'small', 5000, 45),
  ('a0000000-0000-0000-0000-0000000000a5', 'a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a3', 'small', 5000, 45),
  ('b0000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b2', 'small', 7000, 60);

insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
select 'b0000000-0000-0000-0000-0000000000b1', d, 480, 720 from generate_series(0, 6) d;

insert into public.bookings (
  id, business_id, service_id, service_option_id, starts_at, ends_at, buffer_minutes, occupied_ends_at,
  service_name, size, price_cents, duration_minutes,
  customer_name, customer_phone, pet_name, created_by)
values (
  'b0000000-0000-0000-0000-0000000000b5',
  'b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b2',
  'b0000000-0000-0000-0000-0000000000b4',
  now() + interval '5 days', now() + interval '5 days 60 minutes', 10, now() + interval '5 days 70 minutes',
  'Banho B', 'small', 7000, 60,
  'Cliente Secreto de B', '41988887777', 'Rex', 'admin');

insert into public.time_blocks (id, business_id, starts_at, ends_at, reason) values
  ('b0000000-0000-0000-0000-0000000000b6', 'b0000000-0000-0000-0000-0000000000b1',
   now() + interval '6 days', now() + interval '6 days 2 hours', 'bloqueio de B');

-- ---------- USUARIO A (dono da Loja A) ----------
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n int; r jsonb;
begin
  -- leitura: so enxerga o que e seu
  select count(*) into n from public.businesses;
  assert n = 1, 'A deveria ver 1 negocio, viu ' || n;
  select count(*) into n from public.services;
  assert n = 2, 'A deveria ver 2 servicos (ativo e inativo dele), viu ' || n;
  select count(*) into n from public.services where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  assert n = 0, 'A enxergou servicos de B';
  select count(*) into n from public.service_options where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  assert n = 0, 'A enxergou opcoes de B';
  select count(*) into n from public.business_sizes;
  assert n = 3, 'A deveria ver os 3 portes de A, viu ' || n;
  select count(*) into n from public.business_sizes where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  assert n = 0, 'A enxergou portes de B';
  select count(*) into n from public.service_categories;
  assert n = 2, 'A deveria ver apenas as categorias da Loja A, viu ' || n;
  select count(*) into n from public.service_categories where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  assert n = 0, 'A enxergou categorias de B';
  select count(*) into n from public.business_hours where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  assert n = 0, 'A enxergou horarios de B';
  select count(*) into n from public.bookings;
  assert n = 0, 'A enxergou agendamentos (dados de clientes) de B';
  select count(*) into n from public.time_blocks;
  assert n = 0, 'A enxergou bloqueios de B';
  select count(*) into n from public.business_members;
  assert n = 1, 'A deveria ver so o proprio vinculo';
  raise notice 'PASS: A so le dados da Loja A';

  -- UPDATE/DELETE em linhas de B: afeta 0 linhas
  update public.services set name = 'invadido' where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A conseguiu alterar servico de B';
  update public.businesses set name = 'invadido' where id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A conseguiu alterar o negocio B';
  update public.business_sizes set name = 'invadido' where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A conseguiu alterar portes de B';
  update public.service_categories set name = 'invadido' where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A conseguiu alterar categorias de B';
  delete from public.time_blocks where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A conseguiu apagar bloqueio de B';
  delete from public.business_hours where business_id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A conseguiu apagar horario de B';
  raise notice 'PASS: A nao altera/apaga dados de B';

  -- escritas permitidas no proprio negocio
  update public.businesses set name = 'Loja A Renomeada', buffer_minutes = 15
   where id = 'a0000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  assert n = 1, 'A deveria poder editar a propria configuracao';
  insert into public.services (business_id, name) values ('a0000000-0000-0000-0000-0000000000a1', 'Tosa A');
  raise notice 'PASS: A edita o proprio negocio e cria servicos';

  -- telefone de contato: valido passa; invalido e recusado; em negocio alheio afeta 0 linhas
  update public.businesses set contact_phone = '41999990001' where id = 'a0000000-0000-0000-0000-0000000000a1';
  get diagnostics n = row_count;
  assert n = 1, 'A deveria poder definir o proprio telefone de contato';
  begin
    update public.businesses set contact_phone = '123' where id = 'a0000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: telefone de contato invalido aceito';
  exception when check_violation then
    raise notice 'PASS: telefone de contato invalido recusado';
  end;
  update public.businesses set contact_phone = '41900000000' where id = 'b0000000-0000-0000-0000-0000000000b1';
  get diagnostics n = row_count;
  assert n = 0, 'A alterou o telefone de contato de B';

  -- INSERT em negocio alheio: bloqueado pela RLS (WITH CHECK)
  begin
    insert into public.services (business_id, name) values ('b0000000-0000-0000-0000-0000000000b1', 'Servico plantado');
    raise exception 'FAIL: A criou servico dentro de B';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT de servico em B bloqueado';
  end;

  begin
    insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
    values ('b0000000-0000-0000-0000-0000000000b1', 1, 60, 120);
    raise exception 'FAIL: A criou horario dentro de B';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT de horario em B bloqueado';
  end;

  begin
    insert into public.business_sizes (business_id, code, name, sort_order)
    values ('b0000000-0000-0000-0000-0000000000b1', 'custom-size', 'Porte de B', 4);
    raise exception 'FAIL: A criou porte dentro de B';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT de porte em B bloqueado';
  end;

  begin
    insert into public.service_categories (business_id, name)
    values ('b0000000-0000-0000-0000-0000000000b1', 'Categoria de B');
    raise exception 'FAIL: A criou categoria dentro de B';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT de categoria em B bloqueado';
  end;

  -- Opcao de A apontando para servico de B: bloqueada (RLS e/ou FK composta)
  begin
    insert into public.service_options (business_id, service_id, size, price_cents, duration_minutes)
    values ('a0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000b2', 'large', 1, 30);
    raise exception 'FAIL: opcao cruzada entre negocios foi aceita';
  exception when foreign_key_violation then
    raise notice 'PASS: FK composta barra opcao cruzada';
  end;

  -- mover linha para outro negocio (UPDATE business_id): coluna sem privilegio
  begin
    update public.services set business_id = 'b0000000-0000-0000-0000-0000000000b1'
     where business_id = 'a0000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: A moveu servico para B';
  exception when insufficient_privilege then
    raise notice 'PASS: business_id nao pode ser alterado';
  end;

  -- colunas protegidas do negocio (slug, timezone, is_active)
  begin
    update public.businesses set slug = 'novo-slug' where id = 'a0000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: A alterou o slug';
  exception when insufficient_privilege then
    raise notice 'PASS: slug protegido';
  end;
  begin
    update public.businesses set is_active = false where id = 'a0000000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: A alterou is_active';
  exception when insufficient_privilege then
    raise notice 'PASS: is_active protegido';
  end;

  -- bookings e time_blocks: sem escrita direta
  begin
    insert into public.bookings (business_id) values ('a0000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL: INSERT direto em bookings permitido';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT direto em bookings bloqueado';
  end;
  begin
    update public.bookings set status = 'cancelled';
    raise exception 'FAIL: UPDATE direto em bookings permitido';
  exception when insufficient_privilege then
    raise notice 'PASS: UPDATE direto em bookings bloqueado';
  end;
  begin
    insert into public.time_blocks (business_id, starts_at, ends_at)
    values ('a0000000-0000-0000-0000-0000000000a1', now() + interval '1 day', now() + interval '2 days');
    raise exception 'FAIL: INSERT direto em time_blocks permitido';
  exception when insufficient_privilege then
    raise notice 'PASS: INSERT direto em time_blocks bloqueado';
  end;
  begin
    insert into public.business_members (user_id, business_id)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-0000000000b1');
    raise exception 'FAIL: A se auto-vinculou a B';
  exception when insufficient_privilege then
    raise notice 'PASS: ninguem escreve em business_members pela API';
  end;

  -- funcoes admin com negocio/registro de B
  begin
    perform public.admin_create_booking(
      'b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b4',
      now() + interval '3 days', 'Invasor', '41999990000', 'Pet');
    raise exception 'FAIL: A criou agendamento em B';
  exception when insufficient_privilege then
    raise notice 'PASS: admin_create_booking em B => FORBIDDEN';
  end;
  begin
    perform public.admin_create_time_block(
      'b0000000-0000-0000-0000-0000000000b1', now() + interval '3 days', now() + interval '4 days');
    raise exception 'FAIL: A criou bloqueio em B';
  exception when insufficient_privilege then
    raise notice 'PASS: admin_create_time_block em B => FORBIDDEN';
  end;
  r := public.admin_set_booking_status('b0000000-0000-0000-0000-0000000000b5', 'cancelled');
  assert r->>'error' = 'NOT_FOUND', 'cancelar agendamento de B deveria dar NOT_FOUND: ' || r::text;
  r := public.admin_reschedule_booking('b0000000-0000-0000-0000-0000000000b5', now() + interval '3 days');
  assert r->>'error' = 'NOT_FOUND', 'remarcar agendamento de B deveria dar NOT_FOUND';
  r := public.admin_update_booking_details('b0000000-0000-0000-0000-0000000000b5', 'Hack', '41999990000', 'Pet');
  assert r->>'error' = 'NOT_FOUND', 'editar dados de cliente de B deveria dar NOT_FOUND';
  raise notice 'PASS: funcoes admin sobre registros de B => NOT_FOUND';

  -- funcoes internas nao sao acessiveis
  begin
    perform app_private.compute_slots('a0000000-0000-0000-0000-0000000000a1', 45, current_date);
    raise exception 'FAIL: app_private acessivel para authenticated';
  exception when insufficient_privilege then
    raise notice 'PASS: app_private inacessivel';
  end;
end $$;

reset role;
do $$
begin
  assert (select status from public.bookings where id = 'b0000000-0000-0000-0000-0000000000b5') = 'confirmed',
    'agendamento de B foi alterado por A';
  assert (select name from public.businesses where id = 'b0000000-0000-0000-0000-0000000000b1') = 'Loja B',
    'negocio B foi alterado por A';
  raise notice 'PASS: dados de B intactos apos todas as tentativas de A';
end $$;

-- ---------- USUARIO C (autenticado, sem negocio nenhum) ----------
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.businesses;       assert n = 0, 'C viu negocios';
  select count(*) into n from public.services;         assert n = 0, 'C viu servicos';
  select count(*) into n from public.service_options;  assert n = 0, 'C viu opcoes';
  select count(*) into n from public.business_hours;   assert n = 0, 'C viu horarios';
  select count(*) into n from public.time_blocks;      assert n = 0, 'C viu bloqueios';
  select count(*) into n from public.bookings;         assert n = 0, 'C viu agendamentos';
  select count(*) into n from public.business_members; assert n = 0, 'C viu vinculos';
  select count(*) into n from public.business_sizes;   assert n = 0, 'C viu portes';
  begin
    perform public.admin_create_time_block(
      'a0000000-0000-0000-0000-0000000000a1', now() + interval '3 days', now() + interval '4 days');
    raise exception 'FAIL: C criou bloqueio';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: usuario autenticado sem vinculo ve ZERO linhas e nao administra nada';
end $$;
reset role;

-- ---------- ANON (cliente publico) ----------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare r jsonb;
begin
  begin perform 1 from public.businesses;       raise exception 'FAIL: anon leu businesses';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.services;         raise exception 'FAIL: anon leu services';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.service_options;  raise exception 'FAIL: anon leu service_options';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.business_hours;   raise exception 'FAIL: anon leu business_hours';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.time_blocks;      raise exception 'FAIL: anon leu time_blocks';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.bookings;         raise exception 'FAIL: anon leu bookings';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.business_members; raise exception 'FAIL: anon leu business_members';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.business_sizes;   raise exception 'FAIL: anon leu business_sizes';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.service_categories; raise exception 'FAIL: anon leu service_categories';
  exception when insufficient_privilege then null; end;
  begin insert into public.bookings (business_id) values ('a0000000-0000-0000-0000-0000000000a1');
        raise exception 'FAIL: anon inseriu em bookings';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: anon sem acesso direto a nenhuma tabela';

  begin
    perform public.admin_create_time_block(
      'a0000000-0000-0000-0000-0000000000a1', now() + interval '3 days', now() + interval '4 days');
    raise exception 'FAIL: anon executou funcao admin';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_set_booking_status('b0000000-0000-0000-0000-0000000000b5', 'cancelled');
        raise exception 'FAIL: anon cancelou agendamento';
  exception when insufficient_privilege then null; end;
  begin perform app_private.compute_slots('a0000000-0000-0000-0000-0000000000a1', 45, current_date);
        raise exception 'FAIL: anon acessou app_private';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS: anon nao executa funcoes admin nem internas';

  -- funcoes publicas: so o minimo
  r := public.get_public_business('loja-b');
  assert r is not null, 'get_public_business deveria achar loja-b';
  assert not (r ? 'id') and not (r ? 'is_active') and not (r ? 'buffer_minutes'),
    'resposta publica expoe campo interno: ' || r::text;
  assert r ? 'contact_phone', 'resposta publica deveria incluir contact_phone (pode ser null)';
  assert public.get_public_business('nao-existe') is null, 'slug inexistente deveria retornar null';

  r := public.list_public_services('loja-a');
  assert jsonb_array_length(r) = 1, 'anon deveria ver so servicos ATIVOS de A: ' || r::text;
  assert r::text not like '%Servico inativo A%', 'servico inativo vazou';
  assert r::text not like '%Banho B%', 'servico de outro negocio vazou';
  r := public.list_public_service_categories('loja-a');
  assert jsonb_array_length(r) = 2, 'categorias publicas de A nao foram listadas: ' || r::text;
  assert r::text like '%Banho A%' and r::text not like '%Banho B%',
    'categorias publicas vazaram servicos de outro negocio: ' || r::text;
  raise notice 'PASS: funcoes publicas expoem apenas o necessario';
end $$;
reset role;

rollback;
