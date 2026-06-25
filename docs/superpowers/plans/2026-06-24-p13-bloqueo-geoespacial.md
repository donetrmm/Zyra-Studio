# P13 — Bloqueo geo-espacial (Lean) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el matcher declare bloqueo espacial explícito en el `scenePrompt` de escenas multi-sujeto, y que un validator determinista avise cuando falte.

**Architecture:** Red determinista en el prompt-director, mismo patrón que P14/P20/P21: una directiva en el SYSTEM del matcher (capa IDEA, sugiere) + un detector puro (`spatial.ts`) consumido por una nueva regla de `validators.ts` (capa OFICIO, enforce). Sin migración, sin schema-column, sin cambio de compiler.

**Tech Stack:** TypeScript, Vitest, pnpm.

## Global Constraints

- **pnpm**: `pnpm typecheck`, `pnpm vitest run <archivo>`.
- **No `any`**: tipos explícitos.
- **No emojis** en código.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): el detector y el validator son puros; la directiva SYSTEM por smoke.
- **Determinismo del OFICIO**: la regla es función pura sobre `req.scenePrompt` + `ctx.characters`. El SYSTEM solo sugiere.
- **Lenient por diseño**: `hasSpatialBlocking` debe detectar generosamente (cualquier marcador → true) para NO sobre-avisar; un falso positivo del detector solo causa sub-aviso (aceptable), un falso negativo causaría sobre-aviso (no aceptable).
- **Commits sin trailer `Co-Authored-By`.**

---

### Task 1: Detector `spatial.ts` + validator rule 14

**Files:**
- Create: `lib/prompt-director/spatial.ts`
- Create: `lib/prompt-director/spatial.test.ts`
- Modify: `lib/prompt-director/validators.ts` (import + regla 14 antes del `return { errors, warnings }` en la línea ~211)
- Modify: `lib/prompt-director/validators.test.ts` (casos de la regla 14)

**Interfaces:**
- Consumes: `MULTI_SUBJECT_RE` (ya en `validators.ts:37`), `ctx.characters` (`DirectorContext`), `req.scenePrompt` (`CompileRequest`; en `validate` es el local `prompt`).
- Produces: `export function hasSpatialBlocking(text: string): boolean` en `./spatial`.

- [ ] **Step 1: Escribir el test del detector (RED)**

Crear `lib/prompt-director/spatial.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hasSpatialBlocking } from './spatial';

describe('hasSpatialBlocking', () => {
  it('detecta posición + orientación', () => {
    expect(hasSpatialBlocking('Marco on the left facing camera-right, Ana on the right')).toBe(true);
  });
  it('detecta foreground/background y behind', () => {
    expect(hasSpatialBlocking('the product in the foreground, the model behind it')).toBe(true);
  });
  it('detecta "between" y "next to"', () => {
    expect(hasSpatialBlocking('she stands between the two doors, next to the window')).toBe(true);
  });
  it('false cuando no hay marcadores espaciales', () => {
    expect(hasSpatialBlocking('Marco and Ana talk excitedly in the kitchen')).toBe(false);
  });
  it('false con texto vacío', () => {
    expect(hasSpatialBlocking('')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/prompt-director/spatial.test.ts`
Expected: FAIL — `hasSpatialBlocking` no existe.

- [ ] **Step 3: Implementar `spatial.ts`**

Crear `lib/prompt-director/spatial.ts`:

```ts
// P13: detector puro de bloqueo geo-espacial. Una escena multi-sujeto sin
// marcadores de posición/orientación deja al modelo libre de reubicar a los
// sujetos entre cortes. Lenient por diseño: cualquier marcador cuenta como
// "tiene bloqueo" (preferimos sub-avisar a sobre-avisar). El scenePrompt
// siempre va en inglés, así que los marcadores son en inglés.
const SPATIAL_RE =
  /\b(left|right|fore-?ground|back-?ground|mid-?ground|behind|in front of|next to|beside|between|opposite|across from|far side|near side|cent(?:er|re)|facing|faces|turned toward|camera-(?:left|right)|met(?:er|re)s?|feet|apart|arm'?s length)\b/i;

export function hasSpatialBlocking(text: string): boolean {
  return SPATIAL_RE.test(text);
}
```

