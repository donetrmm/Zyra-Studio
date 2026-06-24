# AM — Manifiesto de assets con uso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anotar cada imagen de producto con una descripción de uso y consumirla en el prompt — el compiler cita cada referencia por su propósito y añade un hint de que las múltiples vistas son el MISMO producto.

**Architecture:** Columna `media_references.usage_description` + una action para escribirla (auto en el 3/4 de P01, manual en el Brand Kit). El orchestrator resuelve el uso por imagen de producto a un mapa `ProductInventory.imageUsages` (path→uso); el compiler lo cita y añade el hint multi-vista. `imagePaths` queda `string[]` (mapa aparte, baja-ripple).

**Tech Stack:** Next.js 15, Supabase, TypeScript, Vitest, pnpm. Migración aditiva.

## Global Constraints

- **pnpm**: `pnpm typecheck`, `pnpm vitest run <archivo>`. Full suite: `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`.
- **No `any`**: tipos explícitos; `vi.mocked()` en mocks.
- **No emojis** en código/UI. Dark mode, estilo existente.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): el compiler y el schema se testean puros; lo DB-bound (ownership, resolución real) y la UI por smoke.
- **`imagePaths` NO cambia** (sigue `string[]`); el uso viaja en `imageUsages?: Record<string,string>` (path→uso).
- **Solo imágenes de producto** en v1 (no cast/empaque/audio).
- **Migración aditiva** (`add column` nullable); NUNCA modificar una aplicada. La aplica el controlador (no un subagente) vía MCP `apply_migration`.
- **Commits sin trailer `Co-Authored-By`.**

---

### Task 1: Migración `044_media_reference_usage.sql`

**Files:**
- Create: `supabase/migrations/044_media_reference_usage.sql`

**Interfaces:**
- Produces: columna `media_references.usage_description text` (nullable). La consumen Tasks 2, 4, 5.

> Aplicación: el archivo se crea aquí; el **controlador** aplica la migración al proyecto live vía MCP `apply_migration` antes del smoke. Los tests de este plan son puros y no la requieren.

- [ ] **Step 1: Crear el archivo**

```sql
-- 044_media_reference_usage.sql
-- AM: para qué sirve cada asset (vista del producto). El compiler lo cita junto
-- a la referencia para que el modelo entienda qué muestra cada imagen.
alter table media_references add column usage_description text;

comment on column media_references.usage_description is
  'AM: descripcion de uso del asset (p. ej. "three-quarter view", "logo close-up"). El compiler la cita junto a la referencia.';
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: sin errores (solo es un .sql nuevo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/044_media_reference_usage.sql
git commit -m "feat(db): columna media_references.usage_description (AM)"
```

---

### Task 2: `setReferenceUsageAction`

**Files:**
- Modify: `server-actions/media-references.ts` (schema + action)
- Test: `server-actions/media-references.test.ts` (NUEVO — solo el schema, puro)

**Interfaces:**
- Consumes: la columna `usage_description` (Task 1).
- Produces: `export async function setReferenceUsageAction(input: unknown): Promise<Result<{ id: string }>>` — escribe `usage_description` en una `media_reference` del workspace (string vacío → null). Lo consume Task 5.
- Produces: `export const SetReferenceUsageSchema` (zod) para testear la validación.

- [ ] **Step 1: Escribir el test del schema (RED)**

Crear `server-actions/media-references.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SetReferenceUsageSchema } from './media-references';

describe('SetReferenceUsageSchema', () => {
  it('acepta refId uuid + usage corto', () => {
    expect(SetReferenceUsageSchema.safeParse({
      refId: '11111111-1111-4111-a111-111111111111', usage: 'three-quarter view',
    }).success).toBe(true);
  });
  it('acepta usage vacío (para limpiar)', () => {
    expect(SetReferenceUsageSchema.safeParse({
      refId: '11111111-1111-4111-a111-111111111111', usage: '',
    }).success).toBe(true);
  });
  it('rechaza refId no-uuid', () => {
    expect(SetReferenceUsageSchema.safeParse({ refId: 'nope', usage: 'x' }).success).toBe(false);
  });
  it('rechaza usage demasiado largo', () => {
    expect(SetReferenceUsageSchema.safeParse({
      refId: '11111111-1111-4111-a111-111111111111', usage: 'x'.repeat(121),
    }).success).toBe(false);
  });
});
```

