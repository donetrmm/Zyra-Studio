# P16 — Música en modo storyboard (beats con cast)

**Fecha:** 2026-06-25
**Tipo:** Extensión de P16 (pista musical para sincronía de beat) al modo storyboard
**Esfuerzo:** S
**Estado:** diseño aprobado, pendiente de plan

## Origen

P16 (pista musical de referencia para sincronía de beat) opera end-to-end en modo campaña normal: el wizard sube el audio (guard 15s) → `campaigns.music_ref_id` → `CampaignContext.audioRefPath` → `directorContextFor` → el compiler lo cita `@audio1` y lo emite como referencia → propaga a clips encadenados → el provider lo recibe como `reference_audios`. La auditoría operacional (2026-06-25) confirmó que en **modo storyboard la música se pierde**: `onlyCharacterRefs` (`lib/prompt-director/index.ts:71`) pone `audioRefPath=undefined` antes de compilar, y las ramas de generación de storyboard no incluyen `referenceAudioPaths`. Los beats del storyboard se generan sin la pista de ritmo aunque la campaña la tenga configurada.

## Problema y restricción del provider

Dos causas combinadas: (1) `onlyCharacterRefs` quita `audioRefPath` (junto a producto/locación, que sí están en el panel; la música NO está en el panel → se quitó por arrastre); (2) las ramas de storyboard del orchestrator no pasan `referenceAudioPaths`.

**Restricción del provider (Seedance/Atlas):** solo la operación `reference2video` maneja `reference_audios` (`lib/providers/seedance.ts:184,297`); `image2video` NO (solo `first_frame`/`last_frame`), y "Atlas no deja mezclar first_frame + referencias" (`orchestrator.ts:862`). Por eso los beats de storyboard se reparten en dos operaciones:
- **R2V (`reference2video`)** — beats donde el cast ACTÚA (nombrado en el beat): cast + producto + panel como referencias.
- **I2V (`image2video`)** — beats panel-locked sin cast (close-ups de producto, etc.): panel como fotograma inicial, lock total.

La música solo puede entrar a los beats **R2V** (donde `reference2video` la soporta). Los I2V quedan fuera por la limitación de Atlas — decisión de alcance aprobada.

## Decisión de alcance (aprobada): solo beats con cast (R2V)

La música entra a los beats de storyboard que usan `reference2video` (cast actuando), que es donde el beat-sync con movimiento importa. Los beats `image2video` (panel-locked, sin cast) se quedan sin música — limitación documentada del provider, no se fuerza.

## Diseño

El audio R2V se construye igual que el resto de referencias del R2V (cast/producto/panel ya se manejan en `buildCastR2VRefs`), y la directiva de beat-sync se reusa verbatim de la del compiler normal.

1. **`onlyCharacterRefs` (`lib/prompt-director/index.ts:63`): SIN CAMBIO.** Sigue quitando `audioRefPath` del contexto de compile. Es correcto: los beats I2V no llevan música (la cita `@audio` no debe aparecer en su prompt), y la rama R2V toma el audio de `baseDirCtx` (antes del strip), igual que ya hace con el producto (`orchestrator.ts:878`).

2. **`buildCastR2VRefs` (`lib/campaigns/storyboard-video.ts:34`):** gana un cuarto parámetro opcional `audioRef?: string` y su retorno pasa de `{ referenceImagePaths, extraCitation }` a `{ referenceImagePaths, referenceAudioPaths, extraCitation }`:
   - sin `audioRef`: `referenceAudioPaths: []`, `extraCitation` sin cambio.
   - con `audioRef`: `referenceAudioPaths: [audioRef]`, y se añade a `extraCitation` la directiva de beat-sync **reusando la constante compartida** `AUDIO_BEAT_SYNC_CITATION` (exportada de `lib/prompt-director/compilers/seedance.ts`; fuente única que también cita el compiler normal): ` @audio1 sets the background audio mood and rhythm; sync scene energy to its beats.` (el storyboard antepone el espacio al concatenar).
   - `@audio1` usa su propio contador (separado de `@image1..N`), igual que el compiler normal.

3. **Orchestrator (rama R2V, `lib/campaigns/orchestrator.ts`):**
   - Tomar el audio del contexto base ANTES de `onlyCharacterRefs`: `const storyboardAudioRef = useR2V ? baseDirCtx.audioRefPath : undefined;` (mismo patrón que `storyboardProductRefs`, `:878`).
   - Pasarlo a `buildCastR2VRefs(storyboardCastRefs, storyboardProductRefs, panelPath, storyboardAudioRef)` y desestructurar el nuevo `referenceAudioPaths`.
   - Añadir `referenceAudioPaths: <el devuelto>` a los params del branch `useR2V` (`:911-922`, junto a `referenceImagePaths: castR2VRefs`).

4. **SIN CAMBIO:** el provider (`reference2video` ya manda `reference_audios`, `seedance.ts:184,297`), el job handler (ya firma `params.referenceAudioPaths → audioUrls` para cualquier operación, `lib/jobs/handlers/seedance.ts:65-68`), la rama I2V, y la rama normal.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `lib/campaigns/storyboard-video.ts` | `buildCastR2VRefs` gana `audioRef?` y devuelve `referenceAudioPaths` + cita `@audio1` |
| `lib/campaigns/storyboard-video.test.ts` | casos con/sin `audioRef` |
| `lib/campaigns/orchestrator.ts` | toma `baseDirCtx.audioRefPath` en R2V → `buildCastR2VRefs` → `referenceAudioPaths` en los params del reference2video |

**Sin migración, sin schema, sin cambio de provider/handler/compiler/`onlyCharacterRefs`.**

## Tests

- **`storyboard-video.test.ts`:** `buildCastR2VRefs(cast, prod, panel, audioRef)` → `referenceAudioPaths === [audioRef]` y `extraCitation` contiene `@audio1`; `buildCastR2VRefs(cast, prod, panel)` (sin audioRef) → `referenceAudioPaths === []` y `extraCitation` NO contiene `@audio1`; el orden de `@image` (cast/producto/panel) no regresa.
- **Sin APIs reales** (`feedback_no_real_api_in_tests`): el wiring del orchestrator y que Atlas acepte `reference2video + reference_audios` los valida el smoke del usuario.

## Decisiones inmutables — verificación

- **Sin migración, sin schema.** Texto del prompt + un param que ya existe en el pipeline.
- **Provider URLs nunca al cliente:** `referenceAudioPaths` son storage paths internos; el handler los firma server-side (igual que las demás referencias).
- **`onlyCharacterRefs` intacto:** los beats I2V no cambian (sin `@audio` colgante).
- **Sin `any`, sin emojis.** `buildCastR2VRefs` sigue siendo helper puro testeable.

## Fuera de alcance

- **Música en beats I2V (panel-locked, sin cast):** limitación de Atlas (`image2video` no mezcla first_frame + referencias). No se fuerza `reference_audios` en `image2video`.
- Cambiar el reparto R2V/I2V o la heurística `beatNamesCast`.
- Modo campaña normal (ya operativo).

## Verificación posterior

- `pnpm typecheck` limpio; suite verde (`storyboard-video.test.ts` + sin regresión en orchestrator/storyboard).
- Smoke del usuario: campaña en modo storyboard con música configurada y un beat donde el cast actúa → confirmar que el clip R2V de ese beat recibe la pista (`reference_audios`) y sincroniza; y que un beat I2V (sin cast) sigue generándose sin error (sin música).
