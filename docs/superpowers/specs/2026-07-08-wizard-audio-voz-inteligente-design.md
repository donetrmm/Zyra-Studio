# Toggle de audio inteligente en el wizard de campañas

**Fecha:** 2026-07-08
**Estado:** aprobado (diseño); pendiente de plan de implementación
**Alcance:** solo la sección de audio del wizard de creación de campañas. Sin cambios de backend ni de generación.

## Objetivo

Hacer intuitiva la sección "Audio de referencia en anuncios de varias escenas" del wizard (`components/campaigns/CampaignStudioWizard.tsx`). Hoy muestra un toggle **Pista musical / Voz del clip anterior** sin contexto: el usuario no sabe cuándo aplica ni cuál elegir. La mejora **nunca oculta opciones**, pero detecta si los personajes seleccionados tienen voz asignada, **recomienda** la opción correcta con un badge y da **feedback** que explica el porqué y el alcance.

## Contexto técnico (mecánica verificada en código)

- **Un solo slot de audio de referencia por clip (`@audio1`, 15s máx).**
- En clips **compilados** (clip único, y todos los clips en modo **Locación** o **storyboard**), el `@audio1` lo gana la **voz asignada** del personaje si la tiene; si no, la pista (`lib/prompt-director/compilers/seedance.ts:401-407`, la voz gana sobre la música). Ahí el toggle es irrelevante.
- El toggle **solo rige los clips 2..N de una secuencia ENCADENADA** (`buildContinuationPrompt` / `chainAudioPaths` en `lib/campaigns/orchestrator.ts:850`): esos clips no vuelven a citar la voz del personaje, así que su `@audio1` es música **o** el audio del clip anterior.
- Por eso, con voz asignada **y encadenado**, "Voz del clip anterior" es lo que **propaga el timbre** a los clips siguientes; "Pista musical" dejaría derivar la voz.

Un personaje "tiene voz utilizable en video" cuando su ficha del Cast tiene `voice_clone_id` **y** ese `voice_clones` tiene `sample_storage_url` (la muestra que se vuelve el `@audio1`). Sin muestra, la voz sirve para TTS pero no como referencia de timbre en video.

## Diseño

### 1. Data flow (page → wizard)

`app/app/campaigns/new/page.tsx`:
- Agregar `voice_clone_id` al `select` de `characters`.
- Con los `voice_clone_id` no nulos, consultar `voice_clones` (`id, sample_storage_url`).
- Computar por personaje **`hasVoice = voice_clone_id != null && sample_storage_url != null`**.
- Pasar `hasVoice: boolean` en el prop `characters` del wizard.

El prop `characters` del wizard pasa de
`{ id, name, previewUrl, angleCount }` a
`{ id, name, previewUrl, angleCount, hasVoice }`.

### 2. Lógica en el wizard (`CampaignStudioWizard.tsx`)

- Helper puro exportable `recommendedAudioSource(selectedIds: string[], chars: {id: string; hasVoice: boolean}[]): 'music' | 'prev_clip'` → devuelve `'prev_clip'` si **algún** personaje seleccionado tiene voz, si no `'music'`.
- Estado nuevo `audioSourceTouched: boolean` (default `false`).
- `effectiveAudioSource = audioSourceTouched ? chainAudioSource : recommended`, donde `recommended = recommendedAudioSource(selectedCharacterIds, characters)`.
  - El radio usa `effectiveAudioSource` para `aria-checked` y estilos.
  - Al hacer click en una opción: `setAudioSourceTouched(true)` y `setChainAudioSource(clicked)`.
  - El submit envía `effectiveAudioSource` (no el `chainAudioSource` crudo), para que cuente la recomendación si el usuario no tocó nada.
- Sin `useEffect`: la recomendación se deriva en render a partir de la selección. Cambiar la selección re-deriva `recommended`; si el usuario ya eligió manualmente (`audioSourceTouched`), su elección se respeta.
- Badge **"Recomendado"** en la opción igual a `recommended`.

### 3. Feedback (copy)

- Nota fija de alcance bajo el título:
  > "Solo aplica a secuencias de varias escenas encadenadas. En modo Locación o en un solo clip, la voz del personaje ya se usa en cada clip."
- Texto dinámico según la selección:
  - **Con voz** (algún seleccionado con `hasVoice`): "Tu personaje tiene voz asignada. En una secuencia encadenada, 'Voz del clip anterior' mantiene ese timbre en los clips siguientes; con 'Pista musical' la voz podría cambiar."
  - **Sin voz, con personaje seleccionado**: "Ningún personaje seleccionado tiene voz asignada. 'Pista musical' marca el ritmo y el modelo genera la voz."
  - **Sin personaje seleccionado**: "Sin personaje que hable; la pista marca el ritmo."

### 4. Backend / generación

**Sin cambios.** El valor enviado sigue siendo `chainAudioSource: 'music' | 'prev_clip'` (ahora el `effectiveAudioSource`). Nada cambia en `orchestrator.ts`, el compiler, el schema de la action ni la generación. La mecánica de voz en off ya quedó correcta en un cambio previo (`fix(seedance)`).

### 5. Testing

- Unit del helper puro `recommendedAudioSource` (vitest, sin red):
  - Ningún personaje seleccionado → `'music'`.
  - Un personaje sin voz → `'music'`.
  - Un personaje con voz → `'prev_clip'`.
  - Mezcla (uno con voz, uno sin) → `'prev_clip'`.
- QA manual: seleccionar un personaje con voz y otro sin voz; verificar que cambian la recomendación (badge) y el copy; verificar que un override manual persiste al cambiar la selección.

## Casos borde

- **Mezcla de voces:** se recomienda `prev_clip` (si el que habla tiene voz, la preserva). Decisión: basta con que **alguno** tenga voz.
- **Override manual:** se respeta; cambiar la selección de personajes después no lo pisa (`audioSourceTouched`).
- **Compat del prop:** el default de `hasVoice` es `false` si la page no lo resuelve (degrada a la recomendación `'music'`, comportamiento actual).

## Fuera de alcance

- Guiar la decisión encadenado-vs-locación en la UI (se decide en otro punto del flujo; brainstorm aparte si se quiere).
- Rediseñar el bloque de audio/voz por completo (etiquetas por resultado, etc.).
- Cualquier cambio en la mecánica de generación, el compiler o el orchestrator.
