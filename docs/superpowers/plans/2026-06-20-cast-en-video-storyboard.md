# Cast como referencia en el video del Storyboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En el modo storyboard-video, mandar la hoja maestra del cast del beat como `reference_image` (citada `@image1`) junto al panel (first_frame) para que Seedance mantenga la identidad del personaje durante toda la acción.

**Architecture:** Un transform puro `onlyCharacterRefs` (como `withoutReferences` pero conserva los personajes) arma un prompt que cita al cast; el orquestador pasa esas imágenes como `referenceImagePaths` además del panel como `referenceStoragePath`; el provider Seedance emite las reference images también en la operación `image2video`. El handler ya firma+pasa ambos (sin cambios). Sin migración.

**Tech Stack:** Next.js 15, TypeScript, Vitest, Seedance (ModelArk/Atlas). Spec: `docs/superpowers/specs/2026-06-20-cast-en-video-storyboard-design.md`.

## Global Constraints

- **No `any`**; `unknown` + narrowing o tipo explícito.
- `image2video` mantiene el **panel como first_frame** (`referenceStoragePath`); el **cast** va como `reference_image` (`referenceImagePaths`), citado `@image1..N` en el prompt (orden = numeración). Producto/locación NO se re-mandan (están en el panel).
- El `first_frame` NO cuenta en la numeración `@image`; el 1er `reference_image` es `@image1` (doc Seedance).
- Tope **≤9 imágenes** de referencia (aplica también a image2video).
- **Handler sin cambios** (ya firma `referenceStoragePath`→imageUrl + `referenceImagePaths`→imageUrls).
- **Sin toggle**: es el comportamiento del modo storyboard. El **smoke de 1 clip** valida si Atlas honra el cast; si no, fallback `reference2video` (cambio aparte, fuera de este plan).
- El provider hace HTTP → NO se testea con API real (regla del repo); se cubre con `pnpm typecheck` + smoke. El transform puro SÍ se testea.
- pnpm. Commits en español, conventional, **sin** `Co-Authored-By`. `git add` solo los archivos de cada task (no `git add -A`).

---

### Task 1: `onlyCharacterRefs` (transform puro)

**Files:**
- Modify: `lib/prompt-director/index.ts` (agregar la función; NO quitar `withoutReferences` todavía)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `DirectorContext`, `compile`, `fromFormatRow` (existentes).
- Produces: `export function onlyCharacterRefs(ctx: DirectorContext): DirectorContext` — como `withoutReferences` pero conserva `ctx.characters`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `lib/prompt-director/prompt-director.test.ts` (junto al bloque de `withoutReferences`):

```ts
describe('onlyCharacterRefs (prompt para image2video con cast)', () => {
  it('conserva el personaje (@image) y quita producto/locación; no bloquea por requiredRefs', () => {
    const format = fromFormatRow({
      slug: 'voz-cercana',
      name: 'Voz cercana',
      register: null,
      camera_style: null,
      pacing: null,
      required_refs: ['product'],
      default_duration_s: 8,
      default_audio: true,
    });
    const ctx: DirectorContext = {
      format,
      product: { name: 'Canvas', imagePaths: ['ws/prod.png'] },
      location: { name: 'Living', description: 'a bright living room', imagePaths: ['ws/living.png'] },
      characters: [{ name: 'Marcela', description: 'young woman, long brown hair', masterImagePath: 'ws/marcela.png' }],
    };
    const result = compile(
      { modelSlug: 'bytedance/seedance-2.0/image-to-video', scenePrompt: 'Marcela mira a cámara' },
      onlyCharacterRefs(ctx),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paths = result.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
    expect(paths).toContain('ws/marcela.png');
    expect(paths).not.toContain('ws/prod.png');
    expect(paths).not.toContain('ws/living.png');
    expect(result.compiled.prompt).toContain('@image'); // cita al personaje
  });

  it('sin personaje → sin referencias de imagen ni @image', () => {
    const result = compile(
      { modelSlug: 'bytedance/seedance-2.0/image-to-video', scenePrompt: 'producto sobre la mesa' },
      onlyCharacterRefs({ product: { name: 'Canvas', imagePaths: ['ws/prod.png'] } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.references.filter((r) => r.kind === 'image')).toHaveLength(0);
    expect(result.compiled.prompt).not.toContain('@image');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test -- prompt-director`
