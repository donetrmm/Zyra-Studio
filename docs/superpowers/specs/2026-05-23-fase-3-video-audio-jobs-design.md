# Fase 3 — Video, Audio y Cola de Jobs (design)

> Spec derivado de `specs/03-video-audio-jobs.md` + decisiones tomadas en brainstorming 2026-05-23.
> Esta es la fuente de verdad para Fase 3. Sustituye al spec original en los puntos donde difiera.

## Decisiones de scope (vs spec original)

| Decisión | Resolución |
|---|---|
| Migrar imagen al worker | **NO**. Nano Banana y FLUX siguen síncronos. Solo video/audio largo van por QStash. |
| Orden de adapters | ElevenLabs → Kling → Veo (end-to-end por proveedor, no por capa) |
| Features audio | TTS + Sound effects + Voice cloning. Dubbing fuera (fase 5). |
| Features video | Veo Fast 1080p + Veo Standard + Veo Lite + Kling Pro (5s y 10s) + Kling Omni lip-sync + image-to-video + cancelación. Sin 4K, sin last-frame. |
| Cleanup endpoint | Sí, junto con el worker |
| Thumbnail de video | `@ffmpeg-installer/ffmpeg` instalado con `pnpm` |
| Estructura del worker | Monolítico con dispatch table interna (lib/jobs/dispatch.ts) |

## Pre-requisitos

- Fases 1 y 2 completas y mergeadas a main
- API keys: `KLING_API_KEY`, `KLING_API_SECRET`, `ELEVENLABS_API_KEY`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `PUBLIC_URL` (Veo reusa `GEMINI_API_KEY` ya configurada en Fase 2)
- Cuenta Upstash con QStash habilitado
- `pnpm` (no npm)

## Arquitectura

### Worker — flow

```
QStash POST → /api/jobs/process
   │
   ├─ 1. Receiver.verify(signature) → 401 si falla (antes de leer body)
   ├─ 2. zod parse body: { generationId, action: 'submit' | 'poll' }
   ├─ 3. createAdminClient().from('generations').select().eq(id).single()
   ├─ 4. guard: status terminal (done|failed|canceled) → 200 ack, exit
   ├─ 5. guard: cancel_requested || now() > timeout_at → cancelGeneration, 200
   ├─ 6. dispatch[provider]({ gen, action })
   │      retorna: { kind: 'continue', taskId?, delay }
   │             | { kind: 'finalize', outputBuffer, mimeType, metadata? }
   │             | { kind: 'fail', message, code }
   ├─ 7a. continue → update provider_task_id + status='processing' + re-encolar
   ├─ 7b. finalize → finalizeGeneration(gen, result) (download already done por handler)
   └─ 7c. fail → fail_generation RPC + 200
```

### Archivos nuevos

```
app/api/jobs/
  process/route.ts         ← worker (entrypoint, runtime=nodejs, maxDuration=60)
  cleanup/route.ts         ← schedule diario QStash
lib/jobs/
  queue.ts                 ← Client QStash + publishJSON helper
  receiver.ts              ← Receiver wrapper (signature verify)
  dispatch.ts              ← map { provider: handler } + invocación
  finalize.ts              ← finalizeGeneration: upload → thumbnail → complete_generation
  cleanup.ts               ← lógica del schedule diario
  handlers/
    types.ts               ← JobHandler interface + JobResult discriminated union
    veo.ts                 ← submit/poll/cancel para Veo (omite cancel — no soportado remoto)
    kling.ts               ← submit/poll/cancel para Kling
    elevenlabs.ts          ← TTS + sound effect + voice clone (síncrono en una invocación)
lib/providers/
  veo.ts                   ← cliente HTTP de Veo (REST + auth)
  kling.ts                 ← cliente HTTP de Kling
  elevenlabs.ts            ← cliente HTTP de ElevenLabs + chunking MP3
lib/media-references/
  upload-audio-client.ts   ← análogo al upload-client de imagen, para voice samples
server-actions/
  voices.ts                ← submit / test / delete voice clones
components/generation/
  VideoGenerator.tsx       ← componente raíz de /app/create/video
  VideoControlsPanel.tsx
  VideoPreview.tsx
  AudioGenerator.tsx       ← componente raíz de /app/create/audio
  AudioControlsPanel.tsx
  AudioPreview.tsx
  use-generation-status.ts ← hook Realtime para video y audio
components/voices/
  VoicesGrid.tsx           ← grid de /app/voices
  VoiceCard.tsx
  TestVoiceDialog.tsx      ← modal "Probar voz"
app/app/create/video/page.tsx
app/app/create/audio/page.tsx
app/app/voices/page.tsx
docs/setup/
  qstash.md                ← setup manual de QStash (tokens, schedule cleanup)
  smoke-test-fase3.md      ← checklist de verificación final
```

