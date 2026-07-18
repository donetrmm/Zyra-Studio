-- 065: cleanup_old_data() devuelve los paths de Storage de lo que borra.
--
-- La función borraba filas (generations, media_references) pero nunca los
-- objetos de Storage asociados: outputs/, thumbnails/ y references/ crecían
-- monótonamente (la rule 40-worker especifica este paso desde el diseño y
-- nunca se implementó). SQL no puede tocar Storage, así que la función ahora
-- DEVUELVE los paths exactos de los objetos de las filas borradas y el route
-- handler de /api/jobs/cleanup los elimina con el admin client.
--
-- Paths exactos en vez de listar carpetas: output_url y thumbnail_url de la
-- fila, más safe_base_path y thought_signature_path de provider_payload (los
-- objetos extra del flujo estricto de storyboard). Para media_references solo
-- storage_url — su thumbnail_url puede apuntar al thumb de una generación
-- viva (refs creadas desde una generación), borrarlo aquí rompería esa card.
--
-- Tradeoff asumido: si el route muere entre este RPC y el remove de Storage,
-- esos objetos quedan huérfanos (las filas ya no existen). Ventana pequeña y
-- el route loguea cada remove fallido; se prefiere esto a un two-phase con
-- resurrección de filas.

create or replace function cleanup_old_data() returns jsonb as $$
declare
  v_gens_deleted bigint := 0;
  v_refs_deleted bigint := 0;
  v_notif_deleted bigint := 0;
  v_drafts_purged bigint := 0;
  v_stale_rescued bigint := 0;
  v_stale record;
  v_out_paths text[] := '{}';
  v_thumb_paths text[] := '{}';
  v_ref_paths text[] := '{}';
  v_tmp_out text[];
  v_tmp_thumb text[];
  v_tmp_safe text[];
  v_tmp_sig text[];
begin
  -- Rescate de filas colgadas (igual que 053): fail_generation es idempotente,
  -- margen de 10 min sobre timeout_at para no pisar entregas aún en vuelo.
  for v_stale in
    select id, user_id, credits_estimated
    from generations
    where status in ('queued', 'processing')
      and timeout_at is not null
      and timeout_at < now() - interval '10 minutes'
  loop
    begin
      perform fail_generation(
        v_stale.user_id,
        v_stale.id,
        coalesce(v_stale.credits_estimated, 0)::bigint,
        'timeout: job perdido, rescatado por cleanup'
      );
      v_stale_rescued := v_stale_rescued + 1;
    exception when others then
      raise warning 'cleanup: fail_generation fallo para %: %', v_stale.id, sqlerrm;
    end;
  end loop;

  with deleted as (
    delete from generations
      where status in ('failed','canceled')
        and created_at < now() - interval '7 days'
      returning output_url, thumbnail_url, provider_payload
  )
  select count(*),
         array_agg(output_url) filter (where output_url is not null),
         array_agg(thumbnail_url) filter (where thumbnail_url is not null),
         array_agg(provider_payload->>'safe_base_path') filter (where provider_payload->>'safe_base_path' is not null),
         array_agg(provider_payload->>'thought_signature_path') filter (where provider_payload->>'thought_signature_path' is not null)
    into v_gens_deleted, v_tmp_out, v_tmp_thumb, v_tmp_safe, v_tmp_sig
    from deleted;
  v_out_paths := v_out_paths || coalesce(v_tmp_out, '{}') || coalesce(v_tmp_safe, '{}') || coalesce(v_tmp_sig, '{}');
  v_thumb_paths := v_thumb_paths || coalesce(v_tmp_thumb, '{}');

  with deleted as (
    delete from generations d
      where d.provider = 'seedance'
        and d.model_id like '%/fast/%'
        and d.status = 'done'
        and d.created_at < now() - interval '7 days'
        and exists (
          select 1 from generations f
          where f.parent_generation_id = d.id
            and f.status = 'done'
            and f.model_id not like '%/fast/%'
        )
      returning output_url, thumbnail_url, provider_payload
  )
  select count(*),
         array_agg(output_url) filter (where output_url is not null),
         array_agg(thumbnail_url) filter (where thumbnail_url is not null),
         array_agg(provider_payload->>'safe_base_path') filter (where provider_payload->>'safe_base_path' is not null),
         array_agg(provider_payload->>'thought_signature_path') filter (where provider_payload->>'thought_signature_path' is not null)
    into v_drafts_purged, v_tmp_out, v_tmp_thumb, v_tmp_safe, v_tmp_sig
    from deleted;
  v_out_paths := v_out_paths || coalesce(v_tmp_out, '{}') || coalesce(v_tmp_safe, '{}') || coalesce(v_tmp_sig, '{}');
  v_thumb_paths := v_thumb_paths || coalesce(v_tmp_thumb, '{}');

  with deleted as (
    delete from media_references
      where source = 'generation'
        and source_generation_id is null
        and created_at < now() - interval '24 hours'
      returning storage_url
  )
  select count(*),
         array_agg(storage_url) filter (where storage_url is not null)
    into v_refs_deleted, v_tmp_out
    from deleted;
  v_ref_paths := coalesce(v_tmp_out, '{}');

  delete from notifications
    where read_at is not null
      and created_at < now() - interval '30 days';
  get diagnostics v_notif_deleted = row_count;

  return jsonb_build_object(
    'stale_rescued', v_stale_rescued,
    'generations_deleted', v_gens_deleted,
    'drafts_purged', v_drafts_purged,
    'references_deleted', v_refs_deleted,
    'notifications_deleted', v_notif_deleted,
    'storage', jsonb_build_object(
      'outputs', to_jsonb(v_out_paths),
      'thumbnails', to_jsonb(v_thumb_paths),
      'references', to_jsonb(v_ref_paths)
    )
  );
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function cleanup_old_data() from public, anon, authenticated;
