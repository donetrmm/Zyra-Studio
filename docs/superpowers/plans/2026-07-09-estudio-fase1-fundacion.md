# Estudio creativo de activos — Fase 1 (fundación) · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para ejecutar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`).

**Goal:** Poner la fundación del estudio: modelo de datos de sesión, adapter de GPT Image, un camino de generación de imagen **asíncrono** por el worker (que hoy no existe para imagen), Nano alcanzable por ese camino, y pricing/estimador para GPT Image — todo verificable sin la UI del estudio (Fase 2).

**Architecture:** Cada turno del estudio es una fila `generations` normal etiquetada con `studio_session_id`. `submitStudioTurnAction` reserva créditos, inserta la fila `status:'queued'` y **encola** un job QStash (a diferencia del camino inline de imagen actual). El worker `/api/jobs/process` gana un handler de imagen one-shot (espeja el de audio ElevenLabs) que llama al proveedor (`nano-banana` o `gpt-image`), sube el output y finaliza. Se sube el `maxDuration` del worker a 300s porque una llamada de imagen bloquea hasta ~280s y no se puede sondear en trozos.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS + Storage + Realtime), Upstash QStash, Vercel AI SDK (`ai@^7`) vía Vercel AI Gateway, zod, vitest, pnpm.

## Global Constraints

- **pnpm** siempre (`pnpm add`, `pnpm typecheck`, `pnpm build`, `pnpm test`). Sin `any` en TS (usa `unknown` + narrowing o tipo explícito).
- **Créditos solo vía funciones SQL atómicas** (`reserve_credits`/`confirm_credits`/`refund_credits`); nunca UPDATE directo a `credit_balances`/`credit_transactions`. El submit reserva; el worker confirma (finalize) o reembolsa (fail).
- **URLs de proveedor nunca al cliente:** el worker recibe base64/Buffer y sube a Supabase Storage; el cliente solo ve URLs `*.supabase.co`.
- **Providers y admin client solo server-side.** Nunca importar `lib/supabase/admin.ts` desde cliente.
- **RLS por `workspace_id`** con `is_workspace_member(ws_id)`; las server actions validan ownership además de RLS.
- **Migración nueva se ESCRIBE+commitea pero NO se aplica dentro de las tareas.** El controller la aplica vía Supabase MCP al final, con confirmación del usuario (orden de despliegue). Una migración aplicada no se modifica. Idempotente (`if not exists`, `drop policy if exists`, `on conflict do nothing`).
- **Sin APIs reales en tests** (vitest puro). El smoke con key real (incluida la compuerta de edición gpt-image por gateway) lo corre el usuario.
- **Commits:** español, imperativo, **SIN** `Co-Authored-By`.
- **`generations` usa el estado `'done'`** (no `'completed'`) y `status in ('queued','processing','done','failed','canceled')`.
- **Estudio v1: todo asíncrono, un solo camino.** El resto de la app conserva su camino inline; solo el estudio encola.

## File Structure

- `supabase/migrations/061_studio_sessions.sql` (crear) — tabla `studio_sessions` + RLS, `generations.studio_session_id`, CHECK de `generations.provider` += `'gpt-image'`, filas `model_pricing` de gpt-image.
- `lib/providers/gpt-image.ts` (crear) — adapter: `buildImageRequest` (pura), `interpretImageResult` (pura), `generate` (IO, `experimental_generateImage`).
- `lib/providers/gpt-image.test.ts` (crear) — tests de las dos funciones puras.
- `lib/jobs/handlers/image-turn.ts` (crear) — `runImageTurn(gen)`: claim atómico, resuelve refs, llama al proveedor, devuelve `JobResult`.
- `lib/jobs/handlers/gpt-image.ts` (crear) — handler que registra el provider `gpt-image` → `runImageTurn`.
- `lib/jobs/handlers/nano-banana.ts` (modificar) — enrutar turnos de estudio a `runImageTurn` (conservar el flujo de storyboard).
- `lib/jobs/handlers/register.ts` (modificar) — registrar `gpt-image`.
- `lib/jobs/handlers/types.ts` (modificar) — `JobResult` += `{ kind: 'skip' }`; `GenerationRow.provider` += `'gpt-image'`.
- `lib/jobs/queue.ts` (modificar) — `EnqueueJobInput` += `timeoutSeconds?`; pasarlo como timeout de QStash.
- `lib/schemas/studio.ts` (crear) — `CreateStudioSessionSchema`, `SubmitStudioTurnSchema`.
- `lib/schemas/studio.test.ts` (crear) — tests de validación de los schemas.
- `server-actions/studio.ts` (crear) — `createStudioSessionAction`, `submitStudioTurnAction`, `listStudioSessionGenerationsAction`.
- `lib/credits/estimator.gpt-image.test.ts` (crear) — test de pricing plano de gpt-image.
- `app/api/jobs/process/route.ts` (modificar) — `maxDuration` 60→300; manejar `kind:'skip'`.

