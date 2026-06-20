# Cast en el video — fallback reference2video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En el modo storyboard, los beats CON cast generan por `reference2video` (panel + cast como reference_image) en vez de `image2video`+refs (que Atlas rechaza), manteniendo `image2video` solo-panel para beats SIN cast.

**Architecture:** Un helper puro `buildCastR2VRefs` arma `[...cast, panel]` + la cita del panel (`@image{N+1}`). El orquestador ramifica el insert en 3 vías (R2V con cast / I2V sin cast / else normal). Se revierte el cambio del provider que hacía a `image2video` emitir reference images (ahora sin uso y rechazado por Atlas). Sin migración.

**Tech Stack:** TypeScript, Vitest, Seedance (Atlas/ModelArk). Spec: `docs/superpowers/specs/2026-06-20-cast-r2v-fallback-design.md`.

## Global Constraints

- **No `any`**; `unknown` + narrowing o tipo explícito.
- **Atlas no permite first_frame + reference media.** Beat CON cast → `reference2video` (cast `@image1..N` + panel `@image{N+1}` como `reference_image`, sin first_frame). Beat SIN cast → `image2video` (panel como first_frame). El slug DEBE coincidir con la operación: R2V → `item.model_slug` (ya es reference-to-video); I2V → `toImage2VideoSlug(item.model_slug)`.
- El panel va como ÚLTIMO `@image` (no rompe la numeración que el compiler genera para el cast). Tope ≤9 refs.
- **Sin migración, sin toggle.** No tocar créditos ni el handler. `reference2video` ya está soportado por el provider/handler.
- `lib/campaigns/storyboard-video.ts` es puro (no `server-only`).
- pnpm. Commits en español, conventional, **sin** `Co-Authored-By`. `git add` solo los archivos de cada task (no `git add -A`).

---

### Task 1: Helper `buildCastR2VRefs`

**Files:**
- Create: `lib/campaigns/storyboard-video.ts`
- Test: `lib/campaigns/storyboard-video.test.ts`

**Interfaces:**
- Produces: `buildCastR2VRefs(castRefs: string[], panelPath: string): { referenceImagePaths: string[]; panelCitation: string }`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `lib/campaigns/storyboard-video.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCastR2VRefs } from './storyboard-video';

describe('buildCastR2VRefs', () => {
  it('pone el panel al final y lo cita como @image{N+1}', () => {
    const { referenceImagePaths, panelCitation } = buildCastR2VRefs(['cast-a.png', 'cast-b.png'], 'panel.png');
    expect(referenceImagePaths).toEqual(['cast-a.png', 'cast-b.png', 'panel.png']);
    expect(panelCitation).toContain('@image3');
  });
  it('con un solo cast, el panel es @image2', () => {
    const { referenceImagePaths, panelCitation } = buildCastR2VRefs(['cast-a.png'], 'panel.png');
    expect(referenceImagePaths).toEqual(['cast-a.png', 'panel.png']);
    expect(panelCitation).toContain('@image2');
  });
  it('sin cast, el panel es @image1', () => {
    const { referenceImagePaths, panelCitation } = buildCastR2VRefs([], 'panel.png');
    expect(referenceImagePaths).toEqual(['panel.png']);
    expect(panelCitation).toContain('@image1');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test -- storyboard-video`
Expected: FAIL — `Cannot find module './storyboard-video'`.

- [ ] **Step 3: Implementar `lib/campaigns/storyboard-video.ts`**

```ts
// Caso storyboard CON cast: Atlas no deja mezclar first_frame + referencias, así que
// el clip va por reference2video. El cast va primero (citado @image1..N por el compiler)
// y el panel al FINAL (@image{N+1}) — para no romper la numeración del cast. El número
// es interno; el orden no implica prioridad (doc Seedance). Helper puro.
export function buildCastR2VRefs(
  castRefs: string[],
  panelPath: string,
): { referenceImagePaths: string[]; panelCitation: string } {
  const referenceImagePaths = [...castRefs, panelPath];
  const n = castRefs.length + 1;
  const panelCitation = ` @image${n} is the exact opening frame and overall composition of this shot — reproduce it as the starting look (same framing, colors and layout).`;
  return { referenceImagePaths, panelCitation };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test -- storyboard-video` → PASS. `pnpm typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/storyboard-video.ts lib/campaigns/storyboard-video.test.ts
git commit -m "feat(cast-r2v): buildCastR2VRefs (panel al final, citado @image{N+1})"
```

