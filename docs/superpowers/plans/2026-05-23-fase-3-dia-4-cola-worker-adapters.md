# Fase 3 — Día 4: Cola, Worker y Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the QStash queue infrastructure + worker + 3 provider adapters (ElevenLabs TTS, Kling video, Veo video) end-to-end so the user can generate audio and video from `/app/create/audio` and `/app/create/video` with credits debited/refunded atomically through the worker.

**Architecture:** Single `/api/jobs/process` endpoint with internal dispatch table by provider. Each provider has a thin HTTP client in `lib/providers/` + a worker handler in `lib/jobs/handlers/`. ElevenLabs TTS is synchronous within the 60s worker timeout; Kling and Veo use recursive polling (worker re-enqueues itself with delays). All providers funnel through the shared `lib/jobs/finalize.ts` which downloads → uploads to Supabase Storage → generates thumbnail → calls `complete_generation` RPC.

**Tech Stack:** Next.js 15 + Supabase (Postgres + Storage + Realtime) + Upstash QStash + `@ffmpeg-installer/ffmpeg` + Vitest + MSW. pnpm for all package management. No `npm`.

**Reference spec:** `docs/superpowers/specs/2026-05-23-fase-3-video-audio-jobs-design.md`. When in doubt about scope or behavior, the spec is the source of truth.

**Critical project conventions (read these once):**
- `CLAUDE.md` — overall guide
- `.cursor/rules/40-worker.mdc` — worker patterns (signature verify, idempotency, re-enqueue)
- `.cursor/rules/30-providers.mdc` — adapter conventions (URLs never reach client)
- `.cursor/rules/60-credits.mdc` — only via SQL functions, atomic
- `.cursor/rules/90-commits.mdc` — commit conventions (NO `Co-Authored-By` trailer)

---

## Task 0: Setup Vitest + MSW

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Modify: `package.json` (add test scripts + dev deps)
- Create: `lib/providers/elevenlabs.test.ts` (smoke test to verify the harness works)

- [ ] **Step 1: Install vitest + MSW + jsdom**

Run:
```powershell
pnpm add -D vitest @vitest/coverage-v8 msw@^2 jsdom
```

Expected: `package.json` updated, `pnpm-lock.yaml` updated, no install errors.

- [ ] **Step 2: Create `vitest.config.ts`**

Create file `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'tests/integration/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

- [ ] **Step 3: Create `tests/setup.ts`**

Create file `tests/setup.ts`:
```typescript
// Setup compartido para tests unitarios. Las variables de entorno reales
// no se cargan aquí; cada test que necesite env vars las debe mockear o
// la función bajo test debe permitir inyección.
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});
```

- [ ] **Step 4: Add test scripts to `package.json`**

Modify `package.json` scripts section. Add after the `typecheck` line:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 5: Write a smoke test to verify the harness**

Create `lib/providers/elevenlabs.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs', () => {
    expect(2 + 2).toBe(4);
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `pnpm test`
Expected: 1 test passes, no errors.

- [ ] **Step 7: Commit**

```powershell
git add vitest.config.ts tests/setup.ts package.json pnpm-lock.yaml lib/providers/elevenlabs.test.ts
git commit -m "chore(tests): setup vitest + msw + jsdom"
```

---

## Task 1: DB Migration 013 (buckets, pricing, cleanup RPC)

**Files:**
- Create: `supabase/migrations/013_video_audio_jobs.sql`

The migration must be **applied via MCP** at the end. Do NOT push the SQL file to remote without applying it first; otherwise drift between repo and DB.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/013_video_audio_jobs.sql`:
```sql
-- 013_video_audio_jobs.sql
-- Fase 3 — bucket de voice samples, pricing seed para video/audio,
-- y RPC cleanup_old_data para el schedule diario.

-- ============ STORAGE BUCKET para muestras de voz ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-samples',
  'voice-samples',
  false,
  50 * 1024 * 1024,
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/webm','audio/ogg']
)
on conflict (id) do nothing;

-- Policies: solo owner accede a sus samples (path prefijo = auth.uid())
drop policy if exists "voice_samples_owner_select" on storage.objects;
drop policy if exists "voice_samples_owner_insert" on storage.objects;
drop policy if exists "voice_samples_owner_delete" on storage.objects;

create policy "voice_samples_owner_select" on storage.objects
  for select using (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice_samples_owner_insert" on storage.objects
  for insert with check (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "voice_samples_owner_delete" on storage.objects
  for delete using (
    bucket_id = 'voice-samples'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============ PRICING video/audio ============
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('veo',        'veo-3.1-fast-generate-preview',  '1080p',    150, 1,    'segundo'),
  ('veo',        'veo-3.1-generate-preview',       '1080p',    300, 1,    'segundo'),
  ('veo',        'veo-3.1-lite-generate-preview',  '1080p',     80, 1,    'segundo'),
  -- Kling via fal.ai (klingapi.com no disponible). Model IDs son los slugs de fal.ai.
  ('kling',      'fal-ai/kling-video/v2.6/standard/text-to-video', 'standard', 200, 5,  'video'),
  ('kling',      'fal-ai/kling-video/v2.6/standard/text-to-video', 'long',     400, 10, 'video'),
  ('kling',      'fal-ai/kling-video/v2.6/pro/text-to-video',      'pro',      400, 5,  'video'),
  ('elevenlabs', 'eleven_multilingual_v2',         'default',   30, 1000, 'chars'),
  ('elevenlabs', 'eleven_flash_v2_5',              'default',   15, 1000, 'chars'),
  ('elevenlabs', 'eleven_v3',                      'default',   50, 1000, 'chars'),
  ('elevenlabs', 'sound_generation',               'default',   25, 1,    'efecto'),
  ('elevenlabs', 'voice_clone',                    'default',  200, 1,    'voz')
on conflict (provider, model_id, variant) do nothing;

-- ============ RPC cleanup_old_data ============
create or replace function cleanup_old_data() returns jsonb as $$
declare
  v_gens_deleted bigint;
  v_refs_deleted bigint;
  v_notif_deleted bigint;
begin
  delete from generations
    where status in ('failed','canceled')
      and created_at < now() - interval '7 days';
  get diagnostics v_gens_deleted = row_count;

  delete from media_references
    where source = 'generation'
      and source_generation_id is null
      and created_at < now() - interval '24 hours';
  get diagnostics v_refs_deleted = row_count;

  delete from notifications
    where read_at is not null
      and created_at < now() - interval '30 days';
  get diagnostics v_notif_deleted = row_count;

  return jsonb_build_object(
    'generations_deleted', v_gens_deleted,
    'references_deleted', v_refs_deleted,
    'notifications_deleted', v_notif_deleted
  );
end;
$$ language plpgsql security definer set search_path = public, pg_catalog;

revoke execute on function cleanup_old_data() from public, anon, authenticated;
```

- [ ] **Step 2: Apply migration via MCP Supabase**

Call the MCP tool `mcp__plugin_supabase_supabase__apply_migration` with:
- `project_id`: `eqfekbptucpfnjurpegs`
- `name`: `013_video_audio_jobs`
- `query`: full contents of the SQL file from step 1

Expected: `{"success": true}`.

- [ ] **Step 3: Verify the migration via MCP execute_sql**

Call `mcp__plugin_supabase_supabase__execute_sql` with project `eqfekbptucpfnjurpegs`:
```sql
select
  (select id from storage.buckets where id = 'voice-samples') as bucket_ok,
  (select count(*) from model_pricing where provider in ('veo','kling','elevenlabs')) as pricing_count,
  (select proname from pg_proc where proname = 'cleanup_old_data') as rpc_exists;
```

Expected: `bucket_ok = 'voice-samples'`, `pricing_count = 11`, `rpc_exists = 'cleanup_old_data'`.

- [ ] **Step 4: Commit**

```powershell
git add supabase/migrations/013_video_audio_jobs.sql
git commit -m "db(fase-3): bucket voice-samples, pricing video/audio, cleanup_old_data RPC"
```

---

## Task 2: QStash client + receiver

**Files:**
- Create: `lib/jobs/queue.ts`
- Create: `lib/jobs/receiver.ts`
- Create: `lib/jobs/queue.test.ts`
- Modify: `.env.example` (add QSTASH vars)

- [ ] **Step 1: Verify `@upstash/qstash` is already installed**

Run: `pnpm list @upstash/qstash`
Expected: shows version 2.8.4 or higher (already in `package.json`).

- [ ] **Step 2: Create `lib/jobs/queue.ts`**

Create file:
```typescript
import 'server-only';
import { Client } from '@upstash/qstash';

// Cliente QStash compartido para encolar jobs. Solo se usa server-side.
// El token nunca llega al cliente.
let _client: Client | null = null;

function getClient(): Client {
  if (_client) return _client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN no configurada');
  _client = new Client({ token });
  return _client;
}

export type EnqueueJobInput = {
  generationId: string;
  action: 'submit' | 'poll';
  delaySeconds?: number;
};

// Encola un mensaje POST al worker /api/jobs/process. El worker se re-encola
// a sí mismo con `delaySeconds` cuando necesita polling adicional.
//
// PUBLIC_URL DEBE estar configurada (la URL externa del deploy o ngrok local).
// QStash necesita un endpoint HTTPS accesible desde su backend.
export async function enqueueJob(input: EnqueueJobInput): Promise<{ messageId: string }> {
  const baseUrl = process.env.PUBLIC_URL;
  if (!baseUrl) throw new Error('PUBLIC_URL no configurada');
  const client = getClient();
  const res = await client.publishJSON({
    url: `${baseUrl}/api/jobs/process`,
    body: { generationId: input.generationId, action: input.action },
    delay: input.delaySeconds ?? 0,
    retries: 3,
  });
  return { messageId: res.messageId };
}
```

- [ ] **Step 3: Create `lib/jobs/receiver.ts`**

Create file:
```typescript
import 'server-only';
import { Receiver } from '@upstash/qstash';

// Singleton del Receiver para verificar firmas de QStash. Las dos signing keys
// (current + next) son necesarias durante rotación de keys.
let _receiver: Receiver | null = null;

function getReceiver(): Receiver {
  if (_receiver) return _receiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error('QSTASH_CURRENT_SIGNING_KEY o QSTASH_NEXT_SIGNING_KEY no configuradas');
  }
  _receiver = new Receiver({ currentSigningKey, nextSigningKey });
  return _receiver;
}

// Verifica la firma del request entrante. Lanza si es inválida.
// Recibe el body raw como string (no parseado), tal cual viene del request.
export async function verifyQStashSignature(params: {
  signature: string;
  body: string;
  url: string;
}): Promise<void> {
  const receiver = getReceiver();
  const isValid = await receiver.verify({
    signature: params.signature,
    body: params.body,
    url: params.url,
  });
  if (!isValid) throw new Error('Firma QStash inválida');
}
```

- [ ] **Step 4: Write test for `enqueueJob` env var guards**

Create `lib/jobs/queue.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('enqueueJob env guards', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws when QSTASH_TOKEN is missing', async () => {
    vi.stubEnv('QSTASH_TOKEN', '');
    vi.stubEnv('PUBLIC_URL', 'https://example.com');
    const { enqueueJob } = await import('./queue');
    await expect(
      enqueueJob({ generationId: 'gen-1', action: 'submit' }),
    ).rejects.toThrow(/QSTASH_TOKEN/);
  });

  it('throws when PUBLIC_URL is missing', async () => {
    vi.stubEnv('QSTASH_TOKEN', 'fake-token');
    vi.stubEnv('PUBLIC_URL', '');
    const { enqueueJob } = await import('./queue');
    await expect(
      enqueueJob({ generationId: 'gen-1', action: 'submit' }),
    ).rejects.toThrow(/PUBLIC_URL/);
  });
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test`
Expected: previous test + 2 new tests pass (3 total).

- [ ] **Step 6: Update `.env.example`**

Add to `.env.example` (append at the end):
```bash
# QStash (Upstash) — cola de jobs para video/audio
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
# URL pública del deploy (Vercel preview/prod o ngrok local).
# QStash necesita un endpoint HTTPS accesible desde su backend.
PUBLIC_URL=
```

- [ ] **Step 7: Commit**

```powershell
git add lib/jobs/queue.ts lib/jobs/receiver.ts lib/jobs/queue.test.ts .env.example
git commit -m "feat(jobs): cliente QStash + receiver de firmas + env vars"
```

---

## Task 3: Worker shell with dispatch placeholder

**Files:**
- Create: `app/api/jobs/process/route.ts`
- Create: `lib/jobs/dispatch.ts`
- Create: `lib/jobs/handlers/types.ts`

- [ ] **Step 1: Create `lib/jobs/handlers/types.ts`**

```typescript
import 'server-only';

export type JobAction = 'submit' | 'poll';

// Resultado que un handler devuelve al worker. Discriminated union.
export type JobResult =
  | {
      kind: 'continue';
      taskId?: string;
      delaySeconds: number;
      providerPayload?: Record<string, unknown>;
    }
  | {
      kind: 'finalize';
      outputBuffer: Buffer;
      mimeType: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'fail';
      message: string;
      code: 'safety' | 'rate_limit' | 'timeout' | 'unknown';
    };

// Vista mínima de la fila generations que el handler necesita. Lo carga el
// worker con service_role antes de invocar al handler. Mantén esto sincronizado
// con el SELECT que hace el worker.
export type GenerationRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  type: 'video' | 'image' | 'audio';
  provider: 'veo' | 'kling' | 'elevenlabs' | 'nano-banana' | 'flux';
  model_id: string;
  prompt: string | null;
  params: Record<string, unknown>;
  reference_ids: string[];
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  provider_task_id: string | null;
  provider_payload: Record<string, unknown> | null;
  poll_attempts: number;
  timeout_at: string | null;
  cancel_requested: boolean;
  credits_estimated: number;
};

