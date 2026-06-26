-- 047_location_scale_map.sql
-- P15: mapa esquematico top-down de escala/geografia asociado a la locacion.
-- Aditivo: columnas nuevas, sin tocar policies. Ver spec 2026-06-26-p15-mapa-escala-geografia.
alter table locations
  add column if not exists scale_map_image_id uuid,
  add column if not exists scale_map_notes text;

comment on column locations.scale_map_image_id is
  'P15: esquema top-down (planta) que fija escala/posicion de objetos; se cita como rol scale_map y se re-ancla por clip.';
comment on column locations.scale_map_notes is
  'P15: proporciones en texto libre ("la mascota mide 2x el humano, a la izquierda de la puerta"); el compiler las anexa a la directiva del esquema.';
