# P01 — Hoja multi-vista de producto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir generar la vista 3/4 de un producto desde su foto subida (reusando el motor Nano Banana existente), agregarla a `brand_kits.product_image_ids`, y avisar deterministamente cuando un producto tiene una sola vista.

**Architecture:** Tres piezas, sin migración. (1) Un helper cliente `generateProductAngle` que delega en `editUploaded` con un prompt de producto. (2) Una regla determinista en el validador que avisa con una sola vista. (3) Un botón en el editor de Brand Kit que llama el helper y antepone el resultado a `product_image_ids` (tope 4). El consumo (compiler citando las primeras 3 imágenes) ya existe y no se toca.

**Tech Stack:** Next.js 15 (React client components), TypeScript, Vitest, pnpm. Providers Nano Banana vía `submitGenerationAction` (flujo existente). Sin migración, sin tabla nueva.

## Global Constraints

- **pnpm**: `pnpm typecheck`, `pnpm vitest run <archivo>`. Full suite: `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run`.
- **No `any`**: usa `vi.mocked()` para los mocks (no `as any`); tipos explícitos.
- **No emojis** en código/UI. Dark mode, componentes shadcn/estilo existente.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): el test de generación mockea `submitGenerationAction`/`addGenerationAsReferenceAction`; la UI se valida por smoke.
- **Sin migración / sin tabla nueva:** se reusa `brand_kits.product_image_ids[]` (tope 4, ya existente).
- **No fabricar texto de marca:** el prompt de ángulo prohíbe alterar/inventar la etiqueta.
- **Iniciado por el usuario:** la generación (que consume créditos) solo se dispara al pulsar el botón, nunca automática.
- **Commits sin trailer `Co-Authored-By`.**

---

### Task 1: `generateProductAngle` (helper de generación)

**Files:**
- Modify: `components/creation/generate.ts` (agregar `PRODUCT_ANGLE_PROMPT` + `generateProductAngle`)
- Test: `components/creation/generate.test.ts` (NUEVO)

**Interfaces:**
- Consumes: `editUploaded(reference: { id: string; storagePath: string }, instruction: string, opts?): Promise<GeneratedImage | GenError>` (ya existe en el mismo archivo); `GeneratedImage = { generationId: string; refId: string; previewUrl: string; storagePath: string }`.
- Produces: `export async function generateProductAngle(productRef: { id: string; storagePath: string }, view: 'three-quarter'): Promise<GeneratedImage | GenError>`. Lo consume Task 3 (UI).

- [ ] **Step 1: Escribir el test (RED)**

Crear `components/creation/generate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/server-actions/generations', () => ({ submitGenerationAction: vi.fn() }));
vi.mock('@/server-actions/media-references', () => ({ addGenerationAsReferenceAction: vi.fn() }));

import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { generateProductAngle, isGenError } from './generate';

describe('generateProductAngle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rota el producto a 3/4 vía Nano Banana (editUploaded) con prompt de producto', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: true, data: { generationId: 'gen1' } });
    vi.mocked(addGenerationAsReferenceAction).mockResolvedValue({
      ok: true,
      data: { id: 'ref1', previewUrl: 'prev', storagePath: 'ws/ref1.png' },
    });

    const res = await generateProductAngle({ id: 'src', storagePath: 'ws/src.png' }, 'three-quarter');

    expect(isGenError(res)).toBe(false);
    if (!isGenError(res)) expect(res.refId).toBe('ref1');

    const call = vi.mocked(submitGenerationAction).mock.calls[0][0];
    expect(call.provider).toBe('nano-banana');
    expect(call.conversational).toBe(false); // editUploaded: la foto va como referencia, no como parent
    expect(call.references).toEqual([{ id: 'src', storagePath: 'ws/src.png' }]);
    expect(call.prompt).toMatch(/three-quarter/i);
    expect(call.prompt).toMatch(/Do not alter or invent any label text/i);
  });

  it('propaga el error de la generación', async () => {
    vi.mocked(submitGenerationAction).mockResolvedValue({ ok: false, error: 'provider_error', message: 'boom' });
    const res = await generateProductAngle({ id: 'src', storagePath: 'ws/src.png' }, 'three-quarter');
    expect(isGenError(res)).toBe(true);
    if (isGenError(res)) expect(res.message).toBe('boom');
  });
});
```