export interface JobHandler {
  handle(gen: GenerationRow, action: JobAction): Promise<JobResult>;
  // Opcional. Solo Kling lo expone (Veo no tiene cancel remoto).
  cancel?(gen: GenerationRow): Promise<void>;
}
```

- [ ] **Step 2: Create `lib/jobs/dispatch.ts` with placeholder handlers**

```typescript
import 'server-only';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './handlers/types';

// Map provider → handler. Cada handler vive en lib/jobs/handlers/<provider>.ts.
// Por ahora son placeholders que devuelven fail; se llenan en tareas posteriores.
const handlers: Partial<Record<GenerationRow['provider'], JobHandler>> = {};

export function registerHandler(provider: GenerationRow['provider'], handler: JobHandler): void {
  handlers[provider] = handler;
}

export async function dispatchJob(
  gen: GenerationRow,
  action: JobAction,
): Promise<JobResult> {
  const handler = handlers[gen.provider];
  if (!handler) {
    return {
      kind: 'fail',
      message: `provider ${gen.provider} no soportado en el worker`,
      code: 'unknown',
    };
  }
  return handler.handle(gen, action);
}

export async function dispatchCancel(gen: GenerationRow): Promise<void> {
  const handler = handlers[gen.provider];
  if (!handler?.cancel) return; // no-op para providers sin cancel remoto
  await handler.cancel(gen);
}
```

- [ ] **Step 3: Create `app/api/jobs/process/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyQStashSignature } from '@/lib/jobs/receiver';
import { createAdminClient } from '@/lib/supabase/admin';
import { dispatchJob, dispatchCancel } from '@/lib/jobs/dispatch';
import { enqueueJob } from '@/lib/jobs/queue';
import { failGeneration } from '@/lib/credits/operations';
import type { GenerationRow } from '@/lib/jobs/handlers/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  generationId: z.string().uuid(),
  action: z.enum(['submit', 'poll']),
});

const TERMINAL_STATUSES = new Set(['done', 'failed', 'canceled']);

