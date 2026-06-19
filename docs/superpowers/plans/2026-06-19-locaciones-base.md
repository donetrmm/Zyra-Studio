# Locaciones (Base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar "Locaciones" como activo reutilizable (espejo del Cast) y un modo de generación implícito donde una secuencia con locación se genera SIN encadenar, re-anclando la locación como referencia `environment` en cada clip — eliminando la degradación acumulada del encadenado.

**Architecture:** Tabla `locations` espejo de `characters` + columna `campaign_items.location_id`. El Prompt Director ya tiene el rol `environment`; se le agrega un campo `location` que se inyecta como referencia (tras producto/personaje, antes de extras) y su descripción al setting. El orquestador detecta `location_id` en los items de una secuencia y fuerza el camino NO-encadenado existente (cada escena = generación R2V independiente con `[producto, personajes, locación]`).

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + RLS), TypeScript, zod, Vitest, ffmpeg/Seedance (Atlas/ModelArk). Spec fuente: `docs/superpowers/specs/2026-06-19-locaciones-base-design.md`.

## Global Constraints

- **No `any` en TypeScript** — usar `unknown` + narrowing o tipo explícito.
- **No emojis** en código ni UI. Dark mode, paleta zinc-950 + acento `#009fff`.
- **Server Components por default**; `'use client'` solo con state/effects. Mutaciones vía **Server Actions** con validación **zod** + ownership por workspace.
- **RLS espejo de `characters`**: `create policy "..._member" on <tabla> for all using (is_workspace_member(workspace_id) or is_admin());`. El `for all using(...)` reusa la expresión como WITH CHECK para INSERT.
- **Nunca modificar una migración ya aplicada**; agregar una nueva (`041_...`).
- **Tests sin APIs reales** (Gemini/fal/ElevenLabs/QStash/DB real). Unit tests puros con Vitest; los smoke con generación real los corre el usuario.
- **pnpm** siempre (`pnpm typecheck`, `pnpm test`).
- **Commits sin `Co-Authored-By: Claude`**. Estilo conventional commits en español.
- Componentes **shadcn primero**; reusar componentes de subida/selección de imágenes del Cast.

---

### Task 1: Migración — tabla `locations` + `campaign_items.location_id` + RLS

**Files:**
- Create: `supabase/migrations/041_locations.sql`

**Interfaces:**
- Produces: tabla `locations(id, workspace_id, name, description, master_image_id, reference_image_ids, created_at)`; columna `campaign_items.location_id uuid null` (FK `on delete set null`).

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/041_locations.sql`:

```sql
-- 041_locations.sql
-- Locaciones: activo reutilizable (espejo del Cast) = el "donde" de una secuencia.
-- Una secuencia con locacion se genera SIN encadenar; la locacion se re-ancla
-- como referencia environment en cada clip. Ver spec 2026-06-19-locaciones-base.

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  master_image_id uuid,                                         -- media_references.id (imagen del lugar)
  reference_image_ids uuid[] not null default array[]::uuid[],  -- angulos/detalles del lugar
  created_at timestamptz default now()
);
create index if not exists idx_locations_workspace on locations(workspace_id);

alter table locations enable row level security;
drop policy if exists "locations_member" on locations;
create policy "locations_member" on locations
  for all using (is_workspace_member(workspace_id) or is_admin());

alter table campaign_items
  add column if not exists location_id uuid references locations(id) on delete set null;
create index if not exists idx_campaign_items_location on campaign_items(location_id);

comment on table locations is
  'Locacion reutilizable (el "donde" de una secuencia). Su imagen se re-ancla como referencia environment en cada clip.';
comment on column campaign_items.location_id is
  'Locacion de la secuencia (compartida por todas sus escenas). No null => modo-locacion: la secuencia se genera SIN encadenar.';
```

- [ ] **Step 2: Sanity-check de la migración**

Revisar que: usa `if not exists`/`drop policy if exists` (idempotente), reusa `is_workspace_member`/`is_admin` (definidas en migraciones previas), y NO toca tablas/columnas existentes salvo el `add column` aditivo. NO aplicar contra la DB remota aquí (lo hace el usuario en su flujo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/041_locations.sql
git commit -m "feat(locaciones): migracion tabla locations + campaign_items.location_id + RLS"
```

---

### Task 2: Prompt Director — campo `location` + inyección como referencia `environment`

