# Cast en el video — fallback reference2video (Atlas) — diseño

- **Fecha:** 2026-06-20
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Reemplaza el mecanismo de:** `2026-06-20-cast-en-video-storyboard-design.md` (I2V + cast) — inviable en Atlas.

## Problema

El feature "cast en el video" mandaba `image2video` (panel como first_frame) + el cast como `reference_image`. **Smoke definitivo (campaña "La foto que nunca le había impreso", último clip):** Atlas rechaza con `400`:

> *"The parameter `content` ... is not valid: first/last frame content cannot be mixed with reference media content."*

O sea: en Atlas **no se puede** mezclar fotograma inicial (panel) con referencias (cast). El código actual por lo tanto **rompe todos los beats con personaje** en Atlas. Hay que ir al fallback `reference2video` que ya estaba identificado.

## Objetivo

En el modo storyboard-video, **3 vías por beat**:
1. **Beat SIN cast** → `image2video`, panel como first_frame (igual que hoy; funciona en Atlas, arranque exacto). Sin cambios.
2. **Beat CON cast** → `reference2video`: el panel y el cast van como `reference_image`; sin first_frame. El cast re-ancla la identidad durante todo el clip; el panel ancla la composición/apertura.
3. **Resto** (no-storyboard) → sin cambios.

Tradeoff aceptado: en beats con cast el panel deja de ser el fotograma 0 **exacto** y pasa a ser referencia fuerte (composición casi igual + cast re-anclado).

## Mecánica del caso CON cast (reference2video)

- `operation = 'reference2video'`.
- `model_id` = `item.model_slug` (ya es un slug `reference-to-video`; el slug debe coincidir con la operación). NO se aplica `toImage2VideoSlug`. Mismo precio (las filas reference-to-video ya existen).
- **Sin** `referenceStoragePath` (no first_frame).
- `referenceImagePaths = [...castRefs, panelPath]` — el cast primero (citado `@image1..N` por el compiler) y el **panel al final** (`@image{N+1}`).
- Prompt = el compilado (`onlyCharacterRefs` → cita el cast `@image1..N`) + una línea citando el panel como `@image{N+1}` ("fotograma inicial / composición exacta").
- `aspectRatio`/`resolution`/`duration`/`generateAudio` del beat (igual).

**Numeración**: el panel va como ÚLTIMO `@image` (no el primero) para no romper las citas que el compiler ya genera para el cast (empieza en `@image1`). El número es un detalle interno; el orden no implica prioridad (doc Seedance). Si el beat no tiene cast, ver vía 1 (image2video).

### Helper puro `lib/campaigns/storyboard-video.ts` (nuevo)

```
buildCastR2VRefs(castRefs: string[], panelPath: string): {
  referenceImagePaths: string[];   // [...castRefs, panelPath]
  panelCitation: string;           // " @image{castRefs.length+1} is the exact opening frame and overall composition of this shot — reproduce it as the starting look (same framing, colors and layout)."
}
```

Garantiza la invariante de numeración (panel = `@image{N+1}`, último). Determinista, testeable.

## Orquestador (`lib/campaigns/orchestrator.ts`, `enqueueBatch`)

El modo storyboard pasa a 3 vías. Tras compilar (con `onlyCharacterRefs` cuando `storyboardMode`) y calcular `storyboardCastRefs` (= refs de imagen compiladas = el cast):

```
const useR2V = storyboardMode && storyboardCastRefs.length > 0;
const effectiveModelSlug = storyboardMode
  ? (useR2V ? item.model_slug : toImage2VideoSlug(item.model_slug))
  : item.model_slug;
```

- `useR2V`: `const { referenceImagePaths, panelCitation } = buildCastR2VRefs(storyboardCastRefs, panelPath)`. Prompt = `compiled.prompt + panelCitation`. Params: `operation:'reference2video'`, `referenceImagePaths`, sin `referenceStoragePath`/`chain`/`returnLastFrame`.
- `storyboardMode && !useR2V` (sin cast): igual que hoy — `operation:'image2video'`, `referenceStoragePath: panelPath`, sin `referenceImagePaths`. Prompt = `compiled.prompt`.
- `else`: rama de encadenado/normal sin cambios.

El `model_id` y el `prompt` del insert se vuelven variables (`effectiveModelSlug`, `storyboardPrompt`) porque dependen de `useR2V`.

## Provider (`lib/providers/seedance.ts`) — revertir el cambio que falló

El caso cast ahora usa `reference2video` (ya soportado), y el caso sin-cast usa `image2video` solo-panel. **Nadie** manda ya `image2video` + reference images. Por lo tanto se **revierte** el cambio del feature anterior:
- `submitModelArk`: quitar el `for (... role:'reference_image')` dentro de la rama `image2video` (vuelve a solo first_frame/last_frame).
- `submitAtlas`: quitar `body.reference_images` de la rama `image2video`.
- `validateSubmit`: `assertReferenceLimits` vuelve a aplicar solo a `reference2video`.

(Es exactamente la mecánica que Atlas rechaza; dejarla sería un footgun de código muerto.)

## Qué se conserva del feature anterior

- `onlyCharacterRefs` (prompt-director): SE QUEDA — arma el contexto cast-only para el compile (cast `@image1..N`, sin producto/locación, requiredRefs limpio). Lo usa la vía R2V.
- `storyboardCastRefs` en el orquestador: SE QUEDA (deriva el cast de las refs compiladas).

## Casos borde

- Beat sin cast → image2video panel-only (vía 1). El clip que ya funcionaba sigue igual.
- Panel no resoluble → cae al comportamiento normal (lógica existente de B).
- Múltiples personajes (≤3) → `@image1..3` cast + panel `@image4`. Dentro del tope 9.
- Costo: reference-to-video se tarifa igual que image-to-video por segundo (mismas filas). Sin cambio de créditos.
- El clip que falló ("La foto que nunca le había impreso", escena 2) quedó en `failed`; el usuario lo regenera tras el deploy.

## Testing

Unit puro (`lib/campaigns/storyboard-video.test.ts`):
1. `buildCastR2VRefs(['a','b'], 'p')` → `referenceImagePaths === ['a','b','p']`; `panelCitation` contiene `@image3`.
2. `buildCastR2VRefs([], 'p')` → `referenceImagePaths === ['p']`; `panelCitation` contiene `@image1`. (Aunque en la práctica useR2V requiere cast ≥1, el helper es robusto.)

`onlyCharacterRefs` ya está cubierto. Provider y orquestador: `pnpm typecheck` + smoke del usuario (el provider hace HTTP; no se testea con API real).

## No-objetivos

- Re-anclar producto en el video: el usuario pidió cast.
- Volver a intentar I2V+cast en Atlas: el smoke lo descartó (error explícito).
- ModelArk: el usuario usa Atlas; si algún día se activa ModelArk, I2V+cast podría re-evaluarse (un endpoint, roles), pero no ahora.
