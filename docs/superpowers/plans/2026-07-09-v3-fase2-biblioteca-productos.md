# V3 Fase 2 — Biblioteca de productos + pool por campaña · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para implementar tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** Un brand kit puede tener varios **productos** (entidad reusable con ficha + imágenes); se gestionan **anidados dentro de cada kit**; al crear una campaña el usuario **elige qué productos** entran (pool `campaign_products`).

**Architecture:** Entidad `products` (ya migrada en Fase 1) como hogar único del producto. La sección de producto sale del editor de Brand Kit (kit = marca pura). CRUD de productos vía server actions (`Result<T>`+zod). El wizard de creación gana un multi-select de productos de la marca que escribe `campaign_products`.

**Tech Stack:** Next.js 15 App Router, Supabase (RLS `is_workspace_member`), zod, React Server Components + `'use client'` para editores, pnpm, vitest (sin APIs reales).

## Global Constraints

- **pnpm** siempre (`pnpm typecheck`, `pnpm test`, `pnpm build`). Nunca npm.
- **Sin `any`**: `unknown` + narrowing o tipo explícito.
- **Server actions**: `'use server'` + `import 'server-only'`, tipo `Result<T> = { ok:true; data:T } | { ok:false; error:string; message?:string }`, validación con zod (`Schema.safeParse`), `requireWorkspace()`, ownership por `.eq('workspace_id', workspace.id)`, `revalidatePath` al mutar. Espeja `server-actions/brand-kits.ts`.
- **Schemas** en `lib/schemas/` con patrón `export const XSchema = z.object({...})` seguido de `export type X = z.infer<typeof XSchema>`; comentarios en español sobre los límites.
- **Tests sin APIs reales**: solo lógica pura se testea con vitest. Los server actions y la UI se verifican con `pnpm typecheck` + `pnpm build` + review (no se mockea Supabase).
- **No emojis** en código/UI. Dark mode, acento `#009fff`. Componentes shadcn primero.
- **`products` (columnas reales)**: `id, workspace_id, brand_id (null=sin marca), name (NOT NULL), slug, medium, height_cm, width_cm, thickness_mm, weight_kg, visual_details, palette (jsonb), product_image_ids (uuid[]), packaging_image_ids (uuid[]), created_at, updated_at`. `campaign_products (campaign_id, product_id)` PK compuesta.
- **No romper la generación actual**: una campaña sin productos seleccionados sigue funcionando por el fallback a `product_brief` (Fase 1). La asignación de `product_id` **por clip** es Fase 3, no aquí.

## File Structure

- `lib/campaigns/product-slug.ts` (nuevo) — helper puro `productSlug(name)` (extraído para testear; hoy el slug se genera inline en la migración y en `createCampaignStudioAction`).
- `lib/schemas/products.ts` (nuevo) — `CreateProductSchema`, `UpdateProductSchema`, `SetProductImagesSchema` + tipos inferidos.
- `server-actions/products.ts` (nuevo) — `listProductsAction`, `createProductAction`, `updateProductAction`, `deleteProductAction`, `setProductImagesAction`.
- `components/products/ProductEditor.tsx` (nuevo, `'use client'`) — form de un producto (ficha + imágenes + ángulos IA/refine).
- `components/products/ProductsSection.tsx` (nuevo, `'use client'`) — lista de productos de un kit + botón "Nuevo producto" + abre `ProductEditor`.
- `components/brand-kits/BrandKitsPage.tsx` (modificar) — quitar sección de producto del `BrandKitEditor` y del `BrandKitCard`/parent; montar `ProductsSection` por kit.
- `app/app/brand/kits/page.tsx` (modificar) — cargar productos por kit + previews de sus imágenes.
- `components/campaigns/CampaignStudioWizard.tsx` (modificar) — sección multi-select de productos de la marca; enviar `productIds`.
- `app/app/campaigns/new/page.tsx` (modificar) — cargar productos por kit; cambiar filtro `productImages>0` → "la marca tiene ≥1 producto".
- `lib/schemas/campaigns.ts` (modificar) — `CreateCampaignStudioSchema += productIds`.
- `server-actions/campaigns.ts` (modificar) — `createCampaignStudioAction` escribe `campaign_products` de `productIds`; auto-materialización solo si `productIds` vacío.

---

### Task 1: Helper de slug puro + schemas de producto

**Files:**
- Create: `lib/campaigns/product-slug.ts`
- Create: `lib/campaigns/product-slug.test.ts`
- Create: `lib/schemas/products.ts`
- Create: `lib/schemas/products.test.ts`

