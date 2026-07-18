# V3 Fase 3 — Asignación de producto por clip + inferencia + gating · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Pasos con checkbox (`- [ ]`).

**Goal:** Cada clip (`campaign_item`) lleva un producto del pool de la campaña; se **infiere** del texto del clip, se **confirma/override** en un tablero por clip (una fila por clip en `PlanTable`), y **Generar se bloquea** si un clip de una campaña con marca no tiene producto.

**Architecture:** Inferencia PURA (`lib/campaigns/infer-assignment.ts`, testeable, sin IO) que matchea el texto del clip contra el pool (`campaign_products`→`products`) por slug/name/visual_details. `generatePlanAction` la corre al crear los items y pre-llena `product_id` con las de alta confianza. Un `setItemProductAction` setea el producto de un clip. La UI añade selector de producto por fila a `PlanTable`. El gating vive en cliente (botón deshabilitado + resalte) y servidor (approve/generate rechazan clips sin producto cuando la campaña tiene marca). La capa de generación (Fase 1: `resolveItemProduct` + `directorContextFor(productOverride)`) ya consume `product_id` — no se toca.

**Tech Stack:** Next.js 15 App Router, Supabase, zod, RSC + `'use client'`, pnpm, vitest.

## Global Constraints

- pnpm; sin `any`; server actions `'use server'`+`server-only`+`Result<T>`+zod (`lib/schemas/`)+`requireWorkspace`+ownership por `workspace_id`+`revalidatePath`; schemas patrón `XSchema`+`z.infer`.
- Lógica pura en `lib/campaigns/*.ts` con su `.test.ts` (espeja `reference-selection.ts`/`products.ts`). Server actions y UI: sin test unitario (typecheck+build+review).
- `campaign_items.product_id uuid → products (on delete set null)` ya existe (migración 060). `campaign_products (campaign_id, product_id)` es el pool.
- **No romper el fallback**: un clip con `product_id=null` sigue cayendo a `product_brief` en el orchestrator (Fase 1). El gating decide si se PERMITE generar ese clip, no cambia el fallback.
- "Campaña con marca" = `campaigns.brand_kit_id` no null. (Casi todas lo tienen — incluso las de upload crean un kit implícito.) El gating aplica solo cuando el pool tiene ≥1 producto (si no hay pool, no hay nada que asignar → no bloquea).
- No emojis; dark mode; shadcn primero.

## File Structure

- `lib/campaigns/text-normalize.ts` (nuevo) — `normalizeText(s)` puro (NFD, strip diacríticos, lower, trim), extraído de las copias privadas de `planner.ts`/`ingest.ts`.
- `lib/campaigns/infer-assignment.ts` (nuevo) — `inferProductForClip(clipText, pool)` + tipos; puro.
- `lib/campaigns/infer-assignment.test.ts` (nuevo).
- `lib/schemas/campaigns.ts` (modificar) — `SetItemProductSchema`.
- `server-actions/campaigns.ts` (modificar) — `setItemProductAction`; en `generatePlanAction` pre-llenar `product_id` por inferencia; gating en `generateItemAction`/`approveBatchAction`.
- `lib/campaigns/studio-item.ts` (modificar) — `StudioItem += productId`.
- `app/app/campaigns/[id]/page.tsx` (modificar) — cargar `brand_kit_id`, `product_id` por item, y el pool (`campaign_products`→`products`); pasarlos.
- `components/campaigns/CampaignStudioView.tsx` (modificar) — `StudioCampaign += brandKitId, productPool`; selector de producto por fila en `PlanTable`; resalte + gating de botones.

## Global: tipos compartidos

```ts
// lib/campaigns/infer-assignment.ts
export type ProductCandidate = {
  id: string;
  name: string;
  slug: string | null;
  visualDetails: string | null;
};
export type InferResult = { productId: string | null; confidence: 'high' | 'low' | 'none' };
```

---

### Task 1: Normalización de texto pura (extraída) + tests

