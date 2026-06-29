# Ancla de escala del producto en el storyboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anclar el tamaño físico del producto (ej. cuadro de 150 cm) como una proporción verbal contra un adulto, e inyectarla en el prompt del panel del storyboard para que sea consistente entre paneles.

**Architecture:** Campo opcional `heightCm`/`widthCm` en el jsonb `product_brief` (sin migración) → fluye por `CampaignContext`/`DirectorContext` → un helper puro `describeProductScale` traduce cm a una frase de proporción relativa a un adulto de pie (170 cm) → se concatena al prompt del panel fresco, encadenado y del refine. No toca `describeProduct` global ni los compiladores de video.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Supabase (jsonb), zod, vitest, pnpm.

## Global Constraints

- No emojis en código ni UI.
- No `any` en TypeScript — usa `unknown` + narrowing o un tipo explícito.
- Commits **SIN** trailer `Co-Authored-By`.
- Gestor de paquetes: **pnpm** (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`).
- Archivos nuevos UTF-8 **sin BOM**.
- Un archivo `'use server'` solo exporta funciones async (lo cataría solo `pnpm build`).
- Tests **sin APIs reales** (Gemini/fal.ai/etc.). Solo lógica pura.
- `product_brief` es **jsonb** → estas dimensiones **no requieren migración SQL ni cambios de RLS**.
- Referencia de adulto: **170 cm** (`ADULT_REF_CM`). Producto asumido en display vertical.
- Alcance: **solo storyboard**. No tocar `describeProduct` (uso global) ni `lib/prompt-director/compilers/seedance.ts` (video intacto).

---

### Task 1: Helper `describeProductScale` + campos en `ProductInventory`

**Files:**
- Modify: `lib/prompt-director/types.ts:40-52` (añadir `heightCm?`/`widthCm?` a `ProductInventory`)
- Modify: `lib/prompt-director/inventory.ts` (añadir `ADULT_REF_CM` + `describeProductScale`)
- Create: `lib/prompt-director/inventory.test.ts`

**Interfaces:**
- Produces: `export const ADULT_REF_CM = 170;` y `export function describeProductScale(product?: ProductInventory): string` — devuelve `''` si no hay producto o no hay dimensiones; si hay, devuelve una cláusula que **empieza con un espacio** (lista para concatenar).
- Produces: `ProductInventory` con `heightCm?: number; widthCm?: number`.

- [ ] **Step 1: Añadir campos opcionales a `ProductInventory`**

En `lib/prompt-director/types.ts`, dentro de `export type ProductInventory = { … }` (después de `variants?: string[];`, antes de `imagePaths`), añade:

```typescript
  // Tamaño físico declarado por el usuario (opcional). Solo productos con tamaño
  // relevante (cuadro, mueble) lo llenan. Ancla la proporción contra el personaje
  // en el storyboard. Ausente = sin ancla de escala (cero cambio).
  heightCm?: number;
  widthCm?: number;
```

- [ ] **Step 2: Escribir el test que falla**

Crea `lib/prompt-director/inventory.test.ts` (UTF-8 sin BOM):

```typescript
import { describe, it, expect } from 'vitest';
import { describeProductScale, ADULT_REF_CM } from './inventory';

describe('describeProductScale', () => {
  it('150 cm de alto → proporción shoulder-to-head de un adulto', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150 });
    expect(d).toContain('150 cm tall');
    expect(d).toContain('nearly shoulder-to-head height of a standing adult');
    expect(d).toContain('keep that size constant in every shot');
    expect(d.startsWith(' ')).toBe(true);
  });

  it('objeto chico (10 cm) → cabe en una mano', () => {
    const d = describeProductScale({ name: 'Bottle', imagePaths: [], heightCm: 10 });
    expect(d).toContain('small enough to hold in one hand');
  });

  it('más alto que una persona (200 cm) → taller than a standing adult', () => {
    const d = describeProductScale({ name: 'Sculpture', imagePaths: [], heightCm: 200 });
    expect(d).toContain('taller than a standing adult');
  });

  it('alto + ancho → cita ambas dimensiones', () => {
    const d = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150, widthCm: 100 });
    expect(d).toContain('150 cm tall');
    expect(d).toContain('100 cm wide');
  });

  it('sin dimensiones → cadena vacía', () => {
    expect(describeProductScale({ name: 'Service', imagePaths: [] })).toBe('');
  });

  it('producto undefined → cadena vacía', () => {
    expect(describeProductScale(undefined)).toBe('');
  });

  it('ADULT_REF_CM es 170', () => {
    expect(ADULT_REF_CM).toBe(170);
  });
});
```

- [ ] **Step 3: Correr el test para verque falla**

Run: `pnpm vitest run lib/prompt-director/inventory.test.ts`
Expected: FAIL con "describeProductScale is not a function" / export no encontrado.

- [ ] **Step 4: Implementar `describeProductScale`**

En `lib/prompt-director/inventory.ts`, al final del archivo (después de `describeCharacter`), añade:

```typescript
// Referencia de estatura de un adulto de pie. La escala del producto se expresa
// como proporción contra esta altura porque los personajes son age-blind y no
// tienen estatura en el modelo.
export const ADULT_REF_CM = 170;