---

### Task 2: Orquestador — 3 vías (R2V con cast / I2V sin cast / else)

**Files:**
- Modify: `lib/campaigns/orchestrator.ts`

**Interfaces:**
- Consumes: `buildCastR2VRefs` (Task 1), `onlyCharacterRefs`/`toImage2VideoSlug` (existentes).

- [ ] **Step 1: Importar `buildCastR2VRefs`**

En `lib/campaigns/orchestrator.ts`, agregar:

```ts
import { buildCastR2VRefs } from '@/lib/campaigns/storyboard-video';
```

- [ ] **Step 2: Reordenar el bloque y agregar `useR2V` + refs/cita R2V**

REEMPLAZAR este bloque actual (≈773-782):

```ts
    // En modo storyboard el clip es image2video → el slug debe ser el endpoint
    // image-to-video (mismo tier; mismo precio que reference-to-video).
    const effectiveModelSlug = storyboardMode ? toImage2VideoSlug(item.model_slug) : item.model_slug;
    const cost = seedanceCostPerItem(pricing, effectiveModelSlug, resolution, durationS);

    const refImages = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
    // Modo storyboard: las únicas refs de imagen compiladas son los personajes
    // (onlyCharacterRefs quita producto/locación). Van como reference_image, en el
    // MISMO orden en que el prompt las cita (@image1..N), junto al panel (first_frame).
    const storyboardCastRefs = storyboardMode ? refImages : [];
```

por:

```ts
    const refImages = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
    // Modo storyboard: las únicas refs de imagen compiladas son los personajes
    // (onlyCharacterRefs quita producto/locación), en el orden en que el prompt las cita.
    const storyboardCastRefs = storyboardMode ? refImages : [];
    // Atlas no deja mezclar first_frame + referencias: beat CON cast → reference2video
    // (panel + cast como reference_image); beat SIN cast → image2video (panel exacto).
    const useR2V = storyboardMode && storyboardCastRefs.length > 0;
    // El slug debe coincidir con la operación: R2V → reference-to-video (el slug del item
    // ya lo es); I2V solo-panel → image-to-video.
    const effectiveModelSlug = storyboardMode
      ? useR2V
        ? item.model_slug
        : toImage2VideoSlug(item.model_slug)
      : item.model_slug;
    const cost = seedanceCostPerItem(pricing, effectiveModelSlug, resolution, durationS);
    // Caso cast: panel al final (@image{N+1}) + su cita; vacío en los demás casos.
    const { referenceImagePaths: castR2VRefs, panelCitation } = useR2V
      ? buildCastR2VRefs(storyboardCastRefs, panelPath as string)
      : { referenceImagePaths: [] as string[], panelCitation: '' };
    const storyboardPrompt = compiled.compiled.prompt + panelCitation;
```

- [ ] **Step 3: Usar `storyboardPrompt` y ramificar `params` a 3 vías**

En el `.insert({ ... })`:

(a) cambiar `prompt: compiled.compiled.prompt,` por `prompt: storyboardPrompt,`.

(b) REEMPLAZAR la rama `params: storyboardMode ? { ...image2video... } : {` por la rama de 3 vías. El objeto image2video actual es:

```ts
        params: storyboardMode
          ? {
              // image2video: el panel del beat es el fotograma inicial (first_frame).
              operation: 'image2video',
              referenceStoragePath: panelPath as string,
              // El cast del beat va como reference_image (@image1..N) para re-anclar
              // la identidad durante la acción. Vacío si el beat no tiene personaje.
              referenceImagePaths: storyboardCastRefs,
              aspectRatio: p.aspectRatio,
              resolution,
              duration: durationS,
              generateAudio: p.generateAudio,
              ...(p.seed !== undefined ? { seed: p.seed } : {}),
            }
          : {
```

cámbialo por (la rama `else` que sigue después NO se toca):

