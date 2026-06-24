# P12 + P19 — Dirección temporal y peso dramático — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que la duración y la densidad de cortes de una escena las dicte su peso dramático (`beatRole`: reveal/action/beat), y enriquecer cada tramo con un beat de actuación concreto — todo en la capa determinista del prompt-director + planner, sin migración.

**Architecture:** El matcher (LLM) infiere un `beatRole` por escena y escribe la forma del prompt acorde (sostenido vs staccato). El planner (determinista) mapea `beatRole` a un techo de duración (reveal 12s / action 5s / beat 8s). El compiler baja el umbral de `toTimeline` a ≥5s. Un validador determinista avisa si un tramo multi-beat no nombra plano/cámara. `beatRole` vive solo en tiempo de plan; no se persiste en DB.

**Tech Stack:** TypeScript, Vitest, pnpm. Todo en `lib/prompt-director/` y `lib/campaigns/planner.ts`. Sin DB, sin proveedor, sin UI.

## Global Constraints

- **pnpm** para todo: `pnpm typecheck`, `pnpm vitest run <archivo>`.
- **No `any`**; **no emojis** en código.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): el matcher se testea con `fetch` stubeado (patrón existente en `format-matcher.test.ts`); el texto del SYSTEM es prompt LLM → se valida por smoke, NO con unit test de substring.
- **Fix en el generador** (`feedback_fix_generator_not_output`): redes deterministas + SYSTEM, nunca hand-patch de la salida.
- **Dos capas:** el rol/beat los PROPONE el LLM; la política dura (clamp, umbral, warning) es DETERMINISTA y testeable sin Gemini.
- **`beatRole` NO se persiste en DB** ni llega al compiler (decisión de arquitectura del spec).
- **Solo `SceneSchema` lleva `beatRole`**, no `MatchSchema`: las ideas de un solo clip no tienen el clamp de secuencia que escapar (su `durationS` ya llega a 15), así que un campo en `MatchSchema` sería un campo sin consumidor determinista. (Tightening del spec, que listaba ambos.)
- **Commits sin trailer `Co-Authored-By`.**

---

### Task 1: `beatRole` en `SceneSchema` + techo del schema a 12

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (`SceneSchema`, `MatchedScene`, el transform de `scenes`, `SCENE_MAX_DURATION_S`)
- Test: `lib/prompt-director/format-matcher.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `SceneSchema` y el tipo `MatchedScene` ganan `beatRole: 'reveal' | 'action' | 'beat'` (default `'beat'`). El schema topa `durationS` en 12. Lo consume Task 2 (planner) y Task 5 (SYSTEM lo emite).

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/prompt-director/format-matcher.test.ts`:

(a) Cambiar la aserción del test existente `clampa la duración de una escena de secuencia a 8s` (el techo del schema sube de 8 a 12). Localiza el bloque y cambia la línea de aserción:

```ts
    expect(res.matches[0].scenes[0].durationS).toBe(12); // 15 → 12 (techo del schema subio)
```

(También renombra el `it(...)` a `'clampa la duración de una escena de secuencia a 12s (techo del schema)'`.)

(b) Agregar tests nuevos del campo `beatRole`:

```ts
  it('parsea beatRole reveal/action en las escenas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'secuencia con reveal', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'she slowly realizes and holds the gaze', durationS: 12, beatRole: 'reveal' },
          { scenePrompt: 'she snaps the cap and turns fast', durationS: 5, beatRole: 'action' },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].beatRole).toBe('reveal');
    expect(res.matches[0].scenes[1].beatRole).toBe('action');
  });

  it('beatRole ausente o inválido cae a beat (catch)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'a normal beat happens here', durationS: 6 },
          { scenePrompt: 'another normal beat', durationS: 6, beatRole: 'nonsense' },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].beatRole).toBe('beat');
    expect(res.matches[0].scenes[1].beatRole).toBe('beat');
  });
```

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: FAIL — `beatRole` es `undefined` (no existe en el schema) y el clamp sigue en 8.

- [ ] **Step 3: Subir el techo del schema**

En `lib/prompt-director/format-matcher.ts:39`:

```ts
const SCENE_MAX_DURATION_S = 12;
```

- [ ] **Step 4: Agregar `beatRole` a `SceneSchema` y `MatchedScene`**

