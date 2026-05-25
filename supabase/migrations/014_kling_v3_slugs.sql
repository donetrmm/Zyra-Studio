-- Kling slugs en fal.ai cambiaron de v2.6 (no existía) a v3.
-- Actualizar model_pricing para que coincida con los slugs reales de fal.ai.
update model_pricing
  set model_id = 'fal-ai/kling-video/v3/standard/text-to-video'
  where provider = 'kling'
    and model_id = 'fal-ai/kling-video/v2.6/standard/text-to-video';

update model_pricing
  set model_id = 'fal-ai/kling-video/v3/pro/text-to-video'
  where provider = 'kling'
    and model_id = 'fal-ai/kling-video/v2.6/pro/text-to-video';

-- Actualizar generations existentes que quedaron con slugs v2.6
update generations
  set model_id = 'fal-ai/kling-video/v3/standard/text-to-video'
  where model_id = 'fal-ai/kling-video/v2.6/standard/text-to-video';

update generations
  set model_id = 'fal-ai/kling-video/v3/pro/text-to-video'
  where model_id = 'fal-ai/kling-video/v2.6/pro/text-to-video';

update generations
  set model_id = 'fal-ai/kling-video/v3/standard/image-to-video'
  where model_id = 'fal-ai/kling-video/v2.6/standard/image-to-video';
