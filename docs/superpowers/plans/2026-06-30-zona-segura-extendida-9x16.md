# Zona segura 9:16 con extension (panel 4:5 + outpaint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantizar por geometria (no por texto) que el producto y las caras queden completos dentro del 4:5 central de un panel 9:16, generando una base 4:5 con Nano y extendiendo las bandas a 9:16 con Nano, como opcion opt-in con aviso de consumo.

**Architecture:** Modo estricto opt-in (flag `safeAreaExtend` en `creative_guidelines`, solo con `safeCrop='4:5'` + aspecto 9:16). Por panel: (1) base 4:5 con Nano sin la clausula de safeCrop; (2) compose la base centrada en un lienzo 9:16 con bandas negras; (3) Nano rellena solo las bandas; (4) pin determinista del centro con la base original. Una sola fila `generations`, ~2x creditos via flujo atomico. Las funciones de geometria son puras (sharp local) y testeables; la orquestacion de dos pasos (IO Nano) la valida el usuario en smoke.

**Tech Stack:** Next.js 15 server actions, TypeScript estricto, `sharp` (ya en uso), Nano Banana (Gemini 3 Pro Image), zod, vitest, sonner/shadcn.

## Global Constraints

- Sin emojis en codigo ni UI. Dark mode, acento `#009fff` (`#0072e6` sobre blanco).
- No `any`: usar `unknown` + narrowing o tipo explicito.
- Usar `pnpm` (no npm): `pnpm vitest run`, `pnpm typecheck`, `pnpm build`, `pnpm eslint`.
- Commits SIN trailer `Co-Authored-By`.
- Archivos nuevos UTF-8 SIN BOM.
- Clausulas de prompt en codigo: ASCII y empiezan con espacio (concatenables).
- Tests NO llaman APIs reales (Gemini/fal.ai/ElevenLabs/QStash); el usuario corre el smoke con API real.
- Creditos siempre via funciones SQL atomicas (`reserve_credits`/`confirm_credits`/`refund_credits`); nunca tocar `credit_balances`/`credit_transactions` a mano.
- `'use server'` solo exporta funciones async (un objeto/const exportado desde un server-action rompe la ruta en prod; solo `pnpm build` lo detecta).
- Sin migracion: `creative_guidelines` ya es jsonb (mig. 049).
- Ausente/off el flag = comportamiento byte-identico al actual (cero regresion).
- Spec fuente: `docs/superpowers/specs/2026-06-30-zona-segura-extendida-9x16-design.md`.

## Mapa de archivos

- Crear `lib/images/safe-area.ts` — geometria pura (sharp): bandas, compose 9:16, crop 4:5 central, pin del centro.
- Crear `lib/images/safe-area.test.ts` — tests con buffers sinteticos.
- Modificar `lib/campaigns/guidelines.ts` — `safeAreaExtend` en el schema + `guidelinesForSafeBase`.
- Modificar `lib/campaigns/guidelines.test.ts` — tests nuevos.
- Modificar `lib/credits/estimator.ts` — param `passes` (multiplicador 2x).
- Modificar `lib/credits/estimator.test.ts` — test del 2x.
- Modificar `lib/campaigns/storyboard.ts` — const `SAFE_AREA_EXTEND_PROMPT`.
- Modificar `lib/campaigns/storyboard.test.ts` — test de la const.
- Modificar `server-actions/storyboard.ts` — helper `extendPanelTo916` + rama estricta en `generatePanelAction` y `refinePanelAction`.
- Modificar `server-actions/campaigns.ts` — `safeAreaExtend` en `SetCreativeGuidelinesSchema` + RMW.
- Modificar `components/campaigns/CreativeGuidelinesEditor.tsx` — switch nuevo gateado (9:16 + safeCrop) con aviso de consumo.
- Modificar `components/campaigns/CampaignStudioView.tsx` — pasar `aspectRatio` al editor.
- Modificar `app/app/campaigns/[id]/page.tsx` — fuente del `aspectRatio` (campaign.aspect_ratio).

---

### Task 1: Geometria de zona segura (sharp, pura)

**Files:**
- Create: `lib/images/safe-area.ts`
- Test: `lib/images/safe-area.test.ts`

**Interfaces:**
- Produces:
  - `safeAreaBands(width: number): { bandPx: number; canvasHeight: number }`
  - `composeOnto916(base4x5: Buffer): Promise<Buffer>`
  - `centralSafeCrop(panel916: Buffer): Promise<Buffer>`
  - `pinCenter(extended916: Buffer, base4x5: Buffer): Promise<Buffer>`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/images/safe-area.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { safeAreaBands, composeOnto916, centralSafeCrop, pinCenter } from './safe-area';

async function solid(width: number, height: number, rgb: [number, number, number]): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}
async function dims(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata();
  return { w: m.width ?? 0, h: m.height ?? 0 };
}
async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data } = await sharp(buf).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2]];
}

