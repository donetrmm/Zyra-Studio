-- 037_complete_generation_status_guard.sql
-- complete_generation solo era idempotente por credits_charged, no por status.
-- Como fail_generation refunda SIN setear credits_charged, una carrera
-- timeout/cancel -> fail seguida de un finalize -> complete (dos entregas
-- concurrentes de QStash) resucitaba el job a 'done': el usuario se quedaba con
-- el reembolso (balance += cost) Y el output servido -> generacion gratis.
-- Se agrega un guard de status terminal, igual al que ya tiene fail_generation.

create or replace function complete_generation(
  p_user_id uuid,
  p_generation_id uuid,
  p_cost bigint,
  p_output_url text,
  p_thumbnail_url text,
  p_processing_ms integer,
  p_file_size_bytes bigint,
  p_provider_payload jsonb default null
) returns void as $$
declare
  v_already_charged bigint;
  v_status text;
begin
  select credits_charged, status into v_already_charged, v_status
    from generations where id = p_generation_id for update;

  -- Idempotencia: si ya está confirmada, no-op.
  if v_already_charged is not null then
    return;
  end if;

  -- No resucitar un job ya marcado terminal (failed/canceled) por
  -- fail_generation: el refund deja credits_charged null, así que sin este
  -- guard un complete posterior pondría 'done' tras el reembolso.
  if v_status in ('failed', 'canceled') then
    return;
  end if;

  -- Aplicar el cargo (mueve del pending al spent).
  update credit_balances
    set pending = greatest(0, pending - p_cost), updated_at = now()
    where user_id = p_user_id;

  -- Marcar la generación como completada con todo el payload.
  update generations
    set status = 'done',
        output_url = p_output_url,
        thumbnail_url = p_thumbnail_url,
        credits_charged = p_cost,
        processing_ms = p_processing_ms,
        file_size_bytes = p_file_size_bytes,
        provider_payload = p_provider_payload,
        completed_at = now()
    where id = p_generation_id;
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;
