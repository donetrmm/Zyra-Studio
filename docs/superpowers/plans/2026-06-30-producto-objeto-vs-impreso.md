# Producto como objeto vs contenido impreso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un producto que es "un objeto con una imagen impresa" (canvas, taza, playera) se describa como el OBJETO (no como su arte), anclado por dos campos declarados por el usuario (`medium`, `thicknessMm`), de modo que el grosor/soporte lleguen al video y al panel.

**Architecture:** Campos opcionales en `product_brief` (jsonb, sin migración). `describeProduct` (usado en video y panel fresco) compone objeto-vs-impreso cuando hay `medium`; idéntico cuando no. SYSTEM del brief mejorado (conservador). UI extendida. Plomería paralela a `heightCm/widthCm`.

**Tech Stack:** Next.js 15, TypeScript strict, zod, Supabase (jsonb), vitest, shadcn/ui.

## Global Constraints

- Sin emojis en código ni UI.
- Sin `any`: `unknown` + narrowing o tipo explícito.
- `pnpm` (`pnpm vitest`, `pnpm typecheck`, `pnpm lint`, `pnpm build`).
- Commits SIN trailer `Co-Authored-By`.
- `'use server'` solo exporta funciones async (validar con `pnpm build`).
- Tests sin APIs reales (el SYSTEM del brief se testea por su string PURO, sin llamar a Gemini).
- Archivos nuevos UTF-8 SIN BOM. Texto de prompt en ASCII.
- Sin `medium`, `describeProduct` debe quedar **byte-idéntico** (cero regresión en videos/paneles existentes).
- Sin migración SQL (jsonb). Sin cambios de RLS.

---

## File Structure

- `lib/prompt-director/types.ts` — `ProductInventory` gana `medium?`, `thicknessMm?`.
- `lib/prompt-director/inventory.ts` — `describeProduct` compone objeto-vs-impreso.
- `lib/prompt-director/inventory.test.ts` — tests de `describeProduct`.
- `lib/campaigns/brief.ts` — `ProductBriefSchema` gana `medium?`, `thicknessMm?`; SYSTEM exportado + instrucción de separación.
- `lib/campaigns/brief.test.ts` — schema + SYSTEM.
- `lib/campaigns/orchestrator.ts` — `CampaignContext.productMedium?/productThicknessMm?`, lectura en `loadCampaignContext`, mapeo en `directorContextFor`.
- `lib/campaigns/director-context.test.ts` — passthrough de medium/thickness.
- `server-actions/campaigns.ts` — `setProductDimensionsAction` extendida.
- `components/campaigns/ProductSizeEditor.tsx` — tarjeta "Producto físico" (medium + grosor).
- `components/campaigns/CampaignStudioView.tsx` + `app/app/campaigns/[id]/page.tsx` — pasar medium/thickness iniciales.

**Nota de cobertura:** `describeProduct` se usa en el compilador de **video** y en el de **panel fresco** (FLUX) → la corrección llega a ambos automáticamente. El **panel encadenado** arma su prompt a mano con `chainedProductFidelity` (no `describeProduct`); queda FUERA de v1 (el flujo del usuario es regenerar FRESCO, como se le indicó). Documentado, no es regresión.

---

## Task 1: `ProductInventory` + `describeProduct` (núcleo puro)

**Files:**
- Modify: `lib/prompt-director/types.ts`
- Modify: `lib/prompt-director/inventory.ts`
- Test: `lib/prompt-director/inventory.test.ts`

**Interfaces:**
- Produces: `ProductInventory.medium?: string`, `ProductInventory.thicknessMm?: number`; `describeProduct` con composición objeto-vs-impreso.

- [ ] **Step 1: Tests de `describeProduct`**

Añadir en `lib/prompt-director/inventory.test.ts` (reusa el builder de `ProductInventory` que ya tenga el archivo; si no, construye un objeto con `name`, `imagePaths: []`):

