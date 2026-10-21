-- Restaura a verificacao de porte ativo ao calcular horarios publicos.
-- Corrige ambientes onde get_available_slots ainda usa a definicao anterior
-- a 20261021000002_admin_control_catalog.sql.

do $$
begin
  if pg_catalog.to_regclass('public.businesses') is null
     or pg_catalog.to_regclass('public.business_sizes') is null
     or pg_catalog.to_regclass('public.services') is null
     or pg_catalog.to_regclass('public.service_options') is null
     or not exists (
       select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'business_sizes'
          and column_name = 'is_active'
     ) then
    raise exception 'Pre-requisito ausente: verifique a migration 20261021000002_admin_control_catalog.sql';
  end if;
end;
$$;

create or replace function public.get_available_slots(
  p_slug text,
  p_option_id uuid,
  p_date date)
returns table (starts_at timestamptz, local_time text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_biz public.businesses%rowtype;
  v_duration int;
begin
  select *
    into v_biz
    from public.businesses b
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active;
  if not found then
    return;
  end if;

  select so.duration_minutes
    into v_duration
    from public.service_options so
    join public.business_sizes bs
      on bs.business_id = so.business_id
     and bs.code = so.size
     and bs.is_active
    join public.services s
      on s.id = so.service_id
     and s.business_id = so.business_id
   where so.id = p_option_id
     and so.business_id = v_biz.id
     and so.is_active
     and s.is_active
     and s.archived_at is null;
  if v_duration is null then
    return;
  end if;

  return query
    select cs.slot_start,
           to_char(cs.slot_start at time zone v_biz.timezone, 'HH24:MI')
      from app_private.compute_slots(v_biz.id, v_duration, p_date) cs;
end;
$$;

revoke execute on function public.get_available_slots(text, uuid, date)
  from public, anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date)
  to anon, authenticated;
