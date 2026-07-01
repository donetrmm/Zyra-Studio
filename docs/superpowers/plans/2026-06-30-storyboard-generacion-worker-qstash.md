# Mover la generacion de paneles del storyboard al worker QStash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover toda la generacion de paneles del storyboard (estricta y no estricta) del server action inline al worker QStash, para que el path estricto (Nano + FLUX expand) no exceda el cap de 60s de Vercel Hobby.

**Architecture:** El server action solo valida, arma un payload autocontenido, inserta la fila `generations`, reserva creditos y encola (`action:'submit'`); retorna de inmediato con `generationId`. Un nuevo handler `nano-banana` en el worker corre Nano en `submit` (finaliza si no estricto; sube la base 4:5 y re-encola si estricto) y el FLUX expand en `poll` (estricto). El cliente escucha el estado por Realtime.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (Postgres/RLS/Storage/Realtime), Upstash QStash, sharp, BFL FLUX.1 Expand, Gemini (Nano Banana), vitest, pnpm.

## Global Constraints

- Sin emojis en codigo ni UI.
- No `any` en TypeScript: `unknown` + narrowing o tipo explicito.
- pnpm para todo (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm vitest`). Nunca npm.
- Commits sin trailer `Co-Authored-By`.
- Archivos nuevos UTF-8 SIN BOM.
- Clausulas de prompt en ASCII.
- `'use server'` (server-actions/storyboard.ts) solo exporta funciones async.
- URLs de proveedor NUNCA al cliente: el worker descarga y sube a Supabase; solo URLs internas.
- Service role solo server-side.
- Creditos solo via RPCs atomicas (`reserveCredits`/`completeGeneration`/`failGeneration`/`refundCredits`/`confirmCredits`). Nunca tocar tablas de credito directo.
- Realtime en el cliente con `setAuth` explicito antes de `subscribe` (RLS lo necesita), y re-aplicar en `TOKEN_REFRESHED`.
- Tests NO llaman APIs reales (Nano/FLUX/QStash): se mockean los adapters. El smoke real lo corre el usuario.
- Sin migracion: reusa `generations.params`/`provider_payload` (jsonb) y el flag `safeAreaExtend`.

**Spec:** `docs/superpowers/specs/2026-06-30-storyboard-generacion-worker-qstash-design.md`

**Contratos existentes (verbatim, para todas las tasks):**

`lib/jobs/handlers/types.ts`:
```ts
export type JobAction = 'submit' | 'poll';
export type JobResult =
  | { kind: 'continue'; taskId?: string; delaySeconds: number; providerPayload?: Record<string, unknown> }
  | { kind: 'finalize'; outputBuffer: Buffer; mimeType: string; metadata?: Record<string, unknown>; lastFrameUrl?: string }
  | { kind: 'fail'; message: string; code: 'safety' | 'rate_limit' | 'timeout' | 'unknown' };
export type GenerationRow = {
  id: string; user_id: string; workspace_id: string;
  type: 'video' | 'image' | 'audio';
  provider: 'veo' | 'kling' | 'elevenlabs' | 'nano-banana' | 'flux' | 'seedance';
  model_id: string; prompt: string | null; params: Record<string, unknown>;
  reference_ids: string[];
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  provider_task_id: string | null; provider_payload: Record<string, unknown> | null;
  poll_attempts: number; timeout_at: string | null; cancel_requested: boolean; credits_estimated: number;
};
export interface JobHandler {
  handle(gen: GenerationRow, action: JobAction): Promise<JobResult>;
  cancel?(gen: GenerationRow): Promise<void>;
}
```

`lib/providers/types.ts` (NanoBananaParams/Turn, GenerationResult): `generateNanoBanana` es `generate(params: NanoBananaParams): Promise<GenerationResult>` con `GenerationResult = { buffer: Buffer; mimeType: string; thoughtSignature?: string; meta? }` y `NanoBananaTurn = { prompt: string; imageBuffer: Buffer; mimeType: string; thoughtSignature?: string }`.

`lib/providers/flux-expand.ts`: `expand(params: { image: Buffer; top: number; bottom: number; left?: number; right?: number; prompt: string; safetyTolerance?: number }): Promise<{ buffer: Buffer; mimeType: string }>`.

`lib/images/safe-area.ts`: `safeAreaBands(width): { bandPx; canvasHeight }`, `centralSafeCrop(panel916): Promise<Buffer>`.

`lib/supabase/storage.ts`: `uploadSafeBase(workspaceId, generationId, buffer, mimeType, extension): Promise<string>`, `downloadReferenceBuffer(path): Promise<{buffer,mimeType}>`, `downloadOutputBuffer(path): Promise<{buffer,mimeType}>`, `promoteOutputToReference(workspaceId, userId, outputPath, generationId): Promise<string>`.

`lib/credits/operations.ts`: `reserveCredits(userId, amount, generationId): Promise<boolean>`, `refundCredits(userId, amount, generationId): Promise<void>`, `failGeneration(userId, generationId, cost, errorMessage): Promise<void>`. `finalizeGeneration` (worker) llama a `completeGeneration({..., providerPayload: metadata ?? null})`, asi que el `metadata` que retorna un handler `finalize` se persiste en `generations.provider_payload`.

`lib/jobs/queue.ts`: `enqueueJob({ generationId, action: 'submit'|'poll'|'advance_chain', delaySeconds?, lastFramePath?, lastFrameUrl? }): Promise<{messageId}>`.

`inferExtension(mimeType)`, `NANO_MODEL_SLUG`, `NANO_VARIANT`, `nanoVariantToResolution` viven en el codigo del storyboard/providers y se importan donde se indique.

---

### Task 1: Payload del job (`lib/campaigns/storyboard-job.ts`)

**Files:**
- Create: `lib/campaigns/storyboard-job.ts`
- Test: `lib/campaigns/storyboard-job.test.ts`

**Interfaces:**
- Produces:
  - `type StoryboardJobPayload = { campaignItemId: string; campaignId: string; genAspect: string; strict: boolean; conversational: boolean; referencePaths: string[]; chatRefPaths: string[]; prevTurn: null | { imagePath: string; thoughtSignature?: string; prompt: string } }`
  - `buildStoryboardJobPayload(args: BuildArgs): StoryboardJobPayload` — ensambla el payload (puro, sin IO).

- [ ] **Step 1: Escribir el test que falla**

Create `lib/campaigns/storyboard-job.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildStoryboardJobPayload } from './storyboard-job';

