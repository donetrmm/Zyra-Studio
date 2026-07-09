# V3 Fase 1 — Fundación de datos: entidad `products` · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir `products` como entidad workspace-level bajo una marca, migrar las campañas existentes, y hacer que el orchestrator resuelva el producto **del clip** (`campaign_items.product_id`) con fallback limpio a `product_brief` — sin cambiar el output de las campañas actuales.

**Architecture:** Aditiva y no-destructiva. Nueva tabla `products` (+ `campaign_products` join, + columnas `campaign_items.product_id`/`reference_selection`). Un backfill sintetiza un product por campaña existente desde `product_brief` + imágenes del brand_kit y enlaza `product_id` a sus ítems. La resolución por-clip se inyecta en un **único punto** (`directorContextFor`, ya por-ítem) vía un parámetro opcional `productOverride`; cuando el ítem no trae producto resuelto, se usa el producto de `ctx` (comportamiento actual). Lógica pura (`lib/campaigns/products.ts`) separada del IO (`orchestrator.ts`), espejando el par `reference-selection.ts` (puro) / `reference-pool.ts` (IO).

**Tech Stack:** Next.js 15 (App Router) + Supabase (Postgres + RLS) + TypeScript + vitest + pnpm.

## Global Constraints

- **Migración inmutable una vez aplicada.** Nueva migración = nuevo archivo; la siguiente es `060_products.sql`. Idempotente (`create table`, `drop policy if exists`, `add column if not exists`, backfill con guardas `not exists`).
- **Orden de despliegue:** prod sigue `development`; las migraciones NO se auto-aplican → aplicar `060` vía MCP **antes** de desplegar código que lea columnas nuevas. Backfill acotado (loop por campaña), nada de UPDATE masivo (incidente de disco lleno).
- **RLS en toda tabla con datos de usuario** (`is_workspace_member(workspace_id) or is_admin()`); INSERT con `with check`. Tablas sin `user_id` → espejar `character_outfits` (migración 059): policies `_read/_insert/_update/_delete` sobre `is_workspace_member`.
- **Sin `any`** (usar `unknown` + narrowing o tipos explícitos). **Sin APIs reales en tests** (Gemini/fal/ElevenLabs/QStash). Tests puros con vitest, junto al fuente, nombres en español.
- **`gen_random_uuid()`**, FKs con `on delete` explícito, `created_at`/`updated_at` + trigger `touch_updated_at` en tablas mutables.
- **Compat:** las campañas actuales deben generar **idéntico**. El fallback a `ctx` (producto de `product_brief`) es la red.

---

## Estructura de archivos

- **Crear** `supabase/migrations/060_products.sql` — schema `products` + `campaign_products` + columnas en `campaign_items` + backfill.
- **Crear** `lib/campaigns/products.ts` — PURO: tipo `ProductRow` + `productInventoryFromRow()`. Sin `server-only`.
- **Crear** `lib/campaigns/products.test.ts` — tests del mapper puro.
- **Modificar** `lib/campaigns/orchestrator.ts` — `ItemRow += product_id`; nueva `resolveItemProduct()` (IO); `directorContextFor` acepta `productOverride?`; el loop batch resuelve el producto por ítem (con cache).
- **Modificar** `lib/campaigns/orchestrator.test.ts` (o `lib/campaigns/products.test.ts`) — test del override en `directorContextFor`.
- **Modificar** `server-actions/storyboard.ts` — call sites B/C: `select` incluye `product_id`; resolver producto del ítem y pasarlo.
- **Modificar** `server-actions/campaigns.ts` — el `select` que arma `ItemRow` (regen individual) incluye `product_id`; al crear campaña, crear un `product` + fila `campaign_products`.

---

## Task 1: Migración `060_products.sql` (schema + backfill)

**Files:**
- Create: `supabase/migrations/060_products.sql`

