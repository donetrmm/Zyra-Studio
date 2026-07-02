-- Perfil de estilo visual por campaña (plan 2026-07-02). Define el look de
-- todas las etapas de generación (planner, panel, refinado, video).
-- text + check constraint, nunca enum nativo (regla 10-database).
-- Default ultra_realista = comportamiento actual.
alter table campaigns
  add column if not exists visual_style text not null default 'ultra_realista'
    constraint campaigns_visual_style_check
    check (visual_style in ('ultra_realista', 'fantasia', 'animado', 'custom')),
  add column if not exists visual_style_custom text;

comment on column campaigns.visual_style is
  'Perfil de estilo visual: ultra_realista | fantasia | animado | custom';
comment on column campaigns.visual_style_custom is
  'Descripción libre del estilo cuando visual_style = custom';
