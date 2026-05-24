-- 007_storage_policies.sql
-- Policies de RLS para storage.objects.
-- Buckets ya creados en provisioning: references, outputs, thumbnails, avatars,
-- brand-assets, voice-samples.
-- Esquema de paths:
--   references/{workspace_id}/{user_id}/{uuid}-{filename}
--   outputs/{workspace_id}/{generation_id}/{filename}
--   thumbnails/{workspace_id}/{generation_id}/{filename}
-- Uploads del worker / server actions con service role bypassan RLS, pero los
-- uploads directos desde cliente (signed upload URL del bucket references)
-- requieren policies. Los reads desde RSC con anon+session también.

-- ============ REFERENCES (privado, upload directo desde cliente) ============
drop policy if exists "refs_member_select" on storage.objects;
drop policy if exists "refs_member_insert" on storage.objects;
drop policy if exists "refs_owner_delete"  on storage.objects;

create policy "refs_member_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'references'
    and (storage.foldername(name))[1] is not null
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "refs_member_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'references'
    and (storage.foldername(name))[1] is not null
    and (storage.foldername(name))[2] = auth.uid()::text
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

create policy "refs_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'references'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ============ OUTPUTS (privado, escritura solo server) ============
-- Lectura para workspace members vía signed URL desde server, pero policy
-- explícita permite también listar/getPublicUrl si el bucket fuera público.
drop policy if exists "outputs_member_select" on storage.objects;

create policy "outputs_member_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'outputs'
    and (storage.foldername(name))[1] is not null
    and is_workspace_member((storage.foldername(name))[1]::uuid)
  );

-- ============ THUMBNAILS (público, escritura solo server) ============
drop policy if exists "thumbnails_public_select" on storage.objects;

create policy "thumbnails_public_select" on storage.objects
  for select to public
  using (bucket_id = 'thumbnails');
