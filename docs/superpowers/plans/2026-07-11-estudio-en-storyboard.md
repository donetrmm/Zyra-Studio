# Estudio creativo dentro de storyboards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el refinar conversacional de paneles de storyboard por el estudio creativo, agregando `panel` como cuarto `assetType` del estudio; el usuario abre un panel en `/app/studio/panel/[itemId]`, lo edita con el chat completo y "Usar como panel" ancla el resultado al beat.

**Architecture:** El estudio ya es agnóstico al tipo de activo (worker + `submitStudioTurnAction`). Se abre el único punto cableado a los 3 activos (`asset_type`: enum Zod, CHECK de DB, `ownsAsset`, loader, "adjuntar") para admitir `panel`, con `asset_id = campaign_item.id`. La entrada/salida reusa el patrón del storyboard (`promoteOutputToReference` + columnas `storyboard_image_id`/`storyboard_generation_id`). Se elimina `refinePanelAction` y su UI.

**Tech Stack:** Next.js 15 (App Router, RSC + server actions), Supabase (Postgres + RLS), Zod, Vitest, TypeScript. Todo por el Vercel AI Gateway (`AI_GATEWAY_API_KEY`).

## Global Constraints

- **Sin `any`** en TypeScript: `unknown` + narrowing o tipo explícito.
- **`'use server'` no exporta no-funciones**: en `server-actions/*.ts` NO exportar consts/tipos/objetos — rompe en prod aunque typecheck/lint pasen. `pnpm build` es obligatorio (no solo typecheck).
- **Créditos siempre vía funciones SQL atómicas** (`reserveCredits`/`failGeneration`); nunca tocar `credit_balances`/`credit_transactions` directo.
- **URLs de proveedor nunca al cliente**: el estudio guarda a Supabase; el cliente arma URLs internas.
- **Orden migración→push**: la migración 063 se aplica vía MCP ANTES de desplegar el código que lee `asset_type='panel'` (si no, 500 en prod).
- **Tests sin APIs reales**: unidades puras deterministas; los smokes con API real los corre el usuario.
- **No emojis en código/UI.** Dark mode, acento `#009fff`. Componentes shadcn primero.
- **Commits sin `Co-Authored-By`.** Conventional Commits en español, imperativo, ≤70 chars la primera línea.
- Gestor de paquetes: **pnpm** (`pnpm vitest`, `pnpm typecheck`, `pnpm build`).

## File Structure

- `lib/schemas/studio.ts` (mod) — `StudioAssetTypeSchema` gana `'panel'`; nuevo `UsePanelFromStudioSchema`.
- `components/studio/types.ts` (mod) — `StudioAssetType` gana `'panel'`; variante `panel` de `StudioAssetImages`; `StudioClientProps` gana `initialWorkingId`, `initialPrompt`, `backHref`.
- `supabase/migrations/063_studio_panel_assettype.sql` (nuevo) — extiende el CHECK de `studio_sessions.asset_type`.
- `lib/studio/panel-asset.ts` (nuevo) — `buildPanelAssetImages` (pura) + `loadPanelAsset` (server).
- `lib/studio/asset-images.ts` (mod) — rama `panel` en `imageIdsFromAssetImages`.
- `server-actions/studio.ts` (mod) — `ownsAsset` admite `panel`.
- `server-actions/storyboard.ts` (mod) — `usePanelFromStudioAction` (nueva); ELIMINAR `refinePanelAction`, `MAX_REFINE_TURNS` e imports muertos.
- `app/app/studio/[assetType]/[assetId]/page.tsx` (mod) — admite `panel`, usa `loadPanelAsset`, siembra base/prompt/aspecto/back.
- `components/studio/StudioClient.tsx` (mod) — `initialWorkingId`; acción de galería "Usar como panel" en modo panel.
- `components/studio/Composer.tsx` (mod) — prop `initialPrompt` (prefill) y `defaultAspect`.
- `components/studio/SessionHeader.tsx` (mod) — back link a storyboard en modo panel.
- `components/campaigns/StoryboardView.tsx` (mod) — botón "Abrir en estudio"; ELIMINAR UI/estado/handler del refinar.

---

### Task 1: Fundación — tipos, schema Zod y migración

**Files:**
- Modify: `lib/schemas/studio.ts`
- Modify: `components/studio/types.ts`
- Create: `supabase/migrations/063_studio_panel_assettype.sql`
- Test: `lib/schemas/studio.test.ts`

**Interfaces:**
- Produces: `StudioAssetType = 'product' | 'location' | 'character' | 'panel'`; variante `{ assetType: 'panel'; name; panelImageId; cleanReferenceIds; scenePrompt; aspectRatio }` de `StudioAssetImages`.

- [ ] **Step 1: Escribir el test que falla** (append a `lib/schemas/studio.test.ts`)

