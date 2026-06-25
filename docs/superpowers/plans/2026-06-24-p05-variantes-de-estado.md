# P05 — Variantes de estado físico del personaje — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-hornear estados físicos (mojado/sudado/…) de un personaje como referencias distintas y, cuando el matcher detecta el estado en una escena, sustituir la hoja maestra por la variante e indicarle al compiler que use su vestuario/piel preservando la identidad.

**Architecture:** Tabla `character_states` + columna `campaign_items.character_state_hint`. El matcher elige un label de estado conocido por escena → persiste en el item → el orchestrator sustituye `masterImagePath` por el `state_image_path` y marca `stateLabel` → el compiler usa una cita condicional. Generación de la variante reusando `editUploaded` (Nano Banana). Sin fuzzy-match: el matcher elige de labels conocidos.

**Tech Stack:** Next.js 15, Supabase, TypeScript, Vitest, pnpm. Migración aditiva.

## Global Constraints

- **pnpm**: `pnpm typecheck`, `pnpm vitest run <archivo>`. Full suite: `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`.
- **No `any`**: tipos explícitos; `vi.mocked()` en mocks.
- **No emojis** en código/UI. Dark mode, estilo existente.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): schema/compiler/orchestrator puros; lo DB-bound y la UI por smoke.
- **Identidad inmutable**: el prompt de estado y la cita condicional preservan cara/identidad EXACTA; solo cambian vestuario/piel.
- **NO columnas sueltas en `characters`** (no romper el contrato master); el estado vive en `character_states`.
- **Character-only** (no estados de producto). **Diferido**: relajación de `humanRealismDirective` del storyboard, estado intra-cadena.
- **El matcher solo SUGIERE** el label; persistencia, match y sustitución son deterministas.
- **Migración aditiva**; la aplica el controlador vía MCP `apply_migration`.
- **Commits sin trailer `Co-Authored-By`.**

---

### Task 1: Migración `045_character_states.sql`

**Files:**
- Create: `supabase/migrations/045_character_states.sql`

**Interfaces:**
- Produces: tabla `character_states` (id, workspace_id, character_id, label, state_image_id, description, created_at) + índice; columna `campaign_items.character_state_hint text`. Las consumen Tasks 2, 5, 6, 7.

> Aplicación: el controlador aplica la migración al live vía MCP `apply_migration` antes del smoke. Los tests del plan son puros y no la requieren.

- [ ] **Step 1: Crear el archivo**

Para la RLS, **abre `supabase/migrations/022_v2_rls.sql` y copia las 4 policies de `characters`** (select/insert/update/delete por membresía del workspace) cambiando la tabla a `character_states`. La estructura:

```sql
-- 045_character_states.sql
-- P05: variantes de estado fisico del personaje (mojado/sudado/...), como
-- referencias distintas. NO columnas en characters (no romper el contrato master).
create table character_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  label text not null,
  state_image_id uuid references media_references(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);
create index character_states_character_id_idx on character_states(character_id);

alter table character_states enable row level security;

-- RLS member-scoped: ESPEJA exactamente las policies de characters en 022_v2_rls.sql
-- (workspace_members membership). Copia su patron cambiando la tabla.
-- <<aqui van las 4 policies copiadas de characters, tabla character_states>>

-- El hint de estado por escena (label exacto o null). Vive en el item porque el
-- orchestrator lo consume en GENERACION (directorContextFor), no en plan.
alter table campaign_items add column character_state_hint text;
```

(Sustituye el comentario `<<...>>` por las 4 policies reales copiadas de `characters`.)

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: sin errores (solo un .sql nuevo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/045_character_states.sql
git commit -m "feat(db): tabla character_states + campaign_items.character_state_hint (P05)"
```

---

### Task 2: CRUD — `server-actions/character-states.ts`

**Files:**
- Create: `server-actions/character-states.ts`
- Test: `server-actions/character-states.test.ts`

**Interfaces:**
- Consumes: la tabla `character_states` (Task 1).
- Produces: `createCharacterStateAction`, `listCharacterStatesAction`, `deleteCharacterStateAction`; exported `CreateCharacterStateSchema`. Lo consume Task 4 (UI).

- [ ] **Step 1: Escribir el test del schema (RED)**

Crear `server-actions/character-states.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CreateCharacterStateSchema } from './character-states';