**Files:**
- Create: `lib/campaigns/text-normalize.ts`, `lib/campaigns/text-normalize.test.ts`
- Modify: `lib/campaigns/planner.ts` (usar el helper en `normName`), `lib/campaigns/ingest.ts` (usar el helper en `norm`)

**Interfaces:**
- Produces: `export function normalizeText(s: string): string` — `(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()`.

- [ ] **Step 1: Test**

```ts
// lib/campaigns/text-normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeText } from './text-normalize';
describe('normalizeText', () => {
  it('quita diacríticos y baja a minúsculas', () => {
    expect(normalizeText('  Retrato de PAREJA ')).toBe('retrato de pareja');
    expect(normalizeText('Canción')).toBe('cancion');
  });
  it('tolera vacío', () => { expect(normalizeText('')).toBe(''); });
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test text-normalize`.
- [ ] **Step 3: Implementar** el helper (cabecera: "normalización compartida para comparar menciones; antes duplicada en planner.ts y ingest.ts").
- [ ] **Step 4: Correr y ver pasar.**
- [ ] **Step 5: Refactor** — en `planner.ts:85-92` (`normName`) y `ingest.ts:42-48` (`norm`), reemplaza el cuerpo por `return normalizeText(s)` (mantén el nombre local y su firma para no tocar los call sites; solo delega). Importa `normalizeText`.
- [ ] **Step 6: Correr suite** — `pnpm test text-normalize planner ingest` verde; `pnpm typecheck`.
- [ ] **Step 7: Commit** — `refactor(v3): extrae normalizeText compartido (planner/ingest)`.

---

### Task 2: Inferencia pura de producto por clip + tests

**Files:**
- Create: `lib/campaigns/infer-assignment.ts`, `lib/campaigns/infer-assignment.test.ts`

**Interfaces:**
- Consumes: `normalizeText` (Task 1), `productSlug` (`lib/campaigns/product-slug`).
- Produces: `ProductCandidate`, `InferResult` (arriba), y `export function inferProductForClip(clipText: string, pool: ProductCandidate[]): InferResult`.

Reglas de inferencia (deterministas, explicadas):
- Pool vacío → `{ productId: null, confidence: 'none' }`.
- Pool con **exactamente 1** producto → `{ productId: pool[0].id, confidence: 'high' }` (único candidato; caso single-producto = comportamiento actual).
- Pool con >1: normaliza `clipText` (Task 1). Para cada candidato construye tokens de match desde `slug` (split por `-`), `name` (normalizado) y palabras significativas de `visualDetails` (normalizadas, >3 chars). Un candidato "matchea" si su `name` normalizado o su `slug` aparecen como substring en el texto normalizado, o si ≥2 tokens distintos de su nombre aparecen. Cuenta candidatos que matchean:
  - exactamente 1 matchea → `{ productId: ese.id, confidence: 'high' }`.
  - ninguno matchea → `{ productId: null, confidence: 'none' }`.
  - ≥2 matchean (ambiguo) → `{ productId: null, confidence: 'low' }` (el usuario desempata en el tablero).

- [ ] **Step 1: Tests** (casos: pool vacío→none; 1 producto→high ese id; 2 productos donde el texto nombra a uno por name→high; texto que no nombra ninguno→none; texto que nombra dos→low null).

