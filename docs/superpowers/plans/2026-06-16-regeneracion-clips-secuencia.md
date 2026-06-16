# Regeneración de clips de una secuencia (dos modos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir regenerar un clip de una secuencia en dos modos — "solo este" (anclaje bidireccional, conserva vecinos) y "este y los siguientes" (cascada) — eligiendo según la posición del clip.

**Architecture:** El modo A reutiliza R2V pasando un tercer `reference_image` (el primer fotograma del clip siguiente, extraído a resolución completa con ffmpeg) citado en el prompt como cuadro de cierre; no usa i2v ni `last_image`. El modo B resetea los items posteriores y reutiliza `advanceSequenceChain` (spec 09) para re-encadenar. El handler y el adapter Seedance ya envían `reference_images` como array, así que no se tocan.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (admin client), `@ffmpeg-installer/ffmpeg`, QStash, Vitest.

**Spec:** `specs/v2/10-regeneracion-clips-secuencia.md`

---

## File Structure

- **Create** `lib/jobs/video-frame.ts` — extracción pura de un fotograma de un video (buffer → buffer), parametrizable (miniatura vs. calidad completa). Lo usan `finalize.ts` (thumbnail) y la server action (frame de cierre).
- **Create** `lib/campaigns/closing-frame.ts` — `server-only`: dado el output de un clip ya generado, descarga el video, extrae el frame 0 a calidad completa y lo sube a references; devuelve el path interno.
- **Modify** `lib/jobs/finalize.ts` — usar `video-frame.ts` en vez de la función ffmpeg inline.
- **Modify** `lib/campaigns/sequence-chain.ts` — añadir `regenModesFor` (lógica pura de qué modos aplican por posición).
- **Modify** `lib/campaigns/orchestrator.ts` — extender `buildContinuationPrompt` con un fotograma de cierre opcional.
- **Modify** `server-actions/campaigns.ts` — `generateItemAction` acepta `mode`; implementa modo A (anclaje) y modo B (cascada).
- **Modify** `components/campaigns/CampaignStudioView.tsx` — menú de regeneración según posición.
- **Tests:** `lib/campaigns/sequence-chain.test.ts`, `lib/jobs/video-frame.test.ts`, `lib/campaigns/continuation-prompt.test.ts` (o el test existente del orchestrator).

---

## Task 1: Lógica pura de modos por posición (`sequence-chain.ts`)

**Files:**
- Modify: `lib/campaigns/sequence-chain.ts`
- Test: `lib/campaigns/sequence-chain.test.ts`

- [ ] **Step 1: Write the failing test**

Añadir al final de `lib/campaigns/sequence-chain.test.ts` (si no existe, crearlo importando lo ya exportado):

```ts
import { describe, it, expect } from 'vitest';
import { regenModesFor } from './sequence-chain';

describe('regenModesFor', () => {
  const items = [
    { id: 'a', sceneIndex: 0 },
    { id: 'b', sceneIndex: 1 },
    { id: 'c', sceneIndex: 2 },
  ];

  it('clip del medio: ofrece anclaje y cascada', () => {
    expect(regenModesFor(items, 1)).toEqual({ onlyThis: true, thisAndForward: true });
  });

  it('primer clip: sin anclaje (no hay previo que herede el cierre), con cascada', () => {
    expect(regenModesFor(items, 0)).toEqual({ onlyThis: true, thisAndForward: true });
  });

  it('último clip: sin anclaje ni cascada (no hay siguiente)', () => {
    expect(regenModesFor(items, 2)).toEqual({ onlyThis: false, thisAndForward: false });
  });

  it('secuencia de un solo clip: ningún modo de secuencia', () => {
    expect(regenModesFor([{ id: 'x', sceneIndex: 0 }], 0)).toEqual({
      onlyThis: false,
      thisAndForward: false,
    });
  });
});
```