Expected: FAIL — `onlyCharacterRefs is not a function`.

- [ ] **Step 3: Implementar `onlyCharacterRefs`**

En `lib/prompt-director/index.ts`, agregar (junto a `withoutReferences`, que de momento se queda):

```ts
// Como withoutReferences pero CONSERVA los personajes. Para el video del storyboard
// (image2video) queremos mandar la hoja maestra del cast como reference_image y
// citarla (@image1) para re-anclar la identidad durante la acción; producto/locación
// ya están en el panel (first_frame), así que se quitan. Limpia requiredRefs para que
// el validador no bloquee por las imágenes de producto que ya no van.
export function onlyCharacterRefs(ctx: DirectorContext): DirectorContext {
  return {
    ...ctx,
    format: ctx.format ? { ...ctx.format, requiredRefs: [] } : undefined,
    product: ctx.product ? { ...ctx.product, imagePaths: [], packagingImagePaths: [] } : undefined,
    location: ctx.location ? { ...ctx.location, imagePaths: [] } : undefined,
    extraImagePaths: [],
    templateVideoPath: undefined,
    audioRefPath: undefined,
    // ctx.characters se conserva tal cual
  };
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test -- prompt-director` → PASS. `pnpm typecheck` limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/index.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(cast-video): onlyCharacterRefs (conserva el cast, quita producto/locación, limpia requiredRefs)"
```

---

### Task 2: Provider — `image2video` emite reference images

**Files:**
- Modify: `lib/providers/seedance.ts`

**Interfaces:**
- `SeedanceSubmitParams` ya tiene `imageUrls?: string[]` (usado hoy solo por reference2video). Esta task hace que image2video también las emita.

- [ ] **Step 1: ModelArk — agregar reference_image en image2video**

En `submitModelArk`, dentro del `if (params.operation === 'image2video') { ... }`, después de la línea del `last_frame`, agregar:

```ts
    for (const url of params.imageUrls ?? []) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
    }
```

(Queda: text → first_frame → [last_frame] → reference_image(s).)

- [ ] **Step 2: Atlas — agregar reference_images en image2video**

En `submitAtlas`, dentro del `if (params.operation === 'image2video') { ... }`, después de `if (params.endImageUrl) body.last_image = params.endImageUrl;`, agregar:

```ts
    if (params.imageUrls?.length) body.reference_images = params.imageUrls;
```

- [ ] **Step 3: Validar el tope también en image2video**

En `validateSubmit`, cambiar:

```ts
  if (params.operation === 'reference2video') assertReferenceLimits(params);
```

por:

```ts
  if (params.operation === 'reference2video' || params.operation === 'image2video') {
    assertReferenceLimits(params);
  }
```

- [ ] **Step 4: Typecheck + suite**

Run: `pnpm typecheck` → limpio.
Run: `pnpm test` → verde (el provider no tiene tests con API real; el cambio es aditivo y no afecta el flujo existente — image2video sin `imageUrls` se comporta igual que antes).

- [ ] **Step 5: Commit**

```bash
git add lib/providers/seedance.ts
git commit -m "feat(cast-video): seedance image2video también emite reference images (ModelArk + Atlas)"
```

---

### Task 3: Orquestador — pasar el cast en el modo storyboard

**Files:**
- Modify: `lib/campaigns/orchestrator.ts`
- Modify: `lib/prompt-director/index.ts` (quitar `withoutReferences`, ya muerto)
- Test: `lib/prompt-director/prompt-director.test.ts` (quitar el bloque de tests de `withoutReferences`)

**Interfaces:**
- Consumes: `onlyCharacterRefs` (Task 1), provider que emite refs en I2V (Task 2).

- [ ] **Step 1: Cambiar el contexto del modo storyboard a `onlyCharacterRefs`**

En `lib/campaigns/orchestrator.ts`:
- En el import desde `@/lib/prompt-director`, reemplazar `withoutReferences` por `onlyCharacterRefs`.
- Cambiar la línea (≈748):

```ts
    const dirCtx = storyboardMode ? withoutReferences(baseDirCtx) : baseDirCtx;