**Interfaces:**
- Produces: tabla `products` (columnas abajo), tabla `campaign_products(campaign_id, product_id)`, columnas `campaign_items.product_id uuid null`, `campaign_items.reference_selection jsonb null`. Backfill: 1 product por campaña con `product_brief not null`, enlazado a sus ítems.

- [ ] **Step 1: Escribir la migración**

```sql
-- 060_products.sql
-- V3 Fase 1: entidad products (multi-producto por campaña). Hoy el producto vive
-- partido (imágenes en brand_kits.product_image_ids, ficha en campaigns.product_brief).
-- products lo junta como entidad workspace-level bajo una marca. Backfill: un
-- product por campaña existente, enlazado a sus items. No rompe: el orchestrator
-- cae a product_brief cuando el item no trae product_id.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  brand_id uuid references brand_kits(id) on delete set null,   -- null = sin marca (without-brand)
  name text not null,
  slug text,                                                    -- referencia estable para el matcher (los LLM citan slugs, no UUIDs)
  medium text,
  height_cm numeric,
  width_cm numeric,
  thickness_mm numeric,
  weight_kg numeric,
  visual_details text,
  palette jsonb,
  product_image_ids uuid[] not null default '{}',
  packaging_image_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists products_workspace_id_idx on products(workspace_id);
create index if not exists products_brand_id_idx on products(brand_id);

alter table products enable row level security;
drop policy if exists "products_read" on products;
create policy "products_read" on products for select
  using (is_workspace_member(workspace_id) or is_admin());
drop policy if exists "products_insert" on products;
create policy "products_insert" on products for insert
  with check (is_workspace_member(workspace_id));
drop policy if exists "products_update" on products;
create policy "products_update" on products for update
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "products_delete" on products;
create policy "products_delete" on products for delete
  using (is_workspace_member(workspace_id));

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at before update on products
  for each row execute function touch_updated_at();

-- Pool de productos por campaña (join). Sin workspace_id: RLS via la campaña.
create table if not exists campaign_products (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, product_id)
);
create index if not exists campaign_products_product_id_idx on campaign_products(product_id);

alter table campaign_products enable row level security;
drop policy if exists "campaign_products_read" on campaign_products;
create policy "campaign_products_read" on campaign_products for select
  using (exists (select 1 from campaigns c where c.id = campaign_id
    and (is_workspace_member(c.workspace_id) or is_admin())));
drop policy if exists "campaign_products_insert" on campaign_products;
create policy "campaign_products_insert" on campaign_products for insert
  with check (exists (select 1 from campaigns c where c.id = campaign_id
    and is_workspace_member(c.workspace_id)));
drop policy if exists "campaign_products_delete" on campaign_products;
create policy "campaign_products_delete" on campaign_products for delete
  using (exists (select 1 from campaigns c where c.id = campaign_id
    and is_workspace_member(c.workspace_id)));

-- Producto por clip + prioridad de referencias por clip.
alter table campaign_items
  add column if not exists product_id uuid references products(id) on delete set null,
  add column if not exists reference_selection jsonb;

-- Backfill: un product por campaña "studio" (product_brief no nulo; los folders de
-- colección lo tienen null). Idempotente: solo si la campaña aún no tiene product.
do $$
declare r record; pid uuid;
begin
  for r in
    select c.id as campaign_id, c.workspace_id, c.brand_kit_id, c.product_brief,
           bk.product_image_ids as bk_product_ids, bk.packaging_image_ids as bk_pkg_ids
    from campaigns c
    left join brand_kits bk on bk.id = c.brand_kit_id
    where c.product_brief is not null
      and not exists (select 1 from campaign_products cp where cp.campaign_id = c.id)
  loop
    insert into products (
      workspace_id, brand_id, name, slug, medium,
      height_cm, width_cm, thickness_mm, weight_kg,
      visual_details, palette, product_image_ids, packaging_image_ids)
    values (
      r.workspace_id, r.brand_kit_id,
      coalesce(nullif(r.product_brief->>'productName',''), 'Producto'),
      lower(regexp_replace(coalesce(r.product_brief->>'productName','producto'), '[^a-zA-Z0-9]+', '-', 'g')),
      r.product_brief->>'medium',
      (r.product_brief->>'heightCm')::numeric,
      (r.product_brief->>'widthCm')::numeric,
      (r.product_brief->>'thicknessMm')::numeric,
      (r.product_brief->>'weightKg')::numeric,
      r.product_brief->>'visualDetails',
      case when r.product_brief ? 'palette' then r.product_brief->'palette' else null end,
      coalesce(r.bk_product_ids, '{}'), coalesce(r.bk_pkg_ids, '{}'))
    returning id into pid;

    insert into campaign_products (campaign_id, product_id) values (r.campaign_id, pid);
    update campaign_items set product_id = pid
      where campaign_id = r.campaign_id and product_id is null;
    update campaign_items ci set reference_selection = c.reference_selection
      from campaigns c
      where c.id = r.campaign_id and ci.campaign_id = r.campaign_id
        and c.reference_selection is not null and ci.reference_selection is null;
  end loop;
end $$;
```