> Nota: los UUID llevan el nibble de variante RFC (`4111-a111`); un UUID de dígitos repetidos (`1111-1111`) falla bajo zod v4.

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run server-actions/media-references.test.ts`
Expected: FAIL — `SetReferenceUsageSchema` no exportada.

- [ ] **Step 3: Implementar el schema + la action**

En `server-actions/media-references.ts` (junto a las demás actions; `z`, `requireWorkspace`, `createClient`, `Result` ya están importados):

```ts
export const SetReferenceUsageSchema = z.object({
  refId: z.string().uuid(),
  usage: z.string().trim().max(120),
});

// AM: anota una media_reference con su descripcion de uso (o la limpia con "").
// Ownership: el update exige id + workspace_id del usuario (ademas de RLS).
export async function setReferenceUsageAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = SetReferenceUsageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  try {
    const { workspace } = await requireWorkspace();
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from('media_references')
      .update({ usage_description: parsed.data.usage || null })
      .eq('id', parsed.data.refId)
      .eq('workspace_id', workspace.id)
      .select('id')
      .single();
    if (error || !row) return { ok: false, error: 'internal_error', message: error?.message ?? 'no row' };
    return { ok: true, data: { id: row.id as string } };
  } catch (e) {
    return { ok: false, error: 'internal_error', message: (e as Error).message };
  }
}
```

- [ ] **Step 4: Correr el test (GREEN) + typecheck**

Run: `pnpm vitest run server-actions/media-references.test.ts` y `pnpm typecheck`
Expected: PASS los 4 tests; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add server-actions/media-references.ts server-actions/media-references.test.ts
git commit -m "feat(media-references): setReferenceUsageAction anota el uso de un asset (AM)"
```

---

### Task 3: Consumo en el compiler + tipo `imageUsages`

**Files:**
- Modify: `lib/prompt-director/types.ts` (`ProductInventory.imageUsages?`)
- Modify: `lib/prompt-director/compilers/seedance.ts` (cita por uso + hint multi-vista)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas (solo el tipo, que añade aquí).
- Produces: `ProductInventory.imageUsages?: Record<string, string>` (path→uso). Lo puebla Task 4.

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/prompt-director/prompt-director.test.ts` (reusa el `compile`/`CompileRequest`/`DirectorContext` ya importados):

```ts
  it('cita la imagen de producto con su uso cuando hay imageUsages (AM)', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the product on a table' } as CompileRequest,
      { product: { name: 'Serum', imagePaths: ['ws/a.png', 'ws/b.png'], imageUsages: { 'ws/b.png': 'three-quarter view' } } } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.compiled.prompt).toMatch(/shown here as three-quarter view/);
      expect(res.compiled.prompt).toMatch(/SAME single product/i);
    }
  });

  it('una sola imagen de producto: sin hint multi-vista', () => {
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'the product on a table' } as CompileRequest,
      { product: { name: 'Serum', imagePaths: ['ws/a.png'] } } as DirectorContext,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.compiled.prompt).not.toMatch(/SAME single product/i);
  });
```

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: FAIL — la cita no incluye el uso ni el hint; además `imageUsages` no existe en el tipo (error de tipo en el test).

- [ ] **Step 3: Añadir el campo al tipo**

En `lib/prompt-director/types.ts`, en `ProductInventory` (línea 46, tras `imagePaths`):

```ts
  // AM: descripcion de uso por imagen (path -> "three-quarter view"). El compiler
  // la cita junto a la referencia. Opcional; ausente = cita sin uso.
  imageUsages?: Record<string, string>;
```

- [ ] **Step 4: Consumir en el compiler**

En `lib/prompt-director/compilers/seedance.ts`, reemplazar el bloque de imágenes de producto (líneas 172-182) por:

```ts
  // Producto: máx 3 ángulos como referencia (frontal, perfil, detalle) para
  // dejar slots libres; el Brand Kit puede traer más.
  const productImages = ctx.product?.imagePaths.slice(0, 3) ?? [];
  const productUsages = ctx.product?.imageUsages ?? {};
  for (const path of productImages) {
    const usage = productUsages[path];
    pushImage(
      path,
      'product',
      (n) =>
        `@image${n} is the product${usage ? `, shown here as ${usage}` : ''} — keep its design, colors, logo and proportions consistent; any printed photo or text on it stays a still print, not animated.`,
    );
  }
  // AM: con 2+ vistas, dile al modelo que son el MISMO objeto (evita que trate
  // el 3/4 generado como un producto distinto).
  if (productImages.length >= 2) {
    lines.push(
      'The product reference images show the SAME single product from different views; reconcile them into one consistent object — do not treat them as different products.',
    );
  }
