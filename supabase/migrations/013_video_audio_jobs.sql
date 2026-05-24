-- 013_video_audio_jobs.sql
-- Fase 3 — bucket de voice samples, pricing seed para video/audio,
-- y RPC cleanup_old_data para el schedule diario.

-- ============ STORAGE BUCKET para muestras de voz ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-samples',
  'voice-samples',
  false,
  50 * 1024 * 1024,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/webm','audio/ogg']
)
on conflict (id) do nothing;

-- Policies: solo owner accede a sus samples (path prefijo = auth.uid())
drop policy if exists "voice_samples_owner_select" on storage.objects;
drop policy if exists "voice_samples_owner_insert" on storage.objects;
drop policy if exists "voice_samples_owner_delete" on storage.objects;

create policy "voice_samples_owner_select" on storage.objects
  for select using (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice_samples_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice_samples_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============ PRICING video/audio ============
-- Kling via fal.ai (klingapi.com no disponible). Model IDs son los slugs de fal.ai.
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('veo',        'veo-3.1-fast-generate-preview',  '1080p',    150, 1,    'segundo'),
  ('veo',        'veo-3.1-generate-preview',       '1080p',    300, 1,    'segundo'),
  ('veo',        'veo-3.1-lite-generate-preview',  '1080p',     80, 1,    'segundo'),
  ('kling',      'fal-ai/kling-video/v2.6/standard/text-to-video', 'standard', 200, 5,  'video'),
  ('kling',      'fal-ai/kling-video/v2.6/standard/text-to-video', 'long',     400, 10, 'video'),
  ('kling',      'fal-ai/kling-video/v2.6/pro/text-to-video',      'pro',      400, 5,  'video'),
  ('elevenlabs', 'eleven_multilingual_v2',         'default',   30, 1000, 'chars'),
  ('elevenlabs', 'eleven_flash_v2_5',              'default',   15, 1000, 'chars'),
  ('elevenlabs', 'eleven_v3',                      'default',   50, 1000, 'chars'),
  ('elevenlabs', 'sound_generation',               'default',   25, 1,    'efecto'),
  ('elevenlabs', 'voice_clone',                    'default',  200, 1,    'voz')
on conflict (provider, model_id, variant) do nothing;

-- ============ RPC cleanup_old_data ============
create or replace function cleanup_old_data() returns jsonb as $$
declare
  v_gens_deleted bigint;
  v_refs_deleted bigint;
  v_notif_deleted bigint;
begin
  delete from generations
    where status in ('failed','canceled')
      and created_at < now() - interval '7 days';
  get diagnostics v_gens_deleted = row_count;

  delete from media_references
    where source = 'generation'
      and source_generation_id is null
      and created_at < now() - interval '24 hours';
  get diagnostics v_refs_deleted = row_count;

  delete from notifications
    where read_at is not null
      and created_at < now() - interval '30 days';
  get diagnostics v_notif_deleted = row_count;

  return jsonb_build_object(
    'generations_deleted', v_gens_deleted,
    'references_deleted', v_refs_deleted,
    'notifications_deleted', v_notif_deleted
  );
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function cleanup_old_data() from public, anon, authenticated;
