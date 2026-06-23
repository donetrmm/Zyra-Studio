# Tanda P0: dirección de actuación y cámara — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir la calidad de actuación y cámara del video generado adaptando tres principios del análisis Higgsfield (P14 coreografía verbal, P20 restraint, P21 cámara motivada), enteros en el prompt-director determinista.

**Architecture:** Híbrido IDEA/OFICIO. La capa IDEA (SYSTEM del matcher Gemini) escribe micro-acciones secuenciales (P14) y cámara estática-por-defecto motivada (P21). La capa OFICIO (compilers + validators, deterministas) inyecta una directiva de restraint consciente del registro (P20) y emite warnings cuando el matcher falla (detectores P14/P21), sin reescribir nunca la acción del usuario.

**Tech Stack:** TypeScript, Next.js 15, Vitest. Sin dependencias nuevas. Diseño completo en `docs/superpowers/specs/2026-06-23-p0-direccion-actuacion-design.md`.

## Global Constraints

- **Determinista:** el prompt-director no llama a ninguna API; mismo input → mismo output.
- **Arreglar el generador, no la salida:** los detectores AVISAN (warnings), nunca reescriben el `scenePrompt`.
- **Tests sin APIs reales:** ningún test llama a Gemini/Seedance/etc. El matcher se prueba mockeando `fetch`; las ediciones del SYSTEM del matcher las valida el usuario con smoke real.
- **TypeScript sin `any`:** usar `unknown` + narrowing o tipos explícitos.
- **Sin emojis** en código ni en el texto de prompts/directivas.
- **Gestor:** `pnpm` (no `npm`). Runner: `pnpm test` = `vitest run`; targeted: `pnpm vitest run <archivo>`. Tipos: `pnpm typecheck`.
- **Commits sin `Co-Authored-By`.** Convención: `feat(prompt-director): ...` / `test(prompt-director): ...`.
- **No tocar:** créditos, QStash, RLS, schema, UI, ni los compilers de imagen (FLUX/Nano).
- Idioma del `scenePrompt` = inglés; idioma del SYSTEM del matcher = español (como el resto del archivo).

---

### Task 1: Módulo `acting.ts` — directiva de restraint y helpers (P20)

**Files:**
- Create: `lib/prompt-director/acting.ts`
- Test: `lib/prompt-director/acting.test.ts`

**Interfaces:**
- Consumes: `DirectorContext` de `./types`.
- Produces:
  - `ACTING_RESTRAINT_DIRECTION: string`
  - `ACTING_ENERGETIC_DIRECTION: string`
  - `declaresHighEmotion(text: string): boolean`
  - `actingDirectionFor(register: string, highEmotion: boolean): string | null`
  - `facesIntended(ctx: DirectorContext, speaker: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/prompt-director/acting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ACTING_RESTRAINT_DIRECTION,
  ACTING_ENERGETIC_DIRECTION,
  actingDirectionFor,
  declaresHighEmotion,
  facesIntended,
} from './acting';

describe('declaresHighEmotion', () => {
  it('detecta emoción grande (en y es)', () => {
    expect(declaresHighEmotion('she screams at him')).toBe(true);
    expect(declaresHighEmotion('rompe en llanto frente a la cámara')).toBe(true);
  });
  it('no marca una acción tranquila', () => {
    expect(declaresHighEmotion('she lifts the can and smiles softly')).toBe(false);
  });
});

describe('actingDirectionFor', () => {
  it('emoción alta declarada -> null (deja pasar la emoción)', () => {
    expect(actingDirectionFor('cinematic brand film', true)).toBeNull();
  });
  it('registro enérgico -> variante enérgica controlada', () => {
    expect(actingDirectionFor('bold kinetic dance', false)).toBe(ACTING_ENERGETIC_DIRECTION);
  });
  it('registro neutro -> base restraint', () => {
    expect(actingDirectionFor('testimonio cercano', false)).toBe(ACTING_RESTRAINT_DIRECTION);
  });
});

describe('facesIntended', () => {
  it('true con personaje del Cast (hoja maestra)', () => {
    expect(
      facesIntended(
        { characters: [{ name: 'Pedro', description: 'x', masterImagePath: 'ws/p.png' }] },
        false,
      ),
    ).toBe(true);
  });
  it('true con hablante en cámara aunque no haya Cast', () => {
    expect(facesIntended({}, true)).toBe(true);
  });
  it('false en clip de puro producto', () => {
    expect(facesIntended({ product: { name: 'Canvas', imagePaths: ['ws/p.png'] } }, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/prompt-director/acting.test.ts`