### Interfaz común `JobHandler`

```typescript
// lib/jobs/handlers/types.ts
export type JobAction = 'submit' | 'poll';

export type JobResult =
  | { kind: 'continue'; taskId?: string; delaySeconds: number }
  | { kind: 'finalize'; outputBuffer: Buffer; mimeType: string; metadata?: Record<string, unknown> }
  | { kind: 'fail'; message: string; code: 'safety' | 'rate_limit' | 'timeout' | 'unknown' };

export interface JobHandler {
  handle(gen: GenerationRow, action: JobAction): Promise<JobResult>;
  cancel?(gen: GenerationRow): Promise<void>;  // opcional (Kling sí, Veo no)
}
```

### Idempotencia

QStash garantiza at-least-once. El flow respeta:
- Status terminal guard antes de ejecutar lógica (paso 4)
- `complete_generation` y `fail_generation` ya idempotentes (migración 010, fase 2)
- `poll_attempts` se incrementa con `UPDATE ... WHERE poll_attempts = <expected>` para evitar dobles incrementos

## DB — Migración 013

```sql
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

-- Policies: solo owner accede a sus samples
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
  ('kling',      'kling-v2.6-pro',                 'standard', 200, 5,    'video'),
  ('kling',      'kling-v2.6-pro',                 'long',     400, 10,   'video'),
  ('kling',      'kling-3-0-omni',                 'lip-sync', 500, 5,    'video'),
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

Notas:
- Pricing inicial es tentativo; se ajusta tras la primera ronda de costos reales del provider.
- No se agregan columnas nuevas a `generations` — `provider_task_id` y `provider_payload` ya cubren.
- Realtime ya activo en `generations` (migración 004).
- Buckets `outputs`, `references`, `thumbnails` ya existen (fase 2).

## Adapters

### ElevenLabs

**Cliente** (`lib/providers/elevenlabs.ts`):

```typescript
export async function tts(params: {
  text: string;
  voiceId: string;
  modelId: 'eleven_multilingual_v2' | 'eleven_flash_v2_5' | 'eleven_v3';
  voiceSettings?: { stability: number; similarity_boost: number; style?: number };
  languageCode?: string;
}): Promise<Buffer>;

export async function soundEffect(params: {
  text: string;
  durationSeconds?: number;
}): Promise<Buffer>;

export async function cloneVoice(params: {
  name: string;
  description?: string;
  samples: { buffer: Buffer; filename: string; mimeType: string }[];
}): Promise<{ voiceId: string }>;

export async function deleteVoice(voiceId: string): Promise<void>;
```

**Chunking en TTS** (crítico):
- Si `text.length > 4000`: split por frases (regex `/[.!?]+\s+/`)
- Cap de 3000 chars por chunk
- Concat raw de buffers MP3 (funciona porque MP3 es frame-based — validar con prueba de 6000 chars que no hay artefactos audibles)
- Si hay artefactos: pasar a `lamejs` para re-encode (fallback, no implementar hasta que se compruebe necesario)

**Handler** (`lib/jobs/handlers/elevenlabs.ts`):
- TTS y sound effect: síncronos dentro de los 60s del worker → siempre retornan `{ kind: 'finalize', outputBuffer, mimeType: 'audio/mpeg' }`
- No usan polling (no incrementan `poll_attempts`)
- `voice_clone` NO usa la cola `generations` — usa la tabla `voice_clones`. El submitVoiceCloneAction llama directamente al cliente `cloneVoice` desde el server action (síncrono, ~10-30s, cabe en los 60s de Vercel). Si en el futuro un provider de cloning requiere polling, se agrega un handler dedicado tipo `JobHandler` que actualice `voice_clones` en lugar de `generations` — fuera de scope de Fase 3.

### Kling

**Cliente** (`lib/providers/kling.ts`):

```typescript
export type KlingOperation = 'text2video' | 'image2video' | 'lip-sync';

