# P16 — Música en modo storyboard (beats con cast) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los beats de storyboard donde el cast actúa (reference2video) reciban la pista musical de la campaña como `reference_audios` para sincronía de beat.

**Architecture:** El helper puro `buildCastR2VRefs` gana soporte de audio (devuelve `referenceAudioPaths` + cita `@audio1`); el orchestrator lo cablea en la rama R2V tomando `audioRefPath` del contexto base (antes de `onlyCharacterRefs`, que lo quita). El provider y el handler ya soportan `reference_audios` en `reference2video` — sin cambio. Los beats `image2video` (sin cast) quedan sin música (limitación de Atlas).

**Tech Stack:** TypeScript, Vitest, pnpm.

## Global Constraints

- **pnpm**: `pnpm typecheck`, `pnpm vitest run <archivo>`.
- **No `any`** (tipos explícitos), **no emojis**.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): el helper es puro y se unit-testea; el wiring del orchestrator y que Atlas acepte `reference2video + reference_audios` los valida el smoke del usuario.
- **Alcance R2V:** la música solo entra a los beats con cast (reference2video). Los `image2video` NO se tocan (sin música; limitación Atlas).
- **Cita de audio = constante compartida** `AUDIO_BEAT_SYNC_CITATION` (exportada de `lib/prompt-director/compilers/seedance.ts`, fuente única): `@audio1 sets the background audio mood and rhythm; sync scene energy to its beats.` El compiler normal la usa como línea propia; el storyboard la concatena con espacio inicial en `extraCitation`. (Antes era una copia verbatim duplicada; extraída a constante tras code-review para evitar dos fuentes de verdad.)
- **`onlyCharacterRefs`, provider, handler, rama I2V y rama normal: SIN CAMBIO.**
- **Sin migración, sin schema.**
- **Commits sin trailer `Co-Authored-By`.**

---

### Task 1: `buildCastR2VRefs` soporta audio de referencia

**Files:**
- Modify: `lib/campaigns/storyboard-video.ts:34-55` (firma + retorno)
- Test: `lib/campaigns/storyboard-video.test.ts` (casos con/sin `audioRef`)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `buildCastR2VRefs(castRefs: string[], productRefs: string[], panelPath: string, audioRef?: string): { referenceImagePaths: string[]; referenceAudioPaths: string[]; extraCitation: string }`. El nuevo campo `referenceAudioPaths` y el 4º parámetro `audioRef` los consume Task 2.

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/campaigns/storyboard-video.test.ts`, dentro del `describe('buildCastR2VRefs', ...)`, añade:

```ts
  it('con audioRef: referenceAudioPaths = [audioRef] y cita @audio1', () => {
    const { referenceAudioPaths, extraCitation } = buildCastR2VRefs(
      ['cast-a.png'],
      ['prod.png'],
      'panel.png',
      'music.mp3',
    );
    expect(referenceAudioPaths).toEqual(['music.mp3']);
    expect(extraCitation).toContain('@audio1');
    expect(extraCitation).toContain('sync scene energy to its beats');
  });

  it('sin audioRef: referenceAudioPaths vacío y sin cita @audio1', () => {
    const { referenceAudioPaths, extraCitation } = buildCastR2VRefs(['cast-a.png'], [], 'panel.png');
    expect(referenceAudioPaths).toEqual([]);
    expect(extraCitation).not.toContain('@audio1');
  });
```

> Los tests existentes destructuran `{ referenceImagePaths, extraCitation }` y llaman con 3 args — siguen compilando y pasando (el 4º param es opcional y el campo nuevo se ignora). NO los modifiques.

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/campaigns/storyboard-video.test.ts`
Expected: FAIL — `referenceAudioPaths` es `undefined` (no existe en el retorno).

- [ ] **Step 3: Implementar el soporte de audio**

En `lib/campaigns/storyboard-video.ts`, cambia la firma y el cuerpo de `buildCastR2VRefs` (de `:34`). La firma gana `audioRef?: string` y el retorno gana `referenceAudioPaths`:

