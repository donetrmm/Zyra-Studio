# Fase Q — Imagen de inspiración al generar locaciones con IA

> **~2-3 horas · sin migraciones · espejo del patrón de personajes**
>
> El bloque "Generar locación con IA" manda `references: []` hardcodeado
> (`LocationsPage.tsx:244`): la generación es solo-texto. El camino de personajes ya acepta
> una referencia de inspiración opcional (`generateCharacter(appearance, reference?, ...)`,
> image-ref a FLUX). Se espeja ese patrón en locaciones. Diseño validado el 2026-07-06.

## Decisiones fijadas

- **La inspiración es SUELTA** (mood, paleta, composición del lugar), no copia exacta. Si el
  usuario quiere que la locación SEA ese lugar, ese camino ya existe: subir la imagen como
  maestra directamente. No confundir los dos caminos en la UI.
- **No se persiste** en la locación: la imagen de inspiración solo guía la generación (queda
  como `media_reference` por el flujo normal del uploader, como cualquier otra).
- **El provider no se toca.** La referencia viaja por `submitGenerationAction` con
  `references: [{ id, storagePath }]` — el mismo camino que ya funciona para personajes
  (el adapter FLUX ya maneja `image_prompt_strength`).

## Cambios

1. **`lib/prompt-director/asset-prompts.ts` — `buildLocationPrompt`** gana un cuarto
   parámetro opcional `hasInspiration?: boolean`. Cuando es true, apenda una línea que
   declara el rol de la referencia: inspiración suelta del lugar (mood, paleta de color,
   composición y atmósfera), re-imaginada como una locación nueva — nunca reproducirla
   idéntica ni copiar personas/texto visibles. En inglés, sin términos antislop, coherente
   con el `portraitSetting`/estilo del perfil activo.
2. **`components/locations/LocationsPage.tsx`** — en el bloque de generar con IA:
   `ReferenceImagesUploader` opcional con `max={1}` ("Imagen de inspiración (opcional)" +
   hint "Guía el mood y la paleta; no se copia exacta"); `handleGenerateMaster` resuelve el
   `storagePath` con `getReferencePathsAction` (ya importado) y pasa
   `references: [{ id, storagePath }]` y `buildLocationPrompt(..., hasInspiration: true)`.
   Sin imagen: comportamiento idéntico al actual (`references: []`, sin línea extra).

## Tests

- `asset-prompts.test.ts`: con `hasInspiration` la línea aparece (y pasa el guard antislop
  existente del archivo); sin él, el prompt es byte-idéntico al actual (regresión).
- UI: `pnpm typecheck && pnpm build` (sin tests de componentes en el repo).

## Criterio de cierre

- Generar locación sin inspiración: prompt y payload idénticos a hoy.
- Con inspiración: la referencia viaja a FLUX y el prompt declara su rol suelto.
- Smoke manual (usuario): generar una locación con una foto de inspiración y verificar que
  el resultado toma mood/paleta sin clonar el lugar.