> Si el tipo de retorno de `addGenerationAsReferenceAction` exige más campos que `{ id, previewUrl, storagePath }`, agrégalos al objeto del mock para satisfacer el tipo (NO uses `as any`). Lee la firma real en `server-actions/media-references.ts`.

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run components/creation/generate.test.ts`
Expected: FAIL — `generateProductAngle` no existe / no exportada.

- [ ] **Step 3: Implementar `generateProductAngle`**

En `components/creation/generate.ts`, después de `generateAngle` (~línea 82):

```ts
// Vista 3/4 de un PRODUCTO (P01). El producto suele ser una foto SUBIDA, así que
// va por editUploaded (la foto entra como referencia de Nano Banana, no como parent
// conversacional). Rota la cámara preservando la identidad del producto; NO altera
// ni inventa la etiqueta (respeta "no fabricar texto de marca").
const PRODUCT_ANGLE_PROMPT: Record<'three-quarter', string> = {
  'three-quarter':
    'Show the exact same product from a three-quarter view (about 45 degrees). Identical shape, colors, label, logo, materials and proportions; same soft even studio lighting and clean plain background. Only the camera angle changes — keep the product perfectly consistent. Do not alter or invent any label text.',
};

export async function generateProductAngle(
  productRef: { id: string; storagePath: string },
  view: 'three-quarter',
): Promise<GeneratedImage | GenError> {
  return editUploaded(productRef, PRODUCT_ANGLE_PROMPT[view]);
}
```

- [ ] **Step 4: Correr el test (GREEN) + typecheck**

Run: `pnpm vitest run components/creation/generate.test.ts` y `pnpm typecheck`
Expected: PASS los 2 tests; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add components/creation/generate.ts components/creation/generate.test.ts
git commit -m "feat(creation): generateProductAngle genera la vista 3/4 de un producto (P01)"
```

---

### Task 2: Warning determinista de vista única (validador)

**Files:**
- Modify: `lib/prompt-director/validators.ts` (regla nueva tras la 12)
- Test: `lib/prompt-director/validators.test.ts`

**Interfaces:**
- Consumes: `ctx.product?.imagePaths` (ya en `DirectorContext`).
- Produces: warning con prefijo `producto:` cuando el producto tiene exactamente 1 imagen.

- [ ] **Step 1: Escribir los tests (RED)**

En `lib/prompt-director/validators.test.ts` (importa `validate` y `DirectorContext`/`CompileRequest` — el archivo ya los usa):

```ts
describe('validators P01 — vista única del producto', () => {
  function warnFor(product: DirectorContext['product']): string[] {
    return validate(
      { modelSlug: 'seedance-2', scenePrompt: 'the product on a clean table' } as CompileRequest,
      { product } as DirectorContext,
    ).warnings;
  }
  it('avisa cuando el producto tiene una sola imagen', () => {
    const w = warnFor({ name: 'Serum', imagePaths: ['ws/a.png'] });
    expect(w.some((x) => x.startsWith('producto:'))).toBe(true);
  });
  it('no avisa con 2+ imágenes', () => {
    const w = warnFor({ name: 'Serum', imagePaths: ['ws/a.png', 'ws/b.png'] });
    expect(w.some((x) => x.startsWith('producto:'))).toBe(false);
  });
  it('no avisa sin producto', () => {
    const w = warnFor(undefined);
    expect(w.some((x) => x.startsWith('producto:'))).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests (RED)**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts`
Expected: FAIL — ningún warning empieza con `producto:`.

- [ ] **Step 3: Agregar la regla 13**

En `lib/prompt-director/validators.ts`, después del bloque de la regla 12 (P12 estructura por tramo) y antes de `return { errors, warnings };`:

```ts
  // 13. Vista única del producto (P01): con una sola imagen de referencia, I2V/R2V
  // deriva la geometría del producto (no tiene estructura 3D que anclar). Warning ->
  // el usuario genera un 3/4 en el Brand Kit (botón en BrandKitsPage).
  if (ctx.product?.imagePaths?.length === 1) {
    warnings.push(
      'producto: vista única — riesgo de deriva geométrica en I2V/R2V; genera un 3/4 en el Brand Kit',
    );
  }
```

- [ ] **Step 4: Correr los tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/validators.test.ts` y `pnpm typecheck`
Expected: PASS los 3 tests nuevos; sin regresión en P12/P14/P14b/P21; typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/validators.ts lib/prompt-director/validators.test.ts
git commit -m "feat(prompt-director): warning de vista única del producto (P01)"
```

---

### Task 3: Botón "Generar vista 3/4" en el Brand Kit

**Files:**
- Modify: `components/brand-kits/BrandKitsPage.tsx` (handler + botón en el editor `BrandKitEditor`)

**Interfaces:**
- Consumes: `generateProductAngle`, `isGenError` (Task 1, `@/components/creation/generate`); `getReferencePathsAction(ids): Promise<Result<Record<string,string>>>` (`@/server-actions/creation`, ya importado en el archivo y usado en `openImprove`).
- Produces: nada para otras tasks (hoja del árbol).

