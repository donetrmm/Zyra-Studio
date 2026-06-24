# P14b — Acción como intención+resultado (anti-biomecánica) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evitar que el scenePrompt describa acciones por su biomecánica articular (que produce artefactos), dirigiéndolas por intención + resultado, vía una directiva en el matcher y una red determinista que avisa si la sobre-mecánica se cuela.

**Architecture:** Dos capas del Prompt Director, espejo de P14. Capa IDEA: una directiva anti-biomecánica en el SYSTEM del matcher (LLM). Capa OFICIO: una función pura `findOvermechanicalActions` en `acting.ts` que `validators.ts` consume para emitir un warning no bloqueante. Warning-only — no reescribe.

**Tech Stack:** TypeScript, Vitest, pnpm. Todo dentro de `lib/prompt-director/`. Sin UI, sin DB, sin proveedor, sin API.

## Global Constraints

- **Determinismo:** la capa OFICIO (detector + validator) es pura: sin DB, sin API, sin estado. Mismo input → mismo output.
- **Sin APIs reales en tests** (`feedback_no_real_api_in_tests`): los tests no llaman a Gemini/fal.ai/etc.
- **Fix en el generador, no en el output** (`feedback_fix_generator_not_output`): el arreglo vive en el matcher y la red determinista, nunca en hand-patch de `campaign_items`.
- **Sin emojis** en código.
- **No usar `any`**: `unknown` + narrowing o tipo explícito.
- **El scenePrompt siempre es inglés** (salida del matcher); el detector es inglés-primario con respaldo ES.
- **Gestión de paquetes con pnpm:** `pnpm typecheck`, `pnpm test`.
- **El marcador set del detector debe ser disjunto** de `CONCRETE_ACTION_RE` (gestos buenos de P14): nunca marca nod/snap/lean/step/knee bend; solo rotación-con-sentido, grados, mano-estabiliza-mano, articulación/músculo nombrados.
- **Commits sin trailer `Co-Authored-By`** (`feedback_no_coauthored`).

---

### Task 1: Detector `findOvermechanicalActions` (capa OFICIO)

**Files:**
- Modify: `lib/prompt-director/acting.ts` (agregar regex + función exportada, junto a `findUnexpandedActions`)
- Test: `lib/prompt-director/acting.test.ts` (agregar un bloque `describe`)

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `export function findOvermechanicalActions(text: string): string[]` — devuelve las frases de sobre-mecánica detectadas (en minúsculas, deduplicadas, espacios colapsados). `[]` si no hay ninguna. Lo consume Task 2.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `lib/prompt-director/acting.test.ts`. Primero importar la función nueva: en el bloque de imports (líneas 2-9), añadir `findOvermechanicalActions,` a la lista.

```ts
describe('findOvermechanicalActions', () => {
  it('marca el sentido de rotación', () => {
    expect(findOvermechanicalActions('the right hand rotates the cap counterclockwise')).toEqual(
      expect.arrayContaining(['counterclockwise']),
    );
  });
  it('marca grados explícitos', () => {
    expect(findOvermechanicalActions('she turns the lid at a 90-degree angle')).not.toHaveLength(0);
  });
  it('marca mano-estabiliza-mano', () => {
    expect(
      findOvermechanicalActions('she twists it while the left hand stabilizes the bottle'),
    ).not.toHaveLength(0);
  });
  it('marca mecánica articular nombrada', () => {
    expect(findOvermechanicalActions('he flexes the wrist and extends the elbow')).not.toHaveLength(0);
  });
  it('marca sobre-mecánica en español (respaldo)', () => {
    expect(findOvermechanicalActions('gira la tapa en sentido antihorario')).not.toHaveLength(0);
  });
  it('NO marca las micro-acciones buenas de P14', () => {
    expect(
      findOvermechanicalActions('two head nods, a shoulder turn, a knee bend, a finger snap'),
    ).toHaveLength(0);
  });
  it('NO marca una acción intención-resultado normal', () => {
    expect(
      findOvermechanicalActions('she uncaps the bottle and sets it on the table'),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm test -- acting.test.ts`
