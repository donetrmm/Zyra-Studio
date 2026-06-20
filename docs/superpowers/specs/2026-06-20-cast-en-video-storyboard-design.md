# Cast como referencia en el video del Storyboard — diseño

- **Fecha:** 2026-06-20
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Depende de:** Storyboard B (video desde storyboard, image2video), ya implementado.

## Problema

En B, cada clip se genera `image2video` usando solo el **panel como fotograma inicial**. El panel ya trae al personaje (anclado al generar el panel, en A), así que el **primer fotograma** sale bien — pero durante la **acción/animación** el rostro deriva y **no hay ninguna referencia del cast que lo re-ancle** a lo largo del clip. El usuario quiere mandar el cast al video para que siempre tenga la referencia de cómo debe verse el personaje.

## Objetivo

En el modo storyboard-video, además del panel (first_frame), mandar la(s) **hoja(s) maestra(s) del cast** del beat como `reference_image`, con el prompt citándolas (`@image1 = personaje`), para que Seedance mantenga la identidad durante todo el clip. Producto/locación NO se re-mandan (ya están en el panel).

## Factibilidad (confirmada en doc/código)

- **ModelArk**: un solo endpoint; la operación se expresa por `role` en `content[]` → un request puede llevar `first_frame` (panel) + `reference_image` (cast) a la vez.
- **Atlas** (backend actual del usuario): `image2video` y `reference2video` son endpoints por slug; el I2V usa `image`/`last_image` y **no documenta** `reference_images`. Mandarlas puede honrarse, ignorarse o fallar → **el smoke de 1 clip es la compuerta**; si Atlas no las honra, se cae a `reference2video` (panel + cast), cambio aparte.
- **El handler ya firma y pasa** `imageUrl` (de `referenceStoragePath`) + `imageUrls` (de `referenceImagePaths`) sin gatear por operación → **sin cambios en el handler**.

## Mecánica

Para un item en modo storyboard-video, el insert pasa a:
- `params.operation = 'image2video'` (igual).
- `params.referenceStoragePath = <panel>` (first_frame, igual).
- `params.referenceImagePaths = <hojas maestras del cast del beat>` (NUEVO) — en el MISMO orden en que el prompt las cita (`@image1`, `@image2`...).
- `model_id` = slug image-to-video (igual, vía `toImage2VideoSlug`).
- prompt: cita `@image1 = personaje` con propósito ("mantén el mismo rostro/peinado/complexión, consistente con el primer fotograma; no cambies la identidad").

El orden y la numeración: el `first_frame` (panel) NO cuenta en la numeración `@image`; el 1er `reference_image` (cast) es `@image1` (doc Seedance). Coincide con cómo el compiler cita al personaje.

## Prompt + referencias (`lib/prompt-director/index.ts`)

Nuevo transform puro **`onlyCharacterRefs(ctx: DirectorContext): DirectorContext`** que reemplaza a `withoutReferences` en el modo storyboard:
- **Conserva** `ctx.characters` (con `masterImagePath`/`angleImagePaths`) → el compiler emite el personaje como `@image1` + la directiva de fidelidad, y lo deja en `compiled.references` (rol `character`).
- **Vacía** producto (`imagePaths`, `packagingImagePaths`), locación (`imagePaths`), `extraImagePaths`, `templateVideoPath`, `audioRefPath` → no se re-citan (están en el panel).
- **Limpia** `format.requiredRefs` (igual que el fix de B): sin esto, el validador bloquearía el compile porque el formato exige imágenes de producto que ya no van.

Resultado: el prompt cita solo al personaje (`@image1..N`), sin citas de producto/locación que apunten a referencias no enviadas. Si el beat NO tiene personaje, `compiled.references` queda vacío y el clip es panel-only (degrada con gracia, igual que hoy).

`withoutReferences` queda **reemplazado** por `onlyCharacterRefs` (su único consumidor es el modo storyboard del orquestador): se **elimina** `withoutReferences` y su bloque de tests, y `onlyCharacterRefs` hereda esa cobertura (requiredRefs limpio + sin citas de producto/locación) más el caso nuevo de personaje conservado.

## Orquestador (`lib/campaigns/orchestrator.ts`, `enqueueBatch`)

En el modo storyboard (`storyboardMode`):
- `const dirCtx = onlyCharacterRefs(baseDirCtx)` (en vez de `withoutReferences`).
- Tras compilar, `const characterRefPaths = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath)` (solo personajes, en orden de cita).
- En el insert storyboard: agregar `referenceImagePaths: characterRefPaths` junto a `operation:'image2video'` + `referenceStoragePath: panelPath`. (Si `characterRefPaths` está vacío, se pasa `[]` → panel-only.)

## Provider (`lib/providers/seedance.ts`)

La rama `image2video` debe emitir también las reference images cuando hay `imageUrls`:
- **`submitModelArk`**: dentro de `if (operation === 'image2video')`, tras `first_frame`/`last_frame`, agregar `for (const url of params.imageUrls ?? []) content.push({ type:'image_url', image_url:{url}, role:'reference_image' })`.
- **`submitAtlas`**: dentro de `if (operation === 'image2video')`, tras `body.image`/`body.last_image`, agregar `if (params.imageUrls?.length) body.reference_images = params.imageUrls`.
- **Validación**: aplicar `assertReferenceLimits` también a `image2video` (tope 9 imágenes) — hoy solo se aplica a `reference2video`.

## Sin toggle — el smoke es la compuerta

Pasa a ser el comportamiento del modo storyboard-video. **Smoke (usuario)**: generar 1 clip de un beat con personaje y comparar la consistencia del rostro durante la acción vs antes. Si Atlas honra el cast → listo. Si lo ignora (sin mejora) o tira error → se cae a `reference2video` (panel como `@image1` + cast como `@image2`), que sería un spec/cambio aparte.

## Casos borde

- Beat sin personaje → `characterRefPaths` vacío → panel-only (como hoy).
- Múltiples personajes (≤3) → `@image1..3`, todos como `reference_image` (dentro del tope 9).
- Panel borrado/no resoluble → ya cae a comportamiento normal (lógica existente de B).
- Costo: image2video con reference images se tarifa igual (por segundo, mismo slug). Sin cambio de créditos.

## Testing

Unit puro (sin APIs reales), en `lib/prompt-director/prompt-director.test.ts`:
1. `onlyCharacterRefs`: compilar un contexto con personaje (master) + producto + locación + un formato con `requiredRefs:['product']` → el resultado **compila ok** (requiredRefs limpio), el prompt **cita `@image1`** (personaje), `compiled.references` incluye la imagen del personaje y **no** incluye producto/locación.
2. `onlyCharacterRefs` sin personaje → `compiled.references` sin imágenes y prompt sin `@image`.

Provider y orquestador: `pnpm typecheck` + el smoke del usuario (el provider hace HTTP; no se testea con API real, por la regla del repo). El cambio del provider es aditivo (solo agrega reference images en I2V).

## No-objetivos

- Re-anclar el producto en el video: mismo mecanismo, pero el usuario pidió cast; se puede agregar después (incluir producto en el contexto/refs).
- Fallback `reference2video` (panel + cast): solo si el smoke muestra que Atlas no honra el cast en I2V; se diseñaría aparte.
- Cambiar el handler: ya soporta ambos (panel + refs).