Expected: FAIL — `Failed to resolve import "./acting"` (el módulo no existe aún).

- [ ] **Step 3: Write minimal implementation**

Create `lib/prompt-director/acting.ts`:

```ts
// lib/prompt-director/acting.ts
// Dirección de actuación física (tanda P0; principios P14/P20/P21 del análisis
// Higgsfield, ver docs/Generación de videos con IA/hallazgos-higgsfield-completo.md).
// Capa OFICIO determinista: directivas de restraint conscientes del registro que
// se inyectan en los compilers de video, más el detector de actuación sin desglosar
// que consume validators.ts. No llama a ninguna API; mismo input -> mismo output.

import type { DirectorContext } from './types';

// Directiva base de actuación contenida (P20): micro-expresiones, sin sobreactuar.
// Calcada del patrón register-aware de cinematographyDefault/audioDirection.
export const ACTING_RESTRAINT_DIRECTION =
  'Acting: grounded, restrained performance — micro-expressions, precise eye-line, natural breathing and small involuntary movements. The actor reacts and listens; no mugging, no exaggerated faces, no theatrical gestures. Emotion shows in small sequential beats, never several signals at once.';

// Variante para registros enérgicos (bold/kinetic/dance): energía controlada, sin
// sobreactuar. Mismo eje "creíble, no histriónico" que la base.
export const ACTING_ENERGETIC_DIRECTION =
  'Acting: confident, energetic physical performance — still controlled and believable, never mugging or over-the-top; the body carries the energy through clean, intentional movement.';

// Registros que piden energía física (mismo criterio que audioDirection #2 en
// compilers/seedance.ts).
const ENERGETIC_REGISTER_RE = /beat|r[ií]tmic|kinet|en[eé]rg|bold|dance|drop|speed ?ramp/i;

// ¿El guion declara una emoción grande (grito/llanto/furia/pánico)? Cuando la hay,
// NO se inyecta restraint: dejamos pasar la emoción declarada sin contenerla.
const HIGH_EMOTION_RE =
  /\b(scream|shout|sob|cry|cries|crying|weep|wail|rage|furious|terrified|panic|grito|gritar|llant|llora|sollo|furi|aterr|p[aá]nico)\w*/i;

export function declaresHighEmotion(text: string): boolean {
  return HIGH_EMOTION_RE.test(text);
}

// Directiva de actuación adecuada al registro y la emoción declarada, o null
// cuando no debe inyectarse (emoción alta declarada).
export function actingDirectionFor(register: string, highEmotion: boolean): string | null {
  if (highEmotion) return null;
  return ENERGETIC_REGISTER_RE.test(register)
    ? ACTING_ENERGETIC_DIRECTION
    : ACTING_RESTRAINT_DIRECTION;
}

// ¿Hay un rostro intencional en el clip? (personaje del Cast con hoja maestra, o
// hablante en cámara). Misma condición que el guard NO_REAL_FACES_CLAUSE de Seedance.
export function facesIntended(ctx: DirectorContext, speaker: boolean): boolean {
  return speaker || (ctx.characters ?? []).some((c) => !!c.masterImagePath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/prompt-director/acting.test.ts`