describe('safeAreaBands', () => {
  it('calcula banda y alto del lienzo 9:16 desde el ancho de la base 4:5', () => {
    // 360 -> canvas 640 (360*16/9), base 450 (360*5/4), banda (640-450)/2 = 95.
    expect(safeAreaBands(360)).toEqual({ bandPx: 95, canvasHeight: 640 });
  });
});

describe('composeOnto916', () => {
  it('centra la base 4:5 en un lienzo 9:16 con bandas negras', async () => {
    const base = await solid(360, 450, [200, 30, 30]); // rojo
    const out = await composeOnto916(base);
    expect(await dims(out)).toEqual({ w: 360, h: 640 });
    expect(await pixel(out, 180, 320)).toEqual([200, 30, 30]); // centro = base
    expect(await pixel(out, 180, 10)).toEqual([0, 0, 0]); // banda superior negra
    expect(await pixel(out, 180, 630)).toEqual([0, 0, 0]); // banda inferior negra
  });
});

describe('centralSafeCrop', () => {
  it('recupera el 4:5 central de un 9:16 (roundtrip con compose)', async () => {
    const base = await solid(360, 450, [30, 160, 60]); // verde
    const panel = await composeOnto916(base);
    const back = await centralSafeCrop(panel);
    expect(await dims(back)).toEqual({ w: 360, h: 450 });
    expect(await pixel(back, 180, 225)).toEqual([30, 160, 60]);
    expect(await pixel(back, 5, 5)).toEqual([30, 160, 60]);
  });
});

