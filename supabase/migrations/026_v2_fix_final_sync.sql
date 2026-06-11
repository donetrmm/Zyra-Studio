-- 026_v2_fix_final_sync.sql
-- Bug: el trigger de 025 solo transiciona items en ('queued','sample'), pero
-- requestFinalAction deja el item en 'approved' mientras corre el render
-- final — al completarse, el item se quedaba en "render final…" para siempre.
-- Se agrega 'approved' a ambas ramas y se reparan las filas ya atascadas.

create or replace function sync_campaign_item_from_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from new.status then
    update public.campaign_items
      set status = case when new.model_id like '%/fast/%' then 'draft_ready' else 'final_ready' end
      where generation_id = new.id and status in ('queued', 'sample', 'approved');
  elsif new.status in ('failed', 'canceled') and old.status is distinct from new.status then
    update public.campaign_items
      set status = case when status = 'approved' then 'draft_ready' else 'failed' end
      -- si el FINAL falla, el item regresa a draft_ready (el draft sigue bueno
      -- y el usuario puede re-aprobar); si falla el draft, va a failed.
      where generation_id = new.id and status in ('queued', 'sample', 'approved');
  end if;
  return new;
end $$;

-- Reparación de items ya atascados: final terminado pero item en 'approved'.
update campaign_items ci
set status = case when g.model_id like '%/fast/%' then 'draft_ready' else 'final_ready' end
from generations g
where g.id = ci.generation_id
  and ci.status = 'approved'
  and g.status = 'done';
