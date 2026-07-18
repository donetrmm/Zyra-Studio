# Multi-producto por clip · Diseño

**Fecha:** 2026-07-15
**Estado:** diseño aprobado en brainstorming (pendiente review del spec → writing-plans)
**Rama base:** `development`
**Caso disparador:** Anuncio #15, clips 11 y 12 — clips "showcase" donde deben aparecer todos los productos de la campaña, pero el selector por clip solo permite uno.

## Objetivo

Un clip (`campaign_item`) puede llevar **cualquier subconjunto** de los productos del pool de la campaña (1, 2 o todos). La inferencia asigna varios productos cuando el guion los nombra (o usa frases colectivas), el tablero permite corregir con un multi-select, y el compiler describe/referencia todos los productos del clip con mitigaciones explícitas al problema de conteo de Seedance.

## Reversión de un no-objetivo del spec V3 (documentada)

El diseño V3 (`2026-07-09-v3-multiproducto-design.md`) excluyó "varios productos en un mismo clip" porque Seedance falla en conteo con múltiples productos en una toma. **Esa exclusión se revierte el 2026-07-15, solo para clips explícitamente multi-producto**, con tres mitigaciones que el recorte original no contemplaba:

1. **Enumeración con conteo exacto** en el prompt ("exactly N distinct products: A, B, C — render each exactly once").
2. **1 referencia limpia por producto** (menos confusión de vistas múltiples).
3. **Descripciones compactas por producto** (sin saturar el prompt con N fichas completas).

Si aun así Seedance duplica/fusiona productos en un showcase, el fallback es guion (montaje entre clips), no más código.

## Decisiones cerradas (respuestas del usuario, 2026-07-15)

1. **Subconjunto arbitrario** por clip (no solo un modo "todos").
2. **La inferencia auto-asigna** cuando el texto nombra 2+ productos o usa frases colectivas; el tablero corrige.
3. **Auto-recorte de referencias** cuando no caben en el tope de Seedance, **más una alerta visual en cualquier clip** (multi-producto o no) cuyo pool estimado supere las 9 imágenes, para que el usuario sepa que debe priorizar en el diálogo de referencias.

## Modelo de datos (migración 070)

- `campaign_items` + `product_ids uuid[] not null default '{}'` — espeja el patrón existente de `character_ids[]`.
- Backfill idempotente: `product_ids = array[product_id]` donde `product_id is not null` y `product_ids = '{}'`.
- `campaign_items.product_id` queda **deprecada** (legible en transición; el pipeline nuevo NO la lee ni la escribe).
- Sin FK por elemento (los arrays no la soportan): `resolveItemProduct` ya valida existencia/workspace y descarta ids que no resuelven — mismo trato que hoy tiene el cast.
- **Orden de deploy:** aplicar la 070 vía MCP **antes** de pushear código que lea `product_ids` (regla migración→push).

## Inferencia (`lib/campaigns/infer-assignment.ts`)

`inferProductsForClip(clipText, pool): { productIds: string[]; confidence: 'high' | 'none' }`:

- Pool vacío → `{ productIds: [], confidence: 'none' }`.
- Pool de exactamente 1 → ese producto, `high` (comportamiento actual).
- El texto nombra k ≥ 1 productos claramente (mismas reglas de match actuales: slug/name/tokens) → **los k**, `high`. El caso "ambiguo" actual (nombrar 2 → `low` + desempate manual) desaparece: nombrar 2 es asignación doble.
- Frases colectivas → **pool completo**, `high`: "todos los productos", "toda la colección", "la colección completa", "todos los cuadros/las piezas", y numerales que coinciden con el tamaño del pool ("los tres cuadros" con pool de 3).
- No nombra ninguno → `{ productIds: [], confidence: 'none' }`; queda "sin asignar" y el tablero lo pide.

`generatePlanAction` pre-llena `product_ids` con los resultados `high` (hoy hace lo mismo con el singular).

## Server action y schema

- `SetItemProductsSchema = { itemId: uuid, productIds: uuid[] }` en `lib/schemas/campaigns.ts`.
- `setItemProductsAction` reemplaza a `setItemProductAction`: valida ownership (item→campaign→workspace), valida que **cada** id esté en `campaign_products` de esa campaña, respeta el gating de estado actual (`planned/skipped/failed`), escribe `product_ids`.

## Orchestrator y DirectorContext

