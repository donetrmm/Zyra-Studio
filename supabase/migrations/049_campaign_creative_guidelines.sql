-- supabase/migrations/049_campaign_creative_guidelines.sql
-- Guias creativas por campana (spec 2026-06-29). Structured, opt-in. jsonb con
-- showFullProduct / hookProductHero / safeCrop. Default '{}' = todo apagado =
-- comportamiento actual. RLS hereda las policies de campaigns (sin cambios).
alter table public.campaigns
  add column if not exists creative_guidelines jsonb not null default '{}'::jsonb;