describe('buildStoryboardJobPayload', () => {
  it('fresco (sin prevTurn): conversational false, prevTurn null', () => {
    const p = buildStoryboardJobPayload({
      campaignItemId: 'item-1', campaignId: 'camp-1', genAspect: '9:16', strict: false,
      referencePaths: ['ws/prod.png', 'ws/loc.png'], chatRefPaths: [], prevTurn: null,
    });
    expect(p).toEqual({
      campaignItemId: 'item-1', campaignId: 'camp-1', genAspect: '9:16', strict: false,
      conversational: false, referencePaths: ['ws/prod.png', 'ws/loc.png'], chatRefPaths: [], prevTurn: null,
    });
  });
  it('encadenado estricto: conversational true, genAspect 4:5, prevTurn con path/sig', () => {
    const p = buildStoryboardJobPayload({
      campaignItemId: 'item-2', campaignId: 'camp-1', genAspect: '4:5', strict: true,
      referencePaths: [], chatRefPaths: ['ws/prod.png'],
      prevTurn: { imagePath: 'ws/gen/safe-base.jpg', thoughtSignature: 'sig', prompt: 'prev' },
    });
    expect(p.conversational).toBe(true);
    expect(p.genAspect).toBe('4:5');
    expect(p.prevTurn).toEqual({ imagePath: 'ws/gen/safe-base.jpg', thoughtSignature: 'sig', prompt: 'prev' });
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/storyboard-job.test.ts`
Expected: FAIL — `Cannot find module './storyboard-job'`.

- [ ] **Step 3: Implementar el modulo**

Create `lib/campaigns/storyboard-job.ts`:

```ts
// Payload autocontenido que el server action del storyboard guarda en
// generations.params.storyboard para que el worker reconstruya la llamada a Nano
// solo desde la fila. Sin IO: el worker descarga las imagenes por path. Puro.

export type StoryboardPrevTurnRef = {
  imagePath: string; // path en el bucket outputs (safe_base 4:5 o el output 9:16 legacy)
  thoughtSignature?: string;
  prompt: string;
};

export type StoryboardJobPayload = {
  campaignItemId: string;
  campaignId: string;
  genAspect: string; // '4:5' en estricto, si no el aspecto del item
  strict: boolean;
  conversational: boolean;
  referencePaths: string[]; // refs limpias (producto/personaje/locacion) por storage path
  chatRefPaths: string[]; // refs re-ancladas en chat (ya resueltas por flag); vacio si ninguna
  prevTurn: StoryboardPrevTurnRef | null;
};

export type BuildStoryboardJobPayloadArgs = {
  campaignItemId: string;
  campaignId: string;
  genAspect: string;
  strict: boolean;
  referencePaths: string[];
  chatRefPaths: string[];
  prevTurn: StoryboardPrevTurnRef | null;
};

export function buildStoryboardJobPayload(args: BuildStoryboardJobPayloadArgs): StoryboardJobPayload {
  return {
    campaignItemId: args.campaignItemId,
    campaignId: args.campaignId,
    genAspect: args.genAspect,
    strict: args.strict,
    conversational: args.prevTurn !== null,
    referencePaths: args.referencePaths,
    chatRefPaths: args.chatRefPaths,
    prevTurn: args.prevTurn,
  };
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/campaigns/storyboard-job.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/storyboard-job.ts lib/campaigns/storyboard-job.test.ts
git commit -m "feat(storyboard): payload autocontenido del job para el worker"
```

---

### Task 2: Extraer `extendPanelTo916` + subir el timeout del expand

**Files:**
- Create: `lib/campaigns/storyboard-expand.ts`
- Test: `lib/campaigns/storyboard-expand.test.ts`
- Modify: `lib/providers/flux-expand.ts` (constantes de poll)
- Modify: `server-actions/storyboard.ts` (borrar `extendPanelTo916` local, importar de la nueva ubicacion)

**Interfaces:**
- Consumes: `expand` (flux-expand), `safeAreaBands` (safe-area), `sharp`.
- Produces: `extendPanelTo916(base: { buffer: Buffer; mimeType: string }): Promise<{ buffer: Buffer; mimeType: string }>` — expande la base 4:5 a 9:16; propaga `ProviderError` si el expand falla (sin fallback).

- [ ] **Step 1: Subir el timeout interno del expand**

En `lib/providers/flux-expand.ts`, reemplazar:
```ts
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30000;
```
por:
```ts
const POLL_INTERVAL_MS = 1000;
// El expand corre solo dentro de UNA invocacion del worker (60s). 50s deja margen
// para el submit/download y evita el kill por 60s; 30s disparaba timeouts falsos.
const POLL_TIMEOUT_MS = 50000;
```

- [ ] **Step 2: Escribir el test que falla (extendPanelTo916 con expand mockeado)**

Create `lib/campaigns/storyboard-expand.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const expandMock = vi.fn();
vi.mock('@/lib/providers/flux-expand', () => ({ expand: (...a: unknown[]) => expandMock(...a) }));

import { extendPanelTo916 } from './storyboard-expand';

beforeEach(() => expandMock.mockReset());

describe('extendPanelTo916', () => {
  it('llama a expand con top/bottom = bandPx del ancho de la base', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockResolvedValue({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const out = await extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' });
    expect(out).toEqual({ buffer: Buffer.from('out'), mimeType: 'image/jpeg' });
    const arg = expandMock.mock.calls[0][0] as { top: number; bottom: number };
    expect(arg.top).toBe(95);
    expect(arg.bottom).toBe(95);
  });
  it('propaga el error del expand (sin fallback)', async () => {
    const base = await sharp({ create: { width: 360, height: 450, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    expandMock.mockRejectedValue(new Error('moderado'));
    await expect(extendPanelTo916({ buffer: base, mimeType: 'image/jpeg' })).rejects.toThrow('moderado');
  });
});
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/storyboard-expand.test.ts`
Expected: FAIL — `Cannot find module './storyboard-expand'`.

- [ ] **Step 4: Crear el modulo (mover la funcion desde storyboard.ts)**

Create `lib/campaigns/storyboard-expand.ts` (copiar el cuerpo actual de `extendPanelTo916` de `server-actions/storyboard.ts`, con sus imports):

```ts
import sharp from 'sharp';
import { ProviderError } from '@/lib/providers/types';
import { expand } from '@/lib/providers/flux-expand';
import { safeAreaBands } from '@/lib/images/safe-area';

// Expande una base 4:5 a 9:16 con FLUX.1 Expand (outpaint con mascara). Agrega
// bandas reales arriba y abajo preservando el centro 4:5. NO hace fallback: si el
// expand cae (endpoint no disponible, 402, timeout, moderado) deja propagar el
// ProviderError para que el worker falle limpio (fail + refund). El prompt es NEUTRO
// a proposito: el expand continua el fondo que ya ve, no necesita la escena, y asi se
// reduce la superficie de moderacion de BFL y se evita inventar un sujeto en las bandas.
export async function extendPanelTo916(
  base: { buffer: Buffer; mimeType: string },
): Promise<{ buffer: Buffer; mimeType: string }> {
  const meta = await sharp(base.buffer).metadata();
  const width = meta.width ?? 0;
  if (!width) {
    throw new ProviderError('zona segura: no se pudo leer el ancho de la base', 'invalid_input', false);
  }
  const { bandPx } = safeAreaBands(width);
  const prompt =
    'Extend the existing image naturally above and below into a taller vertical frame: continue the same background, walls, floor, sky, lighting and colors already present in the image. Do not add, remove, or change any people, products, text or objects; only extend the empty surroundings.';
  const result = await expand({ image: base.buffer, top: bandPx, bottom: bandPx, prompt });
  return { buffer: result.buffer, mimeType: result.mimeType };
}
```

- [ ] **Step 5: Borrar la funcion local en `server-actions/storyboard.ts` e importar la nueva**

En `server-actions/storyboard.ts`, ELIMINAR por completo la funcion local `extendPanelTo916` (el bloque `async function extendPanelTo916(base: ...) { ... }` con su comentario). Agregar el import cerca de los otros `@/lib/campaigns/...`:
```ts
import { extendPanelTo916 } from '@/lib/campaigns/storyboard-expand';
```
(Los call sites `await extendPanelTo916({ buffer: result.buffer, mimeType: result.mimeType })` siguen compilando; se eliminaran en Task 5.) Confirmar que `sharp` sigue importado si otras partes del archivo lo usan; si `extendPanelTo916` era el unico uso de `sharp`/`expand`/`safeAreaBands`/`ProviderError`(no lo es, ProviderError se usa en los catch), quitar solo los imports que queden sin uso segun el linter.

- [ ] **Step 6: Correr tests + typecheck**

Run: `pnpm vitest run lib/campaigns/storyboard-expand.test.ts lib/providers/flux-expand.test.ts && pnpm typecheck`
Expected: PASS (storyboard-expand 2 tests, flux-expand 3 tests) y typecheck sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/storyboard-expand.ts lib/campaigns/storyboard-expand.test.ts lib/providers/flux-expand.ts server-actions/storyboard.ts
git commit -m "refactor(storyboard): extraer extendPanelTo916 a modulo compartido + subir timeout del expand a 50s"
```

---

### Task 3: Handler `nano-banana` (`lib/jobs/handlers/nano-banana.ts`)

**Files:**
- Create: `lib/jobs/handlers/nano-banana.ts`
- Test: `lib/jobs/handlers/nano-banana.test.ts`
- Modify: `lib/jobs/handlers/register.ts`

**Interfaces:**
- Consumes: `JobHandler`/`JobResult`/`GenerationRow` (types.ts), `StoryboardJobPayload` (Task 1), `extendPanelTo916` (Task 2), `generateNanoBanana` (`generate` de nano-banana), `centralSafeCrop`, `uploadSafeBase`, `downloadReferenceBuffer`, `downloadOutputBuffer`, `inferExtension`, `NANO_VARIANT`, `nanoVariantToResolution`.
- Produces: `nanoBananaHandler: JobHandler` (registrado como provider `'nano-banana'`).

Nota: `NANO_VARIANT` y `nanoVariantToResolution` viven hoy en `server-actions/storyboard.ts`; NO se pueden importar desde ahi (es `'use server'`). Mover ambos a `lib/providers/nano-banana.ts` (o a `lib/campaigns/storyboard-nano.ts`) como export reutilizable, y que tanto el action como el handler los importen desde ahi. Hacerlo como primer paso de esta task.

- [ ] **Step 1: Exponer `NANO_VARIANT` + `nanoVariantToResolution` en un modulo importable**

Localizar en `server-actions/storyboard.ts` las definiciones de `NANO_VARIANT` y `nanoVariantToResolution` (y `NANO_MODEL_SLUG` si es local). Moverlas a `lib/providers/nano-banana.ts` como exports (`export const NANO_MODEL_SLUG`, `export const NANO_VARIANT`, `export function nanoVariantToResolution(...)`). En `server-actions/storyboard.ts`, importarlas desde `@/lib/providers/nano-banana` en vez de definirlas. Correr `pnpm typecheck` para confirmar que no se rompio nada.

- [ ] **Step 2: Escribir el test que falla (Nano/FLUX mockeados)**

Create `lib/jobs/handlers/nano-banana.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const nanoMock = vi.fn();
const extendMock = vi.fn();
const uploadSafeBaseMock = vi.fn();
const dlRefMock = vi.fn();
const dlOutMock = vi.fn();

vi.mock('@/lib/providers/nano-banana', () => ({
  generate: (...a: unknown[]) => nanoMock(...a),
  NANO_MODEL_SLUG: 'gemini-3-pro-image-preview',
  NANO_VARIANT: '2K',
  nanoVariantToResolution: () => '2K',
}));
vi.mock('@/lib/campaigns/storyboard-expand', () => ({ extendPanelTo916: (...a: unknown[]) => extendMock(...a) }));
vi.mock('@/lib/supabase/storage', () => ({
  uploadSafeBase: (...a: unknown[]) => uploadSafeBaseMock(...a),
  downloadReferenceBuffer: (...a: unknown[]) => dlRefMock(...a),
  downloadOutputBuffer: (...a: unknown[]) => dlOutMock(...a),
}));
vi.mock('@/lib/images/safe-area', () => ({ centralSafeCrop: async (b: Buffer) => b }));

import { nanoBananaHandler } from './nano-banana';
import type { GenerationRow } from './types';

function row(strict: boolean, prevTurn: unknown = null): GenerationRow {
  return {
    id: 'gen-1', user_id: 'u', workspace_id: 'ws', type: 'image', provider: 'nano-banana',
    model_id: 'gemini-3-pro-image-preview', prompt: 'do it',
    params: { storyboard: { campaignItemId: 'item-1', campaignId: 'c', genAspect: strict ? '4:5' : '9:16', strict, conversational: prevTurn !== null, referencePaths: [], chatRefPaths: [], prevTurn } },
    reference_ids: [], status: 'processing', provider_task_id: null,
    provider_payload: null, poll_attempts: 0, timeout_at: null, cancel_requested: false, credits_estimated: 10,
  };
}

beforeEach(() => { nanoMock.mockReset(); extendMock.mockReset(); uploadSafeBaseMock.mockReset(); dlRefMock.mockReset(); dlOutMock.mockReset(); });

describe('nanoBananaHandler', () => {
  it('no estricto submit -> finalize con thought_signature en metadata', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('img'), mimeType: 'image/jpeg', thoughtSignature: 'sig' });
    const res = await nanoBananaHandler.handle(row(false), 'submit');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') {
      expect(res.outputBuffer).toEqual(Buffer.from('img'));
      expect(res.metadata).toEqual({ thought_signature: 'sig' });
    }
  });
  it('estricto submit -> continue con safe_base_path en providerPayload', async () => {
    nanoMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg', thoughtSignature: 'sig' });
    uploadSafeBaseMock.mockResolvedValue('ws/gen-1/safe-base.jpg');
    const res = await nanoBananaHandler.handle(row(true), 'submit');
    expect(res.kind).toBe('continue');
    if (res.kind === 'continue') {
      expect(res.providerPayload).toEqual({ thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' });
    }
  });
  it('estricto poll -> descarga safe_base, expande, finalize', async () => {
    dlOutMock.mockResolvedValue({ buffer: Buffer.from('base'), mimeType: 'image/jpeg' });
    extendMock.mockResolvedValue({ buffer: Buffer.from('916'), mimeType: 'image/jpeg' });
    const r = row(true);
    r.provider_payload = { thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' };
    const res = await nanoBananaHandler.handle(r, 'poll');
    expect(res.kind).toBe('finalize');
    if (res.kind === 'finalize') {
      expect(res.outputBuffer).toEqual(Buffer.from('916'));
      expect(res.metadata).toEqual({ thought_signature: 'sig', safe_base_path: 'ws/gen-1/safe-base.jpg' });
    }
  });
  it('un ProviderError de Nano -> fail con code safety', async () => {
    const { ProviderError } = await import('@/lib/providers/types');
    nanoMock.mockRejectedValue(new ProviderError('moderado', 'safety', false));
    const res = await nanoBananaHandler.handle(row(false), 'submit');
    expect(res.kind).toBe('fail');
    if (res.kind === 'fail') expect(res.code).toBe('safety');
  });
});
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/jobs/handlers/nano-banana.test.ts`
Expected: FAIL — `Cannot find module './nano-banana'`.

- [ ] **Step 4: Implementar el handler**

Create `lib/jobs/handlers/nano-banana.ts`:

```ts
import 'server-only';
import type { GenerationRow, JobHandler, JobResult } from './types';
import type { StoryboardJobPayload } from '@/lib/campaigns/storyboard-job';
import { generate as generateNanoBanana, NANO_VARIANT, nanoVariantToResolution } from '@/lib/providers/nano-banana';
import { ProviderError, type ImageReference, type NanoBananaTurn } from '@/lib/providers/types';
import { extendPanelTo916 } from '@/lib/campaigns/storyboard-expand';
import { centralSafeCrop } from '@/lib/images/safe-area';
import { downloadOutputBuffer, downloadReferenceBuffer, uploadSafeBase } from '@/lib/supabase/storage';
import { inferExtension } from '@/lib/media/extension';

function payloadOf(gen: GenerationRow): StoryboardJobPayload {
  const raw = (gen.params as { storyboard?: unknown }).storyboard;
  if (!raw || typeof raw !== 'object') {
    throw new ProviderError('storyboard job sin payload', 'invalid_input', false);
  }
  return raw as StoryboardJobPayload;
}

function toFail(err: unknown): JobResult {
  if (err instanceof ProviderError) {
    const code =
      err.code === 'safety' ? 'safety'
        : err.code === 'rate_limit' ? 'rate_limit'
          : err.code === 'timeout' ? 'timeout'
            : 'unknown';
    return { kind: 'fail', message: err.message, code };
  }
  return { kind: 'fail', message: (err as Error)?.message ?? 'unknown', code: 'unknown' };
}

async function runNano(gen: GenerationRow, p: StoryboardJobPayload) {
  const references: ImageReference[] = await Promise.all(
    p.referencePaths.map(async (path) => {
      const { buffer, mimeType } = await downloadReferenceBuffer(path);
      return { buffer, mimeType };
    }),
  );
  const chatRefs: ImageReference[] = await Promise.all(
    p.chatRefPaths.map(async (path) => {
      const { buffer, mimeType } = await downloadReferenceBuffer(path);
      return { buffer, mimeType };
    }),
  );
  let previousTurn: NanoBananaTurn | null = null;
  if (p.prevTurn) {
    const { buffer, mimeType } = await downloadOutputBuffer(p.prevTurn.imagePath);
    const img = p.strict ? await centralSafeCrop(buffer) : buffer;
    previousTurn = { prompt: p.prevTurn.prompt, imageBuffer: img, mimeType, thoughtSignature: p.prevTurn.thoughtSignature };
  }
  return generateNanoBanana({
    model: gen.model_id as NanoBananaParamsModel,
    prompt: gen.prompt ?? '',
    aspectRatio: p.genAspect,
    resolution: nanoVariantToResolution(NANO_VARIANT),
    references,
    previousTurn,
    conversational: p.conversational,
    useGrounding: false,
    hasTextInImage: false,
    chatReferences: chatRefs.length > 0 ? chatRefs : undefined,
  });
}

type NanoBananaParamsModel = 'gemini-3-pro-image-preview' | 'gemini-3.1-flash-image-preview';

export const nanoBananaHandler: JobHandler = {
  async handle(gen: GenerationRow, action): Promise<JobResult> {
    try {
      const p = payloadOf(gen);
      if (action === 'submit') {
        const res = await runNano(gen, p);
        if (!p.strict) {
          const metadata: Record<string, unknown> = {};
          if (res.thoughtSignature) metadata.thought_signature = res.thoughtSignature;
          return { kind: 'finalize', outputBuffer: res.buffer, mimeType: res.mimeType, metadata };
        }
        const baseExt = inferExtension(res.mimeType);
        const safeBasePath = await uploadSafeBase(gen.workspace_id, gen.id, res.buffer, res.mimeType, baseExt);
        const providerPayload: Record<string, unknown> = { safe_base_path: safeBasePath };
        if (res.thoughtSignature) providerPayload.thought_signature = res.thoughtSignature;
        return { kind: 'continue', delaySeconds: 0, providerPayload };
      }
      // action === 'poll' (solo estricto): descargar la base 4:5 y expandir a 9:16.
      const pp = (gen.provider_payload ?? {}) as { thought_signature?: string; safe_base_path?: string };
      if (!pp.safe_base_path) throw new ProviderError('poll sin safe_base_path', 'invalid_input', false);
      const { buffer } = await downloadOutputBuffer(pp.safe_base_path);
      const expanded = await extendPanelTo916({ buffer, mimeType: 'image/jpeg' });
      const metadata: Record<string, unknown> = { safe_base_path: pp.safe_base_path };
      if (pp.thought_signature) metadata.thought_signature = pp.thought_signature;
      return { kind: 'finalize', outputBuffer: expanded.buffer, mimeType: expanded.mimeType, metadata };
    } catch (err) {
      return toFail(err);
    }
  },
};
```

Nota de implementacion: confirmar la ruta real de `inferExtension` (buscar `export function inferExtension`); si vive en otro modulo, ajustar el import. `NanoBananaParams`/`ImageReference`/`NanoBananaTurn` se importan de `@/lib/providers/types`. Si `NanoBananaParamsModel` ya existe exportado, usarlo en vez del alias local.

- [ ] **Step 5: Registrar el handler**

En `lib/jobs/handlers/register.ts`, agregar el import y el registro:
```ts
import { nanoBananaHandler } from './nano-banana';
```
y, junto a los otros:
```ts
registerHandler('nano-banana', nanoBananaHandler);
```

- [ ] **Step 6: Correr tests + typecheck**

Run: `pnpm vitest run lib/jobs/handlers/nano-banana.test.ts && pnpm typecheck`
Expected: PASS (4 tests) y typecheck sin errores.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/handlers/nano-banana.ts lib/jobs/handlers/nano-banana.test.ts lib/jobs/handlers/register.ts lib/providers/nano-banana.ts server-actions/storyboard.ts
git commit -m "feat(worker): handler nano-banana (submit=Nano, poll=expand estricto)"
```

---

### Task 4: Post-finalize del storyboard en el worker (`app/api/jobs/process/route.ts`)

**Files:**
- Create: `lib/jobs/storyboard-finalize.ts`
- Test: `lib/jobs/storyboard-finalize.test.ts`
- Modify: `app/api/jobs/process/route.ts`

**Interfaces:**
- Consumes: `GenerationRow`, `StoryboardJobPayload`, `promoteOutputToReference`, admin client.
- Produces: `storyboardCampaignItemId(gen): string | null` (puro, testeable) y `promoteStoryboardPanel(gen): Promise<void>` (IO best-effort).

- [ ] **Step 1: Escribir el test que falla (predicado puro)**

Create `lib/jobs/storyboard-finalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { storyboardCampaignItemId } from './storyboard-finalize';
import type { GenerationRow } from './handlers/types';

function gen(params: Record<string, unknown>): GenerationRow {
  return {
    id: 'g', user_id: 'u', workspace_id: 'ws', type: 'image', provider: 'nano-banana',
    model_id: 'm', prompt: null, params, reference_ids: [], status: 'done',
    provider_task_id: null, provider_payload: null, poll_attempts: 0, timeout_at: null,
    cancel_requested: false, credits_estimated: 0,
  };
}

describe('storyboardCampaignItemId', () => {
  it('devuelve el campaignItemId cuando el payload existe', () => {
    expect(storyboardCampaignItemId(gen({ storyboard: { campaignItemId: 'item-9' } }))).toBe('item-9');
  });
  it('devuelve null cuando no es una generacion de storyboard', () => {
    expect(storyboardCampaignItemId(gen({}))).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/jobs/storyboard-finalize.test.ts`
Expected: FAIL — `Cannot find module './storyboard-finalize'`.

- [ ] **Step 3: Implementar el modulo**

Create `lib/jobs/storyboard-finalize.ts`:

```ts
import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { promoteOutputToReference } from '@/lib/supabase/storage';
import type { GenerationRow } from './handlers/types';

// Extrae el campaignItemId si esta generacion es un panel de storyboard.
export function storyboardCampaignItemId(gen: GenerationRow): string | null {
  const sb = (gen.params as { storyboard?: { campaignItemId?: unknown } }).storyboard;
  const id = sb?.campaignItemId;
  return typeof id === 'string' ? id : null;
}

// Post-step del storyboard tras finalize (mueve lo que hacia el server action inline):
// promueve el output ya subido a media_reference y lo linkea al campaign_item.
// Best-effort: un fallo aqui no invalida la generacion ya 'done' (solo se loguea).
export async function promoteStoryboardPanel(gen: GenerationRow): Promise<void> {
  const itemId = storyboardCampaignItemId(gen);
  if (!itemId) return;
  const admin = createAdminClient();
  const { data } = await admin.from('generations').select('output_url').eq('id', gen.id).single();
  const outputUrl = (data as { output_url?: string | null } | null)?.output_url ?? null;
  if (!outputUrl) return;
  const imageId = await promoteOutputToReference(gen.workspace_id, gen.user_id, outputUrl, gen.id);
  await admin
    .from('campaign_items')
    .update({ storyboard_image_id: imageId, storyboard_generation_id: gen.id })
    .eq('id', itemId);
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/jobs/storyboard-finalize.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Llamar el post-step desde el worker tras finalize**

En `app/api/jobs/process/route.ts`, dentro del bloque `finalize` (justo despues de `await finalizeGeneration({...})` y ANTES del bloque `if (generation.params?.chain && result.lastFrameUrl)`), agregar:

```ts
    // Post-step del storyboard: promover el output a media_reference y linkearlo al
    // campaign_item (esto lo hacia el server action inline). Best-effort.
    try {
      await promoteStoryboardPanel(generation);
    } catch (err) {
      console.error('[worker] promote storyboard panel fallo', { generationId, err });
    }
```
Agregar el import al inicio del archivo:
```ts
import { promoteStoryboardPanel } from '@/lib/jobs/storyboard-finalize';
```

- [ ] **Step 6: Verificar typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/storyboard-finalize.ts lib/jobs/storyboard-finalize.test.ts app/api/jobs/process/route.ts
git commit -m "feat(worker): post-finalize del storyboard (promote + link al campaign_item)"
```

---

### Task 5: Server actions -> encolar (`server-actions/storyboard.ts`)

**Files:**
- Modify: `server-actions/storyboard.ts`

**Interfaces:**
- Consumes: `buildStoryboardJobPayload` (Task 1), `enqueueJob`, `reserveCredits`, `refundCredits`, `failGeneration`.
- Produces: `generatePanelAction(itemId, opts?): Promise<Result<{ generationId: string }>>` y `refinePanelAction(itemId, instruction): Promise<Result<{ generationId: string }>>` (encolan y retornan de inmediato); `loadPreviousPanelRef(...)` (reemplaza a `loadPreviousPanelTurn`, devuelve el path sin descargar).

- [ ] **Step 1: Reemplazar `loadPreviousPanelTurn` por `loadPreviousPanelRef` (devuelve path, no buffer)**

En `server-actions/storyboard.ts`, reemplazar la funcion `loadPreviousPanelTurn` por:

```ts
// Ref del panel previo para ENCADENAR (sin descargar la imagen: el worker la baja).
// Devuelve el PATH que calza con el thought_signature: en estricto el safe_base_path
// (base 4:5 de Nano), si no el output. Misma logica de cadena (secuencia, break por
// locacion) que antes.
async function loadPreviousPanelRef(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  campaignId: string,
  sceneIndex: number | null,
  sequenceId: string | null,
  currentLocationId: string | null,
): Promise<{ imagePath: string; prompt: string; thoughtSignature?: string } | null> {
  if (sceneIndex == null || sequenceId == null) return null;
  const { data: rows } = await supabase
    .from('campaign_items')
    .select('scene_index, storyboard_generation_id, location_id')
    .eq('campaign_id', campaignId)
    .eq('sequence_id', sequenceId)
    .lt('scene_index', sceneIndex)
    .not('storyboard_generation_id', 'is', null)
    .order('scene_index', { ascending: false })
    .limit(1);
  const prevRow = rows?.[0] as { storyboard_generation_id: string | null; location_id: string | null } | undefined;
  const prevGenId = prevRow?.storyboard_generation_id ?? null;
  if (!prevGenId) return null;
  if ((prevRow?.location_id ?? null) !== (currentLocationId ?? null)) return null;
  const { data: gen } = await supabase
    .from('generations')
    .select('output_url, workspace_id, status, prompt, provider_payload, model_id')
    .eq('id', prevGenId)
    .single();
  const g = gen as
    | {
        output_url: string | null;
        workspace_id: string;
        status: string;
        prompt: string | null;
        provider_payload: { thought_signature?: string; safe_base_path?: string } | null;
        model_id: string;
      }
    | null;
  if (!g || g.workspace_id !== workspaceId || !g.output_url || g.status !== 'done') return null;
  const imagePath = g.provider_payload?.safe_base_path ?? g.output_url;
  return {
    imagePath,
    prompt: g.prompt ?? '',
    thoughtSignature: g.model_id === NANO_MODEL_SLUG ? g.provider_payload?.thought_signature : undefined,
  };
}
```

- [ ] **Step 2: Reescribir `generatePanelAction` para encolar**

En `generatePanelAction`, MANTENER sin cambios todo el prologo (desde `if (!itemId)` hasta `const compiled = compilePanel(...)` con su `if (!compiled.ok)`), y REEMPLAZAR desde `const prevTurn = await loadPreviousPanelTurn(...)` hasta el `return { ok: true, data: { imageId, generationId } }` final (todo el bloque try/catch inline) por:

```ts
  const prevRef = await loadPreviousPanelRef(locClient, workspace.id, item.campaign_id, item.scene_index, item.sequence_id, item.location_id);
  const noText = ' Do not render any text, captions, speech bubbles, subtitles, labels or watermark in the image.';
  const productRefInChat =
    Boolean(prevRef) &&
    (opts?.productRefInChat ?? process.env.STORYBOARD_PRODUCT_REF_IN_CHAT === '1');
  const productRefPointer = productRefInChat
    ? ' A reference image of the product is also attached — reproduce its printed image and design exactly. The previous panel remains the base shot to re-frame; do not replace the scene with the product image.'
    : '';
  const characterRefInChat =
    Boolean(prevRef) &&
    (opts?.characterRefInChat ?? process.env.STORYBOARD_CHARACTER_REF_IN_CHAT === '1');
  const characterFidelityText = characterRefInChat ? chainedCharacterFidelity(dirCtx) : '';
  const characterRefPointer = characterRefInChat
    ? ' A reference image of each character is also attached — reproduce their exact face, hair, build and wardrobe; the previous panel remains the base shot to re-frame, do not replace the scene with the character image.'
    : '';
  const panelPromptBody = prevRef
    ? `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and in the same position in the scene), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${item.scene_prompt.trim()}.${chainedProductFidelity(dirCtx)}${describeProductScale(dirCtx.product)}${creativeGuidelineClauses(baseDirCtx.guidelines, { isOpeningBeat: (item.scene_index ?? 0) === 0 })}${characterFidelityText}${productRefPointer}${characterRefPointer}${noText}`
    : `${compiled.compiled.prompt}${humanRealismDirective(dirCtx, item.scene_prompt)}${describeProductScale(dirCtx.product)}${noText}`;
  const panelPrompt = panelPromptBody;

  const imageRefs = compiled.compiled.references.filter((r) => r.kind === 'image');
  const referencePaths = imageRefs.map((r) => r.storagePath);
  const chatRefPaths = [
    ...(productRefInChat ? imageRefs.filter((r) => r.role === 'product').map((r) => r.storagePath) : []),
    ...(characterRefInChat ? imageRefs.filter((r) => r.role === 'character').map((r) => r.storagePath) : []),
  ];

  const payload = buildStoryboardJobPayload({
    campaignItemId: itemId,
    campaignId: item.campaign_id,
    genAspect,
    strict: strictSafe,
    referencePaths,
    chatRefPaths,
    prevTurn: prevRef ? { imagePath: prevRef.imagePath, thoughtSignature: prevRef.thoughtSignature, prompt: prevRef.prompt } : null,
  });

  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: Boolean(prevRef), passes: strictSafe ? 2 : 1 },
  });
  const cost = breakdown.total;

  const supabase = await createClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'image',
      provider: 'nano-banana',
      model_id: NANO_MODEL_SLUG,
      prompt: panelPrompt,
      params: {
        aspect_ratio: item.aspect_ratio,
        conversational: Boolean(prevRef),
        has_text_in_image: false,
        use_grounding: false,
        storyboard: payload,
      },
      reference_ids: [],
      campaign_id: item.campaign_id,
      status: 'processing',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
  const generationId = inserted.id as string;

  const reserved = await reserveCredits(user.id, cost, generationId);
  if (!reserved) {
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    return { ok: false, error: 'insufficient_credits' };
  }

  try {
    await enqueueJob({ generationId, action: 'submit' });
  } catch (err) {
    // Rollback: si no se pudo encolar, no dejar creditos colgados ni la fila en processing.
    try {
      await failGeneration(user.id, generationId, cost, `enqueue fallo: ${(err as Error)?.message ?? 'unknown'}`);
    } catch (failErr) {
      console.error('[storyboard:enqueue_rollback:generate]', { generationId, failErr });
    }
    return { ok: false, error: 'internal_error', message: 'no se pudo encolar la generacion' };
  }

  return { ok: true, data: { generationId } };
}
```

Actualizar la firma de retorno de `generatePanelAction` a `Promise<Result<{ generationId: string }>>`.

- [ ] **Step 3: Reescribir `refinePanelAction` para encolar**

En `refinePanelAction`, MANTENER el prologo sin cambios (desde `if (!itemId)` hasta `const refinePrompt = compileRefinePrompt(...)`), y REEMPLAZAR desde `const pricing = await loadPricing()` hasta el `return { ok: true, data: { imageId, generationId } }` final (todo el bloque try/catch inline) por:

```ts
  // Ref del panel padre para encadenar (sin descargar: el worker baja la imagen).
  let prevTurnRef: { imagePath: string; thoughtSignature?: string; prompt: string } | null = null;
  const supabase = await createClient();
  const parentGenId = item.storyboard_generation_id;
  if (parentGenId) {
    const { data: parent } = await supabase
      .from('generations')
      .select('output_url, workspace_id, status, prompt, provider_payload, model_id')
      .eq('id', parentGenId)
      .single();
    const pg = parent as
      | { output_url: string | null; workspace_id: string; status: string; prompt: string | null; provider_payload: { thought_signature?: string; safe_base_path?: string } | null; model_id: string }
      | null;
    if (pg && pg.workspace_id === workspace.id && pg.output_url && pg.status === 'done') {
      prevTurnRef = {
        imagePath: pg.provider_payload?.safe_base_path ?? pg.output_url,
        prompt: pg.prompt ?? '',
        thoughtSignature: pg.model_id === NANO_MODEL_SLUG ? pg.provider_payload?.thought_signature : undefined,
      };
    }
  }

  const referencePaths = compiled.compiled.references.filter((r) => r.kind === 'image').map((r) => r.storagePath);
  const payload = buildStoryboardJobPayload({
    campaignItemId: itemId,
    campaignId: item.campaign_id,
    genAspect,
    strict: strictSafe,
    referencePaths,
    chatRefPaths: [],
    prevTurn: prevTurnRef,
  });

  const pricing = await loadPricing();
  const breakdown = estimateCredits(pricing, {
    provider: 'nano-banana',
    model: NANO_MODEL_SLUG,
    variant: NANO_VARIANT,
    params: { conversational: true, passes: strictSafe ? 2 : 1 },
  });
  const cost = breakdown.total;

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'image',
      provider: 'nano-banana',
      model_id: NANO_MODEL_SLUG,
      prompt: refinePrompt,
      params: {
        aspect_ratio: item.aspect_ratio,
        conversational: true,
        has_text_in_image: false,
        use_grounding: false,
        storyboard: payload,
      },
      reference_ids: [],
      parent_generation_id: item.storyboard_generation_id ?? null,
      campaign_id: item.campaign_id,
      status: 'processing',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return { ok: false, error: 'internal_error', message: insertErr?.message ?? 'no row' };
  }
  const generationId = inserted.id as string;

  const reserved = await reserveCredits(user.id, cost, generationId);
  if (!reserved) {
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    return { ok: false, error: 'insufficient_credits' };
  }

  try {
    await enqueueJob({ generationId, action: 'submit' });
  } catch (err) {
    try {
      await failGeneration(user.id, generationId, cost, `enqueue fallo: ${(err as Error)?.message ?? 'unknown'}`);
    } catch (failErr) {
      console.error('[storyboard:enqueue_rollback:refine]', { generationId, failErr });
    }
    return { ok: false, error: 'internal_error', message: 'no se pudo encolar la generacion' };
  }

  return { ok: true, data: { generationId } };
}
```

Actualizar la firma de retorno de `refinePanelAction` a `Promise<Result<{ generationId: string }>>`. El `conversational` en estricto/refine sigue siendo `true` (el `payload.conversational` lo refleja via `prevTurn !== null` solo si hay padre; para el refine, si no hay padre valido, `prevTurn` es null y `conversational` seria false — aceptable: sin padre no hay chat). El `genAspect`/`strictSafe`/`refineDirCtx` del prologo se conservan; nota: el prompt del refine ya se compilo con `refineDirCtx` (guidelinesForSafeBase) en el prologo.

- [ ] **Step 4: Limpiar imports muertos**

Correr `pnpm lint` y quitar de `server-actions/storyboard.ts` los imports que queden sin uso tras remover la generacion inline (candidatos: `generateNanoBanana`, `extendPanelTo916` si ya no se usa, `uploadOutput`, `uploadThumbnail`, `uploadSafeBase`, `downloadReferenceBuffer`, `downloadOutputBuffer`, `completeGeneration`, `promoteOutputToReference`, `centralSafeCrop`, `nanoVariantToResolution`, `inferExtension`, `makeThumbnail`). Quitar SOLO los que el linter marque sin uso (algunos pueden seguir usados por otras funciones del archivo).

- [ ] **Step 5: Verificar typecheck + build + tests**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm vitest run lib/campaigns/storyboard-job.test.ts`
Expected: PASS. `pnpm build` confirma que `'use server'` sigue exportando solo funciones async.

- [ ] **Step 6: Commit**

```bash
git add server-actions/storyboard.ts
git commit -m "feat(storyboard): los actions encolan al worker en vez de generar inline"
```

---

### Task 6: Cliente por Realtime (`components/campaigns/StoryboardView.tsx`)

**Files:**
- Create: `components/campaigns/use-storyboard-panel-realtime.ts`
- Modify: `components/campaigns/StoryboardView.tsx`

**Interfaces:**
- Consumes: el cliente Supabase (`@/lib/supabase/client`), el patron `setAuth` de `components/generation/use-generation-status.ts`.
- Produces: `useStoryboardPanelRealtime(campaignId, onUpdate)` — suscribe a `generations` de la campana y llama `onUpdate(campaignItemId, status, errorMessage)` en cada cambio.

- [ ] **Step 1: Crear el hook de Realtime (patron setAuth de use-generation-status.ts)**

Create `components/campaigns/use-storyboard-panel-realtime.ts`:

```ts
'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

type PanelUpdate = { campaignItemId: string; status: string; errorMessage: string | null };

// Suscribe a postgres_changes en generations de UNA campana (RLS filtra ownership) y
// notifica cambios de estado de paneles de storyboard. El campaignItemId sale de
// params.storyboard.campaignItemId (== beat.id). setAuth explicito antes de subscribe.
export function useStoryboardPanelRealtime(
  campaignId: string,
  onUpdate: (u: PanelUpdate) => void,
): void {
  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const emit = (row: Record<string, unknown>) => {
      if (!active) return;
      const params = (row.params ?? {}) as { storyboard?: { campaignItemId?: unknown } };
      const itemId = params.storyboard?.campaignItemId;
      if (typeof itemId !== 'string') return;
      onUpdate({
        campaignItemId: itemId,
        status: String(row.status ?? ''),
        errorMessage: (row.error_message as string | null) ?? null,
      });
    };

    const channel = supabase
      .channel(`storyboard:${campaignId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generations', filter: `campaign_id=eq.${campaignId}` },
        (payload) => emit(payload.new as Record<string, unknown>),
      );

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    });

    return () => {
      active = false;
      authSub.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [campaignId, onUpdate]);
}
```

Nota: confirmar que `generations` tiene columna `campaign_id` (el action la inserta) y que la publicacion Realtime la incluye (los otros hooks ya escuchan `generations`).

- [ ] **Step 2: Cablear el hook en `StoryboardView.tsx`**

En `components/campaigns/StoryboardView.tsx`:

a) Importar el hook y `useCallback`:
```ts
import { useStoryboardPanelRealtime } from './use-storyboard-panel-realtime';
```

b) Reemplazar el cuerpo de `handleRegenerate` para NO hacer `router.refresh()` al retornar (ahora es async): dejar el panel en `generating` y que Realtime lo cierre:
```ts
  async function handleRegenerate(beatId: string) {
    setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'generating' } }));
    const res = await generatePanelAction(beatId, {
      productRefInChat: productRef[beatId] ?? false,
      characterRefInChat: characterRef[beatId] ?? false,
    });
    if (!res.ok) {
      const msg = friendlyError(res.error, res.message);
      setPanelStates((prev) => ({ ...prev, [beatId]: { status: 'error', message: msg } }));
      toast.error(msg);
    }
    // ok: el panel queda 'generating'; Realtime lo pasa a idle (done) o error (failed).
  }
```

c) Reemplazar `handleGenerateAll` para solo encolar (sin refresh; Realtime cierra cada uno):
```ts
  async function handleGenerateAll() {
    setGeneratingAll(true);
    for (const beat of withoutPanel) {
      setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'generating' } }));
      const res = await generatePanelAction(beat.id);
      if (!res.ok) {
        const msg = friendlyError(res.error, res.message);
        setPanelStates((prev) => ({ ...prev, [beat.id]: { status: 'error', message: msg } }));
        toast.error(`Panel ${beat.sceneIndex + 1}: ${msg}`);
      }
    }
    setGeneratingAll(false);
  }
