# Estudio creativo — Fase 2: estudio de producto usable end-to-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un estudio de chat a página completa que permita crear, editar iterando, y adjuntar imágenes a UN producto de punta a punta (generar → iterar sobre la imagen de trabajo → adjuntar al producto por rol).

**Architecture:** Ruta dedicada `/app/studio/product/[assetId]` (RSC) que resuelve la sesión activa y monta un cliente de 2 columnas (chat izquierda + galería derecha). Cada turno del chat encola una fila `generations` vía la `submitStudioTurnAction` de Fase 1 (QStash) y se resuelve por Realtime con el patrón `use-generation-status` del repo. La edición en contexto (imagen de trabajo como base) y el guard "mantener idéntico" se cablean en el worker (Fase 1 los persistía pero no los consumía). La galería muestra thumbnails públicos; adjuntar reusa `addGenerationAsReferenceAction` + `setProductImagesAction`.

**Tech Stack:** Next.js 15 (App Router, RSC + `'use client'`), Supabase (`@supabase/ssr`, Realtime `postgres_changes`), shadcn, sonner, Vercel AI Gateway (server-side, worker), zod, vitest.

## Global Constraints

Cada requisito de cada task incluye implícitamente esta sección. Valores exactos:

- **Gestor de paquetes:** `pnpm` (nunca npm). Typecheck: `pnpm typecheck`. Build: `pnpm build`. Tests: `pnpm test`. Lint: `pnpm lint`.
- **TypeScript sin `any`:** usar `unknown` + narrowing o un tipo explícito.
- **Sin emojis** en código ni UI. Sistema visual minimalista premium.
- **Dark mode por defecto**, paleta base `zinc-950`, acento `#009fff` (usar `#0072e6` cuando el fondo lleve texto blanco, por contraste AA).
- **Componentes shadcn primero** (`@/components/ui/*`); escribir desde cero solo si no existe.
- **Server Components por default**; `'use client'` solo si hay state/effects.
- **Server Actions para toda mutación**, validación con schema zod en `lib/schemas/`.
- **Créditos solo vía funciones SQL atómicas** (`reserveCredits`/`confirmCredits`/`refundCredits`/`failGeneration`). Nunca tocar `credit_balances`/`credit_transactions` directo. En Fase 2 esto ya ocurre dentro de `submitStudioTurnAction`/worker (Fase 1) — no se replica.
- **URLs de proveedor nunca al cliente.** El worker sube a Supabase Storage; el cliente solo ve paths internos → thumbnails públicos (`*.supabase.co/storage/v1/object/public/thumbnails/...`) o URLs firmadas server-side.
- **Service role / admin client solo server-side.** Nunca importar `lib/supabase/admin.ts` desde un módulo que llegue al bundle cliente.
- **RLS por `workspace_id`**; las server actions validan ownership además de RLS.
- **Todo por el Vercel AI Gateway** con `AI_GATEWAY_API_KEY`. Sin `OPENAI_API_KEY` directo.
- **Tests sin APIs reales** (vitest puro; sin Gemini/gpt-image/QStash/Supabase reales). Los smokes con key real los corre el usuario.
- **Commits en español, imperativos, SIN `Co-Authored-By`.**
- **Fase 2 NO tiene migración nueva** (la 061 ya está aplicada a prod `dzqhngfwlgxkmxohlwun`). No se aplica ni modifica ninguna migración.

**Alcance Fase 2 (producto solamente):** locación y personaje (y outfits/estados) son Fase 4; presets y el retiro de `CreationWizard`/`MasterImageRefiner` son Fase 5. La ruta `/app/studio/[assetType]/[assetId]` acepta el segmento `assetType` pero Fase 2 solo cablea `product`; cualquier otro `assetType` responde `notFound()`.

---

### Task 1: El worker honra el contexto de la sesión (imagen base desde el parent + guard "mantener idéntico")

Fase 1 persiste `parent_generation_id` y `params.keepIdentical` pero `runImageTurn` los ignora: cada turno sale como texto-a-imagen sin base ni guard. Sin esto el "chat que itera" no itera. Este task cablea ambos en el worker, con lógica pura testeable.

**Files:**
- Modify: `lib/schemas/studio.ts` (añadir `assetType` opcional a `SubmitStudioTurnSchema`)
- Modify: `server-actions/studio.ts:147-152` (guardar `assetType` en `params`)
- Modify: `lib/jobs/handlers/types.ts:34-51` (`GenerationRow` += `parent_generation_id`)
- Modify: `app/api/jobs/process/route.ts:71-72` (SELECT += `parent_generation_id`)
- Create: `lib/studio/prompt-assembly.ts`
- Create: `lib/studio/prompt-assembly.test.ts`
- Create: `lib/jobs/handlers/base-image.ts`
- Modify: `lib/jobs/handlers/image-turn.ts` (prepend base + cap gpt-image + guard)
- Modify: `lib/jobs/handlers/image-turn.test.ts` (test de ensamblado/orden, sin red)

**Interfaces:**
- Consumes (Fase 1): `resolveReferenceBuffers(workspaceId: string, ids: string[]): Promise<ImageReference[]>` (`lib/jobs/handlers/reference-buffers.ts`); `downloadOutputBuffer(path): Promise<{buffer: Buffer; mimeType: string}>` y `OUTPUTS_BUCKET` (`lib/supabase/storage.ts`); `type ImageReference = { buffer: Buffer; mimeType: string }` (`lib/providers/types.ts`); `createAdminClient()` (`lib/supabase/admin.ts`); `StudioAssetTypeSchema` (`lib/schemas/studio.ts`).
- Produces (para Task 3-5 y el worker):
  - `assembleStudioPrompt(rawPrompt: string, opts: { keepIdentical?: boolean; assetType?: string | null }): string`
  - `PRODUCT_IDENTITY_CLAUSE: string`
  - `resolveBaseImage(workspaceId: string, parentGenerationId: string): Promise<ImageReference | null>`
  - `SubmitStudioTurnSchema` acepta `assetType?: 'product' | 'location' | 'character'`; el turno guarda `params.assetType`.
  - `GenerationRow.parent_generation_id: string | null`.

- [ ] **Step 1: Test de `assembleStudioPrompt` (falla primero)**

Create `lib/studio/prompt-assembly.ts` con stubs mínimos para que el test compile, y `lib/studio/prompt-assembly.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assembleStudioPrompt, PRODUCT_IDENTITY_CLAUSE } from './prompt-assembly';

describe('assembleStudioPrompt', () => {
  it('sin guard devuelve el prompt crudo', () => {
    expect(assembleStudioPrompt('haz la caja azul', { keepIdentical: false, assetType: 'product' })).toBe(
      'haz la caja azul',
    );
  });
  it('guard off por ausencia de flag = prompt crudo', () => {
    expect(assembleStudioPrompt('haz la caja azul', { assetType: 'product' })).toBe('haz la caja azul');
  });
  it('guard on en producto anexa la cláusula de identidad de producto', () => {
    const out = assembleStudioPrompt('cámbiale el fondo', { keepIdentical: true, assetType: 'product' });
    expect(out.startsWith('cámbiale el fondo')).toBe(true);
    expect(out).toContain(PRODUCT_IDENTITY_CLAUSE);
  });
  it('guard on sin assetType conocido (location/character en Fase 2) = prompt crudo', () => {
    // Fase 2 solo tiene cláusula de producto; otros tipos se generalizan en Fase 4.
    expect(assembleStudioPrompt('de noche', { keepIdentical: true, assetType: 'location' })).toBe('de noche');
    expect(assembleStudioPrompt('de noche', { keepIdentical: true, assetType: null })).toBe('de noche');
  });
  it('recorta espacios del prompt crudo antes de anexar', () => {
    const out = assembleStudioPrompt('  cambia el fondo  ', { keepIdentical: true, assetType: 'product' });
    expect(out.startsWith('cambia el fondo ' + PRODUCT_IDENTITY_CLAUSE.slice(0, 4))).toBe(false);
    expect(out).toContain('cambia el fondo');
    expect(out).toContain(PRODUCT_IDENTITY_CLAUSE);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm test lib/studio/prompt-assembly.test.ts`
Expected: FAIL (funciones aún sin implementar).

- [ ] **Step 3: Implementar `lib/studio/prompt-assembly.ts`**

La cláusula es la misma que hoy protege identidad de producto en `components/creation/generate.ts` (`refineProductImage`), extraída como constante reutilizable.