- [ ] **Step 4: Correr el test (GREEN)**

Run: `pnpm vitest run lib/prompt-director/spatial.test.ts`
Expected: PASS los 5 tests.

- [ ] **Step 5: Escribir el test de la regla 14 (RED)**

En `lib/prompt-director/validators.test.ts`, añade los casos siguientes. **Primero abre el archivo y mira cómo los tests existentes construyen `CompileRequest` y `DirectorContext`** (qué helper/fixture usan); usa ESE patrón para `req`/`ctx`. La aserción aísla la regla 14 por su prefijo `espacial:`, así que otros warnings no interfieren:

```ts
describe('regla 14 — bloqueo geo-espacial (P13)', () => {
  const hasEspacial = (r: { warnings: string[] }) => r.warnings.some((w) => w.startsWith('espacial:'));

  it('2+ personajes sin marcadores espaciales → warning', () => {
    const res = validate(
      { scenePrompt: 'Marco and Ana talk excitedly in the kitchen' } as CompileRequest,
      { characters: [
        { name: 'Marco', description: 'x', masterImagePath: 'p' },
        { name: 'Ana', description: 'y', masterImagePath: 'q' },
      ] } as DirectorContext,
    );
    expect(hasEspacial(res)).toBe(true);
  });

  it('2+ personajes CON bloqueo → sin warning espacial', () => {
    const res = validate(
      { scenePrompt: 'Marco on the left facing camera-right, Ana on the right' } as CompileRequest,
      { characters: [
        { name: 'Marco', description: 'x', masterImagePath: 'p' },
        { name: 'Ana', description: 'y', masterImagePath: 'q' },
      ] } as DirectorContext,
    );
    expect(hasEspacial(res)).toBe(false);
  });

  it('1 personaje sin marcadores → sin warning (no es multi-sujeto)', () => {
    const res = validate(
      { scenePrompt: 'Ana smiles at the camera in the kitchen' } as CompileRequest,
      { characters: [{ name: 'Ana', description: 'y', masterImagePath: 'q' }] } as DirectorContext,
    );
    expect(hasEspacial(res)).toBe(false);
  });

  it('prosa multi-sujeto (MULTI_SUBJECT_RE) sin personajes ni marcadores → warning', () => {
    const res = validate(
      { scenePrompt: 'three friends laugh together at a bar' } as CompileRequest,
      {} as DirectorContext,
    );
    expect(hasEspacial(res)).toBe(true);
  });
});
```

> Nota: ajusta la construcción de `req`/`ctx` y los imports (`validate`, `CompileRequest`, `DirectorContext`) al patrón EXACTO que ya usa `validators.test.ts`. Si el archivo usa un helper tipo `makeCtx(...)`, úsalo en vez de los objetos inline con `as`.

- [ ] **Step 6: Correr el test (RED)**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts`
Expected: FAIL — la regla 14 no existe (los 2 casos que esperan `true` fallan).

- [ ] **Step 7: Añadir el import y la regla 14 a `validators.ts`**

(a) Junto al import de `acting` (`validators.ts:7`), añade:
```ts
import { hasSpatialBlocking } from './spatial';
```

(b) Inserta la regla 14 JUSTO ANTES de `return { errors, warnings };` (línea ~211), después de la regla 13:
```ts
  // 14. Bloqueo geo-espacial (P13): una escena con 2+ sujetos sin marcadores de
  // posición/orientación deja al modelo libre de reubicarlos entre cortes. El
  // SYSTEM del matcher debería emitir el bloqueo; esto es la red de seguridad.
  const multiSubject = (ctx.characters?.length ?? 0) >= 2 || MULTI_SUBJECT_RE.test(prompt);
  MULTI_SUBJECT_RE.lastIndex = 0;
  if (multiSubject && !hasSpatialBlocking(prompt)) {
    warnings.push(
      'espacial: escena con 2+ sujetos sin bloqueo (posición relativa/orientación); el modelo puede reubicarlos entre cortes',
    );
  }
