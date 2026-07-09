# 1to1 Studio V3 — Multi-producto por campaña · Diseño

**Fecha:** 2026-07-09
**Estado:** diseño aprobado en brainstorming (pendiente review del spec → writing-plans por fase)
**Rama base:** `development` (el branch `V3` viejo es un refactor stale, NO la base)

## Objetivo

Una campaña puede llevar **varios productos de una misma marca**, y cada clip muestra **un** producto, asignado (inferido + confirmable) según lo que dice el guion. Requisito transversal: **arquitectura limpia** para no complicar futuras actualizaciones.

## No-objetivos (recorte explícito 2026-07-09)

- **Multimarca:** descartado. Una marca por campaña (como hoy). Nada de `brand` por clip ni pool cross-marca.
- **Varios productos en un mismo clip:** fuera. Seedance falla en conteo con múltiples productos en una toma; la variedad se ve en el montaje entre clips (un producto por clip).
- **Unir clips en un solo MP4 dentro de la plataforma:** hueco preexistente, no se aborda aquí.

## Contexto del código (hoy)

- El producto está **partido**: imágenes en `brand_kits.product_image_ids` (reusable, por marca) y ficha física en `campaigns.product_brief` (jsonb, por campaña). Smell que este diseño corrige.
- `brand_kits` ya es la **Brand** de facto (name, colors, fonts, logo_url, tone_description, style_guidelines, product/packaging/reference_image_ids).
- `campaign_items` ya tiene por clip: `location_id` (+ acción de set), `character_ids[]` (máx 3), `reference_ids[]`. El ingest/planner ya infiere locación y cast por clip.
- Selección de referencias hoy es **por campaña** (`campaigns.reference_selection`); `lib/campaigns/reference-selection.ts::applyReferenceSelection` filtra el DirectorContext **upstream** (nunca post-filtro, por las citas `@imageN`).
- Regla de despliegue (memoria): prod sigue `development`; las migraciones NO se auto-aplican → aplicar vía MCP **antes** de desplegar código que lea columnas nuevas. Evitar UPDATEs masivos cerca del límite de disco (el backfill aquí es acotado: nº de campañas).

## Modelo de datos

### Nueva tabla `products` (workspace-level, reusable)

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid NOT NULL | RLS por workspace |
| `brand_id` | uuid NULL → `brand_kits` | NULL = producto sin marca (without-brand) |
| `name` | text NOT NULL | |
| `slug` | text | referencia estable para el matcher (los LLM citan slugs, no UUIDs — ver matcher de formatos) |
| `medium` | text | de `product_brief` |
| `height_cm` | numeric | |
| `width_cm` | numeric | |
| `thickness_mm` | numeric | |
| `weight_kg` | numeric | |
| `visual_details` | text | |
| `palette` | jsonb | |
| `product_image_ids` | uuid[] | migradas desde `brand_kits` |
| `packaging_image_ids` | uuid[] | migradas desde `brand_kits` |
| `created_at`, `updated_at` | timestamptz | |

Junta **ficha + imágenes** por producto → mata el split actual. Un `brand_kit` (marca) posee 0..N products.

### `campaign_items` (por clip)

- `+ product_id` uuid NULL → `products`. La marca se **deriva** de `product.brand_id`.
- `+ reference_selection` jsonb NULL. Prioridad de referencias **por clip** (movida desde `campaigns`).
- `location_id`, `character_ids[]` ya existen.

### `campaigns`

- `brand_kit_id` sigue **único** por campaña (la marca de la pieza; NULL = without-brand). Sin enum de modos.
- `product_brief` **deprecado** tras migrar (se deja readable en transición; el pipeline nuevo NO lo lee).
- `reference_selection` **deprecado** (movido a `campaign_items`).

### Nueva tabla `campaign_products` (join = pool de la campaña)

| Columna | Tipo |
|---|---|
| `campaign_id` | uuid → campaigns |
| `product_id` | uuid → products |
| PK | (`campaign_id`, `product_id`) |

El **pool** de productos disponibles para la asignación por clip (subconjunto seleccionado de los products de la marca).

## Migración de lo existente

Por cada campaña con `product_brief` (o imágenes de producto en su brand_kit):
1. Crear **un** `products` (brand_id = `campaign.brand_kit_id`, ficha del `product_brief`, imágenes del brand_kit, `slug` derivado del name).
2. Insertar `(campaign_id, product.id)` en `campaign_products`.
3. Setear `campaign_items.product_id = product.id` en todos sus ítems.
4. Copiar `campaigns.reference_selection` → `campaign_items.reference_selection` de cada ítem (o dejar NULL = automático).

