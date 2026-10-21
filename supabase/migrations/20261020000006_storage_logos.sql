-- =====================================================================
-- 006: logotipos (Supabase Storage)
-- ATENCAO: o schema "storage" e gerenciado pelo Supabase e muda com o tempo.
-- Este script NAO pode ser validado fora do Supabase: confira no projeto de DEV
-- (envio, troca e remocao de logo; envio de arquivo grande/SVG deve falhar).
-- Bucket publico: o logo e publico por natureza (aparece na pagina do cliente).
-- SVG fica de fora de proposito (pode conter script).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, 1048576,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada negocio so mexe na propria pasta: business-logos/<business_id>/arquivo
create policy "logos_insert_own_folder" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid()))
  );

create policy "logos_update_own_folder" on storage.objects for update to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid()))
  )
  with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid()))
  );

create policy "logos_delete_own_folder" on storage.objects for delete to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid()))
  );

create policy "logos_select_own_folder" on storage.objects for select to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select m.business_id::text from public.business_members m where m.user_id = (select auth.uid()))
  );