- [ ] **Step 2: Verificar que `touch_updated_at()` existe** (lo usan otras tablas mutables; si no existe, la migración falla al aplicar). Buscar en `supabase/migrations/`:

Run: `grep -rl "function touch_updated_at" supabase/migrations/`
Expected: al menos un archivo lo define. Si NO existe, añadir al inicio de `060`:
```sql
create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
```

- [ ] **Step 3: Aplicar la migración vía MCP** (Supabase `apply_migration`, project `dzqhngfwlgxkmxohlwun`), name `060_products`.

- [ ] **Step 4: Verificar schema + backfill** (MCP `execute_sql`):

Run:
```sql
select count(*) as products from products;
select count(*) as items_con_product from campaign_items where product_id is not null;
select count(*) as campanas_studio from campaigns where product_brief is not null;
```
Expected: `products` ≥ `campanas_studio`; `items_con_product` > 0. Verificar que una campaña conocida (Anuncio #12 V2, `1e285ad1-4cd0-4437-a665-e9c0751c24f5`) tenga sus ítems con `product_id` no nulo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/060_products.sql
git commit -m "feat(db): entidad products + campaign_products + product_id por clip (V3 fase 1)"
```

---

## Task 2: Mapper puro `productInventoryFromRow`

**Files:**
- Create: `lib/campaigns/products.ts`
- Test: `lib/campaigns/products.test.ts`

**Interfaces:**
- Produces:
  - `type ProductRow` (fila snake_case de `products`).
  - `productInventoryFromRow(row: ProductRow, resolved: { imagePaths: string[]; packagingImagePaths?: string[]; imageUsages?: Record<string,string> }): ProductInventory`.
- Consumes: `ProductInventory` de `@/lib/prompt-director/types`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/campaigns/products.test.ts
import { describe, it, expect } from 'vitest';
import { productInventoryFromRow, type ProductRow } from './products';

const baseRow: ProductRow = {
  id: 'p1', workspace_id: 'w1', brand_id: 'b1', name: 'Canvas Familiar', slug: 'canvas-familiar',
  medium: 'canvas print', height_cm: 60, width_cm: 90, thickness_mm: 7, weight_kg: 3.5,
  visual_details: 'a family photo', palette: ['warm'], product_image_ids: ['i1'], packaging_image_ids: ['pk1'],
};

describe('productInventoryFromRow', () => {
  it('mapea la fila + paths resueltos a ProductInventory', () => {
    const inv = productInventoryFromRow(baseRow, {
      imagePaths: ['url/i1'], packagingImagePaths: ['url/pk1'], imageUsages: { 'url/i1': 'front' },
    });
    expect(inv.name).toBe('Canvas Familiar');
    expect(inv.medium).toBe('canvas print');
    expect(inv.heightCm).toBe(60);
    expect(inv.widthCm).toBe(90);
    expect(inv.thicknessMm).toBe(7);
    expect(inv.weightKg).toBe(3.5);
    expect(inv.visualDetails).toBe('a family photo');
    expect(inv.palette).toEqual(['warm']);
    expect(inv.imagePaths).toEqual(['url/i1']);
    expect(inv.imageUsages).toEqual({ 'url/i1': 'front' });
    expect(inv.packagingImagePaths).toEqual(['url/pk1']);
  });

  it('nulls → undefined (no ensucia el ProductInventory)', () => {
    const inv = productInventoryFromRow(
      { ...baseRow, medium: null, height_cm: null, width_cm: null, thickness_mm: null, weight_kg: null, visual_details: null, palette: null },
      { imagePaths: [] },
    );
    expect(inv.medium).toBeUndefined();
    expect(inv.heightCm).toBeUndefined();
    expect(inv.visualDetails).toBeUndefined();
    expect(inv.palette).toBeUndefined();
    expect(inv.imageUsages).toBeUndefined();
    expect(inv.packagingImagePaths).toBeUndefined();
  });

  it('name vacío → "the product" (paridad con directorContextFor)', () => {
    expect(productInventoryFromRow({ ...baseRow, name: '' }, { imagePaths: [] }).name).toBe('the product');
  });
});
```

- [ ] **Step 2: Correr el test para ver que falla**

Run: `pnpm vitest run lib/campaigns/products.test.ts`
Expected: FAIL — `Cannot find module './products'`.

- [ ] **Step 3: Implementar el mapper puro**

```ts
// lib/campaigns/products.ts
// Lógica PURA de products (sin IO; el IO vive en orchestrator.ts). Espeja el par
// reference-selection.ts (puro) / reference-pool.ts (IO). NO importar 'server-only'.
import type { ProductInventory } from '@/lib/prompt-director/types';

export type ProductRow = {
  id: string;
  workspace_id: string;
  brand_id: string | null;
  name: string;
  slug: string | null;
  medium: string | null;
  height_cm: number | null;
  width_cm: number | null;
  thickness_mm: number | null;
  weight_kg: number | null;
  visual_details: string | null;
  palette: string[] | null;
  product_image_ids: string[] | null;
  packaging_image_ids: string[] | null;
};

// Mapea una fila `products` + paths ya resueltos → ProductInventory, idéntico al
// mapeo product.* de directorContextFor, para que la resolución por-clip sea
// indistinguible de la de campaña.
export function productInventoryFromRow(
  row: ProductRow,
  resolved: { imagePaths: string[]; packagingImagePaths?: string[]; imageUsages?: Record<string, string> },
): ProductInventory {
  return {
    name: row.name || 'the product',
    ...(row.visual_details ? { visualDetails: row.visual_details } : {}),
    ...(row.palette && row.palette.length ? { palette: row.palette } : {}),
    imagePaths: resolved.imagePaths,
    ...(resolved.imageUsages && Object.keys(resolved.imageUsages).length ? { imageUsages: resolved.imageUsages } : {}),
    ...(row.height_cm != null ? { heightCm: row.height_cm } : {}),
    ...(row.width_cm != null ? { widthCm: row.width_cm } : {}),
    ...(row.medium ? { medium: row.medium } : {}),
    ...(row.thickness_mm != null ? { thicknessMm: row.thickness_mm } : {}),
    ...(row.weight_kg != null ? { weightKg: row.weight_kg } : {}),
    ...(resolved.packagingImagePaths && resolved.packagingImagePaths.length
      ? { packagingImagePaths: resolved.packagingImagePaths }
      : {}),
  };
}
```

- [ ] **Step 4: Correr el test — pasa**

Run: `pnpm vitest run lib/campaigns/products.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/products.ts lib/campaigns/products.test.ts
git commit -m "feat(products): mapper puro productInventoryFromRow"
```

---

## Task 3: `resolveItemProduct` (IO) + `directorContextFor` acepta `productOverride`

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`ItemRow`, `directorContextFor`, nueva `resolveItemProduct`)
- Test: `lib/campaigns/products.test.ts` (añadir el bloque del override)

