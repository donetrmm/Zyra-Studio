-- 038_seedance_standard_480p_pricing.sql
-- El seed 024 sembró per_second_480p SOLO para los modelos /fast/. Los modelos
-- estándar (text/image/reference-to-video) quedaron sin fila 480p, aunque el
-- provider y el doc oficial confirman que el estándar SÍ soporta 480p (solo el
-- tier fast no soporta 1080p). Consecuencia: en Crear → Video, elegir 480p con
-- "Seedance 2.0" daba costo 0 y deshabilitaba "Generar" sin explicación.
-- Se agregan las 3 filas faltantes. Precio 56 cr/s: sigue la curva existente
-- (estándar = ~1.25x el fast al mismo res; fast480=45 -> std480≈56).

insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('seedance', 'bytedance/seedance-2.0/text-to-video',      'per_second_480p', 56, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/image-to-video',     'per_second_480p', 56, 1, 'segundo'),
  ('seedance', 'bytedance/seedance-2.0/reference-to-video', 'per_second_480p', 56, 1, 'segundo')
on conflict (provider, model_id, variant) do nothing;
