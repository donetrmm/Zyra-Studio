# P12 + P19 — Dirección temporal y peso dramático del beat

**Fecha:** 2026-06-24
**Tanda:** P1 (tercera entrega; sucede a P0 = P14/P20/P21, P14b y P16)
**Esfuerzo:** M
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Dos principios del análisis Higgsfield (`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md`), de la misma familia (dirección temporal) y que comparten superficie de código, por eso van en un spec combinado:

- **P12 — Estructura CUT con beats de actuación:** cada corte lleva plano+lente+movimiento **y** un beat de actuación concreto (gesto, mirada, respiración, micro-pausa).
- **P19 — Densidad de cortes adaptada al ritmo dramático:** la duración y el número de cortes los dicta el **peso narrativo** del beat, no una regla fija. Un reveal/confesión pide plano sostenido y aire; una acción comprime en cortes cortos.

No se clona el artefacto "CUT 1/2/3"; se adapta el principio a la arquitectura de dos capas IDEA(LLM)/OFICIO(determinista).

## Decisión de arquitectura: `beatRole` vive en tiempo de plan (sin migración)

`beatRole` lo **infiere el matcher** y lo **consume el planner** (política de duración) — no se persiste en DB ni llega al compiler. El compiler queda **agnóstico al rol**: la *forma del prompt* que el matcher escribe por rol ya gobierna el comportamiento del compiler (ver "Por qué el compiler no necesita el rol", abajo). Resultado: P12+P19 viven en `lib/prompt-director` + `lib/campaigns/planner.ts`, **sin tocar Supabase, créditos, RLS ni el worker**.

## Diseño

### P19 — Peso dramático (`beatRole`)

**Taxonomía: 3 roles policy-distinct** (solo roles que CAMBIAN comportamiento; YAGNI):

| beatRole | Política de duración (planner) | Forma del prompt (matcher) |
|---|---|---|
| `reveal` | techo **12s** (aire; ≤ máx 15 de Seedance), 1 escena sostenida | un solo gesto sostenido, sin tramos; "sustained held shot, minimal camera movement, silence" |
| `action` | **4-5s**, favorece varias escenas cortas | beats cortos y staccato |
| `beat` (default) | comportamiento actual (clamp 8s) | normal |

1. **IDEA (matcher):**
   - `SceneSchema` y `MatchSchema` (`format-matcher.ts:94`, MatchSchema) ganan `beatRole: z.enum(['reveal','action','beat']).catch('beat').default('beat')` — etiqueta estocástica; si el LLM falla o la omite, cae a `beat` sin tirar el match.
   - El SYSTEM infiere el rol por escena/idea y **escribe la forma acorde** (sostenido vs staccato vs normal).

2. **OFICIO (planner, determinista puro):** el clamp uniforme deja de ser global. Hoy:
   - `SceneSchema` clampa `durationS` a `SCENE_MAX_DURATION_S` (transform en `format-matcher.ts:106`).
   - El planner re-clampa a `SEQUENCE_SCENE_MAX_S = 8` (`planner.ts:354`).

   Cambios:
   - **Subir el techo duro del schema** `SCENE_MAX_DURATION_S` de 8 → **12** (el máximo que cualquier rol necesita; preserva la intención original "evita un beat de 15s caro"). El schema sigue siendo un tope, ya no la política.
   - **El planner se vuelve la política por rol:** una función pura `maxDurationFor(beatRole)` → `reveal: 12 · action: 5 · beat: 8`. Se usa en lugar de la constante fija en `planner.ts:352-357` (tanto en el `Math.min` como en el cap de `fitDialogueDuration`).

### P12 — Beat de actuación fino

1. **IDEA (matcher SYSTEM):** cada tramo del timeline suma un **beat de actuación concreto** — gesto + dirección de mirada + respiración/micro-pausa.
   - **Reconciliación con P20/P14 (lo más delicado):** UNA señal por instante, **secuencial** entre tramos, **nunca apiladas** ("inhala → mira fuera de cuadro → fija la mirada a cámara", no "ojos muy abiertos + mano en la boca + lágrimas a la vez"). Contenido, no histriónico. La redacción debe reforzar el eje de P20, no contradecirlo.

2. **OFICIO (compiler `toTimeline`):** bajar el umbral del guard (`seedance.ts:411`) de `duration > 8` a `duration >= 5` (con `!hasTimeline`). `toTimeline` ya exige internamente `beats.length >= 2` (`seedance.ts:115`), así que un clip de 5-8s con 2+ oraciones se reparte en tramos; uno de 1 sola oración no. Role-agnóstico.

3. **OFICIO (validador, warning-only):** regla nueva en `validators.ts` (estilo P21): si un scenePrompt **multi-beat** (timeline con 2+ tramos) tiene algún tramo **sin** plano ni movimiento de cámara reconocible (regex sobre wide/medium/close-up/dolly/pan/tracking/tilt/crane…), emite un warning de producibilidad. **No reescribe** — el compiler ya inyecta `cinematographyDefault` (`seedance.ts`); el warning solo señala el hueco al usuario.

### Por qué el compiler no necesita el `beatRole`

El comportamiento por rol lo carga la **forma del prompt**, no una bandera en el compiler:

- `reveal` → el matcher escribe **un solo beat sostenido** → `toTimeline` ve `beats.length = 1` → **no trocea** (ya escapa el chunking sin saber el rol). Y el planner le dio hasta 12s.
- `action` → el matcher escribe **beats cortos** → `beats.length >= 2` → `toTimeline` reparte en tramos cortos. Y el planner le dio 4-5s.
- `beat` → normal, con el umbral bajado a ≥5s.

Así no hace falta persistir `beatRole` ni leerlo al compilar.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `lib/prompt-director/format-matcher.ts` | SYSTEM: beat de actuación por tramo (P12) + inferencia de `beatRole` + forma por rol (P19); `SceneSchema`/`MatchSchema`: campo `beatRole`; subir `SCENE_MAX_DURATION_S` 8→12 |
| `lib/campaigns/planner.ts` | `maxDurationFor(beatRole)` puro; usarlo en el clamp de escenas (reveal 12 / action 5 / beat 8) en lugar de la constante fija |
| `lib/prompt-director/compilers/seedance.ts` | `toTimeline` guard: `duration >= 5` (antes `> 8`) |
| `lib/prompt-director/validators.ts` | regla nueva: warning si un tramo multi-beat no nombra plano/cámara |
| `lib/prompt-director/format-matcher.test.ts` | `beatRole` se parsea / `catch('beat')`; mover la aserción de clamp 15→8 a 15→12 (el schema ahora topa en 12) |
| `lib/campaigns/planner.test.ts` (o donde viva) | `maxDurationFor`: reveal 12 / action 5 / beat 8; un reveal escapa el clamp de 8 |
| `lib/prompt-director/prompt-director.test.ts` | `toTimeline` reparte un clip de 6s/2-oraciones; un clip de 1 oración no |
| `lib/prompt-director/validators.test.ts` | warning con su prefijo cuando falta plano en tramo multi-beat; ausente cuando está |

## Tests (TDD, sin APIs reales)

- **Matcher (`format-matcher.test.ts`, fetch stubeado):** `beatRole` se parsea para `reveal`/`action`/`beat`; un valor inválido o ausente cae a `beat` (`catch`). La aserción existente del clamp de escena pasa de 15→8 a 15→12 (el techo del schema subió). El texto del SYSTEM (beat de actuación, forma por rol) es prompt LLM → se valida por smoke del usuario, como P0 (`feedback_no_real_api_in_tests`).
- **Planner:** `maxDurationFor('reveal') === 12`, `('action') === 5`, `('beat') === 8`; una escena `reveal` con `durationS` 12 NO se clampa a 8; una `action` se acota a ≤5.
- **Compiler (`prompt-director.test.ts`):** un scenePrompt de 6s con 2 oraciones se reparte en tramos `0-3s/3-6s`; uno de 1 oración a 6s queda como prosa; un clip >8s sigue como hoy.
- **Validador:** warning con prefijo propio (p. ej. `cámara: tramo sin plano`) cuando un timeline de 2+ tramos tiene un tramo sin plano/movimiento; ausente cuando todos lo nombran.

## Decisiones inmutables — verificación

- **>60s / QStash:** sin cambio; nada toca el flujo async submit/poll.
- **URLs de proveedor al cliente:** el compiler solo produce texto; el worker baja el output a Storage igual que hoy.
- **Créditos vía SQL atómicas:** intactos.
- **RLS / service role / DB:** sin tocar (decisión de no persistir `beatRole`).
- **Dos capas IDEA/OFICIO:** el rol y el beat los PROPONE el LLM; la política dura (clamp por rol, umbral de timeline, warning de estructura) es DETERMINISTA y testeable sin Gemini/Atlas, como PD-11/PD-12/PD-15.
- **`feedback_fix_generator_not_output`:** se endurece el generador (SYSTEM + redes deterministas), no se hand-patchea la salida.
- **Sin emojis / sin UI nueva** (dark mode/acento no aplican).

## Riesgos / reconciliaciones

- **P12 beat vs P20 restraint (principal):** el beat por tramo debe leerse como UNA señal secuencial, no apilada. Si la redacción del SYSTEM empuja a "gesto + mirada + respiración + pausa" en el MISMO instante, reintroduce el signal-stacking que P20/P14 evitan. Mitigación: redacción explícita de "una señal por tramo, encadenadas en el tiempo" y verificación en el smoke.
- **`beatRole` mal inferido:** `catch('beat')` garantiza que un rol ausente/ inválido no rompe el plan; el peor caso es comportamiento actual (default). Sin riesgo de bloqueo.
- **reveal de 12s más caro:** un reveal sube de 8 a 12s (más segundos = más costo de generación). Es intencional (aire dramático) y acotado a ese rol; el estimador de créditos ya cobra por duración, sin cambio de lógica.

## Fuera de alcance

- Persistir `beatRole` en DB o exponerlo en UI (YAGNI; vive en plan-time).
- P13 (bloqueo geo-espacial) y P11 (style block) — otra tanda.
- Cualquier cambio de proveedor, créditos o storage.

## Verificación posterior

- `pnpm typecheck` limpio; suite verde (incluye los tests nuevos).
- Smoke del usuario (API real): (a) una idea de "confesión/revelación" produce una escena sostenida más larga (≈10-12s) sin trocear; (b) una idea de "acción rápida" produce cortes cortos; (c) un clip de 6s con 2 acciones sale con timeline `0-3s/3-6s`; (d) la actuación por tramo se lee secuencial y contenida (no histriónica).
