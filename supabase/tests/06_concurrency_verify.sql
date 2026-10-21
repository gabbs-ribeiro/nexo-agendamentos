-- =====================================================================
-- TESTE 06 — conferencia do banco DEPOIS de concurrency_test.sh (somente leitura)
-- ESPERADO (com N qualquer, rodando o script uma vez apos o cleanup):
--   consulta 1: exatamente 3 linhas "confirmed" (uma por cenario)
--   consulta 2: 0 linhas (nenhuma sobreposicao entre agendamentos ativos)
--   consulta 3: 1 linha por cenario com contagem 1 (nenhuma chave duplicada)
-- =====================================================================

-- 1) agendamentos criados no negocio de teste
select starts_at at time zone 'America/Sao_Paulo' as inicio_local,
       ends_at at time zone 'America/Sao_Paulo'   as fim_servico_local,
       occupied_ends_at at time zone 'America/Sao_Paulo' as fim_com_gap_local,
       status, customer_phone
  from public.bookings
 where business_id = 'c0000000-0000-0000-0000-0000000000c1'
 order by starts_at;

-- 2) sobreposicoes (DEVE vir vazio)
select a.id as a, b.id as b,
       a.starts_at at time zone 'America/Sao_Paulo' as a_inicio,
       b.starts_at at time zone 'America/Sao_Paulo' as b_inicio
  from public.bookings a
  join public.bookings b
    on a.business_id = b.business_id and a.id < b.id
   and a.status <> 'cancelled' and b.status <> 'cancelled'
   and tstzrange(a.starts_at, a.occupied_ends_at, '[)') && tstzrange(b.starts_at, b.occupied_ends_at, '[)')
 where a.business_id = 'c0000000-0000-0000-0000-0000000000c1';

-- 3) chaves de idempotencia repetidas (DEVE vir sem linhas com count > 1)
select idempotency_key, count(*) as qtd
  from public.bookings
 where business_id = 'c0000000-0000-0000-0000-0000000000c1'
 group by idempotency_key
having count(*) > 1;