export async function submitTask(params: {
  operation: KlingOperation;
  model: 'kling-v2.6-pro' | 'kling-3-0-omni';
  prompt?: string;
  negativePrompt?: string;
  imageUrl?: string;       // image2video
  videoUrl?: string;       // lip-sync input video
  audioUrl?: string;       // lip-sync input audio
  duration: 5 | 10;
  aspectRatio: '16:9' | '9:16' | '1:1';
  cfgScale?: number;
  cameraControl?: Record<string, unknown>;
}): Promise<{ taskId: string }>;

export async function pollTask(taskId: string): Promise<{
  status: 'processing' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}>;

export async function cancelTask(taskId: string): Promise<void>;

export async function downloadVideo(url: string): Promise<Buffer>;
```

**Handler**:
- `action='submit'`: llama `submitTask`, guarda `provider_task_id`, retorna `{ kind: 'continue', taskId, delaySeconds: 10 }`
- `action='poll'`: `pollTask` →
  - `processing` → `continue` con delay creciente (10s primeras 6 veces, después 20s)
  - `completed` → descarga buffer, retorna `finalize`
  - `failed` → retorna `fail`
- `cancel(gen)`: llama `cancelTask` (best-effort, errores logged pero no propagados)
- `MAX_POLLS = 30` (~5-10 min). Si se excede → handler retorna `fail` con `code: 'timeout'`

### Veo

**Cliente** (`lib/providers/veo.ts`):

```typescript
export async function submitOperation(params: {
  model: 'veo-3.1-fast-generate-preview' | 'veo-3.1-generate-preview' | 'veo-3.1-lite-generate-preview';
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '16:9' | '9:16';
  resolution: '720p' | '1080p';
  durationSeconds: 4 | 6 | 8;
  imageReference?: { mimeType: string; data: string };  // base64 para image-to-video
}): Promise<{ operationName: string }>;

export async function pollOperation(operationName: string): Promise<{
  done: boolean;
  videoUri?: string;
  error?: { code: number; message: string };
}>;