**Files:**
- Modify: `lib/prompt-director/types.ts` (agregar `location` a `DirectorContext`)
- Modify: `lib/prompt-director/compilers/seedance.ts` (`buildReferences` + `compileSeedance`)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `DirectorContext`, `buildReferences(ctx)`, `compile(req, ctx)` (existentes).
- Produces: `DirectorContext.location?: { name?: string; description?: string; imagePaths: string[] }`. La imagen de locación se emite como `CompiledReference` con `role: 'environment'`, ubicada tras `character` y antes de `extraImagePaths`.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/prompt-director/prompt-director.test.ts`:

```ts
it('la locación entra como environment tras personaje y antes de extras, y su descripción va al setting', () => {
  const result = compile(
    { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the couple smiles at the camera' },
    {
      product: { name: 'Canvas', imagePaths: ['ws/prod.png'] },
      characters: [{ name: 'Pedro', description: 'man with mustache', masterImagePath: 'ws/pedro.png' }],
      location: { name: 'Living', description: 'a bright modern living room with a gray wall', imagePaths: ['ws/living.png'] },
      extraImagePaths: ['ws/extra.png'],
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const images = result.compiled.references.filter((r) => r.kind === 'image');
  const roles = images.map((r) => r.role);
  // orden: product, character, environment(locación), environment(extra)
  expect(roles).toEqual(['product', 'character', 'environment', 'environment']);
  expect(images[2].storagePath).toBe('ws/living.png'); // la locación va ANTES del extra
  expect(images[3].storagePath).toBe('ws/extra.png');
  expect(result.compiled.prompt).toContain('bright modern living room');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- prompt-director`
Expected: FAIL — `roles` sale `['product','character','environment']` (sin la locación) y el prompt no contiene la descripción.

- [ ] **Step 3: Agregar el campo `location` al tipo**

En `lib/prompt-director/types.ts`, dentro de `DirectorContext` (después de `extraImagePaths`):

```ts
  // Locación de la secuencia: su imagen se re-ancla como referencia environment
  // en cada clip y su descripción refuerza el "dónde". Antes de extraImagePaths
  // en prioridad. v1 usa solo la imagen master (imagePaths[0..]).
  location?: { name?: string; description?: string; imagePaths: string[] };
```

- [ ] **Step 4: Inyectar la locación en `buildReferences`**

En `lib/prompt-director/compilers/seedance.ts`, en `buildReferences`, INSERTAR el bloque de locación JUSTO ANTES del loop de `ctx.extraImagePaths` (antes del comentario `// Referencias extra del refinado`):

```ts
  // Locación de la secuencia: entorno re-anclado en cada clip. Va antes de los
  // extras del refinado en prioridad. Mismo rol environment.
  for (const path of ctx.location?.imagePaths ?? []) {
    pushImage(
      path,
      'environment',
      (n) =>
        `@image${n} is the location/setting — keep the same place, architecture, background, lighting and overall look consistent across shots.`,
    );
  }
```

- [ ] **Step 5: Inyectar la descripción de la locación al prompt**

En `lib/prompt-director/compilers/seedance.ts`, en `compileSeedance`, JUSTO DESPUÉS del bloque `if (ctx.scene?.fragment) sections.push(\`Scene: ...\`)` (la sección "C — Contexto"):

```ts
  if (ctx.location?.description?.trim()) {
    sections.push(`Location: ${ctx.location.description.trim()}.`);
  }
```

Y en la línea de `hasLookReference` (la que hoy es `const hasLookReference = (ctx.extraImagePaths?.length ?? 0) > 0 || !!ctx.templateVideoPath;`), incluir la locación para que su imagen cuente como referencia de luz/look:

```ts
  const hasLookReference =
    (ctx.extraImagePaths?.length ?? 0) > 0 ||
    (ctx.location?.imagePaths?.length ?? 0) > 0 ||
    !!ctx.templateVideoPath;
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `pnpm test -- prompt-director`
Expected: PASS. Además `pnpm typecheck` sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(locaciones): el Prompt Director inyecta la locacion como referencia environment + setting"
```

---

### Task 3: Sequence-chain — helper puro `isLocationMode`

**Files:**
- Modify: `lib/campaigns/sequence-chain.ts`
- Test: `lib/campaigns/sequence-chain.test.ts`

**Interfaces:**
- Produces: `export function isLocationMode(item: { location_id: string | null }): boolean`. Lo consume el orquestador para decidir el modo no-encadenado.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/campaigns/sequence-chain.test.ts`:

```ts
import { isLocationMode } from './sequence-chain';

describe('isLocationMode', () => {
  it('true cuando el item tiene location_id', () => {
    expect(isLocationMode({ location_id: 'loc-1' })).toBe(true);
  });
  it('false cuando location_id es null', () => {
    expect(isLocationMode({ location_id: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- sequence-chain`
Expected: FAIL — `isLocationMode is not a function`.

- [ ] **Step 3: Implementar el helper**

Agregar al final de `lib/campaigns/sequence-chain.ts`:

```ts
// ¿La secuencia de este item va en modo-locación? Sí cuando tiene location_id:
// se genera SIN encadenar (cada escena independiente, re-anclando la locación).
// Todas las escenas de una secuencia comparten el mismo location_id.
export function isLocationMode(item: { location_id: string | null }): boolean {
  return item.location_id != null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- sequence-chain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/sequence-chain.ts lib/campaigns/sequence-chain.test.ts
git commit -m "feat(locaciones): helper puro isLocationMode"
```

---

### Task 4: Orquestador — resolver locación, bypass de encadenado, inyectar al contexto

**Files:**
- Modify: `lib/campaigns/orchestrator.ts`
- Modify: `server-actions/campaigns.ts` (agregar `location_id` al SELECT de items que alimenta `ItemRow`)

**Interfaces:**
- Consumes: `isLocationMode` (Task 3); `DirectorContext.location` (Task 2).
- Produces: `resolveLocations(supabase, workspaceId, locationIds): Promise<Map<string, { name: string; description: string | null; imagePaths: string[] }>>`. `directorContextFor` acepta un 6º parámetro `location?`.

- [ ] **Step 1: Agregar `location_id` a `ItemRow`**

En `lib/campaigns/orchestrator.ts`, en el type `ItemRow`, agregar tras `scene_index`:

```ts
  // Locación de la secuencia (migración 041): no null => modo-locación (sin encadenar).
  location_id: string | null;
```

- [ ] **Step 2: Escribir el helper `resolveLocations`**

En `lib/campaigns/orchestrator.ts`, agregar (junto a `resolvePaths`):

```ts
// Resuelve location_id -> { name, description, imagePaths }. v1 usa SOLO la imagen
// master de la locación (1 por clip); los ángulos se difieren. Valida ownership.
export async function resolveLocations(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  locationIds: string[],
): Promise<Map<string, { name: string; description: string | null; imagePaths: string[] }>> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const out = new Map<string, { name: string; description: string | null; imagePaths: string[] }>();
  if (ids.length === 0) return out;
  const { data: rows } = await supabase
    .from('locations')
    .select('id, workspace_id, name, description, master_image_id')
    .in('id', ids);
  const masterByLoc = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.workspace_id !== workspaceId) continue;
    if (r.master_image_id) masterByLoc.set(r.id as string, r.master_image_id as string);
  }
  const masterIds = [...masterByLoc.values()];
  const paths = await resolvePaths(supabase, workspaceId, masterIds);
  for (const r of rows ?? []) {
    if (r.workspace_id !== workspaceId) continue;
    const masterId = masterByLoc.get(r.id as string);
    const masterPath = masterId ? paths.get(masterId) : undefined;
    out.set(r.id as string, {
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      imagePaths: masterPath ? [masterPath] : [],
    });
  }
  return out;
}
```

- [ ] **Step 3: Aceptar `location` en `directorContextFor`**

En `lib/campaigns/orchestrator.ts`, modificar la firma de `directorContextFor` para aceptar un 6º parámetro y pasarlo al `DirectorContext`:

```ts
function directorContextFor(
  item: ItemRow,
  format: FormatRow | null,
  ctx: CampaignContext,
  templateVideoPath?: string,
  extraImagePaths?: string[],
  location?: { name?: string; description?: string; imagePaths: string[] },
): DirectorContext {
```

Y en el objeto que retorna, agregar (junto a `extraImagePaths`):

```ts
    location: location && location.imagePaths.length ? location : location?.description ? location : undefined,
```

(Pasa la locación si trae imagen o al menos descripción; `undefined` si no hay locación.)

- [ ] **Step 4: Bypass de encadenado en `chainRole`**

En `lib/campaigns/orchestrator.ts`, importar el helper:

```ts
import { isLocationMode, nextSceneItem, shouldReturnLastFrame } from './sequence-chain';
```

En la función interna `chainRole(item)`, agregar como PRIMERA condición (antes del `if (!chaining || !item.sequence_id)`):

```ts
    // Modo-locación: la secuencia NO se encadena. Cada escena se genera
    // independiente (no se salta, no return_last_frame, no chain). Gana sobre
    // el encadenado aunque el backend sea Atlas.
    if (isLocationMode(item)) {
      return { skip: false, isFirst: false, returnLastFrame: false, orphanResume: false };
    }
```

- [ ] **Step 5: Resolver locaciones del lote e inyectarlas por escena**

En `lib/campaigns/orchestrator.ts`, en `enqueueBatch`, tras resolver `extraPaths` (cerca de `const extraPaths = await resolvePaths(...)`), agregar:

```ts
  const locationIds = selected.map((i) => i.location_id).filter((l): l is string => !!l);
  const locations = await resolveLocations(supabase, workspaceId, locationIds);
```

Y en el loop por item, donde se llama `directorContextFor(...)` dentro de `compile(...)`, pasar la locación como 6º argumento:

```ts
      directorContextFor(
        item,
        format,
        ctx,
        item.template_id ? templateVideos.get(item.template_id) : undefined,
        (item.reference_ids ?? []).map((id) => extraPaths.get(id)).filter((p): p is string => !!p),
        item.location_id ? locations.get(item.location_id) : undefined,
      ),
```

- [ ] **Step 6: Agregar `location_id` al SELECT de items**

En `server-actions/campaigns.ts`, en la(s) query(s) de `campaign_items` que arman los `ItemRow` para `enqueueBatch` (las que ya seleccionan `sequence_id, scene_index`), agregar `location_id` a la lista de columnas del `.select(...)`.

- [ ] **Step 7: Verificar typecheck y tests existentes**

Run: `pnpm typecheck` (sin errores — el nuevo campo `location_id` en `ItemRow` debe estar poblado por el SELECT).
Run: `pnpm test -- campaigns` (los tests del orquestador siguen verdes; los items de prueba ahora necesitan `location_id: null` — agregarlo a los fixtures que construyen `ItemRow`).
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/campaigns/orchestrator.ts server-actions/campaigns.ts lib/campaigns/campaigns.test.ts
git commit -m "feat(locaciones): orquestador resuelve locacion, bypassa encadenado e inyecta environment por escena"
```

---

### Task 5: Schema + Server Actions de Locaciones (CRUD)

**Files:**
- Create: `server-actions/locations.ts`

**Interfaces:**
- Produces: `createLocationAction(input)`, `updateLocationAction(id, input)`, `deleteLocationAction(id)` con el tipo `Result<T>` (mismo shape que `server-actions/cast.ts`). `UpsertLocationSchema` (zod). `masterImageId` es OPCIONAL (una locación puede ser solo descripción).

- [ ] **Step 1: Escribir el server action (espejo de `cast.ts`, sin auto-descripción IA)**

Crear `server-actions/locations.ts`:

```ts
'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

// Locación: el "dónde" reutilizable de una secuencia. master_image_id OPCIONAL:
// una locación puede ser solo descripción (sin imagen) — el spec lo permite.
const UpsertLocationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(600).optional(),
  masterImageId: z.string().uuid().optional(),
  referenceImageIds: z.array(z.string().uuid()).max(4).default([]),
});

async function validateImageOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  const { data: refs } = await supabase
    .from('media_references')
    .select('id, workspace_id, type')
    .in('id', ids);
  const valid = new Set(
    (refs ?? [])
      .filter((r) => r.workspace_id === workspaceId && r.type === 'image')
      .map((r) => r.id as string),
  );
  return ids.every((id) => valid.has(id));
}

export async function createLocationAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = UpsertLocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [parsed.data.masterImageId, ...parsed.data.referenceImageIds].filter(
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
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: 'internal_error', message: error?.message };
  revalidatePath('/app/brand/locations');
  return { ok: true, data: { id: data.id as string } };
}

export async function updateLocationAction(id: string, input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = UpsertLocationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const allIds = [parsed.data.masterImageId, ...parsed.data.referenceImageIds].filter(
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
      },
      { count: 'exact' },
    )
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  if (!count) return { ok: false, error: 'not_found' };
  revalidatePath('/app/brand/locations');
  return { ok: true, data: { updated: true } };
}

export async function deleteLocationAction(id: string): Promise<Result<{ deleted: true }>> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'validation_error' };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from('locations')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath('/app/brand/locations');
  return { ok: true, data: { deleted: true } };
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `pnpm typecheck`
Expected: sin errores. (Confirmar que `requireWorkspace` se importa de `@/lib/auth/dal` igual que en `cast.ts`.)

- [ ] **Step 3: Commit**

```bash
git add server-actions/locations.ts
git commit -m "feat(locaciones): server actions CRUD (espejo del Cast, master opcional)"
```

---

### Task 6: UI — pestaña y página de Locaciones bajo "Marca"

**Files:**
- Modify: `app/app/brand/layout.tsx` (agregar la pestaña)
- Create: `app/app/brand/locations/page.tsx`, `app/app/brand/locations/loading.tsx`
- Create: `components/locations/LocationsPage.tsx` (+ form/tarjetas)

**Interfaces:**
- Consumes: `createLocationAction`/`updateLocationAction`/`deleteLocationAction` (Task 5); componentes de subida/selección de imágenes que ya usa el Cast.

- [ ] **Step 1: Agregar la pestaña a Marca**

En `app/app/brand/layout.tsx`, agregar al array `tabs` (tras `Cast`):

```tsx
          { label: 'Locaciones', href: '/app/brand/locations' },
```

- [ ] **Step 2: Crear la página (Server Component) que lista las locaciones**

Tomar como plantilla `app/app/brand/cast/page.tsx` y crear `app/app/brand/locations/page.tsx` con los mismos cambios mecánicos: consulta `locations` del workspace (`select id, name, description, master_image_id, reference_image_ids` por `workspace_id`, orden `created_at desc`), resuelve las URLs de las imágenes igual que la página de Cast, y renderiza `<LocationsPage locations={...} />`. Crear `app/app/brand/locations/loading.tsx` copiando `app/app/brand/cast/loading.tsx`.

- [ ] **Step 3: Crear el componente cliente `LocationsPage`**

Copiar `components/cast/CastPage.tsx` a `components/locations/LocationsPage.tsx` y aplicar los cambios mecánicos:
- Renombrar tipos/props `Character`→`Location`, `character`→`location`.
- Form: campos `name`, `description` (textarea opcional), imagen master (selector/subida, **opcional** — no obligatoria como en Cast), imágenes de referencia opcionales (máx 4).
- Llamar `createLocationAction`/`updateLocationAction`/`deleteLocationAction` en vez de las de Cast.
- QUITAR cualquier paso de auto-descripción por IA (`describeCharacterAction`) — en v1 la descripción es manual.
- Mantener el sistema visual (dark, shadcn, sin emojis).

- [ ] **Step 4: Verificar typecheck y arranque**

Run: `pnpm typecheck`
Expected: sin errores.
Verificación manual (el usuario): `/app/brand/locations` lista, crea, edita y borra locaciones; la pestaña aparece en Marca.

- [ ] **Step 5: Commit**

```bash
git add app/app/brand/layout.tsx app/app/brand/locations components/locations
git commit -m "feat(locaciones): pestana y pagina CRUD de Locaciones bajo Marca"
```

---

### Task 7: Asignar una locación a una secuencia (campaña)

**Files:**
- Modify: `server-actions/campaigns.ts` (nueva action `assignSequenceLocationAction`)
- Modify: el componente del builder de campaña donde hoy se asignan personajes a una secuencia (identificar el que edita `character_ids` por secuencia, p. ej. en `components/campaigns/`)

**Interfaces:**
- Consumes: `listLocations` (query directa); ownership por workspace.
- Produces: `assignSequenceLocationAction(campaignId: string, sequenceId: string, locationId: string | null)` → escribe `location_id` en todos los `campaign_items` de esa secuencia.

- [ ] **Step 1: Escribir la server action de asignación**

Agregar a `server-actions/campaigns.ts`:

```ts
export async function assignSequenceLocationAction(
  campaignId: string,
  sequenceId: string,
  locationId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(campaignId).success || !z.string().uuid().safeParse(sequenceId).success) {
    return { ok: false, error: 'validation_error' };
  }
  if (locationId !== null && !z.string().uuid().safeParse(locationId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership: la campaña es del workspace, y la locación (si la hay) también.
  const { data: camp } = await supabase
    .from('campaigns')
    .select('id, workspace_id')
    .eq('id', campaignId)
    .single();
  if (!camp || camp.workspace_id !== workspace.id) return { ok: false, error: 'forbidden' };
  if (locationId) {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, workspace_id')
      .eq('id', locationId)
      .single();
    if (!loc || loc.workspace_id !== workspace.id) return { ok: false, error: 'forbidden' };
  }

  const { error } = await supabase
    .from('campaign_items')
    .update({ location_id: locationId })
    .eq('campaign_id', campaignId)
    .eq('sequence_id', sequenceId);
  if (error) return { ok: false, error: 'internal_error' };
  revalidatePath(`/app/campaigns/${campaignId}`);
  return { ok: true };
}
```

(Reusar los imports `z`, `requireWorkspace`, `createClient`, `revalidatePath` ya presentes en `server-actions/campaigns.ts`.)

- [ ] **Step 2: Agregar el selector de locación en el builder de secuencia**

En el componente del Campaign Studio donde se asignan personajes a una secuencia (el que muestra/edita `character_ids` por secuencia), agregar un selector de **Locación** (opcional, una por secuencia) poblado con las locaciones del workspace, que al cambiar llama `assignSequenceLocationAction(campaignId, sequenceId, locationId | null)`. Mirror del selector de personajes ya presente; mantener el sistema visual.

- [ ] **Step 3: Verificar typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add server-actions/campaigns.ts components/campaigns
git commit -m "feat(locaciones): asignar una locacion a una secuencia (activa el modo sin-encadenar)"
```

---

### Task 8: Test de integración del modo (orquestador) + verificación final

**Files:**
- Test: `lib/campaigns/campaigns.test.ts`

**Interfaces:**
- Consumes: `isLocationMode`, `resolveLocations`, el bypass de `chainRole` (Tasks 3-4).

- [ ] **Step 1: Escribir el test del bypass de modo-locación**

Si `campaigns.test.ts` ya ejercita `enqueueBatch`/`chainRole` con un cliente Supabase mockeado, agregar un caso: una secuencia de 2 escenas con `location_id` set en ambos items, con `SEEDANCE_PROVIDER=atlas`, encola AMBAS escenas (no salta la 2ª), ninguna con `returnLastFrame`/`chain` en sus params. Si el test de orquestador NO mockea Supabase (solo prueba helpers puros), cubrir en su lugar `isLocationMode` (ya en Task 3) y dejar el camino DB para el smoke del usuario — documentarlo en el commit.

```ts
// Ejemplo del aserto clave (adaptar al harness de mock existente del archivo):
// expect(enqueuedSceneIndexes).toEqual([0, 1]);            // no se salta la 2ª
// expect(insertedParams.every((p) => !('chain' in p))).toBe(true);
// expect(insertedParams.every((p) => p.returnLastFrame !== true)).toBe(true);
```

- [ ] **Step 2: Correr la suite completa y el typecheck**

Run: `pnpm test`
Run: `pnpm typecheck`
Expected: todo verde.

- [ ] **Step 3: Commit**

```bash
git add lib/campaigns/campaigns.test.ts
git commit -m "test(locaciones): el modo-locacion no encadena (encola todas las escenas, sin chain)"
```

- [ ] **Step 4: Smoke real (lo corre el usuario)**

Asignar la locación "Living" a la secuencia de la campaña "Aniversario pareja 2", regenerar, y comparar con `scripts/measure-chain-luma.mjs --dump`: confirmar que las pieles del canvas YA NO acumulan textura/pecas escena a escena (cero herencia de frame).

---

## Self-Review

**Cobertura del spec:**
- §Modelo de datos → Task 1. §Biblioteca/UI → Tasks 5,6. §Asignación a la secuencia → Task 7. §Comportamiento de generación → Tasks 3,4. §Prompt-director → Task 2. §Testing → Tasks 2,3,8. §Casos borde: locación borrada (FK `set null`, Task 1); locación sin imagen (`masterImageId` opcional Task 5 + `location?.description` Task 2/4); secuencias existentes intactas (bypass solo si `location_id`, Task 4); ModelArk y Atlas (bypass gana sobre `chaining`, Task 4).
- Gap consciente: la consistencia de personas depende del Cast (documentado en el spec como límite conocido; no requiere tarea).

**Type consistency:** `DirectorContext.location` (Task 2) ↔ `resolveLocations` retorna `{ name, description, imagePaths }` y `directorContextFor` lo recibe (Task 4) ↔ `isLocationMode({ location_id })` (Task 3) ↔ `ItemRow.location_id: string | null` (Task 4). `UpsertLocationSchema.masterImageId` opcional (Task 5) ↔ locación sin imagen soportada en compiler (Task 2). Nombres de acciones consistentes: `create/update/deleteLocationAction`, `assignSequenceLocationAction`.

**Placeholders:** las Tasks 6 y 7 (UI) usan instrucciones de "espejar archivo X con estos cambios" — concreto en codebase existente, no placeholder; el código de lógica (migración, prompt-director, orquestador, server actions) va completo.