```ts
// Ensamblado del prompt final del estudio: el usuario ve/edita su prompt CRUDO
// (queda en generations.prompt para mostrar en el chat), pero cuando enciende el
// toggle "mantener idéntico" el worker envía al proveedor el prompt + la cláusula
// de identidad del activo. Así el guard es OPT-IN (spec) y el chat no muestra
// texto interno de guard. Fase 2 solo cubre producto; locación/personaje se
// generalizan en Fase 4 (más cláusulas en IDENTITY_CLAUSE_BY_TYPE).

// Cláusula de identidad de PRODUCTO (misma que refineProductImage en
// components/creation/generate.ts): preserva forma, color, etiqueta, logo,
// materiales y proporciones, y prohíbe inventar texto de marca.
export const PRODUCT_IDENTITY_CLAUSE =
  'Keep the product identity perfectly consistent — identical shape, colors, label, logo, ' +
  'materials and proportions. Do not alter or invent any label text.';

const IDENTITY_CLAUSE_BY_TYPE: Record<string, string> = {
  product: PRODUCT_IDENTITY_CLAUSE,
};

export function assembleStudioPrompt(
  rawPrompt: string,
  opts: { keepIdentical?: boolean; assetType?: string | null },
): string {
  const raw = rawPrompt.trim();
  if (!opts.keepIdentical) return raw;
  const clause = opts.assetType ? IDENTITY_CLAUSE_BY_TYPE[opts.assetType] : undefined;
  if (!clause) return raw;
  return `${raw} ${clause}`;
}
```

- [ ] **Step 4: Correr el test hasta verde**

Run: `pnpm test lib/studio/prompt-assembly.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Implementar `lib/jobs/handlers/base-image.ts`**

Descarga el output del generation padre como imagen base para editar. Espeja la seguridad de `resolveReferenceBuffers` (filtra por `workspace_id` con admin client) pero desde el bucket `outputs`.

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ImageReference } from '@/lib/providers/types';
import { downloadOutputBuffer } from '@/lib/supabase/storage';

// Resuelve el generation padre (la "imagen de trabajo" de la sesión) a un buffer
// para editar en contexto. Devuelve null (no lanza) si el padre no existe, es de
// otro workspace, o aún no tiene output — en esos casos el turno degrada a
// texto-a-imagen en vez de tirar la generación. Sí lanza si la descarga del
// binario falla (mismo criterio que resolveReferenceBuffers: un objeto de Storage
// que debería existir y no baja es un fallo real → fail + refund aguas arriba).
export async function resolveBaseImage(
  workspaceId: string,
  parentGenerationId: string,
): Promise<ImageReference | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('generations')
    .select('output_url, workspace_id')
    .eq('id', parentGenerationId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.workspace_id !== workspaceId) return null;
  const path = (data.output_url as string | null) ?? null;
  if (!path) return null;
  const { buffer, mimeType } = await downloadOutputBuffer(path);
  return { buffer, mimeType };
}
```

- [ ] **Step 6: `GenerationRow` gana `parent_generation_id` y el worker lo selecciona**

En `lib/jobs/handlers/types.ts`, dentro del type `GenerationRow`, añadir tras `reference_ids: string[];` (línea 43):

```ts
  parent_generation_id: string | null;
```

En `app/api/jobs/process/route.ts`, el SELECT (líneas 71-72) añade `parent_generation_id`:

```ts
    .select(
      'id, user_id, workspace_id, type, provider, model_id, prompt, params, reference_ids, parent_generation_id, status, provider_task_id, provider_payload, poll_attempts, timeout_at, cancel_requested, credits_estimated',
    )
```

- [ ] **Step 7: `runImageTurn` prepende la base, capea gpt-image a 4, y ensambla el guard**

En `lib/jobs/handlers/image-turn.ts`:

Añadir imports al tope:

```ts
import { resolveBaseImage } from '@/lib/jobs/handlers/base-image';
import { assembleStudioPrompt } from '@/lib/studio/prompt-assembly';
```

Dentro del `try`, tras resolver `references` (línea 61), insertar la base y ensamblar el prompt:

```ts
    // Edición en contexto: si el turno tiene parent, su output es la imagen base.
    // Va como PRIMERA imagen (nano la toma como content-part; gpt-image como
    // prompt.images[0]). Si el padre no resuelve, degrada a texto-a-imagen.
    if (gen.parent_generation_id) {
      const base = await resolveBaseImage(gen.workspace_id, gen.parent_generation_id);
      if (base) references.unshift(base);
    }

    // El gateway acepta hasta 4 imágenes de entrada para gpt-image. Con base +
    // refs se puede pasar de 4 → se recorta (el schema ya limita referenceIds a 4,
    // pero la base es adicional). Nano tolera más, no se recorta.
    const providerReferences =
      gen.provider === 'gpt-image' ? references.slice(0, 4) : references;

    // Guard "mantener idéntico" (opt-in): anexa la cláusula de identidad del
    // activo al prompt que ve el proveedor. El prompt CRUDO queda en la fila.
    const finalPrompt = assembleStudioPrompt(gen.prompt ?? '', {
      keepIdentical: params.keepIdentical === true,
      assetType: typeof params.assetType === 'string' ? params.assetType : null,
    });
```

Reemplazar `references` por `providerReferences` y `gen.prompt ?? ''` por `finalPrompt` en AMBAS ramas (gpt-image, líneas ~68-73; nano, líneas ~85-90). Es decir: `prompt: finalPrompt` y `references: providerReferences` en las dos llamadas a `generateGptImage`/`generateNano`.

- [ ] **Step 8: `assetType` viaja del submit a `params`**

En `lib/schemas/studio.ts`, dentro del objeto de `SubmitStudioTurnSchema` (tras `aspectRatio`, línea 35), añadir:

```ts
    assetType: StudioAssetTypeSchema.optional(),
```

En `server-actions/studio.ts`, el bloque `params` del insert (líneas 147-152) gana `assetType`:

```ts
    params: {
      studioTurn: true,
      variant: data.variant,
      aspectRatio: data.aspectRatio,
      keepIdentical: data.keepIdentical,
      assetType: data.assetType ?? null,
    },
```

- [ ] **Step 9: Test del orden base-primero y del guard en `runImageTurn` (rama pura)**

Ampliar `lib/jobs/handlers/image-turn.test.ts` con un test del helper de recorte/orden SIN llamar al proveedor. Como `runImageTurn` hace IO, se testea la lógica extraíble: verificar que `assembleStudioPrompt` compone y que el cap de 4 es correcto vía un test directo del slice. Añadir al final del archivo:

```ts
import { assembleStudioPrompt, PRODUCT_IDENTITY_CLAUSE } from '@/lib/studio/prompt-assembly';

describe('runImageTurn: ensamblado de prompt del turno', () => {
  it('guard on producto = prompt + cláusula (lo que el worker manda al proveedor)', () => {
    const finalPrompt = assembleStudioPrompt('quita el fondo', { keepIdentical: true, assetType: 'product' });
    expect(finalPrompt).toContain('quita el fondo');
    expect(finalPrompt.endsWith(PRODUCT_IDENTITY_CLAUSE)).toBe(true);
  });
  it('cap gpt-image: base + 4 refs se recorta a 4', () => {
    const refs = [{ b: 'base' }, { b: 'r1' }, { b: 'r2' }, { b: 'r3' }, { b: 'r4' }];
    expect(refs.slice(0, 4)).toHaveLength(4);
    expect(refs.slice(0, 4)[0].b).toBe('base'); // la base sobrevive el recorte (va primera)
  });
});
```

- [ ] **Step 10: Verificar tests + typecheck + build**

Run: `pnpm test lib/studio/prompt-assembly.test.ts lib/jobs/handlers/image-turn.test.ts && pnpm typecheck && pnpm build`
Expected: tests PASS; typecheck y build sin errores.

- [ ] **Step 11: Commit**

```bash
git add lib/studio/prompt-assembly.ts lib/studio/prompt-assembly.test.ts lib/jobs/handlers/base-image.ts lib/jobs/handlers/image-turn.ts lib/jobs/handlers/image-turn.test.ts lib/jobs/handlers/types.ts app/api/jobs/process/route.ts lib/schemas/studio.ts server-actions/studio.ts
git commit -m "feat(estudio): el worker edita en contexto (imagen base + guard mantener idéntico)"
```

---

### Task 2: Módulos puros del compositor (catálogo de modelos + URL pública de thumbnail cliente)

Lógica client-safe que el compositor y la galería consumen: el catálogo de modelos del selector (con sus variantes/defaults por proveedor) y un constructor de URL de thumbnail público usable en el cliente (el helper `publicThumbnailUrl` del repo es `server-only`).