```ts
export function buildCastR2VRefs(
  castRefs: string[],
  productRefs: string[],
  panelPath: string,
  audioRef?: string,
): { referenceImagePaths: string[]; referenceAudioPaths: string[]; extraCitation: string } {
  const referenceImagePaths = [...castRefs, ...productRefs, panelPath];
  let n = castRefs.length;
  let extraCitation = '';
  if (productRefs.length > 0) {
    const nums = productRefs.map((_, i) => `@image${n + 1 + i}`);
    const verb = productRefs.length > 1 ? 'are' : 'is';
    extraCitation += ` ${nums.join(' and ')} ${verb} the product reference — whenever the product is visible, reproduce its printed image, design and colors exactly; do not restyle or change what is printed on it. Follow the shot's framing for whether the product faces the camera or is turned away, and do not reveal the print to camera unless the shot itself shows it.`;
    n += productRefs.length;
  }
  const panelNum = n + 1;
  extraCitation += ` @image${panelNum} is the exact opening frame and overall composition of this shot — reproduce it as the starting look (same framing, colors and layout).`;
  // P16 storyboard: música de referencia (beat-sync) solo en R2V. @audio1 usa su
  // propio contador, separado de @image1..N, igual que el compiler normal.
  const referenceAudioPaths = audioRef ? [audioRef] : [];
  if (audioRef) {
    extraCitation += ' @audio1 sets the background audio mood and rhythm; sync scene energy to its beats.';
  }
  return { referenceImagePaths, referenceAudioPaths, extraCitation };
}
```

> El bloque de producto y la cita del panel quedan IDÉNTICOS a hoy; lo único nuevo es `audioRef?`, `referenceAudioPaths` y la cita condicional de `@audio1`.

- [ ] **Step 4: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/campaigns/storyboard-video.test.ts` y `pnpm typecheck`
Expected: PASS los 2 nuevos + los 3 existentes de `buildCastR2VRefs` + los de `beatNamesCast`/`STORYBOARD_EDIT_HANDLES`. **`pnpm typecheck` LIMPIO:** el cambio es retrocompatible — el 4º param es opcional (el call site del orchestrator con 3 args sigue válido) y el campo `referenceAudioPaths` extra en el retorno no rompe el destructure existente del orchestrator (`{ referenceImagePaths, extraCitation }` toma un subconjunto). El orchestrator aún no USA el audio (eso es Task 2), pero compila.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/storyboard-video.ts lib/campaigns/storyboard-video.test.ts
git commit -m "feat(storyboard): buildCastR2VRefs soporta audio de referencia (P16)"
```

---

### Task 2: Orchestrator cablea la música en la rama R2V

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (rama R2V: ~`:878` tomar el audio, ~`:879-881` el call/destructure, ~`:911-922` los params)

**Interfaces:**
- Consumes: `buildCastR2VRefs(..., audioRef?)` con retorno `{ referenceImagePaths, referenceAudioPaths, extraCitation }` (Task 1).
- Produces: nada (wiring; validado por smoke).

> Sin unit test (es integración del orchestrator; el helper ya está cubierto). Gate: `pnpm typecheck` limpio + sin regresión en los tests del orchestrator/storyboard.

- [ ] **Step 1: Tomar el audio del contexto base (antes de onlyCharacterRefs)**

En `lib/campaigns/orchestrator.ts`, junto a `storyboardProductRefs` (la línea `const storyboardProductRefs = useR2V ? (baseDirCtx.product?.imagePaths ?? []).slice(0, 2) : [];`, ~`:878`), añade DEBAJO:

```ts
    // P16: la música (audioRefPath) no está en el panel; se toma del contexto
    // base ANTES de onlyCharacterRefs (que lo quitó del dirCtx del compile) y se
    // re-ancla solo en beats R2V (reference2video la soporta; image2video no).
    const storyboardAudioRef = useR2V ? baseDirCtx.audioRefPath : undefined;
```

- [ ] **Step 2: Pasar el audio a buildCastR2VRefs y destructurar el nuevo campo**

Cambia el call/destructure (`:879-881`) de:

```ts
    const { referenceImagePaths: castR2VRefs, extraCitation } = useR2V
      ? buildCastR2VRefs(storyboardCastRefs, storyboardProductRefs, panelPath as string)
      : { referenceImagePaths: [] as string[], extraCitation: '' };
```

por:

```ts
    const { referenceImagePaths: castR2VRefs, referenceAudioPaths: castR2VAudios, extraCitation } = useR2V
      ? buildCastR2VRefs(storyboardCastRefs, storyboardProductRefs, panelPath as string, storyboardAudioRef)
      : { referenceImagePaths: [] as string[], referenceAudioPaths: [] as string[], extraCitation: '' };
```

- [ ] **Step 3: Añadir referenceAudioPaths a los params del branch useR2V**

En el objeto `params` del branch `useR2V` (`:911-922`), junto a `referenceImagePaths: castR2VRefs,`, añade:

```ts
              referenceAudioPaths: castR2VAudios,
```

> NO toques la rama `image2video` ni la rama normal. La rama I2V sigue sin audio (limitación Atlas). El handler (`lib/jobs/handlers/seedance.ts:68`) ya firma `params.referenceAudioPaths`; el provider `reference2video` ya manda `reference_audios` — sin cambio.

- [ ] **Step 4: typecheck + tests**

Run: `pnpm typecheck` y `pnpm vitest run lib/campaigns/storyboard-video.test.ts`
Expected: typecheck LIMPIO (el call site ya casa con el nuevo retorno); tests verdes. Si hay otros tests del orchestrator/storyboard, córrelos: `pnpm vitest run lib/campaigns/` — sin regresión.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/orchestrator.ts
git commit -m "feat(storyboard): la musica entra a los beats R2V del storyboard (P16)"
```

---

## Verificación final (tras las 2 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm vitest run lib/campaigns/` — verde (storyboard-video + orchestrator, sin regresión).
- [ ] Smoke del usuario: campaña en modo storyboard con música configurada y un beat donde el cast actúa → confirmar que el clip R2V de ese beat recibe la pista (`reference_audios`) y sincroniza; un beat I2V (sin cast) se genera sin error y sin música.

## Notas para el implementador

- La cita `@audio1` se reusa de la constante compartida `AUDIO_BEAT_SYNC_CITATION` (exportada de `lib/prompt-director/compilers/seedance.ts`), con espacio inicial al concatenar como el resto de piezas de `extraCitation`.
- `onlyCharacterRefs` NO se toca: los beats I2V no deben citar `@audio` (no llevan la pista); por eso el audio se inyecta solo en la rama R2V desde `baseDirCtx`.
- Provider/handler SIN cambio: `reference2video` ya soporta `reference_audios`; el handler firma `referenceAudioPaths` para cualquier operación.
- Beats I2V sin música = limitación de Atlas (no mezcla first_frame + referencias), fuera de alcance.