// Ancla de ESCALA del producto para el storyboard (specs/.../escala-producto).
// Traduce el tamaño físico declarado (heightCm/widthCm, opcionales) a una frase
// de proporción contra un adulto de pie y pide mantenerla constante entre tomas.
// Devuelve '' si no hay producto o no hay dimensiones (productos sin tamaño
// relevante no se ven afectados). Empieza con espacio (lista para concatenar).
// Es de escala/proporción, NO de identidad: no arrastra el riesgo de re-render
// de las cláusulas de personaje. Asume el producto mostrado vertical.
export function describeProductScale(product?: ProductInventory): string {
  if (!product) return '';
  const size = product.heightCm ?? product.widthCm;
  if (!size || size <= 0) return '';
  const ratio = size / ADULT_REF_CM;
  const proportion =
    ratio < 0.12 ? 'small enough to hold in one hand'
    : ratio < 0.25 ? 'about knee-high on a standing adult'
    : ratio < 0.45 ? 'about thigh-to-waist high on a standing adult'
    : ratio < 0.60 ? 'about waist-to-chest high on a standing adult'
    : ratio < 0.80 ? 'reaching the chest-to-shoulders of a standing adult'
    : ratio < 0.95 ? 'nearly shoulder-to-head height of a standing adult'
    : ratio < 1.10 ? 'about as tall as a standing adult'
    : 'taller than a standing adult';
  const dims =
    product.heightCm && product.widthCm
      ? `about ${product.heightCm} cm tall and ${product.widthCm} cm wide`
      : product.heightCm
        ? `about ${product.heightCm} cm tall`
        : `about ${product.widthCm} cm wide`;
  return ` The product is a physical piece, ${dims} - ${proportion}. Render it at this real-world scale and proportion relative to the people, and keep that size constant in every shot; do not shrink or enlarge it between shots.`;
}
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `pnpm vitest run lib/prompt-director/inventory.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: typecheck 0 errores; lint 0 errores (warnings preexistentes OK).

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/inventory.ts lib/prompt-director/inventory.test.ts
git commit -m "feat(storyboard): helper describeProductScale + dimensiones en ProductInventory"
```

---

### Task 2: Dimensiones opcionales en `ProductBriefSchema`

**Files:**
- Modify: `lib/campaigns/brief.ts:20-32` (`ProductBriefSchema`)
- Create: `lib/campaigns/brief.test.ts`

**Interfaces:**
- Produces: `ProductBrief` (tipo inferido) ahora con `heightCm?: number` y `widthCm?: number` opcionales.

- [ ] **Step 1: Escribir el test que falla**

Crea `lib/campaigns/brief.test.ts` (UTF-8 sin BOM):