**Files:**
- Create: `lib/studio/model-options.ts`
- Create: `lib/studio/model-options.test.ts`
- Create: `lib/supabase/public-url.ts`
- Create: `lib/supabase/public-url.test.ts`

**Interfaces:**
- Consumes: nada (módulos puros). `NEXT_PUBLIC_SUPABASE_URL` (env, disponible en cliente).
- Produces (para Task 3-5):
  - `type StudioModelKey = 'nano-pro' | 'nano-flash' | 'gpt-image-2' | 'gpt-image-1' | 'gpt-image-1-mini'`
  - `STUDIO_MODELS: { key: StudioModelKey; label: string; sub: string }[]`
  - `type StudioVariantControl = { kind: 'resolution'; options: string[] } | { kind: 'quality'; options: string[] } | { kind: 'none' }`
  - `variantControlFor(key: StudioModelKey): StudioVariantControl`
  - `defaultVariantFor(key: StudioModelKey): string`
  - `resolveSelection(key: StudioModelKey, variant: string): { provider: 'nano-banana' | 'gpt-image'; model: string; variant: string }`
  - `maxReferencesFor(provider: 'nano-banana' | 'gpt-image', hasBase: boolean): number`
  - `publicThumbnailUrlClient(path: string): string`

- [ ] **Step 1: Test de `model-options` (falla primero)**

Create `lib/studio/model-options.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  STUDIO_MODELS,
  variantControlFor,
  defaultVariantFor,
  resolveSelection,
  maxReferencesFor,
} from './model-options';

describe('STUDIO_MODELS', () => {
  it('ofrece 5 modelos (2 nano + 3 gpt-image)', () => {
    expect(STUDIO_MODELS.map((m) => m.key)).toEqual([
      'nano-pro',
      'nano-flash',
      'gpt-image-2',
      'gpt-image-1',
      'gpt-image-1-mini',
    ]);
  });
});

describe('variantControlFor', () => {
  it('nano-pro = resolución 1k/2k/4k', () => {
    expect(variantControlFor('nano-pro')).toEqual({ kind: 'resolution', options: ['1k', '2k', '4k'] });
  });
  it('nano-flash = resolución sin 4k', () => {
    expect(variantControlFor('nano-flash')).toEqual({ kind: 'resolution', options: ['1k', '2k'] });
  });
  it('gpt-image-2 = calidad baja/media/alta', () => {
    expect(variantControlFor('gpt-image-2')).toEqual({ kind: 'quality', options: ['low', 'medium', 'high'] });
  });
  it('gpt-image-1 y mini = sin control (variant fija)', () => {
    expect(variantControlFor('gpt-image-1')).toEqual({ kind: 'none' });
    expect(variantControlFor('gpt-image-1-mini')).toEqual({ kind: 'none' });
  });
});

describe('defaultVariantFor', () => {
  it('nano = 2k, gpt-image-2 = medium, resto = default', () => {
    expect(defaultVariantFor('nano-pro')).toBe('2k');
    expect(defaultVariantFor('nano-flash')).toBe('2k');
    expect(defaultVariantFor('gpt-image-2')).toBe('medium');
    expect(defaultVariantFor('gpt-image-1')).toBe('default');
    expect(defaultVariantFor('gpt-image-1-mini')).toBe('default');
  });
});

describe('resolveSelection', () => {
  it('nano-pro → gemini-3-pro-image-preview', () => {
    expect(resolveSelection('nano-pro', '2k')).toEqual({
      provider: 'nano-banana',
      model: 'gemini-3-pro-image-preview',
      variant: '2k',
    });
  });
  it('nano-flash → gemini-3.1-flash-image-preview', () => {
    expect(resolveSelection('nano-flash', '1k')).toEqual({
      provider: 'nano-banana',
      model: 'gemini-3.1-flash-image-preview',
      variant: '1k',
    });
  });
  it('gpt-image-2 → provider gpt-image, model gpt-image-2, variant = calidad', () => {
    expect(resolveSelection('gpt-image-2', 'high')).toEqual({
      provider: 'gpt-image',
      model: 'gpt-image-2',
      variant: 'high',
    });
  });
  it('gpt-image-1-mini → variant default', () => {
    expect(resolveSelection('gpt-image-1-mini', 'default')).toEqual({
      provider: 'gpt-image',
      model: 'gpt-image-1-mini',
      variant: 'default',
    });
  });
});

describe('maxReferencesFor', () => {
  it('gpt-image: 4 sin base, 3 con base (la base cuenta contra el tope de 4)', () => {
    expect(maxReferencesFor('gpt-image', false)).toBe(4);
    expect(maxReferencesFor('gpt-image', true)).toBe(3);
  });
  it('nano: 6 sin base, 5 con base (el schema limita referenceIds a 6)', () => {
    expect(maxReferencesFor('nano-banana', false)).toBe(6);
    expect(maxReferencesFor('nano-banana', true)).toBe(5);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm test lib/studio/model-options.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `lib/studio/model-options.ts`**

Los literales de modelo/variant coinciden EXACTAMENTE con `NANO_MODELS`/`NANO_VARIANTS`/`GPT_MODELS`/`GPT_VARIANTS` del `SubmitStudioTurnSchema` (Fase 1) para que el `superRefine` acepte todo combo que el compositor produzca.

```ts
// Catálogo del selector de modelos del estudio. Puro y client-safe: el compositor
// lo consume para pintar el selector y el control de variante/calidad, y para
// derivar el {provider, model, variant} exacto que espera SubmitStudioTurnSchema
// (Fase 1). Los literales deben calzar con NANO_MODELS/GPT_MODELS de ese schema.

export type StudioModelKey =
  | 'nano-pro'
  | 'nano-flash'
  | 'gpt-image-2'
  | 'gpt-image-1'
  | 'gpt-image-1-mini';

export type StudioVariantControl =
  | { kind: 'resolution'; options: string[] }
  | { kind: 'quality'; options: string[] }
  | { kind: 'none' };

export const STUDIO_MODELS: { key: StudioModelKey; label: string; sub: string }[] = [
  { key: 'nano-pro', label: 'Nano Banana Pro', sub: 'Gemini 3 Pro Image' },
  { key: 'nano-flash', label: 'Nano Flash', sub: 'Gemini 3.1 Flash' },
  { key: 'gpt-image-2', label: 'GPT Image 2', sub: 'OpenAI (calidad configurable)' },
  { key: 'gpt-image-1', label: 'GPT Image 1', sub: 'OpenAI' },
  { key: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', sub: 'OpenAI (rápido)' },
];

export function variantControlFor(key: StudioModelKey): StudioVariantControl {
  if (key === 'nano-pro') return { kind: 'resolution', options: ['1k', '2k', '4k'] };
  if (key === 'nano-flash') return { kind: 'resolution', options: ['1k', '2k'] };
  if (key === 'gpt-image-2') return { kind: 'quality', options: ['low', 'medium', 'high'] };
  return { kind: 'none' };
}

export function defaultVariantFor(key: StudioModelKey): string {
  if (key === 'nano-pro' || key === 'nano-flash') return '2k';
  if (key === 'gpt-image-2') return 'medium';
  return 'default';
}

export function resolveSelection(
  key: StudioModelKey,
  variant: string,
): { provider: 'nano-banana' | 'gpt-image'; model: string; variant: string } {
  if (key === 'nano-pro') {
    return { provider: 'nano-banana', model: 'gemini-3-pro-image-preview', variant };
  }
  if (key === 'nano-flash') {
    return { provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview', variant };
  }
  // gpt-image-2 | gpt-image-1 | gpt-image-1-mini: la key ES el model_id.
  return { provider: 'gpt-image', model: key, variant };
}

export function maxReferencesFor(provider: 'nano-banana' | 'gpt-image', hasBase: boolean): number {
  // gpt-image: el gateway acepta 4 imágenes de entrada; con base ocupa un cupo.
  // nano: SubmitStudioTurnSchema limita referenceIds a 6; con base, 5.
  const cap = provider === 'gpt-image' ? 4 : 6;
  return hasBase ? cap - 1 : cap;
}
```

- [ ] **Step 4: Correr el test hasta verde**

Run: `pnpm test lib/studio/model-options.test.ts`
Expected: PASS.

- [ ] **Step 5: Test de `public-url` (falla primero)**

Create `lib/supabase/public-url.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { publicThumbnailUrlClient } from './public-url';

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
});

