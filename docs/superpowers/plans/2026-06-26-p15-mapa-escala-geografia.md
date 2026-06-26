# P15 — Mapa esquemático de escala/geografía — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir asociar a una locación un esquema top-down (subido o generado con IA) que fije escala/posición de objetos, y citarlo al modelo de video como referencia re-anclada por clip.

**Architecture:** Nuevo rol de referencia `scale_map` en el prompt-director determinista. La imagen vive en `media_references` y se referencia desde `locations` (columnas aditivas). El orchestrator la resuelve en `DirectorContext.location.scaleMap` y el compiler Seedance la cita con una directiva propia, respetando el tope de 9 imágenes. UI en el editor de Locaciones (subir o generar con FLUX + notas de proporciones).

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase (Postgres + Storage), zod, FLUX (provider de imagen), Nano Banana, vitest.

## Global Constraints

- **Decisiones inmutables:** lo que tarda >60s pasa por QStash; las URLs de proveedor nunca llegan al cliente; créditos solo vía funciones SQL atómicas (`reserve/confirm/refund`), nunca UPDATE directo a `credit_balances`/`credit_transactions`; RLS es la última línea (server actions validan zod + ownership); service role solo server-side.
- **Generación de imagen** (FLUX) es síncrona (<60s) por `submitGenerationAction`, igual que la locación master y `generateProductConcept`. No se agrega ningún job largo nuevo.
- **Solo compiler Seedance** en v1 (`slug.includes('seedance')`). Veo/Kling (`video-prose`) diferido.
- **Esquemas zod que se exportan** viven en `lib/schemas/` (un módulo `'use server'` solo puede exportar funciones async — ver gotcha `project_use_server_no_object_export`).
- **Migraciones** aditivas, en orden, NUNCA modificar una aplicada.
- **Sin** `any` (usar `unknown` + narrowing o tipo explícito). **Sin** emojis en código/UI. Dark mode + acento `#009fff`.
- **Tests no llaman APIs reales** (Gemini/fal.ai/QStash); todo mockeado o puro.
- **Commits sin** `Co-Authored-By`. Usar `pnpm` (`pnpm vitest run`, `pnpm typecheck`, `pnpm build`, `pnpm lint`).
- **YAGNI:** solo a nivel locación (no por escena); sin auto-derivar proporciones con Gemini; sin editor de diagramas; una sola imagen de mapa por locación.

---

### Task 1: Prompt-director — rol `scale_map` y cita en el compiler Seedance

**Files:**
- Modify: `lib/prompt-director/types.ts` (ReferenceRole + `DirectorContext.location`)
- Modify: `lib/prompt-director/compilers/seedance.ts` (cita en `buildReferences` + warning)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Produces: `ReferenceRole` ahora incluye `'scale_map'`. `DirectorContext.location` ahora es
  `{ name?: string; description?: string; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }`.
  `buildReferences(ctx)` cita la referencia `scale_map` tras la locación-`environment` y antes de los extras.

- [ ] **Step 1: Escribe los tests que fallan**

En `lib/prompt-director/prompt-director.test.ts`, dentro del `describe('compile seedance', ...)` (cerca del test del tope de 9, ~línea 482), agrega:

```ts
it('cita el mapa de escala como rol scale_map con directiva top-down (P15)', () => {
  const res = compile(
    { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The mascot dances on the sidewalk' },
    {
      location: {
        name: 'Calle',
        description: 'a city sidewalk',
        imagePaths: ['ws/street.png'],
        scaleMap: { path: 'ws/map.png', notes: 'the inflatable mascot is twice the person, left of the door' },
      },
    },
  );
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const images = res.compiled.references.filter((r) => r.kind === 'image');
  const sm = images.find((r) => r.role === 'scale_map');
  expect(sm?.storagePath).toBe('ws/map.png');
  expect(res.compiled.prompt).toMatch(/TOP-DOWN SCALE SCHEMATIC/);
  expect(res.compiled.prompt).toContain('twice the person');
});

it('sin scaleMap no cita ninguna referencia scale_map (P15)', () => {
  const res = compile(
    { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'A can on a table' },
    { location: { name: 'Calle', description: 'a city sidewalk', imagePaths: ['ws/street.png'] } },
  );
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.compiled.references.some((r) => r.role === 'scale_map')).toBe(false);
});

it('el scale_map tiene MAYOR prioridad que los extras ante el tope de 9 (P15)', () => {
  // 8 imágenes ocupadas (3 producto + 2 empaque + master+2 ángulos) + 1 slot:
  // compiten location, scale_map y extra → el orden de empuje es la prioridad
  // (producto > empaque > personaje > locación > scale_map > extra).
  const res = compile(
    { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She opens the can' },
    {
      format: { ...vozCercana, requiredRefs: ['product', 'character', 'packaging'] },
      product: { name: 'Canvas', imagePaths: ['p1.png', 'p2.png', 'p3.png'], packagingImagePaths: ['k1.png', 'k2.png'] },
      characters: [{ name: 'Maya', description: 'd', masterImagePath: 'm.png', angleImagePaths: ['ma1.png', 'ma2.png'] }],
      location: { name: 'Calle', description: 'd', imagePaths: [], scaleMap: { path: 'map.png' } },
      extraImagePaths: ['x1.png'],
    },
  );
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const images = res.compiled.references.filter((r) => r.kind === 'image');
  expect(images).toHaveLength(9);
  // El 9º slot es el scale_map; el extra se recorta primero.
  expect(images[8].role).toBe('scale_map');
  expect(images.some((r) => r.role === 'environment' && r.storagePath === 'x1.png')).toBe(false);
  expect(res.compiled.warnings.some((w) => w.includes('tope de 9'))).toBe(true);
});
```

- [ ] **Step 2: Corre los tests y verifica que fallan**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: FAIL — el rol `scale_map` no existe y la cita no se emite (los 3 tests rojos; los nuevos por tipo/aserción).

- [ ] **Step 3: Agrega el rol y el campo de contexto en `types.ts`**

En `lib/prompt-director/types.ts`, en `ReferenceRole` (líneas 6-14), agrega tras `'environment'`:

```ts
  | 'scale_map'      // esquema top-down: fija escala/posicion de objetos (P15)
```

Y extiende el campo `location` de `DirectorContext` (línea 81) a:

```ts
  location?: {
    name?: string;
    description?: string;
    imagePaths: string[];
    // P15: esquema top-down que fija escala/posicion; se cita como rol scale_map
    // y se re-ancla por clip (igual que imagePaths). `notes` = proporciones en texto.
    scaleMap?: { path: string; notes?: string };
  };
```

- [ ] **Step 4: Cita el scale_map en `buildReferences`**

En `lib/prompt-director/compilers/seedance.ts`, justo después del bucle de locación-`environment` (tras la línea 245, antes del bucle de `extraImagePaths`), agrega:

```ts
  // P15: mapa de escala top-down. Va tras la locación y antes de los extras en
  // prioridad. Directiva propia: NO es una escena a renderizar, fija proporciones.
  if (ctx.location?.scaleMap) {
    const { path, notes } = ctx.location.scaleMap;
    pushImage(
      path,
      'scale_map',
      (n) =>
        `@image${n} is a TOP-DOWN SCALE SCHEMATIC of the set, not a scene to render: ` +
        `it fixes the relative SIZE and POSITION of the elements` +
        (notes ? ` — ${notes}` : '') +
        `. Keep these proportions and placement consistent across shots; do not resize or ` +
        `relocate objects, and do not copy its flat diagram look into the video.`,
    );
  }
```

Y actualiza el texto del warning de recorte (línea ~254) para incluir el mapa de escala:

```ts
    warnings.push(
      `referencias: ${droppedImages} imágenes recortadas por el tope de 9 del modelo (prioridad: producto > empaque > personaje > locación > mapa de escala > extra)`,
    );
```

