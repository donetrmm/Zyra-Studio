# Multi-producto por clip · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un clip (`campaign_item`) puede llevar cualquier subconjunto de productos del pool (`product_ids uuid[]`); la inferencia asigna varios cuando el guion los nombra, el tablero los edita con multi-select, y el compiler Seedance los describe/referencia con mitigación anti-conteo. Badge ámbar en cualquier clip cuyo pool estimado supere 9 imágenes.

**Architecture:** Spec en `docs/superpowers/specs/2026-07-15-multi-producto-por-clip-design.md`. `campaign_items.product_ids uuid[]` (espeja `character_ids`); `DirectorContext.product` → `products: ProductInventory[]` con **paridad exacta** cuando hay 1 producto; presupuesto de refs por producto (1→3, 2→2, 3+→1) centralizado en un helper puro que también alimenta el badge de la UI. La cadena (Atlas) re-ancla los productos vía `chain.productCount`.

**Tech Stack:** Next.js 15 App Router, Supabase, zod, RSC + `'use client'`, pnpm, vitest.

## Global Constraints

- **pnpm** siempre (`pnpm test`, `pnpm typecheck`, `pnpm build`). Nunca npm.
- **Sin `any`**: `unknown` + narrowing o tipo explícito.
- Server actions: `'use server'` + `server-only` + `Result<T>` + zod en `lib/schemas/` + `requireWorkspace` + ownership por workspace + `revalidatePath`. **Nunca exportar objetos (schemas zod) desde `server-actions/`** — rompe la ruta solo en `pnpm build`.
- Lógica pura en `lib/campaigns/*.ts` / `lib/prompt-director/*.ts` con su `.test.ts`. Server actions y UI: sin test unitario (typecheck + build + review).
- **Tests sin APIs reales** (nada de Gemini/fal/ElevenLabs/QStash); los smoke con API real los corre el usuario.
- Migraciones: NUNCA modificar una aplicada; la 070 se aplica **vía MCP en dev y prod ANTES de pushear** código que lea `product_ids` (si no, 500 en prod).
- **Paridad single-producto**: con 1 producto asignado, el prompt/referencias compilados deben ser IDÉNTICOS a los actuales. La suite existente (`prompt-director.test.ts`, `reference-selection.test.ts`, `continuation-prompt.test.ts`) debe seguir verde con cambios solo mecánicos de fixture (`ctx.product` → `ctx.products = [...]`).
- Commits: Conventional Commits en español, imperativo, ≤70 chars, **sin `Co-Authored-By`** (`.cursor/rules/90-commits.mdc`).
- No emojis en código ni UI; dark mode; shadcn primero.
- Rama de trabajo: `feat/multi-producto-por-clip` (ya creada desde `feat/estudio-creativo-activos`).

## File Structure

- Create: `supabase/migrations/070_campaign_items_product_ids.sql` — columna + backfill.
- Modify: `lib/campaigns/infer-assignment.ts` (+`.test.ts`) — `inferProductsForClip` (multi).
- Create: `lib/campaigns/ref-budget.ts` (+`.test.ts`) — `perProductImageCap` + `estimateItemImageRefs` (puro, importable desde cliente).
- Modify: `lib/prompt-director/inventory.ts` (+`inventory.test.ts`) — `describeProductCompact` + `multiProductCountClause`.
- Modify: `lib/prompt-director/types.ts` — `DirectorContext.products?: ProductInventory[]`.
- Modify (lectores de `ctx.product`): `lib/prompt-director/compilers/seedance.ts`, `video-prose.ts`, `nano-banana.ts`, `flux.ts`, `lib/prompt-director/validators.ts`, `format-director.ts`, `index.ts`, `lib/campaigns/reference-selection.ts`, `lib/campaigns/orchestrator.ts`.
- Modify: `lib/campaigns/orchestrator.ts` — resolución multi por ítem, `ChainParams.productCount`, `buildContinuationPrompt`.
- Modify: `lib/campaigns/reference-pool.ts`, `components/campaigns/ReferencePoolDialog.tsx` — pool por ítem multi.
- Modify: `lib/schemas/campaigns.ts`, `server-actions/campaigns.ts` — `SetItemProductsSchema`/`setItemProductsAction`, pre-llenado, gating.
- Modify: `lib/campaigns/studio-item.ts`, `app/app/campaigns/[id]/page.tsx`, `components/campaigns/CampaignStudioView.tsx` — multi-select + badge.
- Modify: `lib/studio/panel-asset.ts` — refs del panel por `product_ids`.

---

### Task 1: Migración 070 — `campaign_items.product_ids`

**Files:**
- Create: `supabase/migrations/070_campaign_items_product_ids.sql`

**Interfaces:**
- Produces: columna `campaign_items.product_ids uuid[] not null default '{}'`, backfilleada desde `product_id`. `product_id` queda deprecada (no se borra; el pipeline nuevo no la lee).

- [ ] **Step 1: Escribir la migración**

```sql
-- 070_campaign_items_product_ids.sql
-- Multi-producto por clip (spec 2026-07-15): un clip puede llevar VARIOS
-- productos del pool (showcase). product_ids espeja el patrón de
-- character_ids[] (sin FK por elemento: el resolver valida existencia y
-- workspace y descarta ids muertos, igual que el cast). product_id queda
-- deprecada: legible en transición, el pipeline nuevo no la lee ni escribe.

alter table campaign_items
  add column if not exists product_ids uuid[] not null default '{}';

comment on column campaign_items.product_id is
  'DEPRECADA (2026-07-15): usar product_ids. Se conserva solo como respaldo de transición.';
comment on column campaign_items.product_ids is
  'Productos del pool (campaign_products) asignados a este clip. {} = sin asignar.';

-- Backfill idempotente y acotado (una pasada sobre campaign_items).
update campaign_items
  set product_ids = array[product_id]
  where product_id is not null and product_ids = '{}';
```

- [ ] **Step 2: Verificar contra la regla de BD** — leer `.cursor/rules/10-database.mdc` y confirmar que la migración cumple (no toca migraciones aplicadas, no necesita RLS nueva: hereda las policies de `campaign_items`).
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/070_campaign_items_product_ids.sql
git commit -m "db: agrega product_ids a campaign_items (multi-producto por clip)"
```

> **Nota de deploy (no de esta tarea):** aplicar la 070 vía MCP de Supabase en el proyecto activo (`dzqhngfwlgxkmxohlwun` — verificar contra `.env.local`) ANTES de desplegar cualquier código de las tareas siguientes.

---

### Task 2: Inferencia multi — `inferProductsForClip`

**Files:**
- Modify: `lib/campaigns/infer-assignment.ts`
- Test: `lib/campaigns/infer-assignment.test.ts`

**Interfaces:**
- Consumes: `normalizeText` (`./text-normalize`), helpers privados existentes (`tokenize`, `candidateMatches`, `containsWholePhrase`).
- Produces: `export type InferProductsResult = { productIds: string[]; confidence: 'high' | 'none' }` y `export function inferProductsForClip(clipText: string, pool: ProductCandidate[]): InferProductsResult`. **NO borra** `inferProductForClip` todavía (su único caller se cambia en Task 10, que también la borra junto con sus tests).

Reglas (deterministas):
1. Pool vacío → `{ productIds: [], confidence: 'none' }`.
2. Pool de exactamente 1 → `{ productIds: [pool[0].id], confidence: 'high' }`.
3. Frase colectiva o numeral que coincide con el tamaño del pool → **pool completo**, `high`.
4. k ≥ 1 candidatos matchean (`candidateMatches` actual, sin cambios) → esos k, `high`. (El caso "ambiguo" del singular desaparece: nombrar 2 es asignación doble.)
5. Ninguno matchea → `{ productIds: [], confidence: 'none' }`.

- [ ] **Step 1: Escribir los tests que fallan** — añadir al archivo de test existente:

```ts
import { inferProductsForClip } from './infer-assignment';

