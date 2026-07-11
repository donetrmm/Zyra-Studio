-- 063 Estudio de paneles de storyboard: admite asset_type='panel' en studio_sessions.
-- Idempotente. NO se aplica dentro de las tareas; el controller la aplica vía MCP
-- ANTES de desplegar el código que lee el tipo nuevo (orden migración→push).
alter table studio_sessions drop constraint if exists studio_sessions_asset_type_check;
alter table studio_sessions add constraint studio_sessions_asset_type_check
  check (asset_type in ('product', 'location', 'character', 'panel'));
