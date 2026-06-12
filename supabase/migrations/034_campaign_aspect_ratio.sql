-- 034_campaign_aspect_ratio.sql
-- Formato de video elegible al crear la campaña (9:16 / 16:9 / 1:1).
-- Aplica como default a todos los creativos del plan; cada item puede
-- cambiarlo después en la edición. Validación de valores en zod.

alter table campaigns
  add column if not exists aspect_ratio text not null default '9:16';

comment on column campaigns.aspect_ratio is
  'Formato de video de la campaña (9:16, 16:9 o 1:1, migración 034). Default de los items del plan; editable por item.';
