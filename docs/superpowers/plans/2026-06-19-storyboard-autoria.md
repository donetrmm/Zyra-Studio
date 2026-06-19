# Storyboard — Autoría (Sub-proyecto A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una campaña tenga un storyboard — un panel-imagen por beat, generado por FLUX (síncrono) y refinable por instrucciones (Nano Banana, síncrono), guardado ligado al beat y mostrado en un grid.

**Architecture:** Dos columnas aditivas en `campaign_items` (`storyboard_image_id` → media_reference vigente; `storyboard_generation_id` → última generación). La lógica de compilación del panel vive pura en `lib/campaigns/storyboard.ts`; las acciones `generatePanelAction`/`refinePanelAction` (`server-actions/storyboard.ts`) son SÍNCRONAS — espejan el patrón de `submitGenerationAction` (insert generations → reserveCredits → llamar proveedor sync → uploadOutput → completeGeneration), y además promueven el output a una `media_reference` y setean las columnas del beat. La UI itera por beat. Sin QStash, sin cambios al worker.

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + RLS), TypeScript, zod, Vitest. Proveedores síncronos: FLUX (`lib/providers/flux.ts` `generate`), Nano Banana (`lib/providers/nano-banana.ts` `generate`). Spec: `docs/superpowers/specs/2026-06-19-storyboard-autoria-design.md`.

## Global Constraints

- **No `any`**; `unknown` + narrowing o tipo explícito.
- **No emojis**; dark mode; shadcn primero; Server Components por default, `'use client'` solo con state/effects.
- **Mutaciones vía Server Actions** con validación zod + ownership por workspace.
- **Imágenes son SÍNCRONAS** (no QStash). Solo lo que tarda >60s pasa por QStash — los paneles no.
- **Créditos SIEMPRE vía funciones SQL atómicas** (`reserve_credits`/`confirm_credits`/`refund_credits` mediante `reserveCredits`/`completeGeneration`/`failGeneration`). Nunca UPDATE directo a `credit_balances`/`credit_transactions`.
- **Las URLs del proveedor NUNCA llegan al cliente** — el output se guarda en Storage interno.
- **Nunca modificar una migración aplicada**; agregar `042_...`.
- **Tests sin APIs reales**; unit puros con Vitest; el smoke (FLUX + Nano Banana real) lo corre el usuario.
- **pnpm**; commits **sin** `Co-Authored-By`; conventional commits en español.
- Cada commit hace `git add` SOLO de los archivos de su task (hay cambios sin commitear no relacionados en el working tree).

---

### Task 1: Migración — columnas de storyboard en `campaign_items`

**Files:**
- Create: `supabase/migrations/042_storyboard.sql`

**Interfaces:**
- Produces: `campaign_items.storyboard_image_id uuid null` (FK `media_references` on delete set null) y `campaign_items.storyboard_generation_id uuid null` (FK `generations` on delete set null).

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/042_storyboard.sql`:

```sql
-- 042_storyboard.sql
-- Storyboard: un panel-imagen por beat (campaign_item). El panel vigente apunta a
-- una media_reference (sirve de referencia del video en el sub-proyecto B y de base
-- para la siguiente edicion Nano Banana). El historial vive en generations.

alter table campaign_items
  add column if not exists storyboard_image_id      uuid references media_references(id) on delete set null,
  add column if not exists storyboard_generation_id uuid references generations(id)       on delete set null;

comment on column campaign_items.storyboard_image_id is
  'media_reference del panel VIGENTE de este beat (null = sin panel). Referencia del video en modo storyboard.';
comment on column campaign_items.storyboard_generation_id is
  'Ultima generacion (FLUX o edicion Nano Banana) del panel, para encadenar la edicion iterativa.';
```

- [ ] **Step 2: Sanity-check** — aditivo (`add column if not exists`), no toca columnas existentes, FKs `on delete set null`. NO aplicar contra la DB (lo hace el usuario).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_storyboard.sql
git commit -m "feat(storyboard): migracion columnas storyboard_image_id / storyboard_generation_id"
```

---