describe('pinCenter', () => {
  it('pega la base original sobre el centro; las bandas vienen del extendido', async () => {
    const extended = await solid(360, 640, [20, 40, 200]); // azul (simula salida Nano)
    const base = await solid(360, 450, [200, 30, 30]); // rojo
    const out = await pinCenter(extended, base);
    expect(await dims(out)).toEqual({ w: 360, h: 640 });
    expect(await pixel(out, 180, 320)).toEqual([200, 30, 30]); // centro = base
    expect(await pixel(out, 180, 10)).toEqual([20, 40, 200]); // banda = extendido
    expect(await pixel(out, 180, 630)).toEqual([20, 40, 200]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run lib/images/safe-area.test.ts`
Expected: FAIL — `safe-area` no existe / funciones no definidas.

- [ ] **Step 3: Implementar `lib/images/safe-area.ts`**

```ts
import 'server-only';
import sharp from 'sharp';

// Geometria pura de la zona segura 4:5 dentro de un frame 9:16 (sharp local, sin
// red, determinista). El producto/caras se generan en una base 4:5 (no caben fuera)
// y se extiende a 9:16 rellenando solo las bandas, con el centro fijado a la base.
const RATIO_4x5 = 5 / 4; // alto/ancho de un 4:5
const RATIO_9x16 = 16 / 9; // alto/ancho de un 9:16

// Banda (arriba/abajo) y alto del lienzo 9:16 para una base 4:5 de ancho `width`.
export function safeAreaBands(width: number): { bandPx: number; canvasHeight: number } {
  const canvasHeight = Math.round(width * RATIO_9x16);
  const baseHeight = Math.round(width * RATIO_4x5);
  const bandPx = Math.round((canvasHeight - baseHeight) / 2);
  return { bandPx, canvasHeight };
}

// Compone la base 4:5 centrada en un lienzo 9:16 con bandas negras (relleno temporal
// para el paso de extension).
export async function composeOnto916(base4x5: Buffer): Promise<Buffer> {
  const meta = await sharp(base4x5).metadata();
  const width = meta.width;
  if (!width) throw new Error('safe-area: base sin ancho');
  const { bandPx, canvasHeight } = safeAreaBands(width);
  return sharp({
    create: { width, height: canvasHeight, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([{ input: base4x5, left: 0, top: bandPx }])
    .png()
    .toBuffer();
}

// Recorta el 4:5 central de un 9:16 guardado (recupera la base; determinista). Lo usa
// la cadena/refino para mantener el turno conversacional en 4:5.
export async function centralSafeCrop(panel916: Buffer): Promise<Buffer> {
  const meta = await sharp(panel916).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error('safe-area: panel sin dimensiones');
  const cropH = Math.round(width * RATIO_4x5);
  const top = Math.max(0, Math.round((height - cropH) / 2));
  const h = Math.min(cropH, height - top);
  return sharp(panel916).extract({ left: 0, top, width, height: h }).png().toBuffer();
}

// Pega la base 4:5 original sobre el centro del 9:16 extendido: el centro final es
// pixel-identico a la base (cero drift); solo las bandas vienen del modelo. Robusto a
// que el extendido tenga un ancho distinto (se reescala la base a ese ancho).
export async function pinCenter(extended916: Buffer, base4x5: Buffer): Promise<Buffer> {
  const meta = await sharp(extended916).metadata();
  const width = meta.width;
  if (!width) throw new Error('safe-area: extendido sin ancho');
  const { bandPx } = safeAreaBands(width);
  const baseHeight = Math.round(width * RATIO_4x5);
  const resizedBase = await sharp(base4x5).resize(width, baseHeight, { fit: 'fill' }).png().toBuffer();
  return sharp(extended916).composite([{ input: resizedBase, left: 0, top: bandPx }]).png().toBuffer();
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run lib/images/safe-area.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/images/safe-area.ts lib/images/safe-area.test.ts
git commit -m "feat(safe-area): geometria 4:5<->9:16 (bandas, compose, crop, pin)"
```

---

### Task 2: Flag `safeAreaExtend` + `guidelinesForSafeBase`

**Files:**
- Modify: `lib/campaigns/guidelines.ts`
- Test: `lib/campaigns/guidelines.test.ts`

**Interfaces:**
- Consumes: `CreativeGuidelines`, `creativeGuidelineClauses` (Task existente).
- Produces:
  - `CreativeGuidelinesSchema` con `safeAreaExtend?: boolean`.
  - `guidelinesForSafeBase(guidelines: CreativeGuidelines | undefined): CreativeGuidelines | undefined`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/campaigns/guidelines.test.ts` (importar `guidelinesForSafeBase` en la primera linea de import):

```ts
describe('safeAreaExtend', () => {
  it('el schema acepta safeAreaExtend y tolera ausencia', () => {
    expect(CreativeGuidelinesSchema.parse({ safeAreaExtend: true }).safeAreaExtend).toBe(true);
    expect(CreativeGuidelinesSchema.parse({}).safeAreaExtend).toBeUndefined();
  });
});

describe('guidelinesForSafeBase', () => {
  it('neutraliza safeCrop y safeAreaExtend, conserva product/hook', () => {
    const base = guidelinesForSafeBase({
      showFullProduct: true,
      hookProductHero: true,
      safeCrop: '4:5',
      safeAreaExtend: true,
    });
    expect(base).toEqual({ showFullProduct: true, hookProductHero: true, safeCrop: null, safeAreaExtend: false });
  });

  it('en la base 4:5 ya no emite la clausula de safe-crop, pero si product/hook', () => {
    const base = guidelinesForSafeBase({ showFullProduct: true, hookProductHero: true, safeCrop: '4:5', safeAreaExtend: true });
    const out = creativeGuidelineClauses(base, { isOpeningBeat: true });
    expect(out).toContain('frame it complete and unobstructed');
    expect(out).toContain('opening hook');
    expect(out).not.toContain('central 4:5 area');
    expect(out).not.toContain('all four of its edges inside that 4:5 area');
  });

  it('tolera undefined', () => {
    expect(guidelinesForSafeBase(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run lib/campaigns/guidelines.test.ts`
Expected: FAIL — `guidelinesForSafeBase` no existe; `safeAreaExtend` no esta en el schema.

- [ ] **Step 3: Implementar en `lib/campaigns/guidelines.ts`**

Extender el schema (agregar la linea `safeAreaExtend`):

```ts
export const CreativeGuidelinesSchema = z.object({
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
  safeAreaExtend: z.boolean().optional(),
});
```

Agregar al final del archivo:

```ts
// Guidelines para la BASE 4:5 del modo estricto: el frame ya ES la zona segura, asi
// que se neutraliza safeCrop (no emitir "mantener dentro del 4:5 central" en un 4:5) y
// safeAreaExtend; se conservan showFullProduct/hookProductHero (ahora el producto
// completo cabe). Devuelve undefined si la entrada es undefined.
export function guidelinesForSafeBase(
  guidelines: CreativeGuidelines | undefined,
): CreativeGuidelines | undefined {
  if (!guidelines) return guidelines;
  return { ...guidelines, safeCrop: null, safeAreaExtend: false };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run lib/campaigns/guidelines.test.ts`
Expected: PASS (todos, nuevos y previos).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/guidelines.ts lib/campaigns/guidelines.test.ts
git commit -m "feat(guidelines): flag safeAreaExtend + guidelinesForSafeBase"
```

---

### Task 3: Estimador 2x (param `passes`)

**Files:**
- Modify: `lib/credits/estimator.ts`
- Create: `lib/credits/estimator.test.ts` (no existe hoy)

**Interfaces:**
- Produces: `EstimateInput.params.passes?: number` que aplica un multiplicador `passes` (>1) en provider `nano-banana`.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/credits/estimator.test.ts` (fixture propio, auto-contenido; `PricingRow` es `{ provider, model_id, variant, credits_cost, unit_size, unit_label }`):

```ts
import { describe, it, expect } from 'vitest';
import { estimateCredits } from './estimator';
import type { PricingRow } from './types';

const NANO_MODEL = 'gemini-3-pro-image-preview';
const NANO_VARIANT = 'pro';
const NANO_ROWS: PricingRow[] = [
  { provider: 'nano-banana', model_id: NANO_MODEL, variant: NANO_VARIANT, credits_cost: 100, unit_size: null, unit_label: null },
];

describe('estimateCredits - nano-banana passes', () => {
  it('sin passes: costo base', () => {
    const r = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: {} });
    expect(r.total).toBe(100);
  });
  it('passes=2 duplica el total (zona segura estricta)', () => {
    const one = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: {} });
    const two = estimateCredits(NANO_ROWS, { provider: 'nano-banana', model: NANO_MODEL, variant: NANO_VARIANT, params: { passes: 2 } });
    expect(two.total).toBe(one.total * 2);
    expect(two.multipliers.some((m) => m.factor === 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run lib/credits/estimator.test.ts`
Expected: FAIL — el test `passes=2` falla (two.total == one.total porque `passes` aun no se aplica).

- [ ] **Step 3: Implementar en `lib/credits/estimator.ts`**

Agregar `passes` al tipo de params:

```ts
  params?: {
    megapixels?: number;
    references?: number;
    conversational?: boolean;
    useGrounding?: boolean;
    charCount?: number;
    durationSeconds?: number;
    passes?: number;
  };
```

En el bloque `if (input.provider === 'nano-banana')`, agregar el multiplicador de pasadas:

```ts
  if (input.provider === 'nano-banana') {
    if (input.params?.conversational) multipliers.push({ label: 'Edición conversacional', factor: 1.5 });
    if (input.params?.useGrounding) multipliers.push({ label: 'Grounding', factor: 1.2 });
    const passes = input.params?.passes ?? 1;
    if (passes > 1) multipliers.push({ label: `Zona segura (${passes} pasadas)`, factor: passes });
  }
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run lib/credits/estimator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/credits/estimator.ts lib/credits/estimator.test.ts
git commit -m "feat(estimator): param passes (multiplicador 2x para zona segura estricta)"
```

---

### Task 4: Constante del prompt de extension

**Files:**
- Modify: `lib/campaigns/storyboard.ts`
- Test: `lib/campaigns/storyboard.test.ts`

**Interfaces:**
- Produces: `SAFE_AREA_EXTEND_PROMPT: string` (instruccion de outpaint de bandas, ASCII).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/campaigns/storyboard.test.ts` (agregar `SAFE_AREA_EXTEND_PROMPT` al import desde `./storyboard`):

```ts
describe('SAFE_AREA_EXTEND_PROMPT', () => {
  it('pide rellenar solo las bandas y preservar el centro, sin sujetos nuevos', () => {
    expect(SAFE_AREA_EXTEND_PROMPT).toContain('keep the central area exactly unchanged');
    expect(SAFE_AREA_EXTEND_PROMPT).toContain('top and bottom bands');
    expect(SAFE_AREA_EXTEND_PROMPT).toContain('do not place the product');
    // ASCII puro.
    expect(/^[\x00-\x7F]*$/.test(SAFE_AREA_EXTEND_PROMPT)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm vitest run lib/campaigns/storyboard.test.ts`
Expected: FAIL — `SAFE_AREA_EXTEND_PROMPT` no existe.

- [ ] **Step 3: Implementar en `lib/campaigns/storyboard.ts`**

Agregar (cerca de las otras constantes/funciones exportadas del archivo):

```ts
// Instruccion para extender la base 4:5 a 9:16: Nano recibe la base centrada en un
// lienzo 9:16 con bandas negras y rellena SOLO esas bandas continuando el fondo, sin
// sujetos. El centro se fija despues por composicion (pinCenter), pero igual se pide
// preservarlo para que las bandas empaten. ASCII.
export const SAFE_AREA_EXTEND_PROMPT =
  'Fill only the empty top and bottom bands of this image by continuing the existing scene and background naturally into them; keep the central area exactly unchanged; do not place the product, any person, any text or any new object in the top or bottom bands - they are background extension only.';
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm vitest run lib/campaigns/storyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/storyboard.ts lib/campaigns/storyboard.test.ts
git commit -m "feat(storyboard): SAFE_AREA_EXTEND_PROMPT para outpaint de bandas"
```

---

### Task 5: Helper `extendPanelTo916` + rama estricta en `generatePanelAction`

**Files:**
- Modify: `server-actions/storyboard.ts`

**Interfaces:**
- Consumes: `safeAreaBands`/`composeOnto916`/`centralSafeCrop`/`pinCenter` (Task 1), `guidelinesForSafeBase` (Task 2), `SAFE_AREA_EXTEND_PROMPT` (Task 4), `estimateCredits` con `passes` (Task 3).
- Produces: helper module-local `extendPanelTo916(base: Buffer, baseMime: string): Promise<{ buffer: Buffer; mimeType: string }>` (reusado por Task 6); `generatePanelAction` con rama estricta.

Esta task es integracion (IO con Nano): no hay test unitario con API real. Verificacion = `pnpm typecheck` + `pnpm build` + suite existente verde. El smoke con API real lo corre el usuario.

- [ ] **Step 1: Agregar imports**

En `server-actions/storyboard.ts`, agregar a los imports existentes:

```ts
import { composeOnto916, centralSafeCrop, pinCenter } from '@/lib/images/safe-area';
import { guidelinesForSafeBase } from '@/lib/campaigns/guidelines';
```

Y agregar `SAFE_AREA_EXTEND_PROMPT` al import existente desde `@/lib/campaigns/storyboard`:

```ts
import { compilePanel, compilePanelEdit, compileRefinePrompt, humanRealismDirective, chainedProductFidelity, chainedCharacterFidelity, SAFE_AREA_EXTEND_PROMPT } from '@/lib/campaigns/storyboard';
```

`creativeGuidelineClauses` ya esta importado (linea 33). `createCreativeGuidelines`/schema no se necesitan aqui.

- [ ] **Step 2: Agregar el helper `extendPanelTo916`**

Justo despues de `makeThumbnail` (linea ~66) en `server-actions/storyboard.ts`:

```ts
// Extiende una base 4:5 a un 9:16 completo: compone la base centrada con bandas negras,
// pide a Nano que rellene SOLO las bandas (single-turn edit), y fija el centro a la base
// original (pinCenter) para garantizar cero drift en producto/caras. Devuelve el 9:16
// final (png). Lo usan generatePanelAction y refinePanelAction en modo estricto.
async function extendPanelTo916(base: Buffer, baseMime: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const canvas = await composeOnto916(base);
  const ext = await generateNanoBanana({
    model: NANO_MODEL_SLUG,
    prompt: SAFE_AREA_EXTEND_PROMPT,
    aspectRatio: '9:16',
    resolution: nanoVariantToResolution(NANO_VARIANT),
    references: [],
    previousTurn: { prompt: '', imageBuffer: canvas, mimeType: 'image/png', thoughtSignature: undefined },
    conversational: false,
    useGrounding: false,
    hasTextInImage: false,
  });
  const pinned = await pinCenter(ext.buffer, base);
  return { buffer: pinned, mimeType: 'image/png' };
}
```

Nota: `previousTurn` sin `thoughtSignature` activa el modo edit single-turn del provider (`wantsChat=false`): "Edit the previous image (attached) based on: <prompt>", con el lienzo adjunto. `baseMime` se acepta por simetria de firma con Task 6 aunque el flujo siempre normaliza a png.

- [ ] **Step 3: Calcular el modo estricto y el contexto base en `generatePanelAction`**

Despues de `const dirCtx = directorContextFor(...)` (linea ~258) y ANTES de `const compiled = compilePanel(...)` (linea ~267), insertar:

```ts
  // Modo estricto de zona segura: genera la base en 4:5 (garantia geometrica) y luego
  // extiende a 9:16. Solo cuando el flag esta on, hay safeCrop 4:5 y el aspecto es 9:16.
  const guidelines = dirCtx.guidelines;
  const strictSafe =
    Boolean(guidelines?.safeAreaExtend) &&
    guidelines?.safeCrop === '4:5' &&
    (item.aspect_ratio ?? '9:16') === '9:16';
  // En la base 4:5 el frame ya ES la zona segura: se quita la clausula de safeCrop.
  const baseDirCtx = strictSafe ? { ...dirCtx, guidelines: guidelinesForSafeBase(guidelines) } : dirCtx;
  const genAspect = strictSafe ? '4:5' : (item.aspect_ratio ?? '9:16');
```

Cambiar la linea 267 para compilar con `baseDirCtx`:

```ts
  const compiled = compilePanel(beat, baseDirCtx, FLUX_MODEL_SLUG, { isOpeningBeat: (item.scene_index ?? 0) === 0 });
```

- [ ] **Step 4: Usar `baseDirCtx.guidelines` en el prompt encadenado**

En la construccion de `panelPrompt` (linea ~315), cambiar SOLO la llamada a `creativeGuidelineClauses(dirCtx.guidelines, ...)` por `creativeGuidelineClauses(baseDirCtx.guidelines, ...)`. El resto del prompt encadenado (chainedProductFidelity(dirCtx), etc.) queda igual:

```ts
  const panelPrompt = prevTurn
    ? `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and in the same position in the scene), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${item.scene_prompt.trim()}.${chainedProductFidelity(dirCtx)}${describeProductScale(dirCtx.product)}${creativeGuidelineClauses(baseDirCtx.guidelines, { isOpeningBeat: (item.scene_index ?? 0) === 0 })}${characterFidelityText}${productRefPointer}${characterRefPointer}${noText}`
    : `${compiled.compiled.prompt}${humanRealismDirective(dirCtx, item.scene_prompt)}${describeProductScale(dirCtx.product)}${noText}`;
```

- [ ] **Step 5: Costo 2x cuando estricto**

En la llamada a `estimateCredits` (linea ~321), agregar `passes`:

```ts
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: Boolean(prevTurn), passes: strictSafe ? 2 : 1 },
  });
```

- [ ] **Step 6: Generar la base en 4:5, recortar el turno previo y extender**

En el bloque `try`, en la llamada `generateNanoBanana` (linea ~404), cambiar `aspectRatio` a `genAspect` y el `previousTurn` por uno recortado a 4:5 cuando sea estricto. Justo antes de esa llamada, insertar el recorte del turno previo:

```ts
    // En estricto, la cadena se mantiene en 4:5: el panel previo guardado es 9:16, se
    // recorta su 4:5 central para alimentar el turno conversacional de la base.
    const basePrevTurn = strictSafe && prevTurn
      ? { ...prevTurn, imageBuffer: await centralSafeCrop(prevTurn.imageBuffer) }
      : prevTurn;

    const result = await generateNanoBanana({
      model: NANO_MODEL_SLUG,
      prompt: panelPrompt,
      aspectRatio: genAspect,
      resolution: nanoVariantToResolution(NANO_VARIANT),
      references,
      previousTurn: basePrevTurn,
      conversational: Boolean(prevTurn),
      useGrounding: false,
      hasTextInImage: false,
      chatReferences,
    });

    // Estricto: extender la base 4:5 a un 9:16 completo (bandas por Nano, centro pinned).
    const finalImage = strictSafe
      ? await extendPanelTo916(result.buffer, result.mimeType)
      : { buffer: result.buffer, mimeType: result.mimeType };
```

Luego, cambiar el upload/thumbnail/complete para usar `finalImage` en vez de `result.buffer`/`result.mimeType` (lineas ~417-442):

```ts
    const ext = inferExtension(finalImage.mimeType);
    const outputPath = await uploadOutput(
      workspace.id,
      generationId,
      finalImage.buffer,
      finalImage.mimeType,
      ext,
    );
    const thumbBuffer = await makeThumbnail(finalImage.buffer);
    const thumbPath = await uploadThumbnail(workspace.id, generationId, thumbBuffer);

    const processingMs = Date.now() - startedAt;
    // thought_signature del turno BASE (4:5): el proximo panel encadenado recorta el
    // 9:16 guardado a 4:5 y reanuda la cadena desde aqui.
    const providerPayload: Record<string, unknown> = {};
    if (result.thoughtSignature) providerPayload.thought_signature = result.thoughtSignature;

    await completeGeneration({
      userId: user.id,
      generationId,
      cost,
      outputUrl: outputPath,
      thumbnailUrl: thumbPath,
      processingMs,
      fileSizeBytes: finalImage.buffer.byteLength,
      providerPayload: Object.keys(providerPayload).length > 0 ? providerPayload : null,
    });
```

(El `catch` de error ya refunda `cost` completo via `failGeneration`; como `cost` ya es 2x, el refund cubre ambas pasadas. No cambia.)

- [ ] **Step 7: Verificar build, typecheck y suite**

Run: `pnpm typecheck`
Expected: sin errores.

Run: `pnpm build`
Expected: "Compiled successfully" (gate de `'use server'`).

Run: `pnpm vitest run`
Expected: PASS (sin regresiones; el modo estricto no tiene test unitario, off es identico).

- [ ] **Step 8: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(storyboard): generatePanelAction genera base 4:5 + extiende a 9:16 en modo estricto"
```

---

### Task 6: Rama estricta en `refinePanelAction`

**Files:**
- Modify: `server-actions/storyboard.ts`

**Interfaces:**
- Consumes: `extendPanelTo916` (Task 5), `centralSafeCrop` (Task 1), `guidelinesForSafeBase` (Task 2), `estimateCredits` con `passes` (Task 3).

Integracion (IO Nano): verificacion = `pnpm typecheck` + `pnpm build` + suite. Smoke = usuario.

- [ ] **Step 1: Calcular el modo estricto en `refinePanelAction`**

Despues de `const dirCtx = directorContextFor(itemRow, null, ctx, undefined, undefined, dirLocation);` (linea ~605) y antes de `const compiled = compilePanelEdit(...)` (linea ~607), insertar:

```ts
  const guidelines = dirCtx.guidelines;
  const strictSafe =
    Boolean(guidelines?.safeAreaExtend) &&
    guidelines?.safeCrop === '4:5' &&
    (item.aspect_ratio ?? '9:16') === '9:16';
  const refineDirCtx = strictSafe ? { ...dirCtx, guidelines: guidelinesForSafeBase(guidelines) } : dirCtx;
  const genAspect = strictSafe ? '4:5' : (item.aspect_ratio ?? '9:16');
```

Cambiar la construccion de `refinePrompt` (linea ~612) para usar `refineDirCtx`:

```ts
  const refinePrompt = compileRefinePrompt(instruction, refineDirCtx, {
    isOpeningBeat: (item.scene_index ?? 0) === 0,
  });
```

(El `compiled = compilePanelEdit(instruction, item.aspect_ratio, dirCtx, NANO_MODEL_SLUG)` se mantiene con `dirCtx` para conservar sus referencias; el prompt ya no sale de ahi.)

- [ ] **Step 2: Costo 2x cuando estricto**

En la llamada `estimateCredits` de `refinePanelAction` (linea ~616), agregar `passes`:

```ts
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: true, passes: strictSafe ? 2 : 1 },
  });
```

- [ ] **Step 3: Recortar el turno previo a 4:5, generar base en 4:5 y extender**

En el bloque `try`, donde se arma `previousTurn` (lineas ~679-709), tras setear `previousTurn` (el del parent 9:16), recortarlo a 4:5 cuando sea estricto. Insertar justo despues del bloque `if (parentGenId) { ... }` que setea `previousTurn`:

```ts
    if (strictSafe && previousTurn) {
      previousTurn = { ...previousTurn, imageBuffer: await centralSafeCrop(previousTurn.imageBuffer) };
    }
```

Cambiar la llamada `generateNanoBanana` (linea ~711) para usar `genAspect`:

```ts
    const result = await generateNanoBanana({
      model: NANO_MODEL_SLUG,
      prompt: refinePrompt,
      aspectRatio: genAspect,
      resolution: nanoVariantToResolution(NANO_VARIANT),
      references,
      previousTurn,
      useGrounding: false,
      conversational: true,
      hasTextInImage: false,
      noBackground: false,
    });

    const finalImage = strictSafe
      ? await extendPanelTo916(result.buffer, result.mimeType)
      : { buffer: result.buffer, mimeType: result.mimeType };
```

Cambiar el upload/thumbnail/complete (lineas ~724-750) para usar `finalImage`:

```ts
    const ext = inferExtension(finalImage.mimeType);
    const outputPath = await uploadOutput(
      workspace.id,
      generationId,
      finalImage.buffer,
      finalImage.mimeType,
      ext,
    );
    const thumbBuffer = await makeThumbnail(finalImage.buffer);
    const thumbPath = await uploadThumbnail(workspace.id, generationId, thumbBuffer);

    const processingMs = Date.now() - startedAt;
    const providerPayload: Record<string, unknown> = {};
    if (result.thoughtSignature) {
      providerPayload.thought_signature = result.thoughtSignature;
    }

    await completeGeneration({
      userId: user.id,
      generationId,
      cost,
      outputUrl: outputPath,
      thumbnailUrl: thumbPath,
      processingMs,
      fileSizeBytes: finalImage.buffer.byteLength,
      providerPayload: Object.keys(providerPayload).length > 0 ? providerPayload : null,
    });
```

Nota: `previousTurn` se declara con `let` (linea ~687) en el codigo actual, asi que reasignarlo es valido.

- [ ] **Step 4: Verificar build, typecheck y suite**

Run: `pnpm typecheck` → sin errores.
Run: `pnpm build` → "Compiled successfully".
Run: `pnpm vitest run` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(storyboard): refinePanelAction genera base 4:5 + extiende a 9:16 en modo estricto"
```

---

### Task 7: UI (switch gateado + aviso) y action

**Files:**
- Modify: `server-actions/campaigns.ts`
- Modify: `components/campaigns/CreativeGuidelinesEditor.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx`
- Modify: `app/app/campaigns/[id]/page.tsx`

Integracion UI: verificacion = `pnpm typecheck` + `pnpm build`.

- [ ] **Step 1: Aceptar `safeAreaExtend` en el action**

En `server-actions/campaigns.ts`, extender `SetCreativeGuidelinesSchema` (linea ~214):

```ts
const SetCreativeGuidelinesSchema = z.object({
  id: z.string().uuid(),
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
  safeAreaExtend: z.boolean().optional(),
});
```

Y en el RMW (despues de la linea de `safeCrop`, ~245):

```ts
  if (parsed.data.safeAreaExtend !== undefined) next.safeAreaExtend = parsed.data.safeAreaExtend;
```

- [ ] **Step 2: Switch nuevo en el editor, gateado y con aviso**

En `components/campaigns/CreativeGuidelinesEditor.tsx`:

Extender props y estado:

```tsx
export function CreativeGuidelinesEditor({
  campaignId,
  aspectRatio,
  initial,
}: {
  campaignId: string;
  aspectRatio?: string | null;
  initial?: { showFullProduct?: boolean; hookProductHero?: boolean; safeCrop?: '4:5' | null; safeAreaExtend?: boolean };
}) {
  const [showFullProduct, setShowFullProduct] = useState(initial?.showFullProduct ?? false);
  const [hookProductHero, setHookProductHero] = useState(initial?.hookProductHero ?? false);
  const [safeCrop, setSafeCrop] = useState<'4:5' | null>(initial?.safeCrop ?? null);
  const [safeAreaExtend, setSafeAreaExtend] = useState(initial?.safeAreaExtend ?? false);
  const [pending, startTransition] = useTransition();

  const canExtend = aspectRatio === '9:16' && safeCrop === '4:5';
```

Incluir `safeAreaExtend` en el save (efectivo solo si `canExtend`):

```tsx
  const save = () => {
    startTransition(async () => {
      const res = await setCreativeGuidelinesAction({
        id: campaignId,
        showFullProduct,
        hookProductHero,
        safeCrop,
        safeAreaExtend: canExtend ? safeAreaExtend : false,
      });
      if (res.ok) toast.success('Guías guardadas');
      else toast.error('No se pudieron guardar las guías');
    });
  };
```

Agregar el switch despues del de `safeCrop` (dentro del `div` de switches, despues de la linea ~52), visible solo si `canExtend`:

```tsx
        {canExtend && (
          <label className="flex flex-col gap-1 text-xs text-zinc-300">
            <span className="flex items-center gap-2">
              <Switch checked={safeAreaExtend} onCheckedChange={setSafeAreaExtend} />
              Zona segura estricta (9:16 + recorte 4:5 garantizado)
            </span>
            <span className="pl-10 text-[11px] leading-relaxed text-amber-400/90">
              Genera cada panel dos veces (base 4:5 + extensión a 9:16): ~2x créditos por panel.
            </span>
          </label>
        )}
```

- [ ] **Step 3: Pasar `aspectRatio` desde `CampaignStudioView`**

En `components/campaigns/CampaignStudioView.tsx`:

Agregar `aspectRatio` al tipo `StudioCampaign` (despues de linea ~100) y a `guidelines`:

```ts
  guidelines?: { showFullProduct?: boolean; hookProductHero?: boolean; safeCrop?: '4:5' | null; safeAreaExtend?: boolean };
  aspectRatio?: string | null;
```

Pasar el prop al editor (linea ~435):

```tsx
        <CreativeGuidelinesEditor campaignId={campaign.id} aspectRatio={campaign.aspectRatio} initial={campaign.guidelines} />
```

- [ ] **Step 4: Fuente del `aspectRatio` en la pagina**

En `app/app/campaigns/[id]/page.tsx`, la columna `aspect_ratio` existe en `campaigns` pero el select de la campana (linea ~35) NO la trae. Agregarla al select:

```ts
    .select('id, name, description, color, created_at, status, goal, product_brief, credits_estimated, total_items, idea_text, creative_guidelines, aspect_ratio')
```

Y en el objeto que se pasa a `CampaignStudioView` (linea ~113-127, donde ya se mapea `guidelines: CreativeGuidelinesSchema.catch({}).parse(campaign.creative_guidelines ?? {})`), agregar:

```tsx
          aspectRatio: campaign.aspect_ratio ?? null,
```

El flag `safeAreaExtend` NO requiere mapeo manual: `guidelines` se parsea con `CreativeGuidelinesSchema.catch({}).parse(...)`, que tras Task 2 ya incluye `safeAreaExtend`. Solo asegurar que el tipo `StudioCampaign.guidelines` (Task 7 Step 3) lo declare.

- [ ] **Step 5: Verificar build y typecheck**

Run: `pnpm typecheck` → sin errores.
Run: `pnpm build` → "Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add server-actions/campaigns.ts components/campaigns/CreativeGuidelinesEditor.tsx components/campaigns/CampaignStudioView.tsx app/app/campaigns/[id]/page.tsx
git commit -m "feat(campaigns): switch Zona segura estricta (gateado 9:16+safeCrop) con aviso de consumo"
```

---

## Verificacion final (post-tasks)

- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm build` "Compiled successfully".
- [ ] `pnpm vitest run` toda la suite verde.
- [ ] Smoke (usuario, API real): en "Anuncio #11.4" (9:16), activar "Encuadre recortable a 4:5" y luego "Zona segura estricta", regenerar FRESCO el hook y un beat encadenado, y refinar uno. Verificar: el 9:16 sale completo (fondo extendido arriba/abajo), el producto entero vive en el 4:5 central, y el recorte 4:5 no pierde el cuadro. Confirmar que el costo del panel se duplico.

## Notas de verificacion (riesgos del spec)

- Confirmar que Nano (`gemini-3-pro-image-preview`) acepta `aspectRatio: '4:5'` (ratio estandar de Gemini). Si rechaza, generar a un ratio cercano soportado y recortar a 4:5 con `sharp` antes de `composeOnto916` (ajuste local en `extendPanelTo916`/base, no en la geometria).
- Posible costura entre el centro (base) y las bandas (Nano) en `pinCenter`; aceptable en v1, feather queda fuera de alcance.
- El video solo hereda por el frame de apertura; si Seedance filtra contenido a las bandas en movimiento, intervenir el video es v2.
