-- 025_v2_campaign_orchestration.sql
-- Fase C de V2: (1) campañas conocen su Brand Kit, (2) campaign_items se
-- sincroniza solo cuando su generación termina (trigger — el worker no se
-- toca), (3) Realtime para el progreso de producción en la UI.

-- ============ 1. Brand Kit de la campaña ============
alter table campaigns
  add column if not exists brand_kit_id uuid references brand_kits(id) on delete set null;

-- ============ 2. Sync item ← generación ============
-- Cuando la generación de un item llega a done/failed, el item refleja el
-- estado. Tier draft (modelo /fast/) → draft_ready; tier standard → final_ready.
create or replace function sync_campaign_item_from_generation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from new.status then
    update public.campaign_items
      set status = case when new.model_id like '%/fast/%' then 'draft_ready' else 'final_ready' end
      where generation_id = new.id and status in ('queued', 'sample');
  elsif new.status in ('failed', 'canceled') and old.status is distinct from new.status then
    update public.campaign_items
      set status = 'failed'
      where generation_id = new.id and status in ('queued', 'sample');
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_campaign_item on generations;
create trigger trg_sync_campaign_item
  after update of status on generations
  for each row execute function sync_campaign_item_from_generation();

-- ============ 3. Realtime ============
alter publication supabase_realtime add table campaign_items;
