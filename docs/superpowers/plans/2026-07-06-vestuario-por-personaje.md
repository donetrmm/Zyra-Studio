# Vestuario por personaje — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anclar el vestuario del Cast con una imagen de cuerpo completo por personaje + outfits intercambiables (por campaña, con override por clip), para matar el drift de ropa en paneles y clips.

**Architecture:** Espejo del patrón `character_states` (P05): tabla `character_outfits` + slot `characters.full_body_image_id`; resolución determinista en `directorContextFor` (hint del clip → map de campaña → base); el compiler empuja el cuerpo completo como ref rol `character` tras la maestra, con cita de vestuario — fluye a paneles, R2V y compile normal por el inventario. Matcher y planner NO se tocan.

**Tech Stack:** Next.js App Router + Supabase (proyecto `dzqhngfwlgxkmxohlwun`), zod, Nano Banana (editUploaded multi-turn), vitest, pnpm.

**Spec:** `specs/v2/16-vestuario-por-personaje.md` (fuente de verdad).

## Global Constraints

- **pnpm** (`pnpm vitest run`, `pnpm typecheck`, `pnpm build`).
- Commits: Conventional Commits en español, imperativo, **SIN `Co-Authored-By`**.
- **No `any`**; `unknown` + narrowing o tipos explícitos. Sin emojis en código/UI.
- Tests **nunca** llaman APIs reales (Nano Banana/Gemini); prompts se testean como strings.
- Migración 059 aplicada vía MCP (`project_id dzqhngfwlgxkmxohlwun`) **ANTES** de pushear código que lea las columnas.
- `'use server'` solo exporta funciones async — schemas zod van en `lib/schemas/**`.
- Server actions validan ownership (workspace) además de RLS.
- `character_states` (P05) queda **intacto**: sus tests no deben cambiar.
- Rama de trabajo: `feat/ingesta-prompt-maestro` (decisión del usuario).

---

### Task 1: Migración 059 (controller la aplica vía MCP)

**Files:**
- Create: `supabase/migrations/059_character_outfits.sql`

**Interfaces:**
- Produces: `characters.full_body_image_id`, tabla `character_outfits`, `campaigns.character_outfit_map`, `campaign_items.character_outfit_hint`.

- [ ] **Step 1: Crear la migración**

```sql
-- 059_character_outfits.sql
-- Vestuario por personaje (specs/v2/16): la maestra es head-and-shoulders y no
-- ancla la ropa. Cuerpo completo base + outfits intercambiables (variantes de
-- cuerpo completo con label). Espejo del patron character_states (045).

-- Cuerpo completo base del personaje (vestuario por defecto).
alter table characters
  add column if not exists full_body_image_id uuid references media_references(id) on delete set null;

create table character_outfits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  label text not null,
  outfit_image_id uuid references media_references(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);
create index character_outfits_character_id_idx on character_outfits(character_id);

alter table character_outfits enable row level security;

drop policy if exists "character_outfits_read" on character_outfits;
create policy "character_outfits_read" on character_outfits for select
  using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "character_outfits_insert" on character_outfits;
create policy "character_outfits_insert" on character_outfits for insert
  with check (is_workspace_member(workspace_id));

drop policy if exists "character_outfits_update" on character_outfits;
create policy "character_outfits_update" on character_outfits for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

drop policy if exists "character_outfits_delete" on character_outfits;
create policy "character_outfits_delete" on character_outfits for delete
  using (is_workspace_member(workspace_id));

-- Outfit elegido por personaje para TODA la campaña: { [characterId]: outfitId }.
alter table campaigns
  add column if not exists character_outfit_map jsonb;

-- Override por clip, por LABEL (mismo patron que character_state_hint). null = el de campaña.
alter table campaign_items
  add column if not exists character_outfit_hint text;
```

- [ ] **Step 2: Aplicar vía MCP** — `mcp__plugin_supabase_supabase__apply_migration` con `project_id: dzqhngfwlgxkmxohlwun`, `name: 059_character_outfits`. Esperado `success: true`.