### Task 2: Lógica pura de compilación del panel (`lib/campaigns/storyboard.ts`)

**Files:**
- Create: `lib/campaigns/storyboard.ts`
- Test: `lib/campaigns/storyboard.test.ts`

**Interfaces:**
- Consumes: `compile` y `DirectorContext` de `@/lib/prompt-director`.
- Produces:
  - `type PanelBeat = { id: string; scene_prompt: string; aspect_ratio: string | null; storyboard_image_id: string | null }`
  - `beatsNeedingPanel(beats: PanelBeat[]): PanelBeat[]` — los que tienen `storyboard_image_id == null`.
  - `compilePanel(beat: PanelBeat, ctx: DirectorContext, fluxModelSlug: string): CompileResult` — compila el prompt FLUX del panel.
  - `compilePanelEdit(instruction: string, aspectRatio: string | null, ctx: DirectorContext, nanoModelSlug: string): CompileResult` — compila la edición Nano Banana.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/campaigns/storyboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { beatsNeedingPanel, compilePanel, compilePanelEdit } from './storyboard';

describe('beatsNeedingPanel', () => {
  it('devuelve solo beats sin panel', () => {
    const beats = [
      { id: 'a', scene_prompt: 'x', aspect_ratio: '9:16', storyboard_image_id: null },
      { id: 'b', scene_prompt: 'y', aspect_ratio: '9:16', storyboard_image_id: 'img-1' },
    ];
    expect(beatsNeedingPanel(beats).map((b) => b.id)).toEqual(['a']);
  });
});