> Nota: `onlyThis` es `true` también para el clip 0 porque su cierre se ancla al inicio del clip 1 (el inicio del 0 sigue siendo el producto). Solo es `false` cuando no hay clip siguiente.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/campaigns/sequence-chain.test.ts`
Expected: FAIL — `regenModesFor is not a function` (o import no resuelto).

- [ ] **Step 3: Implement**

Añadir a `lib/campaigns/sequence-chain.ts`:

```ts
// Modos de regeneración disponibles para un clip según su posición en la cadena.
// onlyThis (anclaje bidireccional): solo aplica si hay clip siguiente cuyo primer
// fotograma sirva de cierre. thisAndForward (cascada): solo si hay algo después
// que re-encadenar. Un clip sin siguiente no ofrece ningún modo de secuencia.
export function regenModesFor<T extends ChainItem>(
  items: T[],
  sceneIndex: number,
): { onlyThis: boolean; thisAndForward: boolean } {
  const hasNext = nextSceneItem(items, sceneIndex) !== null;
  return { onlyThis: hasNext, thisAndForward: hasNext };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/campaigns/sequence-chain.test.ts`
Expected: PASS (4 nuevos casos verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/sequence-chain.ts lib/campaigns/sequence-chain.test.ts
git commit -m "feat(campaigns): modos de regeneracion por posicion en secuencia"
```

---

## Task 2: Extracción de fotograma a calidad completa (`video-frame.ts`)

**Files:**
- Create: `lib/jobs/video-frame.ts`
- Modify: `lib/jobs/finalize.ts:30-91`
- Test: `lib/jobs/video-frame.test.ts`

- [ ] **Step 1: Write the failing test (args ffmpeg, sin ejecutar binario)**

Crear `lib/jobs/video-frame.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFrameArgs } from './video-frame';

describe('buildFrameArgs', () => {
  it('miniatura: escala a 512 y comprime', () => {
    const args = buildFrameArgs('in.mp4', 'out.jpg', { atSeconds: 0, thumbnail: true });
    expect(args).toEqual([
      '-loglevel', 'error',
      '-i', 'in.mp4',
      '-ss', '0',
      '-frames:v', '1',
      '-vf', 'scale=512:-1',
      '-q:v', '4',
      'out.jpg',
    ]);
  });

  it('calidad completa: sin scale ni q:v, q:v alto', () => {
    const args = buildFrameArgs('in.mp4', 'out.jpg', { atSeconds: 0, thumbnail: false });
    expect(args).toEqual([
      '-loglevel', 'error',
      '-i', 'in.mp4',
      '-ss', '0',
      '-frames:v', '1',
      '-q:v', '2',
      'out.jpg',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/jobs/video-frame.test.ts`
Expected: FAIL — módulo `./video-frame` no existe.

- [ ] **Step 3: Implement `lib/jobs/video-frame.ts`**

```ts
import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

export type FrameOpts = { atSeconds: number; thumbnail: boolean };

// Args para extraer UN fotograma. thumbnail=true → miniatura ligera (512px, q4).
// thumbnail=false → calidad completa para condicionar video (sin downscale, q2).
export function buildFrameArgs(inputPath: string, outputPath: string, opts: FrameOpts): string[] {
  const base = ['-loglevel', 'error', '-i', inputPath, '-ss', String(opts.atSeconds), '-frames:v', '1'];
  const quality = opts.thumbnail ? ['-vf', 'scale=512:-1', '-q:v', '4'] : ['-q:v', '2'];
  return [...base, ...quality, outputPath];
}

// Extrae un fotograma de un video en memoria y devuelve el JPG resultante.
export async function extractVideoFrame(buffer: Buffer, opts: FrameOpts): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'zyra-frame-'));
  const inputPath = join(dir, 'input.mp4');
  const outputPath = join(dir, 'frame.jpg');
  await writeFile(inputPath, buffer);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const ffmpeg = spawn(ffmpegInstaller.path, buildFrameArgs(inputPath, outputPath, opts), {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let errMsg = '';
      ffmpeg.stderr.on('data', (c) => (errMsg += c.toString()));
      ffmpeg.on('error', reject);
      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exit ${code}: ${errMsg.slice(0, 300)}`));
          return;
        }
        try {
          resolve(await readFile(outputPath));
        } catch (e) {
          reject(e);
        }
      });
    });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/jobs/video-frame.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `finalize.ts` para reusar el módulo**

