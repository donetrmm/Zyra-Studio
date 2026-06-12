-- 035_campaign_sequences.sql
-- Un guion largo puede partirse en una SECUENCIA: N escenas (clips) de un mismo
-- anuncio, en orden. Columnas aditivas; null = creativo independiente (hoy).

alter table campaign_items
  add column if not exists sequence_id    uuid,
  add column if not exists scene_index    integer,
  add column if not exists sequence_label text;

create index if not exists idx_campaign_items_sequence
  on campaign_items(campaign_id, sequence_id, scene_index);

comment on column campaign_items.sequence_id is
  'Agrupa las escenas de un mismo anuncio (secuencia); null = creativo independiente';
comment on column campaign_items.scene_index is
  'Orden 0..N-1 de la escena dentro de la secuencia';
comment on column campaign_items.sequence_label is
  'Titulo del anuncio mostrado en la cabecera de la secuencia';