```

por:

```ts
    const dirCtx = storyboardMode ? onlyCharacterRefs(baseDirCtx) : baseDirCtx;
```

- [ ] **Step 2: Calcular las referencias del cast (orden = numeración @image)**

En el loop, después de `const refImages = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);` (≈778), agregar:

```ts
    // Modo storyboard: las únicas refs de imagen compiladas son los personajes
    // (onlyCharacterRefs quita producto/locación). Van como reference_image, en el
    // MISMO orden en que el prompt las cita (@image1..N), junto al panel (first_frame).
    const storyboardCastRefs = storyboardMode ? refImages : [];
```

- [ ] **Step 3: Agregar `referenceImagePaths` al insert del modo storyboard**

En el objeto `params: storyboardMode ? { ... }` del `.insert(...)` (≈804-814), agregar `referenceImagePaths: storyboardCastRefs` tras `referenceStoragePath`:

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

(No tocar la rama `else`.)

- [ ] **Step 4: Quitar `withoutReferences` (ya muerto)**

- En `lib/prompt-director/index.ts`, eliminar la función `withoutReferences` completa (su único consumidor era el orquestador, ya cambiado a `onlyCharacterRefs`).
- En `lib/prompt-director/prompt-director.test.ts`, eliminar el `describe('withoutReferences (prompt para image2video)', ...)` completo (incluido el test de `$`... NO: ese es de speech-fit, NO tocarlo; aquí solo el describe de `withoutReferences` en prompt-director.test.ts). Si algún caso de ese bloque (requiredRefs limpio, sin citas de producto) NO está cubierto por los tests de `onlyCharacterRefs` de Task 1, NO lo pierdas: el test de Task 1 ya cubre requiredRefs-limpio + sin-producto/locación, así que el bloque de `withoutReferences` es redundante y se puede eliminar.

- [ ] **Step 5: Typecheck + suite**

Run: `pnpm typecheck` → limpio (no debe quedar ninguna referencia a `withoutReferences`).
Run: `pnpm test` → verde.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/prompt-director/index.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(cast-video): el modo storyboard manda el cast como reference_image junto al panel"
```

- [ ] **Step 7: Smoke (lo corre el usuario)**

Generar 1 clip de un beat con personaje. Confirmar que el rostro se mantiene consistente durante la acción (vs el panel-only de antes). Si Atlas ignora el cast (sin mejora) o tira error → reportar: se hará el fallback `reference2video` (panel @image1 + cast @image2), spec aparte.

---

## Self-Review

**Cobertura del spec:**
- `onlyCharacterRefs` (conserva cast, quita producto/locación, limpia requiredRefs) → Task 1.
- Provider emite reference images en image2video (ModelArk + Atlas) + tope ≤9 → Task 2.
- Orquestador: `onlyCharacterRefs` + `referenceImagePaths`=cast en el insert storyboard → Task 3.
- Eliminar `withoutReferences` (reemplazado) → Task 3 step 4.
- Handler sin cambios → respetado (no aparece en ninguna task).
- Sin migración, sin toggle, smoke como compuerta → respetado.
- Testing: `onlyCharacterRefs` puro (Task 1); provider/orquestador por typecheck + smoke.

**Placeholder scan:** sin placeholders; todo el código va completo contra el código real citado (orchestrator ≈748/778/804; provider submitModelArk/submitAtlas/validateSubmit).

**Type consistency:** `onlyCharacterRefs(ctx: DirectorContext): DirectorContext` (Task 1) == uso en orquestador (Task 3). `storyboardCastRefs: string[]` deriva de `refImages` (ya `string[]`). `referenceImagePaths` es `string[]` en `SeedanceParams`/provider (coincide con el handler que hace `signAll`). `imageUrls` ya existe en `SeedanceSubmitParams` (Task 2 solo lo emite en otra rama).
