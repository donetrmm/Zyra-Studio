# P16 — Pista de referencia de ritmo en campaña — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir adjuntar una pista de audio (≤15s) a una campaña que se propague como referencia de ritmo a la generación de todos sus clips (incluidos los encadenados), reusando el pipe `ctx.audioRefPath` → compiler → `referenceAudioPaths` → worker → Seedance que ya existe.

**Architecture:** Columna nueva `campaigns.music_ref_id` (FK a `media_references`) → resuelta a su storage path en `loadCampaignContext` → propagada por `CampaignContext.audioRefPath` → `directorContextFor` la setea en el `DirectorContext`. El primer clip ya la recoge vía las referencias compiladas; los clips encadenados la heredan por `ChainParams`. UI: una sección opcional en el wizard con guard de duración client-side.

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + Storage), TypeScript, Vitest, pnpm. Migración SQL aditiva.

## Global Constraints

- **Package manager: pnpm.** `pnpm typecheck`, `pnpm test`.
- **No `any`**: `unknown` + narrowing o tipo explícito.
- **No emojis** en código ni UI. Dark mode, componentes shadcn primero.
- **Migraciones**: archivo nuevo en orden (`043_...`); **NUNCA modificar una migración aplicada**. Aditiva.
- **Tests sin APIs/DB reales** (`feedback_no_real_api_in_tests`): unit tests solo sobre lógica pura (schema zod, `directorContextFor`). Lo DB-bound (server action, render) se valida en el smoke del usuario.
- **URLs de proveedor nunca al cliente**: la pista es un storage path interno (`media_references.storage_url`), firmado server-side por el worker.
- **Créditos solo vía funciones SQL atómicas**: este feature NO toca créditos.
- **Service role solo server-side.**
- **Sin dependencias pesadas** (Vercel Hobby): el guard de duración usa el `<audio>` del navegador; cero ffmpeg.
- **Commits sin trailer `Co-Authored-By`.**
- **Seedance audio de referencia**: ≤15s combinados, <15MB c/u, modo R2V (`docs/modelos/06-seedance-2.md`). El `AUDIO_REF_MAX_BYTES = 15MB` ya lo aplica `uploadMediaReferenceFile`.

---

### Task 1: Migración `043_campaign_music_ref.sql`

**Files:**
- Create: `supabase/migrations/043_campaign_music_ref.sql`

**Interfaces:**
- Consumes: nada.
- Produces: columna `campaigns.music_ref_id uuid` (nullable, FK a `media_references(id)` `on delete set null`). La consumen las Tasks 2 y 3.

> Nota de aplicación: el archivo se crea aquí. La **aplicación al proyecto Supabase live** la hace el controlador (no un subagente) vía la herramienta MCP `apply_migration` antes del smoke — es una columna aditiva nullable, riesgo mínimo, pero el efecto en DB live se mantiene supervisado. Los tests de este plan son puros y NO requieren la columna aplicada.

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- 043_campaign_music_ref.sql
-- P16: pista de audio de referencia de ritmo a nivel campaña. media_references
-- type='audio'; on delete set null para que borrar el audio no rompa la campaña.
alter table campaigns
  add column music_ref_id uuid references media_references(id) on delete set null;

comment on column campaigns.music_ref_id is
  'P16: media_reference (type=audio, <=15s) usada como referencia de ritmo/beat para todos los clips de la campaña.';
```

- [ ] **Step 2: typecheck (no debe romper nada; es solo un archivo SQL nuevo)**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_campaign_music_ref.sql
git commit -m "feat(db): columna campaigns.music_ref_id para la pista de referencia (P16)"
```

---

### Task 2: Schema + persistencia en create

**Files:**
- Modify: `lib/schemas/campaigns.ts` (campo `musicRefId` en `CreateCampaignStudioSchema`)
- Modify: `server-actions/campaigns.ts` (persistir en `createCampaignStudioAction`)
- Test: `lib/schemas/campaigns.test.ts` (crear si no existe)

**Interfaces:**
- Consumes: la columna `music_ref_id` (Task 1).
- Produces: `CreateCampaignStudioSchema` acepta `musicRefId?: string` (uuid), persistido en `campaigns.music_ref_id` al crear. Lo consume la UI (Task 5).

> Decisión de alcance: el spec mencionaba un `setCampaignMusicAction` para editar la pista post-creación, pero el wizard la setea al crear (create + plan es un flujo atómico) y ninguna UI consumiría el setter → se omite por YAGNI (una server action sin consumidor es código muerto). Editar la pista de una campaña existente queda como follow-up si surge la necesidad.