const uuid = '11111111-1111-4111-a111-111111111111';

describe('CreateCharacterStateSchema', () => {
  it('acepta characterId/label/stateImageId válidos', () => {
    expect(CreateCharacterStateSchema.safeParse({
      characterId: uuid, label: 'sudado', stateImageId: uuid, description: 'corriendo bajo el sol',
    }).success).toBe(true);
  });
  it('rechaza label vacío', () => {
    expect(CreateCharacterStateSchema.safeParse({ characterId: uuid, label: '', stateImageId: uuid }).success).toBe(false);
  });
  it('rechaza label demasiado largo', () => {
    expect(CreateCharacterStateSchema.safeParse({ characterId: uuid, label: 'x'.repeat(41), stateImageId: uuid }).success).toBe(false);
  });
  it('rechaza stateImageId no-uuid', () => {
    expect(CreateCharacterStateSchema.safeParse({ characterId: uuid, label: 'sudado', stateImageId: 'no' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run server-actions/character-states.test.ts`
Expected: FAIL — `CreateCharacterStateSchema` no exportada.

- [ ] **Step 3: Implementar el módulo**

Crear `server-actions/character-states.ts`, **espejando `server-actions/cast.ts`** (mismo `Result` type, `requireWorkspace`, `validateImageOwnership` — reusa el patrón; copia el helper `validateImageOwnership` de cast.ts o impórtalo si se exporta):

```ts
'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

export const CreateCharacterStateSchema = z.object({
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  stateImageId: z.string().uuid(),
  description: z.string().trim().max(300).optional(),
});

async function ownsImage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('media_references').select('id, workspace_id, type').eq('id', id).single();
  return !!data && data.workspace_id === workspaceId && data.type === 'image';
}

export async function createCharacterStateAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateCharacterStateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  // ownership del personaje
  const { data: ch } = await supabase
    .from('characters').select('id, workspace_id').eq('id', parsed.data.characterId).single();
  if (!ch || ch.workspace_id !== workspace.id) return { ok: false, error: 'not_found', message: 'Personaje no encontrado' };
  if (!(await ownsImage(supabase, workspace.id, parsed.data.stateImageId))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }
  const { data: row, error } = await supabase
    .from('character_states')
    .insert({
      workspace_id: workspace.id,
      character_id: parsed.data.characterId,
      label: parsed.data.label,
      state_image_id: parsed.data.stateImageId,
      description: parsed.data.description ?? null,
    })
    .select('id').single();
  if (error || !row) return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { id: row.id as string } };
}

export async function listCharacterStatesAction(characterId: unknown): Promise<Result<Array<{ id: string; label: string; stateImageId: string | null; description: string | null }>>> {
  if (typeof characterId !== 'string') return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data } = await supabase
    .from('character_states')
    .select('id, label, state_image_id, description')
    .eq('character_id', characterId).eq('workspace_id', workspace.id)
    .order('created_at', { ascending: true });
  return { ok: true, data: (data ?? []).map((r) => ({ id: r.id as string, label: r.label as string, stateImageId: (r.state_image_id as string | null) ?? null, description: (r.description as string | null) ?? null })) };
}

export async function deleteCharacterStateAction(id: unknown): Promise<Result<{ id: string }>> {
  if (typeof id !== 'string') return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('character_states').delete().eq('id', id).eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/brand/cast');
  return { ok: true, data: { id } };
}
```

- [ ] **Step 4: Correr el test (GREEN) + typecheck**

Run: `pnpm vitest run server-actions/character-states.test.ts` y `pnpm typecheck`
Expected: PASS los 4 tests; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add server-actions/character-states.ts server-actions/character-states.test.ts
git commit -m "feat(cast): CRUD de character_states (P05)"
```

---

### Task 3: `generateCharacterState` (hornear la variante)

**Files:**
- Modify: `components/creation/generate.ts`
- Test: `components/creation/generate.test.ts` (ya existe, de P01)

**Interfaces:**
- Consumes: `editUploaded(reference, instruction, opts?)` (ya en el archivo).
- Produces: `export async function generateCharacterState(masterRef: { id: string; storagePath: string }, state: string): Promise<GeneratedImage | GenError>`. Lo consume Task 4 (UI).

- [ ] **Step 1: Escribir el test (RED)**

En `components/creation/generate.test.ts` (reusa los mocks de `submitGenerationAction`/`addGenerationAsReferenceAction` ya configurados en el archivo):

```ts
describe('generateCharacterState', () => {
  it('hornea un estado preservando identidad vía editUploaded', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({ ok: true, data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' } });
    const res = await generateCharacterState({ id: 'm', storagePath: 'ws/m.png' }, 'wet hair and soaked clothing, sweat on the forehead');
    expect(isGenError(res)).toBe(false);
    const call = vi.mocked(submitGenerationAction).mock.calls[0][0];
    expect(call.provider).toBe('nano-banana');
    expect(call.conversational).toBe(false);
    expect(call.references).toEqual([{ id: 'm', storagePath: 'ws/m.png' }]);
    expect(call.prompt).toMatch(/wet hair and soaked clothing/);
    expect(call.prompt).toMatch(/Keep the person's identity perfectly consistent/i);
  });
});
```

(Si la firma real de `addGenerationAsReferenceAction` difiere, ajusta el objeto del mock — NO `as any`.)

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run components/creation/generate.test.ts`
Expected: FAIL — `generateCharacterState` no existe.

- [ ] **Step 3: Implementar**

En `components/creation/generate.ts`, junto a `generateProductAngle`:

```ts
// Hornea una VARIANTE DE ESTADO de un personaje (P05) desde su hoja maestra,
// vía editUploaded (la master entra como referencia). Preserva la identidad
// EXACTA; cambia solo el estado fisico (vestuario/piel). El `state` describe el
// estado ("wet hair and soaked clothing, sweat on the forehead").
export async function generateCharacterState(
  masterRef: { id: string; storagePath: string },
  state: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    `Same exact face, hairstyle, build and identity as the reference person, now with ${state}. ` +
    `Keep the person's identity perfectly consistent — only the physical state (wardrobe and skin) changes. ` +
    `Same plain background and even studio lighting.`;
  return editUploaded(masterRef, prompt);
}
```

- [ ] **Step 4: Correr el test (GREEN) + typecheck**

Run: `pnpm vitest run components/creation/generate.test.ts` y `pnpm typecheck`
Expected: PASS; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add components/creation/generate.ts components/creation/generate.test.ts
git commit -m "feat(creation): generateCharacterState hornea una variante de estado (P05)"
```

---

### Task 4: UI de estados en el Cast

**Files:**
- Modify: `components/cast/CastPage.tsx`

**Interfaces:**
- Consumes: `generateCharacterState` (Task 3); `createCharacterStateAction`/`listCharacterStatesAction`/`deleteCharacterStateAction` (Task 2); `getReferencePathsAction` (`@/server-actions/creation`, para el storagePath del master).
- Produces: nada (hoja).

> Sin unit test (UI; smoke). Verifica con `pnpm typecheck`.

- [ ] **Step 1: Sección "Estados" por personaje**

En `components/cast/CastPage.tsx`, en el editor/tarjeta de un personaje existente (con `master_image_id`), añade una sección "Estados (opcional)" que:
1. Lista los estados del personaje (`listCharacterStatesAction(characterId)` al montar/abrir).
2. Un input de **label** + input de **descripción del estado** + botón "Generar estado".
3. Al pulsar: resuelve el storagePath del master con `getReferencePathsAction([masterImageId])`, llama `generateCharacterState({ id: masterImageId, storagePath }, description)`, y con el `refId` resultante llama `createCharacterStateAction({ characterId, label, stateImageId: refId, description })`. Refresca la lista.
4. Cada estado listado con un botón "Borrar" → `deleteCharacterStateAction(id)`.

Reusa el estilo de los botones/inputs ya presentes en `CastPage` (los del master/ángulos), `toast` (sonner), iconos `Loader2`/`Sparkles`. Maneja error de cada action con `toast.error`. La generación es **iniciada por el usuario** (consume créditos).

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/cast/CastPage.tsx
git commit -m "feat(cast): UI para hornear y listar estados del personaje (P05)"
```

---

### Task 5: Matcher — `characterStateHint` + labels de estado en el pool

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (`SceneSchema`, `MatchedScene`, scenes transform, `MatcherCharacter`, pool, SYSTEM)
- Modify: `server-actions/campaigns.ts` (cargar labels de estado → `MatcherCharacter`)
- Test: `lib/prompt-director/format-matcher.test.ts`

**Interfaces:**
- Consumes: la tabla `character_states` (Task 1).
- Produces: `MatchedScene.characterStateHint: string | null`; `MatcherCharacter.states?: string[]`. Los consume Task 6 (planner) y el SYSTEM.

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/prompt-director/format-matcher.test.ts`:

```ts
  it('parsea characterStateHint de una escena (P05)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'corre y suda', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: 'she runs in the heat', durationS: 5, characterStateHint: 'sudado' }] }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].characterStateHint).toBe('sudado');
  });

  it('characterStateHint ausente cae a null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'normal', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [{ scenePrompt: 'she smiles', durationS: 5 }] }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].scenes[0].characterStateHint).toBeNull();
  });

  it('pasa los labels de estado del personaje en el pool del prompt', async () => {
    const fetchMock = vi.fn(async () => geminiOk({ matches: [{ ideaText: 'x', formatId: 'f1', customFormat: null }] }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await matchIdeas({ ideasText: 'x', formats: FORMATS, characters: [{ id: 'c1', name: 'Marcela', states: ['sudado', 'mojado'] }] });
    // mismo patrón de parseo del body que el test existente "las imágenes adjuntas viajan…"
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
    const body = JSON.parse(init.body) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    expect(String(body.contents[0].parts[0].text)).toContain('estados: sudado, mojado');
  });
```

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: FAIL — `characterStateHint` no existe; el pool no incluye los estados.

- [ ] **Step 3: Añadir `characterStateHint` al schema/tipo/transform**

En `lib/prompt-director/format-matcher.ts`:

(a) `SceneSchema` (tras `beatRole`, línea 110):
```ts
  // P05: label EXACTO de un estado fisico del personaje listado, o null. Patron beatRole.
  characterStateHint: z.string().trim().nullable().catch(null).default(null),
```
(b) `MatchedScene` (línea 112-117), añadir:
```ts
  characterStateHint: string | null;
```
(c) En el transform de `scenes` (línea 153-156), añadir al objeto devuelto:
```ts
          characterStateHint: parsed.data.characterStateHint,
```

- [ ] **Step 4: `MatcherCharacter.states` + pool + SYSTEM**

En `lib/prompt-director/format-matcher.ts`:

(a) El type `MatcherCharacter` (busca `type MatcherCharacter`) gana `states?: string[]`.

(b) En `requestMatch`, la línea del cast pool (`(input.characters ?? []).map((c) => \`- id=${c.id} ${c.name}\`)`) cambia a:
```ts
    .map((c) => `- id=${c.id} ${c.name}${c.states?.length ? ` (estados: ${c.states.join(', ')})` : ''}`)
```

(c) En el SYSTEM, en la sección de `scenes` (donde se describe el objeto-escena), añade la instrucción de `characterStateHint` y el campo al objeto-escena del JSON: "Si en una escena un personaje del Cast está en un ESTADO FÍSICO listado entre paréntesis junto a su nombre (estados: sudado, mojado…), pon ese label EXACTO en `characterStateHint`; si no aplica, null." Añade `"characterStateHint":"label exacto del estado o null"` al objeto-escena.

- [ ] **Step 5: `campaigns.ts` pasa los labels de estado**

En `server-actions/campaigns.ts`, donde se llama `matchIdeas` (busca `characters: characters.map((c) => ({ id: c.id, name: c.name }))`), carga los labels de estado de esos personajes y pásalos:
```ts
// antes del matchIdeas: cargar estados de los personajes del pool
const { data: stateRows } = await supabase
  .from('character_states')
  .select('character_id, label')
  .in('character_id', characters.map((c) => c.id));
const statesByChar = new Map<string, string[]>();
for (const r of stateRows ?? []) {
  const arr = statesByChar.get(r.character_id as string) ?? [];
  arr.push(r.label as string);
  statesByChar.set(r.character_id as string, arr);
}
// en el matchIdeas:
characters: characters.map((c) => ({ id: c.id, name: c.name, ...(statesByChar.get(c.id)?.length ? { states: statesByChar.get(c.id) } : {}) })),
```

- [ ] **Step 6: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts` y `pnpm typecheck`
Expected: PASS los 3 tests; typecheck limpio.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/format-matcher.ts server-actions/campaigns.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(matcher): characterStateHint por escena + labels de estado en el pool (P05)"
```

---

### Task 6: Planner escribe `character_state_hint` en el item

**Files:**
- Modify: `lib/campaigns/planner.ts` (escribir el hint en el draft del item)
- Modify: `lib/campaigns/orchestrator.ts` (el `ItemRow`/select del orchestrator incluye `character_state_hint`)

**Interfaces:**
- Consumes: `MatchedScene.characterStateHint` (Task 5); la columna `campaign_items.character_state_hint` (Task 1).
- Produces: `ItemRow.character_state_hint?: string | null` disponible para Task 7.

- [ ] **Step 1: Escribir el hint en el draft del planner**

En `lib/campaigns/planner.ts`, en el `.map` de `idea.scenes` (donde se construye cada `PlanItemDraft` con `scenePrompt`/`durationS`/`sceneSummary` — el mismo punto donde P19 leyó `sc.beatRole`), añade al draft el campo que materializa la columna:
```ts
          characterStateHint: sc.characterStateHint ?? null,
```
Y donde el draft se inserta como `campaign_item` (busca el `.insert(...)` de `campaign_items` en el planner), mapea ese campo a la columna: `character_state_hint: draft.characterStateHint ?? null`. (Sigue el shape del draft/insert existente; añade el campo al tipo `PlanItemDraft` si lo hay.)

> Si el planner separa "draft" del "insert", añade `characterStateHint` al tipo del draft y al objeto del insert. Las escenas no-secuencia (un solo clip) no tienen `scenes[].characterStateHint`; quedan en null (correcto: un solo clip raramente declara estado).

- [ ] **Step 2: El `ItemRow` del orchestrator incluye la columna**

En `lib/campaigns/orchestrator.ts`, el tipo `ItemRow` y los `.select(...)` de `campaign_items` que alimentan el orchestrator deben incluir `character_state_hint`. Añade `character_state_hint` a la lista de columnas del/los select de items y `character_state_hint: string | null` al tipo `ItemRow`.

- [ ] **Step 3: typecheck + suite**

Run: `pnpm typecheck` y `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`
Expected: typecheck limpio; suite verde (cambio de plomería; sin test unitario nuevo — la persistencia se valida en el smoke y en el test del orchestrator de Task 7).

- [ ] **Step 4: Commit**

```bash
git add lib/campaigns/planner.ts lib/campaigns/orchestrator.ts
git commit -m "feat(campaigns): persiste character_state_hint del matcher en el item (P05)"
```

---

### Task 7: Orchestrator — sustituir el master por el estado

**Files:**
- Modify: `lib/prompt-director/types.ts` (`CharacterInventory.stateLabel?`)
- Modify: `lib/campaigns/orchestrator.ts` (cargar estados por personaje; sustituir en `directorContextFor`)
- Test: `lib/campaigns/director-context.test.ts`

**Interfaces:**
- Consumes: `ItemRow.character_state_hint` (Task 6); la tabla `character_states` (Task 1).
- Produces: `CharacterInventory.stateLabel?: string`; `directorContextFor` sustituye el path. Lo consume Task 8 (compiler).

- [ ] **Step 1: Escribir el test (RED)**

En `lib/campaigns/director-context.test.ts`:

```ts
  it('sustituye el master por la variante de estado y setea stateLabel (P05)', () => {
    const ctx: CampaignContext = {
      productName: 'Serum', productImagePaths: [], packagingImagePaths: [],
      characters: new Map([['c1', {
        name: 'Marcela', description: 'x', masterImagePath: 'ws/master.png',
        angleImagePaths: [], states: { sudado: 'ws/sweaty.png' },
      }]]),
      language: 'es',
    };
    const sweaty = { id: 'i1', character_ids: ['c1'], character_id: null, scene: null, character_state_hint: 'sudado' } as unknown as Parameters<typeof directorContextFor>[0];
    const dc = directorContextFor(sweaty, null, ctx);
    expect(dc.characters?.[0].masterImagePath).toBe('ws/sweaty.png');
    expect(dc.characters?.[0].stateLabel).toBe('sudado');

    const neutral = { id: 'i2', character_ids: ['c1'], character_id: null, scene: null, character_state_hint: null } as unknown as Parameters<typeof directorContextFor>[0];
    const dc2 = directorContextFor(neutral, null, ctx);
    expect(dc2.characters?.[0].masterImagePath).toBe('ws/master.png');
    expect(dc2.characters?.[0].stateLabel).toBeUndefined();
  });
```

(El `CampaignContext.characters` ahora lleva `states?: Record<string,string>` por personaje — lo añade el Step 3.)

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: FAIL — el character entry no tiene `states`; `directorContextFor` no sustituye ni setea `stateLabel`; `CharacterInventory` no tiene `stateLabel`.

- [ ] **Step 3: Tipos + carga de estados + sustitución**

(a) `lib/prompt-director/types.ts`, en `CharacterInventory` (línea 53-60):
```ts
  // P05: label del estado fisico activo en ESTA escena (sudado/mojado/...). Cuando
  // existe, masterImagePath es la variante de estado y el compiler usa su vestuario.
  stateLabel?: string;
```

(b) `lib/campaigns/orchestrator.ts`: el type del `Map` de `CampaignContext.characters` gana `states?: Record<string, string>` (label→path). En `loadCampaignContext`, tras armar `characters`, carga `character_states` de esos ids, resuelve `state_image_id`→path (con `resolvePaths`), y para cada character setea `states` = `{ [label]: path }`:
```ts
  const charIds = [...characters.keys()];
  if (charIds.length) {
    const { data: stRows } = await supabase
      .from('character_states').select('character_id, label, state_image_id')
      .in('character_id', charIds);
    const stImgIds = (stRows ?? []).map((r) => r.state_image_id as string | null).filter((x): x is string => !!x);
    const stPaths = await resolvePaths(supabase, workspaceId, stImgIds);
    for (const r of stRows ?? []) {
      const ent = characters.get(r.character_id as string);
      const path = (r.state_image_id as string | null) ? stPaths.get(r.state_image_id as string) : undefined;
      if (ent && path) { (ent.states ??= {})[r.label as string] = path; }
    }
  }
```

(c) En `directorContextFor`, en el `.map` que construye los characters (línea 296-304), usa el hint del item:
```ts
  const stateHint = (item.character_state_hint as string | null) ?? null;
  const characters = itemCharacterIds(item)
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => {
      const statePath = stateHint ? c.states?.[stateHint] : undefined;
      return {
        name: c.name,
        description: c.description,
        masterImagePath: statePath ?? c.masterImagePath,
        angleImagePaths: c.angleImagePaths,
        ...(statePath ? { stateLabel: stateHint as string } : {}),
      };
    });
```

(Con `statePath` activo, NO se incluyen angleImagePaths del estado — la variante de estado sustituye solo el master; los ángulos siguen siendo del estado neutro, que es lo correcto: el modelo toma identidad del estado y ángulos del neutro. Si prefieres no citar ángulos cuando hay estado, fíltralos; v1 los mantiene.)

- [ ] **Step 4: Correr el test (GREEN) + typecheck + suite**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`, `pnpm typecheck`, `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`
Expected: PASS el test; typecheck limpio; suite verde.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/types.ts lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts
git commit -m "feat(campaigns): sustituye el master por la variante de estado por escena (P05)"
```

---

### Task 8: Compiler — cita condicional por estado

**Files:**
- Modify: `lib/prompt-director/compilers/seedance.ts` (cita del character)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `CharacterInventory.stateLabel` (Task 7).
- Produces: nada nuevo.

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/prompt-director/prompt-director.test.ts` (reusa `compile`/`CompileRequest`/`DirectorContext`):

```ts
  it('con stateLabel, la cita usa el vestuario del estado (P05)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'she runs in the heat' } as CompileRequest,
      { characters: [{ name: 'Marcela', description: 'x', masterImagePath: 'ws/sweaty.png', stateLabel: 'sudado' }] } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.compiled.prompt).toMatch(/sudado wardrobe and skin condition shown here/i);
      expect(res.compiled.prompt).not.toMatch(/not its clothing/);
    }
  });

  it('sin stateLabel, la cita conserva "not its clothing"', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'she smiles' } as CompileRequest,
      { characters: [{ name: 'Marcela', description: 'x', masterImagePath: 'ws/master.png' }] } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).toMatch(/not its clothing/);
  });
