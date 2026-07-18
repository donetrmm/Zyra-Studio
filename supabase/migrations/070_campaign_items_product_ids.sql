-- 070_campaign_items_product_ids.sql
-- Multi-producto por clip (spec 2026-07-15): un clip puede llevar VARIOS
-- productos del pool (showcase). product_ids espeja el patrón de
-- character_ids[] (sin FK por elemento: el resolver valida existencia y
-- workspace y descarta ids muertos, igual que el cast). product_id queda
-- deprecada: legible en transición, el pipeline nuevo no la lee ni escribe.

alter table campaign_items
  add column if not exists product_ids uuid[] not null default '{}';

comment on column campaign_items.product_id is
  'DEPRECADA (2026-07-15): usar product_ids. Se conserva solo como respaldo de transición.';
comment on column campaign_items.product_ids is
  'Productos del pool (campaign_products) asignados a este clip. {} = sin asignar.';

-- Backfill idempotente y acotado (una pasada sobre campaign_items).
update campaign_items
  set product_ids = array[product_id]
  where product_id is not null and product_ids = '{}';
