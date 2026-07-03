-- 053: el cleanup diario rescata generaciones colgadas en queued/processing.
--
-- Incidente 2026-07-03: la cadena de QStash de un panel de storyboard murió
-- (3 entregas seguidas con 504 por exceder maxDuration en el expand) y la
-- generación quedó en 'processing' para siempre: el guard de timeout del worker
-- solo se evalúa cuando LLEGA un mensaje de QStash, y nada más volvía a tocar la
-- fila. Consecuencias: créditos reservados sin refund y el beat bloqueado por el
-- guard in_flight. Este rescate es la red de seguridad de último recurso; el fix
-- principal (expand por hops con presupuesto fresco) va en el código del worker.
--
-- fail_generation es idempotente (marca failed + refund condicional), así que
-- rescatar una fila que otro proceso acaba de cerrar es inocuo. Margen de 10 min
-- sobre timeout_at para no pisar jobs con entregas de QStash aún en vuelo.

create or replace function cleanup_old_data() returns jsonb as $$
declare
  v_gens_deleted bigint;
  v_refs_deleted bigint;
  v_notif_deleted bigint;
  v_drafts_purged bigint;
  v_stale_rescued bigint := 0;
  v_stale record;
begin
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
      -- Best-effort: una fila problemática no debe frenar el resto del cleanup.
      raise warning 'cleanup: fail_generation fallo para %: %', v_stale.id, sqlerrm;
    end;
  end loop;

  delete from generations
    where status in ('failed','canceled')
      and created_at < now() - interval '7 days';
  get diagnostics v_gens_deleted = row_count;

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
      );
  get diagnostics v_drafts_purged = row_count;

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
    'stale_rescued', v_stale_rescued,
    'generations_deleted', v_gens_deleted,
    'drafts_purged', v_drafts_purged,
    'references_deleted', v_refs_deleted,
    'notifications_deleted', v_notif_deleted
  );
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function cleanup_old_data() from public, anon, authenticated;