Expected: FAIL — `findOvermechanicalActions is not a function` / import no resuelto.

- [ ] **Step 3: Implementar el detector**

Agregar en `lib/prompt-director/acting.ts`, después de `findUnexpandedActions` (tras la línea 70):

```ts
// Detector P14b: sobre-mecánica articular en el scenePrompt. A diferencia de P14
// (que pide DESCOMPONER verbos abstractos en gestos observables), aquí marcamos el
// extremo OPUESTO: mecánica articulación-por-articulación (sentido de rotación,
// grados, mano-estabiliza-mano, articulación/músculo nombrados) que confunde al
// modelo y genera artefactos. El marcador set es DISJUNTO de los gestos buenos de
// P14 (nod/snap/lean/step/knee bend): la presencia de un marcador basta para marcar.
const OVERMECHANICAL_RE =
  /\b(?:counter|anti)?clockwise\b|\b\d{1,3}[- ]?degrees?\b|\bwhile the (?:left|right|other) hand (?:stabiliz|steadi|hold|brac)\w*|\b(?:flex|extend|rotat)\w* the (?:wrist|elbow|knee|shoulder|ankle|hip)\b|\bjoint by joint\b|\bmuscle by muscle\b|\bsentido (?:horario|antihorario)\b|\barticulaci[óo]n\w*/gi;

// Frases de sobre-mecánica halladas (minúsculas, deduplicadas). [] si no hay.
export function findOvermechanicalActions(text: string): string[] {
  const matches = text.match(OVERMECHANICAL_RE);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.toLowerCase().replace(/\s+/g, ' ')))];
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `pnpm test -- acting.test.ts`
Expected: PASS — los 7 tests nuevos verdes, los previos siguen verdes.

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/acting.ts lib/prompt-director/acting.test.ts
git commit -m "feat(prompt-director): detector de sobre-mecanica findOvermechanicalActions (P14b)"
```

---

### Task 2: Regla 11 del validador (warning P14b)

**Files:**
- Modify: `lib/prompt-director/validators.ts` (import + nueva regla tras la regla 10, ~línea 166)
- Test: `lib/prompt-director/validators.test.ts` (nuevo bloque `describe`)

**Interfaces:**
- Consumes: `findOvermechanicalActions(text: string): string[]` de Task 1.
- Produces: warning con prefijo `actuación: sobre-mecánica` cuando el scenePrompt trae sobre-mecánica. No bloquea (no es error).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `lib/prompt-director/validators.test.ts`:

```ts
describe('validators P14b — sobre-mecánica', () => {
  it('avisa cuando la acción se describe por mecánica articular', () => {
    const w = warnings('she twists the cap counterclockwise while the left hand stabilizes the bottle');
    expect(w.some((x) => x.startsWith('actuación: sobre-mecánica'))).toBe(true);
  });
  it('no avisa cuando la acción va por intención y resultado', () => {
    const w = warnings('she uncaps the bottle and sets it on the table, then nods');
    expect(w.some((x) => x.startsWith('actuación: sobre-mecánica'))).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm test -- validators.test.ts`
Expected: FAIL — ningún warning empieza con `actuación: sobre-mecánica` (la regla aún no existe).

- [ ] **Step 3: Importar el detector**

En `lib/prompt-director/validators.ts` línea 7, cambiar:

```ts
import { findUnexpandedActions } from './acting';
```

por:

```ts
import { findUnexpandedActions, findOvermechanicalActions } from './acting';
```

- [ ] **Step 4: Agregar la regla 11**

En `lib/prompt-director/validators.ts`, después del bloque de la regla 10 (tras la línea 166, justo antes de `return { errors, warnings };`):

```ts
  // 11. Sobre-mecánica (P14b): acción descrita por biomecánica articular en vez
  // de intención + resultado. La directiva del matcher debería evitarlo; esto es
  // la red de seguridad si se cuela. No bloquea, no reescribe.
  const overmechanical = findOvermechanicalActions(prompt);
  if (overmechanical.length) {
    warnings.push(
      `actuación: sobre-mecánica (${overmechanical.join(', ')}); descríbela por intención y resultado, no por la mecánica articular`,
    );
  }
```