En `SceneSchema` (`format-matcher.ts:94-108`), agregar el campo tras `sceneSummary`:

```ts
  // Peso dramático del beat (P19): modula duración/cortes en el planner. El LLM
  // lo infiere; si falla o lo omite, cae a 'beat' (comportamiento default).
  beatRole: z.enum(['reveal', 'action', 'beat']).catch('beat').default('beat'),
```

Cambiar el tipo `MatchedScene` (`format-matcher.ts:109`):

```ts
export type MatchedScene = {
  scenePrompt: string;
  durationS: number | null;
  sceneSummary: string | null;
  beatRole: 'reveal' | 'action' | 'beat';
};
```

En el transform de `scenes` dentro de `MatchSchema` (`format-matcher.ts:137-151`), agregar `beatRole` al objeto devuelto:

```ts
        return [{
          scenePrompt: parsed.data.scenePrompt,
          durationS: parsed.data.durationS,
          sceneSummary: parsed.data.sceneSummary,
          beatRole: parsed.data.beatRole,
        } satisfies MatchedScene];
```

- [ ] **Step 5: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts` y `pnpm typecheck`
Expected: PASS los tests nuevos + el renombrado; typecheck limpio. (Puede haber un error de tipo en `planner.ts` si consume `MatchedScene` sin `beatRole` — si aparece, NO lo arregles aquí; es de Task 2. Si typecheck falla SOLO por eso, anótalo y sigue; Task 2 lo cierra. Si prefieres, este step puede dejar el typecheck global para después de Task 2.)

> Nota: agregar un campo REQUERIDO a `MatchedScene` puede romper el typecheck en el planner (que construye/consume scenes). Si `planner.ts` falla por `beatRole` faltante, es esperado y lo resuelve Task 2. El test del matcher (Step 5) debe pasar igual.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(matcher): campo beatRole en SceneSchema + techo del schema a 12s (P19)"
```

---

### Task 2: `maxDurationFor` + clamp por rol en el planner

**Files:**
- Modify: `lib/campaigns/planner.ts` (nueva `maxDurationFor`; usarla en el clamp de escenas)
- Test: `lib/campaigns/planner-beatrole.test.ts` (nuevo)

**Interfaces:**
- Consumes: `MatchedScene.beatRole` (Task 1).
- Produces: `export function maxDurationFor(beatRole: 'reveal' | 'action' | 'beat'): number` → reveal 12, action 5, beat 8. Usada en el clamp de duración de escenas de secuencia.

- [ ] **Step 1: Escribir el test (RED)**

Crear `lib/campaigns/planner-beatrole.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maxDurationFor, SEQUENCE_SCENE_MAX_S } from './planner';

describe('maxDurationFor (P19)', () => {
  it('reveal sube el techo a 12s (aire dramático)', () => {
    expect(maxDurationFor('reveal')).toBe(12);
  });
  it('action comprime a 5s', () => {
    expect(maxDurationFor('action')).toBe(5);
  });
  it('beat usa el clamp default de secuencia', () => {
    expect(maxDurationFor('beat')).toBe(SEQUENCE_SCENE_MAX_S);
    expect(maxDurationFor('beat')).toBe(8);
  });
});
```

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/campaigns/planner-beatrole.test.ts`
Expected: FAIL — `maxDurationFor` no existe / no exportada.

- [ ] **Step 3: Implementar `maxDurationFor`**

En `lib/campaigns/planner.ts`, junto a `SEQUENCE_SCENE_MAX_S` (línea 261):

```ts
// P19: techo de duración por peso dramático del beat. reveal pide aire (plano
// sostenido, hasta 12s); action comprime (cortes cortos); beat = default 8s.
export function maxDurationFor(beatRole: 'reveal' | 'action' | 'beat'): number {
  if (beatRole === 'reveal') return 12;
  if (beatRole === 'action') return 5;
  return SEQUENCE_SCENE_MAX_S;
}
```

- [ ] **Step 4: Usar `maxDurationFor` en el clamp de escenas**

En `lib/campaigns/planner.ts`, en el `.map` de `idea.scenes` (líneas 352-357), reemplazar las dos referencias a `SEQUENCE_SCENE_MAX_S` por el techo por rol:

```ts
          durationS: fitDialogueDuration(
            scenePrompt,
            Math.min(sc.durationS ?? format.defaultDurationS, maxDurationFor(sc.beatRole)),
            input.language,
            maxDurationFor(sc.beatRole),
          ),
