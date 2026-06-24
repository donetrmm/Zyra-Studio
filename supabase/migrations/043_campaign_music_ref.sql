-- 043_campaign_music_ref.sql
-- P16: pista de audio de referencia de ritmo a nivel campaña. media_references
-- type='audio'; on delete set null para que borrar el audio no rompa la campaña.
alter table campaigns
  add column music_ref_id uuid references media_references(id) on delete set null;

comment on column campaigns.music_ref_id is
  'P16: media_reference (type=audio, <=15s) usada como referencia de ritmo/beat para todos los clips de la campaña.';