export async function POST(req: Request) {
  // 1. Verificar firma ANTES de leer el body como JSON
  const rawBody = await req.text();
  const signature = req.headers.get('upstash-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 401 });
  }
  try {
    await verifyQStashSignature({
      signature,
      body: rawBody,
      url: req.url,
    });
  } catch (err) {
    console.error('[worker] firma inválida', err);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // 2. Parsear body
  let parsed;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch (err) {
    console.error('[worker] body inválido', err);
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { generationId, action } = parsed;

  // 3. Cargar generation con service_role
  const admin = createAdminClient();
  const { data: gen, error: loadErr } = await admin
    .from('generations')
    .select(
      'id, user_id, workspace_id, type, provider, model_id, prompt, params, reference_ids, status, provider_task_id, provider_payload, poll_attempts, timeout_at, cancel_requested, credits_estimated',
    )
    .eq('id', generationId)
    .single();
  if (loadErr || !gen) {
    // Row borrada (cleanup, etc.) → ack y exit. No error para QStash.
    console.warn('[worker] gen no encontrada', { generationId });
    return NextResponse.json({ ok: true, ack: 'not_found' });
  }
  const generation = gen as unknown as GenerationRow;

  // 4. Guard: status terminal → ack
  if (TERMINAL_STATUSES.has(generation.status)) {
    return NextResponse.json({ ok: true, ack: 'terminal' });
  }

  // 5. Guard: cancel_requested o timeout
  const timedOut =
    generation.timeout_at !== null && new Date(generation.timeout_at) < new Date();
  if (generation.cancel_requested || timedOut) {
    try {
      await dispatchCancel(generation);
    } catch (err) {
      console.error('[worker] cancel adapter falló', { generationId, err });
    }
    const reason = generation.cancel_requested ? 'canceled by user' : 'timeout';
    try {
      await failGeneration(
        generation.user_id,
        generation.id,
        generation.credits_estimated,
        reason,
      );
    } catch (err) {
      console.error('[worker] fail_generation falló', { generationId, err });
    }
    // Update final status explícito
    await admin
      .from('generations')
      .update({
        status: generation.cancel_requested ? 'canceled' : 'failed',
        error_message: reason,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generation.id);
    return NextResponse.json({ ok: true, ack: reason });
  }

  // 6. Dispatch al handler del provider
  const result = await dispatchJob(generation, action);

  // 7. Procesar resultado
  if (result.kind === 'continue') {
    // Re-encolar para el próximo poll
    const update: Record<string, unknown> = {
      status: 'processing',
      poll_attempts: generation.poll_attempts + 1,
    };
    if (result.taskId && !generation.provider_task_id) {
      update.provider_task_id = result.taskId;
    }
    if (result.providerPayload) {
      update.provider_payload = {
        ...(generation.provider_payload ?? {}),
        ...result.providerPayload,
      };
    }
    await admin.from('generations').update(update).eq('id', generation.id);
    await enqueueJob({
      generationId: generation.id,
      action: 'poll',
      delaySeconds: result.delaySeconds,
    });
    return NextResponse.json({ ok: true, ack: 'continue' });
  }

  if (result.kind === 'fail') {
    try {
      await failGeneration(
        generation.user_id,
        generation.id,
        generation.credits_estimated,
        result.message,
      );
    } catch (err) {
      console.error('[worker] fail_generation falló', { generationId, err });
    }
    await admin
      .from('generations')
      .update({
        status: 'failed',
        error_message: result.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generation.id);
    return NextResponse.json({ ok: true, ack: 'failed' });
  }

  // result.kind === 'finalize' — handler entregó el buffer
  // El paso de upload + thumbnail + complete_generation se delega a finalize.ts
  // que se implementa en Task 4.
  return NextResponse.json(
    { ok: false, error: 'finalize not implemented yet' },
    { status: 501 },
  );
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors (puede haber warning de imports unused — los conectamos en Task 4).

- [ ] **Step 5: Commit**

```powershell
git add lib/jobs/handlers/types.ts lib/jobs/dispatch.ts app/api/jobs/process/route.ts
git commit -m "feat(jobs): worker shell + dispatch + JobHandler interface"
```

---

## Task 4: Finalize.ts (sin FFmpeg todavía) + wire into worker

**Files:**
- Create: `lib/jobs/finalize.ts`
- Modify: `app/api/jobs/process/route.ts` (wire `finalize` para reemplazar el 501)

- [ ] **Step 1: Create `lib/jobs/finalize.ts`**

```typescript
import 'server-only';
import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import { uploadOutput, uploadThumbnail } from '@/lib/supabase/storage';
import { completeGeneration } from '@/lib/credits/operations';
import type { GenerationRow } from './handlers/types';

function inferExtension(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

async function makeImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

// Para video, devuelve null por ahora (Task 8 agrega FFmpeg).
// Audio siempre devuelve null (no hay thumbnail visual).
async function makeThumbnail(
  type: GenerationRow['type'],
  buffer: Buffer,
  _mimeType: string,
): Promise<Buffer | null> {
  if (type === 'image') return makeImageThumbnail(buffer);
  return null;
}

export async function finalizeGeneration(params: {
  gen: GenerationRow;
  outputBuffer: Buffer;
  mimeType: string;
  processingMs: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { gen, outputBuffer, mimeType, processingMs, metadata } = params;
  const ext = inferExtension(mimeType);

  const outputPath = await uploadOutput(
    gen.workspace_id,
    gen.id,
    outputBuffer,
    mimeType,
    ext,
  );

  const thumbBuffer = await makeThumbnail(gen.type, outputBuffer, mimeType);
  const thumbPath = thumbBuffer
    ? await uploadThumbnail(gen.workspace_id, gen.id, thumbBuffer)
    : null;

  await completeGeneration({
    userId: gen.user_id,
    generationId: gen.id,
    cost: gen.credits_estimated,
    outputUrl: outputPath,
    thumbnailUrl: thumbPath ?? '',
    processingMs,
    fileSizeBytes: outputBuffer.byteLength,
    providerPayload: metadata ?? null,
  });

  revalidatePath('/app/library');
  revalidatePath('/app/create/video');
  revalidatePath('/app/create/audio');
}
```

- [ ] **Step 2: Wire `finalize` into the worker**

Edit `app/api/jobs/process/route.ts`. Replace the lines after the `result.kind === 'fail'` block (the `// result.kind === 'finalize'` placeholder block) with:

```typescript
  // result.kind === 'finalize' — handler entregó el buffer
  const startedAt = generation.provider_payload?._started_at as number | undefined;
  const processingMs = startedAt ? Date.now() - startedAt : 0;
  try {
    await finalizeGeneration({
      gen: generation,
      outputBuffer: result.outputBuffer,
      mimeType: result.mimeType,
      processingMs,
      metadata: result.metadata,
    });
    return NextResponse.json({ ok: true, ack: 'finalized' });
  } catch (err) {
    console.error('[worker] finalize falló', { generationId, err });
    // Si finalize falla, marcar la generación failed pero NO refundear el cost
    // (la imagen/video ya fue generada y consumida del provider). El usuario
    // pagó por un output que no logramos servir. Operacionalmente: log + alert
    // manual; en una fase futura se podría reintentar el upload.
    await admin
      .from('generations')
      .update({
        status: 'failed',
        error_message: `finalize failed: ${(err as Error).message}`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', generation.id);
    return NextResponse.json({ ok: false, error: 'finalize failed' }, { status: 500 });
  }
}
```

Also add the import at the top of the file (after the existing imports):
```typescript
import { finalizeGeneration } from '@/lib/jobs/finalize';
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```powershell
git add lib/jobs/finalize.ts app/api/jobs/process/route.ts
git commit -m "feat(jobs): finalize (upload + thumbnail image + complete_generation) + wire worker"
```

---

## Task 5: ElevenLabs provider (cliente HTTP + chunking con TDD)

**Files:**
- Create: `lib/providers/elevenlabs.ts`
- Replace: `lib/providers/elevenlabs.test.ts` (smoke test → unit tests reales)

**Reference:** `docs/modelos/05-elevenlabs.md` para endpoints y parámetros.

- [ ] **Step 1: Write failing tests for `chunkText` (helper interno expuesto solo para test)**

Replace `lib/providers/elevenlabs.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { chunkText } from './elevenlabs';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const chunks = chunkText('Hola mundo.', 4000, 3000);
    expect(chunks).toEqual(['Hola mundo.']);
  });

  it('returns single chunk when at threshold', () => {
    const text = 'a'.repeat(4000);
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks).toEqual([text]);
  });

  it('splits long text by sentences when over threshold', () => {
    const sentence = 'Una frase de cuarenta caracteres exactos. ';
    const text = sentence.repeat(200); // > 4000 chars
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    // Cada chunk no debe exceder el cap
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3000);
    // Concatenando recuperamos algo equivalente al input (sin trims agresivos)
    expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(
      text.replace(/\s+/g, ' ').trim(),
    );
  });

  it('handles text without sentence punctuation by hard-splitting at cap', () => {
    const text = 'palabra '.repeat(1000); // ~8000 chars, sin puntos
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(3000);
  });

  it('preserves Spanish characters and emoji', () => {
    const text = '¡Hola! ¿Cómo estás? 🎉 ' + 'a'.repeat(5000);
    const chunks = chunkText(text, 4000, 3000);
    expect(chunks[0]).toContain('¡Hola!');
    expect(chunks[0]).toContain('🎉');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: 5 new tests FAIL (chunkText not exported yet) + previous tests still pass.

- [ ] **Step 3: Create `lib/providers/elevenlabs.ts` with minimal exports to make tests pass**

```typescript
import 'server-only';
import { ProviderError } from './types';

const BASE_URL = 'https://api.elevenlabs.io';

export type ElevenLabsModel = 'eleven_multilingual_v2' | 'eleven_flash_v2_5' | 'eleven_v3';

export type VoiceSettings = {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
};

// Split text en chunks para TTS largos. Estrategia:
// 1. Si text.length <= threshold → un solo chunk
// 2. Si no → dividir por frases (regex de puntuación seguida de espacio)
// 3. Acumular frases hasta que el chunk se acerque al cap, después romper
// 4. Si una "frase" sola excede el cap (texto sin puntuación), hard-split por chars
//
// `chunkCap` es el máximo absoluto por chunk; `threshold` decide cuándo activar
// el split. Default: threshold=4000, cap=3000 (cap < threshold porque después
// del primer split queremos chunks que claramente quepan).
export function chunkText(
  text: string,
  threshold: number,
  chunkCap: number,
): string[] {
  if (text.length <= threshold) return [text];

  // Dividir por frases preservando el delimitador
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [text];

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    // Si la frase sola excede el cap, hard-split
    if (sentence.length > chunkCap) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < sentence.length; i += chunkCap) {
        chunks.push(sentence.slice(i, i + chunkCap));
      }
      continue;
    }
    // Si agregar la frase excede el cap, empezar nuevo chunk
    if (current.length + sentence.length > chunkCap) {
      chunks.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// TTS — devuelve buffer MP3. Si text > 4000 chars hace chunking + concat raw.
export async function tts(params: {
  text: string;
  voiceId: string;
  modelId: ElevenLabsModel;
  voiceSettings?: VoiceSettings;
  languageCode?: string;
}): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new ProviderError('ELEVENLABS_API_KEY no configurada', 'auth', false);

  const chunks = chunkText(params.text, 4000, 3000);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const buf = await ttsChunk({ ...params, text: chunk }, apiKey);
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

async function ttsChunk(
  params: {
    text: string;
    voiceId: string;
    modelId: ElevenLabsModel;
    voiceSettings?: VoiceSettings;
    languageCode?: string;
  },
  apiKey: string,
): Promise<Buffer> {
  const body: Record<string, unknown> = {
    text: params.text,
    model_id: params.modelId,
    output_format: 'mp3_44100_128',
  };
  if (params.voiceSettings) body.voice_settings = params.voiceSettings;
  if (params.languageCode) body.language_code = params.languageCode;

  const res = await fetch(`${BASE_URL}/v1/text-to-speech/${params.voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con ElevenLabs', 'auth', false);
  }
  if (res.status === 429) {
    throw new ProviderError('Rate limit ElevenLabs', 'rate_limit', true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `ElevenLabs TTS ${res.status}: ${text.slice(0, 200)}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
```

- [ ] **Step 4: Run tests again**

Run: `pnpm test`
Expected: all tests PASS (chunkText + previous).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```powershell
git add lib/providers/elevenlabs.ts lib/providers/elevenlabs.test.ts
git commit -m "feat(providers): ElevenLabs TTS adapter + chunkText helper con tests"
```

---

## Task 6: ElevenLabs handler

**Files:**
- Create: `lib/jobs/handlers/elevenlabs.ts`
- Create: `lib/jobs/handlers/register.ts` (registra todos los handlers en el dispatcher)
- Modify: `app/api/jobs/process/route.ts` (importar `register.ts` para que los handlers se registren al cargar)

- [ ] **Step 1: Create the handler**

Create `lib/jobs/handlers/elevenlabs.ts`:
```typescript
import 'server-only';
import { tts, type ElevenLabsModel, type VoiceSettings } from '@/lib/providers/elevenlabs';
import { ProviderError } from '@/lib/providers/types';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';

// Params que el server action serializa dentro de generations.params para TTS.
type TtsParams = {
  voiceId: string;
  voiceSettings?: VoiceSettings;
  languageCode?: string;
};

function isTtsModel(modelId: string): modelId is ElevenLabsModel {
  return (
    modelId === 'eleven_multilingual_v2' ||
    modelId === 'eleven_flash_v2_5' ||
    modelId === 'eleven_v3'
  );
}

export const elevenLabsHandler: JobHandler = {
  async handle(gen: GenerationRow, _action: JobAction): Promise<JobResult> {
    if (gen.type !== 'audio') {
      return {
        kind: 'fail',
        message: `ElevenLabs handler recibió type=${gen.type}, esperaba audio`,
        code: 'unknown',
      };
    }
    if (!isTtsModel(gen.model_id)) {
      // Sound effect lo agregaremos en Día 5. Voice clone va por server action
      // directo, no por la cola.
      return {
        kind: 'fail',
        message: `model_id ${gen.model_id} no soportado en handler ElevenLabs todavía`,
        code: 'unknown',
      };
    }
    if (!gen.prompt) {
      return { kind: 'fail', message: 'prompt vacío', code: 'unknown' };
    }
    const params = gen.params as TtsParams;
    if (!params.voiceId) {
      return { kind: 'fail', message: 'voiceId faltante en params', code: 'unknown' };
    }
    try {
      const buffer = await tts({
        text: gen.prompt,
        voiceId: params.voiceId,
        modelId: gen.model_id,
        voiceSettings: params.voiceSettings,
        languageCode: params.languageCode,
      });
      return { kind: 'finalize', outputBuffer: buffer, mimeType: 'audio/mpeg' };
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          kind: 'fail',
          message: err.message,
          code:
            err.code === 'safety'
              ? 'safety'
              : err.code === 'rate_limit'
                ? 'rate_limit'
                : err.code === 'timeout'
                  ? 'timeout'
                  : 'unknown',
        };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
};
```

- [ ] **Step 2: Create `lib/jobs/handlers/register.ts`**

```typescript
import 'server-only';
import { registerHandler } from '@/lib/jobs/dispatch';
import { elevenLabsHandler } from './elevenlabs';

// Side-effect: registra todos los handlers en el dispatcher. Importar este
// archivo (desde el worker route) garantiza que los handlers estén disponibles
// antes de la primera llamada a dispatchJob.
//
// Agregar nuevos providers aquí conforme se implementen (Kling, Veo).
registerHandler('elevenlabs', elevenLabsHandler);
```

- [ ] **Step 3: Importar `register.ts` desde el worker**

Edit `app/api/jobs/process/route.ts`. Add this import after the existing imports:
```typescript
import '@/lib/jobs/handlers/register'; // side-effect: registra handlers
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```powershell
git add lib/jobs/handlers/elevenlabs.ts lib/jobs/handlers/register.ts app/api/jobs/process/route.ts
git commit -m "feat(jobs): handler de ElevenLabs TTS + registro central de handlers"
```

---

## Task 7: submitAudioGenerationAction + AudioGenerator UI (tab TTS)

**Files:**
- Create: `lib/schemas/audio.ts`
- Modify: `server-actions/generations.ts` (agregar `submitAudioGenerationAction`)
- Create: `components/generation/AudioGenerator.tsx`
- Create: `components/generation/AudioControlsPanel.tsx`
- Create: `components/generation/AudioPreview.tsx`
- Create: `components/generation/use-generation-status.ts`
- Create: `app/app/create/audio/page.tsx`

**Voces oficiales para el dropdown** (hardcoded por ahora; tomadas de las voces públicas de ElevenLabs):
- `21m00Tcm4TlvDq8ikWAM` - Rachel (en)
- `EXAVITQu4vr4xnSDxMaL` - Bella (en)
- `pNInz6obpgDQGcFmaJgB` - Adam (en)
- `XB0fDUnXU5powFXDhCwa` - Charlotte (en, multilingual)
- `IKne3meq5aSn9XLyUdCD` - Charlie (en, multilingual)
- `nPczCjzI2devNBz1zQrb` - Brian (en, multilingual)

- [ ] **Step 1: Create `lib/schemas/audio.ts`**

```typescript
import { z } from 'zod';

export const TTS_MODELS = ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_v3'] as const;
export const TTS_LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'zh'] as const;

export const VoiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1),
  similarity_boost: z.number().min(0).max(1),
  style: z.number().min(0).max(1).optional(),
  use_speaker_boost: z.boolean().optional(),
});

export const SubmitTtsSchema = z.object({
  kind: z.literal('tts'),
  voiceId: z.string().min(1),
  modelId: z.enum(TTS_MODELS),
  text: z.string().trim().min(1, 'texto vacío').max(20000, 'texto muy largo (max 20k chars)'),
  voiceSettings: VoiceSettingsSchema,
  languageCode: z.enum(TTS_LANGUAGES).optional(),
});

export type SubmitTtsInput = z.infer<typeof SubmitTtsSchema>;
```

- [ ] **Step 2: Add `submitAudioGenerationAction` to `server-actions/generations.ts`**

Append at the end of `server-actions/generations.ts` (after the closing of `submitGenerationAction`):

```typescript
import { SubmitTtsSchema, type SubmitTtsInput } from '@/lib/schemas/audio';
import { enqueueJob } from '@/lib/jobs/queue';

function estimateTtsCost(
  pricing: Awaited<ReturnType<typeof loadPricing>>,
  modelId: SubmitTtsInput['modelId'],
  chars: number,
): number {
  const row = pricing.find(
    (p) => p.provider === 'elevenlabs' && p.model_id === modelId && p.variant === 'default',
  );
  if (!row) throw new Error(`pricing no encontrado para ${modelId}`);
  // unit_size = 1000 chars; cost = ceil(chars / 1000) * credits_cost
  const units = Math.max(1, Math.ceil(chars / row.unit_size!));
  return units * Number(row.credits_cost);
}

export async function submitAudioGenerationAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = SubmitTtsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { user, workspace } = await requireWorkspace();

  const pricing = await loadPricing();
  const cost = estimateTtsCost(pricing, data.modelId, data.text.length);

  const supabase = await createClient();
  const insertParams = {
    voiceId: data.voiceId,
    voiceSettings: data.voiceSettings,
    languageCode: data.languageCode,
    chars: data.text.length,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'audio',
      provider: 'elevenlabs',
      model_id: data.modelId,
      prompt: data.text,
      params: insertParams,
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    return {
      ok: false,
      error: 'internal_error',
      message: insertErr?.message ?? 'no row',
    };
  }
  const generationId = inserted.id as string;

  // Reservar créditos
  const reserved = await reserveCredits(user.id, cost, generationId);
  if (!reserved) {
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    return { ok: false, error: 'insufficient_credits' };
  }

  // Encolar en QStash
  try {
    await enqueueJob({ generationId, action: 'submit' });
  } catch (err) {
    // Si encolar falla, refund + delete
    await failGeneration(user.id, generationId, cost, 'queue_failed').catch(() => {});
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    const message = (err as Error)?.message ?? 'queue error';
    return {
      ok: false,
      error: message.includes('429') ? 'provider_error' : 'internal_error',
      message,
    };
  }

  revalidatePath('/app/library');
  return { ok: true, data: { generationId } };
}
```

Also update the imports at the top of `server-actions/generations.ts` to include `failGeneration` if not already:
```typescript
import {
  completeGeneration,
  failGeneration,
  reserveCredits,
} from '@/lib/credits/operations';
```
(should already be there from Fase 2 — verify.)

- [ ] **Step 3: Create `components/generation/use-generation-status.ts`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type GenerationStatus = 'queued' | 'processing' | 'done' | 'failed' | 'canceled';

export type LiveGeneration = {
  status: GenerationStatus;
  errorMessage: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
  creditsCharged: number | null;
};

// Suscribe a postgres_changes en la row específica de generations.
// La policy RLS de SELECT ya garantiza ownership.
export function useGenerationStatus(generationId: string | null): LiveGeneration | null {
  const [state, setState] = useState<LiveGeneration | null>(null);

  useEffect(() => {
    if (!generationId) {
      setState(null);
      return;
    }
    const supabase = createClient();
    let active = true;

    // Carga inicial
    supabase
      .from('generations')
      .select('status, error_message, output_url, thumbnail_url, credits_charged')
      .eq('id', generationId)
      .single()
      .then(({ data }) => {
        if (!active || !data) return;
        setState({
          status: data.status as GenerationStatus,
          errorMessage: data.error_message,
          outputUrl: data.output_url,
          thumbnailUrl: data.thumbnail_url,
          creditsCharged: data.credits_charged,
        });
      });

    // Realtime: setAuth explícito antes de subscribe (RLS lo necesita)
    const channel = supabase
      .channel(`generation:${generationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'generations',
          filter: `id=eq.${generationId}`,
        },
        (payload) => {
          if (!active) return;
          const r = payload.new as Record<string, unknown>;
          setState({
            status: r.status as GenerationStatus,
            errorMessage: (r.error_message as string | null) ?? null,
            outputUrl: (r.output_url as string | null) ?? null,
            thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
            creditsCharged: (r.credits_charged as number | null) ?? null,
          });
        },
      );

    // Patrón del repo: token freshness antes de subscribe
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe();
    });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [generationId]);

  return state;
}
```

- [ ] **Step 4: Create `components/generation/AudioControlsPanel.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TTS_LANGUAGES, TTS_MODELS } from '@/lib/schemas/audio';

