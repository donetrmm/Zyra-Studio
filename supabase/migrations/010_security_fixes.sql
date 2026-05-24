-- 010_security_fixes.sql
-- Fixes del code review post-Fase 2. Cubre:
--
--   #1  Escalada a admin: revoca UPDATE de columnas sensibles en profiles.
--   #4  Race de credit_purchases duplicadas: unique index parcial.
--   #3  Idempotencia de confirm/refund credits + RPC atómica
--       complete_generation que combina status='done' + confirm en una sola tx.
--   #12 fail_generation atómica que aplica refund solo si NO fue confirmada.
--   #13 approve_purchase re-valida credits/price contra el catálogo en runtime
--       (defensa en profundidad — el CHECK podría quedar desfasado).
--   #14 generations / media_references: WITH CHECK que impide cambiar
--       workspace_id a uno donde el usuario no es miembro.

-- ============ #1: PROFILES — proteger columnas sensibles ============
-- La policy profiles_self_update sigue permitiendo UPDATE general (el usuario
-- edita su nombre, avatar, area), pero authenticated/anon pierden permiso
-- sobre las columnas role y status que solo deben mutar via RPC admin o
-- triggers internos. service_role no se ve afectado (bypassa GRANTs).

revoke update (role, status) on profiles from anon, authenticated;

-- ============ #4: credit_purchases — un solo pending por (user, pack) ============

create unique index if not exists credit_purchases_one_pending
  on credit_purchases (user_id, pack_id)
  where status = 'pending';

-- ============ #3 + #12: RPCs atómicas para fin de generación ============
-- El flujo viejo (server action ejecutaba confirm_credits y luego un UPDATE
-- separado de generations) era frágil: si el UPDATE fallaba después del
-- confirm, el catch llamaba refund_credits → balance += cost (free credits)
-- y pending -= cost (negativo, viola CHECK, error silenciado con .catch(()=>{})).
--
-- Solución: complete_generation hace todo en una transacción. fail_generation
-- es idempotente — si ya hay credits_charged set, no refunda (porque significa
-- que la imagen sí se cobró y entregó).

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
begin
  -- Idempotencia: si ya está confirmada, no-op.
  select credits_charged into v_already_charged
    from generations where id = p_generation_id for update;
  if v_already_charged is not null then
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

create or replace function fail_generation(
  p_user_id uuid,
  p_generation_id uuid,
  p_cost bigint,
  p_error_message text
) returns void as $$
declare
  v_already_charged bigint;
  v_status text;
begin
  select credits_charged, status into v_already_charged, v_status
    from generations where id = p_generation_id for update;

  -- Si la generación no existe, no hacemos nada (no-op idempotente).
  if v_status is null then
    return;
  end if;

  -- Si ya estaba en estado terminal, no doble-procesar.
  if v_status in ('done', 'failed', 'canceled') then
    return;
  end if;

  -- Si NO fue confirmada todavía, refundeamos del pending al balance.
  if v_already_charged is null then
    update credit_balances
      set balance = balance + p_cost,
          pending = greatest(0, pending - p_cost),
          updated_at = now()
      where user_id = p_user_id;
    insert into credit_transactions(user_id, delta, reason, generation_id)
      values (p_user_id, p_cost, 'generation_refund', p_generation_id);
  end if;

  update generations
    set status = 'failed',
        error_message = p_error_message,
        completed_at = now()
    where id = p_generation_id;
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

-- Hacer confirm_credits y refund_credits idempotentes también, por si quedan
-- callers viejos (worker de fase 3, scripts manuales). Mismo guard que arriba.

create or replace function confirm_credits(
  p_user_id uuid,
  p_amount bigint,
  p_generation_id uuid
) returns void as $$
declare
  v_charged bigint;
begin
  select credits_charged into v_charged
    from generations where id = p_generation_id for update;
  if v_charged is not null then
    return;  -- ya confirmado, no-op
  end if;
  update credit_balances
    set pending = greatest(0, pending - p_amount), updated_at = now()
    where user_id = p_user_id;
  update generations
    set credits_charged = p_amount
    where id = p_generation_id;
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

create or replace function refund_credits(
  p_user_id uuid,
  p_amount bigint,
  p_generation_id uuid
) returns void as $$
declare
  v_charged bigint;