**Contexto:** El editor `BrandKitEditor` (`BrandKitsPage.tsx:219`) mantiene `productImages: RefImage[]` (`RefImage = { id: string; previewUrl: string | null }`, máx 4) y los persiste en `handleSave` vía `setBrandKitImagesAction`. Hay un botón modelo justo arriba: el de "Detectar nombre, paleta y tono" (busca `onClick={detectFromImage}`), copia su estilo/estructura. `generateProductAngle` necesita el `storagePath` de la imagen fuente; el `KitEditor` solo tiene el `id`, así que se resuelve con `getReferencePathsAction([id])` (mismo patrón que `openImprove`).

- [ ] **Step 1: Imports + estado**

En `components/brand-kits/BrandKitsPage.tsx`:

(a) Asegúrate de importar el helper de generación (junto a los imports de `@/components/creation/...`):

```ts
import { generateProductAngle, isGenError } from '@/components/creation/generate';
```

(b) Confirma que `getReferencePathsAction` ya está importado (lo usa `openImprove`). Si no, agrégalo desde `@/server-actions/creation`.

(c) En el componente `BrandKitEditor` (donde viven `productImages`/`detecting`, `BrandKitsPage.tsx:219`), añade estado:

```ts
  const [angling, setAngling] = useState(false);
```

- [ ] **Step 2: Handler**

Dentro de `BrandKitEditor`, junto a `detectFromImage`:

```ts
  // Genera la vista 3/4 del producto (P01) desde la PRIMERA imagen subida y la
  // antepone a la lista (tope 4). Se conserva al Guardar (setBrandKitImagesAction).
  async function generateThreeQuarter() {
    if (productImages.length === 0 || productImages.length >= 4 || angling) return;
    setAngling(true);
    try {
      const src = productImages[0];
      const pathRes = await getReferencePathsAction([src.id]);
      const storagePath = pathRes.ok ? pathRes.data[src.id] : undefined;
      if (!storagePath) { toast.error('No se pudo resolver la imagen de producto'); return; }
      const out = await generateProductAngle({ id: src.id, storagePath }, 'three-quarter');
      if (isGenError(out)) { toast.error(out.message || 'No se pudo generar la vista 3/4'); return; }
      setProductImages((prev) => [{ id: out.refId, previewUrl: out.previewUrl }, ...prev].slice(0, 4));
      toast.success('Vista 3/4 generada; guarda el kit para conservarla');
    } finally {
      setAngling(false);
    }
  }
```

- [ ] **Step 3: Botón (JSX)**

Inmediatamente después del botón "Detectar nombre, paleta y tono" (el `<button onClick={detectFromImage} ...>`), añade:

```tsx
        <button
          type="button"
          onClick={generateThreeQuarter}
          disabled={angling || productImages.length === 0 || productImages.length >= 4}
          title={
            productImages.length === 0
              ? 'Sube primero una imagen de producto'
              : productImages.length >= 4
                ? 'Ya tienes el máximo de vistas (4)'
                : 'Genera una vista 3/4 para reducir la deriva geométrica en video'
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {angling ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5 text-primary" aria-hidden />}
          Generar vista 3/4 del producto
        </button>
```

(`Loader2` y `Sparkles` ya están importados —los usa el botón de detectar—; reúsalos.)

- [ ] **Step 4: typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add components/brand-kits/BrandKitsPage.tsx
git commit -m "feat(brand-kits): boton para generar la vista 3/4 del producto (P01)"
```

---

## Verificación final (tras las 3 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `NODE_OPTIONS="--max-old-space-size=4096" pnpm vitest run` — suite verde (incluye los tests de Task 1 y Task 2).
- [ ] Smoke del usuario (API real):
  1. Crear/editar un Brand Kit con UNA sola imagen de producto.
  2. En una campaña con ese kit, ver el warning `producto: vista única…` en `campaign_items.warnings`.
  3. Pulsar "Generar vista 3/4 del producto" en el editor del kit → ver la nueva imagen en la lista, Guardar.
  4. Confirmar que `product_image_ids` ahora tiene 2 ids, el warning desaparece, y una generación posterior cita ambas vistas.

## Notas para el implementador

- `generateProductAngle` reusa `editUploaded` (NO `editImage`): el producto es una foto subida, sin turn conversacional previo. `conversational: false` es correcto.
- NO agregues un slot `product_angle_image_ids` ni migración: el 3/4 entra a `product_image_ids` y el compiler ya lo cita (primeras 3). `media_references.source='generation'` (lo pone `addGenerationAsReference`) distingue subida vs generada si hiciera falta después.
- El botón opera sobre `productImages[0]` (la imagen primaria/frontal) como fuente del 3/4.
- El cambio en la lista es local hasta que el usuario Guarda (igual que el resto del editor); no persistas dentro del handler.
