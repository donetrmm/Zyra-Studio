-- 005_seed_pricing.sql
-- Seed inicial de `model_pricing`. ON CONFLICT DO NOTHING para no pisar precios
-- que admin haya editado vía panel después de la primera carga.
-- 22 filas: 15 video + 6 imagen + 6 audio = 27. (Algunos modelos tienen
-- múltiples variants; el total exacto está abajo.)

insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  -- ============ VIDEO ============
  ('veo',         'veo-3.1-generate-preview',         '1080p_8s',     2000, null, null),
  ('veo',         'veo-3.1-generate-preview',         '4k_8s',        3800, null, null),
  ('veo',         'veo-3.1-generate-preview',         '720p_8s',      1500, null, null),
  ('veo',         'veo-3.1-fast-generate-preview',    '1080p_8s',      750, null, null),
  ('veo',         'veo-3.1-fast-generate-preview',    '720p_8s',       500, null, null),
  ('veo',         'veo-3.1-lite-generate-preview',    '720p_8s',       400, null, null),

  ('kling',       'kling-video-o1',                   'pro_5s',        700, null, null),
  ('kling',       'kling-video-o1',                   'pro_10s',      1400, null, null),
  ('kling',       'kling-3-0-omni',                   'pro_5s_audio',  500, null, null),
  ('kling',       'kling-v2.6-pro',                   'std_5s',        350, null, null),
  ('kling',       'kling-v2.6-pro',                   'std_10s',       700, null, null),
  ('kling',       'kling-v2.6-std',                   'std_5s',        220, null, null),
  ('kling',       'kling-v2.5-turbo',                 'std_5s',        180, null, null),
  ('kling',       'extend',                           'default',       350,    5, 'seconds'),
  ('kling',       'lip-sync',                         'default',       220, null, null),

  -- ============ IMAGEN ============
  ('nano-banana', 'gemini-3-pro-image-preview',       '1k',             60, null, null),
  ('nano-banana', 'gemini-3-pro-image-preview',       '2k',             90, null, null),
  ('nano-banana', 'gemini-3-pro-image-preview',       '4k',            120, null, null),
  ('nano-banana', 'gemini-3.1-flash-image-preview',   '1k',             30, null, null),
  ('nano-banana', 'gemini-3.1-flash-image-preview',   '2k',             50, null, null),
  ('flux',        'flux-2-pro-preview',               'default',        25,    1, 'mp'),

  -- ============ AUDIO ============
  ('elevenlabs',  'eleven_v3',                        'default',       350, 1000, 'chars'),
  ('elevenlabs',  'eleven_multilingual_v2',           'default',       200, 1000, 'chars'),
  ('elevenlabs',  'eleven_flash_v2_5',                'default',        70, 1000, 'chars'),
  ('elevenlabs',  'voice-clone',                      'setup',         800, null, null),
  ('elevenlabs',  'sound-generation',                 'default',        40, null, null),
  ('elevenlabs',  'dubbing',                          'default',       800,   60, 'seconds')
on conflict (provider, model_id, variant) do nothing;