export const OFFICIAL_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', lang: 'en' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', lang: 'en' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', lang: 'en' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', lang: 'multi' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', lang: 'multi' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', lang: 'multi' },
] as const;

export type AudioControlsProps = {
  text: string;
  setText: (v: string) => void;
  voiceId: string;
  setVoiceId: (v: string) => void;
  modelId: (typeof TTS_MODELS)[number];
  setModelId: (v: (typeof TTS_MODELS)[number]) => void;
  languageCode: (typeof TTS_LANGUAGES)[number];
  setLanguageCode: (v: (typeof TTS_LANGUAGES)[number]) => void;
  stability: number;
  setStability: (v: number) => void;
  similarityBoost: number;
  setSimilarityBoost: (v: number) => void;
  style: number;
  setStyle: (v: number) => void;
  cost: number;
  balance: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export function AudioControlsPanel(props: AudioControlsProps) {
  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto border-r border-border bg-card/30 p-5">
      <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
        Texto a voz
      </h2>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Voz
      </label>
      <select
        value={props.voiceId}
        onChange={(e) => props.setVoiceId(e.target.value)}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
      >
        {OFFICIAL_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Modelo
      </label>
      <select
        value={props.modelId}
        onChange={(e) => props.setModelId(e.target.value as (typeof TTS_MODELS)[number])}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
      >
        <option value="eleven_multilingual_v2">Multilingual v2 (alta calidad)</option>
        <option value="eleven_flash_v2_5">Flash v2.5 (rápido)</option>
        <option value="eleven_v3">V3 (expresivo)</option>
      </select>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Idioma (solo Multilingual)
      </label>
      <select
        value={props.languageCode}
        onChange={(e) => props.setLanguageCode(e.target.value as (typeof TTS_LANGUAGES)[number])}
        disabled={props.modelId !== 'eleven_multilingual_v2'}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none disabled:opacity-40"
      >
        {TTS_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <label className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Texto
      </label>
      <textarea
        value={props.text}
        onChange={(e) => props.setText(e.target.value.slice(0, 20000))}
        placeholder="Escribe el texto a sintetizar…"
        className="scroll-thin mt-1.5 min-h-[140px] resize-y rounded-md border border-border bg-background p-3 text-[13.5px] text-foreground outline-none"
      />
      <div className="mt-1 text-right font-mono text-[10.5px] text-muted-foreground/70">
        {props.text.length.toLocaleString('es-MX')} / 20 000
      </div>

      <SliderRow label="Stability" value={props.stability} onChange={props.setStability} />
      <SliderRow label="Similarity Boost" value={props.similarityBoost} onChange={props.setSimilarityBoost} />
      {props.modelId === 'eleven_v3' && (
        <SliderRow label="Style" value={props.style} onChange={props.setStyle} />
      )}

      <div className="mt-6 flex items-center justify-between text-[12.5px]">
        <span className="text-muted-foreground">Costo</span>
        <span className="font-mono text-foreground">−{props.cost} cr</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Saldo</span>
        <span className="font-mono text-muted-foreground">{props.balance} cr</span>
      </div>

      <button
        type="button"
        onClick={props.onGenerate}
        disabled={!props.canGenerate}
        className={cn(
          'mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md text-[13.5px] font-medium transition-colors',
          props.canGenerate
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'cursor-not-allowed bg-muted text-muted-foreground/60',
        )}
      >
        {props.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Generar audio
      </button>
    </div>
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full"
      />
    </div>
  );
}
```

- [ ] **Step 5: Create `components/generation/AudioPreview.tsx`**

```typescript
'use client';

import { Loader2, Music4 } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { cn } from '@/lib/utils';
import type { LiveGeneration } from './use-generation-status';

export function AudioPreview({
  generation,
  resolvedOutputUrl,
}: {
  generation: LiveGeneration | null;
  resolvedOutputUrl: string | null;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!resolvedOutputUrl || !generation) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(resolvedOutputUrl, `zyra-audio`);
    } catch (e) {
      toast.error(
        `No se pudo descargar${e instanceof Error ? `: ${e.message}` : ''}`,
      );
    } finally {
      setDownloading(false);
    }
  }

  if (!generation) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground/60">
        <div className="text-center">
          <Music4 className="mx-auto size-10" aria-hidden />
          <p className="mt-2 text-[13px]">Escribe un texto y genera tu primer audio</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'queued' || generation.status === 'processing') {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
          <p className="text-[13px]">Generando voz…</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'failed' || generation.status === 'canceled') {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-[13.5px] text-foreground">
            {generation.status === 'failed' ? 'No se pudo generar el audio' : 'Generación cancelada'}
          </p>
          {generation.errorMessage && (
            <p className="mt-1 font-mono text-[11.5px] text-muted-foreground/80">
              {generation.errorMessage}
            </p>
          )}
        </div>
      </div>
    );
  }

  // done
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      {resolvedOutputUrl ? (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={resolvedOutputUrl} className="w-full max-w-md" />
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12.5px]',
              downloading ? 'opacity-60' : 'hover:bg-muted',
            )}
          >
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : 'Descargar MP3'}
          </button>
        </>
      ) : (
        <p className="text-muted-foreground">Audio listo, cargando URL…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create `components/generation/AudioGenerator.tsx`**

```typescript
'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { submitAudioGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import type { PricingRow } from '@/lib/credits/types';
import { TTS_LANGUAGES, TTS_MODELS } from '@/lib/schemas/audio';
import { AudioControlsPanel, OFFICIAL_VOICES } from './AudioControlsPanel';
import { AudioPreview } from './AudioPreview';
import { useGenerationStatus } from './use-generation-status';

function calcCost(pricing: PricingRow[], modelId: (typeof TTS_MODELS)[number], chars: number): number {
  const row = pricing.find(
    (p) => p.provider === 'elevenlabs' && p.model_id === modelId && p.variant === 'default',
  );
  if (!row || !row.unit_size) return 0;
  const units = Math.max(1, Math.ceil(chars / row.unit_size));
  return units * Number(row.credits_cost);
}

export function AudioGenerator(props: {
  userId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState<string>(OFFICIAL_VOICES[0].id);
  const [modelId, setModelId] = useState<(typeof TTS_MODELS)[number]>('eleven_multilingual_v2');
  const [languageCode, setLanguageCode] = useState<(typeof TTS_LANGUAGES)[number]>('es');
  const [stability, setStability] = useState(0.5);
  const [similarityBoost, setSimilarityBoost] = useState(0.75);
  const [style, setStyle] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolvedOutputUrl, setResolvedOutputUrl] = useState<string | null>(null);

  const live = useGenerationStatus(activeId);

  const cost = useMemo(
    () => calcCost(props.pricing, modelId, text.length || 1),
    [props.pricing, modelId, text.length],
  );

  const canGenerate = text.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  function handleGenerate() {
    if (!canGenerate) return;
    startTransition(async () => {
      const res = await submitAudioGenerationAction({
        kind: 'tts',
        voiceId,
        modelId,
        text,
        voiceSettings: { stability, similarity_boost: similarityBoost, style },
        languageCode,
      });
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes'
            : res.message || 'No se pudo enviar el job',
        );
        return;
      }
      setActiveId(res.data.generationId);
      setResolvedOutputUrl(null);
    });
  }

  // Cuando llega 'done', resolver la signed URL desde el API route
  useEffect(() => {
    if (!live || live.status !== 'done' || !activeId) return;
    let active = true;
    fetch(`/api/generations/${activeId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string } | null) => {
        if (active && data?.outputUrl) setResolvedOutputUrl(data.outputUrl);
      });
    return () => {
      active = false;
    };
  }, [live?.status, activeId]);

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8 lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
      <AudioControlsPanel
        text={text}
        setText={setText}
        voiceId={voiceId}
        setVoiceId={setVoiceId}
        modelId={modelId}
        setModelId={setModelId}
        languageCode={languageCode}
        setLanguageCode={setLanguageCode}
        stability={stability}
        setStability={setStability}
        similarityBoost={similarityBoost}
        setSimilarityBoost={setSimilarityBoost}
        style={style}
        setStyle={setStyle}
        cost={cost}
        balance={balance}
        pending={pending}
        canGenerate={canGenerate}
        onGenerate={handleGenerate}
      />
      <AudioPreview generation={live} resolvedOutputUrl={resolvedOutputUrl} />
    </div>
  );
}
```

- [ ] **Step 7: Create `app/app/create/audio/page.tsx`**

```typescript
import { requireWorkspace } from '@/lib/auth/dal';
import { loadPricing } from '@/lib/credits/pricing';
import { createClient } from '@/lib/supabase/server';
import { AudioGenerator } from '@/components/generation/AudioGenerator';

export const dynamic = 'force-dynamic';

export default async function CreateAudioPage() {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { data: balance } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .single();
  const pricing = await loadPricing();
  return (
    <AudioGenerator
      userId={user.id}
      initialBalance={(balance?.balance as number | undefined) ?? 0}
      pricing={pricing}
    />
  );
}
```

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 9: Run lint**

Run: `pnpm lint`
Expected: 0 errors.

- [ ] **Step 10: Smoke test manually**

1. Ensure env vars are set in `.env.local`: `ELEVENLABS_API_KEY`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `PUBLIC_URL`
2. Run `pnpm dev`
3. Navigate to `http://localhost:3000/app/create/audio`
4. Pick a voice, write "Hola, soy una prueba de Zyra Studio", click Generar audio
5. Expected: status goes queued → processing → done within ~5-15s, audio player renders with playable MP3

If `PUBLIC_URL` is `localhost`, QStash CAN'T reach the worker. For local dev either:
- Use ngrok: `ngrok http 3000`, set `PUBLIC_URL=https://<ngrok>.ngrok.app`
- Or deploy to Vercel preview and test there

- [ ] **Step 11: Commit**

```powershell
git add lib/schemas/audio.ts server-actions/generations.ts components/generation/AudioGenerator.tsx components/generation/AudioControlsPanel.tsx components/generation/AudioPreview.tsx components/generation/use-generation-status.ts app/app/create/audio/page.tsx
git commit -m "feat(audio): TTS end-to-end (server action + UI + realtime hook)"
```

---

## Task 8: FFmpeg en finalize (thumbnail de video)

