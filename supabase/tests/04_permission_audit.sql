-- =====================================================================
-- TESTE 04 — auditoria de permissoes (SOMENTE LEITURA; nao altera nada)
-- Rodar no DEV depois das migrations, e de novo antes de qualquer uso real
-- e depois de QUALQUER migration nova.
-- ESPERADO: o resultado da consulta abaixo vem VAZIO (0 linhas).
-- Cada linha devolvida e um problema a corrigir antes de seguir.
-- =====================================================================

with
-- funcoes que o cliente publico (anon) pode executar
allowed_anon(fn) as (values
  ('get_public_business'), ('list_public_services'),
  ('list_public_service_categories'), ('get_available_slots'), ('create_public_booking')),
-- funcoes que usuarios logados podem executar (as publicas + admin)
allowed_auth(fn) as (values
  ('get_public_business'), ('list_public_services'),
  ('list_public_service_categories'), ('get_available_slots'), ('create_public_booking'),
  ('admin_create_booking'), ('admin_set_booking_status'),
  ('admin_reschedule_booking'), ('admin_update_booking_details'),
  ('admin_create_time_block'), ('admin_update_booking_internal_notes'),
  ('admin_replace_business_hours')),
-- privilegios que authenticated NAO pode ter (decisoes de arquitetura)
forbidden_auth(tbl, priv) as (values
  ('bookings','insert'), ('bookings','update'), ('bookings','delete'), ('bookings','truncate'),
  ('time_blocks','insert'), ('time_blocks','update'), ('time_blocks','truncate'),
  ('business_members','insert'), ('business_members','update'), ('business_members','delete'),
  ('businesses','insert'), ('businesses','delete'),
  ('services','delete'), ('service_options','delete'), ('service_categories','delete'))
select * from (

  -- 1) tabela sem RLS
  select 'tabela sem RLS'::text as problema, c.relname::text as detalhe
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity

  union all
  -- 2) anon com QUALQUER privilegio em tabela/view/sequencia de public
  select 'anon tem privilegio em tabela', c.relname || ' (' || p.priv || ')'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('select'),('insert'),('update'),('references')) p(priv)
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
     and has_any_column_privilege('anon', c.oid, p.priv)
  union all
  select 'anon tem privilegio de tabela', c.relname || ' (' || p.priv || ')'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('delete'),('truncate'),('trigger')) p(priv)
   where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
     and has_table_privilege('anon', c.oid, p.priv)

  union all
  -- 3) authenticated com privilegio que a arquitetura proibe
  select 'authenticated com privilegio proibido', f.tbl || ' (' || f.priv || ')'
    from forbidden_auth f
   where case when f.priv in ('insert','update')
              then has_any_column_privilege('authenticated', ('public.' || f.tbl)::regclass, f.priv)
              else has_table_privilege('authenticated', ('public.' || f.tbl)::regclass, f.priv) end

  union all
  -- 4) PUBLIC (todo mundo) com acesso a tabelas
  select 'PUBLIC tem privilegio em tabela', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p','v','m')
     and exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0)

  union all
  -- 5) anon executando funcao fora da lista permitida (public e app_private)
  select 'anon executa funcao nao permitida', p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app_private')
     and has_function_privilege('anon', p.oid, 'execute')
     and (n.nspname = 'app_private' or p.proname not in (select fn from allowed_anon))

  union all
  -- 6) authenticated executando funcao fora da lista permitida
  select 'authenticated executa funcao nao permitida', p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app_private')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and (n.nspname = 'app_private' or p.proname not in (select fn from allowed_auth))

  union all
  -- 7) funcao admin acessivel ao anon (redundante com 5, mas explicita)
  select 'funcao admin executavel por anon', p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%'
     and has_function_privilege('anon', p.oid, 'execute')

  union all
  -- 8) SECURITY DEFINER sem search_path fixo (risco de sequestro de funcao)
  select 'security definer sem search_path fixo', p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app_private') and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))

  union all
  -- 9) schema interno acessivel por anon/authenticated
  select 'schema app_private acessivel', r.rolname
    from pg_roles r
   where r.rolname in ('anon','authenticated')
     and has_schema_privilege(r.rolname, 'app_private', 'usage')

  union all
  -- 10) views em public (ignoram RLS por padrao): nao esperamos nenhuma
  select 'view em public (confirmar security_invoker)', c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v','m')

  union all
  -- 11) policies concedidas a PUBLIC ou anon (esperado: nenhuma em tabelas de public)
  select 'policy para anon/public', pol.tablename || '.' || pol.policyname
    from pg_policies pol
   where pol.schemaname = 'public'
     and (pol.roles::text like '%anon%' or pol.roles::text like '%public%')

  union all
  -- 12) bucket de logos fora da configuracao esperada
  select 'bucket de logos fora do esperado', b.id
    from storage.buckets b
   where b.id = 'business-logos'
     and (b.file_size_limit is distinct from 1048576
          or b.allowed_mime_types is distinct from array['image/png','image/jpeg','image/webp'])

  union all
  -- 13) INTEGRIDADE DE DADOS (tambem serve como verificacao periodica em producao):
  --     agendamentos ativos sobrepostos (nunca deve acontecer)
  select 'AGENDAMENTOS SOBREPOSTOS', a.id::text || ' x ' || b.id::text
    from public.bookings a
    join public.bookings b
      on a.business_id = b.business_id and a.id < b.id
     and a.status <> 'cancelled' and b.status <> 'cancelled'
     and tstzrange(a.starts_at, a.occupied_ends_at, '[)') && tstzrange(b.starts_at, b.occupied_ends_at, '[)')

  union all
  --     agendamento ativo que invade bloqueio
  select 'AGENDAMENTO DENTRO DE BLOQUEIO', k.id::text || ' x ' || t.id::text
    from public.bookings k
    join public.time_blocks t
      on t.business_id = k.business_id and t.starts_at < k.ends_at and t.ends_at > k.starts_at
   where k.status <> 'cancelled'

) problemas
order by 1, 2;

-- ---------------------------------------------------------------------
-- Informativo (nao e erro): o que authenticated pode fazer em cada tabela.
-- Confira se bate com a tabela do README.
-- ---------------------------------------------------------------------
select c.relname as tabela,
       has_any_column_privilege('authenticated', c.oid, 'select') as select_,
       has_any_column_privilege('authenticated', c.oid, 'insert') as insert_,
       has_any_column_privilege('authenticated', c.oid, 'update') as update_,
       has_table_privilege('authenticated', c.oid, 'delete')      as delete_,
       c.relrowsecurity                                           as rls_ligada
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p')
 order by 1;