Expected: PASS (4 describe blocks, 8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/acting.ts lib/prompt-director/acting.test.ts
git commit -m "feat(prompt-director): directiva de actuacion restraint consciente del registro (P20)"
```

---

### Task 2: Inyectar restraint en el compiler de Seedance (P20)

**Files:**
- Modify: `lib/prompt-director/compilers/seedance.ts`
- Test: `lib/prompt-director/prompt-director.test.ts` (añadir un `describe`)

**Interfaces:**
- Consumes: `actingDirectionFor`, `declaresHighEmotion`, `facesIntended` de `../acting`; el `speaker` ya calculado dentro de `compileSeedance`.
- Produces: el prompt de Seedance contiene `ACTING_RESTRAINT_DIRECTION` / `ACTING_ENERGETIC_DIRECTION` cuando hay rostro intencional y no hay emoción alta declarada.

- [ ] **Step 1: Write the failing test**

Añadir al final de `lib/prompt-director/prompt-director.test.ts`:

```ts
describe('P20 — directiva de actuación (Seedance)', () => {
  const product = { name: 'Canvas', imagePaths: ['ws/prod.png'] };

  it('inyecta restraint con personaje en cámara', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'Pedro lifts the product and nods to camera' },
      {
        product,
        characters: [{ name: 'Pedro', description: 'man with mustache', masterImagePath: 'ws/pedro.png' }],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).toContain('grounded, restrained performance');
  });

  it('no inyecta actuación en clip de puro producto', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'the can rotates slowly on a table' },
      { product },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).not.toContain('restrained performance');
    expect(r.compiled.prompt).not.toContain('energetic physical performance');
  });

  it('omite restraint si el guion declara emoción alta', () => {
    const r = compile(
      { modelSlug: 'seedance-2', scenePrompt: 'Pedro screams in rage at the camera' },
      {
        product,
        characters: [{ name: 'Pedro', description: 'man', masterImagePath: 'ws/pedro.png' }],
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).not.toContain('restrained performance');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: FAIL en "inyecta restraint con personaje en cámara" — el prompt no contiene la directiva todavía.

- [ ] **Step 3: Write minimal implementation**

En `lib/prompt-director/compilers/seedance.ts`:

1. Añadir el import (junto a los demás imports, arriba):

```ts
import { actingDirectionFor, declaresHighEmotion, facesIntended } from '../acting';
```

2. Insertar la inyección JUSTO ANTES del bloque `// A — Acción` (antes de la línea `const actionIndex = sections.length;`):

```ts
  // Dirección de actuación (P20): restraint consciente del registro, solo cuando
  // hay rostro intencional (personaje del Cast o hablante en cámara) y el beat no
  // declara una emoción grande. Convive con SPEECH_DIRECTION (lip-sync) y
  // cinematographyDefault (luz): esto es la INTENSIDAD de la performance.
  const actingDir = actingDirectionFor(
    ctx.format?.register ?? '',
    declaresHighEmotion(req.scenePrompt),
  );
  if (actingDir && facesIntended(ctx, speaker)) sections.push(actingDir);
```

3. Reemplazar el cálculo inline de `facesIntended` cerca del final (las dos líneas
   actuales `const facesIntended = (ctx.characters ?? []).some(...) || speaker;` y
   `if (!facesIntended) sections.push(NO_REAL_FACES_CLAUSE);`) por el uso del helper:

```ts
  // Guard anti-rostros solo si NINGÚN rostro es intencional (mismo criterio que la
  // directiva de actuación, ahora compartido en acting.ts).
  if (!facesIntended(ctx, speaker)) sections.push(NO_REAL_FACES_CLAUSE);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: PASS (incluye los 3 tests nuevos del describe P20 + los existentes).

- [ ] **Step 5: Typecheck y commit**

Run: `pnpm typecheck`
Expected: sin errores.

```bash
git add lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): inyecta la directiva de actuacion en el compiler de Seedance (P20)"
```

---

### Task 3: Inyectar restraint en `video-prose.ts` (Veo/Kling) (P20)

**Files:**
- Modify: `lib/prompt-director/compilers/video-prose.ts`
- Test: `lib/prompt-director/prompt-director.test.ts` (añadir un `describe`)

**Interfaces:**
- Consumes: `actingDirectionFor`, `declaresHighEmotion`, `facesIntended` de `../acting`; `sceneHasVoice` (ya importado de `./seedance`) como aproximación del `speaker`.
- Produces: los prompts de Veo y Kling contienen la directiva de actuación cuando hay rostro intencional.

- [ ] **Step 1: Write the failing test**

Añadir al final de `lib/prompt-director/prompt-director.test.ts`:

```ts
describe('P20 — directiva de actuación (Veo/Kling vía video-prose)', () => {
  it('inyecta restraint con hablante en cámara (Kling)', () => {
    const r = compile(
      { modelSlug: 'kling-3', scenePrompt: 'a presenter to camera says "this really works"', generateAudio: true },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).toContain('restrained performance');
  });

  it('no inyecta en clip de puro producto (Veo)', () => {
    const r = compile(
      { modelSlug: 'veo-3', scenePrompt: 'the bottle sits still on a shelf' },
      { product: { name: 'X', imagePaths: ['ws/x.png'] } },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compiled.prompt).not.toContain('restrained performance');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: FAIL en "inyecta restraint con hablante en cámara (Kling)" — la prosa no contiene la directiva.

- [ ] **Step 3: Write minimal implementation**

En `lib/prompt-director/compilers/video-prose.ts`:

1. Añadir el import (junto a los existentes):

```ts
import { actingDirectionFor, declaresHighEmotion, facesIntended } from '../acting';
```

2. Insertar la inyección después del bloque de dirección de formato (después del
   `if (ctx.format) { ... }` que arma `direction`), antes del bloque de voz:

```ts
  // Dirección de actuación (P20) para Veo/Kling: mismas reglas que Seedance. Aquí
  // el "hablante en cámara" se aproxima con sceneHasVoice (video-prose no separa
  // lip-sync); basta para decidir si hay rostro intencional que dirigir.
  const actingDir = actingDirectionFor(
    ctx.format?.register ?? '',
    declaresHighEmotion(req.scenePrompt),
  );
  if (actingDir && facesIntended(ctx, sceneHasVoice(req.scenePrompt))) {
    sections.push(actingDir);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: PASS (incluye los 2 tests nuevos).

- [ ] **Step 5: Typecheck y commit**

Run: `pnpm typecheck`
Expected: sin errores.

```bash
git add lib/prompt-director/compilers/video-prose.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): inyecta la directiva de actuacion en Veo/Kling via video-prose (P20)"
```

---

### Task 4: Detector P14 (actuación sin desglosar) + warning en validators

**Files:**
- Modify: `lib/prompt-director/acting.ts` (añadir `findUnexpandedActions`)
- Modify: `lib/prompt-director/validators.ts` (emitir el warning)
- Test: `lib/prompt-director/acting.test.ts` (detector) y `lib/prompt-director/validators.test.ts` (nuevo, warning end-to-end)

**Interfaces:**
- Consumes: `findUnexpandedActions(text: string): string[]` de `../acting`.
- Produces: `validate()` añade un warning que empieza con `actuación:` cuando hay verbos abstractos sin micro-acciones.

- [ ] **Step 1: Write the failing tests**

Añadir a `lib/prompt-director/acting.test.ts`:

```ts
import { findUnexpandedActions } from './acting';

describe('findUnexpandedActions', () => {
  it('marca un verbo abstracto sin micro-acciones', () => {
    expect(findUnexpandedActions('he dances in the kitchen')).toContain('dances');
  });
  it('no marca un verbo ya desglosado en gestos', () => {
    expect(
      findUnexpandedActions('he dances: two head nods, a shoulder roll, a finger snap'),
    ).toHaveLength(0);
  });
  it('marca un estado de emoción crudo', () => {
    expect(findUnexpandedActions('she looks sad by the window')).toEqual(
      expect.arrayContaining(['looks sad']),
    );
  });
});
```

Crear `lib/prompt-director/validators.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validate } from './validators';
import type { CompileRequest, DirectorContext } from './types';

const ctx: DirectorContext = {};
function warnings(scenePrompt: string, durationS?: number): string[] {
  return validate({ modelSlug: 'seedance-2', scenePrompt, durationS } as CompileRequest, ctx).warnings;
}

describe('validators P14 — actuación sin desglosar', () => {
  it('avisa cuando hay un verbo abstracto sin micro-acciones', () => {
    expect(warnings('a person dances in the street').some((w) => w.startsWith('actuación:'))).toBe(true);
  });
  it('no avisa cuando la acción ya está desglosada', () => {
    const w = warnings('a person dances: two head nods, a shoulder roll, a knee bend');
    expect(w.some((x) => x.startsWith('actuación:'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run lib/prompt-director/acting.test.ts lib/prompt-director/validators.test.ts`
Expected: FAIL — `findUnexpandedActions` no existe / no hay warning `actuación:`.

- [ ] **Step 3: Write minimal implementation**

1. En `lib/prompt-director/acting.ts`, añadir al final:

```ts
// Detector P14: verbos de acción/emoción abstractos que NO traen micro-acciones
// observables cerca. Heurística -> validators emite warning (no bloquea, no reescribe).
const ABSTRACT_ACTION_RE =
  /\b(dances?|dancing|celebrat\w*|part(?:y|ies|ying)|plays?|playing|works? out|working out|exercis\w*|relax\w*|hangs? out|fights?|fighting|(?:looks?|is|are|seems?)\s+(?:sad|happy|excited|angry|scared|nervous|emotional))\b/gi;

const CONCRETE_ACTION_RE =
  /\b(nods?|head|shoulders?|hips?|knees?|steps?|sway\w*|hands?|fingers?|snaps?|claps?|leans?|turns?|tilts?|jaw|eyes?|blinks?|breath\w*|swallows?|grins?|brow|twist\w*|bounc\w*|raises?|lifts?|points?|reaches?|taps?)\b/i;

// Parte en oraciones/tramos y, por cada verbo abstracto, comprueba si su tramo tiene
// algún token concreto. Devuelve los verbos abstractos sin desglosar (en minúsculas).
export function findUnexpandedActions(text: string): string[] {
  const segments = text.split(/(?<=[.;])\s+|\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\s*:/);
  const flagged = new Set<string>();
  for (const seg of segments) {
    if (CONCRETE_ACTION_RE.test(seg)) continue;
    const matches = seg.match(ABSTRACT_ACTION_RE);
    if (matches) for (const m of matches) flagged.add(m.toLowerCase().replace(/\s+/g, ' '));
  }
  return [...flagged];
}
```

2. En `lib/prompt-director/validators.ts`:

Añadir el import (junto a los existentes, arriba):

```ts
import { findUnexpandedActions } from './acting';
```

Insertar la regla antes del `return { errors, warnings };` final:

```ts
  // 10. Actuación sin desglosar (P14): verbos abstractos sin micro-acciones.
  const unexpanded = findUnexpandedActions(prompt);
  if (unexpanded.length) {
    warnings.push(
      `actuación: ${unexpanded.join(', ')} sin micro-acciones observables; desglosa en gestos secuenciales (asiente, gira el hombro, chasquea)`,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run lib/prompt-director/acting.test.ts lib/prompt-director/validators.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck y commit**

Run: `pnpm typecheck`
Expected: sin errores.

```bash
git add lib/prompt-director/acting.ts lib/prompt-director/acting.test.ts lib/prompt-director/validators.ts lib/prompt-director/validators.test.ts
git commit -m "feat(prompt-director): detector de actuacion sin desglosar con warning (P14)"
```

---

### Task 5: Detector P21 (cámara por tramo) en validators

**Files:**
- Modify: `lib/prompt-director/validators.ts`
- Test: `lib/prompt-director/validators.test.ts` (añadir un `describe`)

**Interfaces:**
- Consumes: la función `matchedLabels` ya existente en `validators.ts`.
- Produces: `validate()` añade un warning que empieza con `cámara: el tramo` cuando un tramo del timeline tiene 2+ movimientos distintos. El warning global `>2` se conserva.

- [ ] **Step 1: Write the failing test**

Añadir a `lib/prompt-director/validators.test.ts`:

```ts
describe('validators P21 — cámara por tramo', () => {
  it('avisa con 2 movimientos en el mismo tramo', () => {
    const w = warnings('0-3s: dolly in and pan left as she enters. 3-6s: static close-up of the can.', 6);
    expect(w.some((x) => x.startsWith('cámara: el tramo'))).toBe(true);
  });
  it('no avisa con un movimiento por tramo aunque haya varios en total', () => {
    const w = warnings('0-3s: dolly in on her face. 3-6s: pan to the can. 6-9s: tilt up to the sign.', 9);
    expect(w.some((x) => x.startsWith('cámara: el tramo'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts`
Expected: FAIL en "avisa con 2 movimientos en el mismo tramo" — no existe el warning por tramo.

- [ ] **Step 3: Write minimal implementation**

En `lib/prompt-director/validators.ts`, justo después del bloque "3. Una sola
dirección de cámara" (el que usa `matchedLabels(prompt)` y avisa con `moves.length > 2`),
insertar:

```ts
  // 3b. Cámara por tramo (P21): 2+ movimientos en el MISMO tramo del timeline son
  // contradictorios (la regla del matcher pide uno por tramo). Más preciso que el
  // conteo global de arriba, que es legítimo a lo largo de varios tramos.
  const tramos = prompt
    .split(/(?=\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s\s*:)/)
    .filter((t) => /\b\d{1,2}\s*[-–]\s*\d{1,2}\s*s/.test(t));
  for (const tramo of tramos) {
    const tramoMoves = matchedLabels(tramo);
    if (tramoMoves.length > 1) {
      const label = tramo.match(/\d{1,2}\s*[-–]\s*\d{1,2}\s*s/)?.[0] ?? 'tramo';
      warnings.push(
        `cámara: el tramo '${label}' tiene ${tramoMoves.length} movimientos (${tramoMoves.join(', ')}); deja uno`,
      );
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts`
Expected: PASS (los 4 tests del archivo: 2 de P14 + 2 de P21).

- [ ] **Step 5: Typecheck y commit**

Run: `pnpm typecheck`
Expected: sin errores.

```bash
git add lib/prompt-director/validators.ts lib/prompt-director/validators.test.ts
git commit -m "feat(prompt-director): warning de camara con 2+ movimientos por tramo (P21)"
```

---

### Task 6: Reglas del matcher en el SYSTEM (P14 + P21, capa IDEA)

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (string `SYSTEM`)

**Interfaces:**
- Consumes: nada nuevo (edición de prosa del SYSTEM).
- Produces: el matcher instruye al LLM a desglosar acción/emoción en secuencia (P14) y a usar cámara estática por defecto con motivo nombrado (P21).

**Nota:** estas ediciones NO son testeables de forma determinista (es la salida del LLM). Los tests existentes de `format-matcher.test.ts` mockean `fetch` y NO comprueban el SYSTEM, así que deben seguir verdes. La validación real es el smoke con API que corre el usuario.

- [ ] **Step 1: Editar la regla EMOCIÓN -> ACCIÓN Y EMOCIÓN (P14)**

En el string `SYSTEM` de `lib/prompt-director/format-matcher.ts`, reemplazar el
fragmento actual:

```
EMOCIÓN: una
  sola emoción dominante por toma; no apiles señales (no "ojos muy abiertos + mano
  en la boca + lágrimas" a la vez), que sale falso.
```

por:

```
ACCIÓN Y EMOCIÓN: nunca dejes un verbo abstracto sin desglosar.
  Convierte "baila", "celebra", "se ve triste", "se emociona" en 2-4 micro-acciones
  observables repartidas EN SECUENCIA por el tramo (no "él baila" → "dos asentimientos
  de cabeza, un giro de hombro, una flexión de rodilla, un chasquido de dedos"; no "se
  ve triste" → "baja la mirada a la mesa, traga saliva, luego suelta el aire"). Una sola
  señal por instante; nunca apiles varias a la vez en el mismo momento (no "ojos muy
  abiertos + mano en la boca + lágrimas" simultáneos), que sale falso.
```

- [ ] **Step 2: Añadir la regla de cámara estática por defecto (P21)**

En el mismo string `SYSTEM`, en el bloque DIRECCIÓN DE CÁMARA, localizar la frase:

```
Una acción + un movimiento por toma — nunca dos movimientos en el mismo tramo.
```

y AÑADIR inmediatamente después (misma posición, antes de "MOVIMIENTO DE ELEMENTOS:"):

```
 CÁMARA POR DEFECTO ESTÁTICA: empieza cada toma con la cámara fija (locked-off);
  muévela solo cuando un beat lo justifique y nombra el motivo junto al movimiento
  ("slow dolly in as she realizes", "pan to follow the can as it rolls"). Un
  movimiento decorativo sin motivo se ve barato; si no hay motivo, deja la cámara
  quieta.
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores (solo cambió una cadena).

- [ ] **Step 4: Correr la suite del matcher (no debe romperse)**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: PASS (los tests mockean `fetch` y no comprueban el SYSTEM).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/format-matcher.ts
git commit -m "feat(prompt-director): coreografia verbal secuencial y camara estatica por defecto en el matcher (P14/P21)"
```

---

### Cierre: verificación final y smoke

- [ ] **Step 1: Suite completa + tipos**

Run: `pnpm test`
Expected: toda la suite verde.

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 2: Smoke real (lo corre el usuario)**

Recordatorio para el usuario: validar con una generación real (Campaign Studio o
`pnpm smoke:seedance`) que (a) una idea con "baila/celebra" sale con micro-acciones
secuenciales, (b) los clips con personaje llevan la directiva de actuación, (c) la
cámara no se mueve sin motivo, y revisar los `warnings` de `campaign_items`.

## Self-review (cobertura del spec)

- **5.A1 P14 matcher** → Task 6 Step 1. **5.A2 P21 matcher** → Task 6 Step 2.
- **5.B P20 acting.ts** → Task 1. **Inyección Seedance** → Task 2. **Inyección Veo/Kling** → Task 3.
- **5.C1 detector P14 + warning** → Task 4. **5.C2 cámara por tramo P21** → Task 5.
- **Testing (sección 6)** → tests en Tasks 1–5; matcher cubierto por smoke (Task 6 nota).
- **Fuera de alcance (sección 8)** → respetado: no se tocan créditos/QStash/RLS/schema/UI ni compilers de imagen; los detectores avisan, no reescriben.
