# Refinamiento de audio en el Storyboard — diseño

- **Fecha:** 2026-06-20
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Depende de:** Storyboard A (autoría) y B (video desde storyboard), ya implementados.

## Problema

En los videos generados desde el storyboard (B, image2video con audio), el habla sale **apresurada y robótica**. Diagnóstico (campaña "Familia abrazada cuadro"): NO es la calidad de la voz — es que el **diálogo no cabe en los segundos del clip**. Hablar natural en español es ≈ 2.5 palabras/s; un beat de 5s con 14 palabras de diálogo (más una acción visual) obliga a Seedance a acelerar el habla para que quepa → robótico. El compiler ya pide cadencia humana (`DIALOGUE_LANGUAGE`), pero el modelo no puede cumplirlo sin tiempo.

Detalle de diseño: el habla de Seedance es **lip-sync** (la boca sigue las palabras). Un motor de voz aparte (ElevenLabs) sonaría mejor pero **rompería el lip-sync** → descartado para hablar a cámara. La solución correcta es **ajustar el diálogo a la duración** para que la voz de Seedance (lip-synced) no se apresure.

## Objetivo

Una sección de **audio por beat** en la vista del storyboard donde el usuario edita el **diálogo** y la **duración** del clip, guiado por un **medidor de holgura** que predice si la voz saldrá natural o apresurada. El "ritmo/pausado" es **implícito por holgura** (más segundos por palabra = más pausado); sin control aparte. **Sin migración**: el diálogo sigue viviendo en `campaign_items.scene_prompt` (de donde el compiler ya lo lee) y la duración en `campaign_items.duration_s`.

## Flujo

1. En `/app/campaigns/[id]/storyboard`, cada beat muestra (además del panel) una sección de audio: input del diálogo + control de duración + medidor + "Guardar audio".
2. Guardar reescribe el diálogo dentro de `scene_prompt` y actualiza `duration_s`. **No genera nada** (es texto + duración; sin créditos).
3. El usuario **regenera el video** del beat (flujo B existente) para oír el resultado. Editar el diálogo **no** requiere regenerar el panel (el diálogo es audio; la cláusula "no text" ya lo mantiene fuera de la imagen).

## Helpers puros (`lib/campaigns/speech-fit.ts`, nuevo)

Todo determinista y testeable, sin IO.

### Diálogo dentro de scene_prompt
- `extractDialogue(scenePrompt: string): string` — devuelve el diálogo actual:
  - Prioridad 1: el texto entre comillas tras `Dialogue:` (insensible a mayúsculas), p.ej. `Dialogue: "Hola"` → `Hola`. Soporta comillas rectas `"..."` y curvas `“...”`.
  - Prioridad 2: si no hay marcador `Dialogue:`, el primer texto entre comillas del prompt.
  - Si no hay → `''`.
- `replaceDialogue(scenePrompt: string, nuevo: string): string` — reescribe el segmento de diálogo:
  - Si `nuevo.trim()` está vacío → elimina el segmento `Dialogue: "..."` (y espacios sobrantes) → beat sin habla.
  - Si existe un `Dialogue: "..."` → reemplaza solo el contenido entre comillas por `nuevo` (comillas rectas).
  - Si no existe marcador pero hay texto entre comillas (prioridad 2) → reemplaza ese primer entrecomillado.
  - Si no existe ninguno → **append** ` Dialogue: "<nuevo>"` al final del prompt.
  - Nunca toca la parte de acción visual del prompt.

### Estimación de ajuste
- `countWords(text: string): number` — palabras no vacías (`split` por whitespace, filtra vacíos; cuenta "…"/puntuación pegada como parte de la palabra, no como palabra extra).
- `estimateSpeechSeconds(dialogo: string, lang: 'es' | 'en'): number` — `countWords / WPS[lang]`, con `WPS = { es: 2.5, en: 2.8 }` (constante exportada, ritmo conversacional natural; tunable). Devuelve segundos (float).
- `fitVerdict(neededS: number, durationS: number): { level: 'tight' | 'ok' | 'roomy'; suggestedDurationS: number }`:
  - `tight` (muy ajustado): `neededS > durationS`.
  - `ok` (justo): `0 <= durationS - neededS < HEADROOM_S`.
  - `roomy` (holgado): `durationS - neededS >= HEADROOM_S`.
  - `HEADROOM_S = 1.0` (constante).
  - `suggestedDurationS = clamp(ceil(neededS + HEADROOM_S), DUR_MIN, DUR_MAX)` con `DUR_MIN = 4`, `DUR_MAX = 15` (rango Seedance).

