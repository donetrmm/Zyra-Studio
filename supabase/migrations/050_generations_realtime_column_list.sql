-- 050_generations_realtime_column_list.sql
-- generations.provider_payload guarda el thought_signature de gemini-3-pro-image
-- (~6-9 MB), que excede max_record_bytes (1 MB) de Supabase Realtime. Al hacer
-- finalize el UPDATE se difunde con el record vacio (error 413) y el cliente nunca
-- recibe el cambio de status -> el panel del storyboard se queda "generando" hasta
-- un reload. Restringimos las columnas publicadas de generations a las que los
-- consumidores de Realtime realmente leen. provider_payload (y prompt/negative_prompt)
-- quedan fuera del broadcast pero siguen en la tabla para las lecturas server-side
-- (el encadenado conversacional lee provider_payload.thought_signature via service role).
--
-- Consumidores de postgres_changes sobre generations y las columnas que leen de
-- payload.new:
--   - components/generation/use-generation-status.ts:
--       status, error_message, output_url, thumbnail_url, credits_charged (filtra id=eq)
--   - components/campaigns/use-storyboard-panel-realtime.ts:
--       campaign_id, status, error_message, params (storyboard.campaignItemId)
-- id va en la lista por ser PK / REPLICA IDENTITY (requerido por la column list).

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'generations'
  ) then
    alter publication supabase_realtime drop table generations;
  end if;

  alter publication supabase_realtime add table generations
    (id, status, error_message, output_url, thumbnail_url, credits_charged, campaign_id, params);
end $$;
