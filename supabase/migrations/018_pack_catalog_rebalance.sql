-- 018_pack_catalog_rebalance.sql
-- Rebalancea el catálogo de packs de créditos a precios más accesibles para
-- la demo. El catálogo "actual" (lib/billing/packs.ts) es:
--   starter:    500 cr / $49
--   creator:   2000 cr / $179
--   pro:       5000 cr / $399
--   studio:   15000 cr / $999
--
-- Mantenemos también las combinaciones del catálogo "legacy" (la versión
-- original de 001_initial_schema.sql) para no romper filas históricas en
-- credit_purchases ni la invariante "balance = suma(credit_transactions)".
-- Sólo el código de la app inserta filas, y solo lo hace con valores del
-- catálogo actual; las combinaciones legacy quedan permitidas para datos
-- preexistentes.
--
-- La propiedad de seguridad original — "no se puede forjar Studio por $1" —
-- se preserva: cada pack_id sigue teniendo un número finito de combinaciones
-- válidas (credits, price_mxn).

-- ============ 1. Constraint en credit_purchases ============
alter table credit_purchases
  drop constraint if exists pack_catalog_match;

alter table credit_purchases
  add constraint pack_catalog_match check (
    -- catálogo actual
    (pack_id = 'starter' and credits =    500 and price_mxn =   49) or
    (pack_id = 'creator' and credits =   2000 and price_mxn =  179) or
    (pack_id = 'pro'     and credits =   5000 and price_mxn =  399) or
    (pack_id = 'studio'  and credits =  15000 and price_mxn =  999) or
    -- catálogo legacy (preserva filas históricas)
    (pack_id = 'starter' and credits =   2000 and price_mxn =   99) or
    (pack_id = 'creator' and credits =  10000 and price_mxn =  399) or
    (pack_id = 'pro'     and credits =  50000 and price_mxn = 1499) or
    (pack_id = 'studio'  and credits = 200000 and price_mxn = 4999)
  );

-- ============ 2. approve_purchase con validación dual ============
-- Defensa en profundidad: revalida (pack_id, credits, price_mxn) contra el
-- catálogo (actual + legacy). Si en el futuro se añade un pack, actualizar
-- esta lista y el CHECK de arriba en paralelo.
create or replace function approve_purchase(p_purchase_id uuid) returns void as $$
declare
  v_purchase credit_purchases%rowtype;
begin
  if not is_admin() then
    raise exception 'only admins can approve purchases';
  end if;

  select * into v_purchase from credit_purchases where id = p_purchase_id for update;
  if v_purchase is null or v_purchase.status <> 'pending' then
    raise exception 'purchase not found or not pending';
  end if;

  if not (
    -- catálogo actual
    (v_purchase.pack_id = 'starter' and v_purchase.credits =    500 and v_purchase.price_mxn =   49) or
    (v_purchase.pack_id = 'creator' and v_purchase.credits =   2000 and v_purchase.price_mxn =  179) or
    (v_purchase.pack_id = 'pro'     and v_purchase.credits =   5000 and v_purchase.price_mxn =  399) or
    (v_purchase.pack_id = 'studio'  and v_purchase.credits =  15000 and v_purchase.price_mxn =  999) or
    -- catálogo legacy
    (v_purchase.pack_id = 'starter' and v_purchase.credits =   2000 and v_purchase.price_mxn =   99) or
    (v_purchase.pack_id = 'creator' and v_purchase.credits =  10000 and v_purchase.price_mxn =  399) or
    (v_purchase.pack_id = 'pro'     and v_purchase.credits =  50000 and v_purchase.price_mxn = 1499) or
    (v_purchase.pack_id = 'studio'  and v_purchase.credits = 200000 and v_purchase.price_mxn = 4999)
  ) then
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
