# Zona segura 9:16 por outpaint con mascara (FLUX.1 Expand) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** En modo estricto de zona segura, generar la base del panel en 4:5 con Nano y expandirla a 9:16 con BFL FLUX.1 Expand (outpaint con mascara), garantizando un 4:5 exacto y un 9:16 nitido.

**Architecture:** Nano genera el panel en 4:5 (el frame 4:5 ES la zona segura: el producto sale completo y a escala). Un adapter nuevo (`lib/providers/flux-expand.ts`) llama al endpoint `/v1/flux-pro-1.0-expand` de BFL para agregar bandas reales arriba y abajo hasta 9:16, preservando los pixeles originales. La accion server orquesta base -> expand, con fallback al 9:16 nativo si el expand falla. Geometria y crop de la cadena en `lib/images/safe-area.ts`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase Storage, BFL FLUX.1 Expand (HTTP submit+poll), sharp (geometria/crop), vitest, pnpm.

## Global Constraints

- Sin emojis en codigo ni UI.
- No `any` en TypeScript: usar `unknown` + narrowing o un tipo explicito.
- pnpm para todo (`pnpm add`, `pnpm typecheck`, `pnpm build`, `pnpm vitest`). Nunca npm.
- Commits sin trailer `Co-Authored-By`.
- Archivos nuevos UTF-8 SIN BOM.
- Clausulas de prompt en ASCII y, cuando se concatenan, empiezan con un espacio.
- `'use server'` (server-actions/storyboard.ts) solo exporta funciones async. No exportar objetos/constantes desde ese modulo (solo `pnpm build` lo detecta).
- Las URLs de proveedor NUNCA llegan al cliente: el worker/accion descarga el output del expand y lo sube a Supabase; solo URLs internas `*.supabase.co`.
- Service role solo server-side.
- Tests NO llaman APIs reales (BFL/Gemini/fal.ai/QStash). El unico llamado real es el script probe que el USUARIO corre a proposito.
- No imprimir ni materializar `.env.local` ni keys. El script probe usa la key en proceso e imprime solo longitudes/estado, nunca la key.
- Sin migracion: reusa el flag `safeAreaExtend` ya existente.
- Adapters siguen `.cursor/rules/30-providers.mdc` (errores tipados con `ProviderError`).

**Spec de referencia:** `docs/superpowers/specs/2026-06-30-zona-segura-outpaint-flux-expand-design.md`

---

### Task 1: Probe-first del endpoint FLUX.1 Expand (gate, lo corre el usuario)

**Files:**
- Create: `scripts/probe-flux-expand.mjs`

**Interfaces:**
- Consumes: `BFL_API_KEY` desde `.env.local` (en proceso, sin imprimirla).
- Produces: nada que consuman otras tareas. Es un CHECKPOINT HUMANO: confirma que la cuenta tiene habilitado `/v1/flux-pro-1.0-expand` antes de invertir en el resto. Si falla (404/403/Not Found), se detiene la ejecucion y se re-disena el adapter sobre el endpoint que si exista (`fill` con mascara, o fal.ai).

**Nota de ejecucion (SDD):** el implementer ENTREGA el script; NO lo corre (no llama APIs reales). Tras esta tarea, el controlador PAUSA y pide al usuario correr `node scripts/probe-flux-expand.mjs` y reportar el resultado. Solo con `Ready`/`polling_url` valido se continua con Task 2+.

- [ ] **Step 1: Escribir el script probe**

Create `scripts/probe-flux-expand.mjs`:

```js
// Probe manual (lo corre el usuario) para confirmar que la cuenta BFL tiene
// habilitado el endpoint FLUX.1 Expand antes de construir la integracion.
// No imprime la key. Genera una imagen de prueba local con sharp, hace un POST
// minimo a /v1/flux-pro-1.0-expand con top/bottom chicos y reporta el resultado.
// Uso: node scripts/probe-flux-expand.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const BFL_BASE = 'https://api.bfl.ai';

function loadKey() {
  // Lee BFL_API_KEY de process.env o de .env.local (sin imprimirla).
  if (process.env.BFL_API_KEY) return process.env.BFL_API_KEY;
  try {
    const env = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const line = env.split(/\r?\n/).find((l) => l.startsWith('BFL_API_KEY='));
    if (line) return line.slice('BFL_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  } catch {
    /* sin .env.local */
  }
  return '';
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error('FALTA BFL_API_KEY (env o .env.local). Abort.');
    process.exit(2);
  }
  console.log(`BFL_API_KEY presente (len=${apiKey.length}).`);

  // Imagen de prueba 360x450 (4:5) llena de un color, JPEG.
  const base = await sharp({
    create: { width: 360, height: 450, channels: 3, background: { r: 40, g: 80, b: 160 } },
  })
    .jpeg()
    .toBuffer();

  const body = {
    image: base.toString('base64'),
    top: 95,
    bottom: 95,
    left: 0,
    right: 0,
    prompt: 'extend the scene naturally above and below',
    output_format: 'jpeg',
    safety_tolerance: 2,
  };

  const submit = await fetch(`${BFL_BASE}/v1/flux-pro-1.0-expand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
    body: JSON.stringify(body),
  });

  console.log(`POST /v1/flux-pro-1.0-expand -> HTTP ${submit.status}`);
  const text = await submit.text();

  if (submit.status === 404) {
    console.error('RESULTADO: 404 Not Found. El endpoint NO esta habilitado en la cuenta. PIVOTEAR.');
    process.exit(1);
  }
  if (submit.status === 403 || submit.status === 401) {
    console.error(`RESULTADO: ${submit.status} auth. Revisar key/permisos. Cuerpo: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  if (!submit.ok) {
    console.error(`RESULTADO: HTTP ${submit.status}. Cuerpo: ${text.slice(0, 300)}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`Respuesta no-JSON: ${text.slice(0, 200)}`);
    process.exit(1);
  }
  if (parsed.polling_url) {
    console.log('RESULTADO: OK. El endpoint existe y devolvio polling_url.');
    console.log(`id=${parsed.id ?? '(sin id)'}`);
    console.log('Endpoint DISPONIBLE. Continuar con Task 2.');
    process.exit(0);
  }
  console.error(`Respuesta inesperada (sin polling_url): ${JSON.stringify(parsed).slice(0, 300)}`);
  process.exit(1);
}