```

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: FAIL — la cita no es condicional; el primer test no encuentra el texto del estado.

- [ ] **Step 3: Cita condicional**

En `lib/prompt-director/compilers/seedance.ts`, en la cita del character (línea 205-211), usa `character.stateLabel`:

```ts
    const stateLabel = character.stateLabel;
    pushImage(
      character.masterImagePath,
      'character',
      (n) =>
        stateLabel
          ? `@image${n} is ${character.name} — keep the exact face, hair, build and identity, and the ${stateLabel} wardrobe and skin condition shown here; only the physical state may differ, never who they are.`
          : `@image${n} is ${character.name} — use only the face, hair and build from this reference (not its clothing or background), kept consistent.`,
      stateLabel ? `identidad exacta + vestuario/piel del estado ${stateLabel}` : 'rostro, peinado y complexión; no la ropa ni el fondo',
    );
```

- [ ] **Step 4: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts` y `pnpm typecheck`
Expected: PASS los 2 tests; sin regresión; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): cita condicional del personaje por estado (P05)"
```

---

## Verificación final (tras las 8 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run` — suite verde (incluye los tests de CRUD schema, matcher, orchestrator, compiler).
- [ ] **Controlador aplica la migración 045** al live vía MCP `apply_migration` (chequear antes con `list_tables`).
- [ ] Smoke del usuario:
  1. Crear un personaje; hornear un estado "sudado" desde su master (ver que la cara se preserva).
  2. Crear una campaña con una idea donde el personaje corre/suda.
  3. Confirmar en el prompt compilado que esa escena cita la variante sudada con la cita condicional (vestuario incluido), mientras otras escenas usan el master neutro.

## Notas para el implementador

- `generateCharacterState` reusa `editUploaded` (NO `editImage`): la master puede ser subida o generada. `conversational: false`.
- El matcher elige de labels CONOCIDOS (van en el pool); el orchestrator hace match EXACTO por label. Sin fuzzy.
- El hint persiste en `campaign_items.character_state_hint` porque el orchestrator lo lee en generación (no en plan, distinto de `beatRole`).
- La variante de estado SUSTITUYE el master neutro (no se suma); el presupuesto de 9 imágenes de Seedance no cambia.
- NO toques `humanRealismDirective` (storyboard) ni la cadena intra-escena — diferidos.
- Identidad: la cita condicional fija "keep the exact face, hair, build and identity" — no reactiva el bug de deriva de cara.