```ts
// lib/campaigns/infer-assignment.test.ts
import { describe, it, expect } from 'vitest';
import { inferProductForClip, type ProductCandidate } from './infer-assignment';
const p = (id: string, name: string, slug: string): ProductCandidate => ({ id, name, slug, visualDetails: null });
describe('inferProductForClip', () => {
  it('pool vacío → none', () => {
    expect(inferProductForClip('clip', [])).toEqual({ productId: null, confidence: 'none' });
  });
  it('un solo producto → high', () => {
    expect(inferProductForClip('cualquier texto', [p('a', 'Canvas Familiar', 'canvas-familiar')]))
      .toEqual({ productId: 'a', confidence: 'high' });
  });
  it('nombra a uno de varios → high ese', () => {
    const pool = [p('a', 'Canvas Familiar', 'canvas-familiar'), p('b', 'Retrato de Pareja', 'retrato-de-pareja')];
    expect(inferProductForClip('El Retrato de Pareja sobre la cabecera', pool))
      .toEqual({ productId: 'b', confidence: 'high' });
  });
  it('no nombra ninguno → none', () => {
    const pool = [p('a', 'Canvas Familiar', 'canvas-familiar'), p('b', 'Retrato de Pareja', 'retrato-de-pareja')];
    expect(inferProductForClip('una toma genérica de la sala', pool))
      .toEqual({ productId: null, confidence: 'none' });
  });
  it('nombra a dos → low null (ambiguo)', () => {
    const pool = [p('a', 'Canvas Familiar', 'canvas-familiar'), p('b', 'Retrato de Pareja', 'retrato-de-pareja')];
    const r = inferProductForClip('el Canvas Familiar junto al Retrato de Pareja', pool);
    expect(r).toEqual({ productId: null, confidence: 'low' });
  });
});
```

- [ ] **Step 2: Correr y ver fallar.**
- [ ] **Step 3: Implementar** `inferProductForClip` según las reglas (cabecera explicando por qué la inferencia depende de que el master nombre productos distinto; espeja el estilo puro de `reference-selection.ts`).
- [ ] **Step 4: Correr y ver pasar** — `pnpm test infer-assignment`. `pnpm typecheck`.
- [ ] **Step 5: Commit** — `feat(v3): inferencia pura de producto por clip`.

---

### Task 3: `setItemProductAction` + pre-llenado por inferencia en `generatePlanAction`

**Files:**
- Modify: `lib/schemas/campaigns.ts`, `server-actions/campaigns.ts`

**Interfaces:**
- Produces: `SetItemProductSchema = z.object({ itemId: z.string().uuid(), productId: z.string().uuid().nullable() })` + `export async function setItemProductAction(input: unknown): Promise<Result<{ updated: true }>>`.

- [ ] **Step 1: Schema** en `lib/schemas/campaigns.ts` — `SetItemProductSchema` + tipo.
- [ ] **Step 2: `setItemProductAction`** en `server-actions/campaigns.ts` (espeja `assignSequenceLocationAction:2898-2936`): valida ownership de la campaña del item (join item→campaign→workspace); si `productId` no null, valida que el product está en `campaign_products` de esa campaña (`select 1 from campaign_products where campaign_id=? and product_id=?`) — si no, `{ ok:false, error:'validation_error', message:'El producto no está en el pool de la campaña' }`; `update({ product_id: productId }).eq('id', itemId)`; `revalidatePath('/app/campaigns/[id]', 'page')` o el path del studio. Gating de estado como `updateCampaignItemAction` (solo si el item está en `planned/skipped/failed`).
- [ ] **Step 3: Pre-llenado en `generatePlanAction`** — tras el insert de `campaign_items` (~1059-1081): si la campaña tiene pool (`campaign_products`), carga los candidatos (`select p.id, p.name, p.slug, p.visual_details from campaign_products cp join products p on p.id=cp.product_id where cp.campaign_id=?`), y por cada item recién creado corre `inferProductForClip(item.scene_prompt + ' ' + item.scene_summary, pool)`; para los de `confidence==='high'` haz `update({product_id}).eq('id', itemId)`. Los `low`/`none` quedan null (el tablero los pide). Hazlo en un batch/loop acotado; best-effort con `console.warn` en error (no abortar el plan).
- [ ] **Step 4: `pnpm typecheck` + `pnpm build`** limpio; `pnpm test` (suite verde).
- [ ] **Step 5: Commit** — `feat(v3): setItemProductAction y pre-llenado de producto por inferencia al armar el plan`.

---

### Task 4: Cargar producto/pool en el studio + selector por fila en PlanTable

**Files:**
- Modify: `lib/campaigns/studio-item.ts`, `app/app/campaigns/[id]/page.tsx`, `components/campaigns/CampaignStudioView.tsx`