describe('publicThumbnailUrlClient', () => {
  it('construye la URL pública del bucket thumbnails', () => {
    expect(publicThumbnailUrlClient('ws/gen/thumb.jpg')).toBe(
      'https://proj.supabase.co/storage/v1/object/public/thumbnails/ws/gen/thumb.jpg',
    );
  });
});
```

- [ ] **Step 6: Correr el test para verlo fallar**

Run: `pnpm test lib/supabase/public-url.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implementar `lib/supabase/public-url.ts`**

Client-safe (SIN `import 'server-only'`). Mismo string que `publicThumbnailUrl` en `lib/supabase/storage.ts:100-103`, pero importable desde el bundle cliente (el módulo de storage es `server-only` porque toca admin client; este solo hace concatenación con la URL pública).

```ts
// Constructor client-safe de la URL pública de un thumbnail. El bucket
// 'thumbnails' es público, así que la URL es concatenación directa con
// NEXT_PUBLIC_SUPABASE_URL. Existe aparte de publicThumbnailUrl (server-only,
// vive en lib/supabase/storage.ts junto al admin client) para poder usarse en
// componentes cliente sin arrastrar 'server-only' al bundle.
const THUMBNAILS_BUCKET = 'thumbnails';

export function publicThumbnailUrlClient(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/${THUMBNAILS_BUCKET}/${path}`;
}
```

- [ ] **Step 8: Verificar tests + typecheck**

Run: `pnpm test lib/studio/model-options.test.ts lib/supabase/public-url.test.ts && pnpm typecheck`
Expected: PASS + typecheck limpio.

- [ ] **Step 9: Commit**

```bash
git add lib/studio/model-options.ts lib/studio/model-options.test.ts lib/supabase/public-url.ts lib/supabase/public-url.test.ts
git commit -m "feat(estudio): catálogo de modelos del compositor y URL pública de thumbnail cliente"
```

---

### Task 3: Ruta, shell del estudio, cambio de sesión y galería de solo-lectura + botón de entrada

Entrega un estudio ALCANZABLE y navegable: la ruta `/app/studio/product/[id]` carga el producto y su sesión activa, monta el shell de 2 columnas con cabecera (cambiar/nueva sesión) y una galería de solo-lectura de las generaciones de la sesión (thumbnails). El compositor y el chat quedan como región vacía con placeholder (Task 4); las acciones de galería (adjuntar/usar como base) llegan en Task 5. El producto gana un botón "Abrir estudio".

**Files:**
- Modify: `server-actions/studio.ts` (añadir `StudioSessionSummary` + `listStudioSessionsAction`)
- Create: `app/app/studio/[assetType]/[assetId]/page.tsx`
- Create: `components/studio/types.ts`
- Create: `components/studio/StudioClient.tsx`
- Create: `components/studio/SessionHeader.tsx`
- Create: `components/studio/GalleryPanel.tsx`
- Modify: `components/products/ProductsSection.tsx` (botón "Abrir estudio" en `ProductCard`)

**Interfaces:**
- Consumes (Fase 1 + Task 1/2): `listStudioSessionGenerationsAction(sessionId): Promise<Result<StudioGeneration[]>>`, `type StudioGeneration` (`server-actions/studio.ts`); `requireWorkspace()` (`@/lib/auth/dal`); `createClient` (`@/lib/supabase/server`); `signedReferenceUrl` (`@/lib/supabase/storage`); `PricingRow` + `loadPricing`; `publicThumbnailUrlClient` (Task 2).
- Produces (para Task 4-5):
  - `type StudioSessionSummary = { id: string; created_at: string; default_provider: string; default_model_id: string }`
  - `listStudioSessionsAction(assetType: string, assetId: string): Promise<Result<StudioSessionSummary[]>>`
  - `components/studio/types.ts`: `StudioTurn`, `StudioRefOption`, `StudioProductImages`, `StudioClientProps`
  - `StudioClient` que posee el estado `items: StudioTurn[]` + `workingId: string | null` + `activeSessionId: string | null`, y expone puntos de extensión para Composer (Task 4) y acciones de galería (Task 5).

- [ ] **Step 1: `listStudioSessionsAction` + `StudioSessionSummary`**

En `server-actions/studio.ts`, tras el type `StudioGeneration` (línea 37) añadir:

```ts
export type StudioSessionSummary = {
  id: string;
  created_at: string;
  default_provider: string;
  default_model_id: string;
};
```

Y al final del archivo, una acción que lista las sesiones NO archivadas de un activo (para el switcher de la cabecera). Reusa `ASSET_TABLE` para validar ownership del activo:

```ts
export async function listStudioSessionsAction(
  assetType: string,
  assetId: string,
): Promise<Result<StudioSessionSummary[]>> {
  const parsedType = StudioAssetTypeSchema.safeParse(assetType);
  if (!parsedType.success || !z.string().uuid().safeParse(assetId).success) {
    return { ok: false, error: 'validation_error', message: 'Parámetros inválidos' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership del activo (no basta que la sesión sea del workspace: el activo
  // también debe serlo, igual que createStudioSessionAction).
  const table = ASSET_TABLE[parsedType.data];
  const { data: asset } = await supabase
    .from(table)
    .select('id')
    .eq('id', assetId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!asset) {
    return { ok: false, error: 'not_found', message: `${parsedType.data} no pertenece al workspace` };
  }

  const { data: rows, error } = await supabase
    .from('studio_sessions')
    .select('id, created_at, default_provider, default_model_id')
    .eq('workspace_id', workspace.id)
    .eq('asset_type', parsedType.data)
    .eq('asset_id', assetId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    return { ok: false, error: 'internal_error', message: error.message };
  }

  const sessions: StudioSessionSummary[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    created_at: r.created_at as string,
    default_provider: r.default_provider as string,
    default_model_id: r.default_model_id as string,
  }));
  return { ok: true, data: sessions };
}
```

Necesita importar `StudioAssetTypeSchema` — ampliar el import de `@/lib/schemas/studio` (líneas 13-17) para incluirlo:

```ts
import {
  CreateStudioSessionSchema,
  SubmitStudioTurnSchema,
  StudioAssetTypeSchema,
  type StudioAssetType,
} from '@/lib/schemas/studio';
```

- [ ] **Step 2: Verificar typecheck de la acción**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 3: Tipos compartidos del cliente**

Create `components/studio/types.ts`:

```ts
import type { PricingRow } from '@/lib/credits/types';

// Un turno del chat = una fila generations de la sesión. La galería muestra los
// que tienen thumbnail; el chat los muestra todos. thumbPath es el path CRUDO en
// el bucket público 'thumbnails' (el cliente arma la URL con
// publicThumbnailUrlClient) — nunca una URL de proveedor.
export type StudioTurn = {
  id: string;
  prompt: string | null;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  provider: string;
  modelId: string;
  thumbPath: string | null;
  createdAt: string;
  errorMessage: string | null;
};

// Una imagen ya adjunta al producto, ofrecible como referencia en el compositor.
export type StudioRefOption = {
  id: string; // media_reference id
  previewUrl: string | null;
  filename: string;
};

// Arrays de imágenes del producto por rol (para adjuntar sin pisar lo existente).
export type StudioProductImages = {
  productImageIds: string[];
  packagingImageIds: string[];
};

export type StudioSessionOption = {
  id: string;
  createdAt: string;
};

export type StudioClientProps = {
  workspaceId: string;
  userId: string;
  assetType: 'product';
  assetId: string;
  assetName: string;
  initialBalance: number;
  pricing: PricingRow[];
  sessions: StudioSessionOption[];
  activeSessionId: string | null;
  initialItems: StudioTurn[];
  availableReferences: StudioRefOption[];
  productImages: StudioProductImages;
};
```

- [ ] **Step 4: Página RSC**

Create `app/app/studio/[assetType]/[assetId]/page.tsx`. Resuelve producto + sesión activa (`?session` o redirige a la más reciente) + genera las props del cliente. No firma outputs: la galería usa thumbnails públicos.

```tsx
import { notFound, redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { loadPricing } from '@/lib/credits/pricing';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import {
  listStudioSessionsAction,
  listStudioSessionGenerationsAction,
} from '@/server-actions/studio';
import { StudioClient } from '@/components/studio/StudioClient';
import type { StudioTurn, StudioRefOption, StudioSessionOption } from '@/components/studio/types';

export const dynamic = 'force-dynamic';

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetType: string; assetId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { assetType, assetId } = await params;
  const { session: sessionParam } = await searchParams;

  // Fase 2 solo cablea producto (locación/personaje = Fase 4).
  if (assetType !== 'product') notFound();

  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: product } = await supabase
    .from('products')
    .select('id, name, product_image_ids, packaging_image_ids')
    .eq('id', assetId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();
  if (!product) notFound();

  const sessionsRes = await listStudioSessionsAction('product', assetId);
  const sessions: StudioSessionOption[] = sessionsRes.ok
    ? sessionsRes.data.map((s) => ({ id: s.id, createdAt: s.created_at }))
    : [];

  // Sesión activa: ?session válida y propia, si no la más reciente (redirige para
  // fijarla en la URL), si no hay ninguna → estado limpio (el primer turno crea).
  let activeSessionId: string | null = null;
  if (sessionParam && sessions.some((s) => s.id === sessionParam)) {
    activeSessionId = sessionParam;
  } else if (!sessionParam && sessions.length > 0) {
    redirect(`/app/studio/product/${assetId}?session=${sessions[0].id}`);
  }

  let initialItems: StudioTurn[] = [];
  if (activeSessionId) {
    const gensRes = await listStudioSessionGenerationsAction(activeSessionId);
    if (gensRes.ok) {
      initialItems = gensRes.data.map((g) => ({
        id: g.id,
        prompt: g.prompt,
        status: g.status,
        provider: g.provider,
        modelId: g.model_id,
        thumbPath: g.thumbnail_url,
        createdAt: g.created_at,
        errorMessage: null,
      }));
    }
  }

  // Referencias ofrecibles en el compositor = imágenes que el producto ya tiene.
  const imageIds = [
    ...((product.product_image_ids as string[] | null) ?? []),
    ...((product.packaging_image_ids as string[] | null) ?? []),
  ];
  let availableReferences: StudioRefOption[] = [];
  if (imageIds.length > 0) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, name')
      .in('id', imageIds)
      .eq('workspace_id', workspace.id)
      .eq('type', 'image');
    availableReferences = await Promise.all(
      (refs ?? []).map(async (r) => ({
        id: r.id as string,
        previewUrl: r.storage_url ? await signedReferenceUrl(r.storage_url as string) : null,
        filename: (r.name as string | null) ?? 'imagen',
      })),
    );
  }

  const balanceRow = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .maybeSingle();
  const initialBalance = (balanceRow.data?.balance as number | null) ?? 0;

  const pricing = await loadPricing();

  return (
    <StudioClient
      workspaceId={workspace.id}
      userId={user.id}
      assetType="product"
      assetId={assetId}
      assetName={(product.name as string | null) ?? 'Producto'}
      initialBalance={initialBalance}
      pricing={pricing}
      sessions={sessions}
      activeSessionId={activeSessionId}
      initialItems={initialItems}
      availableReferences={availableReferences}
      productImages={{
        productImageIds: (product.product_image_ids as string[] | null) ?? [],
        packagingImageIds: (product.packaging_image_ids as string[] | null) ?? [],
      }}
    />
  );
}
```

- [ ] **Step 5: Cabecera de sesión**

Create `components/studio/SessionHeader.tsx`. Nombre del producto, volver, switcher de sesiones y "Nueva sesión". Navega por query param (fuente de verdad de la sesión activa).

```tsx
'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { createStudioSessionAction } from '@/server-actions/studio';
import type { StudioSessionOption } from './types';

