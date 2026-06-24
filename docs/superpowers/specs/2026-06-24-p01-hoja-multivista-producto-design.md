# P01 — Hoja multi-vista de producto

**Fecha:** 2026-06-24
**Cluster:** Pre-producción de assets (sub-proyecto 1 de 3; le siguen AM y P05)
**Esfuerzo:** S-M
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Principio P01 del análisis Higgsfield (`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md`, ficha P01): para todo objeto cuya identidad debe persistir, generar una referencia **multi-vista** (mínimo frontal + 3/4) ANTES de animar. Varias vistas ortogonales reducen la alucinación geométrica de I2V/R2V porque le dan al modelo estructura 3D en vez de obligarlo a inventarla.

**No se clona el artefacto** ("hoja de producto" de Higgsfield); se adapta el principio reusando la maquinaria de generación que ya existe en el repo.

## Estado actual (la brecha, y una corrección al catálogo)

- **El consumo ya existe:** el compiler cita las primeras 3 imágenes del producto como multi-ángulo (`inventory.ts:71-84` "must appear exactly as shown…", `seedance.ts:174` `imagePaths.slice(0,3)`).
- **El motor generativo ya existe** (el catálogo está desactualizado en este punto): `generateAngle` + `editUploaded` (Nano Banana conversacional, rota la cámara preservando identidad) en `components/creation/generate.ts`. Hoy `generateAngle` está cableado para **personas** (Cast) y usa `editImage` (parent conversacional, requiere una imagen *generada*).
- **La brecha real:** no hay forma de generar la vista 3/4 de un **producto** (cuya foto suele ser *subida*, no generada) ni un nudge determinista cuando el producto tiene una sola vista. No falta el motor; falta la variante de producto + el cableado.

## Diseño

Tres piezas pequeñas. **Sin migración** (se reusa `brand_kits.product_image_ids[]`, tope 4, ya existente).

### 1. Generación — `generateProductAngle` (capa de oficio)

En `components/creation/generate.ts`, junto a `generateAngle`/`editUploaded`:

- Un prompt de **producto** (no de persona):

  > "Show the exact same product from a three-quarter view (about 45 degrees). Identical shape, colors, label, logo, materials and proportions; same soft even studio lighting and clean plain background. Only the camera angle changes — keep the product perfectly consistent. Do not alter or invent any label text."

- `generateProductAngle(productRef: { id: string; storagePath: string }, view: 'three-quarter'): Promise<GeneratedImage | GenError>` que delega en **`editUploaded(productRef, PRODUCT_ANGLE_PROMPT[view])`** — la foto subida entra como referencia (no como parent conversacional, porque no hay turn previo del modelo). Mismo retorno y `fixAsReference` que las demás.

Respeta la decisión inmutable "no fabricar texto de marca": el prompt prohíbe alterar/inventar la etiqueta.

### 2. UI — botón en el Brand Kit

En `components/brand-kits/BrandKitsPage.tsx` (donde ya se gestionan las imágenes de producto con `CreationWizard` + `setBrandKitImagesAction`):

- Botón **"Generar vista 3/4"** sobre una imagen de producto subida.
- Al pulsarlo: `generateProductAngle(productRef, 'three-quarter')` → el `refId` resultante se **antepone a `product_image_ids` y se recorta a 4** (mismo patrón que el código existente, `BrandKitsPage.tsx:79` `[result.refId, ...without(...)].slice(0,4)`), persistido con `setBrandKitImagesAction`.
- **Iniciado por el usuario** (no auto): genera créditos, así que nunca se dispara sin su acción explícita.
- Si `product_image_ids` ya tiene 4, el botón se deshabilita con una nota (ya hay multi-vista; el principio está satisfecho).

### 3. Warning determinista (capa de oficio)

Regla nueva en `lib/prompt-director/validators.ts`: si el producto tiene **exactamente 1 imagen de referencia** (`ctx.product?.imagePaths?.length === 1`), emite un warning de producibilidad:

> `producto: vista única — riesgo de deriva geométrica en I2V/R2V; genera un 3/4 en el Brand Kit`

No bloquea (warning, como las demás reglas). El usuario lo ve en `campaign_items.warnings` y el botón (#2) lo resuelve. Es el nudge que conecta la brecha con la solución.

## Consumo (ya existe, sin cambio)

El 3/4 generado entra a `product_image_ids` y el compiler lo cita automáticamente (`inventory.ts` lo describe como referencia exacta; `seedance.ts:174` toma las primeras 3). No se toca el compiler.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `components/creation/generate.ts` | `PRODUCT_ANGLE_PROMPT` + `generateProductAngle` (vía `editUploaded`) |
| `components/brand-kits/BrandKitsPage.tsx` | botón "Generar vista 3/4" + prepend a `product_image_ids` (slice 4) + persistencia |
| `lib/prompt-director/validators.ts` | regla nueva: warning de producto con 1 sola vista |
| `components/creation/generate.test.ts` (o donde vivan los tests de generate) | test de `generateProductAngle` (mock de `submitGenerationAction`) |
| `lib/prompt-director/validators.test.ts` | warning con 1 imagen; ausente con 2+ |

## Tests

- **`generateProductAngle`:** llama `editUploaded` con el prompt de producto y el `productRef`; sin API real (se mockea `submitGenerationAction`, patrón existente en los tests de generación — `feedback_no_real_api_in_tests`).
- **Validador:** warning con prefijo `producto:` cuando `ctx.product.imagePaths.length === 1`; ausente con 2+ o sin producto.
- **UI:** smoke del usuario (generar el 3/4, ver que entra al kit y que el warning desaparece).

## Decisiones de modelado (aprobadas)

- **Reusar `product_image_ids[]`** (tope 4) en vez de un slot nuevo `product_angle_image_ids` → **sin migración**. `media_references.source` distingue subida vs generada. El compiler ya consume la lista.
- **Solo la vista 3/4** por ahora (el principio pide "mínimo frontal + 3/4"). Perfil/trasera = extensión futura (YAGNI).

## Decisiones inmutables — verificación

- **>60s / QStash:** la generación de imagen pasa por el flujo existente `submitGenerationAction` (Nano Banana), sin cambio del modelo asíncrono.
- **URLs de proveedor al cliente:** `fixAsReference`/`addGenerationAsReference` ya bajan el output a Storage y devuelven una `media_reference` interna; sin cambio.
- **Créditos vía SQL atómicas:** la generación reusa el flujo de créditos existente de `submitGenerationAction`; no se toca.
- **RLS / service role:** `setBrandKitImagesAction` valida ownership (ya existente); sin cambio.
- **Sin migración / sin tabla nueva.**
- **No fabricar texto de marca:** el prompt de ángulo lo prohíbe explícitamente.
- **Sin emojis; dark mode; shadcn** en el botón nuevo.

## Fuera de alcance

- Slot estructurado `product_angle_image_ids` (se reusa la lista).
- Vistas perfil/trasera.
- **AM** (manifiesto de assets con uso) y **P05** (variantes de estado) — sub-proyectos aparte del cluster.
- Auto-generación del 3/4 en creación de campaña (se mantiene manual + warning).

## Verificación posterior

- `pnpm typecheck` limpio; suite verde (tests nuevos de `generateProductAngle` y del validador).
- Smoke del usuario: subir 1 foto de producto al Brand Kit → ver el warning de vista única en una campaña → pulsar "Generar vista 3/4" → confirmar que la imagen entra a `product_image_ids`, el warning desaparece, y una generación posterior cita ambas vistas.
