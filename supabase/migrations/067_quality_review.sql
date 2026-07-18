-- 067: auto-review de calidad de outputs (fase 1: detectar y marcar).
--
-- Un paso de visión (gemini-2.5-flash vía gateway) puntúa cada imagen al
-- completarse y marca defectos típicos de generación (manos, rostro, texto
-- corrupto, producto deformado). NO re-genera ni cobra: el badge en la UI le
-- da al usuario la señal y el reintento lo decide él con los flujos de
-- regeneración existentes (decisión 2026-07-14). El costo del review lo
-- absorbe la casa (fracción de centavo por imagen).
--
-- null = sin revisar (filas históricas o review fallido). flags vacíos con
-- score alto = revisada y limpia.

alter table generations
  add column if not exists quality_score smallint,
  add column if not exists quality_flags text[],
  add column if not exists quality_summary text;
