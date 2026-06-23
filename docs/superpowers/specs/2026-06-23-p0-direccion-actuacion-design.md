# Diseño — Tanda P0: dirección de actuación y cámara (P14 / P20 / P21)

Fecha: 2026-06-23
Estado: aprobado en brainstorming, pendiente de plan de implementación.

## 1. Contexto y origen

Del análisis del workflow de Higgsfield contra nuestro producto
(`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md` y su
resumen ejecutivo) salió una tanda **P0**: tres principios de dirección que son
de **mayor impacto y menor costo** porque viven enteros en el prompt-director
determinista, no tocan schema, créditos, QStash ni UI, y son testeables sin APIs
reales.

Los tres principios:

- **P14 — Coreografía verbal.** Convertir verbos abstractos ("baila", "se ve
  triste") en micro-acciones observables. Hoy esos verbos pasan crudos al modelo
  y la regla de EMOCIÓN del matcher incluso empuja a NO listar señales.
- **P20 — Restraint en actuación por defecto.** No existe ninguna directiva de
  actuación física en el compiler; la sobre-actuación delata la generación.
- **P21 — Movimientos de cámara motivados.** Hay control técnico fuerte (un
  movimiento por toma, terminología de cine) pero ninguna regla de que el
  movimiento responda a un beat; un dolly puede salir como decoración.

No clonamos Higgsfield/Seedance/GPT-Image: destilamos el principio y lo
adaptamos a nuestro stack.

## 2. Capas del prompt-director (recordatorio)

- **Capa IDEA** = `lib/prompt-director/format-matcher.ts`. Un LLM (Gemini Flash)
  con un SYSTEM que convierte la idea del usuario en `scenePrompt` (y `scenes[]`
  para secuencias). Es estocástico.
- **Capa OFICIO** = `lib/prompt-director/compilers/*` + `validators.ts` +
  `antislop.ts`, orquestados por `index.ts` (`compile()`). Determinista: mismo
  input → mismo output. Inyecta directivas por registro/condición
  (`cinematographyDefault`, `audioDirection`, `SPEECH_DIRECTION`,
  `MULTI_SPEAKER_DIRECTION`) y avisa con warnings que evitan regeneraciones
  pagadas.

Hallazgo clave de la exploración: **Veo y Kling no construyen el prompt ellos
mismos** — delegan en `compilers/video-prose.ts` (`buildVideoProse`). Cualquier
directiva compartida para esos dos modelos se inyecta ahí, no en `veo.ts` /
`kling.ts`.

## 3. Enfoque: híbrido IDEA/OFICIO

- **P14 y P21** son sobre todo **reglas del matcher** (decisión creativa del
  LLM) respaldadas por **detectores deterministas en `validators.ts`** que
  **avisan, no reescriben**.
- **P20** es una **directiva determinista del compiler** (capa OFICIO), calcada
  del patrón register-aware ya existente (`cinematographyDefault`,
  `audioDirection`, `voiceToneForRegister`).

Alternativas descartadas:
- *Todo en el matcher LLM*: sin red determinista, las regresiones son invisibles
  y no se puede testear sin API.
- *Todo determinista reescribiendo el texto de la acción*: cirugía con regex
  sobre prosa libre, frágil, y contraviene "arreglar el generador, no la salida".

## 4. Decisiones tomadas (brainstorming)

1. **P14 vs regla EMOCIÓN:** reescribir la regla a un eje **secuencial vs
   simultáneo**. Una sola regla unificada da coreografía (P14) y restraint
   verbal a la vez: descomponer acción y emoción en micro-beats secuenciales;
   nunca apilar varias señales en el mismo instante.
2. **P20 restraint:** **consciente del registro**. Base contenida para clips con
   rostro en cámara; variante enérgica-controlada para registros bold/kinetic/
   dance; se omite cuando el beat declara emoción alta explícita.
3. **P21 cámara determinista:** **warning por tramo, no reescribir**. Detecta un
   tramo con 2+ movimientos y avisa; nunca toca el texto de la acción.
4. **Alcance P20:** **todos los compilers de video** (Seedance, Veo, Kling) vía
   constante compartida. P14/P21 ya son globales (matcher + validators).

## 5. Diseño detallado

### 5.A — Capa IDEA: ediciones al SYSTEM del matcher (`format-matcher.ts`)

Son ediciones de prompt-engineering al string `SYSTEM` (no hay cambio de lógica
ni de schema).

**A1. P14 — reescribir la regla EMOCIÓN → ACCIÓN+EMOCIÓN.** Reemplaza el texto
actual ("EMOCIÓN: una sola emoción dominante por toma; no apiles señales…") por:

> **ACCIÓN Y EMOCIÓN:** nunca dejes un verbo abstracto sin desglosar. Convierte
> "baila", "celebra", "se ve triste", "se emociona" en **2-4 micro-acciones
> observables repartidas EN SECUENCIA** por el tramo (no "él baila" → "dos
> asentimientos de cabeza, un giro de hombro, una flexión de rodilla, un
> chasquido de dedos"; no "se ve triste" → "baja la mirada a la mesa, traga
> saliva, luego suelta el aire"). **Una sola señal por instante; nunca apiles
> varias a la vez** en el mismo momento (no "ojos muy abiertos + mano en la boca
> + lágrimas" simultáneos). El gesto restringido y secuencial se ve real; el
> apilado simultáneo se ve falso.

**A2. P21 — regla de cámara estática-por-defecto.** Se añade dentro del bloque
DIRECCIÓN DE CÁMARA (refuerza, no reemplaza, "máximo UN movimiento por toma"):

> **CÁMARA POR DEFECTO ESTÁTICA:** empieza cada toma con la cámara fija
> (locked-off). Muévela **solo cuando un beat lo justifique**, y cuando la
> muevas, **nombra el motivo junto al movimiento** ("slow dolly in as she
> realizes", "pan to follow the can as it rolls"). Un movimiento decorativo sin
> motivo se ve barato; si no hay motivo, deja la cámara quieta.

Estas reglas son estocásticas (las aplica el LLM); la red determinista de 5.C
las respalda.

### 5.B — Capa OFICIO: directiva de restraint (P20)

**B1. Nuevo módulo `lib/prompt-director/acting.ts`** (compartido por todos los
compilers de video). Exporta:

```ts
// Constante base (texto de la directiva de actuación contenida).
export const ACTING_RESTRAINT_DIRECTION: string;

// Variante register-aware o null según condición.
export function actingDirectionFor(register: string, highEmotion: boolean): string | null;

// ¿El guion declara una emoción grande (grito/llanto/furia/pánico)?
export function declaresHighEmotion(text: string): boolean;

// ¿Hay un rostro intencional en el clip? (personaje del Cast con hoja maestra,
// o hablante en cámara). Helper compartido para no duplicar la heurística.
export function facesIntended(ctx: DirectorContext, speaker: boolean): boolean;
```

Texto de las directivas:

- **Base (restraint):** *"Acting: grounded, restrained performance —
  micro-expressions, precise eye-line, natural breathing and small involuntary
  movements. The actor reacts and listens; no mugging, no exaggerated faces, no
  theatrical gestures. Emotion shows in small sequential beats, never several
  signals at once."*
- **Variante registro enérgico:** *"Acting: confident, energetic physical
  performance — still controlled and believable, never mugging or over-the-top;
  the body carries the energy through clean, intentional movement."*

Lógica de `actingDirectionFor(register, highEmotion)`:

1. `highEmotion === true` → **return null** (deja pasar la emoción grande
   declarada sin contenerla; ej. un grito o llanto guionizado).
2. registro enérgico (mismo regex que `audioDirection`:
   `/beat|r[ií]tmic|kinet|en[eé]rg|bold|dance|drop|speed ?ramp/`) → variante
   enérgica-controlada.
3. en otro caso → base restraint.

`declaresHighEmotion(text)`: regex sobre el `scenePrompt`, ej.
`/\b(scream|shout|sob|cry|cries|crying|weep|wail|rage|furious|terrified|panic|grito|gritar|llant|llora|sollo|furi|aterr|p[aá]nico)\w*/i`.
(El lexicón exacto se fija en el plan; debe cubrir es/en sin falsos positivos
obvios.)

`facesIntended(ctx, speaker)`: `speaker || (ctx.characters ?? []).some(c =>
c.masterImagePath)`. Es la misma condición que ya usa Seedance para
`NO_REAL_FACES_CLAUSE` (hoy inline en `seedance.ts`); se extrae aquí para
reusarla en `video-prose.ts`.

**B2. Inyección en los compilers:**

- `compilers/seedance.ts`: tras la fidelidad de personajes y antes de
  `NEGATIVE_CLAUSE`, calcular
  `highEmotion = declaresHighEmotion(req.scenePrompt)`,
  `dir = actingDirectionFor(ctx.format?.register ?? '', highEmotion)`, y
  `if (facesIntended(ctx, speaker) && dir) sections.push(dir)`.
  Reusar el `speaker` que ya calcula el compiler. Refactor menor: el cálculo
  inline de `facesIntended` que hoy existe para `NO_REAL_FACES_CLAUSE` pasa a
  usar el helper compartido (sin cambio de comportamiento).
- `compilers/video-prose.ts` (Veo/Kling): misma inyección. `buildVideoProse`
  hoy no calcula `speaker`; se computa con los helpers ya importables de
  `seedance.ts` (`hasSpokenDialogue`/`isVoiceover`) o, más simple, se inyecta la
  directiva cuando `facesIntended(ctx, sceneHasVoice(req.scenePrompt))` —
  decisión fina para el plan. La directiva va antes del guard anti-texto final.

Convivencia: la directiva de actuación es la capa de **intensidad de
performance**; no choca con `SPEECH_DIRECTION` (lip-sync) ni
`cinematographyDefault` (luz/óptica) ni `DIALOGUE_LANGUAGE` (voz). No se inyecta
en clips de puro producto (sin rostro intencional). No se inyecta en compilers
de imagen (FLUX/Nano).

### 5.C — Detectores deterministas en `validators.ts` (avisan, no reescriben)

**C1. P14 — detector de actuación sin desglosar.** En `acting.ts`,
`findUnexpandedActions(text): string[]`:

- **Verbos abstractos** (lexicón en inglés, que es el idioma del `scenePrompt`):
  `dances/dancing, celebrates, parties, plays/playing, works out, exercises,
  relaxes, hangs out, fights/fighting`, y estados de emoción crudos:
  `looks|is (sad|happy|excited|angry|scared|nervous|emotional)`.
- **Tokens concretos de micro-acción** (lexicón): `nod, head, shoulder, hip,
  knee, step, sway, hand, finger, snap, clap, lean, turn, tilt, jaw, eyes,
  blink, breath, swallow, grin, brow, twist, bounce, raises, lifts…`.
- Por cada verbo abstracto presente, mirar su **oración/tramo**; si no hay
  ningún token concreto cerca → marcarlo. `validate()` emite warning:
  *"actuación: 'dances' sin micro-acciones observables; desglosa en gestos
  secuenciales (asiente, gira el hombro, chasquea)"*.

Es heurística → warning, no bloqueo. Un verbo ya desglosado ("she dances — two
head nods, a shoulder roll") no dispara falso positivo porque hay tokens
concretos en el mismo tramo.

**C2. P21 — chequeo de cámara por tramo.** Hoy `validators.ts` cuenta `>2`
movimientos en TODO el prompt (se conserva). Se añade un check por tramo: partir
el prompt por marcadores de timeline (`/\d{1,2}\s*[-–]\s*\d{1,2}\s*s\b/`), correr
`matchedLabels` por tramo, y si un tramo tiene `>1` movimiento distinto → warning
con la etiqueta del tramo: *"cámara: tramo '0-3s' tiene 2 movimientos (dolly,
pan); deja uno"*. Esto respalda deterministamente la regla del matcher "nunca dos
movimientos en el mismo tramo".

### 5.D — Archivos tocados (resumen)

| Archivo | Cambio |
|---|---|
| `lib/prompt-director/format-matcher.ts` | A1 (regla ACCIÓN+EMOCIÓN), A2 (cámara estática por defecto) en el SYSTEM |
| `lib/prompt-director/acting.ts` | **Nuevo.** `ACTING_RESTRAINT_DIRECTION`, `actingDirectionFor`, `declaresHighEmotion`, `facesIntended`, `findUnexpandedActions` |
| `lib/prompt-director/compilers/seedance.ts` | Inyectar directiva de actuación; reusar `facesIntended` compartido |
| `lib/prompt-director/compilers/video-prose.ts` | Inyectar directiva de actuación (Veo/Kling) |
| `lib/prompt-director/validators.ts` | C1 (warning actuación sin desglosar), C2 (warning cámara por tramo) |
| `lib/prompt-director/acting.test.ts` | **Nuevo.** Tests de `acting.ts` |
| `lib/prompt-director/validators.test.ts` (o existente) | Tests de C1/C2 |

## 6. Testing (sin APIs reales)

- `acting.test.ts`: `declaresHighEmotion` (positivos/negativos es+en),
  `actingDirectionFor` (3 ramas: highEmotion→null, enérgico→variante,
  default→base), `findUnexpandedActions` (verbo crudo se marca / verbo desglosado
  no se marca), `facesIntended` (con personaje, con hablante, clip de producto).
- Validators: warning por tramo con 2 movimientos; sin warning con 1 por tramo
  aunque haya 3 en total; warning de actuación sin desglosar.
- Compilers: `seedance` y `video-prose` inyectan restraint con rostro
  intencional; lo omiten en clip de puro producto; lo omiten con emoción alta
  declarada; eligen la variante enérgica en registro bold/dance.
- Las ediciones al SYSTEM del matcher NO son testeables de forma determinista
  (es el LLM) → smoke con API real lo corre el usuario.

## 7. Criterios de éxito

- Un clip con personaje y acción abstracta produce, tras el matcher,
  micro-acciones secuenciales; si no, salta warning visible en
  `campaign_items.warnings`.
- Todo clip de video con rostro intencional lleva la directiva de actuación
  adecuada al registro; los clips de puro producto no la llevan.
- La cámara no se mueve sin motivo; los tramos con 2+ movimientos saltan warning.
- `pnpm typecheck` y `pnpm test` verdes.

## 8. Fuera de alcance (YAGNI)

- No reescribe la acción del usuario (solo avisa).
- No toca créditos, QStash, RLS, schema ni UI.
- No toca compilers de imagen (FLUX/Nano).
- No implementa P14b / P25 / P03 ni el resto de quick wins; esta tanda es solo
  P14 / P20 / P21.

## 9. Riesgos y mitigaciones

- **Falsos positivos del detector de actuación (C1):** los lexicones son
  heurística. Mitigación: es warning, no bloqueo; se afina el lexicón con el
  smoke. No degrada ninguna generación.
- **La directiva de restraint pelea con un registro enérgico:** mitigado por la
  variante register-aware (energía controlada) y por la omisión en emoción alta
  declarada.
- **Edición del SYSTEM del matcher cambia comportamiento tuneado a mano:** la
  reescritura A1 conserva el espíritu anti-mugging (eje simultáneo) y solo añade
  el eje secuencial; el usuario valida con smoke real antes de mergear.
- **Veo/Kling: cálculo de `speaker` distinto al de Seedance:** se documenta la
  decisión fina en el plan; por defecto se usa `sceneHasVoice` para no perder
  cobertura.