En `lib/jobs/finalize.ts`: borrar la función `makeVideoThumbnail` (líneas ~30-72) y sus imports ahora huérfanos (`spawn`, `mkdtemp`, `writeFile`, `readFile`, `unlink`, `rmdir`, `tmpdir`, `join`, `ffmpegInstaller`) **solo si no se usan en otra parte del archivo**. Reemplazar la llamada dentro de `makeThumbnail`:

```ts
import { extractVideoFrame } from './video-frame';
// ...
if (type === 'video') {
  try {
    return await extractVideoFrame(buffer, { atSeconds: 0, thumbnail: true });
  } catch (err) {
    console.error('[finalize] video thumbnail falló', err);
    return null;
  }
}
```

- [ ] **Step 6: Verify typecheck and existing tests**

Run: `pnpm typecheck && pnpm vitest run lib/jobs`
Expected: PASS, sin imports sin usar.

- [ ] **Step 7: Commit**

```bash
git add lib/jobs/video-frame.ts lib/jobs/video-frame.test.ts lib/jobs/finalize.ts
git commit -m "refactor(jobs): extrae extraccion de fotograma a video-frame (full quality)"
```

---

## Task 3: `buildContinuationPrompt` con fotograma de cierre

**Files:**
- Modify: `lib/campaigns/orchestrator.ts:251-261`
- Test: `lib/campaigns/continuation-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Crear `lib/campaigns/continuation-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from './orchestrator';