main().catch((e) => {
  console.error('Error inesperado:', e?.message ?? e);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar que parsea (sin red)**

Run: `node --check scripts/probe-flux-expand.mjs`
Expected: sin salida, exit 0 (sintaxis valida).

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-flux-expand.mjs
git commit -m "chore(storyboard): probe-first de FLUX.1 Expand (lo corre el usuario)"
```

- [ ] **Step 4: CHECKPOINT — el usuario corre el probe**

El controlador pide al usuario: `node scripts/probe-flux-expand.mjs`. Si imprime "Endpoint DISPONIBLE" -> seguir con Task 2. Si 404/403 -> DETENER el plan y re-disenar el adapter.

---

### Task 2: Geometria de zona segura (`lib/images/safe-area.ts`)

**Files:**
- Create: `lib/images/safe-area.ts`
- Test: `lib/images/safe-area.test.ts`

**Interfaces:**
- Produces:
  - `safeAreaBands(width: number): { bandPx: number; canvasHeight: number }` — para un 4:5 de ancho `width` dentro de un 9:16: `canvasHeight = round(width*16/9)`, `baseHeight = round(width*5/4)`, `bandPx = round((canvasHeight - baseHeight)/2)`.
  - `centralSafeCrop(panel916: Buffer): Promise<Buffer>` — recorta el 4:5 central de un JPEG/PNG 9:16 (quita `bandPx` arriba y abajo, conserva el ancho). Usa `sharp(panel916).metadata()` para el ancho real y `safeAreaBands(width)`.

- [ ] **Step 1: Escribir el test que falla**

Create `lib/images/safe-area.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { safeAreaBands, centralSafeCrop } from './safe-area';

describe('safeAreaBands', () => {
  it('360 de ancho -> canvas 640, banda 95', () => {
    expect(safeAreaBands(360)).toEqual({ bandPx: 95, canvasHeight: 640 });
  });
  it('la base 4:5 + 2 bandas reconstruye el canvas 9:16', () => {
    const { bandPx, canvasHeight } = safeAreaBands(360);
    const baseHeight = Math.round(360 * 5 / 4);
    expect(baseHeight + 2 * bandPx).toBe(canvasHeight);
  });
});

describe('centralSafeCrop', () => {
  it('de un 9:16 (360x640) recorta el 4:5 central (360x450)', async () => {
    const panel = await sharp({
      create: { width: 360, height: 640, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const cropped = await centralSafeCrop(panel);
    const meta = await sharp(cropped).metadata();
    expect(meta.width).toBe(360);
    expect(meta.height).toBe(450);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/images/safe-area.test.ts`
Expected: FAIL — `Cannot find module './safe-area'`.

- [ ] **Step 3: Implementar la geometria**

Create `lib/images/safe-area.ts`:

```ts
// Geometria de la zona segura 4:5 dentro de un 9:16. Un 4:5 (mas cuadrado) dentro
// de un 9:16 (mas alto) solo recorta ALTURA: se conserva el ancho completo y se
// quitan bandas iguales arriba y abajo. safeAreaBands da cuanta banda agregar (para
// el expand) y centralSafeCrop recorta el 4:5 central de un 9:16 (para encadenar la
// base del siguiente beat). Sin red.
import sharp from 'sharp';

export function safeAreaBands(width: number): { bandPx: number; canvasHeight: number } {
  const canvasHeight = Math.round((width * 16) / 9);
  const baseHeight = Math.round((width * 5) / 4);
  const bandPx = Math.round((canvasHeight - baseHeight) / 2);
  return { bandPx, canvasHeight };
}

export async function centralSafeCrop(panel916: Buffer): Promise<Buffer> {
  const meta = await sharp(panel916).metadata();
  const width = meta.width ?? 0;
  if (!width) throw new Error('centralSafeCrop: ancho desconocido');
  const baseHeight = Math.round((width * 5) / 4);
  const { bandPx } = safeAreaBands(width);
  return sharp(panel916)
    .extract({ left: 0, top: bandPx, width, height: baseHeight })
    .jpeg()
    .toBuffer();
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/images/safe-area.test.ts`
Expected: PASS (4 asserts).

- [ ] **Step 5: Commit**

```bash
git add lib/images/safe-area.ts lib/images/safe-area.test.ts
git commit -m "feat(images): geometria de zona segura (safeAreaBands + centralSafeCrop)"
```

---

### Task 3: Adapter FLUX.1 Expand (`lib/providers/flux-expand.ts`)

**Files:**
- Create: `lib/providers/flux-expand.ts`
- Test: `lib/providers/flux-expand.test.ts`
- Reference (leer, no modificar): `lib/providers/flux.ts` (patron submit/poll/download), `lib/providers/types.ts` (`ProviderError`, `GenerationResult`).

**Interfaces:**
- Consumes: `ProviderError`, `GenerationResult` de `@/lib/providers/types`.
- Produces:
  - `type ExpandParams = { image: Buffer; top: number; bottom: number; left?: number; right?: number; prompt: string; safetyTolerance?: number }`
  - `buildExpandBody(params: ExpandParams): Record<string, unknown>` — arma el body JSON (base64 raw de la imagen, `top`/`bottom`/`left`/`right`, `prompt`, `output_format: 'jpeg'`, `safety_tolerance`). Exportada para test determinista (no red).
  - `expand(params: ExpandParams, apiKey?: string): Promise<GenerationResult>` — submit + poll + download; devuelve `{ buffer, mimeType }`.

- [ ] **Step 1: Escribir el test que falla (solo buildExpandBody, sin red)**

Create `lib/providers/flux-expand.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildExpandBody } from './flux-expand';

describe('buildExpandBody', () => {
  const image = Buffer.from('hello-image');
  it('lleva la imagen en base64 raw (sin prefijo data:)', () => {
    const body = buildExpandBody({ image, top: 95, bottom: 95, prompt: 'p' });
    expect(body.image).toBe(image.toString('base64'));
    expect(String(body.image)).not.toContain('data:');
  });
  it('pasa top/bottom y deja left/right en 0 por defecto', () => {
    const body = buildExpandBody({ image, top: 95, bottom: 95, prompt: 'p' });
    expect(body.top).toBe(95);
    expect(body.bottom).toBe(95);
    expect(body.left).toBe(0);
    expect(body.right).toBe(0);
  });
  it('incluye el prompt, output_format jpeg y safety_tolerance por defecto', () => {
    const body = buildExpandBody({ image, top: 95, bottom: 95, prompt: 'extiende' });
    expect(body.prompt).toBe('extiende');
    expect(body.output_format).toBe('jpeg');
    expect(body.safety_tolerance).toBe(2);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/providers/flux-expand.test.ts`
Expected: FAIL — `Cannot find module './flux-expand'`.

- [ ] **Step 3: Implementar el adapter (mirroring flux.ts)**

Create `lib/providers/flux-expand.ts`:

```ts
// Adapter BFL FLUX.1 Expand (outpaint con mascara): /v1/flux-pro-1.0-expand.
// Mismo patron submit + poll + download que flux.ts (mismo host, misma key x-key,
// mismos timeouts). Recibe una imagen base (4:5) y cuantos pixeles agregar arriba y
// abajo; preserva los pixeles originales y genera bandas reales hasta 9:16.
import { z } from 'zod';
import { ProviderError, type GenerationResult } from './types';

const BFL_BASE = 'https://api.bfl.ai';
const EXPAND_ENDPOINT = `${BFL_BASE}/v1/flux-pro-1.0-expand`;
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 30000;

export type ExpandParams = {
  image: Buffer;
  top: number;
  bottom: number;
  left?: number;
  right?: number;
  prompt: string;
  safetyTolerance?: number;
};

// Arma el body JSON del expand. Exportada para test determinista (no llama a red).
export function buildExpandBody(params: ExpandParams): Record<string, unknown> {
  return {
    image: params.image.toString('base64'),
    top: params.top,
    bottom: params.bottom,
    left: params.left ?? 0,
    right: params.right ?? 0,
    prompt: params.prompt,
    output_format: 'jpeg',
    safety_tolerance: params.safetyTolerance ?? 2,
  };
}

const SubmitResponseSchema = z.object({ id: z.string(), polling_url: z.string().url() });
const PollResponseSchema = z.object({
  status: z.enum(['Pending', 'Ready', 'Error', 'Failed', 'Request Moderated', 'Content Moderated', 'Task not found']),
  result: z.object({ sample: z.string().url() }).nullish(),
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function submit(params: ExpandParams, apiKey: string): Promise<string> {
  const res = await fetch(EXPAND_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-key': apiKey },
    body: JSON.stringify(buildExpandBody(params)),
  });
  if (res.status === 429) {
    throw new ProviderError('FLUX expand rate limited', 'rate_limit', true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('FLUX expand auth error', 'auth', false);
  }
  if (res.status === 402) {
    throw new ProviderError('Creditos insuficientes en BFL', 'auth', false);
  }
  if (res.status === 404) {
    throw new ProviderError('FLUX expand endpoint no disponible', 'invalid_input', false);
  }
  if (!res.ok) {
    throw new ProviderError(`FLUX expand submit ${res.status}`, 'server', res.status >= 500);
  }
  const parsed = SubmitResponseSchema.parse(await res.json());
  return parsed.polling_url;
}

async function pollUntilReady(pollingUrl: string, apiKey: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(pollingUrl, { headers: { 'x-key': apiKey } });
    if (!res.ok) {
      throw new ProviderError(`FLUX expand poll ${res.status}`, 'server', res.status >= 500);
    }
    const parsed = PollResponseSchema.parse(await res.json());
    if (parsed.status === 'Ready' && parsed.result?.sample) return parsed.result.sample;
    if (parsed.status === 'Error' || parsed.status === 'Failed') {
      throw new ProviderError(`FLUX expand ${parsed.status}`, 'server', true);
    }
    if (parsed.status === 'Request Moderated' || parsed.status === 'Content Moderated') {
      throw new ProviderError('FLUX expand moderado', 'safety', false);
    }
    if (parsed.status === 'Task not found') {
      throw new ProviderError('FLUX expand task not found', 'unknown', false);
    }
  }
  throw new ProviderError('FLUX expand timeout', 'timeout', true);
}

async function download(sampleUrl: string): Promise<GenerationResult> {
  const res = await fetch(sampleUrl);
  if (!res.ok) {
    throw new ProviderError(`FLUX expand download ${res.status}`, 'server', res.status >= 500);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  return { buffer, mimeType };
}

export async function expand(params: ExpandParams, apiKey?: string): Promise<GenerationResult> {
  const key = apiKey ?? process.env.BFL_API_KEY;
  if (!key) throw new ProviderError('Falta BFL_API_KEY', 'auth', false);
  const pollingUrl = await submit(params, key);
  const sampleUrl = await pollUntilReady(pollingUrl, key);
  return download(sampleUrl);
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/providers/flux-expand.test.ts`
Expected: PASS (3 asserts). El test no toca `expand`/red.

- [ ] **Step 5: Commit**

```bash
git add lib/providers/flux-expand.ts lib/providers/flux-expand.test.ts
git commit -m "feat(providers): adapter FLUX.1 Expand (outpaint con mascara)"
```

---

### Task 4: `guidelinesForSafeBase` en `lib/campaigns/guidelines.ts`

**Files:**
- Modify: `lib/campaigns/guidelines.ts` (agregar funcion al final, antes del cierre del archivo)
- Test: `lib/campaigns/guidelines.test.ts` (agregar describe; si no existe el archivo, crearlo)

**Interfaces:**
- Consumes: `CreativeGuidelines` (ya definido en el archivo).
- Produces: `guidelinesForSafeBase(guidelines: CreativeGuidelines | undefined): CreativeGuidelines | undefined` — devuelve `{ ...guidelines, safeCrop: null }` para que la base 4:5 NO emita la clausula de safeCrop (en un 4:5 el frame YA es la zona segura). Si `guidelines` es undefined, devuelve undefined.

- [ ] **Step 1: Escribir el test que falla**

Si `lib/campaigns/guidelines.test.ts` no existe, crearlo con este contenido; si existe, agregar el `describe`:

```ts
import { describe, it, expect } from 'vitest';
import { guidelinesForSafeBase, creativeGuidelineClauses } from './guidelines';

describe('guidelinesForSafeBase', () => {
  it('anula safeCrop y conserva el resto', () => {
    const out = guidelinesForSafeBase({ showFullProduct: true, safeCrop: '4:5', safeAreaExtend: true });
    expect(out).toEqual({ showFullProduct: true, safeCrop: null, safeAreaExtend: true });
  });
  it('undefined -> undefined', () => {
    expect(guidelinesForSafeBase(undefined)).toBeUndefined();
  });
  it('la base 4:5 no emite la clausula de safe-crop', () => {
    const base = guidelinesForSafeBase({ safeCrop: '4:5' });
    expect(creativeGuidelineClauses(base)).toBe('');
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/guidelines.test.ts`
Expected: FAIL — `guidelinesForSafeBase is not a function` / no exportada.

- [ ] **Step 3: Implementar la funcion**

En `lib/campaigns/guidelines.ts`, agregar al final del archivo (despues de `creativeGuidelineClauses`):

```ts
// Para la BASE 4:5 del modo estricto: el frame 4:5 YA es la zona segura, asi que
// emitir la clausula de safeCrop ahi seria redundante (encogeria el producto dentro
// de un 4:5 que de por si es el area segura). Anula safeCrop conservando el resto de
// las guias (showFullProduct/hookProductHero siguen vigentes).
export function guidelinesForSafeBase(
  guidelines: CreativeGuidelines | undefined,
): CreativeGuidelines | undefined {
  if (!guidelines) return undefined;
  return { ...guidelines, safeCrop: null };
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/campaigns/guidelines.test.ts`
Expected: PASS (3 asserts).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/guidelines.ts lib/campaigns/guidelines.test.ts
git commit -m "feat(campaigns): guidelinesForSafeBase (la base 4:5 no emite safeCrop)"
```

---

### Task 5: Integrar el expand en la accion (`server-actions/storyboard.ts`)

**Files:**
- Modify: `server-actions/storyboard.ts`
- Modify: `lib/campaigns/storyboard.ts` (eliminar `SAFE_ZONE_STRONG_CLAUSE`)
- Modify: `lib/campaigns/storyboard.test.ts` (eliminar el test de `SAFE_ZONE_STRONG_CLAUSE`, si existe)

**Interfaces:**
- Consumes: `expand` + `ExpandParams` de `@/lib/providers/flux-expand`; `safeAreaBands`, `centralSafeCrop` de `@/lib/images/safe-area`; `guidelinesForSafeBase` de `@/lib/campaigns/guidelines`.
- Produces: una helper local `extendPanelTo916(base: { buffer: Buffer; mimeType: string }, scenePrompt: string): Promise<{ buffer: Buffer; mimeType: string }>` que, en estricto, expande la base 4:5 a 9:16 y, ante cualquier error, hace fallback devolviendo la base tal cual (el llamador ya tiene la base como respaldo del 9:16 nativo). Esta helper es interna (no se exporta: `'use server'` solo exporta funciones async usadas como acciones — definirla como funcion local, no exportada).

**Contexto de wiring (estado actual):** en `generatePanelAction`, `strictSafe` ya existe (lineas ~272-275); hoy `baseDirCtx = dirCtx` y `genAspect = item.aspect_ratio ?? '9:16'` (9:16 nativo), `panelPrompt` concatena `SAFE_ZONE_STRONG_CLAUSE`, `passes: 1`, y `finalImage = { buffer: result.buffer, mimeType: result.mimeType }`. `refinePanelAction` tiene el espejo (refineDirCtx, genAspect, prompt + SAFE_ZONE_STRONG_CLAUSE, passes:1, finalImage). El objetivo: en estricto generar la base en 4:5 (sin la clausula de texto, con `guidelinesForSafeBase`), expandir a 9:16, recortar el prevTurn a 4:5, y subir `passes:2`.

- [ ] **Step 1: Eliminar `SAFE_ZONE_STRONG_CLAUSE` (constante + su test)**

En `lib/campaigns/storyboard.ts`, eliminar el bloque del comentario `// Clausula de zona segura ESTRICTA ...` y la `export const SAFE_ZONE_STRONG_CLAUSE = '...';` (lineas ~116-121). En `lib/campaigns/storyboard.test.ts`, eliminar cualquier `describe`/`it` que referencie `SAFE_ZONE_STRONG_CLAUSE`.

- [ ] **Step 2: Correr typecheck para confirmar las referencias rotas**

Run: `pnpm typecheck`
Expected: FAIL — `server-actions/storyboard.ts` aun importa/usa `SAFE_ZONE_STRONG_CLAUSE` (se arregla en el Step 3).

- [ ] **Step 3: Actualizar imports en `server-actions/storyboard.ts`**

Cambiar la linea de import de `@/lib/campaigns/storyboard` (linea ~31) para QUITAR `SAFE_ZONE_STRONG_CLAUSE`:

```ts
import { compilePanel, compilePanelEdit, compileRefinePrompt, humanRealismDirective, chainedProductFidelity, chainedCharacterFidelity } from '@/lib/campaigns/storyboard';
```

Agregar (cerca de los otros imports de `@/lib/...`):

```ts
import { creativeGuidelineClauses, guidelinesForSafeBase } from '@/lib/campaigns/guidelines';
import { safeAreaBands, centralSafeCrop } from '@/lib/images/safe-area';
import { expand } from '@/lib/providers/flux-expand';
```

Nota: `creativeGuidelineClauses` ya se importa hoy; si ya esta en un import de `@/lib/campaigns/guidelines`, solo agregar `guidelinesForSafeBase` a esa linea en vez de duplicar el import.

- [ ] **Step 4: Agregar la helper `extendPanelTo916` (funcion local, no exportada)**

En `server-actions/storyboard.ts`, junto a las otras helpers locales (p.ej. cerca de `loadPreviousPanelTurn`, NO exportada):

```ts
// Expande una base 4:5 a 9:16 con FLUX.1 Expand (outpaint con mascara). Agrega
// bandas reales arriba y abajo preservando el centro 4:5. Ante CUALQUIER fallo
// (endpoint no disponible, 402, timeout, sin imagen) hace fallback devolviendo la
// base tal cual: el panel nunca se rompe, el estricto solo "mejora" si el expand
// esta disponible. El crop a 4:5 sigue siendo exacto porque el centro se preserva.
async function extendPanelTo916(
  base: { buffer: Buffer; mimeType: string },
  scenePrompt: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const meta = await sharp(base.buffer).metadata();
    const width = meta.width ?? 0;
    if (!width) return base;
    const { bandPx } = safeAreaBands(width);
    const prompt = `Extend this scene naturally above and below to a taller vertical frame, continuing the same background, lighting and colors; do not add or change any subject. Scene: ${scenePrompt.trim()}`;
    const result = await expand({ image: base.buffer, top: bandPx, bottom: bandPx, prompt });
    return { buffer: result.buffer, mimeType: result.mimeType };
  } catch (err) {
    console.error('extendPanelTo916 fallback a 9:16 nativo:', err instanceof Error ? err.message : err);
    return base;
  }
}
```

Confirmar que `sharp` ya esta importado en el archivo; si no, agregar `import sharp from 'sharp';`.

- [ ] **Step 5: Wire estricto en `generatePanelAction`**

a) Reemplazar el bloque de `baseDirCtx`/`genAspect` (lineas ~276-279) por:

```ts
  // Modo estricto: la base se genera en 4:5 (el frame 4:5 ES la zona segura, el
  // producto sale completo y a escala) y luego se expande a 9:16 con FLUX. La base
  // NO emite la clausula de safeCrop (guidelinesForSafeBase) porque en un 4:5 seria
  // redundante. Fuera de estricto: 9:16 nativo, comportamiento actual.
  const baseDirCtx = strictSafe ? { ...dirCtx, guidelines: guidelinesForSafeBase(dirCtx.guidelines) } : dirCtx;
  const genAspect = strictSafe ? '4:5' : (item.aspect_ratio ?? '9:16');
```

b) Recortar el prevTurn a 4:5 en estricto. Tras la linea `const prevTurn = await loadPreviousPanelTurn(...);` (linea ~297), agregar:

```ts
  // Encadenado en estricto: el panel previo se guardo como 9:16; su base es el 4:5
  // central. Se recorta para que el turno conversacional arranque desde la misma
  // base 4:5 que se va a generar (sin esto el modelo encadenaria sobre un 9:16).
  if (strictSafe && prevTurn) {
    prevTurn.imageBuffer = await centralSafeCrop(prevTurn.imageBuffer);
  }
```

c) Quitar la concatenacion de la clausula de texto: reemplazar la linea ~338-339:

```ts
  const panelPrompt = panelPromptBody;
```

(Eliminar el comentario `// Zona segura estricta: refuerza el prompt ...` y el ternario con `SAFE_ZONE_STRONG_CLAUSE`.)

d) Subir `passes` a 2 en estricto (estimador): reemplazar la linea ~348:

```ts
    params: { conversational: Boolean(prevTurn), passes: strictSafe ? 2 : 1 },
```

e) Expandir tras generar: reemplazar el bloque de `finalImage` (lineas ~440-441):

```ts
    // Estricto: la base 4:5 se expande a 9:16 con FLUX (outpaint real). Fuera de
    // estricto: el 9:16 nativo se usa tal cual.
    const finalImage = strictSafe
      ? await extendPanelTo916({ buffer: result.buffer, mimeType: result.mimeType }, item.scene_prompt)
      : { buffer: result.buffer, mimeType: result.mimeType };
```

- [ ] **Step 6: Wire estricto en `refinePanelAction`**

Aplicar el espejo en `refinePanelAction`:

a) Donde define el dir-ctx del refinado (`refineDirCtx`), usar `guidelinesForSafeBase` en estricto, igual que en (5a). Si `refineDirCtx = dirCtx` hoy, cambiar a:

```ts
  const refineDirCtx = strictSafe ? { ...dirCtx, guidelines: guidelinesForSafeBase(dirCtx.guidelines) } : dirCtx;
```

b) `genAspect = strictSafe ? '4:5' : (item.aspect_ratio ?? '9:16')`.

c) Recortar el `previousTurn` a 4:5 en estricto, tras construirlo (bloque ~744): si `strictSafe && previousTurn`, `previousTurn.imageBuffer = await centralSafeCrop(previousTurn.imageBuffer);`.

d) Quitar `+ (strictSafe ? SAFE_ZONE_STRONG_CLAUSE : '')` del `refinePrompt` (linea ~654): dejar solo `compileRefinePrompt(...)`.

e) `params: { conversational: true, passes: strictSafe ? 2 : 1 }` (linea ~662).

f) Reemplazar el `finalImage` del refinado (lineas ~766-767):

```ts
    const finalImage = strictSafe
      ? await extendPanelTo916({ buffer: result.buffer, mimeType: result.mimeType }, item.scene_prompt)
      : { buffer: result.buffer, mimeType: result.mimeType };
```

- [ ] **Step 7: Verificar typecheck, lint y build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS. `pnpm build` confirma que `'use server'` no exporta no-funciones (la helper es local, no exportada) y que no quedan referencias a `SAFE_ZONE_STRONG_CLAUSE`.

- [ ] **Step 8: Correr los tests de los modulos tocados**

Run: `pnpm vitest run lib/campaigns/storyboard.test.ts lib/images/safe-area.test.ts lib/providers/flux-expand.test.ts lib/campaigns/guidelines.test.ts`
Expected: PASS (sin el test borrado de `SAFE_ZONE_STRONG_CLAUSE`).

- [ ] **Step 9: Commit**

```bash
git add server-actions/storyboard.ts lib/campaigns/storyboard.ts lib/campaigns/storyboard.test.ts
git commit -m "feat(storyboard): zona segura estricta por outpaint (base 4:5 -> expand 9:16) con fallback"
```

---

### Task 6: Estimador (verificar) y copy del editor (~2x)

**Files:**
- Modify: `components/campaigns/CreativeGuidelinesEditor.tsx` (copy)
- Reference (leer, no modificar): `lib/credits/estimator.ts` (ya modela `passes>1` como pasada extra), `lib/credits/estimator.test.ts` (ya cubre `passes=2 duplica`).

**Interfaces:**
- Consumes: el `passes: 2` que Task 5 ya emite en estricto. El estimador (`lib/credits/estimator.ts:79-80`) ya convierte `passes>1` en un bonus `(passes-1)*base`; NO requiere cambio de codigo.

- [ ] **Step 1: Confirmar que el estimador ya cubre passes=2**

Run: `pnpm vitest run lib/credits/estimator.test.ts`
Expected: PASS — incluye `passes=2 duplica el total (zona segura estricta, aditivo)`. No se toca el estimador.

- [ ] **Step 2: Actualizar la copy del editor**

En `components/campaigns/CreativeGuidelinesEditor.tsx`, reemplazar el texto del switch (lineas ~68 y ~71):

Linea ~68 (label del switch):

```tsx
              Zona segura 4:5 (extiende el 4:5 a 9:16 con outpaint)
```

Linea ~71 (descripcion):

```tsx
              Genera la base en 4:5 (producto completo y a escala) y la expande a 9:16 con outpaint real: el 9:16 queda nitido y el recorte a 4:5 es exacto. Cuesta ~2x (base + expansion).
```

- [ ] **Step 3: Verificar typecheck/lint del componente**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/campaigns/CreativeGuidelinesEditor.tsx
git commit -m "feat(campaigns): copy del editor de zona segura (outpaint, ~2x)"
```

---

## Self-Review

**Spec coverage:**
- Probe-first (gate) -> Task 1.
- Adapter `flux-expand.ts` con `buildExpandBody` testeable -> Task 3.
- Geometria `safeAreaBands` + `centralSafeCrop` re-creada minima (sin composeOnto916/pinCenter) -> Task 2.
- `extendPanelTo916` re-introducida con fallback a 9:16 nativo -> Task 5 (Step 4).
- Estricto: `genAspect='4:5'`, `guidelinesForSafeBase`, crop del prevTurn, expand, deja de concatenar `SAFE_ZONE_STRONG_CLAUSE` (eliminada con su test) -> Task 4 + Task 5.
- Estimador ~2x + copy del editor -> Task 6.
- Sin migracion (reusa `safeAreaExtend`) -> ningun task la agrega. Correcto.
- Fuera de alcance (modelo de la base, print que deriva, outpaint lateral) -> no hay tasks. Correcto.

**Placeholder scan:** sin TBD/TODO; todo paso de codigo lleva el codigo completo.

**Type consistency:** `ExpandParams`/`buildExpandBody`/`expand` consistentes entre Task 3 (definicion) y Task 5 (uso). `safeAreaBands`/`centralSafeCrop` consistentes entre Task 2 y Task 5. `guidelinesForSafeBase` consistente entre Task 4 y Task 5. `GenerationResult` (`{ buffer, mimeType }`) coincide con lo que `extendPanelTo916` consume.

**Riesgo conocido (verificar en ejecucion):** el wiring del Step 5/6 referencia lineas aproximadas; el implementer debe anclar por contenido (los strings citados), no por numero de linea (el archivo cambia). La existencia del import de `sharp` y de `creativeGuidelineClauses` se verifica antes de duplicar.
