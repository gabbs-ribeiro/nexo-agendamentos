-- =====================================================================
-- TESTE 05 — preparacao do teste de concorrencia (SOMENTE DEV)
-- Cria (ou recria, de forma idempotente) um negocio de teste PERMANENTE:
--   slug: loja-concorrencia | aberto todos os dias 08:00-12:00 (America/Sao_Paulo)
--   grade 30 min, gap 10 min | servico "Banho teste" de 45 min
-- Depois rode: tests/concurrency_test.sh  ->  06_concurrency_verify.sql  ->  07_concurrency_cleanup.sql
-- NAO rode em producao.
-- =====================================================================

insert into public.businesses (id, slug, name, buffer_minutes, slot_step_minutes, min_notice_minutes, max_days_ahead)
values ('c0000000-0000-0000-0000-0000000000c1', 'loja-concorrencia', 'Loja Teste Concorrencia', 10, 30, 120, 30)
on conflict (id) do nothing;

insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
select 'c0000000-0000-0000-0000-0000000000c1', d, 480, 720
  from generate_series(0, 6) d
 where not exists (
   select 1 from public.business_hours h
    where h.business_id = 'c0000000-0000-0000-0000-0000000000c1' and h.day_of_week = d);

insert into public.services (id, business_id, name)
values ('c0000000-0000-0000-0000-0000000000c2', 'c0000000-0000-0000-0000-0000000000c1', 'Banho teste')
on conflict (id) do nothing;

insert into public.service_options (id, business_id, service_id, size, price_cents, duration_minutes)
values ('c0000000-0000-0000-0000-0000000000c3', 'c0000000-0000-0000-0000-0000000000c1',
        'c0000000-0000-0000-0000-0000000000c2', 'small', 5000, 45)
on conflict (id) do nothing;

-- Conferencia: deve listar 1 servico com 1 opcao de 45 min
select public.list_public_services('loja-concorrencia');
