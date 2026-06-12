-- 032_campaign_include_packaging.sql
-- Decisión por campaña: incluir o no las imágenes de empaque del Brand Kit.
-- Con false, el plan no propone formatos que exigen empaque y el contexto de
-- generación no envía packaging_image_ids al modelo.

alter table campaigns
  add column if not exists include_packaging boolean not null default true;

comment on column campaigns.include_packaging is
  'Si la campaña usa las imágenes de empaque del Brand Kit (toggle del wizard, migración 032). Default true.';
