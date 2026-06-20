# Video desde el Storyboard (Sub-proyecto B) — diseño

- **Fecha:** 2026-06-20
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Depende de:** Storyboard — Autoría (A), ya implementada (`campaign_items.storyboard_image_id` = panel vigente por beat).

## Contexto

A produce un storyboard: un panel-imagen por beat (`campaign_items.storyboard_image_id` → una `media_reference`). B genera el **video** usando esos paneles. Decisiones del brainstorming:

1. **Mecanismo: image2video desde el panel.** Cada clip usa su panel como **fotograma inicial exacto** y lo anima con la acción del beat. Máxima fidelidad (arranca idéntico al panel diseñado) y **realiza el objetivo anti-degradación**: cada clip parte de un panel limpio diseñado, no de un frame heredado que se degrada (era el bug original del encadenado).
2. **Trigger: automático** en la generación de video de la campaña. No hay botón nuevo: cuando un beat tiene panel, su clip se genera image2video desde él.

El handler Seedance (`lib/jobs/handlers/seedance.ts`) y el provider (`lib/providers/seedance.ts`) ya soportan **image2video** (`referenceStoragePath` → `imageUrl` como `first_frame`, en ModelArk y Atlas). El orquestador (`lib/campaigns/orchestrator.ts`, `enqueueBatch`) ya tiene modos por item (encadenado / location / normal). B agrega un modo más. **Sin migración** (usa columnas existentes).

## Objetivo de B

Que la generación de video de una campaña, cuando un beat tiene panel de storyboard, genere ese clip como **image2video desde el panel**, sin encadenar.

## Detección y precedencia de modo

En `enqueueBatch` (la lógica `chainRole(item)` / el armado del item):

- **Modo storyboard-video** si `item.storyboard_image_id` no es null. **Gana** sobre location-mode y encadenado (el panel ya incorpora producto/personaje/escena diseñados).
- En ese modo: `chainRole` devuelve no-encadenado (`skip:false, isFirst:false, returnLastFrame:false, orphanResume:false`) — cada clip es independiente.
- Beats **sin** panel: comportamiento actual (encadenado/location/reference2video/text2video). Por-item, no bloquea: una campaña puede mezclar beats con y sin panel.

Requiere agregar `storyboard_image_id` a `ItemRow` (`orchestrator.ts`) y al `.select(...)` de `campaign_items` que alimenta los items (`server-actions/campaigns.ts`).

## Mecánica de generación

Para un item en modo storyboard-video, la generación se inserta con:

- `model_id` se reescribe al endpoint **image-to-video** correspondiente (`toImage2VideoSlug`: `…/reference-to-video` → `…/image-to-video`, conservando el tier `fast`). El slug DEBE coincidir con `operation` (un endpoint por slug), o Atlas rutea mal y el panel se ignora como first_frame. El costo es idéntico (las filas de pricing image-to-video valen lo mismo).
- `params.operation = 'image2video'`.
- `params.referenceStoragePath = <storage_url de la media_reference del panel>` (bucket `references`). El handler lo firma como `imageUrl` rol `first_frame`.
- `params` SIN `referenceImagePaths` (no es reference2video), SIN `chain`, SIN `returnLastFrame`.
- `aspectRatio`, `resolution`, `duration`, `generateAudio` del beat (igual que hoy).
- **Prompt**: la **acción/movimiento** del beat + directivas de cámara/voz (lip-sync, idioma es-MX), **SIN las citas `@image`** de referencia (no hay refs de imagen; el panel es el primer fotograma). Ver "Prompt" abajo.

### Resolución del panel

`storyboard_image_id` → `media_references.storage_url`. Se resuelve en `enqueueBatch` con una query batch para los items con panel (helper `resolveStoryboardPanelPaths(supabase, workspaceId, mediaRefIds)` análogo a `resolveLocations`/`resolvePaths`, validando ownership por workspace). Devuelve `Map<mediaRefId, storage_url>`.