**Interfaces:**
- Consumes: `productInventoryFromRow`, `ProductRow` (Task 2); `resolvePaths`, `resolveUsages` (ya en orchestrator).
- Produces:
  - `ItemRow` con `product_id: string | null`.
  - `directorContextFor(item, format, ctx, templateVideoPath?, extraImagePaths?, location?, productOverride?)` — nuevo 7º param opcional; si viene, pisa `product.*` (con el gate de packaging por formato intacto).
  - `resolveItemProduct(supabase, workspaceId, productId, includePackaging): Promise<ProductInventory | null>`.

- [ ] **Step 1: Añadir `product_id` a `ItemRow`** (`lib/campaigns/orchestrator.ts`, dentro de `type ItemRow`, junto a `location_id`):

```ts
  // V3 fase 1: producto de ESTE clip. null = usa el producto de campaña (product_brief) como fallback.
  product_id: string | null;
```

- [ ] **Step 2: Escribir el test del override que falla** (añadir a `lib/campaigns/products.test.ts`):

```ts
import { directorContextFor, type ItemRow, type CampaignContext } from './orchestrator';
import type { ProductInventory } from '@/lib/prompt-director/types';

function makeCtx(): CampaignContext {
  return {
    productName: 'Producto de Campaña', visualDetails: 'campaign details', palette: ['navy'],
    productImagePaths: ['url/campaign'], packagingImagePaths: [], productImageUsages: {},
    productHeightCm: 10, productWidthCm: 10, productMedium: 'mug', productThicknessMm: 2, productWeightKg: 0.3,
    characters: new Map(), language: 'es',
  };
}
function makeItem(): ItemRow {
  return {
    id: 'it1', campaign_id: 'c1', format_id: null, template_id: null, model_slug: 'seedance',
    duration_s: 8, aspect_ratio: '9:16', scene: null, audio: true, character_id: null, character_ids: null,
    reference_ids: null, scene_prompt: 'x', status: 'draft', sequence_id: null, scene_index: 0,
    location_id: null, storyboard_image_id: null, character_state_hint: null, character_outfit_hint: null,
    product_id: 'p1',
  };
}

describe('directorContextFor — productOverride', () => {
  const override: ProductInventory = { name: 'Producto del Clip', imagePaths: ['url/clip'], medium: 'canvas print' };

  it('sin override → usa el producto de campaña (comportamiento actual)', () => {
    const dc = directorContextFor(makeItem(), null, makeCtx());
    expect(dc.product?.name).toBe('Producto de Campaña');
    expect(dc.product?.imagePaths).toEqual(['url/campaign']);
  });

  it('con override → el producto del clip pisa al de campaña', () => {
    const dc = directorContextFor(makeItem(), null, makeCtx(), undefined, undefined, undefined, override);
    expect(dc.product?.name).toBe('Producto del Clip');
    expect(dc.product?.imagePaths).toEqual(['url/clip']);
    expect(dc.product?.medium).toBe('canvas print');
  });
});
```

