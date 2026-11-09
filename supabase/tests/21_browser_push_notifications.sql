-- TESTE 21 — permissões e RLS das notificações push do navegador.
-- Rodar SOMENTE em DEV após a migration 20261107000001_browser_push_notifications.sql.
begin;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass) then
    raise exception 'push_subscriptions must have RLS enabled';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.push_notification_events'::regclass) then
    raise exception 'push_notification_events must have RLS enabled';
  end if;
  if has_any_column_privilege('anon', 'public.push_subscriptions', 'select')
    or has_any_column_privilege('anon', 'public.push_subscriptions', 'insert')
    or has_table_privilege('anon', 'public.push_subscriptions', 'delete') then
    raise exception 'anon must not access push_subscriptions';
  end if;
  if has_any_column_privilege('authenticated', 'public.push_notification_events', 'select')
    or has_any_column_privilege('authenticated', 'public.push_notification_events', 'insert')
    or has_table_privilege('authenticated', 'public.push_notification_events', 'delete') then
    raise exception 'authenticated must not access push_notification_events';
  end if;
  if has_any_column_privilege('anon', 'public.push_notification_events', 'select')
    or has_any_column_privilege('anon', 'public.push_notification_events', 'insert')
    or has_table_privilege('anon', 'public.push_notification_events', 'delete') then
    raise exception 'anon must not access push_notification_events';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'push_subscriptions'
      and policyname = 'push_subscriptions_insert_own' and 'authenticated' = any(roles)
  ) then
    raise exception 'authenticated subscription insert policy is missing';
  end if;
end
$$;

rollback;