- [ ] **Step 5: Correr los tests para verificar que pasan**

Run: `pnpm test -- validators.test.ts`
Expected: PASS — los 2 tests nuevos verdes; los P14/P21 previos siguen verdes.

- [ ] **Step 6: typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/validators.ts lib/prompt-director/validators.test.ts
git commit -m "feat(prompt-director): warning de sobre-mecanica en el validador (P14b regla 11)"
```

---

### Task 3: Directiva anti-biomecánica en el SYSTEM del matcher (capa IDEA)

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (extender la regla ACCIÓN Y EMOCIÓN del SYSTEM, ~líneas 290-296)

**Interfaces:**
- Consumes: nada.
- Produces: nada de código. Es un cambio de texto del prompt LLM. Sin test unitario: el SYSTEM es un prompt para Gemini (no exportado, sin comportamiento determinista testeable sin API — `feedback_no_real_api_in_tests`). Igual que se hizo en P0 (commit a3f0a41), se valida por smoke del usuario.

- [ ] **Step 1: Extender la regla ACCIÓN Y EMOCIÓN**

En `lib/prompt-director/format-matcher.ts`, dentro del template literal `SYSTEM`, localizar el final del bloque ACCIÓN Y EMOCIÓN (línea ~294-296):

Texto actual (fragmento a localizar):
```
  señal por instante; nunca apiles varias a la vez en el mismo momento (no "ojos muy
  abiertos + mano en la boca + lágrimas" simultáneos), que sale falso. SONIDO: nombra el sonido diegético clave de cada tramo, breve y
```

Reemplazarlo por (inserta la mitad anti-biomecánica entre "que sale falso." y " SONIDO:"):
```
  señal por instante; nunca apiles varias a la vez en el mismo momento (no "ojos muy
  abiertos + mano en la boca + lágrimas" simultáneos), que sale falso. Pero no te
  pases al otro extremo: describe cada acción por su INTENCIÓN y RESULTADO visible
  ("destapa la botella y la deja en la mesa"), nunca por su biomecánica articular
  ("la mano derecha rota la tapa en sentido antihorario mientras la izquierda
  estabiliza"); el modelo resuelve el CÓMO con su prior físico y sobre-detallar la
  mecánica (qué músculo, qué ángulo, qué articulación) genera artefactos. SONIDO: nombra el sonido diegético clave de cada tramo, breve y
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: sin errores (el template literal sigue bien formado).

- [ ] **Step 3: Suite completa**

Run: `pnpm test`
Expected: toda la suite verde (el cambio es solo texto del SYSTEM; nada debe romperse).

- [ ] **Step 4: Commit**

```bash
git add lib/prompt-director/format-matcher.ts
git commit -m "feat(prompt-director): directiva anti-biomecanica en el SYSTEM del matcher (P14b)"
```

---

## Verificación final (tras las 3 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm test` — suite completa verde (incluye los 9 tests nuevos de P14b).
- [ ] Smoke opcional del usuario (con API real, lo corre el usuario): una idea con biomecánica explícita en el brief debe salir limpia del matcher por la directiva; si se cuela, dispara el warning `actuación: sobre-mecánica` en `campaign_items.warnings`.

## Notas para el implementador

- `findUnexpandedActions` (P14, ya existente) y `findOvermechanicalActions` (P14b, nuevo) son complementarios: el primero marca verbos abstractos SIN desglosar; el segundo marca el extremo opuesto (mecánica articular). Un mismo prompt rara vez dispara ambos. Sus warnings comparten el prefijo `actuación:` pero se distinguen por el resto (`actuación: <verbos>…` vs `actuación: sobre-mecánica…`).
- El marcador `\b\d{1,3}[- ]?degrees?\b` puede marcar un "45-degree" legítimo de cámara muy de vez en cuando; es aceptable (warning, no bloqueo) y rarísimo en una dirección de actuación.
- No agregar export del `SYSTEM` ni inventar un test de substring para el prompt LLM: diverge del patrón de P0 y no aporta señal real.
```