---

### Task 1: Migración 061 (studio_sessions + columna + provider CHECK + pricing gpt-image)

**Files:**
- Create: `supabase/migrations/061_studio_sessions.sql`

**Interfaces:**
- Produces: tabla `studio_sessions(id, workspace_id, asset_type, asset_id, default_provider, default_model_id, title, created_at, archived_at)`; columna `generations.studio_session_id uuid null`; `generations.provider` acepta `'gpt-image'`; filas `model_pricing` para `gpt-image`.

- [ ] **Step 1: Escribir la migración** — crea `supabase/migrations/061_studio_sessions.sql` con exactamente:

```sql
-- 061 Estudio creativo de activos (Fase 1): sesiones + provider gpt-image + pricing.
-- Idempotente. NO se aplica dentro de las tareas; el controller la aplica vía MCP.

-- 1. Tabla de sesiones del estudio (agrupa generaciones de una iteración por activo).
create table if not exists studio_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_type text not null check (asset_type in ('product', 'location', 'character')),
  asset_id uuid not null,
  default_provider text not null default 'nano-banana',
  default_model_id text not null default 'gemini-3-pro-image-preview',
  title text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists studio_sessions_asset_idx
  on studio_sessions (workspace_id, asset_type, asset_id);

alter table studio_sessions enable row level security;

drop policy if exists "studio_sessions_member_read" on studio_sessions;
create policy "studio_sessions_member_read" on studio_sessions
  for select using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "studio_sessions_member_insert" on studio_sessions;
create policy "studio_sessions_member_insert" on studio_sessions
  for insert with check (is_workspace_member(workspace_id));

drop policy if exists "studio_sessions_member_update" on studio_sessions;
create policy "studio_sessions_member_update" on studio_sessions
  for update using (is_workspace_member(workspace_id) or is_admin());

drop policy if exists "studio_sessions_member_delete" on studio_sessions;
create policy "studio_sessions_member_delete" on studio_sessions
  for delete using (is_workspace_member(workspace_id) or is_admin());

-- 2. Etiqueta de sesión en generations (una generación = un turno del chat).
alter table generations
  add column if not exists studio_session_id uuid references studio_sessions(id) on delete set null;

create index if not exists generations_studio_session_idx
  on generations (studio_session_id);

-- 3. Extender el CHECK de provider para aceptar gpt-image (recrear el constraint).
alter table generations drop constraint if exists generations_provider_check;
alter table generations add constraint generations_provider_check
  check (provider in ('veo', 'kling', 'nano-banana', 'flux', 'elevenlabs', 'seedance', 'gpt-image'));

-- 4. Pricing de GPT Image (plano por imagen; variant = calidad para gpt-image-2).
insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('gpt-image', 'gpt-image-2',      'low',     70,  null, null),
  ('gpt-image', 'gpt-image-2',      'medium',  110, null, null),
  ('gpt-image', 'gpt-image-2',      'high',    180, null, null),
  ('gpt-image', 'gpt-image-1',      'default', 60,  null, null),
  ('gpt-image', 'gpt-image-1-mini', 'default', 30,  null, null)
on conflict (provider, model_id, variant) do nothing;
```

- [ ] **Step 2: Verificar la coherencia por lectura** — confirma: (a) el CHECK recreado incluye TODOS los providers previos (`veo, kling, nano-banana, flux, elevenlabs, seedance`) más `gpt-image` (si omites uno, rompes filas existentes); (b) `studio_session_id` es nullable con `on delete set null` (no rompe inserts existentes); (c) las 5 filas de pricing coinciden con los model IDs que usará el adapter (`gpt-image-2`, `gpt-image-1`, `gpt-image-1-mini`) y las variants (`low/medium/high` para gpt-image-2, `default` para los otros). No hay comando de test SQL; es lectura.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/061_studio_sessions.sql
git commit -m "feat(estudio): migracion 061 sesiones + provider gpt-image + pricing"
```

---

### Task 2: Adapter de GPT Image

**Files:**
- Create: `lib/providers/gpt-image.ts`
- Create: `lib/providers/gpt-image.test.ts`

**Interfaces:**
- Consumes: `ProviderError`, `GenerationResult`, `ImageReference` de `@/lib/providers/types` (`ImageReference = { buffer: Buffer; mimeType: string }`, `GenerationResult = { buffer: Buffer; mimeType: string; thoughtSignature?: string; meta?: Record<string, unknown> }`).
- Produces:
  - `type GptImageModel = 'gpt-image-2' | 'gpt-image-1' | 'gpt-image-1-mini'`
  - `type GptImageQuality = 'low' | 'medium' | 'high'`
  - `type GptImageParams = { model: GptImageModel; prompt: string; size?: string; quality?: GptImageQuality; references?: ImageReference[] }`
  - `buildImageRequest(params: GptImageParams): { model: string; prompt: string | { text: string; images: Buffer[] }; size?: string; providerOptions?: Record<string, unknown> }`
  - `interpretImageResult(result: { images: Array<{ base64: string; mediaType?: string }> }): GenerationResult`
  - `generate(params: GptImageParams): Promise<GenerationResult>`

- [ ] **Step 1: Escribir los tests que fallan** — crea `lib/providers/gpt-image.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildImageRequest, interpretImageResult } from './gpt-image';

