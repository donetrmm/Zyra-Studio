-- 054: selección manual de referencias de video por campaña (feature priorizador).
--
-- { "include": ["<storage_path>", ...] } — lista de paths de referencias que el
-- usuario quiere mandar al modelo de video. null = recorte automático actual
-- (producto 3 > empaque 2 > cast > locación > mapa de escala > extras, tope 9).
-- Se intersecta con el pool real al guardar y al aplicar (paths stale filtran a
-- no-op). Sin RLS nueva: cuelga de campaigns, que ya tiene policies por workspace.

alter table campaigns add column if not exists reference_selection jsonb;