### Prompt (sin citas @image)

El compiler Seedance (`compileSeedance`) hoy arma el prompt con líneas `@image1 is the product…` según las referencias del contexto. En image2video NO hay referencias de imagen (el panel es el `first_frame`), así que esas citas serían falsas.

Solución (definida): en modo storyboard-video se compila con un `DirectorContext` donde producto/personaje/locación llevan **`imagePaths` vacíos** (las DESCRIPCIONES de texto se conservan; solo se omiten las imágenes). Así `buildReferences` no emite ninguna línea `@image` ni referencia de imagen, y el prompt resultante es: encabezado + escena + acción + descripciones de producto/personaje (texto) + dirección de formato + cinematografía + audio/voz + cláusula negativa. Es un prompt de movimiento+voz correcto para image2video, sin citas `@image` que apunten a referencias inexistentes.

## Estructura del video

Los **beats del storyboard SON los segmentos**: un clip image2video por beat. Cada beat es corto (≤~15s, tope de un clip Seedance), así que la "adaptación por duración" del brainstorm queda resuelta naturalmente (clips = beats). Los clips quedan como outputs separados (igual que hoy; no hay concat en el código).

## Casos borde

- **Panel borrado/inaccesible** (`storyboard_image_id` apunta a una `media_reference` que ya no existe → no resuelve) → el item cae al comportamiento normal (no storyboard-video). Best-effort.
- **Mezcla** de beats con y sin panel → cada uno por su modo.
- **Créditos/cola/worker**: reusa la infra de video existente. El costo image2video se estima igual que un clip de video del item (mismo modelo/resolución/duración; image2video no cambia el rate card del video).
- **ModelArk y Atlas**: ambos soportan image2video (`first_frame`). El modo storyboard-video NO depende de `return_last_frame` (a diferencia del encadenado, que es Atlas-only).
- **Personaje/voz**: el lip-sync/idioma se mantienen porque el prompt conserva las directivas de voz del compiler (gateadas por `audio` del beat).

## Archivos afectados (resumen)

- `lib/campaigns/orchestrator.ts`: `ItemRow.storyboard_image_id`; detección de modo storyboard-video en `chainRole`; en `enqueueBatch`, resolver paneles + armar el insert image2video (operation + referenceStoragePath + prompt sin @image); helper `resolveStoryboardPanelPaths`.
- `lib/prompt-director/`: ningún cambio de compiler necesario — el modo storyboard-video compila pasando producto/personaje/locación con `imagePaths` vacíos (la omisión de imágenes ya hace que `buildReferences` no emita `@image`). Se hace en el armado del contexto en `orchestrator.ts`.
- `server-actions/campaigns.ts`: agregar `storyboard_image_id` al `.select(...)` de `campaign_items`.
- Tests: `lib/campaigns/*.test.ts`, `lib/prompt-director/*.test.ts`.

## Testing

Unit puros (sin APIs reales):
1. **Detección de modo**: item con `storyboard_image_id` → no-encadenado (no skip, `returnLastFrame:false`), incluso con location/Atlas; el insert lleva `operation:'image2video'` + `referenceStoragePath` del panel, sin `chain`/`returnLastFrame`/`referenceImagePaths`.
2. **Prompt sin @image**: el prompt compilado para storyboard-video no contiene `@image`.
3. **Resolución del panel**: `resolveStoryboardPanelPaths` mapea `storyboard_image_id` → `storage_url` validando workspace; ids ajenos se descartan.

Smoke con generación real (Seedance image2video) lo corre el usuario.

## No-objetivos

- Concatenar los clips en un solo archivo (no existe pipeline de concat; fuera de alcance).
- image2video con fotograma final (panel N→N+1): el usuario eligió solo fotograma inicial; un futuro toggle podría agregar `endReferenceStoragePath` con el panel siguiente.