```

d) Suscribirse a Realtime y reaccionar. Agregar (tras la definicion de `panelStates`):
```ts
  const onPanelUpdate = useCallback(
    (u: { campaignItemId: string; status: string; errorMessage: string | null }) => {
      if (u.status === 'done') {
        setPanelStates((prev) => ({ ...prev, [u.campaignItemId]: { status: 'idle', panelUrl: null } }));
        router.refresh();
      } else if (u.status === 'failed') {
        const msg = u.errorMessage ?? 'No se pudo generar el panel.';
        setPanelStates((prev) => ({ ...prev, [u.campaignItemId]: { status: 'error', message: msg } }));
      }
    },
    [router],
  );
  useStoryboardPanelRealtime(campaignId, onPanelUpdate);
```
Asegurar que `campaignId` este disponible en el componente (si no es prop, derivarlo de `beats`/props existentes; confirmar el nombre exacto de la prop de la campana). Importar `useCallback` de React.

e) **Reconciliacion al montar** (sobrevive recarga): los paneles cuya generacion sigue en `processing` deben mostrarse `generating`. Como el server ya renderiza `beats` con su `panelUrl`, un panel en vuelo simplemente aun no tiene panel nuevo; el Realtime lo cerrara. No se requiere query extra si el server incluye el estado; si se quiere feedback inmediato de "en proceso" tras recarga, es mejora opcional fuera de esta task (YAGNI).

- [ ] **Step 3: Verificar typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/campaigns/use-storyboard-panel-realtime.ts components/campaigns/StoryboardView.tsx
git commit -m "feat(storyboard): cliente escucha el estado del panel por Realtime"
```