```typescript
import { describe, it, expect } from 'vitest';
import { ProductBriefSchema } from './brief';

const base = { productName: 'Canvas', category: 'home' as const };

describe('ProductBriefSchema — dimensiones', () => {
  it('acepta heightCm/widthCm válidos', () => {
    const r = ProductBriefSchema.safeParse({ ...base, heightCm: 150, widthCm: 100 });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.heightCm).toBe(150);
      expect(r.data.widthCm).toBe(100);
    }
  });

  it('tolera ausencia (undefined) sin romper', () => {
    const r = ProductBriefSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.heightCm).toBeUndefined();
  });

  it('rechaza valores ≤ 0', () => {
    expect(ProductBriefSchema.safeParse({ ...base, heightCm: 0 }).success).toBe(false);
    expect(ProductBriefSchema.safeParse({ ...base, heightCm: -5 }).success).toBe(false);
  });

  it('rechaza valores absurdos (> 2000)', () => {
    expect(ProductBriefSchema.safeParse({ ...base, heightCm: 5000 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run lib/campaigns/brief.test.ts`
Expected: FAIL — `heightCm`/`widthCm` no existen en el tipo inferido, o el caso ">2000" pasa cuando no debería.

- [ ] **Step 3: Añadir los campos al schema**

En `lib/campaigns/brief.ts`, dentro de `export const ProductBriefSchema = z.object({ … })`, después de `market: z.string().max(80).default('global'),` y antes del `});`, añade:

```typescript
  // Tamaño físico del producto (opcional). Solo productos con tamaño relevante.
  // Cap 2000 cm para atrapar typos. Lo provee el usuario; la IA del brief NO lo
  // infiere (no se deduce de una foto sin referencia).
  heightCm: z.number().positive().max(2000).optional(),
  widthCm: z.number().positive().max(2000).optional(),
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm vitest run lib/campaigns/brief.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/brief.ts lib/campaigns/brief.test.ts
git commit -m "feat(storyboard): heightCm/widthCm opcionales en ProductBriefSchema"
```

---

### Task 3: Plomería por `orchestrator.ts` (CampaignContext → ProductInventory)

**Files:**
- Modify: `lib/campaigns/orchestrator.ts:100-114` (`CampaignContext`)
- Modify: `lib/campaigns/orchestrator.ts:221-225` (cast del brief en `loadCampaignContext`)
- Modify: `lib/campaigns/orchestrator.ts:308-318` (return de `loadCampaignContext`)
- Modify: `lib/campaigns/orchestrator.ts:345-354` (mapeo en `directorContextFor`)
- Modify: `lib/campaigns/director-context.test.ts` (test del passthrough)

**Interfaces:**
- Consumes: `ProductInventory.heightCm/widthCm` (Task 1), `ProductBrief.heightCm/widthCm` (Task 2).
- Produces: `CampaignContext` con `productHeightCm?: number; productWidthCm?: number`; `directorContextFor(...).product.heightCm/widthCm` poblados desde el contexto.

- [ ] **Step 1: Escribir el test que falla**

En `lib/campaigns/director-context.test.ts`, localiza un test existente que llame a `directorContextFor` con un `CampaignContext`. Añade un nuevo `it` que reuse el mismo `item`/`format` de ese archivo y pase un ctx con dimensiones (copia el objeto ctx base del test vecino y añade los dos campos):

```typescript
it('propaga las dimensiones del producto a DirectorContext.product', () => {
  // Reusa el mismo item/format mínimos que los demás tests de este archivo.
  const ctx = {
    productName: 'Canvas',
    productImagePaths: [],
    packagingImagePaths: [],
    characters: new Map(),
    language: 'es' as const,
    productHeightCm: 150,
    productWidthCm: 100,
  };
  const res = directorContextFor(ITEM_FIXTURE, null, ctx);
  expect(res.product?.heightCm).toBe(150);
  expect(res.product?.widthCm).toBe(100);
});
```

Nota: sustituye `ITEM_FIXTURE` por el `ItemRow` mínimo que ya construyen los otros tests de este archivo (mismo objeto/builder). Si los demás tests lo crean inline, copia ese literal.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: FAIL — `productHeightCm` no existe en `CampaignContext` (TS) o `res.product.heightCm` es `undefined`.

- [ ] **Step 3: Añadir campos a `CampaignContext`**

En `lib/campaigns/orchestrator.ts`, dentro de `export type CampaignContext = { … }` (después de `productImageUsages?: Record<string, string>;`), añade:

```typescript
  // Tamaño físico del producto (de product_brief). Opcional; ancla la escala en
  // el storyboard. Ausente = sin ancla.
  productHeightCm?: number;
  productWidthCm?: number;
```

