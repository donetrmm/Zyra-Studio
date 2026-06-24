-- 044_media_reference_usage.sql
-- AM: para qué sirve cada asset (vista del producto). El compiler lo cita junto
-- a la referencia para que el modelo entienda qué muestra cada imagen.
alter table media_references add column usage_description text;

comment on column media_references.usage_description is
  'AM: descripcion de uso del asset (p. ej. "three-quarter view", "logo close-up"). El compiler la cita junto a la referencia.';