**Files:**
- Modify: `package.json` (add `@ffmpeg-installer/ffmpeg`)
- Modify: `lib/jobs/finalize.ts` (agregar `makeVideoThumbnail`)

- [ ] **Step 1: Install @ffmpeg-installer/ffmpeg**

Run:
```powershell
pnpm add @ffmpeg-installer/ffmpeg
```

Expected: installed (~30MB), `package.json` updated.

- [ ] **Step 2: Add manual type declaration**

`@ffmpeg-installer/ffmpeg` doesn't ship types and no `@types/*` package exists. Create `types/ffmpeg-installer.d.ts`:

```typescript
declare module '@ffmpeg-installer/ffmpeg' {
  const installer: { path: string; version: string };
  export default installer;
}
```

Verify `tsconfig.json` includes `types/**/*.d.ts` (it should via the default `"include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"]`). If not, add `"types/**/*.d.ts"` to `include`.

- [ ] **Step 3: Update `lib/jobs/finalize.ts`**

Modify the file. Replace the `makeThumbnail` function with:

```typescript
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';

async function makeVideoThumbnail(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegInstaller.path,
      [
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-ss', '0',
        '-frames:v', '1',
        '-vf', 'scale=512:-1',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        '-q:v', '4',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const chunks: Buffer[] = [];
    let errMsg = '';
    ffmpeg.stdout.on('data', (c) => chunks.push(c));
    ffmpeg.stderr.on('data', (c) => (errMsg += c.toString()));
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exit ${code}: ${errMsg.slice(0, 300)}`));
      else resolve(Buffer.concat(chunks));
    });

    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
}