begin
  select credits_charged into v_charged
    from generations where id = p_generation_id for update;
  -- Si ya fue confirmada, refund sería double-credit → no-op.
  if v_charged is not null then
    return;
  end if;
  update credit_balances
    set balance = balance + p_amount,
        pending = greatest(0, pending - p_amount),
        updated_at = now()
    where user_id = p_user_id;
  insert into credit_transactions(user_id, delta, reason, generation_id)
    values (p_user_id, p_amount, 'generation_refund', p_generation_id);
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

-- Revoke execute de las nuevas funciones (mismo razonamiento que 006: solo
-- service_role debe poder llamarlas).
revoke execute on function complete_generation(uuid, uuid, bigint, text, text, integer, bigint, jsonb)
  from public, anon, authenticated;
revoke execute on function fail_generation(uuid, uuid, bigint, text)
  from public, anon, authenticated;

-- ============ #13: approve_purchase re-valida contra el catálogo ============
-- El CHECK constraint en credit_purchases ya valida en INSERT, pero si en el
-- futuro se agrega un pack sin updatear el CHECK, un atacante podría insertar
-- directo via PostgREST con credits inflados. Re-validamos aquí también.

create or replace function approve_purchase(p_purchase_id uuid) returns void as $$
declare
  v_purchase credit_purchases%rowtype;
  v_expected_credits bigint;
  v_expected_price numeric;
begin
  if not is_admin() then
    raise exception 'only admins can approve purchases';
  end if;

  select * into v_purchase from credit_purchases where id = p_purchase_id for update;
  if v_purchase is null or v_purchase.status <> 'pending' then
    raise exception 'purchase not found or not pending';
  end if;

  -- Defensa en profundidad: revalidamos credits/price contra el catálogo
  -- canónico. Si en el futuro se añade un pack, actualizar ambas listas
  -- (esta función y el CHECK en credit_purchases). Mismatch → reject duro.
  case v_purchase.pack_id
    when 'starter' then v_expected_credits :=   2000; v_expected_price :=   99;
    when 'creator' then v_expected_credits :=  10000; v_expected_price :=  399;
    when 'pro'     then v_expected_credits :=  50000; v_expected_price := 1499;
    when 'studio'  then v_expected_credits := 200000; v_expected_price := 4999;
    else raise exception 'unknown pack_id: %', v_purchase.pack_id;
  end case;
  if v_purchase.credits <> v_expected_credits or v_purchase.price_mxn <> v_expected_price then
    raise exception 'purchase % has tampered values (credits=%, price=%)',
      p_purchase_id, v_purchase.credits, v_purchase.price_mxn;
  end if;

  update credit_purchases
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_purchase_id;

  update credit_balances
    set balance = balance + v_purchase.credits, updated_at = now()
    where user_id = v_purchase.user_id;

  insert into credit_transactions(user_id, delta, reason, admin_id, metadata)
    values (v_purchase.user_id, v_purchase.credits, 'purchase_approved',
            auth.uid(), jsonb_build_object('pack_id', v_purchase.pack_id, 'purchase_id', p_purchase_id));

  insert into notifications(user_id, type, payload)
    values (v_purchase.user_id, 'purchase_approved',
            jsonb_build_object('credits', v_purchase.credits, 'pack_id', v_purchase.pack_id));

  insert into admin_audit_log(admin_id, action, target_user_id, target_resource_id, payload)
    values (auth.uid(), 'purchase_approve', v_purchase.user_id, p_purchase_id,
            jsonb_build_object('credits', v_purchase.credits));
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

-- ============ #14: WITH CHECK en owner_update / owner_delete ============
-- Las policies viejas (002_rls_policies.sql) usan USING sin WITH CHECK, lo
-- que permite cambiar workspace_id en UPDATE a uno ajeno (el USING se aplica
-- al row viejo y, como fallback, al nuevo — pero solo chequea user_id, no
-- workspace_id). Cerramos esto agregando WITH CHECK explícito.

drop policy if exists "generations_owner_update" on generations;
create policy "generations_owner_update" on generations
  for update
  using  (user_id = auth.uid() or is_admin())
  with check (
    (user_id = auth.uid() and is_workspace_member(workspace_id))
    or is_admin()
  );

drop policy if exists "media_refs_owner_update" on media_references;
create policy "media_refs_owner_update" on media_references
  for update
  using  (user_id = auth.uid() or is_admin())
  with check (
    (user_id = auth.uid() and is_workspace_member(workspace_id))
    or is_admin()
  );