- [ ] **Step 3: Correr el test — falla**

Run: `pnpm vitest run lib/campaigns/products.test.ts`
Expected: FAIL — `directorContextFor` no acepta 7 args / el override no se aplica.

- [ ] **Step 4: Añadir el param `productOverride` a `directorContextFor`** (`lib/campaigns/orchestrator.ts`). En la firma, añadir el 7º param; en el objeto de retorno, reemplazar el bloque `product:` por uno que use el override si viene (conservando el gate de packaging por formato):

Firma (añadir la última línea antes del `): DirectorContext {`):
```ts
  location?: { name?: string; description?: string; imagePaths: string[]; scaleMap?: { path: string; notes?: string } },
  productOverride?: import('@/lib/prompt-director/types').ProductInventory,
): DirectorContext {
```

Bloque `product:` del retorno (reemplaza el actual):
```ts
    product: productOverride
      ? {
          ...productOverride,
          packagingImagePaths: format?.required_refs.includes('packaging')
            ? productOverride.packagingImagePaths
            : undefined,
        }
      : {
          name: ctx.productName,
          visualDetails: ctx.visualDetails,
          palette: ctx.palette,
          imagePaths: ctx.productImagePaths,
          imageUsages: ctx.productImageUsages,
          heightCm: ctx.productHeightCm,
          widthCm: ctx.productWidthCm,
          medium: ctx.productMedium,
          thicknessMm: ctx.productThicknessMm,
          weightKg: ctx.productWeightKg,
          packagingImagePaths: format?.required_refs.includes('packaging')
            ? ctx.packagingImagePaths
            : undefined,
        },
```