describe('buildImageRequest', () => {
  it('genera desde texto: prompt string y modelo openai/', () => {
    const req = buildImageRequest({ model: 'gpt-image-1', prompt: 'una taza azul' });
    expect(req.model).toBe('openai/gpt-image-1');
    expect(req.prompt).toBe('una taza azul');
    expect(req.providerOptions).toBeUndefined();
  });

  it('edita: prompt.images lleva los buffers de las referencias (base + refs)', () => {
    const base = { buffer: Buffer.from('base'), mimeType: 'image/png' };
    const ref = { buffer: Buffer.from('ref'), mimeType: 'image/png' };
    const req = buildImageRequest({ model: 'gpt-image-2', prompt: 'ponla en mármol', references: [base, ref] });
    expect(typeof req.prompt).toBe('object');
    const p = req.prompt as { text: string; images: Buffer[] };
    expect(p.text).toBe('ponla en mármol');
    expect(p.images).toEqual([base.buffer, ref.buffer]);
  });

  it('quality solo aplica a gpt-image-2', () => {
    const two = buildImageRequest({ model: 'gpt-image-2', prompt: 'x', quality: 'high' });
    expect(two.providerOptions).toEqual({ openai: { quality: 'high' } });
    const one = buildImageRequest({ model: 'gpt-image-1', prompt: 'x', quality: 'high' });
    expect(one.providerOptions).toBeUndefined();
  });

  it('size se propaga cuando viene', () => {
    const req = buildImageRequest({ model: 'gpt-image-2', prompt: 'x', size: '1024x1024' });
    expect(req.size).toBe('1024x1024');
  });
});

