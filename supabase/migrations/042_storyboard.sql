-- 042_storyboard.sql
-- Storyboard: un panel-imagen por beat (campaign_item). El panel vigente apunta a
-- una media_reference (sirve de referencia del video en el sub-proyecto B y de base
-- para la siguiente edicion Nano Banana). El historial vive en generations.

alter table campaign_items
  add column if not exists storyboard_image_id      uuid references media_references(id) on delete set null,
  add column if not exists storyboard_generation_id uuid references generations(id)       on delete set null;

comment on column campaign_items.storyboard_image_id is
  'media_reference del panel VIGENTE de este beat (null = sin panel). Referencia del video en modo storyboard.';
comment on column campaign_items.storyboard_generation_id is
  'Ultima generacion (FLUX o edicion Nano Banana) del panel, para encadenar la edicion iterativa.';