- [ ] **Step 5: Implementar `resolveItemProduct`** (IO, en `lib/campaigns/orchestrator.ts`, junto a `resolvePaths`). Importar el mapper puro arriba del archivo: `import { productInventoryFromRow, type ProductRow } from './products';`

```ts
// Resuelve el producto de UN clip (campaign_items.product_id) a ProductInventory,
// con sus imágenes y usages resueltos. Devuelve null si no existe o no es del
// workspace (el caller cae al producto de campaña). Espeja el bloque de producto
// de loadCampaignContext.
export async function resolveItemProduct(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  productId: string,
  includePackaging: boolean,
): Promise<import('@/lib/prompt-director/types').ProductInventory | null> {
  const { data: row } = await supabase
    .from('products')
    .select(
      'id, workspace_id, brand_id, name, slug, medium, height_cm, width_cm, thickness_mm, weight_kg, visual_details, palette, product_image_ids, packaging_image_ids',
    )
    .eq('id', productId)
    .single();
  if (!row || (row as { workspace_id: string }).workspace_id !== workspaceId) return null;
  const productIds = ((row as ProductRow).product_image_ids ?? []) as string[];
  const packagingIds = includePackaging ? (((row as ProductRow).packaging_image_ids ?? []) as string[]) : [];
  const paths = await resolvePaths(supabase, workspaceId, [...productIds, ...packagingIds]);
  const imagePaths = productIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
  const packagingImagePaths = packagingIds.map((id) => paths.get(id)).filter((p): p is string => !!p);
  const usages = await resolveUsages(supabase, workspaceId, productIds);
  const imageUsages: Record<string, string> = {};
  for (const id of productIds) {
    const path = paths.get(id);
    const usage = usages.get(id);
    if (path && usage) imageUsages[path] = usage;
  }
  return productInventoryFromRow(row as ProductRow, {
    imagePaths,
    packagingImagePaths,
    ...(Object.keys(imageUsages).length ? { imageUsages } : {}),
  });
}
```

- [ ] **Step 6: Correr el test — pasa**

Run: `pnpm vitest run lib/campaigns/products.test.ts`
Expected: PASS. Luego `pnpm typecheck` — sin errores (los 3 call sites siguen compilando: el 7º param es opcional).

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/products.test.ts
git commit -m "feat(orchestrator): resolveItemProduct + productOverride por clip (fallback a campaña)"
```

---

## Task 4: Cablear la resolución de producto por clip en los 3 call sites

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (loop batch, ~:1097-1146)
- Modify: `server-actions/storyboard.ts` (call sites B ~:222-287 y C ~:576-614; los `ItemRow` que arma y los `.select`)
- Modify: `server-actions/campaigns.ts` (el `.select` de regen individual, :2575, para que `ItemRow` traiga `product_id`)

**Interfaces:**
- Consumes: `resolveItemProduct` (Task 3), `directorContextFor` con `productOverride` (Task 3).

- [ ] **Step 1: Loop batch del orchestrator.** Antes del `for` (~:1097), crear un cache de productos por id; dentro del loop, resolver el producto del ítem y pasarlo como 7º arg a `directorContextFor`.

Antes del loop:
```ts
  const itemProductCache = new Map<string, import('@/lib/prompt-director/types').ProductInventory | null>();
