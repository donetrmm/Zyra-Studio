-- Kling pasa de pricing flat (200 cr/5s, 400 cr/10s) a per-second (40 cr/s standard, 80 cr/s pro).
-- Esto permite duración flexible 5-10s en la UI.

-- Borrar variantes flat obsoletas
delete from model_pricing
  where provider = 'kling'
    and model_id like 'fal-ai/kling-video/%'
    and variant in ('standard', 'long', 'pro');

-- Insertar pricing per-second
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('kling', 'fal-ai/kling-video/v3/standard/text-to-video', 'per_second', 40, 1, 'segundo'),
  ('kling', 'fal-ai/kling-video/v3/pro/text-to-video',      'per_second', 80, 1, 'segundo'),
  ('kling', 'fal-ai/kling-video/v3/standard/image-to-video', 'per_second', 40, 1, 'segundo')
on conflict (provider, model_id, variant) do nothing;