```

- [ ] **Step 5: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts` y `pnpm typecheck`
Expected: PASS los 2 tests nuevos; sin regresión; typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): cita la imagen de producto por su uso + hint multi-vista (AM)"
```

---

### Task 4: Orchestrator — resolver `usage_description` → `imageUsages`

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`resolveUsages` helper; `CampaignContext.productImageUsages`; `loadCampaignContext`; `directorContextFor`)
- Test: `lib/campaigns/director-context.test.ts` (ya existe, de P16)

**Interfaces:**
- Consumes: `ProductInventory.imageUsages` (Task 3); la columna `usage_description` (Task 1).
- Produces: `CampaignContext.productImageUsages?: Record<string,string>`; `directorContextFor` setea `imageUsages`.

- [ ] **Step 1: Escribir el test (RED)**

En `lib/campaigns/director-context.test.ts`, agregar al `ctxWith` un parámetro de usages o un test nuevo (reusa el patrón del archivo; `directorContextFor` y `CampaignContext` ya se importan):

```ts
  it('propaga productImageUsages al imageUsages del producto (AM)', () => {
    const ctx: CampaignContext = {
      productName: 'Serum',
      productImagePaths: ['ws/a.png', 'ws/b.png'],
      productImageUsages: { 'ws/b.png': 'three-quarter view' },
      packagingImagePaths: [],
      characters: new Map(),
      language: 'es',
    };
    const dc = directorContextFor(item, null, ctx);
    expect(dc.product?.imageUsages).toEqual({ 'ws/b.png': 'three-quarter view' });
  });
```

(`item` es el ItemRow mínimo ya definido en el archivo.)

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: FAIL — `CampaignContext` no tiene `productImageUsages` (error de tipo) / `dc.product.imageUsages` es undefined.

- [ ] **Step 3: Añadir `productImageUsages` a `CampaignContext`**

En `lib/campaigns/orchestrator.ts`, en el type `CampaignContext` (tras `packagingImagePaths`):

```ts
  // AM: uso por imagen de producto (path -> "three-quarter view"). Opcional.
  productImageUsages?: Record<string, string>;
```

- [ ] **Step 4: Añadir el resolver `resolveUsages`**

En `lib/campaigns/orchestrator.ts`, junto a `resolvePaths` (~línea 110):

```ts
// AM: resuelve usage_description por media_reference id (validando workspace).
// Dedicado para no tocar resolvePaths (compartido por cast/locacion).
async function resolveUsages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from('media_references')
    .select('id, usage_description, workspace_id')
    .in('id', ids);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.workspace_id === workspaceId && row.usage_description) {
      map.set(row.id as string, row.usage_description as string);
    }
  }
  return map;
}
```

- [ ] **Step 5: Poblar `productImageUsages` en `loadCampaignContext`**

En `lib/campaigns/orchestrator.ts`, dentro del bloque del brand_kit, después de construir `productImagePaths` (línea 204), agregar:

```ts
      const usages = await resolveUsages(supabase, workspaceId, productIds);
      for (const id of productIds) {
        const path = paths.get(id);
        const usage = usages.get(id);
        if (path && usage) productImageUsages[path] = usage;
      }
```

Y declarar `productImageUsages` junto a `productImagePaths`/`packagingImagePaths` (línea 187):

```ts
  const productImageUsages: Record<string, string> = {};
```

Y añadir `productImageUsages` al objeto que retorna `loadCampaignContext` (junto a `language`):

```ts
    productImageUsages,
```

- [ ] **Step 6: Setear `imageUsages` en `directorContextFor`**

En `lib/campaigns/orchestrator.ts`, en `directorContextFor`, en el objeto `product` (junto a `imagePaths: ctx.productImagePaths`):

```ts
      imageUsages: ctx.productImageUsages,
```

- [ ] **Step 7: Correr el test (GREEN) + typecheck + suite**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`, luego `pnpm typecheck`, luego `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`
Expected: PASS el test nuevo; typecheck limpio; suite completa verde.

- [ ] **Step 8: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts
git commit -m "feat(campaigns): resuelve usage_description del producto a imageUsages (AM)"
```

---

### Task 5: UI — anotar el uso en el Brand Kit (manual + auto-set del 3/4)

**Files:**
- Modify: `app/app/brand/kits/page.tsx` (extender la query para traer `usage_description`; pasar un `usages` map)
- Modify: `components/brand-kits/BrandKitsPage.tsx` (prop `usages`; input de uso por imagen en `BrandKitEditor`; auto-set en el botón 3/4)

**Interfaces:**
- Consumes: `setReferenceUsageAction(input): Promise<Result<{ id: string }>>` (Task 2, `@/server-actions/media-references`).
- Produces: nada para otras tasks (hoja).

> Sin unit test (UI; smoke). Verifica con `pnpm typecheck`.

- [ ] **Step 1: Traer `usage_description` en la página**

En `app/app/brand/kits/page.tsx` (líneas 26-44), el bloque actual arma `previews` con un `.select('id, storage_url')` y un `Promise.all(refs.map(...))`. Cámbialo a:

```ts
  const previews: Record<string, string> = {};
  const usages: Record<string, string> = {};
  if (allImageIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, usage_description')
      .in('id', allImageIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (r.usage_description) usages[r.id as string] = r.usage_description as string;
        if (!r.storage_url) return;
        try {
          previews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
        } catch {
          // sin preview: el uploader muestra placeholder
        }
      }),
    );
  }

  return <BrandKitsPage kits={(kits ?? []) as never} previews={previews} usages={usages} />;