**Interfaces:**
- Produces: `export function productSlug(name: string): string` — minúsculas, `[^a-z0-9]+`→`-`, recorta guiones de los extremos; string vacío o solo símbolos → `'producto'`. Debe replicar la expresión de la migración 060 (`lower(regexp_replace(coalesce(name,'producto'), '[^a-zA-Z0-9]+', '-', 'g'))`) pero además recortando guiones de borde.
- Produces: `CreateProductSchema`, `UpdateProductSchema`, `SetProductImagesSchema` (+ `z.infer` tipos).

- [ ] **Step 1: Test de `productSlug`**

```ts
// lib/campaigns/product-slug.test.ts
import { describe, it, expect } from 'vitest';
import { productSlug } from './product-slug';

describe('productSlug', () => {
  it('normaliza a kebab minúsculo', () => {
    expect(productSlug('Canvas Familiar 90x60')).toBe('canvas-familiar-90x60');
  });
  it('recorta guiones de los extremos', () => {
    expect(productSlug('  ¡Retrato! ')).toBe('retrato');
  });
  it('cae a "producto" cuando queda vacío', () => {
    expect(productSlug('—')).toBe('producto');
    expect(productSlug('')).toBe('producto');
  });
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test product-slug` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar `productSlug`**

```ts
// lib/campaigns/product-slug.ts
// Slug estable para el matcher (los LLM citan slugs, no UUIDs). Espeja la
// expresión del backfill de la migración 060, con recorte de guiones de borde.
export function productSlug(name: string): string {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'producto';
}
```

- [ ] **Step 4: Correr y ver pasar** — `pnpm test product-slug` → PASS.

- [ ] **Step 5: Schemas de producto**

```ts
// lib/schemas/products.ts
import { z } from 'zod';

// Ficha física del producto. Todo opcional salvo el nombre: un producto puede
// existir con solo un nombre y una imagen. Las medidas anclan la escala en el
// storyboard (sin ellas sale a tamaño arbitrario).
export const CreateProductSchema = z.object({
  brandId: z.string().uuid().nullable().optional(), // null = producto sin marca
  name: z.string().trim().min(1).max(120),
  medium: z.string().trim().max(120).optional().nullable(),
  heightCm: z.number().positive().max(10000).optional().nullable(),
  widthCm: z.number().positive().max(10000).optional().nullable(),
  thicknessMm: z.number().positive().max(100000).optional().nullable(),
  weightKg: z.number().positive().max(100000).optional().nullable(),
  visualDetails: z.string().trim().max(2000).optional().nullable(),
  palette: z.array(z.string().trim().min(1).max(50)).max(12).optional().nullable(),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

// Update: mismo shape, todos los campos opcionales (patch parcial) salvo que
// name, si viene, sigue siendo no vacío.
export const UpdateProductSchema = CreateProductSchema.partial().extend({
  name: z.string().trim().min(1).max(120).optional(),
});
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

// Imágenes de producto/empaque: ids de media_references del workspace (ownership
// se valida en la action). Máximos como el kit (4 producto, 2 empaque).
export const SetProductImagesSchema = z.object({
  productImageIds: z.array(z.string().uuid()).max(4),
  packagingImageIds: z.array(z.string().uuid()).max(2),
});
export type SetProductImagesInput = z.infer<typeof SetProductImagesSchema>;
```

- [ ] **Step 6: Test de schemas** (valida happy + rechazo)