Constantes (`WPS`, `HEADROOM_S`, `DUR_MIN`, `DUR_MAX`) con nombres claros, no mágicas.

## Server action (`server-actions/storyboard.ts`)

- `setBeatAudioAction(itemId: string, dialogue: string, durationS: number): Promise<Result<{ updated: true }>>`
  - zod: `itemId` uuid no vacío; `dialogue` string (≤ 600 chars); `durationS` int en `[4, 15]`.
  - Carga el item + campaña validando ownership de workspace (patrón existente `loadItemAndCampaign`).
  - `const nextPrompt = replaceDialogue(item.scene_prompt, dialogue)`.
  - `update campaign_items set scene_prompt = nextPrompt, duration_s = durationS where id = itemId`.
  - `revalidatePath('/app/campaigns/[id]/storyboard')` y el de la campaña.
  - Sin generación, sin créditos. Devuelve `{ ok: true, data: { updated: true } }`.

## UI (`components/campaigns/StoryboardView.tsx` + `app/.../storyboard/page.tsx`)

- La página (`storyboard/page.tsx`) agrega `language` al `.select` de `campaigns` (fallback `'es'`) y `duration_s` al `.select` de `campaign_items`; pasa `language: 'es' | 'en'` a `StoryboardView` y añade `durationS: number` a cada `StoryboardBeat`. El **diálogo NO se pasa**: el cliente lo deriva con `extractDialogue(beat.scenePrompt)` (el helper es compartido, sin `server-only`).
- En cada card de beat, bajo los controles existentes, una sección "Audio":
  - `input`/`textarea` con el diálogo (inicial `extractDialogue(scenePrompt)`).
  - control de duración: number input o stepper, rango 4-15.
  - **medidor** en vivo (cliente, recalcula con los helpers): muestra `level` con color y texto:
    - `roomy` → "✓ holgado (natural)".
    - `ok` → "justo".
    - `tight` → "⚠ muy ajustado: ~{neededS}s para {words} palabras; sube a {suggestedDurationS}s o acorta".
  - botón "Guardar audio" → `setBeatAudioAction(beatId, dialogo, duracion)`; `toast` + `router.refresh()`.
  - hint: "regenera el video para aplicarlo".
- El medidor usa los mismos helpers puros en cliente (import desde `lib/campaigns/speech-fit.ts`, sin `server-only`).

## Sin migración

Todo en columnas existentes: `campaign_items.scene_prompt` (diálogo embebido) y `duration_s`. El compiler Seedance ya extrae el diálogo de `scene_prompt` (`hasSpokenDialogue`/`sceneHasVoice`) y la generación de video (B y normal) ya usa `duration_s` → la voz sale natural sin tocar compiler ni orquestador.

## Casos borde

- Beat sin diálogo (`extractDialogue` → `''`): el medidor no aplica (0 palabras = "sin habla"); guardar con diálogo no vacío lo agrega; guardar vacío lo deja sin habla.
- `replaceDialogue` debe ser idempotente y no duplicar `Dialogue:` si ya existe.
- Comillas curvas/rectas y `Dialogue:`/`dialogue:` (case-insensitive).
- Duración fuera de 4-15 → la action la rechaza (zod); el UI la limita.

## Testing

Unit puros (sin APIs reales), en `lib/campaigns/speech-fit.test.ts`:
1. `extractDialogue`: con `Dialogue: "..."`, con comillas curvas, con texto entre comillas sin marcador, sin diálogo → `''`.
2. `replaceDialogue`: reemplaza contenido existente; agrega cuando no hay; quita cuando `nuevo` vacío; no duplica `Dialogue:`; no toca la acción visual.
3. `estimateSpeechSeconds`: 10 palabras es → 4s; respeta `WPS` por idioma.
4. `fitVerdict`: los 3 niveles en sus fronteras + `suggestedDurationS` con `clamp` (p.ej. diálogo larguísimo → 15; cortísimo → 4).

La server action y la UI se cubren con `pnpm typecheck` + el smoke del usuario (regenerar un beat y oír la voz).

## No-objetivos

- Motor de voz dedicado (ElevenLabs) / doblaje: rompe el lip-sync de Seedance; descartado para hablar a cámara (posible futuro solo para voz en off).
- Control de ritmo explícito (toggle "pausado" con directiva/columna): se eligió ritmo implícito por holgura.
- Audio authoring fuera del storyboard (editor de campañas normales): el diálogo/duración viven en `campaign_items`, así que esto ya beneficia cualquier generación de esa campaña; un editor equivalente en el flujo normal queda para después.