- [ ] **Step 3: Verificar** — `execute_sql`: `select column_name from information_schema.columns where table_name in ('characters','campaigns','campaign_items') and column_name in ('full_body_image_id','character_outfit_map','character_outfit_hint');` → 3 filas; y `select count(*) from character_outfits;` → 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/059_character_outfits.sql
git commit -m "feat(cast): migración de vestuario por personaje (cuerpo completo + outfits)"
```

---

### Task 2: Schema + server actions de outfits (espejo de states)

**Files:**
- Create: `lib/schemas/character-outfits.ts`
- Create: `server-actions/character-outfits.ts`
- Test: `lib/schemas/character-outfits.test.ts`

**Interfaces:**
- Consumes: tabla `character_outfits` (Task 1); patrones de `lib/schemas/character-states.ts` y `server-actions/character-states.ts` (leer AMBOS antes de escribir — son el espejo exacto).
- Produces: `CreateCharacterOutfitSchema`, `UpdateCharacterOutfitImageSchema` (zod); actions `createCharacterOutfitAction(input): Promise<Result<{ id: string }>>`, `listCharacterOutfitsAction(characterId): Promise<Result<Array<{ id; label; outfitImageId: string | null; description: string | null; previewUrl: string | null }>>>`, `updateCharacterOutfitImageAction(input): Promise<Result<{ previewUrl: string | null }>>`, `deleteCharacterOutfitAction(id): Promise<Result<{ id: string }>>`.

- [ ] **Step 1: Test del schema (falla)**

```ts
// lib/schemas/character-outfits.test.ts
import { describe, it, expect } from 'vitest';
import { CreateCharacterOutfitSchema } from './character-outfits';

