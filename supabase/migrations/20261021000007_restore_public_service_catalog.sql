-- Restaura descricao do servico e rotulo atual do porte na resposta publica.
-- Corrige ambientes onde list_public_services ainda usa a definicao anterior
-- a 20261021000002_admin_control_catalog.sql.

do $$
begin
  if pg_catalog.to_regclass('public.business_sizes') is null
     or pg_catalog.to_regclass('public.services') is null
     or pg_catalog.to_regclass('public.service_options') is null
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'services'
          and column_name = 'description'
     ) then
    raise exception 'Pre-requisito ausente: verifique a migration 20261021000002_admin_control_catalog.sql';
  end if;
end;
$$;

create or replace function public.list_public_services(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'service_id', s.id,
             'name', s.name,
             'description', s.description,
             'options', o.opts)
           order by s.name), '[]'::jsonb)
    from public.businesses b
    join public.services s
      on s.business_id = b.id and s.is_active and s.archived_at is null
    cross join lateral (
      select jsonb_agg(
               jsonb_build_object(
                 'option_id', so.id,
                 'size', so.size,
                 'size_label', bs.name,
                 'price_cents', so.price_cents,
                 'duration_minutes', so.duration_minutes)
               order by bs.sort_order, bs.name) as opts
        from public.service_options so
        join public.business_sizes bs
          on bs.business_id = so.business_id
         and bs.code = so.size
         and bs.is_active
       where so.service_id = s.id and so.is_active
    ) o
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active
     and o.opts is not null;
$$;

revoke execute on function public.list_public_services(text)
  from public, anon, authenticated;
grant execute on function public.list_public_services(text)
  to anon, authenticated;
