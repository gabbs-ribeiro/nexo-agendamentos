-- =====================================================================
-- 007: telefone de contato do estabelecimento (WhatsApp)
-- Motivo: o cliente precisa de um canal para remarcar/cancelar (nao ha cancelamento pelo
-- cliente no MVP). Campo opcional, publico por natureza (aparece na pagina do negocio).
-- Aditiva e reversivel; nao altera dados existentes.
-- =====================================================================

alter table public.businesses add column contact_phone text;

-- Telefone nacional com DDD, somente digitos (10 ou 11), igual ao padrao dos clientes.
alter table public.businesses add constraint businesses_contact_phone
  check (contact_phone is null or contact_phone ~ '^[0-9]{10,11}$');

-- O responsavel edita pelo painel (RLS ja restringe ao proprio negocio).
grant update (contact_phone) on public.businesses to authenticated;

-- Mesma funcao publica, agora incluindo contact_phone. Mesmo contrato anterior + 1 campo.
create or replace function public.get_public_business(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'slug', b.slug,
           'name', b.name,
           'logo_path', b.logo_path,
           'primary_color', b.primary_color,
           'timezone', b.timezone,
           'max_days_ahead', b.max_days_ahead,
           'contact_phone', b.contact_phone)
    from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, ''))) and b.is_active;
$$;

-- Reafirma as permissoes (create or replace as preserva; aqui por seguranca/clareza).
revoke execute on function public.get_public_business(text) from public, anon, authenticated;
grant  execute on function public.get_public_business(text) to anon, authenticated;