describe('buildContinuationPrompt', () => {
  it('sin cierre: producto(s) + fotograma previo (comportamiento actual)', () => {
    const out = buildContinuationPrompt('A dog runs.', 1);
    expect(out).toContain('@image1 is the product');
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).not.toContain('@image3');
    expect(out.endsWith('A dog runs.')).toBe(true);
  });

  it('con cierre: añade el fotograma de cierre como última referencia', () => {
    const out = buildContinuationPrompt('A dog runs.', 1, { withClosingFrame: true });
    expect(out).toContain('@image2 is the final frame of the previous shot');
    expect(out).toContain('@image3 is the target final frame');
    expect(out).toContain('end the shot exactly on it');
  });

  it('con cierre y 2 productos: el cierre es @image4', () => {
    const out = buildContinuationPrompt('Scene.', 2, { withClosingFrame: true });
    expect(out).toContain('@image3 is the final frame of the previous shot');
    expect(out).toContain('@image4 is the target final frame');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/campaigns/continuation-prompt.test.ts`
Expected: FAIL — la firma actual no acepta el tercer argumento / no genera `@image3`.

- [ ] **Step 3: Implement** — reemplazar `buildContinuationPrompt` en `orchestrator.ts`:

```ts
export function buildContinuationPrompt(
  scenePrompt: string,
  productCount: number,
  opts?: { withClosingFrame?: boolean },
): string {
  const refs: string[] = [];
  for (let i = 0; i < productCount; i++) {
    refs.push(`@image${i + 1} is the product — keep it identical (same colors, proportions, details).`);
  }
  const frameIdx = productCount + 1;
  refs.push(
    `@image${frameIdx} is the final frame of the previous shot — continue seamlessly from it: same subject, lighting, palette and setting, as one continuous sequence.`,
  );
  if (opts?.withClosingFrame) {
    const closingIdx = frameIdx + 1;
    refs.push(
      `@image${closingIdx} is the target final frame — end the shot exactly on it, matching its composition, framing and pose so the next shot continues seamlessly.`,
    );
  }
  return `${refs.join(' ')} ${scenePrompt.trim()}`.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/campaigns/continuation-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/orchestrator.ts lib/campaigns/continuation-prompt.test.ts
git commit -m "feat(campaigns): buildContinuationPrompt soporta fotograma de cierre"
```

---

## Task 4: Helper de fotograma de cierre del clip siguiente (`closing-frame.ts`)

**Files:**
- Create: `lib/campaigns/closing-frame.ts`

> Sin test unitario: integra Storage + ffmpeg (efectos externos). Su única lógica
> ramificada es manejo de error, que se valida en el smoke. Las piezas puras que
> usa (`buildFrameArgs`) ya están testeadas en Task 2.

- [ ] **Step 1: Implement `lib/campaigns/closing-frame.ts`**

```ts
import 'server-only';
import { downloadOutputBuffer, uploadReference } from '@/lib/supabase/storage';
import { extractVideoFrame } from '@/lib/jobs/video-frame';

// Extrae el PRIMER fotograma del clip siguiente (ya generado) a calidad completa
// y lo sube a references para usarlo como cuadro de cierre del clip que se
// regenera. `nextOutputPath` es generations.output_url del clip i+1 (path en el
// bucket outputs). Devuelve el path interno del fotograma, o null si algo falla
// (el caller cae a regeneración solo-init).
export async function buildClosingFrameRef(params: {
  workspaceId: string;
  sequenceId: string;
  sceneIndex: number; // índice del clip que se regenera
  nextOutputPath: string;
}): Promise<string | null> {
  try {
    const { buffer } = await downloadOutputBuffer(params.nextOutputPath);
    const frame = await extractVideoFrame(buffer, { atSeconds: 0, thumbnail: false });
    return await uploadReference(
      params.workspaceId,
      `chain/${params.sequenceId}/${params.sceneIndex}-closing.jpg`,
      frame,
      'image/jpeg',
    );
  } catch (err) {
    console.error('[closing-frame] no se pudo construir el cierre', {
      sequenceId: params.sequenceId,
      sceneIndex: params.sceneIndex,
      err: (err as Error)?.message,
    });
    return null;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/campaigns/closing-frame.ts
git commit -m "feat(campaigns): helper de fotograma de cierre del clip siguiente"
```

---

## Task 5: `generateItemAction` — parámetro `mode` y modo A (anclaje)

**Files:**
- Modify: `server-actions/campaigns.ts:902-1025`

**Contexto:** Hoy `generateItemAction(itemId)` tiene una rama "RE-GENERAR CON CONTINUIDAD" (`:955-1025`) que reusa `referenceImagePaths = [producto, fotograma previo]`. El modo A añade el fotograma de cierre a ese array y usa el prompt con cierre.

- [ ] **Step 1: Cambiar la firma y los imports**

En `server-actions/campaigns.ts`:

```ts
import { buildClosingFrameRef } from '@/lib/campaigns/closing-frame';
import { nextSceneItem } from '@/lib/campaigns/sequence-chain';
```

Cambiar la firma (`:902`):

```ts
export type RegenMode = 'auto' | 'only-this' | 'this-and-forward';

export async function generateItemAction(
  itemId: string,
  mode: RegenMode = 'auto',
): Promise<Result<{ generationId?: string }>> {
```

> `'auto'` preserva el comportamiento previo (regeneración simple / continuación solo-init) para todos los call sites que no pasan modo.

- [ ] **Step 2: Implementar modo A dentro de la rama de continuación**

Localizar el bloque que arma la nueva generación de continuación (`:977-1024`, dentro de `if (prevGen && pp?.chain && pp.referenceImagePaths?.length) {`). Antes de construir `prompt` y `params`, insertar la resolución del fotograma de cierre:

```ts
// Consulta compartida de la secuencia (la usan modo A y modo B). Se eleva fuera
// del branching de modo para que Task 6 la reutilice sin re-consultar.
const { data: seqRows } = await supabase
  .from('campaign_items')
  .select('id, scene_index, generation_id')
  .eq('sequence_id', item.sequence_id as string);
const chainItems = (seqRows ?? []).map((r) => ({
  id: r.id as string,
  sceneIndex: r.scene_index as number,
}));

// Modo A: si el usuario pide "solo este" y existe clip siguiente ya generado,
// añadir su primer fotograma como cuadro de cierre (anclaje bidireccional).
let closingRef: string | null = null;
let anchored = false;
if (mode === 'only-this') {
  const next = nextSceneItem(chainItems, item.scene_index as number);
  const nextRow = next ? (seqRows ?? []).find((r) => r.id === next.id) : null;
  if (nextRow?.generation_id) {
    const { data: nextGen } = await supabase
      .from('generations')
      .select('output_url')
      .eq('id', nextRow.generation_id as string)
      .single();
    if (nextGen?.output_url) {
      closingRef = await buildClosingFrameRef({
        workspaceId: workspace.id,
        sequenceId: item.sequence_id as string,
        sceneIndex: item.scene_index as number,
        nextOutputPath: nextGen.output_url as string,
      });
      anchored = closingRef !== null;
    }
  }
}

const referenceImagePaths = closingRef
  ? [...pp.referenceImagePaths, closingRef]
  : pp.referenceImagePaths;
const prompt = buildContinuationPrompt(item.scene_prompt as string, productCount, {
  withClosingFrame: anchored,
});
```

Luego, en el `insert` de la generación, usar `referenceImagePaths` (la nueva variable) en lugar de `pp.referenceImagePaths` (`:997`):

```ts
referenceImagePaths,
```

Y borrar la línea previa `const prompt = buildContinuationPrompt(item.scene_prompt as string, productCount);` (`:979`) — ahora se calcula arriba con la opción de cierre.

- [ ] **Step 3: Añadir el warning informativo de anclaje**

Reemplazar el update del item (`:1017-1020`) para incluir el aviso cuando hubo anclaje:

```ts
await admin
  .from('campaign_items')
  .update({
    status: 'sample',
    generation_id: newGenId,
    warnings: anchored ? ['Anclado al inicio del clip siguiente — revisa la transición'] : [],
  })
  .eq('id', itemId);
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server-actions/campaigns.ts
git commit -m "feat(campaigns): modo A regenerar solo este clip con anclaje al siguiente"
```

---

## Task 6: `generateItemAction` — modo B (cascada)

**Files:**
- Modify: `server-actions/campaigns.ts` (rama de continuación)

**Estrategia:** En cascada, regenerar el clip i con `chain` + `returnLastFrame=true` y **resetear los items posteriores** (status `planned`, `generation_id=null`) para que `advanceSequenceChain` los vuelva a encadenar al finalizar cada clip. Toda la maquinaria de avance ya existe (spec 09).

- [ ] **Step 1: Resetear los clips posteriores cuando `mode === 'this-and-forward'`**

Dentro de la rama de continuación, usando `seqRows` (ya elevado en Task 5, Step 2), justo después del bloque del modo A y antes del `insert`:

```ts
if (mode === 'this-and-forward') {
  const laterIds = (seqRows ?? [])
    .filter((r) => (r.scene_index as number) > (item.scene_index as number))
    .map((r) => r.id as string);
  if (laterIds.length) {
    await admin
      .from('campaign_items')
      .update({ status: 'planned', generation_id: null, warnings: [] })
      .in('id', laterIds);
  }
}
```

> El reset deja a `advanceSequenceChain` libre para re-encadenarlos: su guarda
> idempotente (`generation_id` null → avanza; no null → no toca) ahora pasa.

- [ ] **Step 2: Forzar `returnLastFrame` en cascada**

En el `params` del `insert`, calcular el flag según modo (sustituye `returnLastFrame: pp.returnLastFrame ?? false`, `:998`):

```ts
returnLastFrame: mode === 'this-and-forward' ? true : (pp.returnLastFrame ?? false),
```

> En modo A no se fuerza: el clip regenerado no necesita heredar hacia adelante
> (el siguiente se conserva). En cascada sí, para alimentar el avance.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Manual reasoning check (sin API)**

Revisar que `chain.productImagePaths` se preserva en `params.chain` (`:999` ya copia `(prevGen.params as {chain?}).chain`), de modo que `advanceSequenceChain` re-ancle el producto en cada clip de la cascada. Confirmar leyendo el bloque.

- [ ] **Step 5: Commit**

```bash
git add server-actions/campaigns.ts
git commit -m "feat(campaigns): modo B regenerar este y los siguientes (cascada)"
```

---

## Task 7: UI — menú de regeneración según posición

**Files:**
- Modify: `components/campaigns/CampaignStudioView.tsx:704-714, 875-917`

- [ ] **Step 1: Importar el helper de modos**

```ts
import { regenModesFor } from '@/lib/campaigns/sequence-chain';
import type { RegenMode } from '@/server-actions/campaigns';
```

- [ ] **Step 2: Aceptar el modo en `handleRegenerate`**

Reemplazar `handleRegenerate` (`:704-714`):

```ts
async function handleRegenerate(itemId: string, mode: RegenMode = 'auto') {
  setBusy(`regen:${itemId}`);
  const res = await generateItemAction(itemId, mode);
  setBusy(null);
  if (!res.ok) {
    if (res.error === 'insufficient_credits') insufficientCreditsToast();
    else toast.error(res.message ?? 'No se pudo regenerar la escena');
    return;
  }
  toast.success(
    mode === 'this-and-forward'
      ? 'Regenerando este clip y los siguientes en cadena'
      : 'Regenerando la escena — reemplazará el borrador al terminar',
  );
}
```

- [ ] **Step 3: Render condicional del control de regeneración**

En el bloque de cada draft (`:904-917`), reemplazar el botón único "Regenerar" por un control que dependa de la posición. Calcular dentro del `.map((d) => ...)` (antes del `return (`):

```ts
const seqGroup = group.items.filter((i) => i.sequenceId != null && i.sequenceId === d.sequenceId);
const modes =
  d.sequenceId != null && d.sceneIndex != null
    ? regenModesFor(
        seqGroup.map((i) => ({ id: i.id, sceneIndex: i.sceneIndex as number })),
        d.sceneIndex,
      )
    : { onlyThis: false, thisAndForward: false };
const isSeqMiddle = modes.onlyThis || modes.thisAndForward;
```

Render: si `isSeqMiddle`, mostrar dos botones; si no, el botón "Regenerar" actual (modo `auto`):

```tsx
{isSeqMiddle ? (
  <>
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => handleRegenerate(d.id, 'only-this')}
      title="Rehace solo este clip, conservando los vecinos (lo ancla al inicio del siguiente)"
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
    >
      {busy === `regen:${d.id}` ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="size-3" aria-hidden />
      )}
      Regenerar solo este
    </button>
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => handleRegenerate(d.id, 'this-and-forward')}
      title="Rehace este clip y vuelve a encadenar los siguientes"
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
    >
      Este y los siguientes
    </button>
  </>
) : (
  <button
    type="button"
    disabled={busy !== null}
    onClick={() => handleRegenerate(d.id)}
    title="Regenerar esta escena (reemplaza el borrador)"
    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
  >
    {busy === `regen:${d.id}` ? (
      <Loader2 className="size-3 animate-spin" aria-hidden />
    ) : (
      <RefreshCw className="size-3" aria-hidden />
    )}
    Regenerar
  </button>
)}
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/campaigns/CampaignStudioView.tsx
git commit -m "feat(campaigns): menu de regeneracion segun posicion del clip"
```

---

## Task 8: Verificación final + smoke (lo corre el usuario)

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm vitest run && pnpm lint`
Expected: todo verde.

- [ ] **Step 2: Smoke con API real (usuario, `SEEDANCE_PROVIDER=atlas`)**

Guion manual:
1. Crear una campaña con una secuencia de 4 clips y generar el lote completo.
2. "Regenerar solo este" en el clip 3. Verificar que clips 2 y 4 NO cambian de generación y que el clip 3 termina empalmando con el inicio del 4.
3. "Regenerar este y los siguientes" en el clip 2. Verificar que 2, 3 y 4 se regeneran en cadena y 1 queda intacto.
4. Verificar el warning "Anclado al inicio del clip siguiente…" en la card del clip regenerado en modo A.

> Si el aterrizaje del modo A es pobre, ajustar el texto de cierre en
> `buildContinuationPrompt` (Task 3) — **no** cambiar a i2v (decisión del spec).

- [ ] **Step 3: Reportar resultado del smoke**

Anotar en el PR/commit el comportamiento observado del anclaje por prompt.

---

## Notas de cobertura del spec

- Modo A (R2V + 3 referencias + prompt de cierre): Tasks 3, 4, 5. **Sin i2v ni `last_image`.**
- Modo B (cascada vía `advanceSequenceChain`): Task 6.
- Menú inteligente por posición: Tasks 1, 7.
- Frame de cierre a resolución completa: Task 2, 4.
- Aviso = warning informativo: Task 5, Step 3.
- Casos borde (clip siguiente sin generar / sin output / ffmpeg falla → cae a solo-init): Task 4 (retorna null) + Task 5 (`anchored=false`).
- Créditos por generación vía `reserveCredits` (modo A: 1; modo B: cascada reserva por clip en `advanceSequenceChain`): Tasks 5, 6.
- Idempotencia QStash en la cascada: heredada de `advanceSequenceChain` (spec 09).
```