describe('inferProductsForClip', () => {
  const pool3 = [
    p('a', 'Canvas Familiar', 'canvas-familiar'),
    p('b', 'Retrato de Pareja', 'retrato-de-pareja'),
    p('c', 'Mural Abstracto', 'mural-abstracto'),
  ];
  it('pool vacío → none', () => {
    expect(inferProductsForClip('clip', [])).toEqual({ productIds: [], confidence: 'none' });
  });
  it('un solo producto → ese, high (regresión del comportamiento actual)', () => {
    expect(inferProductsForClip('cualquier texto', [p('a', 'Canvas Familiar', 'canvas-familiar')]))
      .toEqual({ productIds: ['a'], confidence: 'high' });
  });
  it('nombra a uno de varios → solo ese', () => {
    expect(inferProductsForClip('El Retrato de Pareja sobre la cabecera', pool3))
      .toEqual({ productIds: ['b'], confidence: 'high' });
  });
  it('nombra a dos → ambos (ya no es ambiguo)', () => {
    expect(inferProductsForClip('el Canvas Familiar junto al Retrato de Pareja', pool3))
      .toEqual({ productIds: ['a', 'b'], confidence: 'high' });
  });
  it('frase colectiva → pool completo', () => {
    expect(inferProductsForClip('un paneo que muestra todos los productos de la marca', pool3))
      .toEqual({ productIds: ['a', 'b', 'c'], confidence: 'high' });
    expect(inferProductsForClip('la colección completa cuelga de la pared', pool3))
      .toEqual({ productIds: ['a', 'b', 'c'], confidence: 'high' });
  });
  it('numeral que coincide con el pool → pool completo', () => {
    expect(inferProductsForClip('los tres cuadros alineados sobre el sofá', pool3))
      .toEqual({ productIds: ['a', 'b', 'c'], confidence: 'high' });
  });
  it('numeral que NO coincide con el pool → sigue las reglas de match normales', () => {
    expect(inferProductsForClip('dos cuadros genéricos en la pared', pool3))
      .toEqual({ productIds: [], confidence: 'none' });
  });
  it('no nombra ninguno → none (sin asignar)', () => {
    expect(inferProductsForClip('una toma genérica de la sala', pool3))
      .toEqual({ productIds: [], confidence: 'none' });
  });
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test infer-assignment` → FAIL (`inferProductsForClip` no existe).
- [ ] **Step 3: Implementar** — en `infer-assignment.ts`, debajo de `inferProductForClip` (que se conserva intacta por ahora):

```ts
export type InferProductsResult = { productIds: string[]; confidence: 'high' | 'none' };

// Frase colectiva ("todos los productos", "toda la colección"): asigna el pool
// completo. El texto ya viene por normalizeText (minúsculas, sin diacríticos).
const COLLECTIVE_RE =
  /\btod(?:o|a|os|as)\s+(?:el\s+|la\s+|los\s+|las\s+|nuestros\s+|nuestras\s+|sus\s+)?(?:productos|cuadros|piezas|lienzos|coleccion|linea|catalogo|obras)\b|\b(?:coleccion|linea)\s+completa\b|\bcatalogo\s+completo\b/;

// Numeral + sustantivo genérico de producto ("los tres cuadros"): si el número
// coincide con el tamaño del pool, es el pool completo.
const NUMERAL_RE = /\b(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|\d+)\s+(?:productos|cuadros|piezas|lienzos|obras)\b/;
const NUMBER_WORDS: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
};

/**
 * Inferencia MULTI (spec 2026-07-15): un clip puede llevar varios productos.
 * Nombrar k productos asigna los k (el "ambiguo" del singular desaparece);
 * las frases colectivas y los numerales que calzan con el pool asignan todo.
 */
export function inferProductsForClip(clipText: string, pool: ProductCandidate[]): InferProductsResult {
  if (pool.length === 0) return { productIds: [], confidence: 'none' };
  if (pool.length === 1) return { productIds: [pool[0].id], confidence: 'high' };

  const normalizedClip = normalizeText(clipText);
  if (COLLECTIVE_RE.test(normalizedClip)) {
    return { productIds: pool.map((p) => p.id), confidence: 'high' };
  }
  const numeral = NUMERAL_RE.exec(normalizedClip);
  if (numeral) {
    const n = NUMBER_WORDS[numeral[1]] ?? parseInt(numeral[1], 10);
    if (n === pool.length) return { productIds: pool.map((p) => p.id), confidence: 'high' };
  }

  const clipTokens = new Set(tokenize(normalizedClip));
  const matches = pool.filter((candidate) => candidateMatches(candidate, normalizedClip, clipTokens));
  if (matches.length === 0) return { productIds: [], confidence: 'none' };
  return { productIds: matches.map((m) => m.id), confidence: 'high' };
}
```

- [ ] **Step 4: Correr y ver pasar** — `pnpm test infer-assignment` (nuevos Y viejos verdes); `pnpm typecheck`.
- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/infer-assignment.ts lib/campaigns/infer-assignment.test.ts
git commit -m "feat(campaigns): inferencia multi-producto por clip"
```

---

### Task 3: Presupuesto puro de referencias — `lib/campaigns/ref-budget.ts`

**Files:**
- Create: `lib/campaigns/ref-budget.ts`
- Test: `lib/campaigns/ref-budget.test.ts`

**Interfaces:**
- Produces (las consumen Task 6 —compiler— y Task 11 —badge—):
  - `export function perProductImageCap(productCount: number): number` — 1→3, 2→2, ≥3→1.
  - `export type RefBudgetInput = { productImageCounts: number[]; packagingImageCount: number; castCount: number; locationImageCount: number; hasScaleMap: boolean; extraCount: number }`
  - `export function estimateItemImageRefs(input: RefBudgetInput): number` — estimación del pool AUTO (pre-tope de 9), para comparar contra 9.

Módulo **puro y sin `server-only`** (el cliente lo importa para el badge). Reglas espejo del recorte automático de `buildReferences` (`compilers/seedance.ts:294-406`): productos con cap por producto; empaque solo con 1 producto (máx 2); cast = 1 master por personaje + ángulos best-case (1 personaje→2, 2→1, ≥3→0 — mismo presupuesto del compiler; cuerpo-completo/estados no se estiman: es una estimación, documentarlo en la cabecera); locación + mapa de escala + extras se suman tal cual.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// lib/campaigns/ref-budget.test.ts
import { describe, it, expect } from 'vitest';
import { perProductImageCap, estimateItemImageRefs } from './ref-budget';

describe('perProductImageCap', () => {
  it('1 producto → 3 (comportamiento actual)', () => expect(perProductImageCap(1)).toBe(3));
  it('2 productos → 2 c/u', () => expect(perProductImageCap(2)).toBe(2));
  it('3+ productos → 1 c/u', () => {
    expect(perProductImageCap(3)).toBe(1);
    expect(perProductImageCap(5)).toBe(1);
  });
});

describe('estimateItemImageRefs', () => {
  const base = { packagingImageCount: 0, castCount: 0, locationImageCount: 0, hasScaleMap: false, extraCount: 0 };
  it('single-producto espeja el recorte actual: min(imgs, 3) + empaque(≤2)', () => {
    expect(estimateItemImageRefs({ ...base, productImageCounts: [5], packagingImageCount: 3 })).toBe(3 + 2);
  });
  it('multi: cap por producto y SIN empaque', () => {
    expect(estimateItemImageRefs({ ...base, productImageCounts: [5, 4], packagingImageCount: 3 })).toBe(2 + 2);
    expect(estimateItemImageRefs({ ...base, productImageCounts: [5, 4, 2, 1] })).toBe(1 + 1 + 1 + 1);
  });
  it('cast: master + ángulos best-case por presupuesto (1→2, 2→1, 3→0)', () => {
    expect(estimateItemImageRefs({ ...base, productImageCounts: [], castCount: 1 })).toBe(1 + 2);
    expect(estimateItemImageRefs({ ...base, productImageCounts: [], castCount: 2 })).toBe(2 + 2);
    expect(estimateItemImageRefs({ ...base, productImageCounts: [], castCount: 3 })).toBe(3);
  });
  it('suma locación, mapa y extras', () => {
    expect(estimateItemImageRefs({
      productImageCounts: [2], packagingImageCount: 0, castCount: 0,
      locationImageCount: 1, hasScaleMap: true, extraCount: 2,
    })).toBe(2 + 1 + 1 + 2);
  });
  it('caso showcase que dispara el badge: 4 productos + 2 cast + locación > 9', () => {
    expect(estimateItemImageRefs({
      productImageCounts: [3, 3, 3, 3], packagingImageCount: 0, castCount: 2,
      locationImageCount: 1, hasScaleMap: false, extraCount: 2,
    })).toBe(4 + 4 + 1 + 3); // 12 > 9
  });
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test ref-budget`.
- [ ] **Step 3: Implementar**

```ts
// lib/campaigns/ref-budget.ts
// Presupuesto de imágenes de referencia por clip (spec multi-producto
// 2026-07-15). PURO y sin server-only: lo comparten buildReferences (el
// recorte real del compiler Seedance) y el badge del tablero (estimación
// client-side). ESTIMACIÓN: no cuenta cuerpo-completo/estados del cast (la UI
// no los conoce por clip); el recorte real y su warning viven en el compiler.

// Imágenes por producto según cuántos van en el clip: 1 → 3 (comportamiento
// single actual), 2 → 2, 3+ → 1 (la principal). Menos vistas por producto =
// menos confusión de conteo en Seedance (mitigación central del spec).
export function perProductImageCap(productCount: number): number {
  if (productCount <= 1) return 3;
  if (productCount === 2) return 2;
  return 1;
}

export type RefBudgetInput = {
  productImageCounts: number[];
  packagingImageCount: number;
  castCount: number;
  locationImageCount: number;
  hasScaleMap: boolean;
  extraCount: number;
};

export function estimateItemImageRefs(input: RefBudgetInput): number {
  const cap = perProductImageCap(input.productImageCounts.length);
  const products = input.productImageCounts.reduce((sum, n) => sum + Math.min(n, cap), 0);
  // Empaque solo en clips de un producto (en multi el recorte auto lo omite).
  const packaging = input.productImageCounts.length === 1 ? Math.min(input.packagingImageCount, 2) : 0;
  const castCount = Math.min(input.castCount, 3);
  const anglesPer = castCount >= 3 ? 0 : castCount === 2 ? 1 : 2;
  const cast = castCount + (castCount > 0 ? castCount * anglesPer : 0);
  return products + packaging + cast + input.locationImageCount + (input.hasScaleMap ? 1 : 0) + input.extraCount;
}
```

> Ojo con el test de cast: con `castCount = 1` el estimado es `1 + 1*2 = 3`; con 2 es `2 + 2*1 = 4`... y el test de arriba espera `2 + 2 = 4`. Verifica que ambos cuadren (sí: 1→3, 2→4, 3→3).

- [ ] **Step 4: Correr y ver pasar** — `pnpm test ref-budget`; `pnpm typecheck`.
- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/ref-budget.ts lib/campaigns/ref-budget.test.ts
git commit -m "feat(campaigns): presupuesto puro de referencias por clip"
```

---

### Task 4: Helpers de inventario multi — `describeProductCompact` + `multiProductCountClause`

**Files:**
- Modify: `lib/prompt-director/inventory.ts`
- Test: `lib/prompt-director/inventory.test.ts`

**Interfaces:**
- Consumes: `ProductInventory` (`../types` — ya importado en el archivo).
- Produces (las consumen Tasks 6, 7, 8):
  - `export function describeProductCompact(product: ProductInventory): string` — ficha corta para clips multi (nombre, medium, detalle visual, paleta, dimensiones).
  - `export function multiProductCountClause(names: string[]): string` — cláusula anti-conteo.

- [ ] **Step 1: Tests que fallan** — añadir a `inventory.test.ts`:

```ts
import { describeProductCompact, multiProductCountClause } from './inventory';

describe('describeProductCompact', () => {
  it('incluye nombre, medium, detalle, paleta y dimensiones', () => {
    const out = describeProductCompact({
      name: 'Canvas Familiar', medium: 'canvas print', visualDetails: 'a family portrait',
      palette: ['navy', 'gold'], heightCm: 100, widthCm: 70, imagePaths: ['p.png'],
    });
    expect(out).toContain('Canvas Familiar');
    expect(out).toContain('canvas print');
    expect(out).toContain('a family portrait');
    expect(out).toContain('navy, gold');
    expect(out).toContain('100 cm tall and 70 cm wide');
    expect(out).toContain('exactly as in its reference images');
  });
  it('omite campos ausentes sin dejar comas colgando', () => {
    const out = describeProductCompact({ name: 'Mural', imagePaths: [] });
    expect(out).toBe('Product: Mural. It must appear exactly as in its reference images — never restyle, stretch or recolor it.');
  });
});

describe('multiProductCountClause', () => {
  it('enumera con conteo exacto y prohíbe duplicar/fusionar/inventar', () => {
    const out = multiProductCountClause(['Canvas Familiar', 'Retrato de Pareja', 'Mural Abstracto']);
    expect(out).toContain('exactly 3 distinct products');
    expect(out).toContain('Canvas Familiar, Retrato de Pareja, Mural Abstracto');
    expect(out).toContain('render each product exactly once');
    expect(out).toContain('do not duplicate, merge or invent additional products');
  });
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test inventory`.
- [ ] **Step 3: Implementar** — al final de `inventory.ts`:

```ts
// Ficha COMPACTA para clips multi-producto (spec 2026-07-15): N fichas
// completas de describeProduct saturarían el prompt. Solo hechos declarados +
// un ancla de fidelidad corta; el arbitraje largo y el staging proporcional
// son de clips single-producto.
export function describeProductCompact(product: ProductInventory): string {
  const parts: string[] = [
    product.medium ? `Product: ${product.name}, a ${product.medium}` : `Product: ${product.name}`,
  ];
  if (product.visualDetails) {
    parts.push(product.medium ? `displaying this printed image: ${product.visualDetails}` : product.visualDetails);
  }
  if (product.palette?.length) parts.push(`colors ${product.palette.join(', ')}`);
  if (product.heightCm && product.widthCm) parts.push(`about ${product.heightCm} cm tall and ${product.widthCm} cm wide`);
  else if (product.heightCm) parts.push(`about ${product.heightCm} cm tall`);
  else if (product.widthCm) parts.push(`about ${product.widthCm} cm wide`);
  return `${parts.join(', ')}. It must appear exactly as in its reference images — never restyle, stretch or recolor it.`;
}

// Mitigación anti-conteo (la razón por la que multi-producto se excluyó en el
// spec V3 y se revierte en el de 2026-07-15): Seedance tiende a duplicar o
// fusionar productos en tomas con varios. Conteo exacto + enumeración.
export function multiProductCountClause(names: string[]): string {
  return (
    `The scene contains exactly ${names.length} distinct products: ${names.join(', ')} — ` +
    `render each product exactly once, at its true relative size; ` +
    `do not duplicate, merge or invent additional products.`
  );
}
```

- [ ] **Step 4: Correr y ver pasar** — `pnpm test inventory`; `pnpm typecheck`.
- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/inventory.ts lib/prompt-director/inventory.test.ts
git commit -m "feat(director): ficha compacta y clausula anti-conteo multi-producto"
```

---

### Task 5: `DirectorContext.products` — cambio de tipo + adaptación mecánica de TODOS los lectores (paridad)

**Files:**
- Modify: `lib/prompt-director/types.ts:87`
- Modify: `lib/prompt-director/compilers/seedance.ts:299-322,565-569`
- Modify: `lib/prompt-director/compilers/video-prose.ts:17,59`
- Modify: `lib/prompt-director/compilers/nano-banana.ts:27,47`
- Modify: `lib/prompt-director/compilers/flux.ts:25,80,88`
- Modify: `lib/prompt-director/validators.ts:206`
- Modify: `lib/prompt-director/format-director.ts:41,47`
- Modify: `lib/prompt-director/index.ts:67`
- Modify: `lib/campaigns/reference-selection.ts:40-50`
- Modify: `lib/campaigns/orchestrator.ts` (`directorContextFor:514-589`, `enqueueBatch:1183-1192`, `storyboardProductRefs:1270`, `ItemRow` y selects de items en `server-actions/campaigns.ts:1541,1899,2874`)
- Modify (fixtures): `lib/prompt-director/prompt-director.test.ts`, `lib/campaigns/reference-selection.test.ts`

**Interfaces:**
- Produces: `DirectorContext.products?: ProductInventory[]` (**reemplaza** `product?: ProductInventory`; el campo viejo se borra — el compilador TS encuentra cualquier lector olvidado).
- Produces: `directorContextFor(item, format, ctx, templateVideoPath?, extraImagePaths?, location?, productsOverride?: ProductInventory[])` — firma nueva del 7º parámetro.
- **Regla de la tarea: CERO cambio de comportamiento.** Todo lector se adapta con la semántica "primer producto" (`ctx.products?.[0]`) o "mapear el array" cuando es un filtro. El soporte multi REAL llega en Tasks 6-8. La suite completa debe quedar verde solo actualizando fixtures.

- [ ] **Step 1: Cambiar el tipo** — en `types.ts:87`: `product?: ProductInventory;` → `products?: ProductInventory[];` (actualizar el comentario: "Productos del clip, en el orden de `campaign_items.product_ids`. 1 elemento = comportamiento single clásico; 2+ = clip showcase multi-producto").
- [ ] **Step 2: `pnpm typecheck` y usar la lista de errores como checklist.** Adaptaciones mecánicas exactas:
  - `seedance.ts` `buildReferences`: al inicio, `const primary = ctx.products?.[0];` y reemplazar `ctx.product` por `primary` en las líneas 299, 300, 319. En `compileSeedance` (565-569): `const primaryProduct = ctx.products?.[0]; if (primaryProduct) { ... }` con el mismo cuerpo.
  - `video-prose.ts:17`: `const product = ctx.products?.[0]; if (product) sections.push(describeProduct(product));`; línea 59 (`firstProductReference`): `const path = ctx.products?.[0]?.imagePaths[0];`.
  - `nano-banana.ts:27,47` y `flux.ts:25,80,88`: mismo patrón `const product = ctx.products?.[0]`.
  - `validators.ts:206`: `if (ctx.products?.length === 1 && ctx.products[0].imagePaths?.length === 1) {`.
  - `format-director.ts:41`: `if (ref === 'product' && !context.products?.some((p) => p.imagePaths.length)) {`; línea 47 igual con `packagingImagePaths?.length`.
  - `index.ts:67`: `products: ctx.products?.map((p) => ({ ...p, imagePaths: [], packagingImagePaths: [] })),`.
  - `reference-selection.ts` `applyReferenceSelection` (40-50) — aquí SÍ se mapea el array completo (la selección manual filtra cada producto):

```ts
    ...(ctx.products
      ? {
          products: ctx.products.map((product) => ({
            ...product,
            imagePaths: keep(product.imagePaths),
            ...(product.packagingImagePaths
              ? { packagingImagePaths: keep(product.packagingImagePaths) }
              : {}),
          })),
        }
      : {}),
```

  - `orchestrator.ts` `directorContextFor`: renombrar el 7º parámetro a `productsOverride?: import('@/lib/prompt-director/types').ProductInventory[]` y el bloque 553-574 queda:

```ts
    products: productsOverride?.length
      ? productsOverride.map((p) => ({
          ...p,
          packagingImagePaths: format?.required_refs.includes('packaging')
            ? p.packagingImagePaths
            : undefined,
        }))
      : [
          {
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
        ],
```

  - `orchestrator.ts` `enqueueBatch` (1157-1192): el `ItemRow` gana `product_ids: string[] | null`; el cache pasa a clave-producto individual y se resuelve el array:

```ts
  // Multi-producto (spec 2026-07-15): resuelve CADA producto asignado al clip;
  // los ids que no resuelven (borrados/otro workspace) se descartan como el cast.
  const itemProductIds = (item.product_ids ?? []).filter(Boolean);
  const itemProducts: import('@/lib/prompt-director/types').ProductInventory[] = [];
  for (const pid of itemProductIds) {
    if (!itemProductCache.has(pid)) {
      itemProductCache.set(pid, await resolveItemProduct(supabase, workspaceId, pid, campaign.include_packaging !== false));
    }
    const resolved = itemProductCache.get(pid);
    if (resolved) itemProducts.push(resolved);
  }
```

    y en la llamada a `directorContextFor` (1209): `itemProducts.length ? itemProducts : undefined`.
  - `orchestrator.ts:1270`: `const storyboardProductRefs = useR2V ? (baseDirCtx.products ?? []).flatMap((p) => p.imagePaths).slice(0, 2) : [];`
  - `server-actions/campaigns.ts` selects de items **1541, 1899 y 2874**: añadir `product_ids` después de `product_id` (el `product_id` se limpia en Task 12).
- [ ] **Step 3: Actualizar fixtures de tests** — en `prompt-director.test.ts` y `reference-selection.test.ts`, reemplazo mecánico: `ctx.product` → `ctx.products![0]` en asserts/mutaciones y `product: {...}` → `products: [{...}]` en la construcción de contextos. NO cambiar ningún valor esperado: si un assert de prompt cambia, la paridad se rompió — investigar, no ajustar el assert.
- [ ] **Step 4: Verificar paridad** — `pnpm test` (suite completa verde con los valores esperados ORIGINALES); `pnpm typecheck` limpio; `pnpm build` limpio.
- [ ] **Step 5: Commit**

```bash
git add -A lib/ server-actions/campaigns.ts
git commit -m "refactor(director): DirectorContext.products como lista con paridad single"
```

---

### Task 6: Compiler Seedance multi — presupuesto por producto, citas agrupadas, anti-conteo

**Files:**
- Modify: `lib/prompt-director/compilers/seedance.ts` (`buildReferences:264-436`, bloque de producto de `compileSeedance:565-569`)
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `perProductImageCap` (`@/lib/campaigns/ref-budget`, Task 3), `describeProductCompact` + `multiProductCountClause` (`../inventory`, Task 4).
- Produces: comportamiento multi en referencias y descripción. Con `products.length === 1`, salida **byte-idéntica** a la actual.

- [ ] **Step 1: Tests que fallan** — añadir a `prompt-director.test.ts` (usar los helpers de contexto existentes del archivo):

```ts
describe('compileSeedance multi-producto', () => {
  const twoProducts = [
    { name: 'Canvas Familiar', imagePaths: ['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/canvas-3.png'], visualDetails: 'family portrait' },
    { name: 'Retrato de Pareja', imagePaths: ['ws/retrato-1.png'], visualDetails: 'couple portrait' },
  ];
  it('citas nombradas por producto y cap de 2 imágenes con 2 productos', () => {
    const out = compileForTest({ products: twoProducts }); // helper del archivo que arma ctx + compile
    const refs = out.references.filter((r) => r.role === 'product').map((r) => r.storagePath);
    expect(refs).toEqual(['ws/canvas-1.png', 'ws/canvas-2.png', 'ws/retrato-1.png']); // 2+1, no 3+1
    expect(out.prompt).toContain('is the product "Canvas Familiar"');
    expect(out.prompt).toContain('is the product "Retrato de Pareja"');
  });
  it('cláusula anti-conteo presente con 2+ y ausente con 1', () => {
    expect(compileForTest({ products: twoProducts }).prompt).toContain('exactly 2 distinct products');
    expect(compileForTest({ products: [twoProducts[0]] }).prompt).not.toContain('distinct products:');
  });
  it('la línea SAME single product se emite POR producto con 2+ vistas, nunca global', () => {
    const p = compileForTest({ products: twoProducts }).prompt;
    expect(p).toContain('the SAME single product ("Canvas Familiar")');
    expect(p).not.toContain('the SAME single product ("Retrato de Pareja")'); // 1 sola vista
  });
  it('multi: descripciones compactas, sin ficha completa ni peso; empaque omitido', () => {
    const p = compileForTest({
      products: twoProducts.map((x) => ({ ...x, weightKg: 20, packagingImagePaths: ['ws/pack.png'] })),
    });
    expect(p.prompt).toContain('It must appear exactly as in its reference images');
    expect(p.prompt).not.toContain('visible effort'); // describeProductWeight no corre en multi
    expect(p.references.some((r) => r.role === 'packaging')).toBe(false);
  });
  it('3+ productos → 1 imagen por producto', () => {
    const out = compileForTest({ products: [
      { name: 'A', imagePaths: ['a1.png', 'a2.png'] },
      { name: 'B', imagePaths: ['b1.png', 'b2.png'] },
      { name: 'C', imagePaths: ['c1.png'] },
    ] });
    expect(out.references.filter((r) => r.role === 'product')).toHaveLength(3);
  });
});
```

  (Si no existe un helper `compileForTest`, construir el ctx inline igual que los tests vecinos del archivo — copiar el patrón local, no inventar uno nuevo.)
- [ ] **Step 2: Correr y ver fallar** — `pnpm test prompt-director`.
- [ ] **Step 3: Implementar `buildReferences` multi** — reemplazar el bloque de producto/empaque (299-322) por:

```ts
  const products = ctx.products ?? [];
  const productCap = manual ? Infinity : perProductImageCap(products.length);
  for (const product of products) {
    const productImages = product.imagePaths.slice(0, productCap);
    const usages = product.imageUsages ?? {};
    const nums: number[] = [];
    // En multi la cita nombra al producto: sin el nombre, N líneas "is the
    // product" idénticas son indistinguibles y el modelo fusiona referencias.
    const label = products.length > 1 ? `the product "${product.name}"` : 'the product';
    for (const path of productImages) {
      const usage = usages[path];
      const n = pushImage(
        path,
        'product',
        (n) =>
          `@image${n} is ${label}${usage ? `, shown here as ${usage}` : ''} — keep its design, colors, logo and proportions consistent; any printed photo or text on it stays a still print, not animated.`,
      );
      if (n) nums.push(n);
    }
    // AM: con 2+ vistas DEL MISMO producto, decláralo scoped a ese producto —
    // nunca global entre productos distintos (los fusionaría).
    if (nums.length >= 2) {
      lines.push(
        products.length > 1
          ? `@image${nums.join(' and @image')} show the SAME single product ("${product.name}") from different views; reconcile them into one consistent object — do not treat them as different products.`
          : 'The product reference images show the SAME single product from different views; reconcile them into one consistent object — do not treat them as different products.',
      );
    }
  }
  if (products.length > 1) {
    lines.push(multiProductCountClause(products.map((p) => p.name)));
  }

  // Empaque: solo clips single-producto en auto (en multi satura el conteo);
  // la selección manual del usuario sí viaja (manual = el usuario es el presupuesto).
  const packagingImages =
    products.length === 1
      ? (products[0].packagingImagePaths?.slice(0, manual ? Infinity : 2) ?? [])
      : manual
        ? products.flatMap((p) => p.packagingImagePaths ?? [])
        : [];
  for (const path of packagingImages) {
    pushImage(path, 'packaging', (n) => `@image${n} is the product packaging, shown exactly as in the reference.`);
  }
```

  Importar `perProductImageCap` de `@/lib/campaigns/ref-budget` y `multiProductCountClause` de `../inventory`. **Borrar** la constante/lógica vieja de las líneas 296-322 que quede duplicada. `const primary` de Task 5 desaparece de `buildReferences`.
- [ ] **Step 4: Implementar el bloque de descripción** — reemplazar 565-569 por:

```ts
  const ctxProducts = ctx.products ?? [];
  if (ctxProducts.length === 1) {
    const product = ctxProducts[0];
    sections.push(describeProduct(product, { fidelity: !product.imagePaths.length }));
    const weight = describeProductWeight(product);
    if (weight) sections.push(weight.trim());
  } else if (ctxProducts.length > 1) {
    // Multi: ficha compacta por producto + anti-conteo. El staging proporcional
    // y el peso son single-producto (saturarían N veces el prompt).
    for (const product of ctxProducts) sections.push(describeProductCompact(product));
    sections.push(multiProductCountClause(ctxProducts.map((p) => p.name)));
  }
```

  Importar `describeProductCompact` en el import existente de `../inventory`.
- [ ] **Step 5: Correr y ver pasar** — `pnpm test prompt-director` (nuevos multi + TODOS los viejos single sin tocar sus valores esperados = paridad); `pnpm typecheck`.
- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(director): compiler Seedance multi-producto con anti-conteo"
```

---

### Task 7: Cadena encadenada — `ChainParams.productCount` + `buildContinuationPrompt` multi

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`ChainParams:624`, `buildContinuationPrompt:669-758`, siembra `chain:1358-1380`, avance `advanceSequenceChain:882-926`)
- Test: `lib/campaigns/continuation-prompt.test.ts`

**Interfaces:**
- Consumes: nada nuevo (la cláusula anti-conteo de cadena es inline: `buildContinuationPrompt` no conoce nombres de producto, solo conteos — paridad con su estilo actual).
- Produces: `ChainParams += productCount?: number` (nº de productos DISTINTOS del clip); `buildContinuationPrompt(..., opts += { distinctProducts?: number })`.
- Callers a actualizar (grep `buildContinuationPrompt(` — 3 sitios): `orchestrator.ts:910`, `server-actions/campaigns.ts` (regeneración de clip encadenado) y `app/api/jobs/process/route.ts`. En los tres, pasar `distinctProducts: chain.productCount ?? 1` (o el equivalente local).

- [ ] **Step 1: Tests que fallan** — añadir a `continuation-prompt.test.ts` (seguir el patrón de llamadas del archivo):

```ts
it('multi-producto: cita cada ref como uno de N productos distintos y añade el anti-conteo', () => {
  const out = buildContinuationPrompt('la familia contempla la pared', 3, 1, { distinctProducts: 3 });
  expect(out).toContain('@image1 is one of the 3 distinct products');
  expect(out).toContain('@image3 is one of the 3 distinct products');
  expect(out).toContain('exactly 3 distinct products; render each exactly once');
});
it('single (default): la cita clásica "is the product", sin anti-conteo (paridad)', () => {
  const out = buildContinuationPrompt('escena', 2, 0, {});
  expect(out).toContain('@image1 is the product —');
  expect(out).not.toContain('distinct products');
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test continuation-prompt`.
- [ ] **Step 3: Implementar** — en `buildContinuationPrompt`, opts gana `distinctProducts?: number`; reemplazar el loop de producto (689-694) por:

```ts
  const distinct = opts?.distinctProducts ?? 1;
  for (let i = 0; i < productCount; i++) {
    idx++;
    refs.push(
      distinct > 1
        ? `@image${idx} is one of the ${distinct} distinct products — keep its design, colors and proportions consistent; any printed photo or text on it stays a still print, not animated.`
        : `@image${idx} is the product — keep its design, colors and proportions consistent; any printed photo or text on it stays a still print, not animated.`,
    );
  }
  if (distinct > 1) {
    refs.push(
      `The scene contains exactly ${distinct} distinct products; render each exactly once — do not duplicate, merge or invent additional products.`,
    );
  }
```

- [ ] **Step 4: Propagar el conteo** —
  - `ChainParams` (624-663): añadir `// Nº de productos DISTINTOS del clip (multi-producto 2026-07-15): las continuaciones citan las refs de producto como "one of N". undefined (cadenas viejas) → 1.` y el campo `productCount?: number;`.
  - Siembra (1358-1380): añadir `...(itemProducts.length > 1 ? { productCount: itemProducts.length } : {}),` (usa el `itemProducts` de Task 5).
  - `advanceSequenceChain`: en la llamada a `buildContinuationPrompt` (910-926) añadir `...(chain.productCount ? { distinctProducts: chain.productCount } : {}),` a opts; en el re-seed del chain (946-960) añadir `...(chain.productCount ? { productCount: chain.productCount } : {}),`.
  - Actualizar los otros 2 callers (grep) con el mismo patrón.
  - Nota de límite (comentario en 882): `chain.productImagePaths` sigue con `slice(0, 3)` — con 4+ productos las continuaciones re-anclan solo los 3 primeros (1 imagen c/u por el cap de Task 6). Documentado, no se cambia.
- [ ] **Step 5: Correr y ver pasar** — `pnpm test continuation-prompt`; `pnpm typecheck`; `pnpm build`.
- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/continuation-prompt.test.ts server-actions/campaigns.ts app/api/jobs/process/route.ts
git commit -m "feat(campaigns): la cadena re-ancla N productos distintos por clip"
```

---

### Task 8: Compilers secundarios multi — video-prose, nano-banana, flux

**Files:**
- Modify: `lib/prompt-director/compilers/video-prose.ts`, `nano-banana.ts`, `flux.ts`
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `describeProductCompact`, `multiProductCountClause` (Task 4).
- Produces: multi en los tres compilers. Single = paridad exacta (el `products?.[0]` de Task 5 ya la garantiza; aquí solo se añade la rama `length > 1`).

Patrón idéntico en los tres (mismo criterio que Seedance):
- **Descripción**: `length === 1` → `describeProduct(products[0])` (como hoy); `length > 1` → `describeProductCompact` por producto + `multiProductCountClause`.
- **Referencias**: `video-prose.firstProductReference` → 1 imagen del primer producto (sin cambio: Veo/Kling solo aceptan una); `nano-banana` (47) y `flux` (80): `length === 1` → slice actual (3 y 4); `length > 1` → primera imagen de cada producto (`products.map((p) => p.imagePaths[0]).filter(Boolean)`), respetando los caps de provider ya existentes aguas abajo. En `flux.ts:88` `productUsageClause` recibe los paths resultantes y el merge de usages: `Object.assign({}, ...products.map((p) => p.imageUsages ?? {}))`.

- [ ] **Step 1: Tests que fallan** — en `prompt-director.test.ts`, para cada compiler un caso multi (mismo estilo que los tests vecinos de ese compiler):

```ts
it('video-prose multi: fichas compactas + anti-conteo', () => {
  const out = buildVideoProse(req, ctxWith({ products: twoProducts }), 4000);
  expect(out).toContain('exactly 2 distinct products');
  expect(out).toContain('Product: Canvas Familiar');
  expect(out).toContain('Product: Retrato de Pareja');
});
it('flux multi: 1 imagen por producto', () => {
  const out = compileFlux(req, ctxWith({ products: twoProducts }));
  const productRefs = out.references.filter((r) => r.role === 'product');
  expect(productRefs.map((r) => r.storagePath)).toEqual(['ws/canvas-1.png', 'ws/retrato-1.png']);
});
it('nano-banana multi: 1 imagen por producto y anti-conteo en el prompt', () => {
  const out = compileNanoBanana(req, ctxWith({ products: twoProducts }));
  expect(out.prompt).toContain('exactly 2 distinct products');
  expect(out.references.filter((r) => r.role === 'product')).toHaveLength(2);
});
```

  (Ajustar nombres de funciones/fixtures a los reales del archivo — los tests vecinos de cada compiler muestran el patrón exacto de invocación.)
- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** el patrón en los tres archivos. Ejemplo `video-prose.ts:17`:

```ts
  const products = ctx.products ?? [];
  if (products.length === 1) sections.push(describeProduct(products[0]));
  else if (products.length > 1) {
    for (const product of products) sections.push(describeProductCompact(product));
    sections.push(multiProductCountClause(products.map((p) => p.name)));
  }
```

- [ ] **Step 4: Correr y ver pasar** — `pnpm test prompt-director`; `pnpm typecheck`.
- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/compilers/ lib/prompt-director/prompt-director.test.ts
git commit -m "feat(director): multi-producto en video-prose, nano-banana y flux"
```

---

### Task 9: Pool de referencias por ítem multi + textos del diálogo

**Files:**
- Modify: `lib/campaigns/reference-selection.ts` (`ReferencePoolInput`, `buildReferencePool:160-217`, `ReferencePoolTexts`, `buildReferencePoolTexts:116-129`)
- Modify: `lib/campaigns/reference-pool.ts` (`assemblePool:101-160`, `loadReferencePool:37-93`, `loadItemReferencePool:173-254`)
- Modify: `components/campaigns/ReferencePoolDialog.tsx` (render de `texts`)
- Test: `lib/campaigns/reference-selection.test.ts`

**Interfaces:**
- Produces:
  - `ReferencePoolInput.products: { name?: string; imagePaths: string[]; imageUsages?: Record<string, string>; packagingImagePaths: string[] }[]` (**reemplaza** `product` singular y el `packagingImagePaths` top-level).
  - `ReferencePoolTexts.products: { name: string; text: string }[]` (**reemplaza** `product: string | null`).
  - `loadItemReferencePool` acepta `item.product_ids: string[] | null` (**reemplaza** `product_id`); resuelve cada id vía `resolveItemProduct` y cae al producto de campaña solo con array vacío.
- Consumes: `resolveItemProduct` (sin cambios), `describeProduct`/`describeProductCompact`.

- [ ] **Step 1: Tests que fallan** — en `reference-selection.test.ts`:

```ts
it('buildReferencePool etiqueta producto y empaque por nombre con 2+ productos', () => {
  const entries = buildReferencePool({
    products: [
      { name: 'Canvas Familiar', imagePaths: ['c1.png'], packagingImagePaths: ['cp1.png'] },
      { name: 'Retrato de Pareja', imagePaths: ['r1.png'], packagingImagePaths: [] },
    ],
    characters: [], locations: [], extraImagePaths: [],
  });
  expect(entries.find((e) => e.path === 'c1.png')?.label).toBe('Canvas Familiar');
  expect(entries.find((e) => e.path === 'r1.png')?.label).toBe('Retrato de Pareja');
  expect(entries.find((e) => e.path === 'cp1.png')?.label).toBe('Empaque — Canvas Familiar');
});
it('buildReferencePool multi marca autoIncluded según el cap por producto', () => {
  const entries = buildReferencePool({
    products: [
      { name: 'A', imagePaths: ['a1.png', 'a2.png', 'a3.png'], packagingImagePaths: [] },
      { name: 'B', imagePaths: ['b1.png'], packagingImagePaths: [] },
    ],
    characters: [], locations: [], extraImagePaths: [],
  });
  expect(entries.find((e) => e.path === 'a2.png')?.autoIncluded).toBe(true);  // cap 2 con 2 productos
  expect(entries.find((e) => e.path === 'a3.png')?.autoIncluded).toBe(false);
});
it('buildReferencePoolTexts devuelve una ficha por producto', () => {
  const texts = buildReferencePoolTexts({
    products: [
      { name: 'Canvas Familiar', imagePaths: [] },
      { name: 'Retrato de Pareja', imagePaths: [] },
    ],
    characters: [], locations: [],
  });
  expect(texts.products).toHaveLength(2);
  expect(texts.products[0].name).toBe('Canvas Familiar');
});
```

- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar `reference-selection.ts`** —
  - `buildReferencePool`: loop por producto; `autoIncluded: i < perProductImageCap(input.products.length)` (importar de `./ref-budget`); empaque anidado por producto con label `` `Empaque — ${productName}` `` cuando hay 2+ (con 1 producto queda `'Empaque'`, paridad) y `autoIncluded: input.products.length === 1 && i < AUTO_PACKAGING_CAP`. Borrar `AUTO_PRODUCT_CAP` (lo sustituye `perProductImageCap`).
  - `buildReferencePoolTexts`: `products: input.products.map((p) => ({ name: p.name, text: input.products.length > 1 ? describeProductCompact(p) : describeProduct(p, { fidelity: false }) }))`.
- [ ] **Step 4: Implementar `reference-pool.ts`** —
  - `assemblePool`: input pasa de campos `productName/productImagePaths/...` sueltos a `products: Array<{ name: string; visualDetails?: string; palette?: string[]; imagePaths: string[]; imageUsages?: Record<string, string>; packagingImagePaths: string[]; medium?: string; thicknessMm?: number; heightCm?: number; widthCm?: number; weightKg?: number }>`.
  - `loadReferencePool` (campaña): arma `products: [ { ...campos de ctx como hoy } ]` (array de 1 — paridad).
  - `loadItemReferencePool`: firma `item.product_ids: string[] | null`; resolver cada id (loop + `resolveItemProduct`, descartar nulls); si el resultado queda vacío → array de 1 con el fallback de campaña (mismo bloque que hoy).
  - Actualizar los callers de `loadItemReferencePool` en `server-actions/campaigns.ts` (líneas ~3307 y ~3371): el select del item pasa a `product_ids` y se pasa `product_ids: item.product_ids as string[] | null`.
- [ ] **Step 5: Adaptar `ReferencePoolDialog.tsx`** — donde renderiza `texts.product` (ficha read-only), iterar `texts.products` mostrando cada ficha con su nombre como encabezado pequeño. El contador `N/9` y el aviso de exceso **ya existen** (líneas 232-233 y 353-360) — no tocar.
- [ ] **Step 6: Correr y ver pasar** — `pnpm test reference-selection`; `pnpm typecheck`; `pnpm build`.
- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/reference-selection.ts lib/campaigns/reference-selection.test.ts lib/campaigns/reference-pool.ts server-actions/campaigns.ts components/campaigns/ReferencePoolDialog.tsx
git commit -m "feat(campaigns): pool de referencias por clip con varios productos"
```

---

### Task 10: Schema + server actions — `setItemProductsAction`, pre-llenado y gating

**Files:**
- Modify: `lib/schemas/campaigns.ts:251-254,342`
- Modify: `server-actions/campaigns.ts` (`setItemProductAction:3113-3186`, pre-llenado `generatePlanAction:1122-1205`, gating `generateItemAction:1810-1820` y `approveBatchAction:1909-1925`)
- Modify: `lib/campaigns/infer-assignment.ts` + `.test.ts` (borrar el singular)

**Interfaces:**
- Produces: `SetItemProductsSchema = z.object({ itemId: z.string().uuid(), productIds: z.array(z.string().uuid()).max(12) })` (12 = sanity cap, `SEEDANCE_MAX_TOTAL_REFS`; `[]` = limpiar). Reemplaza a `SetItemProductSchema` (borrar schema + tipo).
- Produces: `export async function setItemProductsAction(input: unknown): Promise<Result<{ updated: true }>>` — reemplaza a `setItemProductAction` (borrar la vieja; su único caller UI se actualiza en Task 11 **dentro del mismo typecheck de rama**, así que este commit deja el typecheck en rojo SOLO si Task 11 no sigue inmediatamente — ejecutar Tasks 10 y 11 en secuencia sin push intermedio, o mantener temporalmente un alias `export const setItemProductAction = setItemProductsAction` está PROHIBIDO: firma distinta. Preferir: hacer el cambio de UI mínimo del caller en este mismo commit, ver Step 4).
- Consumes: `inferProductsForClip` (Task 2).

- [ ] **Step 1: Schema** — reemplazar en `lib/schemas/campaigns.ts` (251-254):

```ts
// Multi-producto por clip (spec 2026-07-15): fija el SUBCONJUNTO de productos
// del pool asignado a un clip. [] = sin asignar (el tablero lo pide antes de
// generar cuando la campaña tiene marca+pool). Cap 12 = sanity (tope total de
// archivos de referencia de Seedance).
export const SetItemProductsSchema = z.object({
  itemId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).max(12),
});
```

  y el tipo (342): `export type SetItemProductsInput = z.infer<typeof SetItemProductsSchema>;`.
- [ ] **Step 2: `setItemProductsAction`** — reemplazar `setItemProductAction` (3113-3186) conservando estructura y comentarios adaptados:

```ts
export async function setItemProductsAction(input: unknown): Promise<Result<{ updated: true }>> {
  const parsed = SetItemProductsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, status, sequence_id, campaigns!inner(workspace_id)')
    .eq('id', parsed.data.itemId)
    .single();
  const ws = (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  if (!item || ws !== workspace.id) return { ok: false, error: 'not_found' };

  if (!['planned', 'skipped', 'failed'].includes(item.status as string)) {
    return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
  }

  // TODOS los ids deben estar en el pool de la campaña (una query, no N).
  const productIds = [...new Set(parsed.data.productIds)];
  if (productIds.length > 0) {
    const { data: links } = await supabase
      .from('campaign_products')
      .select('product_id')
      .eq('campaign_id', item.campaign_id as string)
      .in('product_id', productIds);
    if ((links ?? []).length !== productIds.length) {
      return { ok: false, error: 'validation_error', message: 'Algún producto no está en el pool de la campaña' };
    }
  }

  // Anti-TOCTOU: mismo guard que updateCampaignItemAction.
  const { data: updated, error: updateErr } = await supabase
    .from('campaign_items')
    .update({ product_ids: productIds })
    .eq('id', parsed.data.itemId)
    .in('status', ['planned', 'skipped', 'failed'])
    .select('id');
  if (updateErr) return { ok: false, error: 'internal_error', message: updateErr.message };
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'forbidden', message: 'El item ya está en producción' };
  }

  // El producto es propiedad de la SECUENCIA (cadenas Atlas): propaga a las
  // hermanas SIN asignación ('{}'), nunca sobrescribe. Best-effort.
  const sequenceId = item.sequence_id as string | null;
  if (productIds.length > 0 && sequenceId) {
    const { error: siblingErr } = await supabase
      .from('campaign_items')
      .update({ product_ids: productIds })
      .eq('campaign_id', item.campaign_id as string)
      .eq('sequence_id', sequenceId)
      .eq('product_ids', '{}')
      .in('status', ['planned', 'skipped', 'failed']);
    if (siblingErr) {
      console.warn('[setItemProductsAction] no se pudo propagar product_ids a escenas hermanas', {
        itemId: parsed.data.itemId,
        sequenceId,
        message: siblingErr.message,
      });
    }
  }

  revalidatePath(`/app/campaigns/${item.campaign_id}`);
  return { ok: true, data: { updated: true } };
}
```

  Actualizar el import del schema (línea 51).
- [ ] **Step 3: Pre-llenado en `generatePlanAction`** (1122-1205) — cambiar a `inferProductsForClip` y arrays:
  - `const inferred = inferProductsForClip(clipText, pool);` → si `inferred.confidence === 'high' && inferred.productIds.length` → `update({ product_ids: inferred.productIds })`.
  - `itemProductMap` pasa a `Map<string, string[]>` (inicializar con `[]`); la propagación por secuencia usa `headProductIds` (array) y el fill: `.update({ product_ids: headProductIds }).eq('id', scene.id).eq('product_ids', '{}')`.
  - Actualizar el import (línea 56): `import { inferProductsForClip, type ProductCandidate } from '@/lib/campaigns/infer-assignment';`.
- [ ] **Step 4: Gating a arrays** —
  - `generateItemAction:1810`: `if (campaign.brand_kit_id && ((item.product_ids as string[] | null) ?? []).length === 0) {` (el select de 1541 ya trae `product_ids` desde Task 5).
  - `approveBatchAction:1921`: `if (selected.some((i) => (((i as { product_ids?: string[] | null }).product_ids) ?? []).length === 0)) {` — tipar vía el shape del select, sin `any`.
  - **Caller UI mínimo en este commit** (para typecheck verde): en `components/campaigns/CampaignStudioView.tsx:46,879` cambiar el import a `setItemProductsAction` y `handleAssignProduct` a `setItemProductsAction({ itemId, productIds: productId ? [productId] : [] })`. (La UI multi real llega en Task 11; esto solo mantiene la rama compilando.)
- [ ] **Step 5: Borrar el singular** — en `infer-assignment.ts` eliminar `inferProductForClip` + `InferResult` y en `infer-assignment.test.ts` su describe block completo (los tests nuevos de Task 2 cubren la regresión single).
- [ ] **Step 6: Verificar** — `pnpm test` (suite verde); `pnpm typecheck`; `pnpm build` (regla `'use server'`: ningún export de objeto nuevo en `server-actions/`).
- [ ] **Step 7: Commit**

```bash
git add lib/schemas/campaigns.ts server-actions/campaigns.ts lib/campaigns/infer-assignment.ts lib/campaigns/infer-assignment.test.ts components/campaigns/CampaignStudioView.tsx
git commit -m "feat(campaigns): setItemProductsAction, pre-llenado e inferencia multi"
```

---

### Task 11: UI del tablero — multi-select, badge de referencias y gating cliente

**Files:**
- Modify: `lib/campaigns/studio-item.ts` (`StudioItem`, `toStudioItem`)
- Modify: `app/app/campaigns/[id]/page.tsx` (select de items, pool query 137-145)
- Modify: `components/campaigns/CampaignStudioView.tsx` (tipos 102/124, callbacks 506-507, handler 877-886, selector 899-935, resaltes 966/1192, gating lote 1536-1539, badge en `renderClipRefs`)

**Interfaces:**
- Produces: `StudioItem.productIds: string[]` (**reemplaza** `productId`), `StudioItem.extraRefCount: number`; `StudioProductPoolEntry += packagingImageCount: number`; callback `onProductChanged(itemId, productIds: string[])`.
- Consumes: `setItemProductsAction` (Task 10), `estimateItemImageRefs` (Task 3 — módulo puro, importable en cliente).

- [ ] **Step 1: `studio-item.ts`** —

```ts
  // Multi-producto (spec 2026-07-15): subconjunto del pool asignado al clip.
  // [] = sin asignar. Compat: filas pre-070 solo traen product_id.
  productIds: string[];
  // Nº de referencias extra (reference_ids) del clip — insumo del estimado de
  // presupuesto del badge; el contenido no se proyecta.
  extraRefCount: number;
```

  y en `toStudioItem`:

```ts
    productIds:
      ((row.product_ids as string[] | null) ?? []).length > 0
        ? (row.product_ids as string[])
        : row.product_id
          ? [row.product_id as string]
          : [],
    extraRefCount: ((row.reference_ids as string[] | null) ?? []).length,
```

  Borrar `productId` del tipo y de la proyección. `pnpm typecheck` lista los consumidores a actualizar (todos en los archivos de esta tarea).
- [ ] **Step 2: `page.tsx`** — al select de items añadir `product_ids` (verificar que `reference_ids` ya viaja; si no, añadirlo). Pool query (137-145): select `products(id, name, product_image_ids, packaging_image_ids)` y proyectar `packagingImageCount: (p.packaging_image_ids ?? []).length`.
- [ ] **Step 3: Multi-select en `CampaignStudioView.tsx`** —
  - Tipo (102): `export type StudioProductPoolEntry = { id: string; name: string; imageCount: number; packagingImageCount: number };`
  - Callback (506-507 y prop 823): `onProductChanged: (itemId: string, productIds: string[]) => void` → `setItems((p) => p.map((i) => (i.id === itemId ? { ...i, productIds } : i)))`.
  - Handler (877-886):

```tsx
  async function handleAssignProducts(itemId: string, productIds: string[]) {
    setAssigningProduct(itemId);
    const res = await setItemProductsAction({ itemId, productIds });
    setAssigningProduct(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo asignar el producto');
      return;
    }
    onProductChanged(itemId, productIds);
  }
```

  - Selector (899-935) — `DropdownMenu` + `DropdownMenuCheckboxItem` (ya existe en `components/ui/dropdown-menu.tsx`); `onSelect={(e) => e.preventDefault()}` para marcar varios sin cerrar:

```tsx
  function renderProductSelector(item: StudioItem) {
    if (productPool.length === 0) return null;
    const unassigned = item.productIds.length === 0 && !!brandKitId;
    const label =
      item.productIds.length === 0
        ? 'Sin asignar'
        : item.productIds.length === 1
          ? (productPool.find((p) => p.id === item.productIds[0])?.name ?? '1 producto')
          : `${item.productIds.length} productos`;
    return (
      <div className="mt-1 whitespace-normal">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={assigningProduct === item.id}
              aria-label="Productos del clip"
              className={cn(
                'h-6 w-full max-w-[10rem] justify-between px-2 text-2xs font-normal',
                unassigned && 'border-amber-500/50 text-amber-500',
              )}
            >
              <span className="truncate">{label}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {productPool.map((p) => (
              <DropdownMenuCheckboxItem
                key={p.id}
                checked={item.productIds.includes(p.id)}
                onSelect={(e) => e.preventDefault()}
                onCheckedChange={(checked) => {
                  const next = checked
                    ? [...item.productIds, p.id]
                    : item.productIds.filter((id) => id !== p.id);
                  void handleAssignProducts(item.id, next);
                }}
              >
                {p.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {unassigned && <p className="mt-0.5 text-2xs text-amber-500">Sin asignar</p>}
      </div>
    );
  }
```

  (Importar `DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem` y `ChevronDown` de lucide.)
  - Resaltes y gating cliente: en 905/966/1192 cambiar `!item.productId` → `item.productIds.length === 0`; en 1536-1539 `.some((i) => !i.productId)` → `.some((i) => i.productIds.length === 0)`.
- [ ] **Step 4: Badge de referencias** — en `renderClipRefs` (941-963), antes del `return`:

```tsx
    const poolById = new Map(productPool.map((p) => [p.id, p]));
    const refEstimate = estimateItemImageRefs({
      productImageCounts: item.productIds.map((id) => poolById.get(id)?.imageCount ?? 0),
      packagingImageCount:
        item.productIds.length === 1 ? (poolById.get(item.productIds[0])?.packagingImageCount ?? 0) : 0,
      castCount: item.characterNames.length,
      locationImageCount: item.locationId ? 1 : 0,
      hasScaleMap: false,
      extraCount: item.extraRefCount,
    });
```

  y junto al chip `manual` (956-960):

```tsx
        {refEstimate > 9 && (
          <span
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-2xs text-amber-500"
            title="El pool estimado supera las 9 imágenes que acepta el modelo: abre Referencias para priorizar"
          >
            {refEstimate}/9
          </span>
        )}
```

  Importar `estimateItemImageRefs` de `@/lib/campaigns/ref-budget` (módulo puro, sin `server-only` — verificado en Task 3). El badge aplica a **cualquier** clip (multi o single); con `productIds` vacío el estimado omite producto (el gating ya bloquea ese caso aparte).
- [ ] **Step 5: Verificar** — `pnpm typecheck`; `pnpm build`; `pnpm test` (verde). Revisión visual manual: `pnpm dev` → campaña con pool ≥2 → el selector marca/desmarca sin cerrar, la fila sin productos resalta ámbar, el badge aparece al pasar de 9.
- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/studio-item.ts "app/app/campaigns/[id]/page.tsx" components/campaigns/CampaignStudioView.tsx
git commit -m "feat(campaigns): multi-select de productos y badge de referencias en el tablero"
```

---

### Task 12: Paneles de storyboard, limpieza de `product_id` y verificación final

**Files:**
- Modify: `lib/studio/panel-asset.ts:60,75-86`
- Modify: `server-actions/campaigns.ts` (selects que aún lean `product_id`)
- Modify: `lib/campaigns/orchestrator.ts` (`ItemRow` si conserva `product_id`)

**Interfaces:**
- Consumes: todo lo anterior. No produce interfaces nuevas.

- [ ] **Step 1: `panel-asset.ts`** — el select (60) pasa de `product_id` a `product_ids`; el bloque 75-86:

```ts
  // Productos de ESTE clip (multi-producto 2026-07-15): imágenes + empaque de
  // cada uno; los caps de refs los aplican los compilers de imagen aguas abajo.
  const productIds = ((item.product_ids as string[] | null) ?? []).filter(Boolean);
  if (productIds.length > 0) {
    const { data: productRows } = await supabase
      .from('products')
      .select('id, product_image_ids, packaging_image_ids')
      .in('id', productIds);
    for (const pid of productIds) {
      const product = (productRows ?? []).find((r) => r.id === pid);
      if (!product) continue;
      beatReferenceIds.push(...((product.product_image_ids as string[] | null) ?? []));
      beatReferenceIds.push(...((product.packaging_image_ids as string[] | null) ?? []));
    }
  }
```

- [ ] **Step 2: Limpieza** — `grep -n "product_id" server-actions/campaigns.ts lib/campaigns/*.ts lib/studio/*.ts app/app/campaigns/[id]/page.tsx` y para cada hit decidir: (a) lecturas del pipeline → migrar a `product_ids`; (b) `campaign_products.product_id` (join del pool) → se queda (es otra tabla); (c) el compat de `toStudioItem` (Task 11) → se queda (documentado). Objetivo: NINGUNA lectura de `campaign_items.product_id` en el pipeline.
- [ ] **Step 3: Suite completa** — `pnpm test` && `pnpm typecheck` && `pnpm build`, todo limpio.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(estudio): paneles de storyboard leen product_ids; limpieza del singular"
```

- [ ] **Step 5: Cierre de rama** — usar superpowers:finishing-a-development-branch. Recordatorios de deploy (orden estricto):
  1. Aplicar migración 070 vía MCP (dev y prod) ANTES del push/merge.
  2. Smoke del usuario (API real): Anuncio #15 — asignar todos los productos a los clips 11 y 12 desde el multi-select, verificar badge si el pool estimado pasa de 9, generar y revisar el conteo de productos en el video.
  3. Si Seedance duplica/fusiona productos pese al anti-conteo: el fallback es guion (montaje entre clips), no más código — documentado en el spec.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec:** datos (T1), inferencia (T2), presupuesto+badge (T3, T11), compacto+anti-conteo (T4, T6, T8), `products[]` + paridad (T5), cadena (T7), pool por ítem + diálogo (T9 — el contador del diálogo ya existía, verificado en código), action+gating (T10), UI (T11), paneles+limpieza (T12). La verificación del gap de paridad de encadenados que pide el spec es T7.
- **Placeholders:** ninguno — cada paso lleva código o instrucción exacta con líneas.
- **Consistencia de tipos:** `InferProductsResult.productIds: string[]`; `products?: ProductInventory[]` en todo el director; `StudioItem.productIds: string[]`; `SetItemProductsSchema.productIds`; `ChainParams.productCount?: number`; `RefBudgetInput` compartido entre compiler y badge.