describe('CreateCharacterOutfitSchema', () => {
  it('acepta label + imagen', () => {
    const r = CreateCharacterOutfitSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000',
      label: 'deportivo',
      outfitImageId: '00000000-0000-0000-0000-000000000001',
    });
    expect(r.success).toBe(true);
  });
  it('rechaza label vacío o >40', () => {
    expect(CreateCharacterOutfitSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000', label: ' ', outfitImageId: '00000000-0000-0000-0000-000000000001',
    }).success).toBe(false);
    expect(CreateCharacterOutfitSchema.safeParse({
      characterId: '00000000-0000-0000-0000-000000000000', label: 'x'.repeat(41), outfitImageId: '00000000-0000-0000-0000-000000000001',
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: RED** — `pnpm vitest run lib/schemas/character-outfits.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Schema**

```ts
// lib/schemas/character-outfits.ts
import { z } from 'zod';

// Vestuario (specs/v2/16): validación de createCharacterOutfitAction. Vive aquí
// (no en el módulo 'use server') porque un archivo 'use server' solo puede
// exportar funciones async. Espejo de character-states.ts.
export const CreateCharacterOutfitSchema = z.object({
  characterId: z.string().uuid(),
  label: z.string().trim().min(1).max(40),
  outfitImageId: z.string().uuid(),
  description: z.string().trim().max(300).optional(),
});

export const UpdateCharacterOutfitImageSchema = z.object({
  outfitId: z.string().uuid(),
  outfitImageId: z.string().uuid(),
});
```

- [ ] **Step 4: GREEN** — mismo comando, PASS.

- [ ] **Step 5: Server actions** — crear `server-actions/character-outfits.ts` como espejo 1:1 de `server-actions/character-states.ts`, sustituyendo: tabla `character_outfits`, columnas `outfit_image_id`, schemas de outfits, y nombres de action (`createCharacterOutfitAction`, `listCharacterOutfitsAction`, `updateCharacterOutfitImageAction`, `deleteCharacterOutfitAction`). Conservar EXACTAMENTE las mismas verificaciones que states hace: ownership del personaje vía workspace, ownership de la imagen (`media_references.workspace_id`), y el firmado de preview. Leer el archivo de states completo antes — no inventar variaciones.

- [ ] **Step 6: typecheck + commit**

Run: `pnpm typecheck`
```bash
git add lib/schemas/character-outfits.ts lib/schemas/character-outfits.test.ts server-actions/character-outfits.ts
git commit -m "feat(cast): CRUD de outfits por personaje (espejo de estados)"
```

---

### Task 3: `full_body_image_id` en el upsert del personaje

**Files:**
- Modify: `server-actions/cast.ts` (UpsertCharacterSchema local + create/update actions)

**Interfaces:**
- Consumes: columna `characters.full_body_image_id` (Task 1); el patrón existente de `masterImageId`/`voiceCloneId` en el MISMO archivo.
- Produces: `createCharacterAction`/`updateCharacterAction` aceptan `fullBodyImageId: string | null | undefined` y lo persisten en `full_body_image_id`.

- [ ] **Step 1: Extender el schema del upsert** — en `server-actions/cast.ts`, el zod local del personaje gana:

```ts
  fullBodyImageId: z.string().uuid().nullish(),
```

- [ ] **Step 2: Ownership + persistencia** — en `createCharacterAction` y `updateCharacterAction`, espejar EXACTAMENTE el manejo de `masterImageId`: validar que la `media_reference` pertenece al workspace (el helper de ownership de imágenes ya existe en el archivo — usarlo igual que con la maestra) y persistir `full_body_image_id: parsed.data.fullBodyImageId ?? null` en el insert/update.

- [ ] **Step 3: typecheck + commit**

Run: `pnpm typecheck`
```bash
git add server-actions/cast.ts
git commit -m "feat(cast): slot de cuerpo completo en el personaje"
```

---

### Task 4: Helpers de generación Nano Banana

**Files:**
- Modify: `components/creation/generate.ts`
- Test: `components/creation/generate.test.ts` (extender)

**Interfaces:**
- Consumes: `editImage`/`editUploaded` y los tipos `GeneratedImage | GenError` ya existentes en el archivo (leer `generateCharacterState`, `:119-130` — es el patrón).
- Produces: `generateFullBody(masterRef: { id: string; storagePath: string }): Promise<GeneratedImage | GenError>` y `generateOutfit(fullBodyRef: { id: string; storagePath: string }, outfit: string): Promise<GeneratedImage | GenError>`.

- [ ] **Step 1: Tests (fallan)** — en `components/creation/generate.test.ts`, siguiendo el patrón de mocks existente del archivo (los tests actuales ya mockean el submit y assertean `call.prompt`):

```ts
describe('generateFullBody', () => {
  it('pide cuerpo completo de la MISMA persona, pose neutra, vestuario visible', async () => {
    // usar el mismo harness de mock del archivo
    await generateFullBody({ id: 'r1', storagePath: 'c/master.png' });
    const call = lastEditCall(); // helper del harness existente
    expect(call.prompt).toMatch(/exact same person/i);
    expect(call.prompt).toMatch(/full-body/i);
    expect(call.prompt).toMatch(/head to shoes/i);
    expect(call.prompt).toMatch(/wardrobe reference/i);
  });
});

describe('generateOutfit', () => {
  it('cambia SOLO la ropa, conserva identidad y pose', async () => {
    await generateOutfit({ id: 'r2', storagePath: 'c/full.png' }, 'a red athletic tracksuit');
    const call = lastEditCall();
    expect(call.prompt).toMatch(/change only the clothing/i);
    expect(call.prompt).toContain('a red athletic tracksuit');
    expect(call.prompt).toMatch(/identical face, hairstyle, build/i);
  });
});
```

(Adaptar `lastEditCall()` al helper real del harness del archivo — leerlo primero; si expone los calls de otra forma, usar esa. No inventar un mock nuevo.)

- [ ] **Step 2: RED** — `pnpm vitest run components/creation/generate.test.ts` → FAIL (funciones no existen).

- [ ] **Step 3: Implementar** (junto a `generateCharacterState`):

```ts
// Cuerpo completo base (specs/v2/16): ancla el vestuario — la maestra es
// head-and-shoulders y no fija la ropa. Identidad EXACTA, pose neutra.
export async function generateFullBody(
  masterRef: { id: string; storagePath: string },
): Promise<GeneratedImage | GenError> {
  const prompt =
    'Show the exact same person standing in a full-body shot from head to shoes, neutral relaxed pose, arms at the sides. ' +
    'Identical face, hairstyle, build and skin; complete their wardrobe in the same style as the clothing visible in the reference. ' +
    'Same soft even lighting and plain background. This is a wardrobe reference: the complete outfit must be clearly visible.';
  return editUploaded(masterRef, prompt);
}

// Outfit (specs/v2/16): variante de vestuario del cuerpo completo base.
// Cambia SOLO la ropa; identidad, pose y encuadre intactos.
export async function generateOutfit(
  fullBodyRef: { id: string; storagePath: string },
  outfit: string,
): Promise<GeneratedImage | GenError> {
  const prompt =
    'Keep the exact same person, pose, framing, lighting and background. ' +
    `Change ONLY the clothing: they now wear ${outfit}. ` +
    'Identical face, hairstyle, build and skin. The complete new outfit must be clearly visible from head to shoes.';
  return editUploaded(fullBodyRef, prompt);
}
```

- [ ] **Step 4: GREEN** — mismo comando, PASS (incluidos los tests previos del archivo).

- [ ] **Step 5: Commit**

```bash
git add components/creation/generate.ts components/creation/generate.test.ts
git commit -m "feat(cast): generación de cuerpo completo y outfits con Nano Banana"
```

---

### Task 5: Threading — contexto de campaña y resolución del outfit

**Files:**
- Modify: `lib/prompt-director/types.ts` (CharacterInventory)
- Modify: `lib/campaigns/orchestrator.ts` (ItemRow, loadCampaignContext, directorContextFor)
- Modify: `lib/campaigns/studio-item.ts` (+ su test)
- Test: `lib/campaigns/director-context.test.ts` (extender)

**Interfaces:**
- Consumes: columnas de Task 1; `CharacterInventory` (`lib/prompt-director/types.ts:70-80`).
- Produces: `CharacterInventory.fullBodyImagePath?: string`; `ctx.characters` entries ganan `fullBodyImagePath?: string` y `outfits?: Array<{ id: string; label: string; path: string }>`; `ItemRow.character_outfit_hint: string | null`; `directorContextFor` resuelve `hint(label) → map(id) → base`.

- [ ] **Step 1: Tests de resolución (fallan)** — en `lib/campaigns/director-context.test.ts`, siguiendo el harness existente del archivo (ya testea `directorContextFor` con fixtures de ctx/item; leerlo y reusar sus builders):

```ts
describe('directorContextFor — resolución de outfit (specs/v2/16)', () => {
  it('sin nada: el personaje no lleva fullBodyImagePath (comportamiento actual)', () => { /* ctx sin full body → characters[0].fullBodyImagePath undefined */ });
  it('con full_body base: viaja como fullBodyImagePath', () => { /* ctx.characters con fullBodyImagePath 'c/full.png' → aparece en el inventario */ });
  it('outfit de campaña (map por id) reemplaza al base', () => { /* outfits [{id:'o1',label:'deportivo',path:'c/o1.png'}] + campaignOutfitMap {charId:'o1'} → fullBodyImagePath 'c/o1.png' */ });
  it('hint del clip (label) gana sobre el map', () => { /* item.character_outfit_hint 'formal' + outfits con ese label → su path */ });
  it('hint huérfano (label inexistente) cae al map y luego al base', () => { /* hint 'no-existe' → path del map; sin map → base */ });
});
```

(Escribir los 5 con los builders reales del archivo — cuerpos completos, sin pseudocódigo, al implementarlos.)

- [ ] **Step 2: RED** — `pnpm vitest run lib/campaigns/director-context.test.ts` → FAIL.

- [ ] **Step 3: types.ts** — en `CharacterInventory` (tras `stateLabel?`):

```ts
  // Vestuario (specs/v2/16): cuerpo completo (base u outfit resuelto) — ancla la
  // ropa y proporciones; la identidad sigue viniendo de masterImagePath.
  fullBodyImagePath?: string;
```

- [ ] **Step 4: orchestrator — carga** — en `loadCampaignContext`:
  - El select de `characters` gana `full_body_image_id`; resolver su path con el MISMO `resolvePaths` que la maestra y setear `fullBodyImagePath` en la entry del Map.
  - Tras el bloque de `character_states` (`:350-363`), cargar `character_outfits` igual (select `id, character_id, label, outfit_image_id`, resolver paths, y setear `ent.outfits = [{ id, label, path }]`).
  - El select de `campaigns` del contexto gana `character_outfit_map`; guardarlo en el ctx como `characterOutfitMap: Record<string, string> | null` (cast con narrowing, sin `any`).

- [ ] **Step 5: orchestrator — resolución** — `ItemRow` gana `character_outfit_hint: string | null` (y TODOS los selects de `campaign_items` que hoy leen `character_state_hint` ganan `character_outfit_hint` — grep, incluye el select del chain en `:718`). En `directorContextFor`, dentro del `.map((c) => {...})` de characters (junto al swap de states, `:418-427`):

```ts
      const outfitHint = (item.character_outfit_hint as string | null) ?? null;
      const charId = /* id de esta entry — el map itera itemCharacterIds(item), usar ese id */;
      const fromHint = outfitHint ? c.outfits?.find((o) => o.label === outfitHint)?.path : undefined;
      const mappedId = ctx.characterOutfitMap?.[charId];
      const fromMap = mappedId ? c.outfits?.find((o) => o.id === mappedId)?.path : undefined;
      const fullBodyImagePath = fromHint ?? fromMap ?? c.fullBodyImagePath;
      // ...en el objeto retornado:
      ...(fullBodyImagePath ? { fullBodyImagePath } : {}),
```

(Nota: el `.map` actual itera sobre entries ya resueltas; reestructurar mínimamente para tener el `id` a mano — `itemCharacterIds(item).map((id) => ({ id, c: ctx.characters.get(id) }))`.)

- [ ] **Step 6: studio-item** — `StudioItem` gana `characterOutfitHint: string | null` y el proyector lo mapea desde `row.character_outfit_hint` (espejo de `characterStateHint`, `studio-item.ts:33,73`). Extender `studio-item.test.ts` con el campo (espejo del assert de state hint existente).

- [ ] **Step 7: GREEN + suite** — `pnpm vitest run lib/campaigns/director-context.test.ts lib/campaigns/studio-item.test.ts && pnpm typecheck` → PASS/limpio.

- [ ] **Step 8: Commit**

```bash
git add lib/prompt-director/types.ts lib/campaigns/orchestrator.ts lib/campaigns/studio-item.ts lib/campaigns/studio-item.test.ts lib/campaigns/director-context.test.ts
git commit -m "feat(cast): resolución de vestuario por clip en el contexto de generación"
```

---

### Task 6: Compiler — cuerpo completo como referencia con cita de vestuario

**Files:**
- Modify: `lib/prompt-director/compilers/seedance.ts` (bucle de characters, `:235-260`)
- Test: `lib/prompt-director/compilers/seedance-references.test.ts` (extender)

**Interfaces:**
- Consumes: `CharacterInventory.fullBodyImagePath` (Task 5); el helper local `pushImage` del compiler (leer su firma exacta en el archivo — la maestra en `:241-247` es el patrón de cita a imitar).
- Produces: el cuerpo completo se empuja rol `character` INMEDIATAMENTE después de la maestra y ANTES de los ángulos (prioridad de presupuesto: con el tope global de 9, los ángulos caen primero).

- [ ] **Step 1: Tests (fallan)** — en `seedance-references.test.ts`:

```ts
describe('buildReferences — cuerpo completo (vestuario, specs/v2/16)', () => {
  it('se empuja tras la maestra con cita de vestuario', () => {
    const { references, lines } = buildReferences(ctxWith({
      characters: [{ name: 'Ana', description: 'd', masterImagePath: 'c/m.jpg', fullBodyImagePath: 'c/full.jpg' }],
    }));
    const charRefs = references.filter((r) => r.role === 'character').map((r) => r.storagePath);
    expect(charRefs).toEqual(['c/m.jpg', 'c/full.jpg']);
    expect(lines.some((l) => l.includes('full-body wardrobe reference'))).toBe(true);
    expect(lines.some((l) => l.includes('exact same clothing'))).toBe(true);
  });

  it('prioridad: el cuerpo completo entra antes que los ángulos', () => {
    const { references } = buildReferences(ctxWith({
      characters: [{
        name: 'Ana', description: 'd', masterImagePath: 'c/m.jpg',
        fullBodyImagePath: 'c/full.jpg', angleImagePaths: ['c/a1.jpg', 'c/a2.jpg'],
      }],
    }));
    const charRefs = references.filter((r) => r.role === 'character').map((r) => r.storagePath);
    expect(charRefs.indexOf('c/full.jpg')).toBeLessThan(charRefs.indexOf('c/a1.jpg'));
  });

  it('sin fullBodyImagePath: cero cambio (regresión)', () => {
    const { references, lines } = buildReferences(ctxWith({
      characters: [{ name: 'Ana', description: 'd', masterImagePath: 'c/m.jpg', angleImagePaths: ['c/a1.jpg'] }],
    }));
    expect(references.filter((r) => r.role === 'character')).toHaveLength(2);
    expect(lines.some((l) => l.includes('wardrobe reference'))).toBe(false);
  });
});
```

- [ ] **Step 2: RED** — `pnpm vitest run lib/prompt-director/compilers/seedance-references.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — en el bucle de characters, después del push de la maestra y ANTES del bucle de ángulos, usando el helper `pushImage` con el mismo mecanismo de cita que la maestra (leer su firma en el archivo; no cambiarla):

Cita exacta (ajustar el interpolado de número al mecanismo del helper):
```
@image{N} is {name}'s full-body wardrobe reference — keep this exact same clothing, silhouette and body proportions in every shot; identity (face and hair) comes from the previous reference.
```

- [ ] **Step 4: Verificación cruzada de caminos** — confirmar por lectura (y citar file:line en el reporte) que el cuerpo completo fluye SOLO por entrar al inventario: (a) paneles — `lib/campaigns/storyboard.ts:194` filtra `role === 'character'`; (b) storyboard R2V — de dónde salen `storyboardCastRefs` en `orchestrator.ts` (~1080) y que incluyen las refs `character` del compile con `onlyCharacterRefs`. Si algún camino NO lo recibe, reportarlo como DONE_WITH_CONCERNS con el sitio exacto — NO cablearlo por fuera sin consultar.

- [ ] **Step 5: GREEN + suite del compiler** — `pnpm vitest run lib/prompt-director/compilers/seedance-references.test.ts lib/prompt-director/prompt-director.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/compilers/seedance.ts lib/prompt-director/compilers/seedance-references.test.ts
git commit -m "feat(prompt-director): cuerpo completo como referencia de vestuario tras la maestra"
```

---

### Task 7: UI del Cast — cuerpo completo + outfits en el editor

**Files:**
- Modify: `components/cast/CastPage.tsx`
- Modify: `app/app/brand/cast/page.tsx` (select + prop de full body)

**Interfaces:**
- Consumes: actions de Task 2 (`createCharacterOutfitAction`, `listCharacterOutfitsAction`, `updateCharacterOutfitImageAction`, `deleteCharacterOutfitAction`), `fullBodyImageId` del upsert (Task 3), `generateFullBody`/`generateOutfit` (Task 4). La sección de ESTADOS del mismo archivo (`CastPage.tsx:170-280` estado + `:520-600` JSX) es el patrón a espejar.
- Produces: el editor del personaje permite (a) fijar cuerpo completo subiendo o generando desde la maestra; (b) crear/listar/refinar/borrar outfits (label + imagen, subiendo o generando desde el cuerpo completo).

- [ ] **Step 1: Datos del server component** — en `app/app/brand/cast/page.tsx`: el select de `characters` gana `full_body_image_id`; `CastCharacter` gana `full_body_image_id: string | null`; incluir su preview en el mapa `previews` (mismo mecanismo `signedReferenceUrl` que maestra/ángulos).

- [ ] **Step 2: Sección "Cuerpo completo" en el editor** — en `CharacterEditor` (CastPage.tsx), debajo de los ángulos de consistencia: preview de la imagen actual (o vacío con hint "Ancla el vestuario para que no cambie entre clips"), botón subir (mismo uploader/flujo que la maestra → `media_reference` → `setFullBodyImageId`) y botón "Generar desde la maestra" (deshabilitado sin maestra; llama `generateFullBody` con el path de la maestra vía `getReferencePathsAction`, luego `addGenerationAsReferenceAction` — flujo idéntico al de generar estado en el mismo archivo). Incluir `fullBodyImageId` en el payload del save (junto a `voiceCloneId`).

- [ ] **Step 3: Sección "Vestuarios" en el editor** — espejo de la sección de estados (`:217-280` + su JSX): lista con label + preview + refinar + borrar; formulario de alta con label + (subir imagen | generar con `generateOutfit(fullBodyRef, descripcion)` — deshabilitado sin cuerpo completo base, con hint "Genera primero el cuerpo completo"). Costo en créditos visible en los botones de generar (patrón del archivo).

- [ ] **Step 4: typecheck + build** — `pnpm typecheck && pnpm build` → limpio (no hay unit test de componentes en el repo; el gate es build).

- [ ] **Step 5: Commit**

```bash
git add components/cast/CastPage.tsx app/app/brand/cast/page.tsx
git commit -m "feat(ui): cuerpo completo y vestuarios en el editor del personaje"
```

---

### Task 8: Selección — wizard (por campaña) + override (por clip)

**Files:**
- Modify: `lib/schemas/campaigns.ts` (CreateCampaignStudioSchema + UpdateCampaignItemSchema)
- Modify: `server-actions/campaigns.ts` (createCampaignStudioAction insert + validación; updateCampaignItemAction persist)
- Modify: `components/campaigns/CampaignStudioWizard.tsx` (dropdown por personaje seleccionado)
- Modify: la página que monta el wizard (localizar con grep `CampaignStudioWizard` en `app/`) — cargar outfits por personaje
- Modify: `components/campaigns/CampaignStudioView.tsx` (override, espejo de `characterStateHint` en `:2127-2240`)

**Interfaces:**
- Consumes: `character_outfit_map`/`character_outfit_hint` (Task 1), `characterOutfitHint` en StudioItem (Task 5).
- Produces: `CreateCampaignStudioSchema.characterOutfitMap?: Record<string,string>`; `UpdateCampaignItemSchema.characterOutfitHint?: string | null`; el wizard persiste el map; el editor del clip persiste el hint.

- [ ] **Step 1: Schemas** — en `lib/schemas/campaigns.ts`:

```ts
  // En CreateCampaignStudioSchema (antes de los .refine):
  // Vestuario por campaña (specs/v2/16): { characterId: outfitId }. Solo
  // personajes del pool; ownership del outfit se valida en la action.
  characterOutfitMap: z.record(z.string().uuid(), z.string().uuid()).optional(),
```
```ts
  // En UpdateCampaignItemSchema (junto a characterStateHint):
  // Vestuario: override por clip, por LABEL. null = el de campaña.
  characterOutfitHint: z.string().trim().nullable().optional(),
```

- [ ] **Step 2: Action de creación** — en `createCampaignStudioAction`: si viene `characterOutfitMap`, (a) filtrar las claves a `characterIds` del pool; (b) validar en UNA query que cada `outfitId` existe en `character_outfits` con ese `character_id` y `workspace_id` (descartar en silencio los que no — defensa, no error); (c) persistir `character_outfit_map` en el insert.

- [ ] **Step 3: Action de item** — en `updateCampaignItemAction`: espejar EXACTAMENTE el manejo de `characterStateHint` (mismo gate de estados de producción) para `characterOutfitHint` → `character_outfit_hint`.

- [ ] **Step 4: Wizard** — en la página que monta el wizard: cargar los outfits de los personajes (`character_outfits` select `id, label, character_id`) y pasarlos como `outfits: Array<{ id; label; characterId }>`. En `CampaignStudioWizard`: estado `const [outfitMap, setOutfitMap] = useState<Record<string, string>>({})`; bajo la grid de personajes, por cada personaje SELECCIONADO que tenga outfits, un `<Select>` "Vestuario de {name}: Base / {labels}" que setea/borra la entry; pasar `...(Object.keys(outfitMap).length ? { characterOutfitMap: outfitMap } : {})` a `createCampaignStudioAction`.

- [ ] **Step 5: Override en el clip** — en `CampaignStudioView.tsx`, espejo del bloque `characterStateHint` (`:2127`, `:2139`, `:2163`, `:2231`): estado `characterOutfitHint`, mismo dirty-check, mismo payload, y un `<select>` con los labels de outfits de los personajes del clip (los labels llegan por la misma vía por la que llegan los labels de estados a ese dropdown — leer cómo lo hace states en ese archivo y espejarlo; si states los recibe por props del server component, extender esa misma prop con los outfits).

- [ ] **Step 6: typecheck + build + commit**

Run: `pnpm typecheck && pnpm build`
```bash
git add lib/schemas/campaigns.ts server-actions/campaigns.ts components/campaigns/CampaignStudioWizard.tsx components/campaigns/CampaignStudioView.tsx app/app/campaigns
git commit -m "feat(campaigns): vestuario por campaña con override por clip"
```

---

### Task 9: Verificación final

- [ ] **Step 1: Suite completa** — `pnpm typecheck && pnpm build && pnpm vitest run` → todo verde; los tests de `character_states` (P05) intactos sin modificar.
- [ ] **Step 2: Confirmar migración aplicada** (Task 1 Step 2-3) antes de cualquier push.
- [ ] **Step 3: Smoke manual (usuario, API real)** — crear cuerpo completo + 2 outfits de un personaje; campaña eligiendo un outfit; regenerar los paneles del storyboard que drifteaban y comparar consistencia de ropa; un clip con override de outfit distinto.
- [ ] **Step 4: Push** — `git push origin feat/ingesta-prompt-maestro`.

---

## Self-Review

**Spec coverage:** migración 059 → T1; CRUD outfits + RLS → T1/T2; full_body en upsert → T3; crear imágenes (subir/generar) → T4/T7; resolución hint→map→base → T5; compiler + cita + prioridad presupuesto → T6; tres caminos → T6 Step 4 (verificación explícita); wizard + override → T8; guardas (huérfano cae a base → T5 test; sin cuerpo completo cero regresión → T5/T6 tests; ownership → T2/T3/T8); states intactos → constraint global + T9. Sin huecos.

**Placeholder scan:** T5 Step 1 y T7/T8 usan "espejo de X en file:line" con el código NUEVO explícito y los anclajes exactos — el patrón de referencia existe en el mismo archivo que editan; no hay TBD/TODO. La firma de `pushImage` se manda a leer en vez de adivinarla (T6), con la cita exacta dada.

**Type consistency:** `fullBodyImagePath` (inventory/ctx), `character_outfit_map`/`characterOutfitMap`, `character_outfit_hint`/`characterOutfitHint`, `outfits: Array<{id,label,path}>` (ctx) vs `{id,label,characterId}` (prop del wizard — distinto uso, nombres distintos a propósito) — consistentes entre T1/T5/T6/T8.
