-- TESTE 14 — exclusão segura de categorias e reativação de serviços arquivados.
-- Rodar SOMENTE em DEV após a migration 20261023000002.
-- Transação com ROLLBACK; esperado: PASS e nenhuma exceção.
begin;

insert into auth.users (id, email) values
  ('77777777-0000-0000-0000-000000000015', 'catalog-controls@teste.local');
insert into public.businesses (id, slug, name) values
  ('70000000-0000-0000-0000-000000000015', 'loja-controle-catalogo', 'Loja Controle Catálogo');
insert into public.business_members (user_id, business_id) values
  ('77777777-0000-0000-0000-000000000015', '70000000-0000-0000-0000-000000000015');

select set_config('request.jwt.claims',
  '{"sub":"77777777-0000-0000-0000-000000000015","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  c_biz constant uuid := '70000000-0000-0000-0000-000000000015';
  v_category uuid;
  v_empty_category uuid;
  v_service uuid;
  v_result jsonb;
begin
  select id into v_category from public.service_categories
   where business_id = c_biz order by sort_order limit 1;
  assert v_category is not null, 'negócio de teste precisa de categoria inicial';

  insert into public.services (business_id, category_id, name)
    values (c_biz, v_category, 'Serviço vinculado') returning id into v_service;
  v_result := public.admin_delete_service_category(v_category);
  assert v_result->>'error' = 'CATEGORY_HAS_SERVICES',
    'categoria com serviço vinculado não deve ser excluída: ' || v_result::text;

  insert into public.service_categories (business_id, name, description)
    values (c_biz, 'Categoria vazia', '') returning id into v_empty_category;
  v_result := public.admin_delete_service_category(v_empty_category);
  assert (v_result->>'ok')::boolean,
    'categoria vazia deve poder ser excluída pelo membro: ' || v_result::text;
  assert not exists (
    select 1 from public.service_categories where business_id = c_biz and id = v_empty_category
  ), 'categoria sem serviços deve poder ser excluída pelo membro';

  update public.services
     set is_active = false, archived_at = now()
   where business_id = c_biz and id = v_service;
  update public.services
     set is_active = true, archived_at = null
   where business_id = c_biz and id = v_service;
  assert exists (
    select 1 from public.services
     where business_id = c_biz and id = v_service
       and is_active and archived_at is null
  ), 'serviço arquivado deve poder ser reativado pelo membro';

  raise notice 'PASS: categoria vinculada protegida, categoria vazia removida e serviço reativado';
end;
$$;

rollback;