```ts
// lib/schemas/products.test.ts
import { describe, it, expect } from 'vitest';
import { CreateProductSchema, SetProductImagesSchema } from './products';

describe('CreateProductSchema', () => {
  it('acepta nombre solo', () => {
    expect(CreateProductSchema.safeParse({ name: 'Canvas' }).success).toBe(true);
  });
  it('rechaza nombre vacío', () => {
    expect(CreateProductSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
  it('acepta ficha completa', () => {
    const r = CreateProductSchema.safeParse({
      name: 'Canvas Familiar', brandId: '11111111-1111-1111-1111-111111111111',
      medium: 'canvas', heightCm: 60, widthCm: 90, palette: ['#112233'],
    });
    expect(r.success).toBe(true);
  });
});

describe('SetProductImagesSchema', () => {
  it('rechaza >4 imágenes de producto', () => {
    const ids = Array.from({ length: 5 }, () => '11111111-1111-1111-1111-111111111111');
    expect(SetProductImagesSchema.safeParse({ productImageIds: ids, packagingImageIds: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 7: Correr suite** — `pnpm test product-slug products` → PASS. Luego `pnpm typecheck`.

- [ ] **Step 8: Commit** — `feat(v3): slug puro de producto y schemas zod de products`.

---

### Task 2: Server actions CRUD de productos

**Files:**
- Create: `server-actions/products.ts`
- Test: (ninguno unit — server action con `server-only`; se verifica con typecheck+build+review, como `brand-kits.ts`)

**Interfaces:**
- Consumes: `CreateProductSchema`, `UpdateProductSchema`, `SetProductImagesSchema` (Task 1), `productSlug` (Task 1).
- Produces:
  - `listProductsAction(brandId?: string): Promise<Result<ProductListRow[]>>` — productos del workspace; si `brandId` viene, filtra por marca. `ProductListRow` = fila de `products` (todas las columnas).
  - `createProductAction(input: unknown): Promise<Result<{ id: string }>>`
  - `updateProductAction(id: string, input: unknown): Promise<Result<{ updated: true }>>`
  - `deleteProductAction(id: string): Promise<Result<{ deleted: true }>>`
  - `setProductImagesAction(id: string, input: unknown): Promise<Result<{ updated: true }>>`

- [ ] **Step 1: Escribir `server-actions/products.ts`** (espeja `brand-kits.ts` verbatim en estructura)

Reglas exactas:
- Encabezado `'use server'` + `import 'server-only'` + imports (`revalidatePath`, `z` no necesario aquí porque los schemas viven en `lib/schemas/products`, `requireWorkspace`, `createClient`, los schemas, `productSlug`).
- `type Result<T>` idéntico al de `brand-kits.ts:9`.
- `createProductAction`: `CreateProductSchema.safeParse`; si `brandId` presente, **validar que ese brand_kit pertenece al workspace** (`select id from brand_kits where id=brandId and workspace_id=ws` → si no existe, `{ ok:false, error:'forbidden' }`); insertar en `products` con `workspace_id`, `brand_id: brandId ?? null`, `name`, `slug: productSlug(name)`, y las columnas de ficha (`medium, height_cm, width_cm, thickness_mm, weight_kg, visual_details, palette`), `product_image_ids: []`, `packaging_image_ids: []`; `revalidatePath('/app/brand/kits')`. Devuelve `{ id }`.
- `updateProductAction`: `UpdateProductSchema.safeParse`; construir objeto `update` solo con los campos presentes (patrón de `updateBrandKitAction:76-81`); si `name` viene, recalcular `slug`; si `brandId` viene y no es null, validar ownership del kit; aplicar `.eq('id', id).eq('workspace_id', ws)`; `revalidatePath`.
- `setProductImagesAction`: `SetProductImagesSchema.safeParse`; validar ownership de cada media_reference (`type='image'` y `workspace_id`) **igual que `setBrandKitImagesAction:112-126`**; update `product_image_ids`/`packaging_image_ids` con `.eq('id',id).eq('workspace_id',ws)`; `revalidatePath`.
- `deleteProductAction`: delete `.eq('id',id).eq('workspace_id',ws)`; `revalidatePath`. (Los `campaign_products`/`campaign_items.product_id` caen por FK `on delete cascade`/`set null`.)
- `listProductsAction`: `select('*')` de `products` por workspace, orden `created_at desc`; si `brandId` param, `.eq('brand_id', brandId)`.

- [ ] **Step 2: `pnpm typecheck`** → limpio.
- [ ] **Step 3: `pnpm build`** → compila.
- [ ] **Step 4: Commit** — `feat(v3): server actions CRUD de products`.

---

### Task 3: Editor de producto + sección anidada (UI, sin cablear al kit todavía)

**Files:**
- Create: `components/products/ProductEditor.tsx` (`'use client'`)
- Create: `components/products/ProductsSection.tsx` (`'use client'`)

**Interfaces:**
- Consumes: `createProductAction`, `updateProductAction`, `deleteProductAction`, `setProductImagesAction` (Task 2); `ReferenceImagesUploader` + `type RefImage` (`components/shared/ReferenceImagesUploader.tsx`); `generateProductAngle`, `refineProductImage`, `isGenError`, `type ProductAngleView` (`components/creation/generate`); `getReferencePathsAction` (mismo que usa BrandKitsPage para resolver storagePath).
- Produces:
  - `type ProductView = { id, brand_id, name, slug, medium, height_cm, width_cm, thickness_mm, weight_kg, visual_details, palette, product_image_ids, packaging_image_ids }` (espeja `ProductRow` de `lib/campaigns/products.ts`, con `palette: string[]|null`).
  - `ProductsSection({ brandKitId, products, previews, angleCost }): JSX` — lista de tarjetas de producto + "Nuevo producto"; abre `ProductEditor` en un panel/modal.
  - `ProductEditor({ brandKitId, product, previews, angleCost, onClose, onSaved })` — form con: nombre; ficha física (medium, alto/ancho cm, grosor mm, peso kg, detalles visuales, paleta como chips de color reutilizando el editor de paleta de `BrandKitEditor:452-484`); `ReferenceImagesUploader label="Imágenes de producto" max=4`; botones de ángulo IA (`generateProductAngle` 3/4 y perfil, con `angleCost`) y retoque por imagen (`refineProductImage`) — copiar los handlers `generateAngleView`/`adoptRefinedView` de `BrandKitsPage.tsx:274-314`; `ReferenceImagesUploader label="Empaque" max=2`.

Detalle de guardado: al crear, `createProductAction` (obtiene id) → luego `setProductImagesAction(id, {productImageIds, packagingImageIds})`. Al editar, `updateProductAction(id, fields)` + `setProductImagesAction`. `onSaved` refresca la lista (`router.refresh()`).

- [ ] **Step 1: `ProductEditor.tsx`** — form controlado; estado de imágenes con `RefImage[]` (patrón de `BrandKitEditor:234-242`); reusar los handlers de ángulo/refine. Sin `any`.
- [ ] **Step 2: `ProductsSection.tsx`** — grid de tarjetas (nombre, medidas, conteo de imágenes) + "Nuevo producto"; borrar con confirm (`deleteProductAction`).
- [ ] **Step 3: `pnpm typecheck` + `pnpm build`** → limpio (aún no se importa desde ninguna página; los componentes compilan solos).
- [ ] **Step 4: Commit** — `feat(v3): editor y lista de productos anidados (UI)`.

---

### Task 4: Cablear productos al brand kit y quitar la sección de producto del kit

**Files:**
- Modify: `app/app/brand/kits/page.tsx`
- Modify: `components/brand-kits/BrandKitsPage.tsx`

**Interfaces:**
- Consumes: `ProductsSection` (Task 3); `listProductsAction` o lectura directa de `products` en la page server.
- La page carga, por workspace: kits (como hoy) + **todos los productos** (`products` del workspace) + previews de las imágenes de producto de todos ellos; los pasa a `BrandKitsPage`.

- [ ] **Step 1: `app/app/brand/kits/page.tsx`** — añadir lectura de `products` (`select('*').eq('workspace_id', ws).order('created_at', desc)`) y resolver previews de sus `product_image_ids`+`packaging_image_ids` (reusar el patrón de resolución de previews que ya existe para las imágenes del kit). Pasar `products` y `productPreviews` a `<BrandKitsPage>`.
- [ ] **Step 2: `BrandKitsPage.tsx` — quitar la sección de producto del `BrandKitEditor`**: eliminar el state de producto/empaque/usages (234-248), `saveUsage` (250-254), `generateAngleView`/`ANGLE_LABEL` (274-301), `adoptRefinedView` (306-314), el JSX de imágenes de producto/empaque/ángulos (352-450), y en `handleSave` (316-339) quitar la llamada a `setBrandKitImagesAction` (el kit ya no guarda imágenes de producto). Mantener `detectFromImage` **solo si** aún aplica a marca; si depende de `productImages`, quitarlo también. El editor de kit queda: name, colors, fonts, tone, guidelines.
- [ ] **Step 3: `BrandKitsPage.tsx` — quitar del parent/card lo de producto**: eliminar `openImprove` (52-63) y la parte de imágenes de producto de `handleAiSave` (65-93) — el wizard IA "Crear con IA" ya no adjunta imágenes de producto al kit; deja crear solo la marca. Quitar el botón "Mejorar" (`onImprove`) del `BrandKitCard` (217-219, 160). Ajustar el conteo de imágenes del card (210) para no leer product ids (o mostrar nº de productos de la marca).
- [ ] **Step 4: `BrandKitsPage.tsx` — montar `ProductsSection`**: en cada `BrandKitCard` (o debajo, expandible), renderizar `<ProductsSection brandKitId={kit.id} products={productsByBrand[kit.id] ?? []} previews={productPreviews} angleCost={angleCost} />`. Filtrar `products` por `brand_id === kit.id`.
- [ ] **Step 5: Ajustar tipos/props** de `BrandKitsPage` (36) y `BrandKit` (19-30): quitar `product_image_ids`/`packaging_image_ids` del tipo `BrandKit` (o dejarlos ignorados); añadir `products`/`productPreviews` a props.
- [ ] **Step 6: `pnpm typecheck` + `pnpm build`** → limpio. Verificar que no queden imports colgados (`generateProductAngle`, `refineProductImage`, `setBrandKitImagesAction`, `analyzeKitFromImageAction` si ya no se usan).
- [ ] **Step 7: Commit** — `feat(v3): productos anidados en el kit; el kit queda como marca pura`.

---

### Task 5: Wizard de creación — multi-select de productos de la marca

**Files:**
- Modify: `app/app/campaigns/new/page.tsx`
- Modify: `components/campaigns/CampaignStudioWizard.tsx`

**Interfaces:**
- La page carga, por cada kit, sus productos (`products` where `brand_id = kit.id`), con al menos `{ id, name, product_image_ids.length }`. Pasa `productsByKit: Record<string, ProductOption[]>` al wizard, donde `ProductOption = { id, name, imageCount }`.
- El filtro actual `brandKits.filter(k => k.productImages > 0)` (page 42) cambia a: **incluir un kit si la marca tiene ≥1 producto** (o mantener kits con product_image_ids legacy para compat). Usar `productsByKit[k.id]?.length > 0` OR `k.productImages > 0`.

- [ ] **Step 1: `app/app/campaigns/new/page.tsx`** — leer `products` del workspace; agrupar por `brand_id`; construir `productsByKit`. Ajustar el filtro de kits. Pasar `productsByKit` al `<CampaignStudioWizard>`.
- [ ] **Step 2: `CampaignStudioWizard.tsx`** — nueva prop `productsByKit`. State `selectedProductIds: string[]` (análogo a `selectedCharacterIds:160`). Insertar un `<section>` entre "Tu producto" (termina ~465) y "Nombre de campaña" (~467), visible solo cuando `mode==='kit' && brandKitId`: multi-select (checkboxes/toggles) de `productsByKit[brandKitId]`. Default: todos seleccionados. Si la marca no tiene productos, mostrar hint "Crea productos en Brand Kits" y no bloquear (cae al flujo legacy).
- [ ] **Step 3:** en `runCreate` (285-305) añadir `productIds: selectedProductIds` al payload de `createCampaignStudioAction`.
- [ ] **Step 4: `pnpm typecheck` + `pnpm build`** → limpio.
- [ ] **Step 5: Commit** — `feat(v3): paso de selección de productos en el wizard de campaña`.

---

### Task 6: Persistir el pool `campaign_products` al crear campaña

**Files:**
- Modify: `lib/schemas/campaigns.ts`
- Modify: `server-actions/campaigns.ts`

**Interfaces:**
- Consumes: `productIds` del payload del wizard (Task 5).
- `CreateCampaignStudioSchema += productIds: z.array(z.string().uuid()).max(50).optional()`.

- [ ] **Step 1: `lib/schemas/campaigns.ts`** — añadir `productIds: z.array(z.string().uuid()).max(50).optional()` a `CreateCampaignStudioSchema` (75-137). Comentario: pool de productos pre-seleccionados de la marca.
- [ ] **Step 2: `server-actions/campaigns.ts` `createCampaignStudioAction`** — en el bloque 513-564:
  - Si `input.productIds?.length`: **validar ownership** (los products son del workspace y, si el kit está fijado, `brand_id` coincide o es null) e insertar `campaign_products` `{ campaign_id, product_id }` por cada uno (best-effort con `console.warn` en error, como el patrón actual). **NO** auto-materializar el producto del brief en este caso.
  - Si `productIds` vacío/ausente: mantener la auto-materialización actual (513-564) intacta (fallback de compat).
- [ ] **Step 2b:** Verificar que `mergeBriefOverrides` y el resto del flujo no dependan del producto auto-materializado cuando hay `productIds` (el orchestrator cae a `product_brief` si el ítem no trae `product_id`; la asignación por clip es Fase 3 — aquí solo se llena el pool).
- [ ] **Step 3: `pnpm typecheck` + `pnpm build`** → limpio.
- [ ] **Step 4: `pnpm test`** — corre la suite completa; ninguna regresión (los tests de `campaigns`/`director-context`/`products` siguen verdes).
- [ ] **Step 5: Commit** — `feat(v3): la creación de campaña escribe el pool campaign_products`.

---

## Cierre de fase

Tras Task 6: review final de rama (delta de Fase 2) + smoke manual del usuario (crear un producto en un kit, crear campaña eligiendo productos, verificar `campaign_products`). La asignación de `product_id` **por clip** y la inferencia son **Fase 3**.
