-- 024_v2_seedance.sql
-- Seedance 2.0 (fal.ai) como modelo de video principal de V2:
-- 1) habilita el provider en generations, 2) carga pricing per-second.

-- ============ 1. Provider check ============
alter table generations drop constraint if exists generations_provider_check;
alter table generations add constraint generations_provider_check
  check (provider in ('veo', 'kling', 'nano-banana', 'flux', 'elevenlabs', 'seedance'));

-- ============ 2. Pricing per-second ============
-- Costo fal.ai (junio 2026, audio incluido): std 720p $0.3034/s · std 1080p
-- $0.682/s · fast 720p $0.2419/s · fast 480p sin precio publicado (asumimos
-- ~60% del fast 720p; ajustar tras el smoke test con el costo real).
-- Créditos con margen sobre el peor caso del catálogo de packs (018:
-- studio 15000 cr / $999 MXN ≈ $0.0037 USD/cr → breakeven std 720p ≈ 82 cr/s).
-- Editable después desde /admin/pricing.
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  -- draft (exploración barata)
  ('seedance', 'bytedance/seedance-2.0/fast/text-to-video',      'per_second_480p',  45, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/fast/image-to-video',     'per_second_480p',  45, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/fast/reference-to-video', 'per_second_480p',  45, 1, 'segundo'),
  -- iteración
  ('seedance', 'bytedance/seedance-2.0/fast/text-to-video',      'per_second_720p',  80, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/fast/image-to-video',     'per_second_720p',  80, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/fast/reference-to-video', 'per_second_720p',  80, 1, 'segundo'),
  -- render final
  ('seedance', 'bytedance/seedance-2.0/text-to-video',           'per_second_720p', 100, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/image-to-video',          'per_second_720p', 100, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/reference-to-video',      'per_second_720p', 100, 1, 'segundo'),
  -- hero pieces
  ('seedance', 'bytedance/seedance-2.0/text-to-video',           'per_second_1080p', 220, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/image-to-video',          'per_second_1080p', 220, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/reference-to-video',      'per_second_1080p', 220, 1, 'segundo')
on conflict (provider, model_id, variant) do nothing;