```ts
        params: useR2V
          ? {
              // Beat con cast: reference2video (Atlas no deja first_frame + refs).
              // cast (@image1..N) + panel (@image{N+1}) como reference_image.
              operation: 'reference2video',
              referenceImagePaths: castR2VRefs,
              aspectRatio: p.aspectRatio,
              resolution,
              duration: durationS,
              generateAudio: p.generateAudio,
              ...(p.seed !== undefined ? { seed: p.seed } : {}),
            }
          : storyboardMode
            ? {
                // Beat sin cast: image2video con el panel como fotograma inicial.
                operation: 'image2video',
                referenceStoragePath: panelPath as string,
                aspectRatio: p.aspectRatio,
                resolution,
                duration: durationS,
                generateAudio: p.generateAudio,
                ...(p.seed !== undefined ? { seed: p.seed } : {}),
              }
            : {
```

(El cierre de la rama `else` y su contenido de encadenado quedan igual.)

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm typecheck` → limpio.
Run: `pnpm test` → verde.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/orchestrator.ts
git commit -m "feat(cast-r2v): el modo storyboard usa reference2video cuando el beat tiene cast (panel + cast)"
```

---

### Task 3: Provider — revertir image2video + reference images

**Files:**
- Modify: `lib/providers/seedance.ts`

**Interfaces:**
- Nadie manda ya `image2video` + `imageUrls` (Task 2 manda el cast por reference2video). Esta rama queda muerta y es lo que Atlas rechaza → se revierte.

- [ ] **Step 1: ModelArk — quitar el push de reference_image en image2video**

En `submitModelArk`, dentro de `if (params.operation === 'image2video') { ... }`, ELIMINAR el bloque:

```ts
    for (const url of params.imageUrls ?? []) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
    }
```

(Queda: first_frame + [last_frame], como antes del feature.)

- [ ] **Step 2: Atlas — quitar reference_images en image2video**

En `submitAtlas`, dentro de `if (params.operation === 'image2video') { ... }`, ELIMINAR la línea:

```ts
    if (params.imageUrls?.length) body.reference_images = params.imageUrls;
```

- [ ] **Step 3: Revertir el límite a solo reference2video**

En `validateSubmit`, cambiar:

```ts
  if (params.operation === 'reference2video' || params.operation === 'image2video') {
    assertReferenceLimits(params);
  }
```

por:

```ts
  if (params.operation === 'reference2video') assertReferenceLimits(params);
```

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm typecheck` → limpio.
Run: `pnpm test` → verde.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/seedance.ts
git commit -m "revert(cast-r2v): image2video vuelve a solo first_frame (Atlas rechaza first_frame+refs; ahora sin uso)"
```

- [ ] **Step 6: Smoke (lo corre el usuario)**

Regenerar el clip que falló ("La foto que nunca le había impreso", escena 2). Con cast, ahora debe GENERAR (reference2video) y mantener al personaje durante la acción. Confirmar también que un beat SIN cast sigue generando bien (image2video panel-only).

---

## Self-Review

**Cobertura del spec:**
- 3 vías (R2V con cast / I2V sin cast / else) → Task 2.
- `buildCastR2VRefs` (panel `@image{N+1}`) → Task 1.
- Slug por operación (R2V `item.model_slug`; I2V `toImage2VideoSlug`) → Task 2 step 2.
- Revertir provider image2video+refs + límite → Task 3.
- Conservar `onlyCharacterRefs`/`storyboardCastRefs` → respetado (Task 2 los reusa, no los quita).
- Sin migración, sin toggle, handler intacto → respetado.
- Testing: `buildCastR2VRefs` puro (Task 1); orquestador/provider por typecheck + smoke.

**Placeholder scan:** sin placeholders; el código va completo contra el código real citado (orchestrator ≈773-821; provider submitModelArk/submitAtlas/validateSubmit).

**Type consistency:** `buildCastR2VRefs(castRefs: string[], panelPath: string): { referenceImagePaths: string[]; panelCitation: string }` (Task 1) == uso en Task 2 (`{ referenceImagePaths: castR2VRefs, panelCitation }`). `useR2V: boolean` gobierna slug, prompt y params de forma consistente. `castR2VRefs: string[]` → `referenceImagePaths` (reference2video, `string[]` en `SeedanceParams`). `storyboardPrompt = compiled.prompt + panelCitation` ('' salvo useR2V).