- [ ] **Step 1: Escribir el test del schema (RED)**

Crear `lib/schemas/campaigns.test.ts` (o agregar si existe):

```ts
import { describe, it, expect } from 'vitest';
import { CreateCampaignStudioSchema } from './campaigns';

const base = { name: 'Camp', productImageIds: ['11111111-1111-1111-1111-111111111111'] };

describe('CreateCampaignStudioSchema — musicRefId', () => {
  it('acepta un musicRefId uuid válido', () => {
    const r = CreateCampaignStudioSchema.safeParse({
      ...base,
      musicRefId: '22222222-2222-2222-2222-222222222222',
    });
    expect(r.success).toBe(true);
  });
  it('rechaza un musicRefId que no es uuid', () => {
    const r = CreateCampaignStudioSchema.safeParse({ ...base, musicRefId: 'no-uuid' });
    expect(r.success).toBe(false);
  });
  it('es opcional (sin musicRefId sigue siendo válido)', () => {
    expect(CreateCampaignStudioSchema.safeParse(base).success).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm test -- campaigns.test.ts` (en `lib/schemas/`)
Expected: FAIL — `musicRefId` aún no existe en el schema (el caso "rechaza no-uuid" pasa por accidente porque zod ignora claves extra, pero "acepta uuid válido" no prueba nada todavía; tras añadir el campo, los tres reflejan el contrato).

> Nota: zod por defecto ignora propiedades desconocidas, así que el test "rechaza" solo es significativo una vez añadido el campo. El RED real es que el contrato no está definido; el GREEN lo fija.

- [ ] **Step 3: Añadir el campo al schema**

En `lib/schemas/campaigns.ts`, dentro de `CreateCampaignStudioSchema` (tras `aspectRatio`, ~línea 90):

```ts
    // P16: pista de audio de referencia de ritmo (media_reference type='audio', <=15s).
    musicRefId: z.string().uuid().optional(),
```

- [ ] **Step 4: Persistir en `createCampaignStudioAction`**

En `server-actions/campaigns.ts`, en el insert de `campaigns` (~línea 329-343), añadir tras `aspect_ratio: parsed.data.aspectRatio,`:

```ts
      music_ref_id: parsed.data.musicRefId ?? null,
```

- [ ] **Step 5: Correr los tests (GREEN) + typecheck**

Run: `pnpm test -- campaigns.test.ts` (en `lib/schemas/`) y `pnpm typecheck`
Expected: PASS los 3 tests del schema; typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add lib/schemas/campaigns.ts lib/schemas/campaigns.test.ts server-actions/campaigns.ts
git commit -m "feat(campaigns): musicRefId persistido al crear la campana (P16)"
```

---

### Task 3: Threading de contexto (orchestrator + 3 callers)

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`CampaignContext`, `loadCampaignContext`, `directorContextFor`, tipo de `enqueueBatch`)
- Modify: `server-actions/campaigns.ts` (3 selects + 3 objetos `campaign` que alimentan `enqueueBatch`/`loadCampaignContext`)
- Test: `lib/campaigns/director-context.test.ts` (nuevo)

**Interfaces:**
- Consumes: `campaigns.music_ref_id` (Task 1).
- Produces: `CampaignContext.audioRefPath?: string`; `directorContextFor` setea `audioRefPath`. Lo consume Task 4 (vía `ctx.audioRefPath`).

- [ ] **Step 1: Escribir el test de `directorContextFor` (RED)**

Crear `lib/campaigns/director-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { directorContextFor, type CampaignContext } from './orchestrator';

// ItemRow mínimo: directorContextFor solo lee scene, character ids y formato.
const item = {
  id: 'i1',
  scene: null,
  character_id: null,
  character_ids: null,
} as unknown as Parameters<typeof directorContextFor>[0];

function ctxWith(audioRefPath?: string): CampaignContext {
  return {
    productName: 'Serum',
    productImagePaths: ['ws/p.png'],
    packagingImagePaths: [],
    characters: new Map(),
    language: 'es',
    ...(audioRefPath ? { audioRefPath } : {}),
  };
}