- El punto de resolución por ítem (hoy `resolveItemProduct(item.product_id)`) itera `item.product_ids`; los ids que no resuelven se descartan en silencio (como el cast).
- `DirectorContext.product?: ProductInventory` → `products?: ProductInventory[]`. Se actualizan **todos** los lectores: compiler Seedance, `video-prose`, el pool de referencias por ítem (`reference-pool`/diálogo de Fase 4) y los paneles de storyboard (`panel-asset`), que reciben la misma lista con sus propios caps de refs (FLUX/Nano ya los aplican).
- El fallback actual (ítem sin asignación → producto de campaña) se conserva: array vacío → fallback, igual que hoy con `product_id = null`.
- **Paridad garantizada:** con `products.length === 1` la salida del pipeline es idéntica a la actual (test de paridad, ver Testing).
- Encadenados: verificar en implementación que `advanceSequenceChain`/`buildContinuationPrompt` re-anclen los productos del ítem por la misma vía compartida (hay un gap de paridad conocido en ese camino).

## Compiler Seedance

- **1 producto: cero cambios.** Ficha completa (`describeProduct`), escala (`describeProductScale`), peso, staging — todo lo actual.
- **2+ productos:**
  - Cada producto se describe **compacto**: nombre, medium, detalles visuales, paleta y dimensiones declaradas (sin la escalera completa de staging proporcional ni la cláusula de peso, que están pensadas para una sola pieza y saturarían el prompt).
  - **Cláusula anti-conteo** (la mitigación central): "The scene contains exactly N distinct products: A, B, C — render each exactly once, at its true relative size; do not duplicate, merge or invent additional products."
  - Citas `@imageN` agrupadas por producto ("@image1 is the product A…", "@image2 is the product B…").
  - La línea actual "the product reference images show the SAME single product" se emite **por producto** solo cuando ese producto aporta 2+ vistas — nunca globalmente entre productos distintos.

## Presupuesto de referencias + alerta visual

- Auto-recorte en `buildReferences` (imágenes por producto según cuántos van en el clip): 1 producto → 3 (actual), 2 productos → 2 c/u, 3+ → 1 c/u (la principal). El orden de prioridad global (producto > empaque > personaje > locación > mapa de escala > extra) y el tope de 9 con warning quedan como están.
- **Empaque solo en clips de un producto** (comportamiento actual); en multi-producto se recorta por default y el diálogo manual puede re-incluirlo.
- La lógica de presupuesto se extrae a un helper puro (`estimateImageRefs`) para que el studio calcule el conteo estimado por clip al cargar.
- **Alerta visual:** cualquier clip cuyo pool estimado supere 9 imágenes muestra un badge ámbar en su fila del tablero (p. ej. "Referencias 12/9") que abre el diálogo de referencias del clip. El diálogo muestra el contador y avisa también cuando la **selección manual** excede 9 (la red del tope global sigue recortando en el compiler).

## UI del tablero (PlanTable)

- El `<Select>` de producto por fila pasa a **multi-select** (popover con checkboxes, patrón shadcn existente).
- Texto mostrado: nombre del producto si es 1; "N productos" si son varios; "Sin asignar" resaltado (ámbar/rojo, como hoy) si el array está vacío.
- **Gating sin cambio de regla:** campaña con marca + pool → un clip con `product_ids = '{}'` bloquea Generar (cliente y servidor), mismo mensaje y misma condición que hoy con el singular.

## Testing

Unit, sin APIs reales (patrón del repo):

- Inferencia multi: nombra 2 → ambos; frase colectiva → pool completo; numeral coincidente → pool completo; no nombra → none; pool de 1 → high (regresión).
- Presupuesto: `estimateImageRefs` (3/2/1 por producto, empaque solo single, cast/locación intactos).
- Compiler: enumeración anti-conteo, citas agrupadas por producto, "SAME single product" scoped, y **paridad byte-a-byte** del prompt con 1 producto vs. el compiler actual.
- Pool del diálogo por ítem con varios productos.

Smoke con API real (lo corre el usuario): Anuncio #15, clips 11 y 12 con todos los productos asignados → verificar conteo correcto de productos en el video y el badge de referencias.

## Riesgos

- **Calidad Seedance en conteo:** mitigado (enumeración exacta, 1 ref/producto, descripciones compactas); si falla, el fallback es guion, no código.
- **Prompt cerca del techo de caracteres:** N descripciones compactas suman; el compiler ya recorta solo la acción cuando excede — vigilar en smoke.
- **Superficie de cambio** (`DirectorContext.product` → `products`): contenida por el test de paridad single-producto y porque los lectores son enumerables (compilers, reference-pool, panel-asset).
- **Migración:** backfill acotado (una pasada sobre `campaign_items`), aplicar vía MCP antes del push.