```

> `MULTI_SUBJECT_RE` tiene flag `g` (`validators.ts:38`), así que `.test()` avanza `lastIndex`; el reset tras usarlo evita que una llamada posterior falle. (Mismo cuidado que ya se toma con otras regex `g` en el archivo.)

- [ ] **Step 8: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/spatial.test.ts lib/prompt-director/validators.test.ts` y `pnpm typecheck`
Expected: PASS todos; typecheck limpio; sin regresión en las reglas existentes.

- [ ] **Step 9: Commit**

```bash
git add lib/prompt-director/spatial.ts lib/prompt-director/spatial.test.ts lib/prompt-director/validators.ts lib/prompt-director/validators.test.ts
git commit -m "feat(prompt-director): validator de bloqueo geo-espacial (P13)"
```

---

### Task 2: Directiva SYSTEM de bloqueo en el matcher

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (texto del SYSTEM)

**Interfaces:**
- Consumes: nada nuevo (solo añade texto al SYSTEM existente).
- Produces: nada (cambio de prompt; validado por smoke).

> Sin unit test (es prosa del prompt; el matcher se prueba por smoke). Verifica con `pnpm typecheck` y que los tests del matcher existentes no regresan.

- [ ] **Step 1: Localizar la sección de directivas espaciales del SYSTEM**

Abre `lib/prompt-director/format-matcher.ts` y localiza, dentro del template literal del SYSTEM, las directivas que ya guían geometría/dirección (la de **dirección de desplazamiento** forward/left-to-right y la de **visibilidad en positivo**, alrededor de `:293-304`, y la sección de `scenes` ~`:359-367`). La nueva directiva va junto a esas.

- [ ] **Step 2: Añadir la directiva de bloqueo**

Inserta en el SYSTEM (en inglés, como el resto de directivas que rigen el `scenePrompt` que el modelo escribe en inglés), junto a las directivas espaciales existentes:

```
Spatial blocking: when a scene has two or more subjects (or a clear spatial relationship between a subject and the set), state their blocking explicitly in the scenePrompt — each subject's relative position (left/right/foreground/background/between/behind), their orientation (facing camera-left/right or toward each other), and the key set anchor. This gives the model a stable floor plan so subjects do not drift or swap places between cuts. Keep it brief and woven into the prose, not a separate list.
```

Respeta el estilo del SYSTEM (numeración/bullets/encabezados que ya use esa sección). Si las directivas están numeradas, dale el número siguiente; si son bullets, añádela como bullet.

- [ ] **Step 3: typecheck + tests del matcher**

Run: `pnpm typecheck` y `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: typecheck limpio; los tests del matcher pasan (la directiva es texto; no rompe parseo).

- [ ] **Step 4: Commit**

```bash
git add lib/prompt-director/format-matcher.ts
git commit -m "feat(matcher): directiva de bloqueo geo-espacial para escenas multi-sujeto (P13)"
```

---

## Verificación final (tras las 2 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm vitest run lib/prompt-director/` — verde (detector + regla 14 + matcher, sin regresión).
- [ ] Smoke del usuario:
  1. Generar una idea con dos personajes en una escena → confirmar que el `scenePrompt` compilado trae bloqueo explícito (posición/orientación).
  2. Una escena multi-sujeto sin bloqueo → confirmar el warning `espacial:` en `campaign_items.warnings`.

## Notas para el implementador

- `hasSpatialBlocking` es LENIENT a propósito: detecta generosamente para no sobre-avisar. No lo endurezcas.
- La regla 14 usa el local `prompt` (= `req.scenePrompt?.trim()`), no `req.scenePrompt` directo.
- `MULTI_SUBJECT_RE` tiene flag `g`: resetea `lastIndex` tras `.test()`.
- NO se añade campo `staging` al matcher, ni directiva al compiler, ni columna — eso es la cola diferida (continuidad intra-cadena).
