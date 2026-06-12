-- 033_scene_summary.sql
-- Resumen de la escena/acción en el idioma de la campaña, SOLO para mostrar
-- en la UI. El prompt de generación (scene_prompt) sigue siempre en inglés
-- (rinde mejor en el modelo); este campo es su cara legible.

alter table campaign_items
  add column if not exists scene_summary text;

comment on column campaign_items.scene_summary is
  'Resumen corto de la acción en el idioma de la campaña (migración 033). Solo display; scene_prompt (inglés) es lo que se compila.';
