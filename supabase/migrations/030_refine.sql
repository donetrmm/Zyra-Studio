-- 030_refine.sql
-- Refinado conversacional (specs/v2/07): la toma elegida y las referencias
-- del creativo quedan estructuradas en campaign_items (las plantillas vivas
-- y los compilers las consumen sin parsear el prompt). Pricing de la sesión
-- como operación interna (mismo mecanismo que prompt-enhance, 009).

alter table campaign_items
  add column if not exists shot text,
  add column if not exists reference_ids uuid[] not null default '{}';

insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('internal', 'refine-session', 'default', 8, null, null)
on conflict (provider, model_id, variant) do nothing;