- [ ] **Step 4: Leerlos del brief en `loadCampaignContext`**

En `lib/campaigns/orchestrator.ts`, amplía el cast del brief (actual `lib/campaigns/orchestrator.ts:221-225`):

```typescript
  const brief = (campaign.product_brief ?? {}) as {
    productName?: string;
    visualDetails?: string;
    palette?: string[];
    heightCm?: number;
    widthCm?: number;
  };
```

Y en el `return { … }` de `loadCampaignContext` (actual `:308-318`), después de `productImageUsages,`, añade:

```typescript
    productHeightCm: brief.heightCm,
    productWidthCm: brief.widthCm,
```

- [ ] **Step 5: Mapearlos en `directorContextFor`**

En `lib/campaigns/orchestrator.ts`, dentro del objeto `product: { … }` de `directorContextFor` (actual `:345-354`), después de `imageUsages: ctx.productImageUsages,`, añade:

```typescript
      heightCm: ctx.productHeightCm,
      widthCm: ctx.productWidthCm,
```

- [ ] **Step 6: Correr el test para verificar que pasa**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: PASS.

- [ ] **Step 7: typecheck + suite**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck 0; toda la suite verde.

- [ ] **Step 8: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts
git commit -m "feat(storyboard): propagar dimensiones del producto por el orquestador"
```

---

### Task 4: Inyectar la cláusula de escala en los prompts del panel

**Files:**
- Modify: `server-actions/storyboard.ts` (import + `generatePanelAction` `panelPrompt` `:311-313` + `refinePanelAction` prompt `:708`/`:628`)

**Interfaces:**
- Consumes: `describeProductScale` (Task 1), `dirCtx.product` (ya existe en ambas acciones vía `directorContextFor`).

- [ ] **Step 1: Importar el helper**

En `server-actions/storyboard.ts`, añade a los imports (junto a los de `@/lib/prompt-director/...` o como import nuevo):

```typescript
import { describeProductScale } from '@/lib/prompt-director/inventory';
```

- [ ] **Step 2: Inyectar en `panelPrompt` (fresco y encadenado)**

En `generatePanelAction`, reemplaza el bloque `const panelPrompt = prevTurn ? … : …;` (actual `server-actions/storyboard.ts:311-313`) por:

```typescript
  const panelPrompt = prevTurn
    ? `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and in the same position in the scene), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${item.scene_prompt.trim()}.${chainedProductFidelity(dirCtx)}${describeProductScale(dirCtx.product)}${characterFidelityText}${productRefPointer}${characterRefPointer}${noText}`
    : `${compiled.compiled.prompt}${humanRealismDirective(dirCtx, item.scene_prompt)}${describeProductScale(dirCtx.product)}${noText}`;
```

(El único cambio es `${describeProductScale(dirCtx.product)}` añadido en ambas ramas.)

- [ ] **Step 3: Inyectar en el refine**

En `refinePanelAction`, después de obtener `compiled` (donde se valida `compiled.ok`), define el prompt con escala y úsalo en ambos lugares. Reemplaza el uso de `compiled.compiled.prompt` en el `insert` (actual `:628`) y en `generateNanoBanana` (actual `:708`) por una variable común. Justo después del bloque `if (!compiled.ok) { … }` añade:

```typescript
  const refinePrompt = `${compiled.compiled.prompt}${describeProductScale(dirCtx.product)}`;
```

Luego cambia `prompt: compiled.compiled.prompt,` (en el `.insert({ … })`) por `prompt: refinePrompt,` y `prompt: compiled.compiled.prompt,` (en la llamada a `generateNanoBanana({ … })`) por `prompt: refinePrompt,`.

- [ ] **Step 4: Verificar que la inyección está presente**

Run: `git grep -n "describeProductScale(dirCtx.product)" -- server-actions/storyboard.ts`
Expected: 3 coincidencias (rama fresca, rama encadenada, refine).

- [ ] **Step 5: typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck 0; lint 0 errores; build `Compiled successfully` (si OOM transitorio: borra `.next` y reintenta). El build es el único gate que cata el gotcha de `'use server'`.

- [ ] **Step 6: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(storyboard): inyectar la escala del producto en panel fresco, encadenado y refine"
```

---

