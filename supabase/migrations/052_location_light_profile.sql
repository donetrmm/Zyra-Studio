-- Perfil de luz y espacio por locación (2026-07-02): descripción EN derivada por
-- visión desde la imagen maestra (fuentes de luz, dirección/temperatura, reflejos
-- de piso/paredes, profundidad y dónde para naturalmente una persona). Se inyecta
-- en el prompt de paneles y video para integrar personajes sin efecto photoshop.
-- Cache: se deriva lazy al generar el primer panel de la locación y se limpia al
-- cambiar la imagen maestra.
alter table locations
  add column if not exists light_profile text;

comment on column locations.light_profile is
  'Perfil de luz/espacio derivado de la imagen maestra (EN, para prompts). Se limpia al cambiar la maestra.';
