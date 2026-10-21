-- =====================================================================
-- Provisionamento MANUAL de um negocio (decisao D5: cadastro livre desativado)
-- Rodar no SQL Editor (como postgres) DEPOIS de:
--   1) criar o usuario no painel: Authentication > Users > Add user (e-mail + senha forte);
--   2) conferir que "Allow new users to sign up" esta DESLIGADO em Authentication > Providers/Settings.
-- Preencha os 3 valores marcados com PREENCHER. Nao commite este arquivo preenchido.
-- =====================================================================
do $$
declare
  v_email text := 'PREENCHER_email_do_responsavel@exemplo.com';
  v_slug  text := 'PREENCHER-slug-do-negocio';      -- minusculas, numeros e hifens (3 a 40)
  v_name  text := 'PREENCHER Nome publico do negocio';

  v_user uuid;
  v_biz  uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(v_email);
  if v_user is null then
    raise exception 'Usuario % nao encontrado em auth.users. Crie-o primeiro no painel.', v_email;
  end if;

  insert into public.businesses (slug, name)
  values (v_slug, v_name)
  returning id into v_biz;

  insert into public.business_members (user_id, business_id, role)
  values (v_user, v_biz, 'owner');

  -- Horarios de EXEMPLO (seg a sex, 08-12 e 14-18). A responsavel ajusta pelo app.
  insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
  select v_biz, d, h.o, h.c
    from generate_series(1, 5) d
   cross join (values (480, 720), (840, 1080)) h(o, c);

  -- Servicos iniciais SEM portes: so aparecem para o cliente depois que a responsavel
  -- cadastrar ao menos um porte (preco e duracao) em cada um, pelo app.
  insert into public.services (business_id, name) values
    (v_biz, 'Banho'),
    (v_biz, 'Banho + Tosa');

  raise notice 'Negocio criado: id=% slug=% (pagina publica: /%)', v_biz, v_slug, v_slug;
end $$;

-- ---------------------------------------------------------------------
-- Manutencao (exemplos; rodar so com cuidado, de preferencia apos exportar um backup)
-- ---------------------------------------------------------------------

-- LGPD: anonimizar dados pessoais de um telefone (preserva o historico financeiro/agenda):
-- update public.bookings
--    set customer_name = 'Removido', customer_phone = '0000000000', pet_name = 'Removido',
--        pet_breed = null, notes = null
--  where business_id = '<BUSINESS_ID>' and customer_phone = '<TELEFONE_NORMALIZADO>';

-- Desativar a pagina publica de um negocio (o painel continua funcionando):
-- update public.businesses set is_active = false where slug = '<SLUG>';