**Interfaces:**
- `StudioItem += productId: string | null` (`studio-item.ts`, y su proyector `toStudioItem`).
- `StudioCampaign += brandKitId: string | null; productPool: ProductPoolEntry[]` donde `ProductPoolEntry = { id: string; name: string; imageCount: number }`.

- [ ] **Step 1: `studio-item.ts`** — añade `productId` a `StudioItem` y a `toStudioItem` (leerlo del row).
- [ ] **Step 2: `app/app/campaigns/[id]/page.tsx`** — en la query de campaña añade `brand_kit_id`; en la query de items añade `product_id`; carga el pool: `campaign_products` join `products` (`id, name, product_image_ids`) para esta campaña → `productPool`. Pásalos a `CampaignStudioView`.
- [ ] **Step 3: `CampaignStudioView.tsx` — `StudioCampaign`/props** (~96-113): añade `brandKitId`, `productPool`. Propaga a `PlanTable`.
- [ ] **Step 4: `PlanTable` (~770-1168) — selector de producto por fila**: en cada fila de clip (`renderPlanRow` ~843-947 y filas de escena ~1060-1160), si `productPool.length > 0`, muestra un `<Select>` de producto (opciones = pool; valor = `item.productId`; opción "Sin asignar"). onChange → `setItemProductAction({ itemId, productId })` + `router.refresh()`. Si `item.productId` es null y la campaña tiene marca+pool, resalta la fila (borde/texto ámbar-rojo) y muestra "Sin asignar".
- [ ] **Step 5: `pnpm typecheck` + `pnpm build`** limpio.
- [ ] **Step 6: Commit** — `feat(v3): selector de producto por clip en el tablero del studio`.

---

### Task 5: Gating de "Generar" (cliente + servidor)

**Files:**
- Modify: `server-actions/campaigns.ts` (`generateItemAction`, `approveBatchAction`), `components/campaigns/CampaignStudioView.tsx`

**Interfaces:**
- Consumes: `StudioCampaign.brandKitId`, `productPool`, `StudioItem.productId` (Task 4).

Regla de gating: **una campaña con marca (`brand_kit_id != null`) y pool (`campaign_products` no vacío) no puede generar un clip con `product_id = null`.** (Si no hay pool, no bloquea — no hay nada que asignar.)

- [ ] **Step 1: Servidor — `generateItemAction`** (~1397): antes de `enqueueBatch`, si la campaña tiene `brand_kit_id` y hay ≥1 fila en `campaign_products`, y el item objetivo tiene `product_id` null → `{ ok:false, error:'validation_error', message:'Asigna un producto a este clip antes de generar' }`.
- [ ] **Step 2: Servidor — `approveBatchAction`** (~1733): igual, pero para el batch — si algún item elegible del formato tiene `product_id` null (con campaña marca+pool) → `{ ok:false, error:'validation_error', message:'Hay clips sin producto asignado' }` (no encola ninguno).
- [ ] **Step 3: Cliente — `CampaignStudioView`**: deshabilita el botón "Generar" de una fila cuando `campaign.brandKitId && productPool.length && !item.productId`, con tooltip "Asigna un producto"; deshabilita "Muestra"/"Lote completo" del grupo cuando algún item del grupo esté sin asignar (misma condición). Reusa el resalte de Task 4.
- [ ] **Step 4: `pnpm typecheck` + `pnpm build`** limpio; `pnpm test` verde.
- [ ] **Step 5: Commit** — `feat(v3): bloquea generar clips sin producto en campañas con marca`.

---

## Cierre de fase

Review final de rama (delta Fase 3). Smoke del usuario: crear campaña multi-producto cuyo master nombre productos distinto por clip → verificar que el tablero pre-asigna los claros, resalta los ambiguos, bloquea generar hasta asignar, y que el clip generado usa su producto. Diferido a Fase 4: `reference_selection` por clip. Limpieza pendiente (de Fase 2): escritura legacy a `brand_kits.product_image_ids` y migración que endurezca RLS de `campaign_products_insert`.
