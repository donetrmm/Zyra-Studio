-- 029_campaign_language.sql
-- Idioma del audio hablado de los creativos. El prompt CRAFT va en inglés
-- (rinde mejor en Seedance), pero sin esta directiva el modelo genera los
-- diálogos en inglés. Default 'es': el mercado principal del producto.

alter table campaigns
  add column if not exists language text not null default 'es'
    check (language in ('es', 'en'));

comment on column campaigns.language is
  'Idioma del diálogo/voz de los videos de la campaña; el Prompt Director lo inyecta como directiva de audio.';
