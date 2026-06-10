# Fase C — Campaign Studio mínimo

> **~3 días · ~22 horas**
>
> La vertical: brief → plan editable → producción por lotes con compuertas → librería por
> campaña. Fuente: doc V2 §4.1 y §5.2. Todo sobre la cola QStash y el patrón Realtime de V1.

## Pre-requisitos

- Fases A y B cerradas.
- Revisar `.cursor/rules/40-worker.mdc` y `60-credits.mdc` antes de tocar worker/créditos.

## Objetivo

Al cerrar la fase, un usuario puede: crear una campaña desde una imagen de producto, recibir
un plan de N creativos propuesto por el Prompt Director, editarlo, aprobar un lote con muestra
de 2-3, ver el progreso en tiempo real y encontrar los resultados agrupados por campaña en
la librería.

## Tareas en orden

### 1. Server actions `server-actions/campaigns.ts` (3h)

Validación zod (`lib/schemas/campaigns.ts`) + ownership por workspace en cada una:

- `createCampaignFromBrief(productImageRef | productUrl, goal?)` — dispara auto-detección
  (ver tarea 2), crea `campaigns` row en status `draft`.
- `generatePlan(campaignId, totalItems)` — produce los `campaign_items` (tarea 3).
- `updateCampaignItem(itemId, patch)` / `removeItem` / `addItem`.
- `approveBatch(campaignId, formatId, mode: 'sample' | 'full')` — reserva créditos del lote
  y encola (tarea 5).
- `approveSamples(campaignId, formatId)` / `redoSamples(...)`.

### 2. Auto-detección de brief (2.5h)

`lib/campaigns/brief.ts`: con la imagen del producto (vía el modelo multimodal ya integrado)
inferir: categoría, variantes/SKUs visibles, paleta del empaque, demográfico aparente.
Si hay URL, fetch server-side y extraer nombre/claims/tono. Guardar en
`campaigns.product_brief` (jsonb). Defaults: market global/es-en, goal mixed — editables,
nunca preguntar lo que se puede inferir (principio del doc V2: minimizar decisiones).

### 3. Generador de plan `lib/campaigns/planner.ts` (3h)

- Propone el mix de formatos según categoría del producto (mapa propio: ej. sin empaque
  significativo → sin El Descubrimiento; producto digital → sin El Ícono físico).
- Reparte N items entre los formatos del mix con variedad de escenas (de `scene_library`)
  y de personajes (del Cast) — **no repetir escena+personaje dentro del mismo formato**.
- Para cada item llama a `promptDirector.compile()` y guarda el scene_prompt + warnings.
- Distribuye `scheduled_date` intercalando formatos en el rango de la campaña.
- Calcula `credits_estimated` (extiende `lib/credits/estimator` con duración × tier).

### 4. UI del Campaign Studio (6h)

Ruta `app/app/campaigns/[id]` (la lista ya existe en V1 como carpetas):

- **Wizard de brief** (`/app/campaigns/new`): subir producto o URL → preview de la
  auto-detección (editable) → slider de volumen (defaults 10/20/30 — techo demo, doc V2
  §5.5) → crear.
- **Vista de plan**: tabla de items agrupada por formato (shadcn DataTable), edición inline
  de scene_prompt/escena/personaje/fecha, badges de warnings del validador, totales de
  créditos estimados vs balance.
- **Vista de producción**: por formato, card de lote con CTA "Generar muestra (2-3)" →
  al aprobar muestra, "Generar lote completo". Progreso por item vía Realtime
  (suscripción a `generations` filtrada por campaign_id — patrón V1, recordar setAuth).
- **Librería por campaña**: grid de resultados reutilizando los cards de `components/library/`
  con filtro campaign_id (la FK ya existe desde 016).

Server Components por default; `'use client'` solo en tabla editable y progreso.

### 5. Orquestador y cadenas de jobs (4h)

`lib/campaigns/orchestrator.ts` + `lib/jobs/chains.ts`:

- `approveBatch` reserva créditos de todo el lote (loop de `reserve_credits` por item dentro
  de una transacción de orquestación; el reembolso por item fallido ya existe).
- Encola cada item como job V1 normal con `campaign_item_id` en metadata, con
  **escalonamiento**: QStash `delay` incremental (ej. 15–30 s entre jobs) para no reventar
  rate limits de fal.ai ni invocaciones Vercel (doc V2 §5.5).
- Muestra (`mode: 'sample'`): toma 2-3 items representativos del lote (escenas distintas),
  resto queda `planned`.
- El worker (`/api/jobs/process`) no cambia su contrato: al finalizar un job con
  `campaign_item_id`, `finalize.ts` actualiza también `campaign_items.status` y
  `generation_id`.
- Draft vs final: items nuevos se generan en tier draft (Fast 480p); "Aprobar para final"
  re-encola el item con tier final (Standard 720p) reutilizando el mismo prompt y seed.

### 6. Estimador y guardas (2h)

- `lib/credits/estimator.ts`: costo por item = duración × precio/s del tier + margen;
  agregado por lote y por campaña.
- Guarda: si balance < estimado del lote → bloquear approve con CTA de compra (flujo V1).
- Límite demo: máx items por campaña configurable (default 30), declarado en la UI.

### 7. Tests (1.5h)

- planner: mix por categoría, no-repetición escena+personaje, reparto de fechas.
- orchestrator: reserva por lote, escalonamiento de delays, sample → full.
- Mocks de QStash y proveedores (regla del repo: sin APIs reales).

## Criterio de cierre

- Flujo completo en local con mocks: brief → plan de 10 → muestra de 2 → lote → librería.
- Smoke test real (usuario): campaña de 4-6 items en draft con Seedance Fast.
- RLS verificado: un miembro de otro workspace no ve la campaña ni sus items.
- `pnpm typecheck` y tests verdes.