```

- [ ] **Step 2: Prop `usages` en `BrandKitsPage` y `BrandKitEditor`**

En `components/brand-kits/BrandKitsPage.tsx`:

(a) La firma de `BrandKitsPage` acepta `usages`:

```ts
export function BrandKitsPage({ kits: initial, previews, usages }: { kits: BrandKit[]; previews: Record<string, string>; usages: Record<string, string> }) {
```

(b) Pásalo a `BrandKitEditor` donde se renderiza (junto a `previews`):

```tsx
        previews={previews}
        usages={usages}
```

(c) `BrandKitEditor` acepta `usages` en su firma (junto a `previews`).

- [ ] **Step 3: Estado de usos + input por imagen en `BrandKitEditor`**

Dentro de `BrandKitEditor`, tras los estados de imágenes:

```ts
  const [productUsages, setProductUsages] = useState<Record<string, string>>(
    Object.fromEntries(productImages.map((i) => [i.id, usages[i.id] ?? ''])),
  );

  async function saveUsage(refId: string, value: string) {
    setProductUsages((prev) => ({ ...prev, [refId]: value }));
    const res = await setReferenceUsageAction({ refId, usage: value });
    if (!res.ok) toast.error(res.message || 'No se pudo guardar el uso');
  }
```

Y debajo del `ReferenceImagesUploader` de producto, una lista compacta de inputs por imagen:

```tsx
        {productImages.length > 0 ? (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Uso de cada vista (opcional)</label>
            {productImages.map((img) => (
              <input
                key={img.id}
                type="text"
                defaultValue={productUsages[img.id] ?? ''}
                placeholder="¿Qué muestra? p.ej. frontal en blanco, vista 3/4, detalle del logo"
                onBlur={(e) => { if (e.target.value !== (usages[img.id] ?? '')) void saveUsage(img.id, e.target.value.trim()); }}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-[12px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            ))}
          </div>
        ) : null}
```

- [ ] **Step 4: Auto-set del 3/4 (extiende P01)**

En el handler `generateThreeQuarter` de `BrandKitEditor` (de P01), después de prepender la imagen generada, anótala automáticamente:

```ts
      await setReferenceUsageAction({ refId: out.refId, usage: 'three-quarter view' });
```

(va justo después del `setProductImages(...)` del 3/4; si falla, no es crítico — la imagen ya existe.)

Asegúrate de importar `setReferenceUsageAction` desde `@/server-actions/media-references`.

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add app/app/brand/kits/page.tsx components/brand-kits/BrandKitsPage.tsx
git commit -m "feat(brand-kits): anota el uso de cada vista de producto + auto-set del 3/4 (AM)"
```

---

## Verificación final (tras las 5 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run` — suite verde (incluye los tests del schema, el compiler y el orchestrator).
- [ ] **Controlador aplica la migración 044** al proyecto live vía MCP `apply_migration` (chequear antes con `list_tables` que la columna no exista).
- [ ] Smoke del usuario:
  1. Brand Kit con 1 foto de producto subida + el 3/4 generado por P01 (debe quedar auto-anotado "three-quarter view").
  2. Describir la subida ("frontal en blanco") en el input nuevo; recargar y confirmar que persiste.
  3. Generar una campaña; en el prompt compilado, cada `@image` de producto lleva su uso y aparece el hint "SAME single product".

## Notas para el implementador

- `imagePaths` NO cambia de tipo: el uso viaja en el mapa `imageUsages` (path→uso). No conviertas `imagePaths` a objetos.
- El hint multi-vista NO nombra `@imageN` específicos (robusto al orden de citado); es una instrucción general sobre las imágenes de producto.
- `resolveUsages` es un resolver DEDICADO; no modifiques `resolvePaths` (lo comparten cast/locación).
- Auto-set del 3/4: el `await setReferenceUsageAction(...)` es best-effort; si falla, la imagen 3/4 ya está en el kit (no bloquees el flujo).
- El input de uso persiste en `onBlur` solo si cambió (evita escrituras redundantes).
