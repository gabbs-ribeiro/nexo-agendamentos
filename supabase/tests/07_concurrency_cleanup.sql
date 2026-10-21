-- =====================================================================
-- TESTE 07 — limpeza do negocio de teste de concorrencia (SOMENTE DEV)
-- Apaga os agendamentos criados pelo concurrency_test.sh. Para remover
-- tambem o negocio de teste, descomente o bloco final.
-- =====================================================================
delete from public.bookings    where business_id = 'c0000000-0000-0000-0000-0000000000c1';
delete from public.time_blocks where business_id = 'c0000000-0000-0000-0000-0000000000c1';

-- Remocao completa do negocio de teste (opcional):
-- delete from public.service_options where business_id = 'c0000000-0000-0000-0000-0000000000c1';
-- delete from public.services        where business_id = 'c0000000-0000-0000-0000-0000000000c1';
-- delete from public.business_hours  where business_id = 'c0000000-0000-0000-0000-0000000000c1';
-- delete from public.businesses      where id          = 'c0000000-0000-0000-0000-0000000000c1';
