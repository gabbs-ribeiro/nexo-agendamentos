-- Restore contact_phone in the public business profile response.
-- The DEV database has an older get_public_business definition than migration 07.
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

revoke execute on function public.get_public_business(text) from public, anon, authenticated;
grant execute on function public.get_public_business(text) to anon, authenticated;