---

### Task 7: Verificacion integral + suite

**Files:** (ninguno nuevo; verificacion)

- [ ] **Step 1: Suite completa + build**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm vitest run`
Expected: PASS (todos los tests, incluidos los nuevos de payload, extend, handler, storyboard-finalize).

- [ ] **Step 2: Checklist de smoke para el usuario (documentar, el usuario lo corre)**

Anotar en el reporte final el smoke que el usuario debe correr con APIs reales:
1. Panel no estricto: se genera, aparece por Realtime, sin exceder 60s.
2. Panel estricto: base 4:5 + expand 9:16, aparece por Realtime; verificar 9:16 nitido y recorte 4:5 exacto.
3. Cadena estricta (2-3 beats): el producto se mantiene (safe_base_path como turno previo).
4. Moderacion/timeout del expand: el panel pasa a `failed` con motivo, y los creditos se refundan.
5. "Generar todos": N paneles se resuelven independientes por Realtime.
6. Recargar durante la generacion: al volver, el panel terminado aparece.

- [ ] **Step 3: Commit (si hubo ajustes)** — si la suite requirio fixes, commitear; si no, no hay commit.

---

## Self-Review

**Spec coverage:**
- Server actions solo encolan + rollback -> Task 5. Payload autocontenido -> Task 1 (+ uso en Task 5).
- Handler nano-banana (submit=Nano, poll=expand) -> Task 3. Timeout del expand a ~50s -> Task 2.
- Finalize persiste `metadata` (thought_signature/safe_base_path) -> usa `finalizeGeneration` existente (documentado en Global Constraints); handler retorna `metadata`. Post-step promote+campaign_item -> Task 4.
- Cliente Realtime (setAuth, done/failed) -> Task 6. Reconciliacion -> Task 6 Step 2e (marcada YAGNI si el server ya renderiza estado).
- Errores/creditos: reserve en action, confirm/refund en worker, rollback de encolado -> Tasks 5; moderacion/timeout como `fail` -> Task 3 + worker existente.
- Tests sin APIs reales (mocks) -> Tasks 1-4; smoke del usuario -> Task 7.
- Sin migracion -> ningun task la agrega. Correcto.

**Placeholder scan:** sin TBD/TODO; cada paso de codigo lleva el codigo. Los puntos "confirmar la ruta de X" son verificaciones de import, no placeholders de logica.

**Type consistency:** `StoryboardJobPayload` (Task 1) consumido identico en Task 3 (handler) y Task 5 (actions). `extendPanelTo916` firma `(base:{buffer,mimeType})` consistente Task 2 -> Task 3. `JobResult`/`GenerationRow` verbatim del repo. `loadPreviousPanelRef` devuelve `{imagePath,prompt,thoughtSignature?}` usado en Task 5. `buildStoryboardJobPayload` args consistentes Task 1 <-> Task 5.

**Riesgos conocidos (verificar en ejecucion, no placeholders):**
- Ubicacion real de `inferExtension`, `NANO_VARIANT`, `nanoVariantToResolution`, `NANO_MODEL_SLUG` y de la prop `campaignId` en StoryboardView: anclar por contenido al implementar.
- La publicacion Realtime de Supabase debe incluir `generations` (ya la escuchan otros hooks -> asumido activo).
- `NanoBananaParams.model` es un union; castear `gen.model_id` al tipo del provider (el handler ya lo hace).
