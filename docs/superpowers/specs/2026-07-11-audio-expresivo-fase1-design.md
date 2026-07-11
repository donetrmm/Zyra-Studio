# Audio más expresivo en videos Seedance — Fase 1 (planitud)

**Fecha:** 2026-07-11
**Estado:** aprobado (diseño); pendiente de plan de implementación
**Rama prevista:** continúa en `feat/estudio-creativo-activos`

## Objetivo

Reducir la **planitud/monotonía** del habla generada por Seedance 2.0 (audio nativo).
NO se toca el ritmo calibrado (WPS / HEADROOM / articulación = **Fase 2**, solo si la
Fase 1 no basta). Todo determinista, tests sin API real; el smoke con audio real lo
corre el usuario (es el árbitro de "suena menos plano").

Idioma principal: **español (es-MX)**. La UI del tono va en español; las directivas al
modelo van en inglés (que es lo que la doc de Seedance muestra efectivo).

## Contexto técnico (estado actual)

Seedance genera **video + audio + lip-sync en una sola pasada** (`generate_audio:true`,
sin costo extra). No hay motor de voz aparte (ElevenLabs rompe el lip-sync). La entrega
de la voz la dirige texto en el prompt, compilado por
`lib/prompt-director/compilers/seedance.ts`:

- **`DIALOGUE_LANGUAGE[es|en]`** (seedance.ts:60): cláusula GLOBAL de idioma/cadencia.
  Lidera con claridad/contención ("avoid… monotone, exaggerated acting… subtle") y la
  variación emocional queda enterrada → el modelo tira a monótono seguro. Incluye la
  garantía es-MX/anti-castellano y la articulación (pronunciación) — ambas se **conservan**.
- **`voiceToneForRegister(register)`** (seedance.ts:474): matiz de tono, empujado como
  cláusula GLOBAL al final (seedance.ts:649-652), **lejos** de la cita `Dialogue: "..."`
  (que vive en la sección de acción). Devuelve `null` para UGC/default → la mayoría de
  clips no reciben dirección de tono.
- **`audioDirection(register)`** (seedance.ts:457): decide música/foley por registro
  **sin saber si hay diálogo** (seedance.ts:643-645). Un clip hablado en registro
  enérgico o cinemático recibe una **cama de música que compite con la voz** (la música
  de fondo enmascara la energía percibida del habla).
- Gates (seedance.ts:496-498): `voiceover = isVoiceover(scenePrompt)`,
  `speaker = generateAudio && hasSpokenDialogue && !voiceover`,
  `voiced = generateAudio && sceneHasVoice`.

El diálogo se cita como `Dialogue: "..."` dentro de la acción; el marcador es
regex-direccionable (ya lo usan el trimmer de presupuesto y `speech-fit`).

**Cableado hasta el compiler:** `CompileRequest` (`lib/prompt-director/types.ts:139`)
lleva `scenePrompt` y `durationS?`. El orchestrator los puebla desde el ítem
(`orchestrator.ts:1211-1212`: `scenePrompt: item.scene_prompt`,
`durationS: item.duration_s ?? undefined`) tras seleccionarlos
(`orchestrator.ts:852`). `voice_tone` seguirá **exactamente** ese camino.

**Hallazgo de la investigación externa (Seedance):** poner el adjetivo de tono/energía
**pegado a la cita del diálogo** es el patrón documentado efectivo (ejemplo oficial de
BytePlus usa "calmly", "steady pace" junto a la línea). `@audio1` es referencia de
**timbre** (documentado), no un transporte garantizado de energía → la expresividad la
da el texto, no la voz por personaje. No hay SSML/tags nativos.

## Decisiones tomadas (con el usuario, 2026-07-11)

1. **Palanca (a) — cue por beat, controlado por el usuario:** campo "Tono / entrega" por
   clip en la sección Audio del storyboard, inyectado **adyacente** a la cita del diálogo.
2. **Default + override:** con el campo vacío (la mayoría de clips) se inyecta un tono
   expresivo **derivado del registro + emoción** de la escena; el campo del usuario es un
   **override** encima. Así todos los clips mejoran de una.
