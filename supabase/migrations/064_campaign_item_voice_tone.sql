-- 064 Tono/entrega de voz por clip (Fase 1 audio expresivo). Idempotente.
-- NO se aplica dentro de las tareas; el controller la aplica vía MCP ANTES del
-- deploy (orden migración→push). Nullable, sin default (vacío = default por registro).
alter table campaign_items add column if not exists voice_tone text;