describe('directorContextFor — audioRefPath (P16)', () => {
  it('propaga audioRefPath del CampaignContext al DirectorContext', () => {
    const dc = directorContextFor(item, null, ctxWith('ws/u/beat.mp3'));
    expect(dc.audioRefPath).toBe('ws/u/beat.mp3');
  });
  it('sin pista, audioRefPath queda undefined', () => {
    const dc = directorContextFor(item, null, ctxWith());
    expect(dc.audioRefPath).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm test -- director-context.test.ts`
Expected: FAIL — `CampaignContext` no tiene `audioRefPath` (error de tipo) y/o `dc.audioRefPath` es `undefined` en el primer caso.

- [ ] **Step 3: Añadir `audioRefPath` a `CampaignContext`**

En `lib/campaigns/orchestrator.ts`, en el type `CampaignContext` (~línea 98-107), tras `language: 'es' | 'en';`:

```ts
  // P16: storage path de la pista de referencia de ritmo (media_reference
  // type='audio'). undefined cuando la campaña no tiene pista.
  audioRefPath?: string;
```

- [ ] **Step 4: Resolver `music_ref_id` en `loadCampaignContext`**

En `lib/campaigns/orchestrator.ts`:

(a) Ampliar el tipo del parámetro `campaign` de `loadCampaignContext` (~línea 165-172), añadir tras `include_packaging?: boolean | null;`:

```ts
    // P16: media_reference id de la pista de referencia de ritmo.
    music_ref_id?: string | null;
```

(b) Antes del `return` de `loadCampaignContext` (resuelve la pista a su storage path con el mismo `resolvePaths` que producto/cast), añadir:

```ts
  let audioRefPath: string | undefined;
  if (campaign.music_ref_id) {
    const audioMap = await resolvePaths(supabase, workspaceId, [campaign.music_ref_id]);
    audioRefPath = audioMap.get(campaign.music_ref_id);
  }
```

(c) Añadir `audioRefPath` al objeto que retorna `loadCampaignContext` (junto a `language`):

```ts
    audioRefPath,
```

- [ ] **Step 5: Setear `audioRefPath` en `directorContextFor`**

En `lib/campaigns/orchestrator.ts`, en el objeto que retorna `directorContextFor` (~línea 262-280), tras `language: ctx.language,`:

```ts
    audioRefPath: ctx.audioRefPath,
```

- [ ] **Step 6: Ampliar el tipo `campaign` de `enqueueBatch`**

En `lib/campaigns/orchestrator.ts`, en el tipo del parámetro `campaign` de `enqueueBatch` (~línea 608-612, el que tiene `brand_kit_id`, `product_brief`, `language`, `include_packaging`), añadir:

```ts
    music_ref_id?: string | null;
```

- [ ] **Step 7: Pasar `music_ref_id` en los 3 callers**

En `server-actions/campaigns.ts`, en cada uno de los 3 puntos que cargan la campaña para `enqueueBatch`/`loadCampaignContext`, añadir `music_ref_id` al `select` y al objeto `campaign`:

1. **~línea 1237** (`approveBatchAction`): el select pasa de
   `.select('id, brand_kit_id, product_brief, language, include_packaging')`
   a
   `.select('id, brand_kit_id, product_brief, language, include_packaging, music_ref_id')`
   y en el objeto `campaign` del `enqueueBatch` (~línea 1273, junto a `brand_kit_id`) añadir:
   `music_ref_id: (campaign.music_ref_id as string | null) ?? null,`

2. **~línea 1304** (segundo batch path): el select pasa de
   `.select('id, workspace_id, brand_kit_id, product_brief, language, include_packaging')`
   a
   `.select('id, workspace_id, brand_kit_id, product_brief, language, include_packaging, music_ref_id')`
   y en el objeto `campaign` del `enqueueBatch` (~línea 1344) añadir:
   `music_ref_id: (campaign.music_ref_id as string | null) ?? null,`

3. **~línea 2196** (`generateItemAction`, regen suelta): en el `select` con `campaigns!inner(...)`, cambiar
   `campaigns!inner(workspace_id, brand_kit_id, product_brief, language, include_packaging)`
   a
   `campaigns!inner(workspace_id, brand_kit_id, product_brief, language, include_packaging, music_ref_id)`
   ampliar el tipo `camp` (~línea 2199) añadiendo `music_ref_id?: string | null` al cast, y en el objeto `campaign` que se pasa a `enqueueBatch` (~línea 2226, junto a `brand_kit_id`) añadir:
   `music_ref_id: (camp.music_ref_id as string | null) ?? null,`

> Si al abrir el archivo los números de línea bailaron, localiza los 3 `select` por su lista de columnas exacta (todos incluyen `brand_kit_id, product_brief, ... include_packaging`) y el objeto `campaign` por su `brand_kit_id:`.

- [ ] **Step 8: Correr el test (GREEN) + typecheck + suite**

Run: `pnpm test -- director-context.test.ts` y `pnpm typecheck` y `pnpm test`
Expected: PASS los 2 tests nuevos; typecheck limpio; suite completa verde.

- [ ] **Step 9: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts server-actions/campaigns.ts
git commit -m "feat(campaigns): enhebra la pista de referencia por CampaignContext/directorContextFor (P16)"
```

---

### Task 4: Propagación a clips encadenados

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (`ChainParams`, el `chain` del primer clip en `enqueueBatch`, el insert de `advanceSequenceChain`)

**Interfaces:**
- Consumes: `ctx.audioRefPath` (Task 3); `ChainParams`.
- Produces: los clips 2+ de una secuencia llevan `referenceAudioPaths` en `generations.params`. No produce símbolos nuevos.

**Contexto:** El **primer** clip de una secuencia ya recibe `referenceAudioPaths: refAudios` (orchestrator.ts:869) porque el compiler emite la referencia de audio desde `ctx.audioRefPath`. Los clips **encadenados** (`advanceSequenceChain`) NO pasan por el compiler ni por `directorContextFor`: arman `generations.params` directo leyendo `ChainParams` del clip previo. Hay que carry-forward la pista por `ChainParams`.

- [ ] **Step 1: Añadir `audioRefPath` a `ChainParams`**

En `lib/campaigns/orchestrator.ts`, en el type `ChainParams` (~línea 316-334), tras `language?: 'es' | 'en';`:

```ts
  // P16: pista de referencia de ritmo de la campaña; se re-ancla en cada clip
  // de la cadena (los encadenados no pasan por el compiler). undefined → sin pista.
  audioRefPath?: string;
```

- [ ] **Step 2: Setear `audioRefPath` en el `chain` del primer clip**

En `lib/campaigns/orchestrator.ts`, en el objeto `chain` del primer clip dentro de `enqueueBatch` (~línea 873-884, el que termina en `} satisfies ChainParams`), tras `language: ctx.language,`:

```ts
                      ...(ctx.audioRefPath ? { audioRefPath: ctx.audioRefPath } : {}),
```

- [ ] **Step 3: Propagar en `advanceSequenceChain`**

En `lib/campaigns/orchestrator.ts`, en el insert de `generations` dentro de `advanceSequenceChain` (~línea 518-536). `chain` ya está disponible en ese scope (leído en ~línea 450 como `gen.params.chain`).

(a) En el objeto `params`, tras `referenceImagePaths,` (~línea 524), añadir:

```ts
        ...(chain.audioRefPath ? { referenceAudioPaths: [chain.audioRefPath] } : {}),
```

(b) En el objeto `chain` anidado de ese mismo insert (~línea 526-535, `} satisfies ChainParams`), tras `language,`, carry-forward para los clips 3+:

```ts
          ...(chain.audioRefPath ? { audioRefPath: chain.audioRefPath } : {}),
```

> Si `chain` en ese scope es `ChainParams | undefined`, usa `chain?.audioRefPath` en ambos. Verifica el tipo local: si hay un early-return previo cuando `!chain`, `chain` ya es no-nulo y `chain.audioRefPath` está bien.

- [ ] **Step 4: typecheck + suite**

Run: `pnpm typecheck` y `pnpm test`
Expected: typecheck limpio; suite completa verde (no hay test unitario nuevo: el insert es DB-bound; la propagación se valida en el smoke del usuario — ver Verificación final).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/orchestrator.ts
git commit -m "feat(campaigns): propaga la pista de referencia a los clips encadenados (P16)"
```

---

### Task 5: UI — sección "Pista musical" en el wizard + guard de 15s

**Files:**
- Modify: `components/campaigns/CampaignStudioWizard.tsx`

**Interfaces:**
- Consumes: `uploadMediaReferenceFile` (`lib/media-references/upload-client.ts`), `createCampaignStudioAction` (`musicRefId`).
- Produces: nada para otras tasks (hoja del árbol).

**Contexto:** `uploadMediaReferenceFile(file)` ya valida tipo (mp3/wav) y tamaño (15MB) y devuelve `{ ok: true, ref: { id, storagePath, previewUrl, filename } }`. El `ref.id` ES el `musicRefId`. Falta solo: leer la duración en el navegador y bloquear >15s, y pasar el id al create.

- [ ] **Step 1: Helper de duración (cero deps) + estado**

En `components/campaigns/CampaignStudioWizard.tsx`, añadir un helper a nivel módulo (fuera del componente):

```ts
// Lee la duración de un audio en el navegador (sin libs). Resuelve en segundos.
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement('audio');
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(el.duration);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer el audio'));
    };
    el.src = url;
  });
}

