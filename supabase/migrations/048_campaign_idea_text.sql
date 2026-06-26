-- 048_campaign_idea_text.sql
-- Persiste el texto de la idea del usuario en la campaña, para poder REPROCESAR
-- la idea (re-correr el matcher de Gemini) desde una campaña existente y
-- pre-llenar el diálogo. Aditiva, nullable: null = campaña sin idea (mix).

alter table campaigns
  add column if not exists idea_text text;

comment on column campaigns.idea_text is
  'Texto de la idea del usuario con que se generó/reprocesó el plan; null = sin idea (mix por categoría).';