```typescript
import { CreateStudioSessionSchema } from './studio';

describe('CreateStudioSessionSchema — panel', () => {
  it('acepta assetType "panel"', () => {
    const res = CreateStudioSessionSchema.safeParse({
      assetType: 'panel',
      assetId: '00000000-0000-0000-0000-000000000001',
    });
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run lib/schemas/studio.test.ts`
Expected: FAIL (`'panel'` no está en el enum → `success` es `false`).

- [ ] **Step 3: Agregar `panel` al enum Zod** (`lib/schemas/studio.ts`, línea 4)

```typescript
export const StudioAssetTypeSchema = z.enum(['product', 'location', 'character', 'panel']);
```

- [ ] **Step 4: Agregar el tipo y la variante en `components/studio/types.ts`**

Reemplazar la línea 54 (`export type StudioAssetType = 'product' | 'location' | 'character';`) por:

```typescript
export type StudioAssetType = 'product' | 'location' | 'character' | 'panel';
```

Y agregar la variante `panel` al union `StudioAssetImages` (después de la variante `character`, antes del `;` de cierre en la línea 52):

```typescript
  | {
      assetType: 'panel';
      // Etiqueta del beat (p. ej. "Panel 3") para el header del estudio.
      name: string;
      // media_reference del panel vigente (null = beat sin panel todavía).
      panelImageId: string | null;
      // Refs limpias del beat (producto/personaje/locación) + el panel actual,
      // ofrecibles como referencia en el compositor. Dedup, sin null.
      cleanReferenceIds: string[];
      // Guion del beat, precargado como pista editable en el compositor.
      scenePrompt: string;
      // Aspecto del beat (default del compositor para consistencia con el video).
      aspectRatio: string | null;
    };
```

- [ ] **Step 5: Crear la migración 063** (`supabase/migrations/063_studio_panel_assettype.sql`)

```sql
-- 063 Estudio de paneles de storyboard: admite asset_type='panel' en studio_sessions.
-- Idempotente. NO se aplica dentro de las tareas; el controller la aplica vía MCP
-- ANTES de desplegar el código que lee el tipo nuevo (orden migración→push).
alter table studio_sessions drop constraint if exists studio_sessions_asset_type_check;
alter table studio_sessions add constraint studio_sessions_asset_type_check
  check (asset_type in ('product', 'location', 'character', 'panel'));
```

- [ ] **Step 6: Correr test + typecheck**

Run: `pnpm vitest run lib/schemas/studio.test.ts && pnpm typecheck`
Expected: test PASS. Typecheck: aparecerán errores en `server-actions/studio.ts` (`ASSET_TABLE` ya no cubre todos los `StudioAssetType`) y en `imageIdsFromAssetImages`/`loadStudioAsset` (union no exhaustivo). **Es esperado** — se resuelven en Tasks 2 y 3. Confirmar que NO hay más errores fuera de esos archivos.

- [ ] **Step 7: Commit**

```bash
git add lib/schemas/studio.ts components/studio/types.ts supabase/migrations/063_studio_panel_assettype.sql lib/schemas/studio.test.ts
git commit -m "feat(estudio): agrega panel como assetType (schema, tipos, migracion 063)"
```

---

### Task 2: Proyección pura del panel + imageIds

**Files:**
- Create: `lib/studio/panel-asset.ts`
- Modify: `lib/studio/asset-images.ts`
- Test: `lib/studio/panel-asset.test.ts`

**Interfaces:**
- Consumes: variante `panel` de `StudioAssetImages` (Task 1).
- Produces: `buildPanelAssetImages(input: PanelAssetInput): Extract<StudioAssetImages, { assetType: 'panel' }>`; `imageIdsFromAssetImages` cubre `panel`.

```typescript
export type PanelAssetInput = {
  name: string;
  panelImageId: string | null;
  beatReferenceIds: string[]; // producto/personaje/locación (media_reference ids)
  scenePrompt: string;
  aspectRatio: string | null;
};
```