```ts
describe('describeProduct — objeto vs impreso', () => {
  const base = { name: 'X', palette: ['red'], imagePaths: [] as string[], visualDetails: 'a family party photo' };
  it('con medium describe el OBJETO y separa el impreso', () => {
    const out = describeProduct({ ...base, medium: 'canvas print' });
    expect(out).toContain('Product: a canvas print');
    expect(out).toContain('displays this printed image: a family party photo');
    expect(out).toContain('The product itself is the physical canvas print');
    expect(out).not.toContain('Product: X');
  });
  it('con thicknessMm añade la cláusula de grosor', () => {
    const out = describeProduct({ ...base, medium: 'canvas print', thicknessMm: 10 });
    expect(out).toContain('about 10 mm thin at the edge');
    expect(out).toContain('do not render a thick block frame');
  });
  it('SIN medium queda idéntico al comportamiento actual', () => {
    const out = describeProduct({ ...base });
    expect(out).toContain('Product: X');
    expect(out).toContain('brand colors red');
    expect(out).not.toContain('printed image');
  });
});
```

- [ ] **Step 2: Correr (falla)**

Run: `pnpm vitest run lib/prompt-director/inventory.test.ts`
Expected: FAIL (TS: `medium`/`thicknessMm` no existen; o cláusulas ausentes).

- [ ] **Step 3: Campos en `ProductInventory`**

En `lib/prompt-director/types.ts`, en `type ProductInventory` (tras `widthCm?: number;`), añadir:
```ts
  // Producto como OBJETO con imagen impresa (canvas, taza, playera): el medium es
  // el objeto/soporte y visualDetails pasa a ser el contenido impreso. Ausente =
  // el producto se describe como hoy. Declarado por el usuario (no inferido).
  medium?: string;
  // Grosor del canto en mm (ej. canvas delgado ~10). Declarado por el usuario.
  thicknessMm?: number;
```

- [ ] **Step 4: Componer en `describeProduct`**

En `lib/prompt-director/inventory.ts`, reemplazar el cuerpo de `describeProduct` para ramificar por `medium`, manteniendo la rama sin `medium` byte-idéntica:

```ts
export function describeProduct(
  product: ProductInventory,
  opts: { fidelity?: boolean } = {},
): string {
  let facts: string;
  if (product.medium) {
    const displays = product.visualDetails
      ? ` that displays this printed image: ${product.visualDetails}`
      : '';
    const colors = product.palette?.length ? ` Printed colors: ${product.palette.join(', ')}.` : '';
    const thin = product.thicknessMm
      ? ` It is about ${product.thicknessMm} mm thin at the edge; do not render a thick block frame or a deep gallery-wrap, keep the edge slim.`
      : '';
    facts = `Product: a ${product.medium}${displays}.${colors} The product itself is the physical ${product.medium}; the depicted content is only printed on its surface, not separate physical objects.${thin}`;
  } else {
    const parts = [`Product: ${product.name}`];
    if (product.visualDetails) parts.push(product.visualDetails);
    if (product.palette?.length) parts.push(`brand colors ${product.palette.join(', ')}`);
    facts = `${parts.join(', ')}.`;
  }
  if (opts.fidelity === false) return facts;
  if (!product.imagePaths.length) {
    return `${facts} Render the product exactly with these declared attributes; do not invent packaging, colors, logo or any detail that is not listed.`;
  }
  return `${facts} The product must appear exactly as shown in its reference images — same packaging, colors, logo placement and proportions. Never restyle the product.`;
}
```

> Verifica que el comentario-cabecera previo de `describeProduct` se conserve o se ajuste; no borres documentación intencional.

- [ ] **Step 5: Correr (pasa)**

Run: `pnpm typecheck && pnpm vitest run lib/prompt-director/inventory.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/inventory.ts lib/prompt-director/inventory.test.ts
git commit -m "feat(prompt-director): describeProduct separa objeto vs contenido impreso (medium + grosor)"
```

---

## Task 2: `ProductBriefSchema` (medium + thicknessMm)

**Files:**
- Modify: `lib/campaigns/brief.ts`
- Test: `lib/campaigns/brief.test.ts`

**Interfaces:**
- Produces: `ProductBriefSchema` acepta `medium?: string`, `thicknessMm?: number`.

- [ ] **Step 1: Tests del schema**

En `lib/campaigns/brief.test.ts`:
```ts
it('acepta medium y thicknessMm opcionales', () => {
  const r = ProductBriefSchema.parse({ productName: 'X', category: 'home', medium: 'canvas print', thicknessMm: 10 });
  expect(r.medium).toBe('canvas print');
  expect(r.thicknessMm).toBe(10);
});
it('rechaza thicknessMm <= 0 y > 500', () => {
  expect(ProductBriefSchema.safeParse({ productName: 'X', category: 'home', thicknessMm: 0 }).success).toBe(false);
  expect(ProductBriefSchema.safeParse({ productName: 'X', category: 'home', thicknessMm: 600 }).success).toBe(false);
});
it('tolera ausencia (cero cambio)', () => {
  const r = ProductBriefSchema.parse({ productName: 'X', category: 'home' });
  expect(r.medium).toBeUndefined();
  expect(r.thicknessMm).toBeUndefined();
});
```