export async function downloadVideo(uri: string): Promise<Buffer>;  // requiere x-goog-api-key
```

**Handler**:
- Similar al de Kling pero con delays más largos: 15s primeras 4 veces, después 30s
- `MAX_POLLS = 24` (~10 min total)
- Inyecta `personGeneration: 'allow_adult'` siempre
- NO expone `cancel` — Veo no tiene endpoint de cancelación remota; cancel local solo
- Image reference: trunca a 3 máximo si vienen varias

### Finalize compartido (`lib/jobs/finalize.ts`)

```typescript
async function finalizeGeneration(
  gen: GenerationRow,
  outputBuffer: Buffer,
  mimeType: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // 1. inferir extensión por mimeType
  // 2. uploadOutput(workspaceId, gen.id, buffer, mimeType, ext) → outputPath
  // 3. thumbnail según gen.type:
  //    - 'image': sharp resize 512px (ya existe en fase 2)
  //    - 'video': ffmpeg -ss 0 -frames:v 1 -vf scale=512:-1 (via @ffmpeg-installer/ffmpeg)
  //    - 'audio': null (UI usa icono de placa)
  // 4. uploadThumbnail si aplica → thumbPath
  // 5. completeGeneration({ userId, generationId, cost, outputUrl: outputPath,
  //                         thumbnailUrl: thumbPath, processingMs, fileSizeBytes,
  //                         providerPayload: metadata })
  // 6. revalidatePath('/app/library')
}
```

FFmpeg invocation:
```typescript
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';
// pipe inputBuffer → ffmpeg stdin → output JPEG buffer en stdout
```

## UIs

### `/app/create/video`

**Componente raíz**: `VideoGenerator.tsx` (paralelo a `ImageGenerator` de fase 2).

**Controles** (`VideoControlsPanel.tsx`):
- Selector modelo cards: **Auto** | **Veo Fast 1080p** | **Veo Std 1080p** | **Veo Lite 1080p** | **Kling Pro 5s** | **Kling Pro 10s** | **Kling Omni (lip-sync)**
- Textarea prompt (con `scroll-thin`). Negative prompt opcional para Kling
- Aspect ratio: 16:9 / 9:16 / 1:1 (Kling también)
- Veo: duración (4/6/8s), toggle "Imagen inicial" → file picker o picker de referencia del workspace
- Kling Pro: cfg_scale slider (collapsible)
- Kling Omni (lip-sync):
  - Picker de **video** previo del workspace (select filtrado por `generations.type='video' AND status='done'`)
  - Picker de **audio** previo del workspace (select filtrado por `generations.type='audio' AND status='done'`)
- `ReferencesPanel` para image2video (reusa el de fase 2)
- Cost preview en vivo (multiplica créditos por duración seleccionada) + ETA + botón **Generar**

**Main** (`VideoPreview.tsx`):
- **Pending (status processing)**:
  - Video placeholder con progress bar indeterminate
  - Texto rotativo ("Componiendo escena", "Renderizando frames", "Aplicando estilo")
  - "Esto puede tomar hasta 6 min"
  - Botón **Cancelar** (solo visible si processing)
- **Done**:
  - `<video controls autoPlay muted playsInline>` con thumbnail como poster
  - Chips de acción: Descargar (vía `downloadGenerationImage` adaptado para video), Usar como ref para imagen, Generar otra vez
- **Failed / Canceled**:
  - Mensaje claro + créditos refundeados visible
  - Botón "Reintentar con mismo prompt"

### `/app/create/audio`

**Componente raíz**: `AudioGenerator.tsx`. Tabs (shadcn): **Texto a voz** | **Efecto de sonido** | **Clonar voz**.

**Tab TTS**:
- Selector de voz: dropdown con voces oficiales hardcoded (~6) + voces clonadas del workspace
- Textarea con contador de chars y costo en vivo
- Selector de modelo: Multilingual v2 | Flash v2.5 | V3
- Idioma (dropdown, solo aplica a Multilingual)
- Sliders: stability, similarity_boost, style (solo V3)
- Si V3: chip-picker de tags expresivos (`[whispers]`, `[laughs]`, `[shouting]`) que inserta en la posición del cursor
- Botón **Generar**

**Tab Sound Effect**:
- Textarea + duración opcional (0.5-22s)
- Botón **Generar**

**Tab Voice Clone**:
- Dropzone para 1-2 archivos audio (mp3/wav/webm, max 50MB c/u)
- Inputs: nombre + descripción
- Costo en vivo (200 cr)
- Botón **Clonar voz** → al completar, toast + redirect a `/app/voices`

**Main** (`AudioPreview.tsx`):
- **Pending TTS**: spinner + "Generando voz…" + cancelar
- **Pending Voice Clone**: spinner + "Procesando muestras…" + barra de progreso
- **Done TTS / Sound**: `<audio controls>` + chips (Descargar MP3, Usar en video [pre-fill lip-sync de Kling Omni], Generar otro)
- **Done Voice Clone**: card con nombre + sample player + botón "Ver en /app/voices"

### `/app/voices`

**Componente raíz**: `VoicesGrid.tsx`.

- Grid (4 cols desktop, 2 mobile) de `VoiceCard` con: nombre, descripción, status badge (pending/ready/failed), sample player auto-generado ("Hola, soy una voz clonada en Zyra Studio")
- Acción **Probar voz** → modal con textarea + "Generar muestra" (TTS, 100-300 chars max)
- Acción **Eliminar** → confirma → `deleteVoiceAction`
- Estado vacío: CTA "Clona tu primera voz" → `/app/create/audio?tab=clone`

### Realtime — patrón común

`use-generation-status.ts` hook reutilizable:
```typescript
function useGenerationStatus(generationId: string | null): {
  status: 'queued' | 'processing' | 'done' | 'failed' | 'canceled';
  errorMessage: string | null;
  outputUrl: string | null;
  thumbnailUrl: string | null;
}
```
Suscribe a `postgres_changes` en la row específica. Lo usan video y audio.

## Cancelación y server actions

### `cancelGenerationAction(generationId)`

```typescript
// server-actions/generations.ts
export async function cancelGenerationAction(input: unknown) {
  // 1. requireWorkspace()
  // 2. zod parse del id
  // 3. supabase.from('generations')
  //      .update({ cancel_requested: true })
  //      .eq('id', id)
  //      .eq('user_id', user.id)
  //      .in('status', ['queued', 'processing'])
  // 4. revalidatePath
}
```

En el worker, paso 5 del flow detecta la bandera:
- Si el handler expone `cancel(gen)` (solo Kling): se llama best-effort con `.catch(err => log)`
- Llamar `fail_generation` con `error_message: 'canceled by user'` y refund automático
- `update generations set status='canceled' where id = ...`
- Retornar 200 al QStash

La UI no espera respuesta del worker — el cambio de status llega vía Realtime cuando el worker procese el siguiente poll (max 10-30s).

### `submitVideoGenerationAction(input)` y `submitAudioGenerationAction(input)`

Análogos al `submitGenerationAction` de imagen pero:
- En lugar de invocar provider sync, encolan en QStash con `body: { generationId, action: 'submit' }`
- Si la publicación a QStash falla → refund + delete generation row
- Si QStash devuelve 429 → server action retorna `{ ok: false, error: 'queue_full', message: 'Demasiados jobs en cola, intenta en un minuto' }`

### `server-actions/voices.ts`

- `submitVoiceCloneAction(input)`:
  - Recibe lista de paths de samples (subidos previamente al bucket `voice-samples` vía `upload-audio-client.ts`)
  - Inserta row en `voice_clones` con `status='pending'`
  - `chargeCredits(user.id, 200, 'voice_clone', ...)` (atómico — si falla, devuelve `insufficient_credits` y elimina la row)
  - Sincrónico: descarga buffers del bucket, llama `cloneVoice` de ElevenLabs (~10-30s, cabe en 60s)
  - Si éxito: update `voice_clones` con `elevenlabs_voice_id` y `status='ready'`
  - Si falla: update `status='failed'`, `refundCharge` 200 cr
  - **No usa QStash** — el flow es síncrono porque ElevenLabs procesa el clone en su lado en ~10-30s y devuelve el voice_id directo
- `testVoiceAction(voiceId, text)`:
  - Wrapper rápido sobre TTS (no usa worker, es sync <5s)
  - Costo: 1 generación TTS normal con el modelo `eleven_flash_v2_5` (más barato), texto capeado a 300 chars. Usa el pricing ya seedeado de Flash (15 cr / 1000 chars → ~5 cr para 300 chars). No requiere pricing nuevo.
  - Crea row en `generations` tipo `audio` para que aparezca en library
  - Retorna URL del MP3 generado
- `deleteVoiceAction(voiceId)`:
  - `DELETE voice_clones` + best-effort `deleteVoice(voiceId)` en ElevenLabs

### `lib/media-references/upload-audio-client.ts`

```typescript
export async function uploadAudioSample(file: File): Promise<UploadResult>;
```
Análogo al de imagen pero para audio. Valida mime/size, pide signed URL al bucket `voice-samples` (path: `{user_id}/{uuid}-{filename}`), PUT directo. No inserta nada en DB (el server action de clone recibe la lista de paths).

## Cleanup endpoint

**`app/api/jobs/cleanup/route.ts`**:

```typescript
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  // 1. Receiver.verify(signature)
  // 2. RPC cleanup_old_data() → counts
  // 3. Listar bucket 'outputs/' (admin client)
  //    filtrar archivos > 24h sin row vivo en generations.output_url
  //    DELETE batch en admin.storage.from('outputs').remove([...])
  // 4. Loggear: { generations, references, notifications, storage_files_deleted }
  // 5. 200 ack
}
```

**Schedule**: registro **una vez** en QStash dashboard con cron `0 4 * * *` UTC (10pm CDMX). El comando para crearlo se documenta en `docs/setup/qstash.md`:
```bash
curl https://qstash.upstash.io/v2/schedules/<URL_DEL_DEPLOY>/api/jobs/cleanup \
  -H "Authorization: Bearer <QSTASH_TOKEN>" \
  -H "Upstash-Cron: 0 4 * * *" \
  -X POST
