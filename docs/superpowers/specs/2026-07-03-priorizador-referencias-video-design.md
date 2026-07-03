# Priorizador de referencias para video (Seedance) — diseño

Fecha: 2026-07-03 · Feature #3 del roadmap de control de referencias (orden 3→2→1).

## Problema

El compiler de video (`buildReferences`, `lib/prompt-director/compilers/seedance.ts`)
recorta el pool de referencias al tope de 9 imágenes con prioridad fija
(producto 3 > empaque 2 > cast master+ángulos > locación > mapa de escala > extras)
y el usuario solo se entera *después* por el warning del item. Con campañas ricas
(3 personajes + locación + scale map + producto multi-ángulo) lo que se cae puede
ser justo lo que el usuario quería mandar.

## Decisión

El usuario elige qué referencias viajan, **por campaña**, desde un dialog en el
Studio. La selección se aplica **upstream** (filtra el `DirectorContext` antes de
`compile`), nunca post-filtro: las citas `@image1..N` que emite `buildReferences`
están amarradas al orden de construcción y un post-filtro las desalinea.

### Semántica

- `campaigns.reference_selection jsonb` (migración 054): `{ "include": [storage_paths] }`.
  `null` / lista vacía = comportamiento automático actual.
- Con selección activa (`ctx.manualRefs`), los topes POR CATEGORÍA se levantan
  (el usuario es el presupuesto — puede mandar 5 de producto si sacrifica otra
  cosa); el tope GLOBAL de 9 imágenes del modelo se mantiene como red (con warning).
- Las **hojas maestras del cast NO son des-seleccionables** (locked): son el ancla
  de identidad y quitarlas es un foot-gun (el tipo `masterImagePath: string` es
  requerido a propósito). El usuario controla: producto, empaque, ángulos de cast,
  locación, mapa de escala y extras.
- Los paths se intersectan con el pool real al GUARDAR (paths bogus no se
  persisten) y de nuevo al aplicar (paths stale de un brand kit editado filtran
  a no-op).
- Video de plantilla y audio no entran a la selección (kinds separados, 1 c/u,
  no compiten por los 9 slots).

### Alcance de aplicación

- `enqueueBatch` (orchestrator): `applyReferenceSelection(directorContextFor(...), sel)`.
  Cubre video normal, modo storyboard (afecta `storyboardProductRefs`, que lee
  `baseDirCtx.product`) y el primer clip de cadenas.
- Cadenas: `chain.productImagePaths` hereda automáticamente (viene de las refs
  compiladas, ya filtradas). `characterMasterPaths` no se filtra (masters locked).
- Los paneles de storyboard (Nano) NO usan esta selección — eso es el feature #2.

### UI

Botón "Referencias" en la toolbar del Studio → dialog que carga el pool vía
server action (`getReferencePoolAction`: entradas categorizadas + thumbnails
firmados + selección actual — fetch al abrir, no en el page load). Checkboxes
por imagen, masters marcados como "siempre viaja", contador contra el tope de 9,
nota de que los ángulos de cast entran según el presupuesto del clip en modo
automático. "Automático" restablece (`include: null`). Guardar →
`setReferenceSelectionAction` (zod + ownership + intersección con el pool).

## Piezas

1. `lib/campaigns/reference-selection.ts` (puro) + tests:
   `normalizeReferenceSelection`, `applyReferenceSelection`, `buildReferencePool`.
2. `DirectorContext.manualRefs?: boolean` + topes condicionales en `buildReferences`.
3. Migración 054 `campaigns.reference_selection jsonb` (aplicar vía MCP antes del push).
4. Orchestrator: tipo del param campaign + aplicación en el loop; selects de los
   dos callers en `server-actions/campaigns.ts`.
5. `lib/campaigns/reference-pool.ts` (IO): carga el pool desde brand kit /
   characters / locations / extras de la campaña (reusa `loadCampaignContext` y
   `resolveLocations`).
6. Server actions `getReferencePoolAction` / `setReferenceSelectionAction` +
   schemas zod.
7. `components/campaigns/ReferencePoolDialog.tsx` + botón en `CampaignStudioView`.