function sessionLabel(createdAt: string): string {
  const d = new Date(createdAt);
  return `Sesión · ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(
    'es-MX',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

export function SessionHeader(props: {
  assetId: string;
  assetName: string;
  sessions: StudioSessionOption[];
  activeSessionId: string | null;
  defaultProvider: 'nano-banana' | 'gpt-image';
  defaultModelId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function goToSession(id: string) {
    router.push(`/app/studio/product/${props.assetId}?session=${id}`);
  }

  function newSession() {
    startTransition(async () => {
      const res = await createStudioSessionAction({
        assetType: 'product',
        assetId: props.assetId,
        provider: props.defaultProvider,
        modelId: props.defaultModelId,
      });
      if (!res.ok) {
        toast.error('No se pudo crear la sesión');
        return;
      }
      goToSession(res.data.id);
    });
  }

  return (
    <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
      <Link
        href="/app/brand"
        className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium text-zinc-100">Estudio · {props.assetName}</h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {props.sessions.length > 0 && props.activeSessionId ? (
          <Select value={props.activeSessionId} onValueChange={goToSession}>
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.sessions.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {sessionLabel(s.createdAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={newSession}
          disabled={pending}
        >
          <Plus className="h-4 w-4" />
          Nueva sesión
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Galería de solo-lectura**

Create `components/studio/GalleryPanel.tsx`. Grilla de thumbnails de la sesión (reciente primero). En este task solo muestra; las acciones (adjuntar / usar como base) las inyecta Task 5 vía render-prop `renderActions`.

```tsx
'use client';

import { Loader2, ImageOff } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import type { StudioTurn } from './types';

export function GalleryPanel(props: {
  items: StudioTurn[];
  renderActions?: (item: StudioTurn) => React.ReactNode;
}) {
  const done = props.items.filter((i) => i.thumbPath && i.status === 'done');

  return (
    <aside className="flex h-full flex-col border-l border-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-100">Galería de la sesión</h2>
        <p className="text-xs text-zinc-500">{done.length} imagen(es)</p>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {done.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600">
            <ImageOff className="h-8 w-8" />
            <p className="text-xs">Aún no hay imágenes en esta sesión.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[...done].reverse().map((item) => (
              <div
                key={item.id}
                className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
              >
                {item.thumbPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={publicThumbnailUrlClient(item.thumbPath)}
                    alt={item.prompt ?? 'Imagen generada'}
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <div className="flex aspect-square items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                  </div>
                )}
                {props.renderActions ? (
                  <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-1 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    {props.renderActions(item)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: Shell del cliente**

Create `components/studio/StudioClient.tsx`. Posee el estado (`items`, `workingId`, `activeSessionId`) y lo reparte. En este task el panel izquierdo es un placeholder; Task 4 mete el Composer + ChatPanel. Diseñado para que Task 4/5 solo agreguen componentes hijos leyendo/mutando este estado.

```tsx
'use client';

import { useState } from 'react';
import { SessionHeader } from './SessionHeader';
import { GalleryPanel } from './GalleryPanel';
import type { StudioClientProps, StudioTurn } from './types';

export function StudioClient(props: StudioClientProps) {
  const [items, setItems] = useState<StudioTurn[]>(props.initialItems);
  const [workingId, setWorkingId] = useState<string | null>(() => {
    const lastDone = [...props.initialItems].reverse().find((i) => i.status === 'done');
    return lastDone?.id ?? null;
  });
  // La sesión activa la fija la URL (?session); el cliente la conserva para saber
  // si crear una sesión nueva en el primer turno (Task 4).
  const [activeSessionId, setActiveSessionId] = useState<string | null>(props.activeSessionId);

  // Estos setters los consumen Composer (Task 4: appendItem, updateItem,
  // setWorkingId, setActiveSessionId) y las acciones de galería (Task 5).
  void setItems;
  void setWorkingId;
  void setActiveSessionId;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <SessionHeader
        assetId={props.assetId}
        assetName={props.assetName}
        sessions={props.sessions}
        activeSessionId={activeSessionId}
        defaultProvider="nano-banana"
        defaultModelId="gemini-3-pro-image-preview"
      />
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        <section className="flex h-full flex-col overflow-hidden">
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="max-w-sm text-sm text-zinc-500">
              {workingId
                ? 'Continúa iterando sobre la imagen de trabajo desde el compositor.'
                : 'Escribe un prompt para empezar a crear imágenes de este producto.'}
            </p>
          </div>
        </section>
        <GalleryPanel items={items} />
      </div>
    </div>
  );
}
```

Nota: `void setItems/setWorkingId/setActiveSessionId` evita el error de "variable sin usar" en este task; Task 4/5 los usan de verdad y quitan esos `void`.

- [ ] **Step 8: Botón "Abrir estudio" en el producto**

En `components/products/ProductsSection.tsx`, dentro de `ProductCard` (junto a Editar/Eliminar, ~líneas 140-155), añadir un enlace al estudio usando `product.id`. Importar `Link` de `next/link` y un icono (`Sparkles` de `lucide-react`) al tope del archivo si no están. El botón:

```tsx
<Link
  href={`/app/studio/product/${product.id}`}
  className="inline-flex h-8 items-center gap-1 rounded-md border border-zinc-700 px-2 text-xs text-zinc-200 hover:bg-zinc-800"
>
  <Sparkles className="h-3.5 w-3.5" />
  Abrir estudio
</Link>
```

Colocarlo antes del botón "Editar". Mantener el estilo/tamaño de los botones existentes de la card (revisar los className reales de Editar/Eliminar y calzar; el snippet de arriba es la intención, no necesariamente los className exactos del archivo).

- [ ] **Step 9: Verificar typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: sin errores. Navegar mentalmente: `/app/studio/product/<id>` renderiza cabecera + galería; producto muestra "Abrir estudio".

- [ ] **Step 10: Commit**

```bash
git add server-actions/studio.ts app/app/studio components/studio/types.ts components/studio/StudioClient.tsx components/studio/SessionHeader.tsx components/studio/GalleryPanel.tsx components/products/ProductsSection.tsx
git commit -m "feat(estudio): ruta del estudio de producto, cambio de sesión, galería y botón de entrada"
```

---

### Task 4: Compositor + chat + envío de turno + resolución por Realtime

El corazón del estudio: el compositor (selector de modelo, variante/calidad, aspecto, referencias, toggle "mantener idéntico", prompt, costo, enviar), el hilo de chat, y la resolución en vivo de cada turno vía el patrón `use-generation-status`. El primer turno crea la sesión si no hay una activa.

**Files:**
- Create: `components/studio/Composer.tsx`
- Create: `components/studio/ChatPanel.tsx`
- Create: `components/studio/GenerationStatusWatcher.tsx`
- Modify: `components/studio/StudioClient.tsx` (cablear estado real + Composer + ChatPanel + watchers)

**Interfaces:**
- Consumes: `STUDIO_MODELS`, `variantControlFor`, `defaultVariantFor`, `resolveSelection`, `maxReferencesFor` (Task 2); `publicThumbnailUrlClient` (Task 2); `estimateCredits` (`@/lib/credits/estimator`); `useLiveBalance` (`@/components/layout/use-live-balance`); `useGenerationStatus` (`@/components/generation/use-generation-status`); `uploadReferenceFile` (`@/lib/media-references/upload-client`); `createStudioSessionAction`, `submitStudioTurnAction` (`@/server-actions/studio`); `StudioClientProps`, `StudioTurn`, `StudioRefOption` (Task 3 types); shadcn `Select`, `Button`, `Textarea`, `Switch`.
- Produces (para Task 5): `StudioClient` con estado vivo — `items`/`setItems`, `workingId`/`setWorkingId` — y el chat mostrando turnos pendientes/resueltos/fallidos.

- [ ] **Step 1: Watcher de estado por generación**

Create `components/studio/GenerationStatusWatcher.tsx`. No pinta nada: usa `useGenerationStatus` y avisa al padre cuando el turno llega a estado terminal (done/failed/canceled). El chat/galería pintan desde el estado `items`.

```tsx
'use client';

import { useEffect } from 'react';
import { useGenerationStatus } from '@/components/generation/use-generation-status';

export function GenerationStatusWatcher(props: {
  generationId: string;
  onResolved: (
    id: string,
    patch: { status: 'done' | 'failed' | 'canceled'; thumbPath: string | null; errorMessage: string | null },
  ) => void;
}) {
  const live = useGenerationStatus(props.generationId);
  const status = live?.status ?? null;

  useEffect(() => {
    if (status === 'done' || status === 'failed' || status === 'canceled') {
      props.onResolved(props.generationId, {
        status,
        thumbPath: live?.thumbnailUrl ?? null,
        errorMessage: live?.errorMessage ?? null,
      });
    }
    // Solo re-dispara al cambiar el estado terminal o el id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, props.generationId]);

  return null;
}
```

- [ ] **Step 2: Panel de chat**

Create `components/studio/ChatPanel.tsx`. Lista los turnos: burbuja del prompt del usuario + imagen resuelta / tarjeta "generando…" / error. Marca la imagen de trabajo.

```tsx
'use client';

import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { publicThumbnailUrlClient } from '@/lib/supabase/public-url';
import { Button } from '@/components/ui/button';
import type { StudioTurn } from './types';

export function ChatPanel(props: {
  items: StudioTurn[];
  workingId: string | null;
  onUseAsBase: (id: string) => void;
}) {
  return (
    <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
      {props.items.length === 0 ? (
        <p className="mx-auto max-w-sm pt-12 text-center text-sm text-zinc-500">
          Escribe un prompt abajo para crear la primera imagen del producto.
        </p>
      ) : null}
      {props.items.map((item) => (
        <div key={item.id} className="space-y-2">
          {item.prompt ? (
            <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-zinc-800 px-3 py-2 text-sm text-zinc-100">
              {item.prompt}
            </div>
          ) : null}
          <div className="max-w-[80%]">
            {item.status === 'done' && item.thumbPath ? (
              <div
                className={`overflow-hidden rounded-2xl rounded-bl-sm border ${
                  item.id === props.workingId ? 'border-[#009fff]' : 'border-zinc-800'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicThumbnailUrlClient(item.thumbPath)}
                  alt={item.prompt ?? 'Imagen generada'}
                  className="w-full object-cover"
                />
                <div className="flex items-center gap-2 bg-zinc-900 px-2 py-1.5">
                  {item.id === props.workingId ? (
                    <span className="flex items-center gap-1 text-xs text-[#009fff]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Imagen de trabajo
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => props.onUseAsBase(item.id)}
                    >
                      Usar como base
                    </Button>
                  )}
                </div>
              </div>
            ) : item.status === 'failed' || item.status === 'canceled' ? (
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{item.errorMessage ?? 'La generación falló. Se reembolsaron los créditos.'}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generando…
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Compositor**

Create `components/studio/Composer.tsx`. Todo el control del turno. Deriva `{provider, model, variant}` con `resolveSelection`, calcula costo con `estimateCredits`, sube/elige referencias (cap por proveedor y por base), y llama a `onSubmit`.

```tsx
'use client';

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { PricingRow } from '@/lib/credits/types';
import { estimateCredits } from '@/lib/credits/estimator';
import { uploadReferenceFile } from '@/lib/media-references/upload-client';
import {
  STUDIO_MODELS,
  variantControlFor,
  defaultVariantFor,
  resolveSelection,
  maxReferencesFor,
  type StudioModelKey,
} from '@/lib/studio/model-options';
import type { StudioRefOption } from './types';

const ASPECTS = ['1:1', '4:5', '9:16', '16:9'];
const VARIANT_LABEL: Record<string, string> = {
  '1k': '1K',
  '2k': '2K',
  '4k': '4K',
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export type ComposerSubmit = {
  provider: 'nano-banana' | 'gpt-image';
  model: string;
  variant: string;
  prompt: string;
  aspectRatio: string;
  keepIdentical: boolean;
  referenceIds: string[];
};

export function Composer(props: {
  pricing: PricingRow[];
  balance: number;
  availableReferences: StudioRefOption[];
  hasWorkingImage: boolean;
  disabled: boolean;
  onSubmit: (input: ComposerSubmit) => void;
}) {
  const [modelKey, setModelKey] = useState<StudioModelKey>('nano-pro');
  const [variant, setVariant] = useState<string>(defaultVariantFor('nano-pro'));
  const [aspect, setAspect] = useState('1:1');
  const [keepIdentical, setKeepIdentical] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [refs, setRefs] = useState<StudioRefOption[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const variantControl = variantControlFor(modelKey);
  const selection = resolveSelection(modelKey, variant);
  const maxRefs = maxReferencesFor(selection.provider, props.hasWorkingImage);

  const cost = useMemo(() => {
    try {
      return estimateCredits(props.pricing, {
        provider: selection.provider,
        model: selection.model,
        variant: selection.variant,
      }).total;
    } catch {
      return null;
    }
  }, [props.pricing, selection.provider, selection.model, selection.variant]);

  function changeModel(key: StudioModelKey) {
    setModelKey(key);
    setVariant(defaultVariantFor(key));
    // Recorta referencias si el nuevo proveedor admite menos.
    const nextMax = maxReferencesFor(resolveSelection(key, defaultVariantFor(key)).provider, props.hasWorkingImage);
    setRefs((r) => r.slice(0, nextMax));
  }

  function toggleRef(opt: StudioRefOption) {
    setRefs((cur) => {
      if (cur.some((r) => r.id === opt.id)) return cur.filter((r) => r.id !== opt.id);
      if (cur.length >= maxRefs) {
        toast.error(`Este modelo admite hasta ${maxRefs} referencia(s)${props.hasWorkingImage ? ' (la imagen de trabajo ocupa un cupo)' : ''}`);
        return cur;
      }
      return [...cur, opt];
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (refs.length >= maxRefs) {
      toast.error(`Este modelo admite hasta ${maxRefs} referencia(s)`);
      return;
    }
    setUploading(true);
    const res = await uploadReferenceFile(file);
    setUploading(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    setRefs((cur) => [...cur, { id: res.ref.id, previewUrl: res.ref.previewUrl, filename: res.ref.filename }]);
  }

  function submit() {
    const trimmed = prompt.trim();
    if (!trimmed) {
      toast.error('Escribe un prompt');
      return;
    }
    if (cost !== null && cost > props.balance) {
      toast.error('Créditos insuficientes');
      return;
    }
    props.onSubmit({
      provider: selection.provider,
      model: selection.model,
      variant: selection.variant,
      prompt: trimmed,
      aspectRatio: aspect,
      keepIdentical,
      referenceIds: refs.map((r) => r.id),
    });
    setPrompt('');
  }

  return (
    <div className="space-y-3 border-t border-zinc-800 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={modelKey} onValueChange={(v) => changeModel(v as StudioModelKey)}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STUDIO_MODELS.map((m) => (
              <SelectItem key={m.key} value={m.key} className="text-xs">
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {variantControl.kind !== 'none' ? (
          <Select value={variant} onValueChange={setVariant}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {variantControl.options.map((o) => (
                <SelectItem key={o} value={o} className="text-xs">
                  {variantControl.kind === 'quality' ? `Calidad: ${VARIANT_LABEL[o] ?? o}` : VARIANT_LABEL[o] ?? o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select value={aspect} onValueChange={setAspect}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECTS.map((a) => (
              <SelectItem key={a} value={a} className="text-xs">
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={keepIdentical} onCheckedChange={setKeepIdentical} />
          Mantener idéntico
        </label>
      </div>

      {props.availableReferences.length > 0 || refs.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Referencias:</span>
          {props.availableReferences.map((opt) => {
            const active = refs.some((r) => r.id === opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleRef(opt)}
                className={`h-10 w-10 overflow-hidden rounded border ${
                  active ? 'border-[#009fff] ring-1 ring-[#009fff]' : 'border-zinc-700'
                }`}
                title={opt.filename}
              >
                {opt.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={opt.previewUrl} alt={opt.filename} className="h-full w-full object-cover" />
                ) : null}
              </button>
            );
          })}
          {/* Referencias subidas que no venían del producto */}
          {refs
            .filter((r) => !props.availableReferences.some((a) => a.id === r.id))
            .map((r) => (
              <span
                key={r.id}
                className="flex h-10 items-center gap-1 rounded border border-[#009fff] bg-zinc-800 px-2 text-xs text-zinc-200"
              >
                {r.filename.slice(0, 12)}
                <button type="button" onClick={() => setRefs((cur) => cur.filter((x) => x.id !== r.id))}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || refs.length >= maxRefs}
            className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-zinc-700 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFile}
          />
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || refs.length >= maxRefs}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            Adjuntar referencia
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={onFile}
          />
        </div>
      )}

      <div className="flex items-end gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          placeholder={props.hasWorkingImage ? 'Describe el cambio sobre la imagen de trabajo…' : 'Describe la imagen…'}
          rows={2}
          className="resize-none text-sm"
        />
        <Button type="button" onClick={submit} disabled={props.disabled} className="h-10 gap-1">
          {props.disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {cost !== null ? `${cost}` : '—'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Cablear el shell con estado vivo**

Reescribir `components/studio/StudioClient.tsx` para integrar Composer + ChatPanel + watchers y el envío real (crea sesión en el primer turno, inserta el turno optimista, resuelve por Realtime). Reemplazar el contenido completo por:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import { createStudioSessionAction, submitStudioTurnAction } from '@/server-actions/studio';
import { SessionHeader } from './SessionHeader';
import { GalleryPanel } from './GalleryPanel';
import { ChatPanel } from './ChatPanel';
import { Composer, type ComposerSubmit } from './Composer';
import { GenerationStatusWatcher } from './GenerationStatusWatcher';
import type { StudioClientProps, StudioTurn } from './types';

export function StudioClient(props: StudioClientProps) {
  const router = useRouter();
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [items, setItems] = useState<StudioTurn[]>(props.initialItems);
  const [workingId, setWorkingId] = useState<string | null>(() => {
    const lastDone = [...props.initialItems].reverse().find((i) => i.status === 'done');
    return lastDone?.id ?? null;
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(props.activeSessionId);
  const [submitting, startSubmit] = useTransition();

  function onResolved(
    id: string,
    patch: { status: 'done' | 'failed' | 'canceled'; thumbPath: string | null; errorMessage: string | null },
  ) {
    setItems((cur) =>
      cur.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    );
    // Al completar, ese turno pasa a ser la imagen de trabajo.
    if (patch.status === 'done') setWorkingId(id);
    if (patch.status === 'failed') toast.error('La generación falló. Se reembolsaron los créditos.');
  }

  function handleSubmit(input: ComposerSubmit) {
    startSubmit(async () => {
      // Sesión: usa la activa; si no hay, crea una y fija la URL.
      let sessionId = activeSessionId;
      if (!sessionId) {
        const created = await createStudioSessionAction({
          assetType: 'product',
          assetId: props.assetId,
          provider: input.provider,
          modelId: input.model,
        });
        if (!created.ok) {
          toast.error('No se pudo crear la sesión');
          return;
        }
        sessionId = created.data.id;
        setActiveSessionId(sessionId);
        router.replace(`/app/studio/product/${props.assetId}?session=${sessionId}`);
      }

      const res = await submitStudioTurnAction({
        sessionId,
        assetType: 'product',
        provider: input.provider,
        model: input.model,
        variant: input.variant,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        keepIdentical: input.keepIdentical,
        referenceIds: input.referenceIds,
        parentGenerationId: workingId,
      });
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes'
            : res.message ?? 'No se pudo enviar el turno',
        );
        return;
      }

      // Turno optimista: aparece como "generando…" y se resuelve por Realtime.
      const optimistic: StudioTurn = {
        id: res.data.generationId,
        prompt: input.prompt,
        status: 'queued',
        provider: input.provider,
        modelId: input.model,
        thumbPath: null,
        createdAt: new Date().toISOString(),
        errorMessage: null,
      };
      setItems((cur) => [...cur, optimistic]);
    });
  }

  const pending = items.filter((i) => i.status === 'queued' || i.status === 'processing');

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <SessionHeader
        assetId={props.assetId}
        assetName={props.assetName}
        sessions={props.sessions}
        activeSessionId={activeSessionId}
        defaultProvider="nano-banana"
        defaultModelId="gemini-3-pro-image-preview"
      />
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_360px]">
        <section className="flex h-full flex-col overflow-hidden">
          <ChatPanel items={items} workingId={workingId} onUseAsBase={setWorkingId} />
          <Composer
            pricing={props.pricing}
            balance={balance}
            availableReferences={props.availableReferences}
            hasWorkingImage={workingId !== null}
            disabled={submitting}
            onSubmit={handleSubmit}
          />
        </section>
        <GalleryPanel items={items} />
      </div>
      {pending.map((it) => (
        <GenerationStatusWatcher key={it.id} generationId={it.id} onResolved={onResolved} />
      ))}
    </div>
  );
}
```

Nota: `new Date().toISOString()` para el `createdAt` optimista es válido en un handler de cliente (no es una `import`ación restringida — la regla de no-`Date.now()` aplica a los scripts de Workflow, no a componentes React).

- [ ] **Step 5: Verificar typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: sin errores. `submitStudioTurnAction` recibe exactamente los campos de `SubmitStudioTurnSchema` (incluido `assetType`); `resolveSelection` produce combos que el `superRefine` acepta.

- [ ] **Step 6: Commit**

```bash
git add components/studio/Composer.tsx components/studio/ChatPanel.tsx components/studio/GenerationStatusWatcher.tsx components/studio/StudioClient.tsx
git commit -m "feat(estudio): compositor, chat y resolución de turnos por Realtime"
```

---

### Task 5: Acciones de la galería — adjuntar al producto por rol, usar como base, descargar

Cierra el ciclo end-to-end: desde la galería, el usuario adjunta una imagen al producto (rol Imagen de producto / Empaque), la marca como imagen de trabajo, o la descarga en tamaño completo. Adjuntar reusa `addGenerationAsReferenceAction` + `setProductImagesAction`.

**Files:**
- Create: `components/studio/AttachDialog.tsx`
- Modify: `components/studio/GalleryPanel.tsx` (usar `renderActions`)
- Modify: `components/studio/StudioClient.tsx` (estado `productImages` + handlers de galería + `renderActions`)

**Interfaces:**
- Consumes: `addGenerationAsReferenceAction` (`@/server-actions/media-references`) → `Result<{ id; storagePath; previewUrl; filename }>`; `setProductImagesAction(id, input)` (`@/server-actions/products`) → `Result<{ updated: true }>`; shadcn `Dialog`, `Button`; `StudioTurn`, `StudioProductImages` (Task 3 types).
- Produces: estudio de producto completo (generar → iterar → adjuntar por rol).

- [ ] **Step 1: Diálogo de adjuntar por rol**

Create `components/studio/AttachDialog.tsx`. Elige el rol y persiste: promueve la generación a `media_reference`, la agrega al array del rol (sin pisar lo existente) y guarda con `setProductImagesAction`.

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Package, Box } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { setProductImagesAction } from '@/server-actions/products';
import type { StudioProductImages } from './types';

type Role = 'product' | 'packaging';

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  productId: string;
  productImages: StudioProductImages;
  onAttached: (next: StudioProductImages) => void;
}) {
  const [saving, setSaving] = useState<Role | null>(null);

  async function attach(role: Role) {
    if (!props.generationId) return;
    setSaving(role);
    // 1) Promueve la generación a media_reference reutilizable.
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(null);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    // 2) Agrega el ref al array del rol, sin duplicar ni pisar lo existente.
    const next: StudioProductImages =
      role === 'product'
        ? {
            productImageIds: [...new Set([...props.productImages.productImageIds, ref.data.id])],
            packagingImageIds: props.productImages.packagingImageIds,
          }
        : {
            productImageIds: props.productImages.productImageIds,
            packagingImageIds: [...new Set([...props.productImages.packagingImageIds, ref.data.id])],
          };
    // 3) Persiste (setProductImagesAction reemplaza ambos arrays).
    const res = await setProductImagesAction(props.productId, {
      productImageIds: next.productImageIds,
      packagingImageIds: next.packagingImageIds,
    });
    setSaving(null);
    if (!res.ok) {
      toast.error('No se pudo guardar en el producto');
      return;
    }
    props.onAttached(next);
    props.onOpenChange(false);
    toast.success(role === 'product' ? 'Añadida a Imágenes de producto' : 'Añadida a Empaque');
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjuntar al producto</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-400">Elige el rol de esta imagen.</p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            className="h-24 flex-col gap-2"
            disabled={saving !== null}
            onClick={() => attach('product')}
          >
            <Box className="h-6 w-6" />
            Imagen de producto
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-24 flex-col gap-2"
            disabled={saving !== null}
            onClick={() => attach('packaging')}
          >
            <Package className="h-6 w-6" />
            Empaque
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Acciones en las tarjetas de la galería**

Modificar `components/studio/GalleryPanel.tsx` para que `StudioClient` inyecte acciones vía `renderActions` (ya soportado desde Task 3). No cambia el componente en sí — Task 3 ya dejó el punto de extensión. (Si Task 3 lo omitió, añadir el prop `renderActions?: (item: StudioTurn) => React.ReactNode` y el bloque de overlay como en Task 3, Step 6.)

Verificación: `GalleryPanel` acepta `renderActions` y lo pinta en overlay al hacer hover. Sin cambios de código si Task 3 quedó como se especificó.

- [ ] **Step 3: Cablear handlers de galería en el shell**

En `components/studio/StudioClient.tsx`:

Añadir imports:

```tsx
import { AttachDialog } from './AttachDialog';
import { Button } from '@/components/ui/button';
import type { StudioProductImages } from './types';
```

Añadir estado tras `activeSessionId`:

```tsx
  const [productImages, setProductImages] = useState<StudioProductImages>(props.productImages);
  const [attachId, setAttachId] = useState<string | null>(null);
```

Pasar `renderActions` a la `<GalleryPanel>`:

```tsx
        <GalleryPanel
          items={items}
          renderActions={(item) => (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 text-xs"
                onClick={() => setAttachId(item.id)}
              >
                Adjuntar
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-zinc-200"
                onClick={() => setWorkingId(item.id)}
              >
                Usar como base
              </Button>
            </>
          )}
        />
```

Y montar el diálogo antes del cierre del `<div>` raíz:

```tsx
      <AttachDialog
        open={attachId !== null}
        onOpenChange={(o) => !o && setAttachId(null)}
        generationId={attachId}
        productId={props.assetId}
        productImages={productImages}
        onAttached={setProductImages}
      />
```

- [ ] **Step 4: Verificar typecheck + build + lint + toda la suite**

Run: `pnpm typecheck && pnpm build && pnpm lint && pnpm test`
Expected: sin errores; la suite completa verde (incluye los tests nuevos de Task 1-2).

- [ ] **Step 5: Commit**

```bash
git add components/studio/AttachDialog.tsx components/studio/GalleryPanel.tsx components/studio/StudioClient.tsx
git commit -m "feat(estudio): adjuntar al producto por rol, usar como base y galería con acciones"
```

---

## Notas de ejecución (SDD)

- **Modelos sugeridos:** Task 1 sonnet (integración worker + data path); Task 2 haiku (módulos puros + tests, transcripción del código provisto); Tasks 3-5 sonnet (integración UI en varios archivos). Reviews por task en sonnet; review final de rama en opus.
- **Sin migración:** ninguna task aplica ni modifica migraciones (la 061 ya está en prod). Si una review pide tocar el schema de BD, es señal de desalineación con el spec — escalar.
- **Compuerta del usuario (post-merge, no bloquea el plan):** smoke con key real de un turno de edición gpt-image por el gateway (el adapter y el worker ya lo soportan; confirma que el gateway rutea la edición). Sin fallback a `OPENAI_API_KEY`.
- **Diferido a Fase 3+ (no incluir en Fase 2):** cadena conversacional de Nano con `thought_signature` (Fase 2 pasa la imagen de trabajo como referencia base, uniforme entre proveedores — el spec ya lo bendice); presets del compositor; retiro de `CreationWizard`/`MasterImageRefiner`; generalización a locación/personaje + outfits/estados; picking de referencias desde toda la biblioteca (Fase 2 solo ofrece las imágenes del propio producto + subir).

## Self-review del plan

- **Cobertura del spec (Fase 2 = "estudio + chat un activo, producto" + "galería + adjuntar con roles, producto"):** ruta a página completa (T3) ✓; 2 columnas chat/galería (T3/T4) ✓; compositor con selector de modelo, calidad gpt-image-2, aspecto, referencias, toggle guard, prompt (T4) ✓; crear/listar sesión (T3 `listStudioSessionsAction`, T4 crea en primer turno) ✓; tarjetas "generando…" + Realtime (T4) ✓; galería de la sesión (T3 read-only, T5 acciones) ✓; adjuntar al producto por rol producto/empaque (T5) ✓; botón "Abrir estudio" (T3) ✓; conservar contexto/imagen de trabajo (T1 base image + T4/T5 `workingId`) ✓; guard "mantener idéntico" opt-in (T1) ✓.
- **Placeholders:** el único texto "placeholder" es la región izquierda de T3, reemplazada íntegramente en T4 — es andamiaje intencional entre tasks, con código completo en ambos lados. Se marcó explícitamente quitar las 3 líneas `void`/`_ws` de ejemplo. Sin TODOs abiertos.
- **Consistencia de tipos:** `StudioTurn`/`StudioRefOption`/`StudioProductImages`/`StudioClientProps` definidos en T3 y consumidos verbatim en T4/T5; `resolveSelection`/`maxReferencesFor`/`variantControlFor`/`defaultVariantFor` (T2) usados con esas firmas en T4; `submitStudioTurnAction` recibe exactamente los campos de `SubmitStudioTurnSchema` incluido el nuevo `assetType` (T1); `GenerationRow.parent_generation_id` (T1) leído por `runImageTurn` (T1); `publicThumbnailUrlClient` (T2) usado en ChatPanel/GalleryPanel (T3/T4).
- **Invariantes:** créditos solo por las SQL atómicas dentro de `submitStudioTurnAction`/worker (no se replican); URLs de proveedor nunca al cliente (thumbnails públicos + refs firmadas server-side); admin client solo en el worker/acciones (T1 base-image usa `server-only`); RLS + ownership en `listStudioSessionsAction`; sin migración; todo por el gateway.