- [ ] **Step 5: Corre los tests y verifica que pasan**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: PASS (todos, incluidos los 3 nuevos).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): rol scale_map y cita top-down en el compiler Seedance (P15)"
```

---

### Task 2: Helper `generateScaleMap` (FLUX desde descripción)

**Files:**
- Modify: `components/creation/generate.ts`
- Test: `components/creation/generate.test.ts`

**Interfaces:**
- Consumes: `submitGenerationAction`, `addGenerationAsReferenceAction`, `fixAsReference` (ya en el archivo).
- Produces: `generateScaleMap(description: string): Promise<GeneratedImage | GenError>` — genera
  un diagrama top-down con FLUX (`flux-2-pro-preview`, `photoreal: false`, sin referencias) y lo
  fija como `media_reference`.

- [ ] **Step 1: Escribe el test que falla**

En `components/creation/generate.test.ts`, agrega al final:

```ts
import { generateScaleMap } from './generate';

describe('generateScaleMap', () => {
  beforeEach(() => vi.clearAllMocks());

  it('genera un diagrama top-down con FLUX (no photoreal) y lo fija como referencia', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'p', storagePath: 's', filename: 'f.png' },
    });

    const res = await generateScaleMap('a city sidewalk with an inflatable mascot');

    expect(isGenError(res)).toBe(false);
    if (!isGenError(res)) expect(res.refId).toBe('ref1');

    const call = vi.mocked(submitGenerationAction).mock.calls[0][0] as SubmitGenerationInput;
    expect(call.provider).toBe('flux');
    expect((call as Extract<SubmitGenerationInput, { provider: 'flux' }>).photoreal).toBe(false);
    expect(call.references).toEqual([]);
    expect(call.prompt).toMatch(/top-down/i);
    expect(call.prompt).toMatch(/schematic|floor-plan/i);
  });

  it('propaga el error de la generación', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: false, error: 'provider_error', message: 'boom' });
    const res = await generateScaleMap('x');
    expect(isGenError(res)).toBe(true);
    if (isGenError(res)) expect(res.message).toBe('boom');
  });
});
```

- [ ] **Step 2: Corre el test y verifica que falla**

Run: `pnpm vitest run components/creation/generate.test.ts`
Expected: FAIL — `generateScaleMap` no existe.

- [ ] **Step 3: Implementa `generateScaleMap`**

En `components/creation/generate.ts`, agrega antes de `generateProductConcept` (línea ~149):

```ts
// Mapa de escala (P15): diagrama top-down del set desde una descripción. FLUX
// text2image, no photoreal (queremos un esquema plano, no una foto). Legítimo
// porque es un esquema de proporciones, no una foto fiel de un producto/persona.
function buildScaleMapPrompt(description: string): string {
  return (
    `Top-down schematic floor-plan diagram of ${description}. ` +
    'Flat simple line drawing seen directly from above, labeled, showing the relative positions ' +
    'and proportional sizes of the elements; plain background, no perspective, no photorealism, ' +
    'no shadows, no people, no text other than short element labels.'
  );
}

export async function generateScaleMap(description: string): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildScaleMapPrompt(description),
    aspectRatio: '1:1' as const,
    megapixels: 2 as const,
    photoreal: false,
    references: [],
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}
```

- [ ] **Step 4: Corre el test y verifica que pasa**

Run: `pnpm vitest run components/creation/generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/creation/generate.ts components/creation/generate.test.ts
git commit -m "feat(creation): generateScaleMap (FLUX top-down) para el mapa de escala (P15)"
```

---

### Task 3: Migración 047 + schema extraído + persistencia en server actions

**Files:**
- Create: `supabase/migrations/047_location_scale_map.sql`
- Create: `lib/schemas/locations.ts` (extrae y extiende `UpsertLocationSchema`)
- Create: `lib/schemas/locations.test.ts`
- Modify: `server-actions/locations.ts` (importa el schema; persiste y valida los campos nuevos)

**Interfaces:**
- Consumes (Task 4 + Task 5): columnas `locations.scale_map_image_id`, `locations.scale_map_notes`.
- Produces: `UpsertLocationSchema` exportado desde `lib/schemas/locations.ts`, con
  `scaleMapImageId?: string (uuid)` y `scaleMapNotes?: string (max 300)`.
  `create/updateLocationAction` persisten ambos y validan ownership de `scaleMapImageId`.

- [ ] **Step 1: Crea la migración aditiva**

Crea `supabase/migrations/047_location_scale_map.sql`:

```sql
-- 047_location_scale_map.sql
-- P15: mapa esquematico top-down de escala/geografia asociado a la locacion.
-- Aditivo: columnas nuevas, sin tocar policies. Ver spec 2026-06-26-p15-mapa-escala-geografia.
alter table locations
  add column if not exists scale_map_image_id uuid,
  add column if not exists scale_map_notes text;

