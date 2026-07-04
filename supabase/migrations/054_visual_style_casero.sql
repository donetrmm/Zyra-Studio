-- Preset de estilo 'casero' (feedback 2026-07-04): captura de smartphone/UGC
-- como quinto perfil de estilo visual. Solo amplía el check constraint; el
-- default sigue siendo ultra_realista.
alter table campaigns
  drop constraint if exists campaigns_visual_style_check;

alter table campaigns
  add constraint campaigns_visual_style_check
  check (visual_style in ('ultra_realista', 'casero', 'fantasia', 'animado', 'custom'));

comment on column campaigns.visual_style is
  'Perfil de estilo visual: ultra_realista | casero | fantasia | animado | custom';
