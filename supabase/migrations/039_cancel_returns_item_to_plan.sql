-- 039_cancel_returns_item_to_plan.sql
-- Cancelar una generación es una acción del usuario, no un fallo: el item no
-- debería quedar como "falló" (rojo) cuando el usuario lo detuvo a propósito.
-- Se separa la rama 'canceled' de la rama 'failed' del trigger de 026:
--   - canceled del DRAFT (queued/sample) → vuelve a 'planned' (regenerable,
--     sin etiqueta de error) y se limpia generation_id (mismo patrón que
--     redoSamples: un generation_id null es un reset real para la UI).
--   - canceled del FINAL (item 'approved') → 'draft_ready' (el borrador sigue
--     bueno, el usuario puede re-aprobar) — igual que cuando el final falla.
--   - failed conserva el comportamiento de 026.

create or replace function sync_campaign_item_from_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from new.status then
    update public.campaign_items
      set status = case when new.model_id like '%/fast/%' then 'draft_ready' else 'final_ready' end
      where generation_id = new.id and status in ('queued', 'sample', 'approved');
  elsif new.status = 'canceled' and old.status is distinct from new.status then
    update public.campaign_items
      set status = case when status = 'approved' then 'draft_ready' else 'planned' end,
          generation_id = case when status = 'approved' then generation_id else null end
      where generation_id = new.id and status in ('queued', 'sample', 'approved');
  elsif new.status = 'failed' and old.status is distinct from new.status then
    update public.campaign_items
      set status = case when status = 'approved' then 'draft_ready' else 'failed' end
      -- si el FINAL falla, el item regresa a draft_ready (el draft sigue bueno
      -- y el usuario puede re-aprobar); si falla el draft, va a failed.
      where generation_id = new.id and status in ('queued', 'sample', 'approved');
  end if;
  return new;
end $$;

-- Reparación: items marcados 'failed' cuya generación fue realmente CANCELADA
-- (por la regla vieja de 025/026) regresan al plan, limpiando el puntero muerto.
update campaign_items ci
set status = 'planned', generation_id = null
from generations g
where g.id = ci.generation_id
  and ci.status = 'failed'
  and g.status = 'canceled';
