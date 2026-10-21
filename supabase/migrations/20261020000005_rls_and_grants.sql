-- =====================================================================
-- 005: RLS, privilegios de tabela e permissoes de funcao
-- Principio: comecar sem NADA e conceder o minimo.
--  * anon: zero acesso a tabelas; executa apenas as 4 funcoes publicas.
--  * authenticated: le/escreve so o que a RLS permite para os negocios em que e membro.
--  * bookings e time_blocks: sem INSERT/UPDATE direto (escrita so por funcoes).
-- =====================================================================

-- 1) RLS ligada em todas as tabelas
alter table public.businesses       enable row level security;
alter table public.business_members enable row level security;
alter table public.services         enable row level security;
alter table public.service_options  enable row level security;
alter table public.business_hours   enable row level security;
alter table public.time_blocks      enable row level security;
alter table public.bookings         enable row level security;

-- 2) Zera privilegios padrao (o Supabase concede amplos por padrao) e concede o minimo
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

grant select on public.businesses       to authenticated;
-- slug, timezone e is_active so podem ser alterados por voce (desenvolvedor)
grant update (name, logo_path, primary_color, buffer_minutes, slot_step_minutes,
              min_notice_minutes, max_days_ahead, allow_end_after_close)
      on public.businesses to authenticated;

grant select on public.business_members to authenticated;

grant select on public.services to authenticated;
grant insert (business_id, name, is_active) on public.services to authenticated;
grant update (name, is_active, archived_at) on public.services to authenticated;

grant select on public.service_options to authenticated;
grant insert (business_id, service_id, size, price_cents, duration_minutes, is_active)
      on public.service_options to authenticated;
grant update (price_cents, duration_minutes, is_active) on public.service_options to authenticated;

grant select, delete on public.business_hours to authenticated;
grant insert (business_id, day_of_week, opens_minute, closes_minute) on public.business_hours to authenticated;
grant update (day_of_week, opens_minute, closes_minute) on public.business_hours to authenticated;

grant select, delete on public.time_blocks to authenticated;   -- criar: funcao admin_create_time_block
grant select on public.bookings to authenticated;              -- escrever: funcoes admin_*

-- 3) Policies (todas "to authenticated"; anon nao tem policy nenhuma)

-- businesses: le e edita (colunas liberadas acima) apenas o proprio negocio
create policy businesses_select on public.businesses for select to authenticated
  using (id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy businesses_update on public.businesses for update to authenticated
  using      (id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())))
  with check (id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

-- business_members: cada usuario ve apenas o proprio vinculo; ninguem escreve pela API
create policy members_select on public.business_members for select to authenticated
  using (user_id = (select auth.uid()));

-- services
create policy services_select on public.services for select to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy services_insert on public.services for insert to authenticated
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy services_update on public.services for update to authenticated
  using      (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())))
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

-- service_options
create policy options_select on public.service_options for select to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy options_insert on public.service_options for insert to authenticated
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy options_update on public.service_options for update to authenticated
  using      (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())))
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

-- business_hours
create policy hours_select on public.business_hours for select to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy hours_insert on public.business_hours for insert to authenticated
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy hours_update on public.business_hours for update to authenticated
  using      (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())))
  with check (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy hours_delete on public.business_hours for delete to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

-- time_blocks: ler e apagar (liberar horario e seguro); criar so pela funcao
create policy blocks_select on public.time_blocks for select to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));
create policy blocks_delete on public.time_blocks for delete to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

-- bookings: somente leitura direta
create policy bookings_select on public.bookings for select to authenticated
  using (business_id in (select m.business_id from public.business_members m where m.user_id = (select auth.uid())));

-- 4) Permissoes de execucao das funcoes (revogadas de todos no passo 2)
grant execute on function public.get_public_business(text)                         to anon, authenticated;
grant execute on function public.list_public_services(text)                        to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, date)             to anon, authenticated;
grant execute on function public.create_public_booking(text, uuid, timestamptz, text, text, text, text, text, boolean, uuid)
                                                                                    to anon, authenticated;

grant execute on function public.admin_create_booking(uuid, uuid, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.admin_set_booking_status(uuid, text)              to authenticated;
grant execute on function public.admin_reschedule_booking(uuid, timestamptz)       to authenticated;
grant execute on function public.admin_update_booking_details(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.admin_create_time_block(uuid, timestamptz, timestamptz, text)    to authenticated;

-- IMPORTANTE (manutencao): toda funcao nova criada em "public" nasce executavel por PUBLIC.
-- Depois de criar qualquer funcao, rode "revoke execute ... from public, anon, authenticated"
-- e conceda so o necessario. O teste 04_permission_audit.sql lista o que estiver aberto.
