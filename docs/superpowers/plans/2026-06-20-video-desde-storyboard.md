# Video desde el Storyboard (B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la generación de video de una campaña, cuando un beat tiene panel de storyboard (`campaign_items.storyboard_image_id`), genere ese clip como **image2video desde el panel** (fotograma inicial exacto), sin encadenar.

**Architecture:** Un modo nuevo en `enqueueBatch` (`lib/campaigns/orchestrator.ts`). Detección por item (`storyboard_image_id` presente). En ese modo: `chainRole` devuelve no-encadenado; el panel se resuelve a su storage path (reusando `resolvePaths`); el insert usa `operation:'image2video'` + `referenceStoragePath` = panel; y el prompt se compila SIN citas `@image` (contexto con `imagePaths` vacíos — el panel es el first_frame). Sin migración. El handler Seedance ya soporta image2video.

**Tech Stack:** Next.js 15, Supabase, TypeScript, zod, Vitest, Seedance (image2video vía `referenceStoragePath` → `first_frame`). Spec: `docs/superpowers/specs/2026-06-20-video-desde-storyboard-design.md`.

## Global Constraints

- **No `any`**; `unknown` + narrowing o tipo explícito.
- **Créditos SIEMPRE vía funciones SQL atómicas** (`reserveCredits`/`failGeneration`) — el flujo existente de `enqueueBatch` ya las usa; no tocar esa parte.
- **Las URLs del proveedor nunca llegan al cliente** — image2video usa `referenceStoragePath` (path interno), el handler lo firma server-side.
- **Modo storyboard-video GANA** sobre location-mode y encadenado (panel ya incorpora producto/personaje/escena).
- **Sin migración** — usa columnas existentes (`storyboard_image_id`).
- **Funciona en ModelArk y Atlas** (image2video con `first_frame`; NO depende de `return_last_frame`).
- **Tests sin APIs reales**; unit puros con Vitest; el smoke (Seedance image2video) lo corre el usuario.
- **pnpm**; commits **sin** `Co-Authored-By`; conventional commits en español.
- Cada commit hace `git add` SOLO de los archivos de su task.

---

### Task 1: Helper `isStoryboardVideoMode` + `ItemRow.storyboard_image_id`

**Files:**
- Modify: `lib/campaigns/sequence-chain.ts`
- Modify: `lib/campaigns/orchestrator.ts` (type `ItemRow`)
- Test: `lib/campaigns/sequence-chain.test.ts`

**Interfaces:**
- Produces: `export function isStoryboardVideoMode(item: { storyboard_image_id: string | null }): boolean`. `ItemRow` gana `storyboard_image_id: string | null`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/campaigns/sequence-chain.test.ts`:

```ts
import { isStoryboardVideoMode } from './sequence-chain';

