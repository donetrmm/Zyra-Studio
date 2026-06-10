-- 021_v2_brand_cast.sql
-- Fase A de V2: Brand Kit y Cast pasan a columna vertebral de consistencia
-- (doc V2 §4.4). Solo columnas nuevas; lo existente no se toca.

-- Producto multi-ángulo (frontal, perfil, detalle, logo) y empaque.
-- Los ids apuntan a media_references (V1), igual que reference_image_ids.
alter table brand_kits
  add column if not exists product_image_ids uuid[] not null default array[]::uuid[],
  add column if not exists packaging_image_ids uuid[] not null default array[]::uuid[];

-- Hoja maestra del personaje (frontal, expresión neutra, alta resolución):
-- la misma imagen se inyecta en TODAS las generaciones donde aparece.
-- angle_image_ids: perfil y 3/4 opcionales para multi-ángulo.
alter table characters
  add column if not exists master_image_id uuid,
  add column if not exists angle_image_ids uuid[] not null default array[]::uuid[];