- [ ] **Step 2: Correr (falla)**

Run: `pnpm vitest run lib/campaigns/brief.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extender el schema**

En `lib/campaigns/brief.ts`, en `ProductBriefSchema` (tras `widthCm`):
```ts
  // Tipo de objeto/soporte cuando el producto es un objeto con imagen impresa
  // (canvas, taza, playera). Texto libre. Lo provee el usuario (no se infiere).
  medium: z.string().max(120).optional(),
  // Grosor del canto en mm (ej. canvas delgado ~10). Lo provee el usuario.
  thicknessMm: z.number().positive().max(500).optional(),
```

- [ ] **Step 4: Correr (pasa)**

Run: `pnpm vitest run lib/campaigns/brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/brief.ts lib/campaigns/brief.test.ts
git commit -m "feat(brief): ProductBriefSchema acepta medium y thicknessMm"
```

---

## Task 3: SYSTEM del brief — separación objeto/impreso (conservador)

**Files:**
- Modify: `lib/campaigns/brief.ts`
- Test: `lib/campaigns/brief.test.ts`

**Interfaces:**
- Produces: `SYSTEM` exportado (o ya export) con la instrucción de separación objeto/impreso.

- [ ] **Step 1: Test del SYSTEM (puro, sin LLM)**

En `lib/campaigns/brief.test.ts`:
```ts
import { BRIEF_SYSTEM } from './brief';
it('el SYSTEM instruye separar objeto de contenido impreso', () => {
  expect(BRIEF_SYSTEM).toMatch(/impres|printed/i);
  expect(BRIEF_SYSTEM).toMatch(/objeto|object/i);
});
```

- [ ] **Step 2: Correr (falla)**

Run: `pnpm vitest run lib/campaigns/brief.test.ts`
Expected: FAIL (`BRIEF_SYSTEM` no exportado / sin la instrucción).

- [ ] **Step 3: Exportar el SYSTEM y añadir la instrucción**

En `lib/campaigns/brief.ts`: renombrar/exportar el `const SYSTEM` como `export const BRIEF_SYSTEM` (ajustar su uso en `analyzeProductBrief`). Añadir al texto, antes de las "Reglas:", un párrafo:

```
Si el producto es un OBJETO con una imagen impresa encima (un canvas/cuadro, una taza, una playera, un poster, etc.), identifica el OBJETO y descríbelo aparte del contenido impreso: "productName" debe ser el objeto (por ejemplo "Canvas print"), NO la escena impresa; en "visualDetails" describe primero el objeto (material, forma, acabado, borde) y luego lo que muestra impreso. No declares el arte impreso como si fuera el producto. Si solo ves el arte plano y no puedes determinar el objeto, descríbelo como imagen impresa sin inventar el tipo de objeto.
```

> Mantén el resto del SYSTEM igual (no cambies el shape del JSON pedido). No agregues `medium`/`thicknessMm` al JSON pedido (los provee el usuario, no la IA).

- [ ] **Step 4: Correr (pasa) + typecheck**

Run: `pnpm typecheck && pnpm vitest run lib/campaigns/brief.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/brief.ts lib/campaigns/brief.test.ts
git commit -m "feat(brief): SYSTEM separa el objeto del contenido impreso"
```

---

## Task 4: Plomería en el orquestador

**Files:**
- Modify: `lib/campaigns/orchestrator.ts`
- Test: `lib/campaigns/director-context.test.ts`

**Interfaces:**
- Consumes: `ProductInventory.medium/thicknessMm` (Task 1), `ProductBriefSchema` (Task 2).
- Produces: `CampaignContext.productMedium?/productThicknessMm?`; `directorContextFor` los mapea al `product` del `DirectorContext`.

- [ ] **Step 1: Test de passthrough**

En `lib/campaigns/director-context.test.ts`, añadir (reusa el `CampaignContext` base del archivo):
```ts
it('directorContextFor propaga medium y thicknessMm del producto', () => {
  const ctx = { ...baseCtx, productMedium: 'canvas print', productThicknessMm: 10 };
  const dir = directorContextFor(baseItem, baseFormat, ctx);
  expect(dir.product?.medium).toBe('canvas print');
  expect(dir.product?.thicknessMm).toBe(10);
});
```

- [ ] **Step 2: Correr (falla)**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: FAIL.

- [ ] **Step 3: `CampaignContext` + lectura del brief**

En `lib/campaigns/orchestrator.ts`:
- En `type CampaignContext` (junto a `productHeightCm?/productWidthCm?`, ~L117): añadir `productMedium?: string; productThicknessMm?: number;`.
- En `loadCampaignContext`, el cast del `brief` (~L233-236, tras `heightCm?/widthCm?`): añadir `medium?: string; thicknessMm?: number;`.
- En el objeto que retorna (~L330, tras `productWidthCm: brief.widthCm`): añadir `productMedium: brief.medium, productThicknessMm: brief.thicknessMm,`.

- [ ] **Step 4: Mapeo en `directorContextFor`**

En `directorContextFor`, el objeto `product` (~L363-370, tras `widthCm: ctx.productWidthCm`): añadir `medium: ctx.productMedium, thicknessMm: ctx.productThicknessMm,`.

- [ ] **Step 5: Correr (pasa) + typecheck**

Run: `pnpm typecheck && pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts
git commit -m "feat(campaigns): propagar medium y thicknessMm del brief al producto"
```

---

## Task 5: UI + server action ("Producto físico")

**Files:**
- Modify: `server-actions/campaigns.ts` (`setProductDimensionsAction`)
- Modify: `components/campaigns/ProductSizeEditor.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx`
- Modify: `app/app/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `ProductBriefSchema` (Task 2).