Nadie pierde datos; las campañas actuales quedan como single-brand/single-product respaldadas por `products`. Backfill acotado (por campaña), aplicado vía MCP antes del deploy.

## Arquitectura limpia — 4 unidades desacopladas

1. **Inferencia (pura, testeable, sin IO):**
   `inferAssignment(clipText, pool: { products, locations, cast }) → { product_id, location_id, character_ids, confidence }`.
   Matchea el texto del clip a un product del pool por `slug`/`name`/`visual_details`. En `lib/campaigns` o `lib/prompt-director`.
2. **Persistencia (server actions):** un action de "asignación por ítem" que unifica set-product / set-location / set-characters / set-reference-selection (hoy ya existen set-location y set-character; se extiende con product).
3. **Resolución (orchestrator):** `buildCampaignContext`/`loadCampaignContext` resuelven el producto **del ítem** (`item.product_id`), no `campaign.product_brief`; aplican la `reference_selection` **del ítem** al construir el contexto del clip. `reference-pool`/`reference-selection` pasan a por-ítem (ya son casi puros).
4. **UI:** el **tablero de asignación por clip** (extiende el editor por clip existente tras "Analizar prompt" / studio, no pantalla nueva) + el diálogo de referencias por ítem (componente reusado, scoped al ítem).

Cada unidad se entiende y testea sola; cambiar el interior de una no rompe a las otras.

## Flujo de asignación por clip (tablero)

Aparece **antes de generar**. Una fila por clip:

| Campo | Inferido de | Si no se infiere |
|---|---|---|
| Producto | texto del clip ↔ pool (slug/name/descr.) | "sin asignar" → resaltado, **bloquea generar** |
| Locación | ya se infiere hoy | dropdown del set de la campaña |
| Personaje(s) | ya se infiere hoy (máx 3) | multi-select del cast |
| Referencias | automático (default) | botón "personalizar" → diálogo de refs del clip |

Estado por campo: default pre-llenado si la inferencia tuvo confianza; si no, "confirma". Generar se bloquea solo si falta un campo requerido (clip con marca necesita producto; without-brand no).

**Constraint honesto:** la inferencia de producto es buena solo si el master **nombra los productos distinto por clip** (por eso el `slug`). Guion vago → asignación manual; el tablero de confirm/override es central, no un extra.

## Prioridad de referencias por clip

- Pool de cada clip = imágenes de **su producto** (+empaque) + activos compartidos (su locación, masters/ángulos de su cast).
- Se guarda en `campaign_items.reference_selection`; `applyReferenceSelection` corre **por ítem** al construir su contexto.
- **Default = automático** (comportamiento actual); la selección manual es opt-in por clip.

## Fases (cada una su spec → plan → implementación)

1. **Fundación de datos:** `products`, `campaign_products`, `campaign_items.product_id`, migración, orchestrator resuelve producto del ítem, ingest escribe products. *Entrega: campañas actuales igual, respaldadas por `products`.*
2. **Biblioteca de productos + pool:** CRUD reusable de products (por marca), pre-selección al crear campaña (`campaign_products`), without-brand. *Entrega: construir/seleccionar productos antes de crear.*
3. **Asignación por clip:** inferencia pura + tablero (producto/locación/personajes, confirm/override, gating), action de asignación por ítem. *Entrega: cada clip con producto inferido/confirmable.*
4. **Prioridad de referencias por clip:** `reference_selection` → por ítem, pool/diálogo scoped al producto del clip, orchestrator aplica por ítem. *Entrega: priorizar refs por clip.*

Orden por dependencia limpia: 1 → 2 → 3 → 4, cada una shippable y testeable sola.

## Testing

- Unit (sin APIs reales): inferencia pura (match por slug/name/descr., confianza, sin-match), `applyReferenceSelection` por ítem, parte pura del backfill de migración, resolución por-ítem del orchestrator.
- Smoke con API real (los corre el usuario): ingest que escribe products, generación de un clip resolviendo su producto.

## Riesgos

- **Calidad de inferencia** atada a que el master nombre productos distinto (mitigado con `slug` + tablero de confirm/override).
- **Migración:** correctness del backfill; aplicar vía MCP **antes** del deploy (regla de orden); backfill acotado para no rozar el límite de disco.
- **Superficie de cambio** del pipeline (ingest, orchestrator, compiler, UI): contenida por los 4 límites y la entrega por fases.
