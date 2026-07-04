-- Fuente de audio de referencia para clips ENCADENADOS (spike 2026-07-04):
-- 'music' = la pista musical de la campaña (P16, comportamiento actual);
-- 'prev_clip' = el audio del clip anterior (consistencia de voz/ambiente entre
-- clips). Son excluyentes porque Seedance limita las referencias de audio a
-- 15s combinados. Lo decide el usuario en el wizard.
alter table campaigns
  add column if not exists chain_audio_source text not null default 'music'
    constraint campaigns_chain_audio_source_check
    check (chain_audio_source in ('music', 'prev_clip'));

comment on column campaigns.chain_audio_source is
  'Audio de referencia en clips encadenados: music (pista P16) | prev_clip (audio del clip anterior)';
