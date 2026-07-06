-- 058_transition_hint.sql
-- Pista de transición por clip (ingesta de prompt maestro, spec v2/15): el beat/
-- encuadre sobre el que cae el corte al siguiente clip. Solo metadato de edición;
-- el contenido del beat vive en scene_prompt. Nullable: los items sin transición
-- (clips sueltos, plan por mix) lo dejan null.
alter table campaign_items
  add column if not exists transition_hint text;