```

- [ ] **Step 5: Correr el test (GREEN) + typecheck + suite**

Run: `pnpm vitest run lib/campaigns/planner-beatrole.test.ts`, luego `pnpm typecheck`, luego `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`
Expected: PASS los 3 tests nuevos; typecheck limpio (cierra cualquier error de `beatRole` que Task 1 dejara abierto); suite completa verde.

> Si la suite tira `FATAL ERROR ... heap out of memory`, es presión de memoria del runner, no un fallo: reintenta con `NODE_OPTIONS="--max-old-space-size=4096"` (ya incluido arriba).

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/planner.ts lib/campaigns/planner-beatrole.test.ts
git commit -m "feat(planner): clamp de duracion por beatRole (reveal 12s/action 5s/beat 8s) (P19)"
```

---

### Task 3: Bajar el umbral de `toTimeline` a ≥5s

**Files:**
- Modify: `lib/prompt-director/compilers/seedance.ts` (guard de `toTimeline`, línea 411)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: ningún símbolo nuevo. Cambia el comportamiento del compiler: clips de 5-8s con 2+ oraciones se reparten en timeline.

- [ ] **Step 1: Escribir el test (RED)**

En `lib/prompt-director/prompt-director.test.ts`, agregar (sigue el patrón de los tests de compile() del archivo — usa el mismo helper de `compile`/`ctx` que ya exista ahí; si los tests llaman `compile({ modelSlug, scenePrompt, durationS, ... }, ctx)`, replica esa forma):

```ts
  it('reparte en timeline un clip de 6s con 2 oraciones (P12 umbral >=5s)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She lifts the can to camera. She takes a sip and nods.',
        durationS: 6,
      } as CompileRequest,
      {},
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).toMatch(/\b0-3s:|\b3-6s:/);
  });

  it('no reparte un clip de 6s con una sola oración', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'She lifts the can to camera in soft light.',
        durationS: 6,
      } as CompileRequest,
      {},
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).not.toMatch(/\b\d-\ds:/);
  });
```

(Asegúrate de que `compile` y el tipo `CompileRequest` estén importados en el archivo — el resto de tests del archivo ya los usan; reusa esos imports.)

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: FAIL — hoy el guard exige `duration > 8`, así que el clip de 6s NO se reparte y el primer test no encuentra `0-3s:`.

- [ ] **Step 3: Bajar el umbral**

En `lib/prompt-director/compilers/seedance.ts`, en el guard que llama a `toTimeline` (línea 411), cambiar `duration > 8` por `duration >= 5`:

```ts
    duration && duration >= 5 && !hasTimeline(req.scenePrompt)
      ? toTimeline(req.scenePrompt.trim(), duration)
```

(El propio `toTimeline` ya devuelve la acción intacta si hay `< 2` beats o más de `maxBeats`, así que un clip de 1 oración no se reparte aunque pase el guard.)