```

## Variables de entorno

```bash
# .env.local
QSTASH_TOKEN=
QSTASH_CURRENT_SIGNING_KEY=
QSTASH_NEXT_SIGNING_KEY=
QSTASH_URL=https://qstash.upstash.io  # default, opcional
PUBLIC_URL=https://<vercel-deploy>.vercel.app  # base URL del worker

# Veo usa la misma GEMINI_API_KEY que Nano Banana (mismo proyecto en Google AI Studio).
# El scope se controla por modelo en el endpoint, no por key.
# GEMINI_API_KEY ya existe en .env.local desde Fase 2.

KLING_API_KEY=
KLING_API_SECRET=  # Kling usa key + secret HMAC para firmar requests
ELEVENLABS_API_KEY=
```

`docs/setup/api-keys.md` se actualiza con la sección para cada nuevo provider.

## Orden de implementación

### Día 4 — Cola, worker, ElevenLabs end-to-end (~8h)

1. Migración 013 (buckets, pricing, cleanup_old_data RPC). Aplicar vía MCP de Supabase.
2. `lib/jobs/queue.ts` (cliente QStash) + `lib/jobs/receiver.ts` (signature)
3. Worker shell `app/api/jobs/process/route.ts` (signature verify + status guards + dispatch placeholder)
4. `lib/jobs/handlers/types.ts` (JobHandler + JobResult)
5. `lib/jobs/finalize.ts` (upload + thumbnail con sharp; FFmpeg se agrega en paso 7)
6. **ElevenLabs end-to-end**:
   - `lib/providers/elevenlabs.ts` (TTS + chunking)
   - `lib/jobs/handlers/elevenlabs.ts`
   - `server-actions/generations.ts::submitAudioGenerationAction`
   - UI `/app/create/audio` tab TTS
   - Smoke tests #1 y #2 verifican
7. FFmpeg en finalize:
   - `pnpm add @ffmpeg-installer/ffmpeg`
   - Update `finalize.ts` para video
8. **Kling end-to-end**:
   - `lib/providers/kling.ts`
   - `lib/jobs/handlers/kling.ts`
   - UI `/app/create/video` con modelos Kling primero
   - Smoke test #5 verifica
9. **Veo end-to-end**:
   - `lib/providers/veo.ts`
   - `lib/jobs/handlers/veo.ts`
   - Extender UI con modelos Veo
   - Smoke tests #6 y #7 verifican

### Día 5 — Audio extras, voice clone, lip-sync, cleanup (~8h)

10. ElevenLabs sound effect (handler + UI tab)
11. Voice clone:
    - `lib/media-references/upload-audio-client.ts`
    - `lib/providers/elevenlabs.ts::cloneVoice` y `deleteVoice`
    - `server-actions/voices.ts` (submit + test + delete)
    - UI `/app/create/audio` tab Clone + página `/app/voices`
    - Smoke test #4 verifica
12. Kling Omni lip-sync:
    - Extender adapter Kling con operación `lip-sync`
    - UI selector con pickers de audio/video previos
    - Smoke test #8 verifica
13. Cancelación end-to-end:
    - `cancelGenerationAction`
    - Botón UI en VideoPreview
    - Worker guard en paso 5
    - Smoke test #9 verifica
14. Cleanup endpoint:
    - `app/api/jobs/cleanup/route.ts`
    - Registro de schedule en QStash dashboard
    - Smoke test #11 verifica
15. Realtime status hook (`use-generation-status.ts`) en `/app/create/video` y `/app/create/audio`
16. `docs/setup/qstash.md` (nuevo) + `docs/setup/api-keys.md` actualizado
17. `docs/setup/smoke-test-fase3.md` final con resultados

## Smoke tests (`docs/setup/smoke-test-fase3.md`)

1. **TTS corto (200 chars)** → MP3 disponible en `<audio>`, descarga real, crédito descontado
2. **TTS largo (6000 chars)** → chunking funciona, MP3 final concatenado reproducible sin glitches audibles
3. **Sound effect** → "aplauso de estadio" genera MP3 corto reproducible
4. **Voice clone** → subir 2 samples de ~30s c/u → tras 30-60s aparece en `/app/voices` con `ready` → "Probar voz" genera muestra con la voz clonada
5. **Kling Pro 5s text-to-video** → completion en <90s, video reproduce, thumbnail visible
6. **Veo Fast 1080p 8s** → completion en <3 min, video reproduce, thumbnail visible
7. **Veo image-to-video** → generar imagen con Nano → "Usar como ref" → `/app/create/video` → genera video animado de ese frame
8. **Kling Omni lip-sync** → seleccionar audio TTS previo + video previo → genera con boca sincronizada
9. **Cancelación** → generar Veo, cancelar a los 30s → status `canceled` en <30s, créditos refundeados visibles en CreditPill
10. **Timeout simulado** → `update generations set timeout_at = now() where id = '<job en processing>'` → siguiente poll del worker lo marca failed + refund
11. **Cleanup manual** → invocar `/api/jobs/cleanup` con signature válida → verificar counts en logs

## SQL spot-checks (vía MCP Supabase)

- Bucket `voice-samples` creado con 3 policies (select/insert/delete) restringidas por owner
- `select count(*) from model_pricing where provider in ('veo','kling','elevenlabs')` → 11
- `cleanup_old_data()` RPC revoked de anon/authenticated
- Realtime sigue activo en `generations` después de la migración 013

## Manejo de errores

- QStash 429 al encolar → server action retorna `{ ok: false, error: 'queue_full' }`, UI muestra toast
- Worker falla en `finalize` (download/upload) → retorna 500 a QStash → reintenta hasta 3 veces (config default)
- Después de 3 reintentos → mensaje a dead-letter de QStash. **No implementamos dead-letter handler en fase 3**. La generación queda en `processing` hasta que `timeout_at` la cierre en el próximo poll del cleanup. Aceptable para demo.

## Criterios de aceptación

- [ ] Worker procesa los 3 estados (queued → processing → done) de cada provider sin generaciones zombies
- [ ] `poll_attempts` corta jobs colgados al exceder MAX_POLLS
- [ ] `timeout_at` corta jobs aunque QStash siga entregando polls
- [ ] Cancelación llega al worker dentro del próximo poll y dispara refund
- [ ] Output siempre desde Supabase Storage (signed URL `*.supabase.co`), nunca del proveedor original
- [ ] Thumbnail de video usa `ffmpeg -ss 0 -frames:v 1` y completa en <5s
- [ ] TTS de 6000 chars produce un MP3 único reproducible
- [ ] Voice clone con 2 samples válidos genera voice_id usable en TTS dentro de 60s
- [ ] Lip-sync de Kling Omni acepta video + audio del workspace y produce video con boca sincronizada

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| QStash devuelve 429 en burst | Server action retorna error claro `queue_full`; UI invita a reintentar |
| Veo Fast cambia formato de respuesta | Empezar con Veo Fast (modelo más estable según docs); agregar Std/Lite incrementalmente con typecheck por cambio |
| Concat raw MP3 genera artefactos | Probar primero con 2 chunks; si suena raro, fallback a `lamejs` re-encode |
| Worker excede 60s en finalize (FLUX 4K + thumbnail) | N/A en Fase 3 (FLUX sigue sync). Para video: si video grande + thumbnail >50s, partir en dos invocations (paso `finalize` separado del `download`) |
| QStash free tier se agota mid-demo | Tener `lib/jobs/poll-fallback.ts` manual como backup (no implementar a menos que pase) |
| Kling cancel endpoint devuelve error | Capturar y continuar — refund local + status='canceled' siguen siendo válidos |
| FFmpeg binario hace el bundle exceder 250MB de Vercel Hobby | `@ffmpeg-installer/ffmpeg` pesa ~30MB. Bundle actual fase 2 ~80MB. Total ~110MB queda holgado. Monitor con `pnpm build` y `du -sh .next/standalone` |
| Voice clone falla en ElevenLabs (samples mal grabados) | Status `failed` en `voice_clones`, refund automático, UI muestra mensaje claro con razón del provider |

## Lo que NO entra en Fase 3

- Brand kits, characters, presets (fase 4)
- Storyboard, auto-variations, smart crop, comparador A/B (fase 4)
- Pipeline voz+video automatizado (fase 4)
- Timeline editor, dubbing (fase 5)
- Prompt assistant en video/audio (fase 4)
- Plantillas comunitarias (fase 5)
- Dead-letter handler con alertas (post-demo)
- Imagen migrada al worker (decisión confirmada: queda síncrona)
- Veo 4K, Veo last-frame (decisión confirmada: no necesarios para demo)