```
Dentro del loop, antes de `const baseDirCtx = applyReferenceSelection(`:
```ts
    let itemProduct: import('@/lib/prompt-director/types').ProductInventory | null = null;
    if (item.product_id) {
      if (!itemProductCache.has(item.product_id)) {
        itemProductCache.set(
          item.product_id,
          await resolveItemProduct(supabase, workspaceId, item.product_id, campaign.include_packaging !== false),
        );
      }
      itemProduct = itemProductCache.get(item.product_id) ?? null;
    }
```
Y añadir el 7º arg a la llamada `directorContextFor(item, format, ctx, ..., (() => {...})(), itemProduct ?? undefined)`.
> Nota: verificar que `supabase` y `workspaceId` estén en scope en el loop (lo están: `loadCampaignContext` se llamó con ellos arriba; si `supabase` no está, obtenerlo con `const supabase = await createClient();` antes del loop).

- [ ] **Step 2: Call site B (`server-actions/storyboard.ts`, panel FLUX).** (a) Añadir `product_id` al `.select` del ítem (:110). (b) Añadir `product_id: item.product_id` al `itemRow` que arma (:270-287). (c) Resolver y pasar el producto:

Antes de `const dirCtx = applyReferenceSelection(` (:285):
```ts
  const itemProduct = item.product_id
    ? await resolveItemProduct(supabase, workspace.id, item.product_id, true)
    : null;
```
Cambiar la llamada:
```ts
    directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation, itemProduct ?? undefined),
```
Importar `resolveItemProduct` desde `@/lib/campaigns/orchestrator` (junto a los imports existentes de ese módulo).

- [ ] **Step 3: Call site C (`server-actions/storyboard.ts`, refine Nano).** Igual que B: `product_id` en el `.select`, en el `itemRow`, y resolver + pasar como 7º arg (:612).

- [ ] **Step 4: `server-actions/campaigns.ts` regen individual (:2575).** Añadir `product_id` al `.select` que alimenta el `ItemRow`, y (si arma un `ItemRow` para `directorContextFor`) resolver + pasar igual que B/C. Si ese path NO llama `directorContextFor` directamente (usa el loop del orchestrator), basta con incluir `product_id` en el select.

- [ ] **Step 5: Verificación** (no hay unit test de IO; se valida con typecheck + suite + build):

Run: `pnpm typecheck && pnpm vitest run && pnpm build`
Expected: typecheck sin errores; **939+ tests verdes** (ninguno roto); build OK. La paridad se apoya en: para campañas backfilled, `item.product_id` resuelve a un producto sintetizado del `product_brief` → `ProductInventory` idéntico al de `ctx`; cuando `product_id` es null → usa `ctx` (comportamiento actual).

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/orchestrator.ts server-actions/storyboard.ts server-actions/campaigns.ts
git commit -m "feat(orchestrator): los 3 call sites resuelven el producto por clip"
```

---

## Task 5: Al crear campaña, escribir un `product` + `campaign_products`

**Files:**
- Modify: `server-actions/campaigns.ts` (tras el insert de la campaña, ~:485-511)

**Interfaces:**
- Consumes: `mergeBriefOverrides(brief, overrides)` (ya se usa para `product_brief`), el `brand_kit_id` (`kitId`) y las imágenes del brand_kit.
> Alcance fase 1: se crea el product y se enlaza a `campaign_products` (la biblioteca queda poblada para campañas nuevas). Setear `campaign_items.product_id` en cada clip **al crearse el plan** es trabajo de la Fase 3 (asignación); mientras, los clips nuevos caen limpio al producto de campaña vía `ctx`.

- [ ] **Step 1: Tras obtener `inserted.id`** (el id de la campaña) y con `brief` ya mergeado, insertar el product y el join. Añadir después del bloque que valida `inserted`:

```ts
  // V3 fase 1: además del product_brief (compat/fallback), materializar el
  // producto como entidad y enlazarlo al pool de la campaña.
  {
    const b = mergeBriefOverrides(brief, parsed.data.briefOverrides) as {
      productName?: string; medium?: string; visualDetails?: string; palette?: string[];
      heightCm?: number; widthCm?: number; thicknessMm?: number; weightKg?: number;
    };
    let productImageIds: string[] = [];
    let packagingImageIds: string[] = [];
    if (kitId) {
      const { data: kit } = await supabase
        .from('brand_kits')
        .select('product_image_ids, packaging_image_ids, reference_image_ids')
        .eq('id', kitId)
        .single();
      if (kit) {
        const raw = (kit.product_image_ids ?? []) as string[];
        productImageIds = raw.length ? raw : ((kit.reference_image_ids ?? []) as string[]);
        packagingImageIds = (kit.packaging_image_ids ?? []) as string[];
      }
    }
    const name = b.productName?.trim() || 'Producto';
    const { data: product } = await supabase
      .from('products')
      .insert({
        workspace_id: workspace.id,
        brand_id: kitId,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        medium: b.medium ?? null,
        height_cm: b.heightCm ?? null,
        width_cm: b.widthCm ?? null,
        thickness_mm: b.thicknessMm ?? null,
        weight_kg: b.weightKg ?? null,
        visual_details: b.visualDetails ?? null,
        palette: b.palette ?? null,
        product_image_ids: productImageIds,
        packaging_image_ids: packagingImageIds,
      })
      .select('id')
      .single();
    if (product) {
      await supabase.from('campaign_products').insert({ campaign_id: inserted.id, product_id: product.id });
    }
  }
```
> Nota: `workspace`, `supabase`, `kitId`, `brief`, `parsed` ya están en scope en esa función (los usa el insert de la campaña). No falla la creación si el product no se inserta (best-effort; el fallback a `product_brief` cubre).

- [ ] **Step 2: Verificación**

Run: `pnpm typecheck && pnpm build`
Expected: sin errores.
Smoke (lo corre el usuario, sin API real en tests): crear una campaña nueva y confirmar por SQL que aparece un `products` + fila `campaign_products` para esa campaña.

- [ ] **Step 3: Commit**

```bash
git add server-actions/campaigns.ts
git commit -m "feat(campaigns): al crear campaña se materializa el product + campaign_products"
```

---

## Self-review (coverage del spec)

- **`products` (ficha+imágenes+slug):** Task 1 (schema) + Task 5 (escritura). ✓
- **`campaign_products` pool:** Task 1 + Task 5. ✓
- **`campaign_items.product_id` + `reference_selection`:** Task 1. ✓
- **Migración product_brief → product por campaña, enlazado a ítems:** Task 1 (backfill). ✓
- **Orchestrator resuelve el producto del ítem con fallback:** Tasks 3-4. ✓
- **Ingest/creación escribe un product:** Task 5. ✓
- **Reglas repo (migración vía MCP antes de deploy; sin APIs reales en tests; pnpm; migración inmutable):** Global Constraints + Task 1 steps. ✓
- **Consistencia de tipos:** `ProductRow`/`productInventoryFromRow` (Task 2) usados por `resolveItemProduct` (Task 3) y el override de `directorContextFor` (Task 3), cableados en Task 4. ✓

**No en fase 1 (fases siguientes):** UI de biblioteca de productos y pre-selección del pool (Fase 2); inferencia + tablero de asignación por clip y setear `product_id` por clip al crear el plan (Fase 3); `reference_selection` por clip aplicada en el contexto (Fase 4).