### Task 5: Server action `setProductDimensionsAction`

**Files:**
- Modify: `server-actions/campaigns.ts` (nueva acción async exportada, junto a `updateCampaignStudioAction`)

**Interfaces:**
- Produces: `setProductDimensionsAction(input: unknown): Promise<Result<{ updated: true }>>` — `input = { id: uuid, heightCm?: number|null, widthCm?: number|null }`. `null` limpia el campo; `undefined` lo deja igual. Read-modify-write del jsonb `product_brief`.

- [ ] **Step 1: Añadir el schema y la acción**

En `server-actions/campaigns.ts`, después de `updateCampaignStudioAction` (tras su `}` en `:150`), añade:

```typescript
// Setear el tamaño físico del producto (storyboard). Read-modify-write del jsonb
// product_brief (un update reemplazaría todo el objeto). null limpia; undefined no
// toca. Guard `.not('product_brief','is',null)`: solo campañas studio.
const SetProductDimensionsSchema = z.object({
  id: z.string().uuid(),
  heightCm: z.number().positive().max(2000).nullable().optional(),
  widthCm: z.number().positive().max(2000).nullable().optional(),
});

export async function setProductDimensionsAction(
  input: unknown,
): Promise<Result<{ updated: true }>> {
  const parsed = SetProductDimensionsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: row } = await supabase
    .from('campaigns')
    .select('product_brief')
    .eq('id', parsed.data.id)
    .eq('workspace_id', workspace.id)
    .not('product_brief', 'is', null)
    .single();
  if (!row) return { ok: false, error: 'not_found' };

  const brief = (row.product_brief ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...brief };
  if (parsed.data.heightCm !== undefined) {
    if (parsed.data.heightCm === null) delete next.heightCm;
    else next.heightCm = parsed.data.heightCm;
  }
  if (parsed.data.widthCm !== undefined) {
    if (parsed.data.widthCm === null) delete next.widthCm;
    else next.widthCm = parsed.data.widthCm;
  }

  const { error } = await supabase
    .from('campaigns')
    .update({ product_brief: next })
    .eq('id', parsed.data.id)
    .eq('workspace_id', workspace.id)
    .not('product_brief', 'is', null);
  if (error) return { ok: false, error: 'internal_error', message: error.message };
  revalidatePath(`/app/campaigns/${parsed.data.id}`);
  return { ok: true, data: { updated: true } };
}
```

Nota: `z`, `requireWorkspace`, `createClient`, `revalidatePath` y el tipo `Result` ya están importados en este archivo (los usa `updateCampaignStudioAction`). No añadas exports que no sean funciones async (gotcha `'use server'`).

- [ ] **Step 2: typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck 0; lint 0 errores; build `Compiled successfully` (verifica el contrato `'use server'`).

- [ ] **Step 3: Commit**

```bash
git add server-actions/campaigns.ts
git commit -m "feat(storyboard): setProductDimensionsAction (patch jsonb product_brief)"
```

---

### Task 6: UI — capturar el tamaño en la página de la campaña

**Files:**
- Create: `components/campaigns/ProductSizeEditor.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx:89` (tipo del prop `campaign`) y `:347` (montar el editor cerca del header del producto)
- Modify: `app/app/campaigns/[id]/page.tsx` (leer `heightCm`/`widthCm` del `product_brief` y pasarlos al prop `campaign`)

**Interfaces:**
- Consumes: `setProductDimensionsAction` (Task 5).
- Produces: control en la vista de campaña que setea el tamaño y revalida.

- [ ] **Step 1: Crear `ProductSizeEditor`**

