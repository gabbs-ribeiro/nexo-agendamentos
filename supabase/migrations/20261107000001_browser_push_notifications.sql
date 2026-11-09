create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 1 and 2048),
  constraint push_subscriptions_p256dh_length check (char_length(p256dh) between 1 and 256),
  constraint push_subscriptions_auth_length check (char_length(auth) between 1 and 256),
  constraint push_subscriptions_owner_endpoint_uq unique (business_id, user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
grant all on table public.push_subscriptions to service_role;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.business_members m
      where m.business_id = push_subscriptions.business_id
        and m.user_id = (select auth.uid())
    )
  );

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.business_members m
      where m.business_id = push_subscriptions.business_id
        and m.user_id = (select auth.uid())
    )
  );

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.business_members m
      where m.business_id = push_subscriptions.business_id
        and m.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.business_members m
      where m.business_id = push_subscriptions.business_id
        and m.user_id = (select auth.uid())
    )
  );

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.business_members m
      where m.business_id = push_subscriptions.business_id
        and m.user_id = (select auth.uid())
    )
  );

create table public.push_notification_events (
  event_key text primary key,
  created_at timestamptz not null default now(),
  constraint push_notification_events_key_length check (char_length(event_key) between 1 and 80)
);

alter table public.push_notification_events enable row level security;
revoke all on table public.push_notification_events from public, anon, authenticated;
grant all on table public.push_notification_events to service_role;