describe('isStoryboardVideoMode', () => {
  it('true cuando el item tiene storyboard_image_id', () => {
    expect(isStoryboardVideoMode({ storyboard_image_id: 'panel-1' })).toBe(true);
  });
  it('false cuando storyboard_image_id es null', () => {
    expect(isStoryboardVideoMode({ storyboard_image_id: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- sequence-chain`
Expected: FAIL — `isStoryboardVideoMode is not a function`.

- [ ] **Step 3: Implementar el helper**

Agregar al final de `lib/campaigns/sequence-chain.ts`:

```ts
// ¿Este item va en modo storyboard-video? Sí cuando tiene un panel de storyboard:
// su clip se genera image2video desde el panel (fotograma inicial), SIN encadenar.
// Gana sobre el encadenado y el modo-locación.
export function isStoryboardVideoMode(item: { storyboard_image_id: string | null }): boolean {
  return item.storyboard_image_id != null;
}
```

- [ ] **Step 4: Agregar `storyboard_image_id` a `ItemRow`**

En `lib/campaigns/orchestrator.ts`, en el type `ItemRow`, agregar tras `location_id`:

```ts
  // Panel de storyboard (sub-proyecto B): si no es null, el clip se genera
  // image2video desde el panel (fotograma inicial), sin encadenar.
  storyboard_image_id: string | null;
```

- [ ] **Step 5: Correr el test y typecheck**

Run: `pnpm test -- sequence-chain` → PASS.
Run: `pnpm typecheck` → puede fallar en los fixtures de tests que construyen `ItemRow` sin `storyboard_image_id`; agregar `storyboard_image_id: null` a esos fixtures (mismos que ya tienen `location_id: null`).

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/sequence-chain.ts lib/campaigns/sequence-chain.test.ts lib/campaigns/orchestrator.ts lib/campaigns/campaigns.test.ts
git commit -m "feat(video-storyboard): isStoryboardVideoMode + ItemRow.storyboard_image_id"
```

---

### Task 2: `withoutReferences` — prompt sin citas @image/@video/@audio

**Files:**
- Modify: `lib/prompt-director/index.ts`
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `DirectorContext`, `compile` (existentes).
- Produces: `export function withoutReferences(ctx: DirectorContext): DirectorContext` — devuelve el contexto con TODAS las referencias de media vaciadas (producto/personaje/locación/extra imágenes + video de plantilla + audio), conservando las DESCRIPCIONES de texto. Para image2video: el compiler no emite ninguna cita `@image`/`@video`/`@audio`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/prompt-director/prompt-director.test.ts`:

```ts
import { withoutReferences } from './index';

describe('withoutReferences (prompt para image2video)', () => {
  it('el prompt compilado no lleva citas @image y conserva la descripción del producto', () => {
    const ctx = {
      product: { name: 'Canvas', imagePaths: ['ws/prod.png'] },
      characters: [{ name: 'Pedro', description: 'man with a mustache', masterImagePath: 'ws/pedro.png' }],
      location: { name: 'Living', description: 'a bright living room', imagePaths: ['ws/living.png'] },
    };
    const stripped = withoutReferences(ctx);
    const result = compile(
      { modelSlug: 'bytedance/seedance-2.0/image-to-video', scenePrompt: 'the couple smiles' },
      stripped,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.prompt).not.toContain('@image');
    expect(result.compiled.references.filter((r) => r.kind === 'image')).toHaveLength(0);
    // Las descripciones de texto siguen (no las imágenes)
    expect(result.compiled.prompt.toLowerCase()).toContain('canvas');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- prompt-director`
Expected: FAIL — `withoutReferences is not a function`.

- [ ] **Step 3: Implementar `withoutReferences`**

En `lib/prompt-director/index.ts`, agregar (exportado):

```ts
// Devuelve el contexto SIN referencias de media: vacía las imágenes de
// producto/personaje/locación/extra y quita video de plantilla y audio. Conserva
// las DESCRIPCIONES de texto. Lo usa el modo storyboard-video (image2video): el
// panel es el first_frame, así que el compiler NO debe emitir citas @image/@video/
// @audio que apunten a referencias que no se envían.
export function withoutReferences(ctx: DirectorContext): DirectorContext {
  return {
    ...ctx,
    product: ctx.product
      ? { ...ctx.product, imagePaths: [], packagingImagePaths: [] }
      : undefined,
    characters: ctx.characters?.map((c) => ({ ...c, masterImagePath: '', angleImagePaths: [] })),
    location: ctx.location ? { ...ctx.location, imagePaths: [] } : undefined,
    extraImagePaths: [],
    templateVideoPath: undefined,
    audioRefPath: undefined,
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- prompt-director` → PASS. `pnpm typecheck` limpio.

> Nota: el compiler Seedance, con `imagePaths`/`masterImagePath` vacíos, omite las líneas `@image` (su loop hace `if (!character.masterImagePath) continue` y el producto sin `imagePaths` no empuja `@image`), pero sigue agregando `describeProduct`/`describeCharacter` (texto) — justo lo deseado.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/index.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(video-storyboard): withoutReferences (compila prompt sin citas @image para image2video)"
```

---

### Task 3: Wiring en `enqueueBatch` — modo storyboard-video (image2video)

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`enqueueBatch`: chainRole, resolución de paneles, insert)
- Modify: `server-actions/campaigns.ts` (agregar `storyboard_image_id` al `.select(...)` de `campaign_items`)

**Interfaces:**
- Consumes: `isStoryboardVideoMode` (Task 1), `withoutReferences` (Task 2), `resolvePaths` (existente, resuelve media_reference ids → storage_url).

- [ ] **Step 1: Importar `isStoryboardVideoMode` y `withoutReferences`**

En `lib/campaigns/orchestrator.ts`:
- En el import de `./sequence-chain`, agregar `isStoryboardVideoMode`.
- En el import de `@/lib/prompt-director`, agregar `withoutReferences` (y `type DirectorContext` si no está).

- [ ] **Step 2: Resolver los paneles del lote**

En `enqueueBatch`, justo después de `const locations = await resolveLocations(supabase, workspaceId, locationIds);`, agregar:

```ts
  // Paneles de storyboard de los items seleccionados (sub-proyecto B). storyboard_image_id
  // es un media_reference id → resolvePaths da su storage_url (el first_frame del clip).
  const storyboardIds = selected.map((i) => i.storyboard_image_id).filter((s): s is string => !!s);
  const storyboardPanels = await resolvePaths(supabase, workspaceId, storyboardIds);
```

- [ ] **Step 3: Bypass de encadenado en `chainRole`**

En la función interna `chainRole(item)`, agregar como PRIMERA condición (antes del `if (isLocationMode(item))`):

```ts
    // Modo storyboard-video: el clip se genera image2video desde el panel, SIN
    // encadenar. Gana sobre location y encadenado.
    if (isStoryboardVideoMode(item)) {
      return { skip: false, isFirst: false, returnLastFrame: false, orphanResume: false };
    }
```

- [ ] **Step 4: Compilar con contexto stripped en modo storyboard**

En el loop por item, REEMPLAZAR el bloque `const compiled = compile({...}, directorContextFor(...));` por una versión que primero arma el `dirCtx`, resuelve el panel, y aplica `withoutReferences` cuando hay panel:

```ts
    const panelPath = item.storyboard_image_id ? storyboardPanels.get(item.storyboard_image_id) : undefined;
    const storyboardMode = !!panelPath;

    const baseDirCtx = directorContextFor(
      item,
      format,
      ctx,
      item.template_id ? templateVideos.get(item.template_id) : undefined,
      (item.reference_ids ?? []).map((id) => extraPaths.get(id)).filter((p): p is string => !!p),
      (() => {
        const loc = item.location_id ? locations.get(item.location_id) : undefined;
        if (!loc) return undefined;
        return { name: loc.name, description: loc.description ?? undefined, imagePaths: loc.imagePaths };
      })(),
    );
    const dirCtx = storyboardMode ? withoutReferences(baseDirCtx) : baseDirCtx;

    const compiled = compile(
      {
        modelSlug: item.model_slug,
        scenePrompt: item.scene_prompt,
        durationS: item.duration_s ?? undefined,
        aspectRatio: item.aspect_ratio ?? undefined,
        generateAudio: item.audio,
      },
      dirCtx,
    );
```

(Es el mismo `directorContextFor(...)` que ya estaba inline; solo se extrae a `baseDirCtx` y se envuelve con `withoutReferences` cuando `storyboardMode`.)

- [ ] **Step 5: Insert image2video en modo storyboard**

En el `.insert({...})` de la generación, REEMPLAZAR el objeto `params: { ... }` por una rama según `storyboardMode`. El bloque actual `params: { operation: p.operation, ... referenceImagePaths, ... (role.isFirst ? {chain...} : {}) }` queda como la rama `else`; la rama storyboard es:

```ts
        params: storyboardMode
          ? {
              // image2video: el panel del beat es el fotograma inicial (first_frame).
              operation: 'image2video',
              referenceStoragePath: panelPath,
              aspectRatio: p.aspectRatio,
              resolution,
              duration: durationS,
              generateAudio: p.generateAudio,
              ...(p.seed !== undefined ? { seed: p.seed } : {}),
            }
          : {
              operation: p.operation,
              aspectRatio: p.aspectRatio,
              resolution,
              duration: durationS,
              generateAudio: p.generateAudio,
              ...(p.seed !== undefined ? { seed: p.seed } : {}),
              referenceImagePaths: refImages,
              referenceVideoPaths: refVideos,
              referenceAudioPaths: refAudios,
              ...(role.isFirst
                ? {
                    returnLastFrame: role.returnLastFrame,
                    chain: {
                      campaignId: campaign.id,
                      sequenceId: item.sequence_id as string,
                      sceneIndex: item.scene_index ?? 0,
                      productImagePaths: productImages,
                      characterImagePaths: characterMasterPaths,
                      resolution,
                      language: ctx.language,
                    } satisfies ChainParams,
                  }
                : {}),
            },
```

(`panelPath` es `string` dentro de la rama storyboard porque `storyboardMode` lo garantiza; si TS se queja, usa `referenceStoragePath: panelPath as string`.)

- [ ] **Step 6: Agregar `storyboard_image_id` al SELECT de items**

En `server-actions/campaigns.ts`, en la(s) query(s) de `campaign_items` que arman los `ItemRow` para `enqueueBatch` (las que ya seleccionan `location_id, sequence_id, scene_index`), agregar `storyboard_image_id` a las columnas del `.select(...)`.

- [ ] **Step 7: Verificar typecheck y tests**

Run: `pnpm typecheck` → sin errores.
Run: `pnpm test -- campaigns` → verde (los fixtures ya llevan `storyboard_image_id: null` por Task 1).

- [ ] **Step 8: Commit**

```bash
git add lib/campaigns/orchestrator.ts server-actions/campaigns.ts
git commit -m "feat(video-storyboard): enqueueBatch genera image2video desde el panel cuando el beat tiene storyboard"
```

---

### Task 4: Test de integración del modo + verificación final

**Files:**
- Test: `lib/campaigns/campaigns.test.ts` (si el harness ya mockea `enqueueBatch`/`chainRole`)

**Interfaces:**
- Consumes: `isStoryboardVideoMode`, `withoutReferences`, el wiring (Tasks 1-3).

- [ ] **Step 1: Test del modo (si el harness lo permite)**

Si `campaigns.test.ts` ya ejercita `chainRole`/`enqueueBatch` con Supabase mockeado, agregar: un item con `storyboard_image_id` set (y panel resoluble) inserta `operation:'image2video'` + `referenceStoragePath` del panel, SIN `chain`/`returnLastFrame`/`referenceImagePaths`, incluso con `location_id` o `SEEDANCE_PROVIDER=atlas`. Si el test de orquestador NO mockea Supabase (solo helpers puros), la cobertura pura ya está en `isStoryboardVideoMode` (Task 1) y `withoutReferences` (Task 2); deja el camino DB para el smoke del usuario y documéntalo en el commit.

```ts
// Aserto clave (adaptar al harness existente):
// expect(insertedParams.operation).toBe('image2video');
// expect(insertedParams.referenceStoragePath).toBe('<panel storage_url>');
// expect('chain' in insertedParams).toBe(false);
// expect('referenceImagePaths' in insertedParams).toBe(false);
```

- [ ] **Step 2: Suite completa + typecheck**

Run: `pnpm test` → todo verde.
Run: `pnpm typecheck` → limpio.

- [ ] **Step 3: Commit (si se agregó test)**

```bash
git add lib/campaigns/campaigns.test.ts
git commit -m "test(video-storyboard): el beat con panel genera image2video, sin chain"
```

- [ ] **Step 4: Smoke (lo corre el usuario)**

En una campaña con storyboard generado (p.ej. "Familia abrazada cuadro"), correr la generación de video de la campaña. Confirmar que cada clip arranca EXACTAMENTE como su panel diseñado (image2video) y anima la acción del beat, sin degradación heredada.

---

## Self-Review

**Cobertura del spec:** §Detección/precedencia → Task 1 (helper) + Task 3 (chainRole bypass primero). §Mecánica image2video → Task 3 (insert operation + referenceStoragePath). §Prompt sin @image → Task 2 (`withoutReferences`) + Task 3 (aplicado cuando storyboardMode). §Resolución del panel → Task 3 (reusa `resolvePaths`). §Beats sin panel → `storyboardMode` por-item, rama `else` intacta. §Sin migración → ninguna task crea migración. §Testing → Tasks 1,2,4.

**Type consistency:** `isStoryboardVideoMode({ storyboard_image_id })` (Task 1) ↔ `ItemRow.storyboard_image_id: string | null` (Task 1) ↔ `chainRole` bypass (Task 3) ↔ `storyboardPanels = resolvePaths(...)` → `panelPath: string | undefined` (Task 3) ↔ `withoutReferences(ctx): DirectorContext` (Task 2) ↔ insert `operation:'image2video'` + `referenceStoragePath` (Task 3, leído por el handler Seedance `params.referenceStoragePath`).

**Placeholders:** el wiring (Task 3) da el código concreto a insertar/reemplazar contra el código existente citado; los helpers puros (Tasks 1,2) van completos. Task 4 es condicional al harness de mock existente (documentado), con la cobertura pura ya garantizada por Tasks 1-2.
