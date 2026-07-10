-- 062 Estudio: FLUX.2 [pro] y [max] por el Vercel AI Gateway (bfl/flux-2-pro,
-- bfl/flux-2-max). Precio plano por imagen (variant 'default'). Idempotente.
-- NO se aplica dentro de tareas; el controller la aplica vía MCP ANTES de que
-- prod sirva turnos flux del estudio (si no, estimateCredits lanza y el turno se
-- rechaza como 'Combinación de modelo y calidad no soportada').
--
-- El provider CHECK de generations ya incluye 'flux' (migraciones 001/024/061);
-- no se recrea. Estos model_id ('flux-2-pro'/'flux-2-max') son DISTINTOS del
-- 'flux-2-pro-preview' del storyboard (BFL directo, por-MP), así que no colisiona.
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('flux', 'flux-2-pro', 'default', 120, null, null),
  ('flux', 'flux-2-max', 'default', 200, null, null)
on conflict (provider, model_id, variant) do nothing;
