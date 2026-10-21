-- Categorias editaveis por estabelecimento; agendamentos existentes mantem
-- os snapshots gravados em bookings.

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_categories_name check (char_length(btrim(name)) between 1 and 80),
  constraint service_categories_description check (char_length(description) <= 300),
  constraint service_categories_order check (sort_order >= 0),
  constraint service_categories_business_id_uq unique (business_id, id)
);

create unique index service_categories_name_uq
  on public.service_categories (business_id, lower(btrim(name)));

create trigger trg_service_categories_bizlock before update on public.service_categories
  for each row execute function app_private.forbid_business_change();
create trigger trg_service_categories_updated before update on public.service_categories
  for each row execute function app_private.set_updated_at();

alter table public.service_categories enable row level security;
revoke all on public.service_categories from public, anon, authenticated;
grant select on public.service_categories to authenticated;
grant insert (business_id, name, description, sort_order) on public.service_categories to authenticated;
grant update (name, description, sort_order) on public.service_categories to authenticated;

create policy service_categories_select on public.service_categories for select to authenticated
  using (business_id in (
    select m.business_id from public.business_members m where m.user_id = (select auth.uid())
  ));
create policy service_categories_insert on public.service_categories for insert to authenticated
  with check (business_id in (
    select m.business_id from public.business_members m where m.user_id = (select auth.uid())
  ));
create policy service_categories_update on public.service_categories for update to authenticated
  using (business_id in (
    select m.business_id from public.business_members m where m.user_id = (select auth.uid())
  ))
  with check (business_id in (
    select m.business_id from public.business_members m where m.user_id = (select auth.uid())
  ));

insert into public.service_categories (business_id, name, description, sort_order)
select b.id, category.name, category.description, category.sort_order
  from public.businesses b
 cross join (values
   ('Banho e tosa', 'Cuidados de higiene e beleza para o seu pet.', 0),
   ('Pet Hotel / creche', 'Serviços de cuidado para o seu pet.', 1)
 ) as category(name, description, sort_order);

create function app_private.seed_service_categories()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.service_categories (business_id, name, description, sort_order)
  values
    (new.id, 'Banho e tosa', 'Cuidados de higiene e beleza para o seu pet.', 0),
    (new.id, 'Pet Hotel / creche', 'Serviços de cuidado para o seu pet.', 1);
  return new;
end $$;

revoke all on function app_private.seed_service_categories() from public, anon, authenticated;
create trigger trg_businesses_seed_service_categories after insert on public.businesses
  for each row execute function app_private.seed_service_categories();

alter table public.services add column category_id uuid;
update public.services s
   set category_id = c.id
  from public.service_categories c
 where c.business_id = s.business_id
   and c.name = 'Banho e tosa';
alter table public.services
  alter column category_id set not null,
  add constraint services_business_category_fk
    foreign key (business_id, category_id)
    references public.service_categories (business_id, id) on delete restrict;
grant insert (category_id) on public.services to authenticated;
grant update (category_id) on public.services to authenticated;

create function app_private.assign_default_service_category()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.category_id is null then
    select c.id into new.category_id
      from public.service_categories c
     where c.business_id = new.business_id
     order by c.sort_order, c.name
     limit 1;
  end if;
  return new;
end $$;

revoke all on function app_private.assign_default_service_category() from public, anon, authenticated;
create trigger trg_services_default_category before insert on public.services
  for each row execute function app_private.assign_default_service_category();

create or replace function public.list_public_service_categories(p_slug text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category_id', c.id,
      'name', c.name,
      'description', c.description,
      'services', coalesce(s.items, '[]'::jsonb))
    order by c.sort_order, c.name), '[]'::jsonb)
    from public.businesses b
    join public.service_categories c on c.business_id = b.id
    cross join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'service_id', service.id,
          'name', service.name,
          'description', service.description,
          'options', options.items)
        order by service.name) as items
        from public.services service
        cross join lateral (
          select jsonb_agg(
            jsonb_build_object(
              'option_id', option.id,
              'size', option.size,
              'size_label', size.name,
              'price_cents', option.price_cents,
              'duration_minutes', option.duration_minutes)
            order by size.sort_order, size.name) as items
            from public.service_options option
            join public.business_sizes size
              on size.business_id = option.business_id
             and size.code = option.size
             and size.is_active
           where option.service_id = service.id
             and option.business_id = b.id
             and option.is_active
        ) options
       where service.business_id = b.id
         and service.category_id = c.id
         and service.is_active
         and service.archived_at is null
         and options.items is not null
    ) s
   where b.slug = lower(btrim(coalesce(p_slug, '')))
     and b.is_active;
$$;

revoke execute on function public.list_public_service_categories(text) from public, anon, authenticated;
grant execute on function public.list_public_service_categories(text) to anon, authenticated;
