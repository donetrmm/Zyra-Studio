# 19 — Auto-review de calidad de outputs

Estado: fase 1 implementada (2026-07-14) — detectar y marcar, solo imágenes.

## Problema

Ningún output se revisaba: manos deformes, texto corrupto o rostros derretidos
llegaban a la biblioteca (y al anuncio) sin ninguna señal. Para un producto de
ads es el mayor riesgo de calidad percibida.

## Fase 1 (implementada)

- **Detectar y marcar, nunca re-generar** (decisión 2026-07-14): el reintento
  lo decide el usuario con los flujos de regeneración existentes. El costo del
  review lo absorbe la casa (~fracción de centavo por imagen con Flash).
- **Runner** `lib/quality/review.ts`: `gemini-2.5-flash` vía gateway con el
  thumbnail (512px, ~30KB — suficiente para defectos, evita subir PNG de
  varios MB) + el prompt capado a 2000 chars como contexto del sujeto.
  Salida JSON estricta `{score 0-100, flags[], summary}` validada con zod;
  flags fuera del enum cerrado se descartan (los LLM inventan códigos).
- **Códigos**: deformed_hands, distorted_face, deformed_body, garbled_text,
  warped_product, artifacts. Etiquetas ES en la UI.
- **Job dedicado** `action='quality_review'` en el worker (patrón
  promote/advance: se intercepta antes del guard terminal, presupuesto fresco,
  nunca inline tras 'done'). Best-effort: cualquier fallo se loguea y ack'ea —
  no se hace 500 (un badge no vale un ciclo de retries).
- **Encolado** tras `completeGeneration` en `finalizeGeneration` (worker) y en
  el path síncrono de imagen (`submitGenerationAction`). Solo `type='image'`.
- **Persistencia**: migración 067 — `quality_score smallint`,
  `quality_flags text[]`, `quality_summary text` en `generations`. null = sin
  revisar (histórico o review fallido). Guard `quality_score is null` hace el
  job idempotente ante entregas duplicadas.
- **UI**: badge ámbar en el tile de la Biblioteca (tooltip con el resumen) y
  panel en el DetailAside con score y defectos.

## Fase 2 (pendiente de diseño)

- Video: muestrear 2-3 frames (inicio/medio/fin) y revisar consistencia.
- Reintento automático opt-in con política de cobro explícita.
- Umbral configurable y métrica agregada (tasa de defectos por modelo) en
  admin — insumo para el router de modelos.

## No hacer

- No bloquear ni retrasar el 'done' por el review (corre después, aparte).
- No re-generar sin decisión explícita del usuario.
- No revisar el output full-res (el thumbnail basta y es 100x más barato).