const MUSIC_MAX_SECONDS = 15;
```

Y dentro del componente, junto a los demás `useState`:

```ts
  const [music, setMusic] = useState<{ id: string; filename: string } | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
```

- [ ] **Step 2: Handler de selección con guard de 15s**

Dentro del componente, añadir:

```ts
  async function handleMusicSelected(file: File | undefined) {
    if (!file) return;
    setMusicBusy(true);
    try {
      let seconds: number;
      try {
        seconds = await readAudioDuration(file);
      } catch {
        toast.error('No se pudo leer la duración del audio');
        return;
      }
      if (seconds > MUSIC_MAX_SECONDS) {
        toast.error(`La pista de referencia debe durar máximo ${MUSIC_MAX_SECONDS}s; usa un clip corto del beat`);
        return;
      }
      const res = await uploadMediaReferenceFile(file);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setMusic({ id: res.ref.id, filename: res.ref.filename });
    } finally {
      setMusicBusy(false);
    }
  }
```

Y el import (junto a los demás imports del wizard):

```ts
import { uploadMediaReferenceFile } from '@/lib/media-references/upload-client';
```

- [ ] **Step 3: La sección en el JSX**

Añadir una sección opcional "Pista musical" junto a las de idioma/aspect-ratio (sigue el estilo de `Label`/`Input`/`Button` ya usados en el archivo; sin emojis, dark mode):

```tsx
<div className="space-y-2">
  <Label>Pista musical (opcional)</Label>
  <p className="text-sm text-muted-foreground">
    Un clip de hasta 15s. Guía el ritmo y la energía del video; el modelo genera su
    audio sincronizado al beat. No se usa como banda sonora final.
  </p>
  {music ? (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span className="truncate">{music.filename}</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => setMusic(null)}>
        Quitar
      </Button>
    </div>
  ) : (
    <Input
      type="file"
      accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav"
      disabled={musicBusy}
      onChange={(e) => void handleMusicSelected(e.target.files?.[0])}
    />
  )}
  {musicBusy ? <p className="text-sm text-muted-foreground">Subiendo pista…</p> : null}