Crea `components/campaigns/ProductSizeEditor.tsx` (UTF-8 sin BOM, `'use client'`). Usa los mismos primitivos UI y el `toast` que ya importa `CampaignStudioView.tsx` (revisa sus imports: `Input`, `Button`, y el helper de toast del proyecto). Plantilla:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { setProductDimensionsAction } from '@/server-actions/campaigns';
// Ajusta estos imports a los que usa CampaignStudioView (Input, Button, toast):
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function ProductSizeEditor({
  campaignId,
  initialHeightCm,
  initialWidthCm,
}: {
  campaignId: string;
  initialHeightCm?: number;
  initialWidthCm?: number;
}) {
  const [height, setHeight] = useState(initialHeightCm?.toString() ?? '');
  const [width, setWidth] = useState(initialWidthCm?.toString() ?? '');
  const [pending, startTransition] = useTransition();

  const parse = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const save = () => {
    const h = parse(height);
    const w = parse(width);
    if (height.trim() && h === null) return toast.error('Alto inválido');
    if (width.trim() && w === null) return toast.error('Ancho inválido');
    startTransition(async () => {
      const res = await setProductDimensionsAction({ id: campaignId, heightCm: h, widthCm: w });
      if (res.ok) toast.success('Tamaño guardado');
      else toast.error('No se pudo guardar el tamaño');
    });
  };

  return (
    <div className="flex items-end gap-2">
      <label className="flex flex-col text-xs text-zinc-400">
        Alto (cm)
        <Input
          type="number"
          inputMode="numeric"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
          className="w-24"
          placeholder="opcional"
        />
      </label>
      <label className="flex flex-col text-xs text-zinc-400">
        Ancho (cm)
        <Input
          type="number"
          inputMode="numeric"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
          className="w-24"
          placeholder="opcional"
        />
      </label>
      <Button type="button" variant="secondary" size="sm" onClick={save} disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar tamaño'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Pasar las dimensiones por el prop `campaign` de la página**

En `app/app/campaigns/[id]/page.tsx`, busca dónde se construye el objeto que se pasa como prop `campaign` a `CampaignStudioView` (donde ya se setea `productName` desde `product_brief`). Añade la lectura de las dimensiones del `product_brief` y pásalas en ese objeto, p. ej.:

```typescript
const brief = (campaign.product_brief ?? {}) as { heightCm?: number; widthCm?: number };
// …en el objeto que se pasa al componente:
productHeightCm: brief.heightCm,
productWidthCm: brief.widthCm,
```

(Usa el mismo cast/objeto donde ya se obtiene `productName` para no duplicar el acceso a `product_brief`.)

- [ ] **Step 3: Ampliar el tipo del prop y montar el editor en `CampaignStudioView`**

En `components/campaigns/CampaignStudioView.tsx`, en el tipo del prop `campaign` (cerca de `:89`, donde está `productName: string;`), añade:

```typescript
  productHeightCm?: number;
  productWidthCm?: number;
```

Importa el editor al inicio del archivo:

```typescript
import { ProductSizeEditor } from '@/components/campaigns/ProductSizeEditor';
```

Y móntalo cerca del header del producto (después de la línea `{campaign.productName} · {items.length} creativos`, `:347`):

```tsx
<ProductSizeEditor
  campaignId={campaign.id}
  initialHeightCm={campaign.productHeightCm}
  initialWidthCm={campaign.productWidthCm}
/>
```

(Verifica que `campaign.id` esté en el prop; si el campo del id tiene otro nombre, usa ese.)

- [ ] **Step 4: typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck 0; lint 0 errores; build `Compiled successfully`.

- [ ] **Step 5: Smoke manual (lo corre el usuario)**

En la campaña "Anuncio #11": abrir la vista de campaña → en el editor de tamaño poner Alto = 150 → Guardar → regenerar los paneles del storyboard → confirmar que el cuadro mantiene un tamaño consistente y proporcionado contra el personaje entre paneles.

- [ ] **Step 6: Commit**

```bash
git add components/campaigns/ProductSizeEditor.tsx components/campaigns/CampaignStudioView.tsx "app/app/campaigns/[id]/page.tsx"
git commit -m "feat(storyboard): UI para capturar el tamaño del producto en la campaña"
```

---

## Notas de ejecución

- Tasks 1-3 son lógica pura con TDD (test rojo → verde). Tasks 4-6 son cableado/UI: se verifican con `pnpm typecheck && pnpm lint && pnpm build` y el smoke manual del usuario (sin APIs reales en tests, por política del repo).
- El build (`pnpm build`) es el único gate que cata el gotcha de `'use server'` (exportar algo que no sea función async). Córrelo en las tasks que tocan `server-actions/`.
- Si `pnpm build` truena con código `3221226505` (OOM transitorio del worker estático), borra `.next` y reintenta; no es un error de código.