describe('interpretImageResult', () => {
  it('convierte base64 a Buffer con su mimeType', () => {
    const b64 = Buffer.from('hola').toString('base64');
    const out = interpretImageResult({ images: [{ base64: b64, mediaType: 'image/webp' }] });
    expect(out.buffer.toString()).toBe('hola');
    expect(out.mimeType).toBe('image/webp');
  });

  it('default mimeType image/png si el proveedor no lo da', () => {
    const b64 = Buffer.from('x').toString('base64');
    expect(interpretImageResult({ images: [{ base64: b64 }] }).mimeType).toBe('image/png');
  });

  it('sin imagen lanza ProviderError', () => {
    expect(() => interpretImageResult({ images: [] })).toThrow();
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm test lib/providers/gpt-image.test.ts`
Expected: FAIL ("Cannot find module './gpt-image'").

- [ ] **Step 3: Escribir el adapter** — crea `lib/providers/gpt-image.ts`:

```ts
import { experimental_generateImage as generateImage } from 'ai';
import { ProviderError, type GenerationResult, type ImageReference } from '@/lib/providers/types';

// GPT Image por el Vercel AI Gateway (mismo AI_GATEWAY_API_KEY que Nano). A
// diferencia de Nano (generateText -> result.files), aquí se usa generateImage
// -> result.images[].base64. La edición pasa las referencias como prompt.images
// (base + refs, máx 4 por el gateway). El base64 encaja con la regla de que el
// worker sube a Supabase (nunca una URL de proveedor llega al cliente).

export type GptImageModel = 'gpt-image-2' | 'gpt-image-1' | 'gpt-image-1-mini';
export type GptImageQuality = 'low' | 'medium' | 'high';

export type GptImageParams = {
  model: GptImageModel;
  prompt: string;
  size?: string;
  quality?: GptImageQuality; // solo gpt-image-2
  references?: ImageReference[]; // base + refs para editar
};

function toOpenAIGatewayModel(model: GptImageModel): string {
  return `openai/${model}`;
}

export function buildImageRequest(params: GptImageParams): {
  model: string;
  prompt: string | { text: string; images: Buffer[] };
  size?: string;
  providerOptions?: Record<string, unknown>;
} {
  const refs = params.references ?? [];
  const prompt =
    refs.length > 0 ? { text: params.prompt, images: refs.map((r) => r.buffer) } : params.prompt;
  const providerOptions =
    params.model === 'gpt-image-2' && params.quality
      ? { openai: { quality: params.quality } }
      : undefined;
  return {
    model: toOpenAIGatewayModel(params.model),
    prompt,
    ...(params.size ? { size: params.size } : {}),
    ...(providerOptions ? { providerOptions } : {}),
  };
}

export function interpretImageResult(result: {
  images: Array<{ base64: string; mediaType?: string }>;
}): GenerationResult {
  const image = result.images[0];
  if (!image) throw new ProviderError('gpt-image no devolvió imagen', 'unknown', false);
  return { buffer: Buffer.from(image.base64, 'base64'), mimeType: image.mediaType ?? 'image/png' };
}

export async function generate(params: GptImageParams): Promise<GenerationResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const req = buildImageRequest(params);
  try {
    // El AI SDK acepta prompt string | { text, images } para editar; el tipo
    // público es string, por eso el cast controlado (verificado por smoke).
    const result = await generateImage({
      model: req.model,
      prompt: req.prompt as unknown as string,
      ...(req.size ? { size: req.size } : {}),
      ...(req.providerOptions
        ? { providerOptions: req.providerOptions as Parameters<typeof generateImage>[0]['providerOptions'] }
        : {}),
    } as Parameters<typeof generateImage>[0]);
    return interpretImageResult(
      result as unknown as { images: Array<{ base64: string; mediaType?: string }> },
    );
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const message = err instanceof Error ? err.message : 'error desconocido de gpt-image';
    const status = (err as { statusCode?: number } | null)?.statusCode;
    const code = status === 429 ? 'rate_limit' : status === 401 || status === 403 ? 'auth' : 'unknown';
    throw new ProviderError(message, code, code === 'rate_limit');
  }
}
```

> Verifica en `lib/providers/types.ts` que `ProviderError` acepta `(message, code, retryable?)` con los códigos `'rate_limit' | 'auth' | 'unknown' | 'safety' | 'server'` (usa los que existan; si `'rate_limit'`/`'auth'` no existen con ese nombre, usa los equivalentes reales del enum de códigos del repo). No inventes códigos nuevos.

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `pnpm test lib/providers/gpt-image.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/providers/gpt-image.ts lib/providers/gpt-image.test.ts
git commit -m "feat(estudio): adapter de gpt-image (generateImage->base64)"
```

---

### Task 3: Handler de imagen del worker (nano + gpt-image)

**Files:**
- Create: `lib/jobs/handlers/image-turn.ts`
- Create: `lib/jobs/handlers/gpt-image.ts`
- Modify: `lib/jobs/handlers/nano-banana.ts`
- Modify: `lib/jobs/handlers/register.ts`
- Modify: `lib/jobs/handlers/types.ts`

**Interfaces:**
- Consumes: `generate` de `@/lib/providers/gpt-image` (Task 2); `generate` de `@/lib/providers/nano-banana` (`generate(params: NanoBananaParams): Promise<GenerationResult>`); el patrón de resolución de `reference_ids`→buffers que ya usa `lib/jobs/handlers/nano-banana.ts` para storyboard (reutilízalo, no dupliques la descarga de storage); `GenerationRow` de `types.ts`.
- Produces:
  - `JobResult` gana la variante `{ kind: 'skip' }` (no-op: ni finalize, ni fail, ni re-encola).
  - `runImageTurn(gen: GenerationRow): Promise<JobResult>` en `image-turn.ts`.
  - handler que mapea `provider: 'gpt-image'` → `runImageTurn`.
  - `nano-banana` handler enruta turnos de estudio (sin `params.storyboard`) a `runImageTurn`.

- [ ] **Step 1: Extender `JobResult` y `GenerationRow`** — en `lib/jobs/handlers/types.ts`: añade `| { kind: 'skip' }` a la unión `JobResult`, y añade `'gpt-image'` al tipo del campo `provider` de `GenerationRow` (hoy incluye `'veo'|'kling'|'nano-banana'|'seedance'|'elevenlabs'`; agrega `'gpt-image'`). No cambies las variantes existentes.

- [ ] **Step 2: Escribir `runImageTurn`** — crea `lib/jobs/handlers/image-turn.ts`. Lógica: (1) **claim atómico** `queued→processing` con el admin client (`update generations set status='processing' where id=gen.id and status='queued'` con `count:'exact'`); si `count===0` → `return { kind: 'skip' }` (otra invocación de QStash ya lo tomó — no cobres/reembolses dos veces). (2) Resolver `gen.reference_ids` a `ImageReference[]` con el MISMO helper de descarga de storage que usa el handler de storyboard (impórtalo; no reimplementes la firma+descarga). (3) Según `gen.provider`: `gpt-image` → `generateGptImage({ model: gen.model_id as GptImageModel, prompt: gen.prompt ?? '', quality: (gen.params?.quality as GptImageQuality | undefined), size: (gen.params?.size as string | undefined), references })`; `nano-banana` → `generateNano({ model: gen.model_id, prompt: gen.prompt ?? '', aspectRatio: (gen.params?.aspectRatio as string) ?? '1:1', resolution: (gen.params?.resolution as string) ?? '2k', references })` (usa los nombres reales de `NanoBananaParams`; verifícalos en `lib/providers/nano-banana.ts`). (4) Éxito → `return { kind: 'finalize', outputBuffer: result.buffer, mimeType: result.mimeType, metadata: result.meta ?? null }`. (5) `catch (ProviderError)` → `return { kind: 'fail', message: err.message, code: mapCode(err) }` donde `mapCode` traduce el código del ProviderError al enum `'safety'|'rate_limit'|'timeout'|'unknown'` de `JobResult` (defaultea a `'unknown'`).

```ts
import { createAdminClient } from '@/lib/supabase/admin';
import { generate as generateGptImage, type GptImageModel, type GptImageQuality } from '@/lib/providers/gpt-image';
import { generate as generateNano } from '@/lib/providers/nano-banana';
import { nanoVariantToResolution } from '@/server-actions/generations'; // reutiliza el mismo mapeo variant->resolución del submit inline; si no está exportado ahí, expórtalo o muévelo a un módulo compartido (p. ej. lib/providers/nano-banana.ts)
import { ProviderError, type ImageReference } from '@/lib/providers/types';
import { resolveReferenceBuffers } from '@/lib/jobs/handlers/nano-banana'; // export el helper existente de descarga de refs; si no está exportado, expórtalo en este mismo task
import type { GenerationRow, JobResult } from '@/lib/jobs/handlers/types';

function mapCode(err: ProviderError): 'safety' | 'rate_limit' | 'timeout' | 'unknown' {
  const c = (err as { code?: string }).code;
  if (c === 'safety') return 'safety';
  if (c === 'rate_limit') return 'rate_limit';
  if (c === 'timeout') return 'timeout';
  return 'unknown';
}

export async function runImageTurn(gen: GenerationRow): Promise<JobResult> {
  const admin = createAdminClient();
  const { count } = await admin
    .from('generations')
    .update({ status: 'processing' })
    .eq('id', gen.id)
    .eq('status', 'queued')
    .select('id', { count: 'exact', head: true });
  if (count === 0) return { kind: 'skip' };

  const params = (gen.params ?? {}) as Record<string, unknown>;
  const variant = (params.variant as string) ?? '';
  const references: ImageReference[] = await resolveReferenceBuffers(gen.workspace_id, gen.reference_ids ?? []);

  try {
    if (gen.provider === 'gpt-image') {
      // gpt-image-2 usa la variant como quality; gpt-image-1/mini no llevan quality.
      const quality = gen.model_id === 'gpt-image-2' ? (variant as GptImageQuality) : undefined;
      const result = await generateGptImage({
        model: gen.model_id as GptImageModel,
        prompt: gen.prompt ?? '',
        quality,
        size: params.size as string | undefined,
        references,
      });
      return { kind: 'finalize', outputBuffer: result.buffer, mimeType: result.mimeType, metadata: result.meta ?? null };
    }
    // nano: la variant ('1k'/'2k'/'4k') se mapea a la resolución que espera el
    // provider con el MISMO helper que usa submitGenerationAction.
    const result = await generateNano({
      model: gen.model_id,
      prompt: gen.prompt ?? '',
      aspectRatio: (params.aspectRatio as string) ?? '1:1',
      resolution: nanoVariantToResolution(variant),
      references,
    });
    return { kind: 'finalize', outputBuffer: result.buffer, mimeType: result.mimeType, metadata: result.meta ?? null };
  } catch (err) {
    if (err instanceof ProviderError) return { kind: 'fail', message: err.message, code: mapCode(err) };
    return { kind: 'fail', message: err instanceof Error ? err.message : 'error de generación', code: 'unknown' };
  }
}
```

> Ajusta los nombres de campo (`resolveReferenceBuffers`, `createAdminClient`, la firma de `NanoBananaParams`, `GenerationRow.reference_ids/workspace_id/params/prompt/model_id/provider`) a los reales del repo verificándolos antes de escribir. Si el helper de descarga de refs del storyboard no está exportado, expórtalo (nombre `resolveReferenceBuffers`) sin cambiar su comportamiento.

- [ ] **Step 3: Handler de `gpt-image`** — crea `lib/jobs/handlers/gpt-image.ts`:

```ts
import { runImageTurn } from '@/lib/jobs/handlers/image-turn';
import type { JobHandler } from '@/lib/jobs/handlers/types';

// GPT Image es one-shot (sin polling): la acción se ignora, se genera y finaliza.
export const gptImageHandler: JobHandler = {
  handle: (gen) => runImageTurn(gen),
};
```

> Usa la forma real de `JobHandler`/registro que exista en `types.ts`/`register.ts` (el repo registra por side-effect: `handlers['gpt-image'] = ...`). Espeja exactamente cómo `elevenlabs` (one-shot) se define y registra.

- [ ] **Step 4: Enrutar turnos de estudio en el handler de Nano** — en `lib/jobs/handlers/nano-banana.ts`, al inicio de `handle`, antes del path de storyboard: si NO hay `gen.params.storyboard` (es un turno de estudio), `return runImageTurn(gen)`. Conserva intacto el flujo de storyboard cuando `params.storyboard` existe. Importa `runImageTurn` de `@/lib/jobs/handlers/image-turn`.

- [ ] **Step 5: Registrar `gpt-image`** — en `lib/jobs/handlers/register.ts`, añade el registro de `gptImageHandler` para la clave `'gpt-image'`, junto a los existentes (`elevenlabs, kling, nano-banana, seedance, veo`).

- [ ] **Step 6: Manejar `kind:'skip'` — nota** — el worker (`route.ts`) debe tratar `kind:'skip'` sin efectos; eso se implementa en la Task 5. Aquí solo se produce el `skip`.

- [ ] **Step 7: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: sin errores (el build valida que el `route.ts` aún compila; el manejo de `skip` llega en Task 5, así que por ahora `route.ts` puede no cubrir `skip` — si el `switch` es exhaustivo y falla el typecheck, añade el caso `skip` como no-op en este task en vez de la Task 5, y anótalo).

- [ ] **Step 8: Commit**

```bash
git add lib/jobs/handlers/image-turn.ts lib/jobs/handlers/gpt-image.ts lib/jobs/handlers/nano-banana.ts lib/jobs/handlers/register.ts lib/jobs/handlers/types.ts
git commit -m "feat(estudio): handler de imagen del worker (nano + gpt-image, one-shot)"
```

---

### Task 4: Schemas + server actions del estudio + test de estimador

**Files:**
- Create: `lib/schemas/studio.ts`
- Create: `lib/schemas/studio.test.ts`
- Create: `server-actions/studio.ts`
- Create: `lib/credits/estimator.gpt-image.test.ts`
- Modify: `lib/jobs/queue.ts`

**Interfaces:**
- Consumes: `estimateCredits`/`findRow` de `@/lib/credits/estimator`; `reserveCredits` de `@/lib/credits/operations`; `enqueueJob` de `@/lib/jobs/queue`; `requireWorkspace` (patrón de las otras server actions); `Result<T>`.
- Produces:
  - `CreateStudioSessionSchema`, `SubmitStudioTurnSchema` (zod) + tipos inferidos.
  - `createStudioSessionAction(input): Promise<Result<{ id: string }>>`
  - `submitStudioTurnAction(input): Promise<Result<{ generationId: string }>>`
  - `listStudioSessionGenerationsAction(sessionId: string): Promise<Result<StudioGeneration[]>>`
  - `EnqueueJobInput` gana `timeoutSeconds?: number`.

- [ ] **Step 1: Escribir el test de schemas que falla** — crea `lib/schemas/studio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CreateStudioSessionSchema, SubmitStudioTurnSchema } from './studio';

describe('CreateStudioSessionSchema', () => {
  it('acepta un activo válido con provider por defecto', () => {
    const r = CreateStudioSessionSchema.safeParse({ assetType: 'product', assetId: '11111111-1111-1111-1111-111111111111' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.provider).toBe('nano-banana');
  });
  it('rechaza assetType inválido', () => {
    expect(CreateStudioSessionSchema.safeParse({ assetType: 'brand', assetId: '11111111-1111-1111-1111-111111111111' }).success).toBe(false);
  });
});

describe('SubmitStudioTurnSchema', () => {
  const base = {
    sessionId: '11111111-1111-1111-1111-111111111111',
    provider: 'gpt-image',
    model: 'gpt-image-2',
    variant: 'medium',
    prompt: 'una taza azul sobre mármol',
  };
  it('acepta un turno válido', () => {
    expect(SubmitStudioTurnSchema.safeParse(base).success).toBe(true);
  });
  it('rechaza prompt vacío', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, prompt: '' }).success).toBe(false);
  });
  it('rechaza más de 6 referencias', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, referenceIds: Array(7).fill('11111111-1111-1111-1111-111111111111') }).success).toBe(false);
  });
  it('rechaza provider desconocido', () => {
    expect(SubmitStudioTurnSchema.safeParse({ ...base, provider: 'flux' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr para ver fallar**

Run: `pnpm test lib/schemas/studio.test.ts`
Expected: FAIL ("Cannot find module './studio'").

- [ ] **Step 3: Escribir los schemas** — crea `lib/schemas/studio.ts`:

```ts
import { z } from 'zod';

export const StudioProviderSchema = z.enum(['nano-banana', 'gpt-image']);
export const StudioAssetTypeSchema = z.enum(['product', 'location', 'character']);

export const CreateStudioSessionSchema = z.object({
  assetType: StudioAssetTypeSchema,
  assetId: z.string().uuid(),
  provider: StudioProviderSchema.default('nano-banana'),
  modelId: z.string().min(1).default('gemini-3-pro-image-preview'),
});
export type CreateStudioSessionInput = z.infer<typeof CreateStudioSessionSchema>;

export const SubmitStudioTurnSchema = z.object({
  sessionId: z.string().uuid(),
  provider: StudioProviderSchema,
  model: z.string().min(1),
  variant: z.string().min(1), // '1k'/'2k'/'4k' (nano) | 'low'/'medium'/'high' (gpt-image-2) | 'default'
  prompt: z.string().min(1).max(12000),
  referenceIds: z.array(z.string().uuid()).max(6).optional(),
  parentGenerationId: z.string().uuid().nullable().optional(),
  keepIdentical: z.boolean().optional(),
  aspectRatio: z.string().optional(),
});
export type SubmitStudioTurnInput = z.infer<typeof SubmitStudioTurnSchema>;
```

- [ ] **Step 4: Correr para ver pasar**

Run: `pnpm test lib/schemas/studio.test.ts`
Expected: PASS.

- [ ] **Step 5: Test de pricing plano de gpt-image** — crea `lib/credits/estimator.gpt-image.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { estimateCredits } from './estimator';

const rows = [
  { provider: 'gpt-image', model_id: 'gpt-image-2', variant: 'medium', credits_cost: 110, unit_size: null, unit_label: null },
  { provider: 'gpt-image', model_id: 'gpt-image-1', variant: 'default', credits_cost: 60, unit_size: null, unit_label: null },
];

describe('estimateCredits gpt-image (plano por imagen)', () => {
  it('gpt-image-2 medium = 110', () => {
    expect(estimateCredits(rows, { provider: 'gpt-image', model: 'gpt-image-2', variant: 'medium' })).toBe(110);
  });
  it('gpt-image-1 default = 60', () => {
    expect(estimateCredits(rows, { provider: 'gpt-image', model: 'gpt-image-1', variant: 'default' })).toBe(60);
  });
});
```

> Ajusta la forma de `EstimateInput` (`{ provider, model, variant, params? }`) y de las filas a las reales del estimador. El objetivo: confirmar que gpt-image sin `unit_size` da costo plano y no requiere rama nueva en el estimador. Si el estimador lanzara por falta de rama, añade la rama mínima; si pasa tal cual, no toques `estimator.ts`.

- [ ] **Step 6: Correr el test del estimador**

Run: `pnpm test lib/credits/estimator.gpt-image.test.ts`
Expected: PASS.

- [ ] **Step 7: `enqueueJob` con timeout de QStash** — en `lib/jobs/queue.ts`: añade `timeoutSeconds?: number` a `EnqueueJobInput` y pásalo a `publishJSON` como timeout de QStash (header/opción `timeout`), de modo que QStash espere hasta ~300s la respuesta del worker antes de reintentar (sin esto, un job de imagen largo dispararía reintentos y doble-generación). No cambies el comportamiento por defecto cuando `timeoutSeconds` es undefined.

- [ ] **Step 8: Escribir las server actions** — crea `server-actions/studio.ts` con `'use server'` + `import 'server-only'`. Espeja el patrón de las server actions existentes (`Result<T>`, `requireWorkspace`, validación zod, ownership por `workspace_id`). Detalle:
  - `createStudioSessionAction(input)`: `CreateStudioSessionSchema.safeParse`; `requireWorkspace`; verifica que `assetId` pertenece al workspace (SELECT del activo según `assetType`); inserta en `studio_sessions` (`workspace_id`, `asset_type`, `asset_id`, `default_provider: provider`, `default_model_id: modelId`); devuelve `{ id }`.
  - `submitStudioTurnAction(input)`: `SubmitStudioTurnSchema.safeParse`; `requireWorkspace`; carga la sesión (ownership por `workspace_id`); calcula `cost = estimateCredits(pricingRows, { provider, model, variant, params })` (carga pricing con `loadPricing()`); genera `generationId` (`crypto.randomUUID()`); **reserva créditos** `reserveCredits(user.id, cost, generationId)` (si `false` → `insufficient_credits`); inserta la fila en `generations` con `id: generationId, user_id, workspace_id, type: 'image', provider, model_id: model, prompt, params: { studioTurn: true, variant, aspectRatio, keepIdentical }, reference_ids: referenceIds ?? [], parent_generation_id: parentGenerationId ?? null, studio_session_id: sessionId, status: 'queued', timeout_at: new Date(Date.now() + 6*60*1000).toISOString(), credits_estimated: cost` (el handler interpreta `variant` por proveedor: quality para gpt-image-2, `nanoVariantToResolution` para nano); **encola** `enqueueJob({ generationId, action: 'submit', timeoutSeconds: 300 })`; devuelve `{ generationId }`. Si el enqueue falla, marca la generación `failed` y reembolsa (`failGeneration`).
  - `listStudioSessionGenerationsAction(sessionId)`: ownership de la sesión; SELECT de `generations where studio_session_id = sessionId order by created_at`, devolviendo `{ id, status, output_url, thumbnail_url, prompt, provider, model_id, params, created_at }` como `StudioGeneration[]`.

  > Reglas: sin `any` (narrowing sobre los rows de Supabase con casts explícitos como en las otras actions); reserva créditos ANTES de encolar; la confirmación/reembolso final la hace el worker (finalize→`complete_generation`, fail→`fail_generation`). Verifica los nombres reales de `reserveCredits`/`failGeneration`/`loadPricing`/`requireWorkspace` antes de escribir.

- [ ] **Step 9: Verificar**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: typecheck limpio; build compila; toda la suite verde (incluye los nuevos tests de schema/estimator).

- [ ] **Step 10: Commit**

```bash
git add lib/schemas/studio.ts lib/schemas/studio.test.ts server-actions/studio.ts lib/credits/estimator.gpt-image.test.ts lib/jobs/queue.ts
git commit -m "feat(estudio): schemas + server actions del estudio (encola turno como job)"
```

---

### Task 5: Subir el worker a 300s + manejar `kind:'skip'`

**Files:**
- Modify: `app/api/jobs/process/route.ts`

**Interfaces:**
- Consumes: `JobResult` con la variante `{ kind: 'skip' }` (Task 3).

- [ ] **Step 1: Subir `maxDuration`** — en `app/api/jobs/process/route.ts`, cambia `export const maxDuration = 60;` por `export const maxDuration = 300;`. Deja `runtime = 'nodejs'` y `dynamic = 'force-dynamic'` como están. Añade un comentario de una línea: `// 300s: una llamada de imagen (gpt-image-2) bloquea hasta ~280s; ver spec estudio`.

- [ ] **Step 2: Manejar `skip`** — en el bloque que procesa el `result` de `dispatchJob` (donde hoy hay ramas `continue`/`fail`/`finalize`), añade una rama `if (result.kind === 'skip') { return NextResponse.json({ ok: true, skipped: true }); }` ANTES de las demás (o en el switch, un caso `skip` que responde 200 sin tocar la generación, sin re-encolar, sin reembolsar). Un `skip` significa que otra invocación de QStash ya reclamó la generación; responder 200 evita que QStash reintente.

- [ ] **Step 3: Verificar coherencia por lectura** — confirma: (a) `skip` no llama `failGeneration` ni `finalizeGeneration` ni `enqueueJob`; (b) responde 200 (para cortar reintentos de QStash); (c) el resto de ramas (`continue`/`fail`/`finalize`) quedan intactas.

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm build`
Expected: sin errores; el `switch`/if de `result.kind` es exhaustivo (incluye `skip`).

- [ ] **Step 5: Commit**

```bash
git add app/api/jobs/process/route.ts
git commit -m "feat(estudio): worker a 300s + maneja kind skip (idempotencia de imagen)"
```

---

## Cierre de fase

- **Aplicar migración 061 a prod vía MCP** (con confirmación del usuario), ANTES de que cualquier código que lea `studio_sessions`/`studio_session_id`/`gpt-image` llegue a producción (orden de despliegue). Verificar el backfill trivial (tabla nueva vacía; columna nullable; CHECK recreado con todos los providers; 5 filas de pricing).
- **Smoke del usuario (con key real):** (1) `submitStudioTurnAction` con `provider:'nano-banana'` → job encolado → worker genera → generación `done` con output en Storage y créditos confirmados. (2) Lo mismo con `provider:'gpt-image', model:'gpt-image-1'`. (3) **Compuerta de edición gpt-image por gateway:** un turno gpt-image con `referenceIds` (edición = MISMO modelo + imagen de entrada, no un modelo aparte) → si el gateway NO acepta `prompt.images` para gpt-image, gpt-image queda **generación-only** y la edición se ofrece solo con Nano. **SIN fallback a `OPENAI_API_KEY` directo (decisión firme: todo por el gateway).** (4) Confirmar en el deploy que `maxDuration=300` toma efecto en la org de Vercel.
- **Review final de rama** (delta Fase 1, opus) antes de seguir con la Fase 2 (estudio + chat UI).
- Fases siguientes (2-5) tendrán su propio plan, siguiendo el precedente de V3.