</div>
```

- [ ] **Step 4: Pasar `musicRefId` al create**

En `runCreate`, en el objeto de `createCampaignStudioAction({...})` (~línea 131-142), añadir tras `aspectRatio,`:

```ts
      ...(music ? { musicRefId: music.id } : {}),
```

- [ ] **Step 5: typecheck + build de tipos**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add components/campaigns/CampaignStudioWizard.tsx
git commit -m "feat(campaigns): control de pista musical con guard de 15s en el wizard (P16)"
```

---

## Verificación final (tras las 5 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm test` — suite completa verde (incluye los tests nuevos de schema y `directorContextFor`).
- [ ] **Controlador aplica la migración 043** al proyecto Supabase live vía MCP `apply_migration` (chequear antes con `list_tables` que la columna no exista). Confirmar con `list_migrations` que `043` quedó registrada.
- [ ] **Smoke del usuario (API/Atlas real):**
  1. Crear una campaña adjuntando una pista ≤15s (probar también que una >15s se bloquea en el wizard).
  2. Generar una secuencia de 2+ clips.
  3. Confirmar en `generations.params` que el clip 1 **y** los clips encadenados llevan `referenceAudioPaths` con el storage path de la pista.
  4. Ver el video y confirmar que la energía/beat sigue la referencia.

## Notas para el implementador

- El **primer clip** de cada secuencia NO necesita código extra de audio: una vez que `directorContextFor` setea `audioRefPath` (Task 3), el compiler emite la referencia `@audio1` y `enqueueBatch` la mete en `referenceAudioPaths` (orchestrator.ts:819,869). El compiler ya está testeado (`prompt-director.test.ts:423`). Task 4 existe SOLO para los clips encadenados, que esquivan el compiler.
- `resolvePaths` (orchestrator.ts:110) ya valida `workspace_id` y devuelve `storage_url`; reutilízalo, no escribas una query nueva.
- El compiler ya hace `if (generateAudio && !ctx.audioRefPath)` (seedance.ts:446): con pista, omite la dirección de score textual. Sin cambios ahí.
- No toques los flujos de storyboard (`onlyCharacterRefs` limpia `audioRefPath` a propósito para el video del panel — es una decisión existente, no la revivas).
- La persistencia en `createCampaignStudioAction` y la inserción encadenada son DB-bound: su validación real es el smoke; no inventes un mock de Supabase para "cubrirlas" (rompería `feedback_no_real_api_in_tests`).