comment on column locations.scale_map_image_id is
  'P15: esquema top-down (planta) que fija escala/posicion de objetos; se cita como rol scale_map y se re-ancla por clip.';
comment on column locations.scale_map_notes is
  'P15: proporciones en texto libre ("la mascota mide 2x el humano, a la izquierda de la puerta"); el compiler las anexa a la directiva del esquema.';
```

Aplícala con el MCP de Supabase (`apply_migration`, name `location_scale_map`) o el flujo de migraciones del proyecto. NO modificar migraciones ya aplicadas.

- [ ] **Step 2: Escribe el test del schema (falla)**

Crea `lib/schemas/locations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { UpsertLocationSchema } from './locations';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('UpsertLocationSchema — campos del mapa de escala (P15)', () => {
  it('acepta scaleMapImageId (uuid) y scaleMapNotes', () => {
    const r = UpsertLocationSchema.safeParse({ name: 'Calle', scaleMapImageId: UUID, scaleMapNotes: 'mascota 2x el humano' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scaleMapImageId).toBe(UUID);
      expect(r.data.scaleMapNotes).toBe('mascota 2x el humano');
    }
  });

  it('omitir los campos del mapa es válido (opcionales)', () => {
    expect(UpsertLocationSchema.safeParse({ name: 'Calle' }).success).toBe(true);
  });

  it('rechaza scaleMapImageId que no sea uuid', () => {
    expect(UpsertLocationSchema.safeParse({ name: 'Calle', scaleMapImageId: 'nope' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Corre el test y verifica que falla**

Run: `pnpm vitest run lib/schemas/locations.test.ts`
Expected: FAIL — `lib/schemas/locations.ts` no existe.

- [ ] **Step 4: Crea `lib/schemas/locations.ts` con el schema extendido**

Crea `lib/schemas/locations.ts` (mueve aquí el `UpsertLocationSchema` que vivía inline en el server action y agrega los campos del mapa):

```ts
import { z } from 'zod';

// Locación: el "dónde" reutilizable de una secuencia. master_image_id OPCIONAL.
// Vive aquí (no en el módulo 'use server') porque se exporta para test determinista
// y un archivo 'use server' solo puede exportar funciones async.
export const UpsertLocationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).optional(),
  masterImageId: z.string().uuid().optional(),
  referenceImageIds: z.array(z.string().uuid()).max(4).default([]),
  // P15: esquema top-down de escala/posición (opcional).
  scaleMapImageId: z.string().uuid().optional(),
  scaleMapNotes: z.string().trim().max(300).optional(),
});
```

- [ ] **Step 5: Corre el test y verifica que pasa**

Run: `pnpm vitest run lib/schemas/locations.test.ts`
Expected: PASS.

- [ ] **Step 6: Importa el schema y persiste los campos en el server action**

En `server-actions/locations.ts`:

1. Elimina el bloque `const UpsertLocationSchema = z.object({ ... });` (líneas 11-18) y agrega el import tras la línea 7:

```ts
import { UpsertLocationSchema } from '@/lib/schemas/locations';
```

(Conserva `import { z } from 'zod';` — se sigue usando en `deleteLocationAction` línea 100.)

2. En `createLocationAction`, incluye el id del mapa en la validación de ownership y en el insert. Reemplaza el bloque `allIds` (líneas 44-49) y el `.insert({...})` (líneas 53-59) por:

```ts
  const allIds = [parsed.data.masterImageId, parsed.data.scaleMapImageId, ...parsed.data.referenceImageIds].filter(
    (x): x is string => !!x,
  );
  if (!(await validateImageOwnership(supabase, workspace.id, allIds))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }

  const { data, error } = await supabase
    .from('locations')
    .insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      master_image_id: parsed.data.masterImageId ?? null,
      reference_image_ids: parsed.data.referenceImageIds,
      scale_map_image_id: parsed.data.scaleMapImageId ?? null,
      scale_map_notes: parsed.data.scaleMapNotes ?? null,
    })
    .select('id')
    .single();
```

3. En `updateLocationAction`, reemplaza el bloque `allIds` (líneas 73-78) y el `.update({...})` (líneas 82-88) por:

```ts
  const allIds = [parsed.data.masterImageId, parsed.data.scaleMapImageId, ...parsed.data.referenceImageIds].filter(
    (x): x is string => !!x,
  );
  if (!(await validateImageOwnership(supabase, workspace.id, allIds))) {
    return { ok: false, error: 'forbidden', message: 'Imagen no pertenece al workspace' };
  }

  const { error, count } = await supabase
    .from('locations')
    .update(
      {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        master_image_id: parsed.data.masterImageId ?? null,
        reference_image_ids: parsed.data.referenceImageIds,
        scale_map_image_id: parsed.data.scaleMapImageId ?? null,
        scale_map_notes: parsed.data.scaleMapNotes ?? null,
      },
      { count: 'exact' },
    )
    .eq('id', id)
    .eq('workspace_id', workspace.id);
```

- [ ] **Step 7: Typecheck y tests**

Run: `pnpm typecheck && pnpm vitest run lib/schemas/locations.test.ts`
Expected: typecheck sin errores; test PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/047_location_scale_map.sql lib/schemas/locations.ts lib/schemas/locations.test.ts server-actions/locations.ts
git commit -m "feat(locations): persistir scale_map_image_id y notes; schema a lib/schemas (P15)"
```

---

### Task 4: Orchestrator — resolver el scaleMap y propagarlo al DirectorContext

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`resolveLocations`, `directorContextFor`, armado por item ~línea 818)
- Test: `lib/campaigns/director-context.test.ts`

**Interfaces:**
- Consumes: columnas `scale_map_image_id`/`scale_map_notes` (Task 3); `DirectorContext.location.scaleMap` (Task 1).
- Produces: `resolveLocations(...)` devuelve entradas con `scaleMap?: { path; notes? }`;
  `directorContextFor(...)` propaga ese `scaleMap` a `DirectorContext.location.scaleMap`.

- [ ] **Step 1: Escribe los tests que fallan**

En `lib/campaigns/director-context.test.ts`, agrega:

```ts
import { directorContextFor, resolveLocations, type CampaignContext } from './orchestrator';

// Supabase falso: despacha por tabla. Cubre las dos queries de resolveLocations
// (locations + media_references vía resolvePaths). Sin red.
function fakeSupabase(byTable: Record<string, unknown[]>) {
  return {
    from: (table: string) => ({
      select: () => ({ in: async () => ({ data: byTable[table] ?? [] }) }),
    }),
  } as unknown as Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;
}

describe('resolveLocations — mapa de escala (P15)', () => {
  it('resuelve scale_map_image_id a un path y adjunta las notas', async () => {
    const sb = fakeSupabase({
      locations: [{
        id: 'loc1', workspace_id: 'ws', name: 'Calle', description: 'd',
        master_image_id: 'm1', scale_map_image_id: 'sm1', scale_map_notes: 'mascota 2x',
      }],
      media_references: [
        { id: 'm1', storage_url: 'ws/master.png', workspace_id: 'ws' },
        { id: 'sm1', storage_url: 'ws/map.png', workspace_id: 'ws' },
      ],
    });
    const map = await resolveLocations(sb, 'ws', ['loc1']);
    expect(map.get('loc1')?.imagePaths).toEqual(['ws/master.png']);
    expect(map.get('loc1')?.scaleMap).toEqual({ path: 'ws/map.png', notes: 'mascota 2x' });
  });

  it('sin scale_map_image_id, scaleMap queda undefined', async () => {
    const sb = fakeSupabase({
      locations: [{ id: 'loc1', workspace_id: 'ws', name: 'Calle', description: null, master_image_id: null, scale_map_image_id: null, scale_map_notes: null }],
      media_references: [],
    });
    const map = await resolveLocations(sb, 'ws', ['loc1']);
    expect(map.get('loc1')?.scaleMap).toBeUndefined();
  });
});

describe('directorContextFor — propaga scaleMap (P15)', () => {
  const baseItem = { id: 'i1', scene: null, character_id: null, character_ids: null } as unknown as Parameters<typeof directorContextFor>[0];
  const ctx: CampaignContext = {
    productName: 'Serum', productImagePaths: ['ws/p.png'], packagingImagePaths: [],
    characters: new Map(), language: 'es',
  };
  it('lleva el scaleMap de la locación al DirectorContext', () => {
    const loc = { name: 'Calle', description: 'd', imagePaths: ['ws/street.png'], scaleMap: { path: 'ws/map.png', notes: 'n' } };
    const dc = directorContextFor(baseItem, null, ctx, undefined, undefined, loc);
    expect(dc.location?.scaleMap).toEqual({ path: 'ws/map.png', notes: 'n' });
  });
});
```

- [ ] **Step 2: Corre los tests y verifica que fallan**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: FAIL — `resolveLocations` no selecciona ni adjunta el scaleMap; el tipo del param `location` de `directorContextFor` no tiene `scaleMap`.

- [ ] **Step 3: Extiende `resolveLocations`**

En `lib/campaigns/orchestrator.ts`, reemplaza el cuerpo de `resolveLocations` (líneas 159-189) por:

```ts
export async function resolveLocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  locationIds: string[],
): Promise<
  Map<
    string,
    { name: string; description: string | null; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }
  >
> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const out = new Map<
    string,
    { name: string; description: string | null; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }
  >();
  if (ids.length === 0) return out;
  const { data: rows } = await supabase
    .from('locations')
    .select('id, workspace_id, name, description, master_image_id, scale_map_image_id, scale_map_notes')
    .in('id', ids);
  const masterByLoc = new Map<string, string>();
  const scaleByLoc = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.workspace_id !== workspaceId) continue;
    if (r.master_image_id) masterByLoc.set(r.id as string, r.master_image_id as string);
    if (r.scale_map_image_id) scaleByLoc.set(r.id as string, r.scale_map_image_id as string);
  }
  // Una sola resolución de paths para masters + mapas de escala.
  const paths = await resolvePaths(supabase, workspaceId, [...masterByLoc.values(), ...scaleByLoc.values()]);
  for (const r of rows ?? []) {
    if (r.workspace_id !== workspaceId) continue;
    const masterId = masterByLoc.get(r.id as string);
    const masterPath = masterId ? paths.get(masterId) : undefined;
    const scaleId = scaleByLoc.get(r.id as string);
    const scalePath = scaleId ? paths.get(scaleId) : undefined;
    out.set(r.id as string, {
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      imagePaths: masterPath ? [masterPath] : [],
      ...(scalePath
        ? { scaleMap: { path: scalePath, ...((r.scale_map_notes as string | null) ? { notes: r.scale_map_notes as string } : {}) } }
        : {}),
    });
  }
  return out;
}
```

- [ ] **Step 4: Propaga el scaleMap en `directorContextFor` y en el armado por item**

En `lib/campaigns/orchestrator.ts`:

1. Extiende el tipo del parámetro `location?` de `directorContextFor` (línea 312):

```ts
  location?: { name?: string; description?: string; imagePaths: string[]; scaleMap?: { path: string; notes?: string } },
```

2. Ajusta el guard de inclusión (línea 342) para que una locación con SOLO mapa de escala también pase:

```ts
    location: (location?.imagePaths.length || location?.description?.trim() || location?.scaleMap) ? location : undefined,
```

3. En el armado por item (líneas 817-821), pasa el `scaleMap`:

```ts
      (() => {
        const loc = item.location_id ? locations.get(item.location_id) : undefined;
        if (!loc) return undefined;
        return { name: loc.name, description: loc.description ?? undefined, imagePaths: loc.imagePaths, scaleMap: loc.scaleMap };
      })(),
```

- [ ] **Step 5: Corre los tests y verifica que pasan**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts
git commit -m "feat(orchestrator): resolver y propagar el mapa de escala de la locacion (P15)"
```

---

### Task 5: UI — sección "Mapa de escala" en el editor de Locaciones + preview firmado

**Files:**
- Modify: `components/locations/LocationsPage.tsx` (tipo `Location`, props, editor, save)
- Modify: `app/app/brand/locations/page.tsx` (cargar columnas nuevas + firmar el preview del mapa)

**Interfaces:**
- Consumes: `generateScaleMap` (Task 2); `create/updateLocationAction` con `scaleMapImageId`/`scaleMapNotes` (Task 3); `ZoomableImage`, `ReferenceImagesUploader`.
- Produces: UI para subir o generar el mapa + notas, persistidos al guardar la locación.

Esta tarea es presentacional (sin test unitario en este repo); se verifica con `pnpm typecheck`, `pnpm build` y smoke manual.

- [ ] **Step 1: Carga las columnas nuevas y firma el preview en el server component**

En `app/app/brand/locations/page.tsx`:

1. Amplía el SELECT (línea 16):

```ts
    .select('id, name, description, master_image_id, reference_image_ids, scale_map_image_id, scale_map_notes')
```

2. Amplía el map a `Location` (líneas 20-26) agregando los campos:

```ts
  const locations: Location[] = (rows ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    description: (l.description as string | null) ?? null,
    master_image_id: (l.master_image_id as string | null) ?? null,
    reference_image_ids: (l.reference_image_ids as string[]) ?? [],
    scale_map_image_id: (l.scale_map_image_id as string | null) ?? null,
    scale_map_notes: (l.scale_map_notes as string | null) ?? null,
  }));
```

3. Incluye el id del mapa en el set que se firma (líneas 28-34):

```ts
  const allImageIds = [
    ...new Set(
      locations
        .flatMap((l) => [l.master_image_id, l.scale_map_image_id, ...l.reference_image_ids])
        .filter((id): id is string => !!id),
    ),
  ];
```

- [ ] **Step 2: Extiende el tipo `Location` y las props del editor**

En `components/locations/LocationsPage.tsx`:

1. Extiende `type Location` (líneas 18-24):

```ts
export type Location = {
  id: string;
  name: string;
  description: string | null;
  master_image_id: string | null;
  reference_image_ids: string[];
  scale_map_image_id: string | null;
  scale_map_notes: string | null;
};
```

2. Agrega el import del helper de generación (junto a los imports de generate, no hay ninguno aún en este archivo) tras la línea 16:

```ts
import { generateScaleMap, isGenError } from '@/components/creation/generate';
```

- [ ] **Step 3: Estado y handlers del mapa en `LocationEditor`**

En `LocationEditor`, tras `const [generating, setGenerating] = useState(false);` (línea 182), agrega:

```ts
  const [scaleMapImages, setScaleMapImages] = useState<RefImage[]>(
    location?.scale_map_image_id
      ? [{ id: location.scale_map_image_id, previewUrl: previews[location.scale_map_image_id] ?? null }]
      : [],
  );
  const [scaleMapNotes, setScaleMapNotes] = useState(location?.scale_map_notes ?? '');
  const [generatingMap, setGeneratingMap] = useState(false);
  const canGenerateMap = description.trim().length >= 10 && !generatingMap;

  async function handleGenerateScaleMap() {
    if (!canGenerateMap) return;
    setGeneratingMap(true);
    try {
      const out = await generateScaleMap(description.trim());
      if (isGenError(out)) {
        toast.error(out.message || 'No se pudo generar el mapa de escala');
        return;
      }
      setScaleMapImages([{ id: out.refId, previewUrl: out.previewUrl }]);
      toast.success('Mapa de escala generado; revísalo y guarda');
    } finally {
      setGeneratingMap(false);
    }
  }
```

- [ ] **Step 4: Incluye los campos del mapa en el payload de guardado**

En `handleSave`, extiende el `payload` (líneas 225-230):

```ts
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        masterImageId: masterImages[0]?.id,
        referenceImageIds: referenceImages.map((i) => i.id),
        scaleMapImageId: scaleMapImages[0]?.id,
        scaleMapNotes: scaleMapNotes.trim() || undefined,
      };
```

- [ ] **Step 5: Renderiza la sección "Mapa de escala (opcional)"**

En el JSX, tras el bloque de "Imágenes de referencia adicionales" (`ReferenceImagesUploader` que cierra en la línea 318) y antes del `<div className="flex gap-2">` de Guardar/Cancelar (línea 320), inserta:

```tsx
        <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mapa de escala (opcional)
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground/70">
              Esquema top-down que fija el tamaño y la posición de los objetos (evita que cambien de
              tamaño o se muevan entre tomas). Súbelo o genéralo desde la descripción.
            </p>
          </div>

          {scaleMapImages[0]?.previewUrl ? (
            <ZoomableImage
              src={scaleMapImages[0].previewUrl}
              alt="Mapa de escala"
              className="size-24 rounded-md border border-border"
            />
          ) : null}

          <ReferenceImagesUploader
            label="Imagen del mapa"
            hint="Diagrama visto desde arriba con proporciones marcadas. Opcional."
            images={scaleMapImages}
            onChange={(imgs) => setScaleMapImages(imgs.slice(-1))}
            max={1}
          />

          <button
            type="button"
            onClick={handleGenerateScaleMap}
            disabled={!canGenerateMap}
            title={description.trim().length < 10 ? 'Escribe una descripción (mín. 10 caracteres)' : undefined}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 px-3 py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generatingMap ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-3.5" aria-hidden />
            )}
            {generatingMap ? 'Generando…' : `Generar mapa con IA${generateCost != null ? ` · −${generateCost} cr` : ''}`}
          </button>

          <div>
            <label htmlFor="scale-map-notes" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Notas de proporciones (opcional)
            </label>
            <textarea
              id="scale-map-notes"
              value={scaleMapNotes}
              onChange={(e) => setScaleMapNotes(e.target.value)}
              placeholder="p. ej. la mascota mide 2× el humano, a la izquierda de la puerta"
              rows={2}
              maxLength={300}
              className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
        </div>
```

- [ ] **Step 6: Typecheck, lint y build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck sin errores; lint 0 errores; build OK (el build es el único que detecta el gotcha de `'use server'`).

- [ ] **Step 7: Commit**

```bash
git add components/locations/LocationsPage.tsx app/app/brand/locations/page.tsx
git commit -m "feat(locations): seccion mapa de escala (subir/generar + notas) en el editor (P15)"
```

---

## Verificación final

- [ ] `pnpm vitest run` — toda la suite verde (incluye los nuevos tests de las Tasks 1-4).
- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm lint` — 0 errores.
- [ ] `pnpm build` — OK.
- [ ] Smoke manual (lo corre el usuario, usa APIs reales): crear/editar una locación, subir un mapa y/o generarlo, escribir notas, guardar; generar una campaña con esa locación y confirmar en el prompt compilado que aparece la cita `TOP-DOWN SCALE SCHEMATIC` con las notas, y que se re-ancla en cada clip.

## Notas y diferidos

- **Diferido (Veo/Kling):** el `video-prose` compiler no cita el scale_map en v1 (mismo precedente que P05, Seedance-only). Si se prioriza, se añade la cita análoga ahí.
- **Discrepancia spec→plan (menor):** el spec listaba `lib/schemas/locations.ts` como "si el módulo es 'use server'". El plan lo crea de hecho (extrae el schema inline y lo exporta) para poder testearlo y mantener limpio el módulo `'use server'` — coherente con el patrón de `lib/schemas/character-states.ts`.
- **Heurística del esquema generado:** FLUX no garantiza proporciones exactas en el diagrama; por eso el camino de subir es el fiable y la generación es mejor esfuerzo (decisión de producto "ambos").