3. **Almacenamiento:** **columna `voice_tone`** en `campaign_items` (migración 064). Se
   descartó embeberla en `scene_prompt` (lo pisan ingest/matcher/refine).
4. **Palanca (b):** sí se rebalancea `DIALOGUE_LANGUAGE`, **ritmo-neutral** (conservando
   es-MX/anti-castellano + articulación).
5. **Palanca (c):** "no music" (literal) en clips con voz (diálogo o voz en off).
6. **Idioma:** UI en español con **chips de sugerencia** que el compiler mapea a frases de
   entrega en inglés; texto libre en español pasa por un envoltorio inglés.

## Arquitectura

### 1. Datos: columna `voice_tone` y cableado

- **Migración 064 (idempotente):** `alter table campaign_items add column if not exists
  voice_tone text`. Nullable, sin default. Se aplica vía MCP **antes** del deploy (orden
  migración→push, mismo patrón que 063). Sin cambios de RLS (hereda las policies del ítem).
- **Cableado (espeja `duration_s`):**
  - `CompileRequest` (`types.ts`) gana `voiceTone?: string | null`.
  - El SELECT de ítems del orchestrator (`orchestrator.ts:852`) y el tipo de fila del ítem
    ganan `voice_tone`.
  - El orchestrator puebla `voiceTone: item.voice_tone ?? undefined` donde arma el
    `CompileRequest` (`orchestrator.ts:1211`).
  - El path de **preview** (`orchestrator.ts:~666-723`, "mismos gates y constantes que
    compileSeedance") recibe el mismo `voiceTone` para paridad; si no es trivial, se anota
    como MINOR en el plan (no bloquea la generación real).

### 2. Compiler — las 3 palancas (`compilers/seedance.ts`)

**(a) Cue de entrega adyacente a la cita.** Nueva función pura
`deliveryCueFor(voiceTone, register, scenePrompt): string` que decide el descriptor de
entrega EN INGLÉS:

- **Override:** si `voiceTone` viene seteado:
  - Si coincide con un token conocido del mapa `VOICE_TONE_MAP` (es→en), usa la frase
    inglesa mapeada.
  - Si es texto libre desconocido, envoltorio: `Deliver the line in a {voiceTone} tone`.
- **Default automático (campo vacío):** derivado del registro + emoción declarada
  (`declaresHighEmotion`/`ENERGETIC_REGISTER_RE` de `acting.ts`, ya existentes). Se
  extiende `voiceToneForRegister` para que **siempre** devuelva algo expresivo (hoy `null`
  para UGC/default → nuevo default cálido/vivo).

La inyección es **adyacente**: se transforma la acción anteponiendo el cue al marcador,
`Dialogue: "..."` → `{cue} — Dialogue: "..."` (transform determinista sobre el mismo
marcador regex). Esto **reemplaza** el push global de `voiceToneForRegister`
(seedance.ts:649-652) para no duplicar. Caso **voiceover** (sin marcador `Dialogue:`): el
cue se pega a la línea narrada / a `VOICEOVER_DIRECTION`.

`VOICE_TONE_MAP` (semilla, es→en; extensible): `cálido`→"warm and personable",
`entusiasta`→"upbeat and enthusiastic", `serio`→"serious and grounded",
`juguetón`→"playful and light", `íntimo`→"intimate and soft, close to the mic",
`seguro`/`confiado`→"confident and self-assured". Estos mismos labels son los **chips** de
la UI.

**(b) `DIALOGUE_LANGUAGE` rebalanceada (ritmo-neutral).** Reordenar para **liderar con
prosodia expresiva** ("expressive, dynamic delivery: vary pitch and intonation, emphasize
key words, let emotion ride through the line") y **reencuadrar la contención como visual**
(cara/gestos), no vocal. **Se conservan intactos**: la garantía es-MX/anti-castellano
(seseo, "never Castilian th") y la cláusula de articulación ("give each syllable its full
value…") — esa es pronunciación + Fase 2, **no** se toca la velocidad.

**(c) "no music" en clips hablados.** `audioDirection` pasa a recibir `voiced` (o se gatea
en el call site, seedance.ts:643-645): si `voiced` (diálogo o voz en off), devuelve una
dirección **voz-forward con "no music"** (literal — más fiable que "no background music")
en vez de la cama de música del registro. Clips **sin voz** conservan su música por
registro. El branch ASMR/whisper (ya "no music") no cambia.

### 3. UI + acción

- **`setBeatAudioAction(beatId, dialogue, durationS)` → `(…, voiceTone: string | null)`**
  (`server-actions/storyboard.ts`): su schema gana `voiceTone` (string corto, trim, opcional
  → null). Persiste `voice_tone` en el `UPDATE` del beat que ya hace.
- **`StoryboardView` sección Audio** (`components/campaigns/StoryboardView.tsx`, el bloque
  de `audioDraft`/`handleSaveAudio`, ~366/787): se agrega el input **"Tono / entrega"**
  (texto corto, opcional) con **chips de sugerencia** (los labels de `VOICE_TONE_MAP`) que
  rellenan el campo al pulsarlos. Junto a Diálogo y Duración. `audioDraft` gana
  `voiceTone`; `handleSaveAudio` lo manda. Placeholder: "ej. cálido, entusiasta".

### 4. Idioma (es UI → en compiler)

El usuario escribe/elige el tono en español (chip o texto). El **valor guardado** es el
string español. El **compiler** lo convierte a inglés vía `VOICE_TONE_MAP` (chips) o
envoltorio inglés (texto libre). El default automático ya es inglés. Resultado: el modelo
recibe SIEMPRE la directiva de entrega en inglés; el diálogo sigue en es-MX.

## Edge cases

- **Sin diálogo ni voz en off** (`Sin diálogo`): no se inyecta cue de tono; `audioDirection`
  mantiene su música/foley por registro (el clip no tiene voz que proteger).
- **Voiceover:** el cue se aplica a la narración; `audioDirection` da "no music" (voiced).
- **`voice_tone` seteado en un clip sin diálogo:** el cue no aplica (no hay línea); el valor
  queda guardado inerte hasta que el beat tenga diálogo. No es error.
- **Presupuesto de prompt:** el cue es corto (≤~60 chars); va dentro de la acción, así que
  el trimmer existente lo trata como parte del guion (protegido junto al diálogo).
- **Regresión de "expresiones exageradas" (feedback 2026-07-04):** el cue dirige la VOZ; la
  contención VISUAL de `acting.ts` (`ACTING_RESTRAINT_DIRECTION`/`NATURAL_EXPRESSION_CLAUSE`)
  se **conserva** y la reformulación de (b) refuerza "vocal expresivo, cara contenida".

## Testing

Regla del repo: unidades sin APIs reales; el smoke con audio real lo corre el usuario.

- **Unidades puras:** `deliveryCueFor` (override con token mapeado / texto libre / default
  por registro+emoción / caso voiceover); la transformación adyacente sobre el marcador
  `Dialogue:` (prepende el cue, preserva la cita; caso sin marcador); `audioDirection` con
  `voiced` (→ "no music") vs sin voz (→ música por registro); `voiceToneForRegister`
  extendida (nunca `null` para clips con voz); que la `DIALOGUE_LANGUAGE` nueva conserva los
  marcadores es-MX ("seseo"/"Castilian") y la articulación.
- `pnpm typecheck && pnpm build && pnpm vitest`.
- **Smoke del usuario (API real, árbitro):** regenerar un clip hablado y comparar
  expresividad antes/después; probar un override de tono ("entusiasta") y un clip con
  música vs sin música; confirmar que la pronunciación es-MX y el lip-sync no se degradan.

## Fuera de alcance

- **Ritmo (Fase 2):** `WPS`/`HEADROOM_S` (`speech-fit.ts`) y la cláusula de articulación —
  no se tocan; solo si la Fase 1 no basta en el smoke.
- **Voz por personaje / `@audio1`** (spec 14): consistencia de timbre, no expresividad.
- **Motor de voz aparte (ElevenLabs TTS+mux):** descartado (rompe lip-sync on-camera).
- **Mapeo exhaustivo es→en de tonos:** se arranca con la semilla de `VOICE_TONE_MAP`; se
  amplía si el smoke lo pide.