async function makeThumbnail(
  type: GenerationRow['type'],
  buffer: Buffer,
  _mimeType: string,
): Promise<Buffer | null> {
  if (type === 'image') return makeImageThumbnail(buffer);
  if (type === 'video') {
    try {
      return await makeVideoThumbnail(buffer);
    } catch (err) {
      // Si FFmpeg falla, seguimos sin thumbnail. La UI muestra placeholder.
      console.error('[finalize] video thumbnail falló', err);
      return null;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 5: Verify bundle size is acceptable**

Run: `pnpm build`
Expected: build completes. Note the bundle output size — should stay under ~150MB total (well under Vercel Hobby's 250MB limit).

- [ ] **Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml lib/jobs/finalize.ts types/ffmpeg-installer.d.ts
git commit -m "feat(jobs): thumbnail de video via @ffmpeg-installer/ffmpeg"
```

---

## Task 9: Kling provider via fal.ai (cliente SDK + queue API)

**Files:**
- Create: `lib/providers/kling.ts`
- Create: `lib/providers/kling.test.ts`
- Modify: `package.json` (add `@fal-ai/client`)

**Reference:** `docs/modelos/02-kling-3.0.md` y https://fal.ai/models/fal-ai/kling-video.

**Por qué fal.ai en vez de klingapi.com:** klingapi.com no permite signup directo. fal.ai es el wrapper recomendado en el doc, tiene SDK oficial JS, queue API que cabe perfecto en el patrón del worker (submit → status → result), y modelos Kling 2.6 standard/pro accesibles.

**Diferencias vs klingapi.com:**
- Auth: header `Authorization: Key <FAL_KEY>` (no Bearer)
- Endpoint via SDK: `fal.queue.submit('fal-ai/kling-video/v2.6/standard/text-to-video', {input})`
- Response: `{ video: { url, content_type, file_size } }`
- No hay cancel remoto en queue API → handler no expone `cancel`
- No hay modo `professional` como toggle: es un modelo separado (`pro/text-to-video`)
- No hay `lip-sync` Omni en fal.ai (se mantiene fuera de scope Fase 3)

- [ ] **Step 1: Install @fal-ai/client**

Run: `pnpm add @fal-ai/client`
Expected: installed, package.json updated.

- [ ] **Step 2: Write failing tests for `kling.submitTask` payload shape**

Create `lib/providers/kling.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mockeamos el módulo entero del SDK fal.ai
vi.mock('@fal-ai/client', () => {
  const queue = {
    submit: vi.fn(),
    status: vi.fn(),
    result: vi.fn(),
  };
  const config = vi.fn();
  return { fal: { config, queue }, queue };
});

describe('kling provider (via fal.ai)', () => {
  beforeEach(() => {
    vi.stubEnv('FAL_KEY', 'fake-fal-key');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('submitTask passes prompt/duration/aspect_ratio to fal.queue.submit', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.submit as ReturnType<typeof vi.fn>).mockResolvedValue({
      request_id: 'req-123',
    });

    const { submitTask } = await import('./kling');
    const res = await submitTask({
      operation: 'text2video',
      model: 'fal-ai/kling-video/v2.6/standard/text-to-video',
      prompt: 'a cat',
      duration: 5,
      aspectRatio: '16:9',
    });

    expect(res.taskId).toBe('req-123');
    expect(fal.queue.submit).toHaveBeenCalledOnce();
    const [modelSlug, opts] = (fal.queue.submit as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(modelSlug).toBe('fal-ai/kling-video/v2.6/standard/text-to-video');
    expect(opts.input).toMatchObject({
      prompt: 'a cat',
      duration: '5',
      aspect_ratio: '16:9',
    });
  });

  it('pollTask maps fal status COMPLETED → completed with videoUrl', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.status as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'COMPLETED' });
    (fal.queue.result as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { video: { url: 'https://v3.fal.media/a.mp4', content_type: 'video/mp4' } },
    });
    const { pollTask } = await import('./kling');
    const res = await pollTask(
      'fal-ai/kling-video/v2.6/standard/text-to-video',
      'req-123',
    );
    expect(res.status).toBe('completed');
    expect(res.videoUrl).toBe('https://v3.fal.media/a.mp4');
  });

  it('pollTask maps IN_PROGRESS → processing', async () => {
    const { fal } = await import('@fal-ai/client');
    (fal.queue.status as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'IN_PROGRESS' });
    const { pollTask } = await import('./kling');
    const res = await pollTask(
      'fal-ai/kling-video/v2.6/standard/text-to-video',
      'req-123',
    );
    expect(res.status).toBe('processing');
    expect(res.videoUrl).toBeUndefined();
  });

  it('throws when FAL_KEY missing', async () => {
    vi.unstubAllEnvs();
    const { submitTask } = await import('./kling');
    await expect(
      submitTask({
        operation: 'text2video',
        model: 'fal-ai/kling-video/v2.6/standard/text-to-video',
        prompt: 'a cat',
        duration: 5,
        aspectRatio: '16:9',
      }),
    ).rejects.toThrow(/FAL_KEY/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test`
Expected: 4 new tests FAIL (kling not yet created).

- [ ] **Step 4: Create `lib/providers/kling.ts`**

```typescript
import 'server-only';
import { fal } from '@fal-ai/client';
import { ProviderError } from './types';

// Kling via fal.ai. fal.ai expone los modelos Kling como slugs únicos:
//   - fal-ai/kling-video/v2.6/standard/text-to-video
//   - fal-ai/kling-video/v2.6/pro/text-to-video
//   - fal-ai/kling-video/v2.6/standard/image-to-video
// El "operation" lo decide el modelo, no un parámetro.

export type KlingOperation = 'text2video' | 'image2video';
export type KlingModel =
  | 'fal-ai/kling-video/v2.6/standard/text-to-video'
  | 'fal-ai/kling-video/v2.6/pro/text-to-video'
  | 'fal-ai/kling-video/v2.6/standard/image-to-video';

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const credentials = process.env.FAL_KEY;
  if (!credentials) {
    throw new ProviderError('FAL_KEY no configurada', 'auth', false);
  }
  fal.config({ credentials });
  configured = true;
}

export async function submitTask(params: {
  operation: KlingOperation;
  model: KlingModel;
  prompt?: string;
  negativePrompt?: string;
  imageUrl?: string;
  duration: 5 | 10;
  aspectRatio: '16:9' | '9:16' | '1:1';
  cfgScale?: number;
}): Promise<{ taskId: string }> {
  ensureConfigured();
  const input: Record<string, unknown> = {
    duration: String(params.duration), // fal espera "5" / "10" (string)
    aspect_ratio: params.aspectRatio,
  };
  if (params.prompt) input.prompt = params.prompt;
  if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
  if (params.imageUrl) input.image_url = params.imageUrl;
  if (params.cfgScale !== undefined) input.cfg_scale = params.cfgScale;

  try {
    const res = await fal.queue.submit(params.model, { input });
    return { taskId: res.request_id };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message.match(/401|403|unauthorized/i)) {
      throw new ProviderError('Auth inválida con fal.ai', 'auth', false);
    }
    if (message.match(/429|rate.?limit/i)) {
      throw new ProviderError('Rate limit fal.ai', 'rate_limit', true);
    }
    throw new ProviderError(`fal.ai submit: ${message}`, 'unknown', false);
  }
}

export async function pollTask(
  model: KlingModel,
  taskId: string,
): Promise<{
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}> {
  ensureConfigured();
  try {
    const status = await fal.queue.status(model, { requestId: taskId });
    if (status.status === 'COMPLETED') {
      const result = await fal.queue.result(model, { requestId: taskId });
      const data = result.data as { video?: { url?: string } } | undefined;
      const videoUrl = data?.video?.url;
      if (!videoUrl) {
        return { status: 'failed', error: 'completed sin video.url' };
      }
      return { status: 'completed', videoUrl };
    }
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
      return { status: 'processing' };
    }
    // Cualquier otro estado lo tratamos como failed (incluye errores)
    return { status: 'failed', error: `fal status: ${status.status}` };
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    if (message.match(/429|rate.?limit/i)) {
      // Devolver processing para reintentar en el próximo tick
      return { status: 'processing' };
    }
    throw new ProviderError(`fal.ai poll: ${message}`, 'unknown', false);
  }
}

// fal.ai queue API no expone cancel remoto. El handler no implementa cancel
// (similar a Veo). El job sigue corriendo en fal pero el output se ignora
// y los créditos se refundean local.

export async function downloadVideo(url: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ProviderError(
      `No se pudo descargar el video de fal.ai (${res.status})`,
      'server',
      false,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: all tests pass (Kling + chunkText + queue + smoke).

- [ ] **Step 6: Add `FAL_KEY` to `.env.example`**

Append to `.env.example`:
```bash
# fal.ai (wrapper de Kling — klingapi.com no acepta nuevos signups)
FAL_KEY=
```

- [ ] **Step 7: Commit**

```powershell
git add lib/providers/kling.ts lib/providers/kling.test.ts package.json pnpm-lock.yaml .env.example
git commit -m "feat(providers): Kling via fal.ai SDK + queue API + tests"
```

---

## Task 10: Kling handler

**Files:**
- Create: `lib/jobs/handlers/kling.ts`
- Modify: `lib/jobs/handlers/register.ts`

- [ ] **Step 1: Create the handler**

Create `lib/jobs/handlers/kling.ts`:
```typescript
import 'server-only';
import { downloadVideo, pollTask, submitTask, type KlingModel, type KlingOperation } from '@/lib/providers/kling';
import { ProviderError } from '@/lib/providers/types';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';

const MAX_POLLS = 30;

type KlingParams = {
  operation?: KlingOperation;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: 5 | 10;
  cfgScale?: number;
  imageUrl?: string;
  negativePrompt?: string;
};

function nextDelay(attempts: number): number {
  return attempts < 6 ? 10 : 20;
}

export const klingHandler: JobHandler = {
  async handle(gen: GenerationRow, action: JobAction): Promise<JobResult> {
    if (gen.type !== 'video') {
      return { kind: 'fail', message: `type=${gen.type}, esperaba video`, code: 'unknown' };
    }
    const params = gen.params as KlingParams;
    const model = gen.model_id as KlingModel;
    try {
      if (action === 'submit') {
        const startedAt = Date.now();
        const { taskId } = await submitTask({
          operation: params.operation ?? 'text2video',
          model,
          prompt: gen.prompt ?? '',
          negativePrompt: params.negativePrompt,
          imageUrl: params.imageUrl,
          duration: params.duration ?? 5,
          aspectRatio: params.aspectRatio ?? '16:9',
          cfgScale: params.cfgScale,
        });
        return {
          kind: 'continue',
          taskId,
          delaySeconds: nextDelay(0),
          providerPayload: { _started_at: startedAt },
        };
      }

      // action === 'poll'
      if (!gen.provider_task_id) {
        return { kind: 'fail', message: 'provider_task_id faltante en poll', code: 'unknown' };
      }
      if (gen.poll_attempts >= MAX_POLLS) {
        return { kind: 'fail', message: `MAX_POLLS=${MAX_POLLS} excedido`, code: 'timeout' };
      }
      const poll = await pollTask(model, gen.provider_task_id);
      if (poll.status === 'processing') {
        return { kind: 'continue', delaySeconds: nextDelay(gen.poll_attempts) };
      }
      if (poll.status === 'failed') {
        return { kind: 'fail', message: poll.error ?? 'Kling falló', code: 'unknown' };
      }
      // completed
      if (!poll.videoUrl) {
        return { kind: 'fail', message: 'completed sin video_url', code: 'unknown' };
      }
      const { buffer, mimeType } = await downloadVideo(poll.videoUrl);
      return { kind: 'finalize', outputBuffer: buffer, mimeType };
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          kind: 'fail',
          message: err.message,
          code:
            err.code === 'safety'
              ? 'safety'
              : err.code === 'rate_limit'
                ? 'rate_limit'
                : err.code === 'timeout'
                  ? 'timeout'
                  : 'unknown',
        };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
  // fal.ai queue API no expone cancel remoto → handler no expone cancel.
  // El worker, ante cancel_requested, marca status='canceled' local y refunda.
};
```

- [ ] **Step 2: Register the handler**

Edit `lib/jobs/handlers/register.ts`:
```typescript
import 'server-only';
import { registerHandler } from '@/lib/jobs/dispatch';
import { elevenLabsHandler } from './elevenlabs';
import { klingHandler } from './kling';

registerHandler('elevenlabs', elevenLabsHandler);
registerHandler('kling', klingHandler);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
git add lib/jobs/handlers/kling.ts lib/jobs/handlers/register.ts
git commit -m "feat(jobs): handler Kling con polling + cancel"
```

---

## Task 11: submitVideoGenerationAction + VideoGenerator UI (Kling primero)

**Files:**
- Create: `lib/schemas/video.ts`
- Modify: `server-actions/generations.ts` (add `submitVideoGenerationAction`)
- Create: `components/generation/VideoGenerator.tsx`
- Create: `components/generation/VideoControlsPanel.tsx`
- Create: `components/generation/VideoPreview.tsx`
- Create: `app/app/create/video/page.tsx`

- [ ] **Step 1: Create `lib/schemas/video.ts`**

```typescript
import { z } from 'zod';

// Slugs de fal.ai (un slug = un modelo concreto en su catálogo).
// Standard = más rápido/barato; Pro = más calidad pero más caro.
export const KLING_MODELS = [
  'fal-ai/kling-video/v2.6/standard/text-to-video',
  'fal-ai/kling-video/v2.6/pro/text-to-video',
  'fal-ai/kling-video/v2.6/standard/image-to-video',
] as const;

export const SubmitKlingSchema = z.object({
  kind: z.literal('kling'),
  model: z.enum(KLING_MODELS),
  prompt: z.string().trim().min(1).max(2000),
  negativePrompt: z.string().trim().max(500).optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  duration: z.union([z.literal(5), z.literal(10)]),
  cfgScale: z.number().min(0).max(1).optional(),
  imageUrl: z.string().url().optional(), // para image2video
});

export type SubmitKlingInput = z.infer<typeof SubmitKlingSchema>;

// Más adelante (Task 14) agregamos:
// export const SubmitVeoSchema = ...
// export const SubmitVideoSchema = z.discriminatedUnion('kind', [SubmitKlingSchema, SubmitVeoSchema]);
```

- [ ] **Step 2: Add `submitVideoGenerationAction`**

Append to `server-actions/generations.ts`:
```typescript
import { SubmitKlingSchema, type SubmitKlingInput } from '@/lib/schemas/video';

function estimateKlingCost(
  pricing: Awaited<ReturnType<typeof loadPricing>>,
  model: SubmitKlingInput['model'],
  duration: 5 | 10,
): number {
  // Variantes seeded: 'standard' (5s en standard model), 'long' (10s en standard),
  // 'pro' (5s en pro model). Image-to-video usa pricing 'standard' por defecto.
  const isPro = model.includes('/pro/');
  let variant: string;
  if (isPro) variant = 'pro';
  else variant = duration === 10 ? 'long' : 'standard';
  const row = pricing.find(
    (p) => p.provider === 'kling' && p.model_id === model && p.variant === variant,
  );
  if (!row) throw new Error(`pricing no encontrado para Kling ${model}/${variant}`);
  return Number(row.credits_cost);
}

export async function submitVideoGenerationAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  // Por ahora solo Kling; Veo se agrega en Task 14
  const parsed = SubmitKlingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { user, workspace } = await requireWorkspace();

  const pricing = await loadPricing();
  const cost = estimateKlingCost(pricing, data.model, data.duration);

  const supabase = await createClient();
  const insertParams: Record<string, unknown> = {
    operation: data.imageUrl ? 'image2video' : 'text2video',
    aspectRatio: data.aspectRatio,
    duration: data.duration,
    mode: data.mode,
    cfgScale: data.cfgScale,
    imageUrl: data.imageUrl,
    negativePrompt: data.negativePrompt,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'video',
      provider: 'kling',
      model_id: data.model,
      prompt: data.prompt,
      params: insertParams,
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
    await failGeneration(user.id, generationId, cost, 'queue_failed').catch(() => {});
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    const message = (err as Error)?.message ?? 'queue error';
    return {
      ok: false,
      error: message.includes('429') ? 'provider_error' : 'internal_error',
      message,
    };
  }

  revalidatePath('/app/library');
  return { ok: true, data: { generationId } };
}
```

- [ ] **Step 3: Create `components/generation/VideoControlsPanel.tsx`**

```typescript
'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KLING_MODELS } from '@/lib/schemas/video';

export type VideoControlsProps = {
  prompt: string;
  setPrompt: (v: string) => void;
  negativePrompt: string;
  setNegativePrompt: (v: string) => void;
  model: (typeof KLING_MODELS)[number];
  setModel: (v: (typeof KLING_MODELS)[number]) => void;
  duration: 5 | 10;
  setDuration: (v: 5 | 10) => void;
  aspectRatio: '16:9' | '9:16' | '1:1';
  setAspectRatio: (v: '16:9' | '9:16' | '1:1') => void;
  cost: number;
  balance: number;
  pending: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
};

export function VideoControlsPanel(props: VideoControlsProps) {
  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto border-r border-border bg-card/30 p-5">
      <h2 className="font-heading text-[15px] font-medium tracking-tight text-foreground">
        Crear video
      </h2>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Modelo
      </label>
      <select
        value={props.model}
        onChange={(e) => props.setModel(e.target.value as (typeof KLING_MODELS)[number])}
        className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
      >
        <option value="fal-ai/kling-video/v2.6/standard/text-to-video">Kling 2.6 Standard</option>
        <option value="fal-ai/kling-video/v2.6/pro/text-to-video">Kling 2.6 Pro</option>
      </select>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Duración
      </label>
      <div className="mt-1.5 flex gap-2">
        {[5, 10].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => props.setDuration(d as 5 | 10)}
            className={cn(
              'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
              props.duration === d
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40',
            )}
          >
            {d}s
          </button>
        ))}
      </div>

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Aspect ratio
      </label>
      <div className="mt-1.5 flex gap-2">
        {(['16:9', '9:16', '1:1'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => props.setAspectRatio(r)}
            className={cn(
              'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
              props.aspectRatio === r
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-muted-foreground/40',
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <label className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Prompt
      </label>
      <textarea
        value={props.prompt}
        onChange={(e) => props.setPrompt(e.target.value.slice(0, 2000))}
        placeholder="Describe la escena que quieres animar…"
        className="scroll-thin mt-1.5 min-h-[100px] resize-y rounded-md border border-border bg-background p-3 text-[13.5px] text-foreground outline-none"
      />

      <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Negative prompt (opcional)
      </label>
      <textarea
        value={props.negativePrompt}
        onChange={(e) => props.setNegativePrompt(e.target.value.slice(0, 500))}
        placeholder="Qué evitar…"
        className="scroll-thin mt-1.5 min-h-[50px] resize-y rounded-md border border-border bg-background p-3 text-[12.5px] text-foreground outline-none"
      />

      <div className="mt-6 flex items-center justify-between text-[12.5px]">
        <span className="text-muted-foreground">Costo</span>
        <span className="font-mono text-foreground">−{props.cost} cr</span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">Saldo</span>
        <span className="font-mono text-muted-foreground">{props.balance} cr</span>
      </div>

      <button
        type="button"
        onClick={props.onGenerate}
        disabled={!props.canGenerate}
        className={cn(
          'mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md text-[13.5px] font-medium transition-colors',
          props.canGenerate
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'cursor-not-allowed bg-muted text-muted-foreground/60',
        )}
      >
        {props.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Generar video
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create `components/generation/VideoPreview.tsx`**

```typescript
'use client';

import { Loader2, Video } from 'lucide-react';
import { toast } from 'sonner';
import { useState } from 'react';
import { downloadGenerationImage } from '@/lib/media-references/download-client';
import { cn } from '@/lib/utils';
import type { LiveGeneration } from './use-generation-status';

export function VideoPreview({
  generation,
  resolvedOutputUrl,
  resolvedThumbnailUrl,
}: {
  generation: LiveGeneration | null;
  resolvedOutputUrl: string | null;
  resolvedThumbnailUrl: string | null;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!resolvedOutputUrl) return;
    setDownloading(true);
    try {
      await downloadGenerationImage(resolvedOutputUrl, `zyra-video`);
    } catch (e) {
      toast.error(
        `No se pudo descargar${e instanceof Error ? `: ${e.message}` : ''}`,
      );
    } finally {
      setDownloading(false);
    }
  }

  if (!generation) {
    return (
      <div className="grid h-full place-items-center text-muted-foreground/60">
        <div className="text-center">
          <Video className="mx-auto size-10" aria-hidden />
          <p className="mt-2 text-[13px]">Describe la escena y genera tu video</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'queued' || generation.status === 'processing') {
    return (
      <div className="grid h-full place-items-center text-muted-foreground">
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-10 animate-spin text-primary" aria-hidden />
          <p className="text-[13.5px] text-foreground">Generando video…</p>
          <p className="text-[11.5px] text-muted-foreground/80">Esto puede tomar hasta 3 minutos</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'failed' || generation.status === 'canceled') {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-[13.5px] text-foreground">
            {generation.status === 'failed' ? 'No se pudo generar el video' : 'Generación cancelada'}
          </p>
          {generation.errorMessage && (
            <p className="mt-1 font-mono text-[11.5px] text-muted-foreground/80">
              {generation.errorMessage}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      {resolvedOutputUrl ? (
        <>
          <video
            controls
            autoPlay
            muted
            playsInline
            src={resolvedOutputUrl}
            poster={resolvedThumbnailUrl ?? undefined}
            className="max-h-[70vh] max-w-full rounded-lg border border-border bg-black"
          />
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12.5px]',
              downloading ? 'opacity-60' : 'hover:bg-muted',
            )}
          >
            {downloading ? <Loader2 className="size-3.5 animate-spin" /> : 'Descargar video'}
          </button>
        </>
      ) : (
        <p className="text-muted-foreground">Video listo, cargando URL…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `components/generation/VideoGenerator.tsx`**

```typescript
'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { submitVideoGenerationAction } from '@/server-actions/generations';
import { useLiveBalance } from '@/components/layout/use-live-balance';
import type { PricingRow } from '@/lib/credits/types';
import { KLING_MODELS } from '@/lib/schemas/video';
import { VideoControlsPanel } from './VideoControlsPanel';
import { VideoPreview } from './VideoPreview';
import { useGenerationStatus } from './use-generation-status';

function calcCost(
  pricing: PricingRow[],
  model: (typeof KLING_MODELS)[number],
  duration: 5 | 10,
): number {
  let variant: string;
  const isPro = model.includes('/pro/');
  if (isPro) variant = 'pro';
  else variant = duration === 10 ? 'long' : 'standard';
  const row = pricing.find(
    (p) => p.provider === 'kling' && p.model_id === model && p.variant === variant,
  );
  return row ? Number(row.credits_cost) : 0;
}

export function VideoGenerator(props: {
  userId: string;
  initialBalance: number;
  pricing: PricingRow[];
}) {
  const balance = useLiveBalance(props.userId, props.initialBalance);
  const [model, setModel] = useState<(typeof KLING_MODELS)[number]>('fal-ai/kling-video/v2.6/standard/text-to-video');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [resolvedOutputUrl, setResolvedOutputUrl] = useState<string | null>(null);
  const [resolvedThumbnailUrl, setResolvedThumbnailUrl] = useState<string | null>(null);

  const live = useGenerationStatus(activeId);

  const cost = useMemo(() => calcCost(props.pricing, model, duration), [props.pricing, model, duration]);
  const canGenerate = prompt.trim().length > 0 && cost > 0 && cost <= balance && !pending;

  function handleGenerate() {
    if (!canGenerate) return;
    startTransition(async () => {
      const res = await submitVideoGenerationAction({
        kind: 'kling',
        model,
        prompt,
        negativePrompt: negativePrompt || undefined,
        aspectRatio,
        duration,
        mode: 'professional',
      });
      if (!res.ok) {
        toast.error(
          res.error === 'insufficient_credits'
            ? 'Créditos insuficientes'
            : res.message || 'No se pudo enviar el job',
        );
        return;
      }
      setActiveId(res.data.generationId);
      setResolvedOutputUrl(null);
      setResolvedThumbnailUrl(null);
    });
  }

  useEffect(() => {
    if (!live || live.status !== 'done' || !activeId) return;
    let active = true;
    fetch(`/api/generations/${activeId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { outputUrl?: string; thumbnailUrl?: string } | null) => {
        if (!active || !data) return;
        if (data.outputUrl) setResolvedOutputUrl(data.outputUrl);
        if (data.thumbnailUrl) setResolvedThumbnailUrl(data.thumbnailUrl);
      });
    return () => {
      active = false;
    };
  }, [live?.status, activeId]);

  return (
    <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-8 lg:grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[360px_1fr]">
      <VideoControlsPanel
        prompt={prompt}
        setPrompt={setPrompt}
        negativePrompt={negativePrompt}
        setNegativePrompt={setNegativePrompt}
        model={model}
        setModel={setModel}
        duration={duration}
        setDuration={setDuration}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
        cost={cost}
        balance={balance}
        pending={pending}
        canGenerate={canGenerate}
        onGenerate={handleGenerate}
      />
      <VideoPreview
        generation={live}
        resolvedOutputUrl={resolvedOutputUrl}
        resolvedThumbnailUrl={resolvedThumbnailUrl}
      />
    </div>
  );
}
```

- [ ] **Step 6: Create `app/app/create/video/page.tsx`**

```typescript
import { requireWorkspace } from '@/lib/auth/dal';
import { loadPricing } from '@/lib/credits/pricing';
import { createClient } from '@/lib/supabase/server';
import { VideoGenerator } from '@/components/generation/VideoGenerator';

export const dynamic = 'force-dynamic';

export default async function CreateVideoPage() {
  const { user } = await requireWorkspace();
  const supabase = await createClient();
  const { data: balance } = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .single();
  const pricing = await loadPricing();
  return (
    <VideoGenerator
      userId={user.id}
      initialBalance={(balance?.balance as number | undefined) ?? 0}
      pricing={pricing}
    />
  );
}
```

- [ ] **Step 7: Run typecheck + lint**

```powershell
pnpm typecheck
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 8: Smoke test (requires env + PUBLIC_URL reachable by QStash)**

1. `pnpm dev`
2. `http://localhost:3000/app/create/video`
3. Pick Kling 2.6 Pro, duration 5, aspect 16:9, prompt "a cat playing piano in a jazz club"
4. Generar
5. Expected: status queued → processing → done in 60-90s; `<video>` plays with thumbnail.

- [ ] **Step 9: Commit**

```powershell
git add lib/schemas/video.ts server-actions/generations.ts components/generation/VideoGenerator.tsx components/generation/VideoControlsPanel.tsx components/generation/VideoPreview.tsx app/app/create/video/page.tsx
git commit -m "feat(video): Kling end-to-end (server action + UI + preview)"
```

---

## Task 12: Veo provider

**Files:**
- Create: `lib/providers/veo.ts`
- Create: `lib/providers/veo.test.ts`

**Reference:** `docs/modelos/01-veo-3.1.md`.

- [ ] **Step 1: Write failing tests for `veo.submitOperation`**

Create `lib/providers/veo.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('veo.submitOperation', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-gemini-key');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('sends correct REST payload and returns operationName', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ name: 'operations/abc-123' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const { submitOperation } = await import('./veo');
    const res = await submitOperation({
      model: 'veo-3.1-fast-generate-preview',
      prompt: 'a lion',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 8,
    });
    expect(res.operationName).toBe('operations/abc-123');
  });

  it('throws auth on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
    const { submitOperation } = await import('./veo');
    await expect(
      submitOperation({
        model: 'veo-3.1-fast-generate-preview',
        prompt: 'x',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 8,
      }),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('injects personGeneration=allow_adult', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: 'operations/abc-123' }), { status: 200 }),
    );
    global.fetch = fetchSpy;
    const { submitOperation } = await import('./veo');
    await submitOperation({
      model: 'veo-3.1-fast-generate-preview',
      prompt: 'a lion',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 8,
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.parameters?.personGeneration).toBe('allow_adult');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Create `lib/providers/veo.ts`**

```typescript
import 'server-only';
import { z } from 'zod';
import { ProviderError } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export type VeoModel =
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-lite-generate-preview';

const SubmitResponseSchema = z.object({
  name: z.string(),
});

const PollResponseSchema = z.object({
  name: z.string(),
  done: z.boolean().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
  response: z
    .object({
      generateVideoResponse: z
        .object({
          generatedSamples: z
            .array(
              z.object({
                video: z.object({ uri: z.string() }),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);
  return key;
}

export async function submitOperation(params: {
  model: VeoModel;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p';
  durationSeconds: 4 | 6 | 8;
  imageReference?: { mimeType: string; data: string };
}): Promise<{ operationName: string }> {
  const apiKey = getApiKey();
  const body: Record<string, unknown> = {
    instances: [
      {
        prompt: params.prompt,
        ...(params.imageReference && { image: params.imageReference }),
      },
    ],
    parameters: {
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      durationSeconds: String(params.durationSeconds),
      personGeneration: 'allow_adult',
      ...(params.negativePrompt && { negativePrompt: params.negativePrompt }),
    },
  };

  const res = await fetch(`${BASE_URL}/models/${params.model}:predictLongRunning`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (res.status === 429) {
    throw new ProviderError('Rate limit Veo', 'rate_limit', true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(
      `Veo submit ${res.status}: ${text.slice(0, 200)}`,
      res.status >= 500 ? 'server' : 'unknown',
      res.status >= 500,
    );
  }
  const parsed = SubmitResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada de Veo submit: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }
  return { operationName: parsed.data.name };
}

export async function pollOperation(operationName: string): Promise<{
  done: boolean;
  videoUri?: string;
  error?: { code: number; message: string };
}> {
  const apiKey = getApiKey();
  const res = await fetch(`${BASE_URL}/${operationName}`, {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    if (res.status >= 500) return { done: false };
    throw new ProviderError(`Veo poll ${res.status}`, 'unknown', false);
  }
  const parsed = PollResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new ProviderError(
      `Respuesta inesperada de Veo poll: ${parsed.error.message}`,
      'unknown',
      false,
    );
  }
  const data = parsed.data;
  const uri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
  return { done: data.done === true, videoUri: uri, error: data.error };
}

export async function downloadVideo(uri: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = getApiKey();
  const res = await fetch(uri, {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    throw new ProviderError(
      `No se pudo descargar el video de Veo (${res.status})`,
      'server',
      false,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType: res.headers.get('content-type') ?? 'video/mp4' };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add lib/providers/veo.ts lib/providers/veo.test.ts
git commit -m "feat(providers): Veo client (submit/poll/download) + tests"
```

---

## Task 13: Veo handler

**Files:**
- Create: `lib/jobs/handlers/veo.ts`
- Modify: `lib/jobs/handlers/register.ts`

- [ ] **Step 1: Create the handler**

Create `lib/jobs/handlers/veo.ts`:
```typescript
import 'server-only';
import { downloadVideo, pollOperation, submitOperation, type VeoModel } from '@/lib/providers/veo';
import { ProviderError } from '@/lib/providers/types';
import type { GenerationRow, JobAction, JobHandler, JobResult } from './types';

const MAX_POLLS = 24;

type VeoParams = {
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p';
  durationSeconds?: 4 | 6 | 8;
  negativePrompt?: string;
  imageReference?: { mimeType: string; data: string };
};

function nextDelay(attempts: number): number {
  return attempts < 4 ? 15 : 30;
}

export const veoHandler: JobHandler = {
  async handle(gen: GenerationRow, action: JobAction): Promise<JobResult> {
    if (gen.type !== 'video') {
      return { kind: 'fail', message: `type=${gen.type}, esperaba video`, code: 'unknown' };
    }
    const params = gen.params as VeoParams;
    try {
      if (action === 'submit') {
        const startedAt = Date.now();
        const { operationName } = await submitOperation({
          model: gen.model_id as VeoModel,
          prompt: gen.prompt ?? '',
          negativePrompt: params.negativePrompt,
          aspectRatio: params.aspectRatio ?? '16:9',
          resolution: params.resolution ?? '1080p',
          durationSeconds: params.durationSeconds ?? 8,
          imageReference: params.imageReference,
        });
        return {
          kind: 'continue',
          taskId: operationName,
          delaySeconds: nextDelay(0),
          providerPayload: { _started_at: startedAt },
        };
      }

      // poll
      if (!gen.provider_task_id) {
        return { kind: 'fail', message: 'provider_task_id (operationName) faltante', code: 'unknown' };
      }
      if (gen.poll_attempts >= MAX_POLLS) {
        return { kind: 'fail', message: `MAX_POLLS=${MAX_POLLS} excedido`, code: 'timeout' };
      }
      const poll = await pollOperation(gen.provider_task_id);
      if (!poll.done) {
        return { kind: 'continue', delaySeconds: nextDelay(gen.poll_attempts) };
      }
      if (poll.error) {
        return {
          kind: 'fail',
          message: `Veo error ${poll.error.code}: ${poll.error.message}`,
          code: 'unknown',
        };
      }
      if (!poll.videoUri) {
        return { kind: 'fail', message: 'Veo done sin videoUri', code: 'unknown' };
      }
      const { buffer, mimeType } = await downloadVideo(poll.videoUri);
      return { kind: 'finalize', outputBuffer: buffer, mimeType };
    } catch (err) {
      if (err instanceof ProviderError) {
        return {
          kind: 'fail',
          message: err.message,
          code:
            err.code === 'safety'
              ? 'safety'
              : err.code === 'rate_limit'
                ? 'rate_limit'
                : err.code === 'timeout'
                  ? 'timeout'
                  : 'unknown',
        };
      }
      return { kind: 'fail', message: (err as Error).message, code: 'unknown' };
    }
  },
  // No cancel — Veo no soporta cancelación remota
};
```

- [ ] **Step 2: Register the handler**

Edit `lib/jobs/handlers/register.ts`:
```typescript
import 'server-only';
import { registerHandler } from '@/lib/jobs/dispatch';
import { elevenLabsHandler } from './elevenlabs';
import { klingHandler } from './kling';
import { veoHandler } from './veo';

registerHandler('elevenlabs', elevenLabsHandler);
registerHandler('kling', klingHandler);
registerHandler('veo', veoHandler);
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
git add lib/jobs/handlers/veo.ts lib/jobs/handlers/register.ts
git commit -m "feat(jobs): handler Veo con polling recursivo"
```

---

## Task 14: Veo en UI (extender selector)

**Files:**
- Modify: `lib/schemas/video.ts` (agregar VeoSchema y discriminated union)
- Modify: `server-actions/generations.ts` (extender `submitVideoGenerationAction`)
- Modify: `components/generation/VideoControlsPanel.tsx` (agregar selector de provider)
- Modify: `components/generation/VideoGenerator.tsx` (manejar ambos providers)

- [ ] **Step 1: Extend `lib/schemas/video.ts`**

Replace contents:
```typescript
import { z } from 'zod';

export const KLING_MODELS = [
  'fal-ai/kling-video/v2.6/standard/text-to-video',
  'fal-ai/kling-video/v2.6/pro/text-to-video',
  'fal-ai/kling-video/v2.6/standard/image-to-video',
] as const;
export const VEO_MODELS = [
  'veo-3.1-fast-generate-preview',
  'veo-3.1-generate-preview',
  'veo-3.1-lite-generate-preview',
] as const;

export const SubmitKlingSchema = z.object({
  kind: z.literal('kling'),
  model: z.enum(KLING_MODELS),
  prompt: z.string().trim().min(1).max(2000),
  negativePrompt: z.string().trim().max(500).optional(),
  aspectRatio: z.enum(['16:9', '9:16', '1:1']),
  duration: z.union([z.literal(5), z.literal(10)]),
  mode: z.enum(['standard', 'professional']).optional(),
  cfgScale: z.number().min(0).max(1).optional(),
  imageUrl: z.string().url().optional(),
});

export const SubmitVeoSchema = z.object({
  kind: z.literal('veo'),
  model: z.enum(VEO_MODELS),
  prompt: z.string().trim().min(1).max(1024),
  negativePrompt: z.string().trim().max(500).optional(),
  aspectRatio: z.enum(['16:9', '9:16']),
  resolution: z.enum(['720p', '1080p']),
  durationSeconds: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  imageReference: z
    .object({
      mimeType: z.string(),
      data: z.string(), // base64
    })
    .optional(),
});

export const SubmitVideoSchema = z.discriminatedUnion('kind', [
  SubmitKlingSchema,
  SubmitVeoSchema,
]);

export type SubmitKlingInput = z.infer<typeof SubmitKlingSchema>;
export type SubmitVeoInput = z.infer<typeof SubmitVeoSchema>;
export type SubmitVideoInput = z.infer<typeof SubmitVideoSchema>;
```

- [ ] **Step 2: Update `submitVideoGenerationAction` to support Veo**

Replace the action in `server-actions/generations.ts`:
```typescript
import { SubmitVideoSchema, type SubmitVeoInput } from '@/lib/schemas/video';

function estimateVeoCost(
  pricing: Awaited<ReturnType<typeof loadPricing>>,
  model: SubmitVeoInput['model'],
  durationSeconds: 4 | 6 | 8,
): number {
  const row = pricing.find(
    (p) => p.provider === 'veo' && p.model_id === model && p.variant === '1080p',
  );
  if (!row) throw new Error(`pricing no encontrado para Veo ${model}`);
  return durationSeconds * Number(row.credits_cost);
}

export async function submitVideoGenerationAction(
  input: unknown,
): Promise<Result<{ generationId: string }>> {
  const parsed = SubmitVideoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.message };
  }
  const data = parsed.data;
  const { user, workspace } = await requireWorkspace();
  const pricing = await loadPricing();

  let cost: number;
  let provider: 'veo' | 'kling';
  let modelId: string;
  let insertParams: Record<string, unknown>;

  if (data.kind === 'kling') {
    provider = 'kling';
    modelId = data.model;
    cost = estimateKlingCost(pricing, data.model, data.duration);
    insertParams = {
      operation: data.imageUrl ? 'image2video' : 'text2video',
      aspectRatio: data.aspectRatio,
      duration: data.duration,
      cfgScale: data.cfgScale,
      imageUrl: data.imageUrl,
      negativePrompt: data.negativePrompt,
    };
  } else {
    provider = 'veo';
    modelId = data.model;
    cost = estimateVeoCost(pricing, data.model, data.durationSeconds);
    insertParams = {
      aspectRatio: data.aspectRatio,
      resolution: data.resolution,
      durationSeconds: data.durationSeconds,
      negativePrompt: data.negativePrompt,
      imageReference: data.imageReference,
    };
  }

  const supabase = await createClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      workspace_id: workspace.id,
      type: 'video',
      provider,
      model_id: modelId,
      prompt: data.prompt,
      params: insertParams,
      reference_ids: [],
      status: 'queued',
      credits_estimated: cost,
      timeout_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
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
    await failGeneration(user.id, generationId, cost, 'queue_failed').catch(() => {});
    const admin = createAdminClient();
    await admin.from('generations').delete().eq('id', generationId);
    const message = (err as Error)?.message ?? 'queue error';
    return {
      ok: false,
      error: message.includes('429') ? 'provider_error' : 'internal_error',
      message,
    };
  }

  revalidatePath('/app/library');
  return { ok: true, data: { generationId } };
}
```

- [ ] **Step 3: Add Veo options to `VideoControlsPanel.tsx`**

Modify the file. Update the props type and the model select:

```typescript
// At the top, import VEO_MODELS too:
import { KLING_MODELS, VEO_MODELS } from '@/lib/schemas/video';

// Extend the props type by replacing `model` typing:
export type ModelKey =
  | 'fal-ai/kling-video/v2.6/standard/text-to-video'
  | 'fal-ai/kling-video/v2.6/pro/text-to-video'
  | 'fal-ai/kling-video/v2.6/standard/image-to-video'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-lite-generate-preview';

export type VideoControlsProps = {
  // ... existing fields ...
  model: ModelKey;
  setModel: (v: ModelKey) => void;
  // For Veo:
  veoDuration: 4 | 6 | 8;
  setVeoDuration: (v: 4 | 6 | 8) => void;
  veoResolution: '720p' | '1080p';
  setVeoResolution: (v: '720p' | '1080p') => void;
  // ... rest ...
};

// In the JSX, replace the model <select> with:
<select
  value={props.model}
  onChange={(e) => props.setModel(e.target.value as ModelKey)}
  className="mt-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13.5px] text-foreground outline-none"
>
  <optgroup label="Kling (rápido)">
    <option value="fal-ai/kling-video/v2.6/standard/text-to-video">Kling 2.6 Standard</option>
    <option value="fal-ai/kling-video/v2.6/pro/text-to-video">Kling 2.6 Pro</option>
  </optgroup>
  <optgroup label="Veo 3.1 (premium)">
    <option value="veo-3.1-fast-generate-preview">Veo Fast</option>
    <option value="veo-3.1-generate-preview">Veo Standard</option>
    <option value="veo-3.1-lite-generate-preview">Veo Lite</option>
  </optgroup>
</select>
```

Also extend the duration/aspect ratio controls to switch based on the model. After the model select, add:

```typescript
const isVeo = props.model.startsWith('veo-');

{isVeo ? (
  <>
    <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      Duración
    </label>
    <div className="mt-1.5 flex gap-2">
      {[4, 6, 8].map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => props.setVeoDuration(d as 4 | 6 | 8)}
          className={cn(
            'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
            props.veoDuration === d
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:border-muted-foreground/40',
          )}
        >
          {d}s
        </button>
      ))}
    </div>
    <label className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      Resolución
    </label>
    <div className="mt-1.5 flex gap-2">
      {(['720p', '1080p'] as const).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => props.setVeoResolution(r)}
          className={cn(
            'flex-1 rounded-md border px-3 py-1.5 text-[12.5px]',
            props.veoResolution === r
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:border-muted-foreground/40',
          )}
        >
          {r}
        </button>
      ))}
    </div>
  </>
) : (
  // existing Kling duration + aspect controls
)}
```

Wrap the existing Kling duration/aspect blocks inside the `: (...)` branch.

- [ ] **Step 4: Update `VideoGenerator.tsx`**

Modify the component. Update state and `calcCost`:

```typescript
import { KLING_MODELS, VEO_MODELS } from '@/lib/schemas/video';
import type { ModelKey } from './VideoControlsPanel';

function calcCost(
  pricing: PricingRow[],
  model: ModelKey,
  durationSeconds: number,
): number {
  if (model.startsWith('veo-')) {
    const row = pricing.find(
      (p) => p.provider === 'veo' && p.model_id === model && p.variant === '1080p',
    );
    return row ? durationSeconds * Number(row.credits_cost) : 0;
  }
  // Kling (via fal.ai)
  let variant: string;
  const isPro = model.includes('/pro/');
  if (isPro) variant = 'pro';
  else variant = durationSeconds === 10 ? 'long' : 'standard';
  const row = pricing.find(
    (p) => p.provider === 'kling' && p.model_id === model && p.variant === variant,
  );
  return row ? Number(row.credits_cost) : 0;
}

// In the component body, change useState for model:
const [model, setModel] = useState<ModelKey>('fal-ai/kling-video/v2.6/standard/text-to-video');
const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(8);
const [veoResolution, setVeoResolution] = useState<'720p' | '1080p'>('1080p');

// cost calc:
const cost = useMemo(() => {
  const dur = model.startsWith('veo-') ? veoDuration : duration;
  return calcCost(props.pricing, model, dur);
}, [props.pricing, model, duration, veoDuration]);

// handleGenerate:
function handleGenerate() {
  if (!canGenerate) return;
  startTransition(async () => {
    const input = model.startsWith('veo-')
      ? {
          kind: 'veo' as const,
          model: model as (typeof VEO_MODELS)[number],
          prompt,
          negativePrompt: negativePrompt || undefined,
          aspectRatio: aspectRatio === '1:1' ? '16:9' : aspectRatio,
          resolution: veoResolution,
          durationSeconds: veoDuration,
        }
      : {
          kind: 'kling' as const,
          model: model as (typeof KLING_MODELS)[number],
          prompt,
          negativePrompt: negativePrompt || undefined,
          aspectRatio,
          duration,
          };
    const res = await submitVideoGenerationAction(input);
    // ... existing handling ...
  });
}
```

Also pass `veoDuration`, `setVeoDuration`, `veoResolution`, `setVeoResolution` to `<VideoControlsPanel>`.

- [ ] **Step 5: Run typecheck + lint**

```powershell
pnpm typecheck
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 6: Smoke test**

1. `pnpm dev`
2. `http://localhost:3000/app/create/video`
3. Pick **Veo Fast**, 8s, 1080p, 16:9, prompt "A cinematic shot of a majestic lion in the savannah at golden hour"
4. Generar
5. Expected: status → processing → done in ~2-3 min, `<video>` plays, thumbnail visible.

- [ ] **Step 7: Commit**

```powershell
git add lib/schemas/video.ts server-actions/generations.ts components/generation/VideoControlsPanel.tsx components/generation/VideoGenerator.tsx
git commit -m "feat(video): Veo end-to-end (3 modelos) integrado al selector"
```

---

## Final Steps (after all tasks complete)

- [ ] **Run full test suite**

```powershell
pnpm test
pnpm typecheck
pnpm lint
```

All must pass.

- [ ] **Push branch**

```powershell
git push origin main
```

- [ ] **Update `docs/setup/api-keys.md`** with sections for `KLING_API_KEY`, `KLING_API_SECRET`, `ELEVENLABS_API_KEY`, `QSTASH_*`, `PUBLIC_URL`.

- [ ] **Verify in MCP Supabase advisors that no new security warnings exist**

Call `mcp__plugin_supabase_supabase__get_advisors` with type `security`. Expected: no NEW warnings vs the post-migration 012 baseline (the 10 pre-existing warnings remain unchanged).

---

## Out of scope (for Day 5 plan)

- ElevenLabs sound effect
- Voice cloning (`/app/voices`, `server-actions/voices.ts`)
- Kling Omni lip-sync UI (picker de audio/video previos)
- Cancelación end-to-end con botón UI
- Cleanup endpoint `/api/jobs/cleanup` + schedule
- Image-to-video con picker de imágenes del workspace
- Realtime status hook ya está creado pero solo se prueba con TTS/Kling/Veo básico

These are addressed in `2026-05-23-fase-3-dia-5-extras.md` (to be written after Day 4 verification).