describe('compilePanel', () => {
  it('compila un prompt FLUX con el scene_prompt y el producto del contexto', () => {
    const beat = { id: 'a', scene_prompt: 'the couple smiles in the living room', aspect_ratio: '9:16', storyboard_image_id: null };
    const res = compilePanel(beat, { product: { name: 'Canvas', imagePaths: ['ws/prod.png'] } }, 'flux-2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('the couple smiles');
    expect(res.compiled.params.width).toBeGreaterThan(0);
    expect(res.compiled.references.some((r) => r.role === 'product')).toBe(true);
  });
});

describe('compilePanelEdit', () => {
  it('compila una edicion Nano Banana con la instruccion', () => {
    const res = compilePanelEdit('make the lighting warmer', '9:16', {}, 'gemini-3-pro-image-preview');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('warmer');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- storyboard`
Expected: FAIL — `beatsNeedingPanel is not a function` (módulo inexistente).

- [ ] **Step 3: Implementar `lib/campaigns/storyboard.ts`**

```ts
// Lógica pura de la autoría del storyboard: selección de beats y compilación del
// prompt del panel (FLUX) y de su edición (Nano Banana). Sin DB ni red: la acción
// server (server-actions/storyboard.ts) hace el IO y llama a esta lógica.
import { compile, type CompileResult, type DirectorContext } from '@/lib/prompt-director';

export type PanelBeat = {
  id: string;
  scene_prompt: string;
  aspect_ratio: string | null;
  storyboard_image_id: string | null;
};

// Beats que aún no tienen panel — los que "Generar storyboard" debe generar.
export function beatsNeedingPanel(beats: PanelBeat[]): PanelBeat[] {
  return beats.filter((b) => b.storyboard_image_id == null);
}

// Compila el prompt FLUX del panel de un beat usando el contexto de campaña
// (producto/personaje/escena). El aspectRatio del beat manda la composición.
export function compilePanel(
  beat: PanelBeat,
  ctx: DirectorContext,
  fluxModelSlug: string,
): CompileResult {
  return compile(
    { modelSlug: fluxModelSlug, scenePrompt: beat.scene_prompt, aspectRatio: beat.aspect_ratio ?? '9:16' },
    ctx,
  );
}

// Compila la edición Nano Banana de un panel: la instrucción es el scenePrompt.
// La imagen base y el turno previo los inyecta la acción server (IO), no aquí.
export function compilePanelEdit(
  instruction: string,
  aspectRatio: string | null,
  ctx: DirectorContext,
  nanoModelSlug: string,
): CompileResult {
  return compile(
    { modelSlug: nanoModelSlug, scenePrompt: instruction, aspectRatio: aspectRatio ?? '9:16' },
    ctx,
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- storyboard`
Expected: PASS. Además `pnpm typecheck` limpio.

> Nota para el implementer: `compile` despacha al compiler por substring del slug (`flux` → FLUX, `gemini`+`image` → Nano Banana). Verifica que `fluxModelSlug` contenga `flux` y `nanoModelSlug` contenga `gemini` e `image`. Si el test falla por dispatch, ajusta los slugs de prueba al patrón real (ver `lib/prompt-director/index.ts` `dispatch`).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/storyboard.ts lib/campaigns/storyboard.test.ts
git commit -m "feat(storyboard): logica pura de compilacion de panel (FLUX) y edicion (Nano Banana)"
```

---

### Task 3: Helper `promoteOutputToReference` (`lib/supabase/storage.ts`)

**Files:**
- Modify: `lib/supabase/storage.ts`

**Interfaces:**
- Produces: `promoteOutputToReference(workspaceId: string, outputPath: string): Promise<string>` — descarga el output (bucket outputs), lo sube a `references` y crea una fila `media_references` type `image`, devolviendo su id.

- [ ] **Step 1: Implementar el helper**

En `lib/supabase/storage.ts`, agregar (reusa `downloadOutputBuffer`, `uploadReference`, `createAdminClient`, `REFERENCES_BUCKET` ya presentes):

```ts
// Promueve un output ya generado (bucket outputs) a una media_reference reusable
// (bucket references): copia el binario y crea la fila media_references type
// 'image'. Devuelve el id de la nueva media_reference. Usado por el storyboard:
// el panel debe ser una referencia (para el video) y base de la siguiente edición.
export async function promoteOutputToReference(
  workspaceId: string,
  outputPath: string,
): Promise<string> {
  const { buffer, mimeType } = await downloadOutputBuffer(outputPath);
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const key = `storyboard/${crypto.randomUUID()}.${ext}`;
  const path = await uploadReference(workspaceId, key, buffer, mimeType);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('media_references')
    .insert({ workspace_id: workspaceId, type: 'image', storage_url: path })
    .select('id')
    .single();
  if (error || !data) throw new Error(`promote reference failed: ${error?.message ?? 'no row'}`);
  return data.id as string;
}
```

> Implementer: confirma las columnas obligatorias de `media_references` (al menos `workspace_id`, `type`, `storage_url`). Si la tabla exige más columnas NOT NULL (p.ej. `user_id`, `filename`, `mime_type`), agrégalas con valores correctos — mira un INSERT existente a `media_references` (p.ej. en el flujo de subida de referencias) para igualar el shape. `createAdminClient` ya se importa en este archivo (usado por las otras funciones).

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm typecheck`
Expected: limpio.

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/storage.ts
git commit -m "feat(storyboard): helper promoteOutputToReference (output -> media_reference)"
```

---

### Task 4: Server actions síncronas (`server-actions/storyboard.ts`)

**Files:**
- Create: `server-actions/storyboard.ts`

**Interfaces:**
- Consumes: `beatsNeedingPanel`/`compilePanel`/`compilePanelEdit` (Task 2), `promoteOutputToReference` (Task 3).
- Produces: `generatePanelAction(itemId: string): Promise<Result<{ imageId: string }>>`, `refinePanelAction(itemId: string, instruction: string): Promise<Result<{ imageId: string }>>` con el mismo `Result<T>` que `server-actions/generations.ts`.

- [ ] **Step 1: Implementar las acciones (espejo de `submitGenerationAction`)**

Lee primero `server-actions/generations.ts` `submitGenerationAction` (líneas ~141-360) y `.cursor/rules/20-server-actions.mdc` y `.cursor/rules/60-credits.mdc`. Crea `server-actions/storyboard.ts` con `generatePanelAction` y `refinePanelAction`, replicando EXACTAMENTE el ciclo de créditos/generación de `submitGenerationAction`:

1. `requireWorkspace()`; cargar el `campaign_item` (`id, campaign_id, scene_prompt, aspect_ratio, character_id, character_ids, storyboard_image_id, storyboard_generation_id`) validando que su campaña sea del workspace.
2. Cargar `loadCampaignContext(workspaceId, campaign, characterIds)` y el `DirectorContext` del beat (reusa `directorContextFor`/`loadCampaignContext` de `lib/campaigns/orchestrator.ts`, exportándolos si hace falta).
3. **`generatePanelAction`**: compilar con `compilePanel(beat, ctx, FLUX_MODEL_SLUG)`. **`refinePanelAction`**: requiere `beat.storyboard_image_id` (si no, `{ ok:false, error:'no_panel' }`); compilar con `compilePanelEdit(instruction, beat.aspect_ratio, ctx, NANO_MODEL_SLUG)`.
4. `estimateCredits` (provider `flux` o `nano-banana`, model, variant) → cost. Resolver el model/variant FLUX y Nano Banana con el selector/constantes existentes (ver `lib/router/model-selector.ts` y cómo `submitGenerationAction` arma `data.model`/`data.variant`).
5. Insert `generations` (type `image`, provider, model_id, prompt del compile, `params: { ...del compile, storyboard: { campaignItemId: itemId } }`, `campaign_id`, status `processing`, `credits_estimated: cost`, `timeout_at`). Obtener `generationId`.
6. try: `reserveCredits` (si falla → borrar fila + `insufficient_credits`); cargar las referencias del compile como buffers (las `references[].storagePath` → `downloadReferenceBuffer` → `ImageReference[]`); para `refinePanelAction` construir `previousTurn` desde `storyboard_generation_id` IGUAL que `submitGenerationAction` hace con `parentGenerationId` (output + thought_signature, gateado por model match); llamar `generateFlux(...)` o `generateNanoBanana(...)` SÍNCRONO; `uploadOutput` + thumbnail; `completeGeneration(...)`.
7. **Promoción**: `const imageId = await promoteOutputToReference(workspaceId, outputPath)`; `update campaign_items set storyboard_image_id = imageId, storyboard_generation_id = generationId where id = itemId`. Best-effort: envolver en try/catch propio; si falla, loguear y devolver ok con el `generationId` (el panel queda como la generación). 
8. catch: `failGeneration(user.id, generationId, reserved ? cost : 0, errMsg)` (igual que `submitGenerationAction`).
9. `revalidatePath` de la ruta del storyboard de la campaña.

Constantes de modelo: define `FLUX_MODEL_SLUG` y `NANO_MODEL_SLUG` al inicio del archivo con los slugs reales del proyecto (los mismos que usa la generación de imagen suelta para FLUX y Nano Banana Pro).

> Si el shape de `directorContextFor`/`loadCampaignContext` no encaja para un solo beat (están pensados para el batch de video), extrae lo mínimo: producto/personaje/escena del `loadCampaignContext` + el `scene` del beat. Repórtalo como concern si requiere refactor mayor.

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm typecheck`
Expected: limpio. (No hay unit test aquí — toca proveedor real/DB; la lógica pura ya se testeó en Task 2. El smoke lo corre el usuario.)

- [ ] **Step 3: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(storyboard): generatePanelAction + refinePanelAction (sincronas, promueven el panel)"
```

---

### Task 5: UI — vista de Storyboard

**Files:**
- Create: `app/app/campaigns/[id]/storyboard/page.tsx` (+ `loading.tsx`)
- Create: `components/campaigns/StoryboardView.tsx`
- Modify: la navegación/tabs del detalle de campaña (`app/app/campaigns/[id]/...`) para enlazar la vista Storyboard.

**Interfaces:**
- Consumes: `generatePanelAction`/`refinePanelAction` (Task 4).

- [ ] **Step 1: Página (Server Component)**

Crea `app/app/campaigns/[id]/storyboard/page.tsx`: valida ownership de la campaña (mira `app/app/campaigns/[id]/page.tsx` para el patrón), consulta los `campaign_items` del campaign (`id, scene_index, scene_prompt, storyboard_image_id`) ordenados por `scene_index`, resuelve las URLs de los paneles (`storyboard_image_id` → `media_references.storage_url` → `signedReferenceUrl`) igual que otras páginas resuelven imágenes, y renderiza `<StoryboardView campaignId beats={...} />`. Crea `loading.tsx` con un skeleton (copia el patrón de otra `loading.tsx` del detalle de campaña).

- [ ] **Step 2: Componente cliente `StoryboardView`**

Crea `components/campaigns/StoryboardView.tsx` (`'use client'`):
- Botón **"Generar storyboard"**: itera los beats sin panel y `await generatePanelAction(beat.id)` por cada uno (secuencial; muestra "generando…" en ese panel), refrescando al resolver (`router.refresh()` o estado local con la nueva URL).
- Grid de beats en orden: cada panel muestra la imagen o un placeholder con su estado (sin panel / generando / falló), un botón **Regenerar** (`generatePanelAction`) y un input de instrucción + botón que llama `refinePanelAction(beat.id, instruction)`.
- Sistema visual: dark, shadcn, sin emojis. Sin Realtime (las acciones son síncronas).

- [ ] **Step 3: Enlazar la vista**

Agrega el enlace a `/app/campaigns/<id>/storyboard` donde viven las pestañas/acciones del detalle de campaña (mira cómo se enlazan las vistas existentes del detalle, p.ej. reporte/refinado).

- [ ] **Step 4: Verificar typecheck**

Run: `pnpm typecheck`
Expected: limpio. Verificación manual (usuario): generar y refinar paneles en `/app/campaigns/<id>/storyboard`.

- [ ] **Step 5: Commit**

```bash
git add app/app/campaigns components/campaigns/StoryboardView.tsx
git commit -m "feat(storyboard): vista de storyboard (generar y refinar paneles por beat)"
```

---

### Task 6: Verificación final

- [ ] **Step 1: Suite + typecheck**

Run: `pnpm test` (la suite completa sigue verde; los nuevos tests de `storyboard` pasan).
Run: `pnpm typecheck` (limpio).

- [ ] **Step 2: Smoke (lo corre el usuario)**

Aplicar la migración 042, abrir una campaña, "Generar storyboard" (se genera un panel FLUX por beat), refinar un panel con una instrucción ("haz la luz más cálida") y confirmar que la edición preserva la composición. Verificar que el panel quedó como `media_reference` (para que el sub-proyecto B lo use).

---

## Self-Review

**Cobertura del spec:** §Modelo de datos → Task 1. §Generación de paneles (síncrona) → Tasks 2,4. §Refinado → Tasks 2,4. §Promoción inline → Task 3 (helper) + Task 4 (uso). §UI → Task 5. §Testing → Task 2 (puro) + Task 6 (suite/smoke). §Casos borde: beat sin panel (guard en `refinePanelAction`, Task 4); falla → failGeneration/refund (Task 4); idempotencia "solo beats sin panel" (`beatsNeedingPanel`, Task 2); créditos atómicos (Task 4 espeja `submitGenerationAction`).

**Type consistency:** `PanelBeat`/`beatsNeedingPanel`/`compilePanel`/`compilePanelEdit` (Task 2) ↔ usados por `generatePanelAction`/`refinePanelAction` (Task 4). `promoteOutputToReference(workspaceId, outputPath): Promise<string>` (Task 3) ↔ llamado en Task 4 → devuelve el `imageId` que setea `storyboard_image_id`. `params.storyboard = { campaignItemId }` consistente.

**Placeholders:** Tasks 4 y 5 usan instrucciones de "espejar `submitGenerationAction`/archivos existentes con estos cambios" — concreto en codebase existente (el patrón síncrono de imagen YA existe verbatim en `submitGenerationAction`), no placeholder. El código de lógica pura (Task 2), migración (Task 1) y helper (Task 3) va completo. Puntos a resolver por el implementer marcados con `>`: shape exacto de `media_references` insert, slugs de modelo FLUX/Nano, y si `directorContextFor` encaja para un solo beat — todos verificables contra código existente.