- [ ] **Step 1: Escribir el test que falla** (`lib/studio/panel-asset.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { buildPanelAssetImages } from './panel-asset';
import { imageIdsFromAssetImages } from './asset-images';

describe('buildPanelAssetImages', () => {
  it('junta el panel + refs del beat, dedup y sin null', () => {
    const out = buildPanelAssetImages({
      name: 'Panel 2',
      panelImageId: 'p1',
      beatReferenceIds: ['r1', 'p1', 'r2'], // p1 duplica el panel
      scenePrompt: 'una escena',
      aspectRatio: '9:16',
    });
    expect(out.assetType).toBe('panel');
    expect(out.name).toBe('Panel 2');
    expect(out.panelImageId).toBe('p1');
    expect(out.cleanReferenceIds).toEqual(['p1', 'r1', 'r2']);
    expect(out.scenePrompt).toBe('una escena');
    expect(out.aspectRatio).toBe('9:16');
  });

  it('panel null: cleanReferenceIds son solo las refs del beat', () => {
    const out = buildPanelAssetImages({
      name: 'Panel 1',
      panelImageId: null,
      beatReferenceIds: ['r1', 'r1', 'r2'],
      scenePrompt: '',
      aspectRatio: null,
    });
    expect(out.panelImageId).toBeNull();
    expect(out.cleanReferenceIds).toEqual(['r1', 'r2']);
  });
});

describe('imageIdsFromAssetImages — panel', () => {
  it('devuelve cleanReferenceIds', () => {
    const ids = imageIdsFromAssetImages({
      assetType: 'panel',
      name: 'Panel 1',
      panelImageId: 'p1',
      cleanReferenceIds: ['p1', 'r1'],
      scenePrompt: '',
      aspectRatio: null,
    });
    expect(ids).toEqual(['p1', 'r1']);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm vitest run lib/studio/panel-asset.test.ts`
Expected: FAIL (`buildPanelAssetImages` no existe).

- [ ] **Step 3: Crear `lib/studio/panel-asset.ts` con la función pura**

```typescript
import 'server-only';
import type { StudioAssetImages } from '@/components/studio/types';

export type PanelAssetInput = {
  name: string;
  panelImageId: string | null;
  beatReferenceIds: string[];
  scenePrompt: string;
  aspectRatio: string | null;
};

// Arma la variante 'panel' de StudioAssetImages. cleanReferenceIds = el panel
// actual (si existe) primero, luego las refs limpias del beat, dedup y sin null,
// preservando el orden. El panel va primero para que, en un panel subido a mano
// (sin generación base), siga a mano en el selector de referencias.
export function buildPanelAssetImages(
  input: PanelAssetInput,
): Extract<StudioAssetImages, { assetType: 'panel' }> {
  const ordered = [
    ...(input.panelImageId ? [input.panelImageId] : []),
    ...input.beatReferenceIds,
  ];
  const cleanReferenceIds = [...new Set(ordered)];
  return {
    assetType: 'panel',
    name: input.name,
    panelImageId: input.panelImageId,
    cleanReferenceIds,
    scenePrompt: input.scenePrompt,
    aspectRatio: input.aspectRatio,
  };
}
```

- [ ] **Step 4: Agregar la rama `panel` en `imageIdsFromAssetImages`** (`lib/studio/asset-images.ts`, dentro de la función, antes del `return` de character en la línea ~89)

```typescript
  if (a.assetType === 'panel') return a.cleanReferenceIds;
```

- [ ] **Step 5: Correr el test**

Run: `pnpm vitest run lib/studio/panel-asset.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/studio/panel-asset.ts lib/studio/asset-images.ts lib/studio/panel-asset.test.ts
git commit -m "feat(estudio): proyeccion pura del panel a StudioAssetImages"
```

---

### Task 3: `loadPanelAsset` (server) + `ownsAsset('panel')`

**Files:**
- Modify: `lib/studio/panel-asset.ts` (agrega `loadPanelAsset`)
- Modify: `server-actions/studio.ts` (`ownsAsset` admite `panel`)

**Interfaces:**
- Consumes: `buildPanelAssetImages` (Task 2).
- Produces: `loadPanelAsset(supabase, workspaceId, itemId): Promise<PanelAssetLoad | null>`.

```typescript
export type PanelAssetLoad = {
  assetImages: Extract<StudioAssetImages, { assetType: 'panel' }>;
  name: string;
  campaignId: string;
  // Base de edición del primer turno (gen del panel vigente); null si el panel
  // se subió a mano (sin generación) o no hay panel.
  workingGenerationId: string | null;
  scenePrompt: string;
  aspectRatio: string | null;
};
```

- [ ] **Step 1: Agregar `loadPanelAsset` en `lib/studio/panel-asset.ts`**

```typescript
import type { createClient } from '@/lib/supabase/server';

type StudioSupabase = Awaited<ReturnType<typeof createClient>>;

export type PanelAssetLoad = {
  assetImages: Extract<StudioAssetImages, { assetType: 'panel' }>;
  name: string;
  campaignId: string;
  workingGenerationId: string | null;
  scenePrompt: string;
  aspectRatio: string | null;
};

// Carga un beat (campaign_item) como "activo panel" del estudio, validando que la
// campaña sea del workspace. Reúne las refs LIMPIAS del beat como media_reference
// ids directamente de las entidades (producto/personaje/locación): no re-corre la
// resolución completa del generador de panel — es seeding de conveniencia, no la
// compilación. El panel vigente sale de storyboard_image_id.
export async function loadPanelAsset(
  supabase: StudioSupabase,
  workspaceId: string,
  itemId: string,
): Promise<PanelAssetLoad | null> {
  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, scene_index, scene_prompt, aspect_ratio, character_id, character_ids, location_id, product_id, storyboard_image_id, storyboard_generation_id')
    .eq('id', itemId)
    .maybeSingle();
  if (!item) return null;

  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, workspace_id')
    .eq('id', item.campaign_id as string)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!camp) return null;

  const beatReferenceIds: string[] = [];

  // Producto de ESTE clip (si tiene product_id): imágenes + empaque.
  if (item.product_id) {
    const { data: product } = await supabase
      .from('products')
      .select('product_image_ids, packaging_image_ids')
      .eq('id', item.product_id as string)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (product) {
      beatReferenceIds.push(...((product.product_image_ids as string[] | null) ?? []));
      beatReferenceIds.push(...((product.packaging_image_ids as string[] | null) ?? []));
    }
  }

  // Personajes: maestra + ángulos + cuerpo completo (masters limpios para re-anclar).
  const characterIds: string[] = (item.character_ids as string[] | null)?.length
    ? (item.character_ids as string[]).slice(0, 3)
    : item.character_id
      ? [item.character_id as string]
      : [];
  if (characterIds.length > 0) {
    const { data: chars } = await supabase
      .from('characters')
      .select('master_image_id, angle_image_ids, full_body_image_id')
      .in('id', characterIds)
      .eq('workspace_id', workspaceId);
    for (const ch of chars ?? []) {
      if (ch.master_image_id) beatReferenceIds.push(ch.master_image_id as string);
      beatReferenceIds.push(...((ch.angle_image_ids as string[] | null) ?? []));
      if (ch.full_body_image_id) beatReferenceIds.push(ch.full_body_image_id as string);
    }
  }

  // Locación: maestra + referencias.
  if (item.location_id) {
    const { data: loc } = await supabase
      .from('locations')
      .select('master_image_id, reference_image_ids')
      .eq('id', item.location_id as string)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (loc) {
      if (loc.master_image_id) beatReferenceIds.push(loc.master_image_id as string);
      beatReferenceIds.push(...((loc.reference_image_ids as string[] | null) ?? []));
    }
  }

  const name = `Panel ${((item.scene_index as number | null) ?? 0) + 1}`;
  const assetImages = buildPanelAssetImages({
    name,
    panelImageId: (item.storyboard_image_id as string | null) ?? null,
    beatReferenceIds,
    scenePrompt: (item.scene_prompt as string | null) ?? '',
    aspectRatio: (item.aspect_ratio as string | null) ?? null,
  });

  return {
    assetImages,
    name,
    campaignId: item.campaign_id as string,
    workingGenerationId: (item.storyboard_generation_id as string | null) ?? null,
    scenePrompt: (item.scene_prompt as string | null) ?? '',
    aspectRatio: (item.aspect_ratio as string | null) ?? null,
  };
}
```

- [ ] **Step 2: Extender `ownsAsset` para `panel`** (`server-actions/studio.ts`)

Cambiar el tipo de `ASSET_TABLE` (línea 58) para excluir `panel` (así el índice sigue tipando y `panel` se maneja aparte):

```typescript
const ASSET_TABLE: Record<Exclude<StudioAssetType, 'panel'>, 'products' | 'locations' | 'characters'> = {
  product: 'products',
  location: 'locations',
  character: 'characters',
};
```

Y al inicio del cuerpo de `ownsAsset` (después de la firma, antes del `const { data } = ...` de la línea 75), agregar la rama panel:

```typescript
  if (assetType === 'panel') {
    const { data: item } = await supabase
      .from('campaign_items')
      .select('campaign_id')
      .eq('id', assetId)
      .maybeSingle();
    if (!item) return false;
    const { data: camp } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', item.campaign_id as string)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    return Boolean(camp);
  }
```

- [ ] **Step 3: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. (Si `loadStudioAsset` en `asset-images.ts` marca union no-exhaustivo por la variante `panel`, NO es consumidor de panel — el page usará `loadPanelAsset`; `loadStudioAsset` solo se llama para los 3 activos. TypeScript no exige exhaustividad en un `if/return` sin `never`; confirmar que compila. Si hubiera un `switch` exhaustivo, agregar `case 'panel': return null;`.)

- [ ] **Step 4: Commit**

```bash
git add lib/studio/panel-asset.ts server-actions/studio.ts
git commit -m "feat(estudio): loadPanelAsset y ownership de panel por campana"
```

---

### Task 4: Ruta `/app/studio/panel/[itemId]` + seeding del cliente

**Files:**
- Modify: `app/app/studio/[assetType]/[assetId]/page.tsx`
- Modify: `components/studio/types.ts` (props nuevos de `StudioClientProps`)
- Modify: `components/studio/StudioClient.tsx` (`initialWorkingId`, pasar prompt/aspecto/back)
- Modify: `components/studio/Composer.tsx` (`initialPrompt`, `defaultAspect`)
- Modify: `components/studio/SessionHeader.tsx` (back link a storyboard)

**Interfaces:**
- Consumes: `loadPanelAsset` (Task 3), `imageIdsFromAssetImages` (Task 2).
- Produces: `StudioClientProps` gana `initialWorkingId?: string | null`, `initialPrompt?: string`, `backHref?: string`.

- [ ] **Step 1: Ampliar `StudioClientProps`** (`components/studio/types.ts`, dentro de `StudioClientProps`)

```typescript
  // Base de edición inicial cuando la sesión aún no tiene turnos (modo panel: la
  // generación del panel vigente). Si hay turnos done, gana el último.
  initialWorkingId?: string | null;
  // Prompt precargado en el compositor (modo panel: el scene_prompt del beat).
  initialPrompt?: string;
  // Link "volver" del header (modo panel: al storyboard de la campaña).
  backHref?: string;
```

- [ ] **Step 2: Ampliar el page para admitir `panel`** (`app/app/studio/[assetType]/[assetId]/page.tsx`)

Reemplazar la línea 22:

```typescript
const ASSET_TYPES: StudioAssetType[] = ['product', 'location', 'character', 'panel'];
```

Importar el loader de panel (junto a los imports existentes de `@/lib/studio/asset-images`):

```typescript
import { loadPanelAsset } from '@/lib/studio/panel-asset';
```

Reemplazar el bloque de carga del activo (líneas 44-52, desde `const loaded = await loadStudioAsset(...)` hasta el cálculo de `characterHasMaster`) por una rama que soporte panel:

```typescript
  let assetName: string;
  let assetImages;
  let characterHasMaster = false;
  let initialWorkingId: string | null = null;
  let initialPrompt = '';
  let defaultAspect: string | null = null;
  let backHref: string | undefined;

  if (type === 'panel') {
    const panel = await loadPanelAsset(supabase, workspace.id, assetId);
    if (!panel) notFound();
    assetName = panel.name;
    assetImages = panel.assetImages;
    initialWorkingId = panel.workingGenerationId;
    initialPrompt = panel.scenePrompt;
    defaultAspect = panel.aspectRatio;
    backHref = `/app/campaigns/${panel.campaignId}/storyboard`;
  } else {
    const loaded = await loadStudioAsset(supabase, workspace.id, type, assetId);
    if (!loaded) notFound();
    assetName = loaded.name;
    assetImages = loaded.assetImages;
    characterHasMaster =
      assetImages.assetType === 'character' ? assetImages.masterImageId !== null : false;
  }

  const imageIds = imageIdsFromAssetImages(assetImages);
```

Pasar los props nuevos al `<StudioClient />` (en el JSX del `return`, junto a los existentes):

```tsx
      initialWorkingId={initialWorkingId}
      initialPrompt={initialPrompt}
      backHref={backHref}
```

Nota: `defaultAspect` se pasa al Composer vía StudioClient en el Step 4 (StudioClient reenvía `props.initialPrompt` y decide el aspecto por defecto). Para no ensanchar props de más, el aspecto por defecto del compositor en modo panel se deriva de `initialPrompt`/beat en StudioClient (Step 4). Si el Composer necesita el aspecto explícito, agregarlo como prop análogo (`defaultAspect`) y pasarlo aquí.

- [ ] **Step 3: Seeding en `StudioClient`** (`components/studio/StudioClient.tsx`)

Cambiar el inicializador de `workingId` (línea 24-27) para caer a `initialWorkingId`:

```typescript
  const [workingId, setWorkingId] = useState<string | null>(() => {
    const lastDone = [...props.initialItems].reverse().find((i) => i.status === 'done');
    return lastDone?.id ?? props.initialWorkingId ?? null;
  });
```

Pasar `initialPrompt` al `Composer` (en el JSX del Composer, ~línea 185):

```tsx
          <Composer
            /* ...props existentes... */
            initialPrompt={props.initialPrompt}
          />
```

Pasar `backHref` al `SessionHeader` (~línea 136):

```tsx
      <SessionHeader
        /* ...props existentes... */
        backHref={props.backHref}
      />
```

- [ ] **Step 4: `Composer` acepta `initialPrompt`** (`components/studio/Composer.tsx`)

Agregar `initialPrompt?: string` a las props del Composer, e inicializar el estado del textarea con él (buscar el `useState` del prompt/texto y usar `?? ''` con `initialPrompt`). Ejemplo del patrón (adaptar al nombre real del estado del Composer):

```typescript
  const [text, setText] = useState(props.initialPrompt ?? '');
```

El prompt precargado es editable y no fuerza nada — el usuario lo borra/edita libremente. El `seed` (reintentar) sigue funcionando igual.

- [ ] **Step 5: `SessionHeader` back link** (`components/studio/SessionHeader.tsx`)

Agregar `backHref?: string` a las props. Donde el header muestra el nombre/volver del activo, si `backHref` está presente usarlo como destino del "volver" (link a `backHref`); si no, conservar el comportamiento actual (volver a la biblioteca del activo). En modo panel, el label puede decir el `assetName` ("Panel N") tal cual.

- [ ] **Step 6: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/app/studio components/studio/types.ts components/studio/StudioClient.tsx components/studio/Composer.tsx components/studio/SessionHeader.tsx
git commit -m "feat(estudio): ruta y seeding del estudio para paneles de storyboard"
```

---

### Task 5: `usePanelFromStudioAction` — aplicar el resultado al panel

**Files:**
- Modify: `server-actions/storyboard.ts` (nueva action; NO tocar aún el refinar)

**Interfaces:**
- Consumes: `promoteOutputToReference` (`lib/supabase/storage.ts`), `loadItemAndCampaign` (interno de storyboard.ts).
- Produces: `usePanelFromStudioAction(itemId: string, generationId: string): Promise<Result<{ applied: true }>>`.

Racional del "stamp": el historial de versiones (`app/app/campaigns/[id]/storyboard/page.tsx:137`) y `restorePanelVersionAction` reconocen una versión por `generations.campaign_id = campaña` + `params->storyboard->>campaignItemId = itemId`. Un turno del estudio no los trae, así que al aplicarlo se estampan ambos → el panel aplicado aparece en Versiones y es restaurable, sin caso especial.

- [ ] **Step 1: Agregar imports en `server-actions/storyboard.ts`**

En el import de `@/lib/supabase/storage` (línea 29) sumar `promoteOutputToReference`:

```typescript
import { uploadReference, downloadReferenceBuffer, promoteOutputToReference } from '@/lib/supabase/storage';
```

- [ ] **Step 2: Agregar la action al final de `server-actions/storyboard.ts`**

```typescript
// ─── acción: usar un resultado del estudio como panel del beat ────────────────

// El estudio de panel produce turnos normales (generations con studio_session_id).
// "Usar como panel" toma el turno elegido, promueve su output a media_references y
// ancla el beat (storyboard_image_id/_generation_id) — igual que promoteStoryboardPanel.
// Además ESTAMPA la generación (campaign_id + params.storyboard.campaignItemId) para
// que aparezca en el historial de versiones y sea restaurable. Idempotente: si el
// output ya se promovió (media_reference con ese source_generation_id), reusa esa ref.
export async function usePanelFromStudioAction(
  itemId: string,
  generationId: string,
): Promise<Result<{ applied: true }>> {
  if (!itemId || !generationId) {
    return { ok: false, error: 'validation_error', message: 'itemId y generationId requeridos' };
  }

  const { user, workspace } = await requireWorkspace();
  const loaded = await loadItemAndCampaign(workspace.id, itemId);
  if (!loaded) return { ok: false, error: 'not_found' };
  const { item } = loaded;

  const supabase = await createClient();
  const { data: gen } = await supabase
    .from('generations')
    .select('id, workspace_id, status, output_url, studio_session_id')
    .eq('id', generationId)
    .single();
  const g = gen as
    | { id: string; workspace_id: string; status: string; output_url: string | null; studio_session_id: string | null }
    | null;
  if (!g || g.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };
  if (g.status !== 'done' || !g.output_url) {
    return { ok: false, error: 'forbidden', message: 'La generación no está lista' };
  }

  // Defensa: el turno debe venir del estudio de ESTE panel (sesión panel + asset_id).
  if (!g.studio_session_id) {
    return { ok: false, error: 'forbidden', message: 'La generación no es un turno del estudio' };
  }
  const { data: sess } = await supabase
    .from('studio_sessions')
    .select('id')
    .eq('id', g.studio_session_id)
    .eq('workspace_id', workspace.id)
    .eq('asset_type', 'panel')
    .eq('asset_id', itemId)
    .maybeSingle();
  if (!sess) {
    return { ok: false, error: 'forbidden', message: 'La generación no pertenece al estudio de este panel' };
  }

  // Promote idempotente: reusar la media_reference existente de esta gen si ya
  // fue aplicada antes (evita duplicar objeto en storage al reaplicar).
  const { data: existingRefs } = await supabase
    .from('media_references')
    .select('id')
    .eq('source_generation_id', generationId)
    .limit(1);
  let refId = (existingRefs?.[0] as { id: string } | undefined)?.id ?? null;
  if (!refId) {
    try {
      refId = await promoteOutputToReference(workspace.id, user.id, g.output_url, generationId);
    } catch (err) {
      return { ok: false, error: 'internal_error', message: (err as Error)?.message ?? 'promote fallo' };
    }
  }

  // Estampar la gen para el historial de versiones (merge preservando params del
  // turno). Admin: mismo criterio que promote (ownership ya validado arriba).
  const admin = createAdminClient();
  const { data: cur } = await admin
    .from('generations')
    .select('params')
    .eq('id', generationId)
    .single();
  const curParams = ((cur as { params?: Record<string, unknown> | null } | null)?.params ?? {}) as Record<string, unknown>;
  const nextParams = { ...curParams, storyboard: { campaignItemId: itemId } };
  const { error: stampErr } = await admin
    .from('generations')
    .update({ campaign_id: item.campaign_id, params: nextParams })
    .eq('id', generationId);
  if (stampErr) {
    return { ok: false, error: 'internal_error', message: stampErr.message };
  }

  const { error } = await supabase
    .from('campaign_items')
    .update({ storyboard_image_id: refId, storyboard_generation_id: generationId, warnings: [] })
    .eq('id', itemId);
  if (error) return { ok: false, error: 'internal_error', message: error.message };

  revalidatePath(`/app/campaigns/${item.campaign_id}/storyboard`);
  return { ok: true, data: { applied: true } };
}
```

- [ ] **Step 3: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS. (`Result`/`ActionError`/`loadItemAndCampaign`/`createAdminClient` ya existen en el archivo.)

- [ ] **Step 4: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(storyboard): usePanelFromStudioAction ancla el resultado del estudio al panel"
```

---

### Task 6: Modo panel en el estudio — botón "Usar como panel"

**Files:**
- Modify: `components/studio/StudioClient.tsx`

**Interfaces:**
- Consumes: `usePanelFromStudioAction` (Task 5).

- [ ] **Step 1: Importar la action y `useRouter` (ya está) en `StudioClient.tsx`**

```typescript
import { usePanelFromStudioAction } from '@/server-actions/storyboard';
```

- [ ] **Step 2: Handler "Usar como panel" dentro de `StudioClient`** (junto a los otros handlers)

```typescript
  const [applyingId, setApplyingId] = useState<string | null>(null);
  async function handleUseAsPanel(generationId: string) {
    if (applyingId) return;
    setApplyingId(generationId);
    try {
      const res = await usePanelFromStudioAction(props.assetId, generationId);
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo usar como panel');
        return;
      }
      toast.success('Panel actualizado');
      if (props.backHref) router.push(props.backHref);
    } finally {
      setApplyingId(null);
    }
  }
```

- [ ] **Step 3: Rama de acciones de galería por modo** (reemplazar el `renderActions` del `<GalleryPanel />`, ~línea 200)

En modo panel, la acción primaria es "Usar como panel" (no "Adjuntar" a un activo):

```tsx
          renderActions={(item) =>
            props.assetType === 'panel' ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  disabled={item.status !== 'done' || applyingId !== null}
                  onClick={() => void handleUseAsPanel(item.id)}
                >
                  Usar como panel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-foreground"
                  onClick={() => setWorkingId(item.id)}
                >
                  Usar como base
                </Button>
                <DownloadTurnButton generationId={item.id} variant="secondary" iconOnly />
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  onClick={() => setAttachId(item.id)}
                >
                  Adjuntar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-foreground"
                  onClick={() => setWorkingId(item.id)}
                >
                  Usar como base
                </Button>
                <DownloadTurnButton generationId={item.id} variant="secondary" iconOnly />
              </>
            )
          }
```

Nota: en modo panel el `AttachDialog` no se usa; queda montado pero inerte (`attachId` nunca se setea). No requiere cambio adicional.

- [ ] **Step 4: typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/studio/StudioClient.tsx
git commit -m "feat(estudio): accion Usar como panel en la galeria en modo panel"
```

---

### Task 7: StoryboardView — "Abrir en estudio" + retiro del refinar + verificación

**Files:**
- Modify: `components/campaigns/StoryboardView.tsx`
- Modify: `server-actions/storyboard.ts` (eliminar `refinePanelAction` + `MAX_REFINE_TURNS` + imports muertos)

**Interfaces:**
- Consumes: nada nuevo (link a la ruta ya existente `/app/studio/panel/[itemId]`).

- [ ] **Step 1: Agregar "Abrir en estudio" por panel en `StoryboardView.tsx`**

Junto a los controles del panel (donde hoy están las acciones del beat, cerca del bloque de refinar ~líneas 800-863), agregar un link a la ruta del estudio (usar `Link` de `next/link`, ya importado o importarlo):

```tsx
<Button asChild variant="outline" size="sm" className="h-8 text-xs">
  <Link href={`/app/studio/panel/${beat.id}`}>Abrir en estudio</Link>
</Button>
```

Colocarlo como la acción de EDICIÓN del panel (reemplaza visualmente al refinar). Conservar "Generar panel", "Subir panel", "Versiones/Restaurar".

- [ ] **Step 2: Eliminar la UI y el estado del refinar en `StoryboardView.tsx`**

Quitar, verificando con grep que no queden referencias:
- Import: en la línea 10, quitar `refinePanelAction` del import de `@/server-actions/storyboard`.
- Estado: `instructions` (253), `setInstructions`, `refineErrors` (302), `setRefineErrors`, `strongEdit` (315), `setStrongEdit`.
- Handler: `handleRefine` (448-490 aprox) completo.
- JSX del refinar: el `<textarea>` de instrucción, el botón "Refinar", el botón de "3 variantes", el bloque `refineErrors[beat.id]` y el toggle `strongEdit` (~líneas 796-864). El bloque de "Versiones" (restaurar) se CONSERVA.
- **Conservar** `productRef`/`characterRef`/`locationRef` y sus toggles: los sigue usando `handleGenerate` (`generatePanelAction`, líneas 433-435). NO quitarlos.

Correr grep de control:

Run: `pnpm exec grep -n "refine\|instruction\|strongEdit\|handleRefine" components/campaigns/StoryboardView.tsx`
Expected: sin coincidencias de `handleRefine`, `refinePanelAction`, `instructions`, `refineErrors`, `strongEdit` (puede quedar `v.refine` del label de versiones — ese es de `groupPanelVersions`, se conserva).

- [ ] **Step 3: Eliminar `refinePanelAction` y código muerto en `server-actions/storyboard.ts`**

- Borrar la función `refinePanelAction` completa (líneas 512-828 aprox).
- Borrar la const `MAX_REFINE_TURNS` (línea 44).
- En el import de `@/lib/campaigns/storyboard` (línea 26), quitar los símbolos que SOLO usaba el refinar. Verificar con grep cuáles quedan sin uso: candidatos `compilePanelEdit`, `compileRefinePrompt`, `chainedCharacterFidelity`. Correr:

Run: `pnpm exec grep -n "compilePanelEdit\|compileRefinePrompt\|chainedCharacterFidelity" server-actions/storyboard.ts`

Quitar del import SOLO los que ya no aparezcan en el resto del archivo. (No borrar sus definiciones en `lib/campaigns/storyboard.ts` en esta task salvo que un grep global confirme cero consumidores — fuera de alcance; si quedan huérfanas, anotarlo en el reporte, no borrar en silencio.)

- [ ] **Step 4: Verificación completa**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: toda la suite PASS, typecheck limpio, build verde.

- [ ] **Step 5: Commit**

```bash
git add components/campaigns/StoryboardView.tsx server-actions/storyboard.ts
git commit -m "feat(storyboard): abre el panel en el estudio y retira el refinar inline"
```

---

## Post-implementación (fuera de las tasks, lo coordina el controller)

- **Aplicar la migración 063 a prod vía MCP** ANTES del deploy (orden migración→push). Verificar `project_id` contra `.env.local`.
- **Actualizar la memoria** `project-storyboard-mode` / `project-refinado-conversacional`: el refinar de paneles se retiró; la edición de paneles vive en el estudio.
- **Smokes del usuario (API real):**
  1. Abrir un panel generado → "Abrir en estudio" → el compositor arranca con la imagen del panel como base y el scene_prompt precargado; enviar una edición (Realtime) → "Usar como panel" → el storyboard muestra el panel nuevo y aparece en Versiones; restaurar una versión previa funciona.
  2. Panel subido a mano (sin generación) → el estudio ofrece el panel como referencia; editar y aplicar.
  3. Cambiar de proveedor (nano/gpt-image/flux) dentro del estudio de panel.
  4. Confirmar que en el storyboard ya no hay caja de refinar y que "Generar/Subir/Versiones" siguen.

## Self-Review (hecho)

- **Cobertura del spec:** panel como assetType (T1), migración CHECK (T1), loader+seeding no forzado refs+prompt (T2/T3/T4), ownership por campaña (T3), entrada "Abrir en estudio" (T7), salida "Usar como panel" con versiones intactas (T5/T6), retiro del refinar (T7), edge case panel subido a mano (T2/T3 lo dejan como referencia), créditos sin cambios (turnos normales del estudio). Aspecto por defecto = del beat (T4 `defaultAspect`; si el Composer lo requiere explícito, se pasa como prop análogo). Cubierto.
- **Placeholders:** ninguno; los `~línea` son anclas aproximadas para archivos que el implementador lee, con código exacto en cada cambio.
- **Consistencia de tipos:** `StudioAssetType`/variante `panel` (T1) → `buildPanelAssetImages`/`imageIdsFromAssetImages` (T2) → `loadPanelAsset` (T3) → props del page/StudioClient (T4) → `usePanelFromStudioAction(itemId, generationId)` (T5) usada en StudioClient (T6). Nombres consistentes.