- [ ] **Step 1: Extender `setProductDimensionsAction`**

En `server-actions/campaigns.ts`, ampliar el schema local y el read-modify-write de `setProductDimensionsAction` para incluir:
- `medium: z.string().max(120).optional()` — string vacío/`null` quita la clave; `undefined` no toca.
- `thicknessMm: z.number().positive().max(500).nullable().optional()` — `null` quita; `undefined` no toca.
Mismo patrón existente de `heightCm/widthCm` (merge sobre el jsonb `product_brief`, ownership, guard not-null). NO exportar el schema (módulo `'use server'`).

- [ ] **Step 2: Extender el editor → "Producto físico"**

En `components/campaigns/ProductSizeEditor.tsx`: cambiar el título de la tarjeta a "Producto físico" y agregar, antes de los inputs de alto/ancho:
- Input de texto **"Tipo de producto / soporte"** (placeholder "ej. canvas, taza, playera") → estado `medium`.
- Input numérico **"Grosor (mm)"** (placeholder "ej. 10") → estado `thicknessMm` (mismo `parse()` que alto/ancho: vacío→null).
El `save()` ahora manda `{ id, heightCm, widthCm, medium: medium.trim() || null, thicknessMm }`. Acepta props `initialMedium?: string`, `initialThicknessMm?: number`. Sin emojis; acentos correctos; sin BOM.

- [ ] **Step 3: Pasar valores iniciales**

En `components/campaigns/CampaignStudioView.tsx`: el tipo `StudioCampaign` gana `productMedium?: string; productThicknessMm?: number;`; pásalos al `<ProductSizeEditor ... initialMedium={campaign.productMedium} initialThicknessMm={campaign.productThicknessMm} />`.
En `app/app/campaigns/[id]/page.tsx`: leer `brief.medium`/`brief.thicknessMm` del `product_brief` (reusa el cast existente que ya lee `heightCm/widthCm`) y pasarlos.

- [ ] **Step 4: Gate de build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: limpios; build "Compiled successfully" (valida `'use server'`). Si OOM (exit 3221226505), `rm -rf .next` y reintentar una vez.

- [ ] **Step 5: Commit**

```bash
git add server-actions/campaigns.ts components/campaigns/ProductSizeEditor.tsx components/campaigns/CampaignStudioView.tsx app/app/campaigns/[id]/page.tsx
git commit -m "feat(campaigns): editor Producto fisico (medium + grosor) + accion"
```

---

## Cierre

- [ ] Suite completa verde: `pnpm test`.
- [ ] `pnpm typecheck && pnpm lint && pnpm build` limpios.
- [ ] Smoke del usuario: en "Anuncio #11.3" fijar medium="canvas print" + grosor=10, regenerar FRESCO panel + video, verificar que sale el canvas delgado y no decoración de fiesta.