- [ ] **Step 4: Correr el test (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts` y `pnpm typecheck`
Expected: PASS ambos tests nuevos; typecheck limpio; sin regresión en los demás tests del archivo.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): toTimeline reparte clips desde 5s (P12)"
```

---

### Task 4: Validador de estructura por tramo (warning-only)

**Files:**
- Modify: `lib/prompt-director/validators.ts` (regex de plano + regla nueva tras la 11)
- Test: `lib/prompt-director/validators.test.ts`

**Interfaces:**
- Consumes: nada (usa el `prompt` y el patrón de split por tramos que ya existe en la regla 3b).
- Produces: warning con prefijo `cámara: tramo` cuando un timeline de 2+ tramos tiene un tramo sin plano ni movimiento.

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/prompt-director/validators.test.ts`:

```ts
describe('validators P12 — estructura por tramo', () => {
  it('avisa cuando un tramo multi-beat no nombra plano ni movimiento', () => {
    const w = warnings('0-3s: wide shot, she enters. 3-6s: she takes a sip and nods.', 6);
    expect(w.some((x) => x.startsWith('cámara: tramo'))).toBe(true);
  });
  it('no avisa cuando cada tramo nombra plano o movimiento', () => {
    const w = warnings('0-3s: wide shot, she enters. 3-6s: close-up as she sips.', 6);
    expect(w.some((x) => x.startsWith('cámara: tramo'))).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts`
Expected: FAIL — la regla no existe; el primer test no encuentra el warning.

- [ ] **Step 3: Agregar el regex de plano**

En `lib/prompt-director/validators.ts`, junto a `CAMERA_MOVES` (línea 14), agregar:

```ts
// Tipos de plano reconocidos (en/es): un tramo dirigido nombra un plano o un
// movimiento de cámara. Su ausencia en un tramo multi-beat = actuación sin encuadre.
const SHOT_RE =
  /\b(wide|medium|close[- ]?up|extreme close[- ]?up|ecu|over[- ]the[- ]shoulder|ots|pov|establishing|two[- ]shot|insert|macro|aerial|plano (general|medio|cerrado|americano)|primer plano)\b/i;
```

- [ ] **Step 4: Agregar la regla 12**

En `lib/prompt-director/validators.ts`, después del bloque de la regla 11 (P14b sobre-mecánica) y antes de `return { errors, warnings };`:

```ts
  // 12. Estructura por tramo (P12): en un timeline de 2+ tramos, cada tramo
  // debería abrir con un plano o un movimiento de cámara. Un tramo sin ninguno
  // deja la actuación sin encuadre. Warning, no bloqueo (el compiler ya inyecta
  // cinematographyDefault); usa el mismo split por tramos de la regla 3b.
  for (const tramo of tramos) {
    const hasShot = SHOT_RE.test(tramo);
    const hasMove = matchedLabels(tramo).length > 0;
    if (!hasShot && !hasMove) {
      const label = tramo.match(/\d{1,2}\s*[-–]\s*\d{1,2}\s*s/)?.[0] ?? 'tramo';
      warnings.push(
        `cámara: tramo '${label}' sin plano ni movimiento; nómbralo (wide/medium/close-up, dolly/pan...)`,
      );
    }
  }
```

(Reusa la variable `tramos` ya calculada en la regla 3b — está en el mismo scope de `validate`. Si por orden de código `tramos` quedó fuera de scope, muévela arriba o recalcúlala con el mismo split: `prompt.split(/(?=\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\s*:)/).filter((t) => /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s/.test(t))`.)

- [ ] **Step 5: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts` y `pnpm typecheck`
Expected: PASS los 2 tests nuevos; sin regresión en P14/P14b/P21; typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/validators.ts lib/prompt-director/validators.test.ts
git commit -m "feat(prompt-director): warning de tramo sin plano en timelines multi-beat (P12)"
```

---

### Task 5: SYSTEM del matcher — beat de actuación (P12) + inferencia de beatRole (P19)

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (texto del `SYSTEM`)

**Interfaces:**
- Consumes: el campo `beatRole` de `SceneSchema` (Task 1).
- Produces: nada de código. Cambio de texto del prompt LLM. Sin unit test (validado por smoke, como P0/P14b — `feedback_no_real_api_in_tests`). Los tests de PARSEO de `beatRole` ya están en Task 1.

- [ ] **Step 1: Beat de actuación por tramo (P12)**

En `lib/prompt-director/format-matcher.ts`, dentro del bloque de dirección de cámara/timeline del `SYSTEM`, localizar el final de la regla ACCIÓN Y EMOCIÓN (la frase que termina en `que sale falso.` seguida de la mitad anti-biomecánica de P14b). Justo después de esa mitad anti-biomecánica (antes de ` SONIDO:`), insertar:

```
 BEAT DE ACTUACIÓN POR TRAMO: cada tramo lleva UN beat de actuación
  concreto y observable — un gesto O una dirección de mirada O una respiración/
  micro-pausa (no los tres a la vez): "inhala", "baja la mirada a la mesa",
  "fija los ojos en cámara". Encadénalos EN SECUENCIA por el timeline, una señal
  por instante; nunca apiles varias en el mismo momento (eso es sobreactuar y se
  ve falso). Por defecto contenido, no histriónico.
```

- [ ] **Step 2: Inferencia de `beatRole` en las escenas (P19)**

En el bloque de `scenes` del `SYSTEM` (la descripción del objeto escena, `format-matcher.ts:325-338`), después del campo `"sceneSummary":"..."` y antes del cierre `}`, agregar el campo `beatRole` al objeto-escena que el modelo debe emitir, y la instrucción de forma. Cambiar el cierre del objeto-escena (que hoy termina en `...1 frase"}.`) por:

```
  ...1 frase","beatRole":"el peso dramático de la escena: 'reveal' (una
  revelación, una confesión, un cambio emocional que aterriza — pídela como UN
  plano sostenido, sin cortes internos, con aire/silencio, y dale más segundos
  (hasta 12); minimiza el movimiento de cámara), 'action' (acción física rápida —
  cortes cortos, beats breves, 4-5s), o 'beat' (cualquier otra, ritmo normal).
  Si dudas, 'beat'"}.
```

Y en la instrucción de `durationS` de la escena (`format-matcher.ts:334-337`), ampliar el rango para reveal. Cambiar el rango `4-8` a:

```
  "durationS":"AJUSTA al tiempo que toma DECIR la linea de dialogo de ESA escena
  (o la accion si no hay dialogo): una frase corta = 4-5s, una mas larga hasta 8;
  un beat 'reveal' sostenido puede llegar a 12. entero 4-12. NUNCA infles una
  linea corta — el modelo rellena el silencio repitiendo palabras y el clip se
  traba","sceneSummary":...
```

- [ ] **Step 3: Agregar `beatRole` al ejemplo JSON del objeto-escena (si el SYSTEM trae uno aparte)**

Revisa el JSON final del SYSTEM (`format-matcher.ts:361-362`): es el ejemplo del MATCH (con `scenes:[]` vacío), así que NO necesita `beatRole` (el campo va en el objeto-escena, ya cubierto en Step 2). No cambies esa línea salvo que el objeto-escena se ejemplifique con llaves ahí; en este archivo no es el caso.

- [ ] **Step 4: typecheck + suite completa**

Run: `pnpm typecheck` y `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`
Expected: typecheck limpio; suite verde (el template literal del SYSTEM sigue bien formado; los tests de parseo de `beatRole` de Task 1 siguen pasando).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/format-matcher.ts
git commit -m "feat(matcher): beat de actuacion por tramo (P12) e inferencia de beatRole (P19) en el SYSTEM"
```

---

## Verificación final (tras las 5 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run` — suite completa verde (incluye los tests nuevos de Tasks 1-4).
- [ ] Smoke del usuario (API real, lo corre el usuario):
  1. Una idea de **confesión/revelación** → escena sostenida más larga (≈10-12s), sin trocear, con plano sostenido.
  2. Una idea de **acción rápida** → cortes cortos (4-5s), varios clips.
  3. Un clip de **6s con 2 acciones** → timeline `0-3s/3-6s` en el prompt compilado.
  4. La **actuación por tramo** se lee secuencial y contenida (gesto → mirada → respiración encadenados), no apilada (no contradice P20).
  5. Un timeline con un tramo sin plano dispara el warning `cámara: tramo '...' sin plano...` en `campaign_items.warnings`.

## Notas para el implementador

- **Orden importa:** Task 1 introduce un campo REQUERIDO en `MatchedScene`. Task 2 cierra el typecheck del planner. Si haces Task 1 sola, el typecheck global puede quedar rojo SOLO por el planner — es esperado; el test del matcher de Task 1 pasa igual.
- **`beatRole` NO se persiste** (no hay columna, no llega al compiler). El reveal evita el troceo porque el matcher escribe UN solo beat (1 oración → `toTimeline` no reparte), no porque el compiler conozca el rol. No agregues una columna ni un campo en `campaign_items`.
- El **beat de actuación (P12)** es lo más delicado: la redacción del SYSTEM debe reforzar "una señal por tramo, secuencial" (P20), no empujar a apilar gesto+mirada+respiración en el mismo instante. Si el smoke muestra sobreactuación, el fix es afinar esa frase del SYSTEM, no tocar el compiler.
- No toques `MatchSchema` (ideas de un solo clip): no tienen clamp de secuencia que escapar; un `beatRole` ahí sería un campo sin consumidor.
