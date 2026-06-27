# Refactor de archivos monstruo y separación de responsabilidades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir la deuda estructural de las 11 unidades con salud ≤7/10 del audit 2026-06-27, partiendo los archivos monstruo y eliminando la duplicación transversal, sin cambiar comportamiento ni violar ninguna decisión arquitectónica inmutable.

**Architecture:** Refactor de movimiento/extracción en 4 olas por dependencia y ROI. La Ola 1 crea los helpers compartidos (ciclo de vida de generación, turno previo, http de providers, slugs de modelo, `Result`) que el resto consume, evitando que cada split reinvente lo mismo. Las olas siguientes parten vistas cliente (Ola 2), server actions (Ola 3) y el hot path de créditos/encadenado (Ola 4). Cada función pura extraída a `lib/` se cubre con un test de caracterización; cada cambio en archivos `'use server'` se verifica con `pnpm build`.

**Tech Stack:** Next.js 15 (App Router) · React 19 · TypeScript estricto · Supabase (Postgres/RLS/Storage/Realtime) · Upstash QStash · vitest · pnpm · shadcn/ui · Tailwind v4 · Vercel Hobby.

## Global Constraints

Estas reglas aplican a **todos** los tasks de este plan (copiadas verbatim del audit y de CLAUDE.md):

- **Comportamiento idéntico.** Es refactor de movimiento, no de feature. La red de seguridad por task es: `pnpm test` (vitest, suite existente verde) + `pnpm typecheck` + `pnpm build` + smoke manual donde sea UI.
- **Gotcha `'use server'` (crítico).** Un archivo `'use server'` solo puede exportar funciones async. Exportar objetos/constantes/zod desde él rompe la ruta en producción y **ni typecheck ni lint lo detectan — solo `pnpm build`**. Helpers/constantes/tipos compartidos van a `lib/` (no `'use server'`) o se re-exportan como `export type`. Todo task que toque `'use server'` incluye un step `pnpm build`.
- **QStash polling, sin webhooks.** Todo lo que tarda >60s es asíncrono por polling re-encolado. `MAX_POLLS` y `timeout_at` son intencionales — no son bug.
- **URLs de proveedor nunca al cliente.** El worker descarga el output y sube a Supabase Storage; solo URLs internas `*.supabase.co`.
- **Créditos solo vía funciones SQL atómicas** (`reserve/confirm/refund_credits`, `charge/refund`, `complete/fail_generation`). Nunca update directo a `credit_balances`/`credit_transactions`.
- **Service role solo server-side.** RLS es red de seguridad; las server actions validan con zod + ownership.
- **Sin `any`** (usar `unknown` + narrowing o tipo explícito). Sin emojis en código/UI. Dark mode zinc-950 + acento `#009fff`. Server Components por default; `'use client'` solo con state/effects.
- **Commits sin trailer `Co-Authored-By`.** Mensajes cortos estilo conventional (`refactor:`, `test:`, `feat:`).
- **Tests sin APIs reales.** No llamar a Gemini/fal.ai/ElevenLabs/QStash en tests; los smoke con API real los corre el usuario.

## Orden de ejecución (4 olas)

| Ola | Qué | Unidades del audit (salud) | Riesgo |
|---|---|---|---|
| **1 — Fundaciones** | Helpers compartidos que desbloquean el resto | `lib/providers` (7) + duplicación transversal de generations/storyboard/campaigns | Medio (toca providers; cubierto por suite + build) |
| **2 — Vistas cliente** | Partir componentes monstruo, extraer hooks/helpers puros | `CampaignStudioView` (5), `LibraryView` (6), `Controls/VideoControls` (5), `app/page.tsx` (5) | Bajo (presentacional, no toca créditos) |
| **3 — Server actions** | Adelgazar acciones, mover negocio a `lib/`, validar con zod | `campaigns.ts` (5), `generations.ts` (6), `storyboard.ts` (6) | Medio (gotcha `'use server'`) |
| **4 — Hot path** | Partir orchestrator y worker apoyados en tests existentes | `orchestrator.ts`/`lib/campaigns` (6/7), worker `route.ts` (7) | Alto (créditos/encadenado; movimiento puro + red de tests) |

**Regla entre olas:** una ola no empieza hasta que la anterior deja la suite verde y `pnpm build` en OK. Dentro de cada ola, los tasks están ordenados para que la app compile y pase tests tras **cada** task — nunca un task que deje el repo roto.

**Excluidas del plan (salud 8/10, sanas):** `lib/prompt-director` y `lib/credits` + `lib/schemas`. Solo movimientos quirúrgicos opcionales documentados en el audit, no incluidos aquí.

---

## Ola 1 — Fundaciones compartidas (ejecutar primero)

Esta ola NO agrega features: es refactor de movimiento/extracción con comportamiento idéntico. Crea los helpers transversales que consumen las olas siguientes (splits de server actions, providers, worker) y borra las copias duplicadas hoy esparcidas en `server-actions/generations.ts`, `server-actions/storyboard.ts`, `server-actions/campaigns.ts` y `lib/providers/*`. La red de seguridad es: la suite `vitest` existente sigue verde + `pnpm typecheck` + `pnpm build` (obligatorio por el gotcha `'use server'`) + smoke manual donde una acción cambia de forma. Cada función PURA extraída a `lib/` (sin IO) se cubre con un test de caracterización que primero FALLA (módulo inexistente) y luego PASA. Todos los módulos nuevos viven en `lib/` o `server-actions/_shared/` (módulos normales, NO `'use server'`): así pueden exportar objetos/constantes/tipos sin romper rutas en prod.

### File Structure (archivos nuevos + responsabilidad)

```
server-actions/_shared/result.ts        ← Result<T,E> + ActionError compartidos (NO 'use server')
lib/media/image.ts                       ← inferExtension + nanoVariantToResolution (puros, testeables)
lib/providers/http.ts                    ← mapHttpError + downloadWithTimeout + requireEnvKey (server-only)
lib/providers/http.test.ts               ← caracterización de mapHttpError + requireEnvKey
lib/media/image.test.ts                  ← caracterización de inferExtension + nanoVariantToResolution
lib/generation/previous-turn.ts          ← loadPreviousTurn: turno conversacional previo (server-only)
lib/generation/credit-lifecycle.ts       ← reserveOrDeleteGeneration + safeFailGeneration (server-only)
lib/generation/run-sync-generation.ts    ← runSyncGeneration: ciclo síncrono reserve→generar→finalize→fail (server-only)
lib/generation/models.ts                 ← fuente única de slugs/labels de modelo (neutral: server y client)
lib/generation/models.test.ts            ← caracterización de VIDEO_MODEL_LABEL
lib/jobs/finalize.ts                     ← (refactor) devuelve {outputPath,thumbnailPath} + revalidatePaths param
```

---

### Task O1.1: Result<T,E> y ActionError compartidos

**Files:**
- Create: `server-actions/_shared/result.ts`
- Modify: `server-actions/generations.ts` (borra 43-53)
- Modify: `server-actions/storyboard.ts` (borra 45-57)

**Interfaces:**
- Produces: `export type ActionError = 'validation_error' | 'unauthenticated' | 'forbidden' | 'not_found' | 'insufficient_credits' | 'provider_error' | 'safety' | 'internal_error' | 'no_panel' | 'compile_error'`
- Produces: `export type Result<T, E extends string = ActionError> = { ok: true; data: T } | { ok: false; error: E; message?: string }`
- Consumes (en olas siguientes): cada server action split importa `Result`/`ActionError` de aquí en vez de redeclararlo.

**Steps:**
- [ ] **Step 1: Confirmar que no hay exhaustiveness `never` sobre `.error`.** Corre `grep -rn ": never" components app server-actions | grep -v node_modules`. Expected: sin coincidencias (ensanchar `ActionError` no rompe ningún switch exhaustivo).
- [ ] **Step 2: Crear el módulo compartido.** Escribe `server-actions/_shared/result.ts` con el contenido exacto:
  ```ts
  // Tipos de resultado compartidos por las server actions de generación.
  // NO lleva 'use server': exporta tipos, así que vive como módulo normal y las
  // acciones lo importan. ActionError es el superconjunto de los códigos usados
  // por generations.ts y storyboard.ts; cada acción produce un subconjunto.
  export type ActionError =
    | 'validation_error'
    | 'unauthenticated'
    | 'forbidden'
    | 'not_found'
    | 'insufficient_credits'
    | 'provider_error'
    | 'safety'
    | 'internal_error'
    | 'no_panel'
    | 'compile_error';

  export type Result<T, E extends string = ActionError> =
    | { ok: true; data: T }
    | { ok: false; error: E; message?: string };
  ```
- [ ] **Step 3: Migrar generations.ts.** Borra las líneas 43-53 (los `type ActionError` y `type Result<T>` locales) y añade el import tras la línea 41: `import type { Result } from '@/lib/auth/dal'` NO — usa `import type { Result } from './_shared/result';`. Expected: el archivo ya no declara `ActionError`/`Result` localmente.
- [ ] **Step 4: Migrar storyboard.ts.** Borra las líneas 45-57 y añade `import type { Result } from './_shared/result';` tras los imports existentes. Expected: sin declaraciones locales de `ActionError`/`Result`.
- [ ] **Step 5: Verificar.** Corre `pnpm typecheck && pnpm build`. Expected: ambos terminan sin errores (`build` confirma que el barrel `'use server'` sigue exportando solo funciones async). Luego `pnpm test`. Expected: suite verde.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "refactor(actions): Result/ActionError compartidos en _shared/result"`.

---

### Task O1.2: Unificar helpers de media puros (inferExtension, nanoVariantToResolution)

**Files:**
- Create: `lib/media/image.ts`
- Create: `lib/media/image.test.ts`
- Modify: `lib/jobs/finalize.ts` (borra 9-18, importa inferExtension)
- Modify: `server-actions/generations.ts` (borra 59-70 y 135-139)
- Modify: `server-actions/storyboard.ts` (borra 66-70 y 72-83)

**Interfaces:**
- Produces: `export function inferExtension(mime: string): string` (versión canónica de finalize.ts: png/webp/mp4/webm/mp3/wav/jpg/bin)
- Produces: `export function nanoVariantToResolution(variant: string): '512' | '1K' | '2K' | '4K'`

**Steps:**
- [ ] **Step 1: Escribir el test de caracterización primero (debe fallar).** Crea `lib/media/image.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { inferExtension, nanoVariantToResolution } from './image';

  describe('inferExtension', () => {
    it('mapea mimes conocidos a su extensión', () => {
      expect(inferExtension('image/png')).toBe('png');
      expect(inferExtension('image/webp')).toBe('webp');
      expect(inferExtension('video/mp4')).toBe('mp4');
      expect(inferExtension('video/webm')).toBe('webm');
      expect(inferExtension('audio/mpeg')).toBe('mp3');
      expect(inferExtension('audio/mp3')).toBe('mp3');
      expect(inferExtension('audio/wav')).toBe('wav');
      expect(inferExtension('image/jpeg')).toBe('jpg');
      expect(inferExtension('image/jpg')).toBe('jpg');
    });
    it('cae a bin para mimes desconocidos', () => {
      expect(inferExtension('application/octet-stream')).toBe('bin');
    });
  });

  describe('nanoVariantToResolution', () => {
    it('mapea variantes a resolución Nano', () => {
      expect(nanoVariantToResolution('1k')).toBe('1K');
      expect(nanoVariantToResolution('2k')).toBe('2K');
      expect(nanoVariantToResolution('4k')).toBe('4K');
    });
    it('cae a 2K para variante desconocida', () => {
      expect(nanoVariantToResolution('foo')).toBe('2K');
    });
  });
  ```
  Corre `pnpm test lib/media/image.test.ts`. Expected: FALLA con "Cannot find module './image'".
- [ ] **Step 2: Crear el módulo.** Escribe `lib/media/image.ts` (puro, sin `server-only`, sin sharp):
  ```ts
  // Helpers de media PUROS (sin IO) compartidos por el worker (finalize) y las
  // server actions de generación. La versión canónica de inferExtension cubre
  // los tres tipos (image/video/audio); las copias jpeg-only de las server
  // actions se reemplazan por ésta.
  export function inferExtension(mime: string): string {
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    return 'bin';
  }

  export function nanoVariantToResolution(variant: string): '512' | '1K' | '2K' | '4K' {
    switch (variant) {
      case '1k':
        return '1K';
      case '2k':
        return '2K';
      case '4k':
        return '4K';
      default:
        return '2K';
    }
  }
  ```
  Corre `pnpm test lib/media/image.test.ts`. Expected: PASA (todos verdes).
- [ ] **Step 3: Migrar finalize.ts.** Borra la función local `inferExtension` (líneas 9-18) y añade tras la línea 6 (tras el import de extractVideoFrame): `import { inferExtension } from '@/lib/media/image';`. Deja `makeImageThumbnail`/`makeThumbnail` intactas (esas se reusan vía finalizeGeneration, no se mueven). Expected: finalize.ts usa el inferExtension importado en la línea 53.
- [ ] **Step 4: Migrar generations.ts.** Borra la función local `nanoVariantToResolution` (59-70) y `inferExtension` (135-139). Nota: `megapixelsToVariant`/`paramsForEstimator` (55-83) se quedan. Añade a los imports: `import { inferExtension, nanoVariantToResolution } from '@/lib/media/image';`. Expected: las dos llamadas (línea 281 y 300) resuelven al import.
- [ ] **Step 5: Migrar storyboard.ts.** Borra `inferExtension` (66-70) y `nanoVariantToResolution` (72-83). `makeThumbnail` local (59-64) se deja por ahora (se borra en O1.7). Añade `import { inferExtension, nanoVariantToResolution } from '@/lib/media/image';`. Expected: usos en 385/394/690/699 resuelven al import.
- [ ] **Step 6: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: typecheck/build sin errores; suite verde (incluye el nuevo image.test.ts).
- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(media): inferExtension/nanoVariantToResolution en lib/media/image"`.

---

### Task O1.3: lib/providers/http.ts — mapHttpError, downloadWithTimeout, requireEnvKey

**Files:**
- Create: `lib/providers/http.ts`
- Create: `lib/providers/http.test.ts`
- Modify: `lib/providers/seedance.ts` (borra httpError 77-106, ensureArkKey 154-158, ensureAtlasKey 251-255, downloadVideo 372-397)
- Modify: `lib/providers/veo.ts` (borra getApiKey 44-48, downloadVideo 147-161)
- Modify: `lib/providers/kling.ts` (borra downloadVideo 108-119; reusar requireEnvKey en ensureConfigured 18-26)
- Modify: `lib/providers/flux.ts` (borra download 170-182; reusar requireEnvKey 185-187)

**Interfaces:**
- Produces: `export async function mapHttpError(res: Response, opts: { label: string; fallback: string }): Promise<never>`
- Produces: `export async function downloadWithTimeout(url: string, opts?: { timeoutMs?: number; headers?: Record<string, string>; fallbackMimeType?: string; label?: string }): Promise<{ buffer: Buffer; mimeType: string }>`
- Produces: `export function requireEnvKey(name: string): string`
- Consumes (ola de providers): veo/kling/seedance/flux dejan de reimplementar download/getApiKey/httpError.

**Steps:**
- [ ] **Step 1: Escribir el test de caracterización (debe fallar).** Crea `lib/providers/http.test.ts` capturando el comportamiento ACTUAL de seedance.httpError y de requireEnvKey:
  ```ts
  import { describe, it, expect, vi, afterEach } from 'vitest';
  import { mapHttpError, requireEnvKey } from './http';

  function res(status: number, body: unknown): Response {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: false, status, text: async () => text } as unknown as Response;
  }

  describe('mapHttpError', () => {
    it('401/403 → ProviderError auth, no retryable', async () => {
      await expect(mapHttpError(res(401, { error: { message: 'bad key' } }), { label: 'X', fallback: 'f' }))
        .rejects.toMatchObject({ code: 'auth', retryable: false });
    });
    it('429 → rate_limit retryable', async () => {
      await expect(mapHttpError(res(429, {}), { label: 'X', fallback: 'f' }))
        .rejects.toMatchObject({ code: 'rate_limit', retryable: true });
    });
    it('detecta políticas de seguridad por regex del cuerpo', async () => {
      await expect(mapHttpError(res(400, { message: 'content policy violation' }), { label: 'X', fallback: 'f' }))
        .rejects.toMatchObject({ code: 'safety' });
    });
    it('4xx genérico → invalid_input con status + detalle', async () => {
      await expect(mapHttpError(res(400, { detail: 'Unknown field: image_urls' }), { label: 'AtlasCloud', fallback: 'f' }))
        .rejects.toThrow(/AtlasCloud 400.*image_urls/);
    });
    it('5xx → server retryable', async () => {
      await expect(mapHttpError(res(500, 'boom'), { label: 'X', fallback: 'f' }))
        .rejects.toMatchObject({ code: 'server', retryable: true });
    });
    it('cuerpo no-JSON usa el crudo recortado', async () => {
      await expect(mapHttpError(res(404, '<!DOCTYPE html><title>Not Found</title>'), { label: 'AtlasCloud', fallback: 'f' }))
        .rejects.toThrow(/AtlasCloud 404.*Not Found/);
    });
  });

  describe('requireEnvKey', () => {
    afterEach(() => vi.unstubAllEnvs());
    it('devuelve el valor cuando existe', () => {
      vi.stubEnv('ARK_API_KEY', 'k');
      expect(requireEnvKey('ARK_API_KEY')).toBe('k');
    });
    it('lanza ProviderError auth "<NAME> no configurada" cuando falta', () => {
      vi.unstubAllEnvs();
      expect(() => requireEnvKey('ATLASCLOUD_API_KEY')).toThrowError(/ATLASCLOUD_API_KEY no configurada/);
    });
  });
  ```
  Corre `pnpm test lib/providers/http.test.ts`. Expected: FALLA ("Cannot find module './http'").
- [ ] **Step 2: Crear el módulo.** Escribe `lib/providers/http.ts` (promueve la versión privada de seedance, generalizada):
  ```ts
  import 'server-only';
  import { ProviderError } from './types';

  // Promovido del httpError privado de seedance.ts. Lee el cuerpo como TEXTO una
  // sola vez; si es JSON, extrae el mensaje de las formas conocidas; si no, usa
  // el crudo recortado. Así un 4xx con shape inesperado surface el motivo real.
  export async function mapHttpError(
    res: Response,
    opts: { label: string; fallback: string },
  ): Promise<never> {
    const { label, fallback } = opts;
    const raw = (await res.text().catch(() => '')).trim();
    let detail = fallback;
    if (raw) {
      try {
        const body = JSON.parse(raw) as {
          error?: { message?: string } | string;
          message?: string;
          data?: { error?: string };
        };
        detail =
          (typeof body.error === 'string' ? body.error : body.error?.message) ??
          body.data?.error ??
          body.message ??
          raw.slice(0, 300);
      } catch {
        detail = raw.slice(0, 300);
      }
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(detail, 'auth', false);
    if (res.status === 429) throw new ProviderError(`Rate limit ${label}`, 'rate_limit', true);
    if (/sensitive|moderation|safety|content.?policy|disallowed/i.test(detail)) {
      throw new ProviderError('El proveedor rechazó el contenido por políticas de seguridad', 'safety', false);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new ProviderError(`${label} ${res.status}: ${detail}`, 'invalid_input', false);
    }
    throw new ProviderError(`${label} error ${res.status}: ${detail}`, 'server', res.status >= 500);
  }

  // Descarga con AbortController (timeout) — el corte vivía solo en seedance.
  // Generaliza a todos los providers: propaga el timeout que hoy solo tiene
  // seedance. `label` arma el mensaje de error ("No se pudo descargar <label>").
  export async function downloadWithTimeout(
    url: string,
    opts?: { timeoutMs?: number; headers?: Record<string, string>; fallbackMimeType?: string; label?: string },
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const timeoutMs = opts?.timeoutMs ?? 45_000;
    const fallbackMimeType = opts?.fallbackMimeType ?? 'video/mp4';
    const label = opts?.label ?? 'el archivo del proveedor';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: opts?.headers });
      if (!res.ok) {
        throw new ProviderError(`No se pudo descargar ${label} (${res.status})`, 'server', false);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, mimeType: res.headers.get('content-type') ?? fallbackMimeType };
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const aborted = (err as Error)?.name === 'AbortError';
      throw new ProviderError(
        aborted ? `Descarga de ${label} excedió ${timeoutMs / 1000}s` : `Descarga de ${label} falló: ${(err as Error).message}`,
        'server',
        false,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Unifica getApiKey/ensureArkKey/ensureAtlasKey: lee process.env[name] o lanza
  // ProviderError auth con el mensaje uniforme "<NAME> no configurada".
  export function requireEnvKey(name: string): string {
    const value = process.env[name];
    if (!value) throw new ProviderError(`${name} no configurada`, 'auth', false);
    return value;
  }
  ```
  Corre `pnpm test lib/providers/http.test.ts`. Expected: PASA.
- [ ] **Step 3: Migrar seedance.ts.** Añade `import { mapHttpError, downloadWithTimeout, requireEnvKey } from './http';`. Borra la función `httpError` (77-106), `ensureArkKey` (154-158), `ensureAtlasKey` (251-255) y `downloadVideo` (372-397). Reemplaza usos: `ensureArkKey()` → `requireEnvKey('ARK_API_KEY')`; `ensureAtlasKey()` → `requireEnvKey('ATLASCLOUD_API_KEY')`; cada `await httpError(res, 'ModelArk', 'submit falló')` → `await mapHttpError(res, { label: 'ModelArk', fallback: 'submit falló' })` (idem 'AtlasCloud'/'poll falló'); y re-exporta `export async function downloadVideo(url: string) { return downloadWithTimeout(url, { label: 'el video del proveedor' }); }` para no tocar el handler. Expected: seedance.ts sin lógica HTTP propia, solo dispatch + payloads.
- [ ] **Step 4: Migrar veo.ts.** Añade `import { downloadWithTimeout, requireEnvKey } from './http';`. Borra `getApiKey` (44-48); reemplaza `getApiKey()` por `requireEnvKey('GEMINI_API_KEY')` (3 usos). Reemplaza `downloadVideo` (147-161) por `export async function downloadVideo(uri: string) { return downloadWithTimeout(uri, { headers: { 'x-goog-api-key': requireEnvKey('GEMINI_API_KEY') }, label: 'el video de Veo' }); }`. Expected: veo.test.ts (submit/poll) sigue verde.
- [ ] **Step 5: Migrar kling.ts.** Añade `import { downloadWithTimeout, requireEnvKey } from './http';`. En `ensureConfigured` (18-26) reemplaza el chequeo manual de `FAL_KEY` por `const credentials = requireEnvKey('FAL_KEY');`. Reemplaza `downloadVideo` (108-119) por `export async function downloadVideo(url: string) { return downloadWithTimeout(url, { label: 'el video de fal.ai' }); }`. Expected: kling.test.ts sigue verde.
- [ ] **Step 6: Migrar flux.ts.** Añade `import { downloadWithTimeout, requireEnvKey } from './http';`. En `generate` (185-187) reemplaza el chequeo de `BFL_API_KEY` por `const apiKey = requireEnvKey('BFL_API_KEY');`. Reemplaza `download` (170-182) por `return downloadWithTimeout(sampleUrl, { fallbackMimeType: 'image/jpeg', label: 'la imagen de FLUX' });` (la imagen de FLUX gana el timeout de 45s que antes no tenía — red de seguridad explícita). Expected: sin función `download` local.
- [ ] **Step 7: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: typecheck/build limpios; suite verde (seedance/veo/kling tests intactos; http.test nuevo).
- [ ] **Step 8: Commit.** `git add -A && git commit -m "refactor(providers): http compartido (mapHttpError, downloadWithTimeout, requireEnvKey)"`.

> NOTA de comportamiento (flag): los mensajes de timeout/descarga se normalizan ("Descarga de el video del proveedor excedió 45s" en vez de "Descarga del video excedió 45s") y la imagen de FLUX adquiere un timeout de 45s. Ningún test cubre esos textos; es el cambio deliberado de "propagar el timeout". Reportar al usuario.

---

### Task O1.4: lib/generation/previous-turn.ts — loader del turno conversacional previo

**Files:**
- Create: `lib/generation/previous-turn.ts`
- Modify: `server-actions/generations.ts` (reemplaza inline 234-273)
- Modify: `server-actions/storyboard.ts` (reemplaza load-half de loadPreviousPanelTurn 171-197 y el inline de refine 652-684)

**Interfaces:**
- Produces: `export type PreviousTurn = { prompt: string; imageBuffer: Buffer; mimeType: string; thoughtSignature?: string }`
- Produces: `export type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>`
- Produces: `export async function loadPreviousTurn(supabase: ServerSupabaseClient, opts: { parentGenerationId: string; workspaceId: string; expectedModelId: string }): Promise<PreviousTurn | null>`

**Steps:**
- [ ] **Step 1: Crear el módulo.** Escribe `lib/generation/previous-turn.ts` (IO: descarga el output del padre; no hay test unitario sin mocks pesados → se verifica con typecheck/build/test):
  ```ts
  import 'server-only';
  import { createClient } from '@/lib/supabase/server';
  import { downloadOutputBuffer } from '@/lib/supabase/storage';

  export type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

  export type PreviousTurn = {
    prompt: string;
    imageBuffer: Buffer;
    mimeType: string;
    thoughtSignature?: string;
  };

  // Carga el turno previo conversacional desde un generation padre: descarga su
  // output + reusa el thought_signature SOLO si el padre es del mismo model_id
  // (cambiar de Pro a Flash invalida la sig → 400). Best-effort: null si el padre
  // no existe, no es del workspace, no está 'done' o no tiene output.
  export async function loadPreviousTurn(
    supabase: ServerSupabaseClient,
    opts: { parentGenerationId: string; workspaceId: string; expectedModelId: string },
  ): Promise<PreviousTurn | null> {
    const { data: parent } = await supabase
      .from('generations')
      .select('output_url, workspace_id, status, prompt, provider_payload, model_id')
      .eq('id', opts.parentGenerationId)
      .single();
    const p = parent as
      | {
          output_url: string | null;
          workspace_id: string;
          status: string;
          prompt: string | null;
          provider_payload: { thought_signature?: string } | null;
          model_id: string;
        }
      | null;
    if (!p || p.workspace_id !== opts.workspaceId || !p.output_url || p.status !== 'done') return null;
    try {
      const { buffer, mimeType } = await downloadOutputBuffer(p.output_url);
      const modelMatches = p.model_id === opts.expectedModelId;
      return {
        prompt: p.prompt ?? '',
        imageBuffer: buffer,
        mimeType,
        thoughtSignature: modelMatches ? p.provider_payload?.thought_signature : undefined,
      };
    } catch {
      return null;
    }
  }
  ```
- [ ] **Step 2: Migrar generations.ts (submitGenerationAction).** Reemplaza el bloque 234-273 (declaración de `previousTurn` + el `if (...) { ... }` que carga el padre) por:
  ```ts
  const previousTurn =
    data.provider === 'nano-banana' && data.conversational && data.parentGenerationId
      ? await loadPreviousTurn(supabase, {
          parentGenerationId: data.parentGenerationId,
          workspaceId: workspace.id,
          expectedModelId: data.model,
        })
      : null;
  ```
  Añade `import { loadPreviousTurn } from '@/lib/generation/previous-turn';`. Expected: comportamiento idéntico (el guard model_id se mueve al helper).
- [ ] **Step 3: Migrar storyboard.ts (loadPreviousPanelTurn).** Mantén la mitad que BUSCA el `prevGenId` por la secuencia (159-169) y reemplaza la mitad que lo carga (171-197) por `return loadPreviousTurn(supabase, { parentGenerationId: prevGenId, workspaceId, expectedModelId: NANO_MODEL_SLUG });`. Añade el import. Expected: la firma de `loadPreviousPanelTurn` no cambia; solo delega.
- [ ] **Step 4: Migrar storyboard.ts (refinePanelAction).** Reemplaza el bloque 652-684 (declaración de `previousTurn` + carga por `parentGenId`) por:
  ```ts
  const previousTurn = item.storyboard_generation_id
    ? await loadPreviousTurn(supabase, {
        parentGenerationId: item.storyboard_generation_id,
        workspaceId: workspace.id,
        expectedModelId: NANO_MODEL_SLUG,
      })
    : null;
  ```
  Expected: comportamiento idéntico.
- [ ] **Step 5: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: limpios y verde.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "refactor(generation): loadPreviousTurn centraliza el turno conversacional previo"`.

---

### Task O1.5: finalizeGeneration devuelve paths + acepta revalidatePaths (foundation)

**Files:**
- Modify: `lib/jobs/finalize.ts` (firma de finalizeGeneration 45-82)
- Modify: `app/api/jobs/process/route.ts` (call ~211, sin cambio funcional)

**Interfaces:**
- Produces: `export type FinalizeGenerationRow = Pick<GenerationRow, 'id' | 'user_id' | 'workspace_id' | 'type' | 'credits_estimated'>`
- Produces: `export async function finalizeGeneration(params: { gen: FinalizeGenerationRow; outputBuffer: Buffer; mimeType: string; processingMs: number; metadata?: Record<string, unknown>; revalidatePaths?: string[] }): Promise<{ outputPath: string; thumbnailPath: string | null }>`

**Steps:**
- [ ] **Step 1: Refactor de la firma.** En `lib/jobs/finalize.ts` reemplaza el cuerpo de `finalizeGeneration` (45-82) por:
  ```ts
  export type FinalizeGenerationRow = Pick<
    GenerationRow,
    'id' | 'user_id' | 'workspace_id' | 'type' | 'credits_estimated'
  >;

  const DEFAULT_REVALIDATE_PATHS = ['/app/library', '/app/create/video', '/app/create/audio'];

  export async function finalizeGeneration(params: {
    gen: FinalizeGenerationRow;
    outputBuffer: Buffer;
    mimeType: string;
    processingMs: number;
    metadata?: Record<string, unknown>;
    revalidatePaths?: string[];
  }): Promise<{ outputPath: string; thumbnailPath: string | null }> {
    const { gen, outputBuffer, mimeType, processingMs, metadata } = params;
    const ext = inferExtension(mimeType);

    const outputPath = await uploadOutput(gen.workspace_id, gen.id, outputBuffer, mimeType, ext);

    const thumbBuffer = await makeThumbnail(gen.type, outputBuffer, mimeType);
    const thumbnailPath = thumbBuffer
      ? await uploadThumbnail(gen.workspace_id, gen.id, thumbBuffer)
      : null;

    await completeGeneration({
      userId: gen.user_id,
      generationId: gen.id,
      cost: gen.credits_estimated,
      outputUrl: outputPath,
      thumbnailUrl: thumbnailPath,
      processingMs,
      fileSizeBytes: outputBuffer.byteLength,
      providerPayload: metadata ?? null,
    });

    for (const path of params.revalidatePaths ?? DEFAULT_REVALIDATE_PATHS) {
      revalidatePath(path);
    }

    return { outputPath, thumbnailPath };
  }
  ```
  Expected: el worker (que no pasa `revalidatePaths`) conserva los 3 paths por defecto y la `gen: GenerationRow` completa satisface el `Pick`.
- [ ] **Step 2: Confirmar el worker.** Lee `app/api/jobs/process/route.ts` alrededor de 211: el llamado sigue compilando (ignora el valor de retorno). No requiere cambios. Expected: sin edición necesaria.
- [ ] **Step 3: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: limpios y verde (sin cambio de comportamiento del worker).
- [ ] **Step 4: Commit.** `git add -A && git commit -m "refactor(finalize): devuelve paths y acepta revalidatePaths"`.

---

### Task O1.6: credit-lifecycle.ts + run-sync-generation.ts (helpers, sin consumidores aún)

**Files:**
- Create: `lib/generation/credit-lifecycle.ts`
- Create: `lib/generation/run-sync-generation.ts`

**Interfaces:**
- Produces: `export async function reserveOrDeleteGeneration(opts: { userId: string; cost: number; generationId: string }): Promise<boolean>`
- Produces: `export async function safeFailGeneration(opts: { userId: string; generationId: string; refund: number; reason: string; logLabel: string }): Promise<void>`
- Produces: `export type SyncGenerationOutcome<T> = { ok: true; data: T } | { ok: false; error: 'insufficient_credits' | 'safety' | 'provider_error'; message?: string }`
- Produces: `export async function runSyncGeneration<T>(opts: { userId: string; workspaceId: string; generationId: string; type: 'image' | 'video' | 'audio'; cost: number; revalidatePaths: string[]; logLabel: string; generate: () => Promise<GenerationResult>; onComplete?: (ctx: { outputPath: string; thumbnailPath: string | null; generationId: string; result: GenerationResult }) => Promise<T> }): Promise<SyncGenerationOutcome<T>>`

**Steps:**
- [ ] **Step 1: Crear credit-lifecycle.ts.** Extrae los dos primitivos repetidos (reserve+delete-on-fail; failGeneration tragado con log):
  ```ts
  import 'server-only';
  import { createAdminClient } from '@/lib/supabase/admin';
  import { failGeneration, reserveCredits } from '@/lib/credits/operations';

  // Reserva créditos (RPC atómico). Si NO hay reserva, borra la fila huérfana de
  // generations (no hay nada que auditar) y devuelve false. Repetido hoy 6+ veces.
  export async function reserveOrDeleteGeneration(opts: {
    userId: string;
    cost: number;
    generationId: string;
  }): Promise<boolean> {
    const reserved = await reserveCredits(opts.userId, opts.cost, opts.generationId);
    if (!reserved) {
      const admin = createAdminClient();
      await admin.from('generations').delete().eq('id', opts.generationId);
    }
    return reserved;
  }

  // failGeneration (idempotente, refund condicional) envuelto: nunca propaga.
  // `refund` ya viene calculado por el caller (reserved ? cost : 0). Loggea con
  // logLabel y los mismos campos que hoy.
  export async function safeFailGeneration(opts: {
    userId: string;
    generationId: string;
    refund: number;
    reason: string;
    logLabel: string;
  }): Promise<void> {
    try {
      await failGeneration(opts.userId, opts.generationId, opts.refund, opts.reason);
    } catch (failErr) {
      console.error(opts.logLabel, {
        userId: opts.userId,
        generationId: opts.generationId,
        cost: opts.refund,
        originalError: opts.reason,
        failError: (failErr as Error)?.message,
      });
    }
  }
  ```
- [ ] **Step 2: Crear run-sync-generation.ts.** Encapsula el ciclo síncrono (insert ya hecho por el caller → reserve → try{generar→finalize→onComplete} catch{fail + map}):
  ```ts
  import 'server-only';
  import { finalizeGeneration } from '@/lib/jobs/finalize';
  import { ProviderError, type GenerationResult } from '@/lib/providers/types';
  import { reserveOrDeleteGeneration, safeFailGeneration } from './credit-lifecycle';

  export type SyncGenerationOutcome<T> =
    | { ok: true; data: T }
    | { ok: false; error: 'insufficient_credits' | 'safety' | 'provider_error'; message?: string };

  // Ciclo de vida síncrono compartido por las generaciones que se resuelven en la
  // misma request (imagen Nano/FLUX, paneles de storyboard). El caller ya insertó
  // la fila 'processing' con `generationId`. Aquí: reserveOrDelete →
  // try{ generate() → finalizeGeneration (sube+thumbnail+complete+revalidate) →
  // onComplete } catch{ safeFailGeneration (refund condicional) + map de error }.
  // Créditos siempre vía los RPC atómicos (reserve/complete/fail).
  export async function runSyncGeneration<T>(opts: {
    userId: string;
    workspaceId: string;
    generationId: string;
    type: 'image' | 'video' | 'audio';
    cost: number;
    revalidatePaths: string[];
    logLabel: string;
    generate: () => Promise<GenerationResult>;
    onComplete?: (ctx: {
      outputPath: string;
      thumbnailPath: string | null;
      generationId: string;
      result: GenerationResult;
    }) => Promise<T>;
  }): Promise<SyncGenerationOutcome<T>> {
    const reserved = await reserveOrDeleteGeneration({
      userId: opts.userId,
      cost: opts.cost,
      generationId: opts.generationId,
    });
    if (!reserved) return { ok: false, error: 'insufficient_credits' };

    const startedAt = Date.now();
    try {
      const result = await opts.generate();
      const metadata: Record<string, unknown> | undefined = result.thoughtSignature
        ? { thought_signature: result.thoughtSignature }
        : undefined;
      const { outputPath, thumbnailPath } = await finalizeGeneration({
        gen: {
          id: opts.generationId,
          user_id: opts.userId,
          workspace_id: opts.workspaceId,
          type: opts.type,
          credits_estimated: opts.cost,
        },
        outputBuffer: result.buffer,
        mimeType: result.mimeType,
        processingMs: Date.now() - startedAt,
        metadata,
        revalidatePaths: opts.revalidatePaths,
      });
      const data = opts.onComplete
        ? await opts.onComplete({ outputPath, thumbnailPath, generationId: opts.generationId, result })
        : (undefined as T);
      return { ok: true, data };
    } catch (err) {
      const errMsg = err instanceof ProviderError ? err.message : (err as Error)?.message ?? 'unknown';
      await safeFailGeneration({
        userId: opts.userId,
        generationId: opts.generationId,
        refund: reserved ? opts.cost : 0,
        reason: errMsg,
        logLabel: opts.logLabel,
      });
      if (err instanceof ProviderError && err.code === 'safety') {
        return { ok: false, error: 'safety', message: errMsg };
      }
      return { ok: false, error: 'provider_error', message: errMsg };
    }
  }
  ```
- [ ] **Step 3: Verificar (sin consumidores).** `pnpm typecheck && pnpm build`. Expected: compila (los módulos no se importan todavía).
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(generation): runSyncGeneration + credit-lifecycle helpers"`.

---

### Task O1.7: Migrar las acciones síncronas a runSyncGeneration (borra makeThumbnail)

**Files:**
- Modify: `server-actions/generations.ts` (submitGenerationAction, try 217-359; borra makeThumbnail 128-133)
- Modify: `server-actions/storyboard.ts` (generatePanelAction try 342-468 y refinePanelAction try 631-773; borra makeThumbnail 59-64)

**Interfaces:**
- Consumes: `runSyncGeneration`, `loadPreviousTurn` (ya en uso), `inferExtension`/`nanoVariantToResolution` (ya importados).

**Steps:**
- [ ] **Step 1: Migrar submitGenerationAction.** Tras el insert (213) y la carga de `references`/`previousTurn` (mueve esas cargas DENTRO del closure `generate` para conservar el refund-on-failure), reemplaza el bloque `let reserved = false; const startedAt = ...; try { reserveCredits ... } catch { ... }` (217-359) por:
  ```ts
  const outcome = await runSyncGeneration<{ generationId: string }>({
    userId: user.id,
    workspaceId: workspace.id,
    generationId,
    type: 'image',
    cost,
    revalidatePaths: ['/app/library', '/app/create/image'],
    logLabel: '[fail_generation]',
    generate: async () => {
      const references = await loadReferences(workspace.id, data.references);
      const previousTurn =
        data.provider === 'nano-banana' && data.conversational && data.parentGenerationId
          ? await loadPreviousTurn(supabase, {
              parentGenerationId: data.parentGenerationId,
              workspaceId: workspace.id,
              expectedModelId: data.model,
            })
          : null;
      if (data.provider === 'nano-banana') {
        return generateNanoBanana({
          model: data.model,
          prompt: data.prompt,
          aspectRatio: data.aspectRatio,
          resolution: nanoVariantToResolution(data.variant),
          references,
          previousTurn,
          useGrounding: data.useGrounding,
          conversational: data.conversational,
          hasTextInImage: data.hasTextInImage,
          noBackground: data.noBackground,
        });
      }
      const { width, height } = fluxDimensions(data.aspectRatio, data.megapixels);
      return generateFlux({ prompt: data.prompt, width, height, references, photoreal: data.photoreal });
    },
    onComplete: async () => ({ generationId }),
  });
  return outcome;
  ```
  Borra los imports ahora muertos (`uploadOutput`, `uploadThumbnail`, `completeGeneration`, `failGeneration`, `reserveCredits`, `createAdminClient`, `sharp`, `ProviderError` si ya no se usan) y la función `makeThumbnail` (128-133). Añade `import { runSyncGeneration } from '@/lib/generation/run-sync-generation';`. Expected: la acción ya no contiene `try/catch` de créditos ni upload/thumbnail manual.
- [ ] **Step 2: Verificar generations.ts.** `pnpm build`. Expected: éxito (confirma que el barrel `'use server'` sigue exportando solo funciones async; `runSyncGeneration` se importó, no se re-exportó).
- [ ] **Step 3: Migrar generatePanelAction.** Reemplaza el bloque de créditos (342-468) por una llamada a `runSyncGeneration<{ imageId: string | null; generationId: string }>` con `type: 'image'`, `revalidatePaths: ['/app/campaigns/' + item.campaign_id + '/storyboard', '/app/library']`, `logLabel: '[storyboard:fail_generation:generate]'`. El `generate` closure mueve adentro la carga de `references` + `productChatRefs` + `generateNanoBanana({... previousTurn: prevTurn ...})` (prevTurn ya se calculó arriba para el costo). El `onComplete` hace la promoción best-effort (promoteOutputToReference + update campaign_items) usando `ctx.outputPath` y retorna `{ imageId, generationId }`. Borra el upload/thumbnail/complete manual.
- [ ] **Step 4: Migrar refinePanelAction.** Igual patrón (631-773): `runSyncGeneration<{ imageId: string | null; generationId: string }>`, `logLabel: '[storyboard:fail_generation:refine]'`, mismas revalidatePaths. El `generate` closure carga `references` + `previousTurn` (vía loadPreviousTurn ya migrado) + `generateNanoBanana`. `onComplete` = promoción + update + `{ imageId, generationId }`. Borra `makeThumbnail` local (59-64) y los imports muertos (`uploadOutput`, `uploadThumbnail`, `completeGeneration`, `failGeneration`, `reserveCredits`, `createAdminClient`, `sharp`).
- [ ] **Step 5: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: limpios y verde.
- [ ] **Step 6: Smoke manual.** Abrir `/app/create/image`: generar una imagen Nano (y una FLUX con foto-realismo) → aparece en biblioteca con thumbnail. Abrir un storyboard de campaña: "Generar panel" y luego "Refinar" en un beat → el panel se genera/edita y queda asignado al item. Verificar que un fallo de proveedor refunda créditos (revisar saldo). Reportar OK/NOK.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(generation): submit/storyboard usan runSyncGeneration"`.

> NOTA de comportamiento (flag): el thumbnail de un output PNG ahora se guarda como PNG (finalize.makeThumbnail preserva png) en vez de JPEG forzado. Es la consolidación intencional hacia la versión canónica de finalize.ts. Solo afecta el formato del thumbnail de grilla; reportar al usuario.

---

### Task O1.8: Adoptar credit-lifecycle en las acciones por cola (enqueue)

**Files:**
- Modify: `server-actions/generations.ts` (submitAudioGenerationAction 427-462, submitSeedanceGeneration 576-606, submitVideoGenerationAction 695-727)
- Modify: `server-actions/campaigns.ts` (final ~1474/1490, variant ~1958/1971)

**Interfaces:**
- Consumes: `reserveOrDeleteGeneration`, `safeFailGeneration`.

**Steps:**
- [ ] **Step 1: Migrar submitAudioGenerationAction.** Reemplaza el `let reserved = false; try { reserved = await reserveCredits(...); if (!reserved) { admin delete; return insufficient_credits } await enqueueJob(...) ... } catch { ... failGeneration ... }` (427-462) por:
  ```ts
  const reserved = await reserveOrDeleteGeneration({ userId: user.id, cost, generationId });
  if (!reserved) return { ok: false, error: 'insufficient_credits' };
  try {
    await enqueueJob({ generationId, action: 'submit' });
    revalidatePath('/app/library');
    return { ok: true, data: { generationId } };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    await safeFailGeneration({ userId: user.id, generationId, refund: cost, reason: message, logLabel: '[fail_generation:audio]' });
    return { ok: false, error: message.includes('429') ? 'provider_error' : 'internal_error', message };
  }
  ```
  (refund=cost porque si llegamos al try la reserva existe). Añade `import { reserveOrDeleteGeneration, safeFailGeneration } from '@/lib/generation/credit-lifecycle';`.
- [ ] **Step 2: Migrar submitSeedanceGeneration (576-606) y submitVideoGenerationAction (695-727).** Mismo reemplazo, con `reason: 'queue_failed: ' + message` y `logLabel` `'[fail_generation:seedance]'` / `'[fail_generation:video]'`.
- [ ] **Step 3: Migrar campaigns.ts (final ~1474-1490 y variant ~1958-1971).** Lee el bloque exacto; reemplaza el `reserved = await reserveCredits(...)` + el `failGeneration(user.id, generationId, reserved ? cost : 0, ...)` por `reserveOrDeleteGeneration` (si su semántica de fallo es delete) o, si ahí NO borra la fila, deja `reserveCredits` y solo cambia el `failGeneration` por `safeFailGeneration`. Verifica primero leyendo 1460-1500 y 1945-1980 si hace delete-on-fail; preserva la semántica exacta (no introducir un delete donde no lo había).
- [ ] **Step 4: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: limpios y verde.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "refactor(actions): enqueue usa reserveOrDelete + safeFailGeneration"`.

---

### Task O1.9: lib/generation/models.ts — fuente única de slugs/labels de modelo

**Files:**
- Create: `lib/generation/models.ts`
- Create: `lib/generation/models.test.ts`
- Modify: `lib/generation/video-meta.ts` (rompe el import desde el componente client; 1-37)
- Modify: `components/generation/VideoControlsPanel.tsx` (ModelKey 30-39, import MODEL_LABEL 28)
- Modify: `lib/schemas/video.ts` (KLING_MODELS 6-10, KLING_T2V_MODELS 12-15, VEO_MODELS 17-21 → re-export)
- Modify: `lib/schemas/campaigns.ts` (SEEDANCE_MODELS 11-18 → re-export)
- Modify: `lib/providers/kling.ts` / `veo.ts` / `seedance.ts` (derivan KlingModel/VeoModel/SeedanceModel de los arrays)

**Interfaces:**
- Produces: `export const VIDEO_MODEL_KEYS: readonly [...]` y `export type VideoModelKey = (typeof VIDEO_MODEL_KEYS)[number]`
- Produces: `export const VIDEO_MODEL_LABEL: Record<VideoModelKey, string>`
- Produces: `export const KLING_MODELS`, `KLING_T2V_MODELS`, `VEO_MODELS`, `SEEDANCE_MODELS` (arrays `as const`)
- Produces: `export type KlingModelSlug`, `VeoModelSlug`, `SeedanceModelSlug` derivados de los arrays.

**Steps:**
- [ ] **Step 1: Test de caracterización (debe fallar).** Crea `lib/generation/models.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { VIDEO_MODEL_KEYS, VIDEO_MODEL_LABEL, SEEDANCE_MODELS, VEO_MODELS, KLING_MODELS } from './models';

  describe('models domain', () => {
    it('cada UI key tiene label y son los 7 esperados', () => {
      expect(VIDEO_MODEL_KEYS.length).toBe(7);
      for (const k of VIDEO_MODEL_KEYS) expect(typeof VIDEO_MODEL_LABEL[k]).toBe('string');
      expect(VIDEO_MODEL_LABEL['seedance-2.0-fast']).toBe('Seedance 2.0 Fast');
      expect(VIDEO_MODEL_LABEL['veo-3.1-generate-preview']).toBe('Veo 3.1 Standard');
    });
    it('arrays de slugs conservan el catálogo', () => {
      expect(SEEDANCE_MODELS).toContain('bytedance/seedance-2.0/fast/reference-to-video');
      expect(VEO_MODELS).toContain('veo-3.1-lite-generate-preview');
      expect(KLING_MODELS).toContain('fal-ai/kling-video/v3/standard/image-to-video');
    });
  });
  ```
  Corre `pnpm test lib/generation/models.test.ts`. Expected: FALLA (módulo inexistente).
- [ ] **Step 2: Crear models.ts** (neutral: sin `server-only`, sin `'use client'`):
  ```ts
  // Fuente única de slugs/labels/UI-keys de modelo. Neutral: lo importan tanto
  // módulos server (providers, schemas) como client (VideoControlsPanel). De aquí
  // derivan los enums de schemas y los tipos de los providers.
  export const KLING_MODELS = [
    'fal-ai/kling-video/v3/standard/text-to-video',
    'fal-ai/kling-video/v3/pro/text-to-video',
    'fal-ai/kling-video/v3/standard/image-to-video',
  ] as const;
  export const KLING_T2V_MODELS = [
    'fal-ai/kling-video/v3/standard/text-to-video',
    'fal-ai/kling-video/v3/pro/text-to-video',
  ] as const;
  export const VEO_MODELS = [
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview',
    'veo-3.1-lite-generate-preview',
  ] as const;
  export const SEEDANCE_MODELS = [
    'bytedance/seedance-2.0/text-to-video',
    'bytedance/seedance-2.0/image-to-video',
    'bytedance/seedance-2.0/reference-to-video',
    'bytedance/seedance-2.0/fast/text-to-video',
    'bytedance/seedance-2.0/fast/image-to-video',
    'bytedance/seedance-2.0/fast/reference-to-video',
  ] as const;

  export type KlingModelSlug = (typeof KLING_MODELS)[number];
  export type VeoModelSlug = (typeof VEO_MODELS)[number];
  export type SeedanceModelSlug = (typeof SEEDANCE_MODELS)[number];

  // UI keys de video (las del picker; el slug real de fal/seedance se arma al
  // enviar según la operación). 'seedance-2.0'/'seedance-2.0-fast' son UI-only.
  export const VIDEO_MODEL_KEYS = [
    'fal-ai/kling-video/v3/standard/text-to-video',
    'fal-ai/kling-video/v3/pro/text-to-video',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-generate-preview',
    'veo-3.1-lite-generate-preview',
    'seedance-2.0',
    'seedance-2.0-fast',
  ] as const;
  export type VideoModelKey = (typeof VIDEO_MODEL_KEYS)[number];

  export const VIDEO_MODEL_LABEL: Record<VideoModelKey, string> = {
    'fal-ai/kling-video/v3/standard/text-to-video': 'Kling 3.0 Standard',
    'fal-ai/kling-video/v3/pro/text-to-video': 'Kling 3.0 Pro',
    'veo-3.1-fast-generate-preview': 'Veo 3.1 Fast',
    'veo-3.1-generate-preview': 'Veo 3.1 Standard',
    'veo-3.1-lite-generate-preview': 'Veo 3.1 Lite',
    'seedance-2.0': 'Seedance 2.0',
    'seedance-2.0-fast': 'Seedance 2.0 Fast',
  };
  ```
  Corre `pnpm test lib/generation/models.test.ts`. Expected: PASA.
- [ ] **Step 3: Romper el acoplamiento en video-meta.ts.** Reemplaza el `import type { ModelKey } from '@/components/generation/VideoControlsPanel';` (línea 5) por `import { VIDEO_MODEL_LABEL, type VideoModelKey } from '@/lib/generation/models';`, borra el objeto `MODEL_LABEL` local (7-15) y exporta `export const MODEL_LABEL = VIDEO_MODEL_LABEL;` (back-compat para AudioControlsPanel/LibraryView/etc.). Cambia el tipo del parámetro `model: ModelKey` de `estimateVideoEta` a `VideoModelKey`. Expected: `lib/generation` ya no importa de un componente `'use client'`.
- [ ] **Step 4: Ajustar VideoControlsPanel.tsx.** Cambia el import de la línea 28 a `import { estimateVideoEta } from '@/lib/generation/video-meta';` + `import { VIDEO_MODEL_LABEL as MODEL_LABEL, type VideoModelKey } from '@/lib/generation/models';`. Reemplaza el bloque `export type ModelKey = ...` (30-39) por `export type ModelKey = VideoModelKey;` (los 8 importadores existentes de `ModelKey` siguen funcionando). Expected: la unión literal vive ahora en models.ts.
- [ ] **Step 5: Re-export en schemas.** En `lib/schemas/video.ts` reemplaza las definiciones de `KLING_MODELS`/`KLING_T2V_MODELS`/`VEO_MODELS` (6-21) por `export { KLING_MODELS, KLING_T2V_MODELS, VEO_MODELS } from '@/lib/generation/models';`. En `lib/schemas/campaigns.ts` reemplaza `SEEDANCE_MODELS` (11-18) por `export { SEEDANCE_MODELS } from '@/lib/generation/models';`. Expected: los `z.enum(...)` y los importadores (VideoGenerator) siguen resolviendo.
- [ ] **Step 6: Derivar tipos en providers.** En `lib/providers/kling.ts` reemplaza la unión literal `KlingModel` (12-15) por `import type { KlingModelSlug } from '@/lib/generation/models'; export type KlingModel = KlingModelSlug;`. Igual para `veo.ts` (`VeoModel` 7-10) y `seedance.ts` (`SeedanceModel` 14-20). Los handlers que importan esos tipos no cambian. Expected: cero uniones de slugs duplicadas.
- [ ] **Step 7: Verificar.** `pnpm typecheck && pnpm build && pnpm test`. Expected: typecheck/build limpios; suite verde (models.test nuevo; veo/kling/seedance/schemas tests intactos).
- [ ] **Step 8: Smoke manual.** Abrir `/app/create/video`: el selector lista los 7 modelos con sus labels correctos y el ETA se calcula. Reportar OK/NOK.
- [ ] **Step 9: Commit.** `git add -A && git commit -m "refactor(models): fuente única de slugs/labels en lib/generation/models"`.

---

### Verificación final de la ola

- [ ] **Step 1:** `pnpm typecheck && pnpm build && pnpm test` una última vez sobre la rama de la ola. Expected: los tres verdes (build es el árbitro del gotcha `'use server'`).
- [ ] **Step 2:** Confirmar que NO quedan copias: `grep -rn "function makeThumbnail\|function inferExtension\|function nanoVariantToResolution\|async function httpError\|function getApiKey\|function ensureArkKey\|function ensureAtlasKey" server-actions lib/providers | grep -v node_modules`. Expected: sin coincidencias (todas centralizadas).


---

## Ola 2 — Vistas cliente (ROI alto, riesgo bajo)

*Empezar aquí para impacto inmediato: puro presentacional, no toca el path de créditos. Las 4 unidades son independientes entre sí y pueden paralelizarse.*

### Unidad S1: CampaignStudioView (2242 lineas) -> components/campaigns/studio/

**Objetivo.** Partir el monolito `components/campaigns/CampaignStudioView.tsx` (2242 lineas, 9 componentes en un solo archivo) en un directorio `components/campaigns/studio/` con un componente publico por archivo y ningun archivo >400 lineas, sin cambiar comportamiento. La extraccion es puramente mecanica (mover funciones/JSX a archivos nuevos e importarlos de vuelta); el unico codigo nuevo es: (a) dos funciones PURAS a `lib/campaigns/studio-view.ts` con tests de caracterizacion vitest, y (b) un hook Realtime que envuelve el `useEffect` actual con el patron `setAuth` del repo. Se preservan los re-exports de tipos (`StudioItem`, `StudioTemplate`, `StudioLocationOption`) durante toda la transicion para que `app/app/campaigns/[id]/page.tsx` y `components/campaigns/CampaignCalendar.tsx` sigan compilando, y se repunten al final. El orquestador mantiene `useState` para `items` (NO se migra a `useReducer`: eso cambiaria el cableado de callbacks y el mandato es comportamiento identico; queda como follow-up opcional anotado).

**Nota sobre `'use server'`.** Esta unidad NO modifica ningun archivo `'use server'`: solo IMPORTA acciones y el `type RegenMode` desde `server-actions/campaigns.ts` (importar de un `'use server'` es legal; lo prohibido es exportar no-funciones desde el). Aun asi cada task que toca componentes corre `pnpm build`, porque (1) es un Client Component consumido por una ruta y `next build` valida los boundaries cliente/servidor que `typecheck`/`lint` no ven, y (2) es la red de seguridad real de un split grande.

#### File Structure

Archivos NUEVOS:
- `lib/campaigns/studio-view.ts` — PURO (sin `'use client'`/`'server-only'`): `groupItemsByFormat` (reemplaza el memo `byFormat`) y `buildReprocessNotes` (reemplaza el armado inline de `notes`).
- `lib/campaigns/studio-view.test.ts` — tests de caracterizacion vitest de las dos funciones puras.
- `components/campaigns/studio/types.ts` — re-export de `StudioItem` desde `@/lib/campaigns/studio-item`; definiciones `StudioTemplate`/`StudioCharacterOption`/`StudioLocationOption`/`StudioCampaign`; constantes `STATUS_LABEL`, `GOAL_LABEL`, `FINAL_MODEL`, `STUDIO_TABS`.
- `components/campaigns/studio/StatusBadge.tsx` — badge presentacional de estado (lee `STATUS_LABEL`).
- `components/campaigns/studio/use-campaign-items-realtime.ts` — hook `'use client'` con la suscripcion `postgres_changes` a `campaign_items` (patron `setAuth`).
- `components/campaigns/studio/PlanRow.tsx` — fila `<tr>` compartida del plan (elimina la duplicacion fila-suelta vs fila-de-secuencia).
- `components/campaigns/studio/PlanTable.tsx` — tabla del plan (singles + tarjetas de secuencia + handlers generar/eliminar/unir/asignar-locacion).
- `components/campaigns/studio/ProductionGroupCard.tsx` — tarjeta por formato de Produccion (cola/borradores/finales).
- `components/campaigns/studio/ProductionView.tsx` — vista Produccion (handlers + estado + map de `ProductionGroupCard`).
- `components/campaigns/studio/TemplatesView.tsx` — vista Plantillas (series).
- `components/campaigns/studio/dialogs/CampaignSettingsDialog.tsx`
- `components/campaigns/studio/dialogs/EditItemDialog.tsx`
- `components/campaigns/studio/dialogs/DistillDialog.tsx`
- `components/campaigns/studio/dialogs/VariantDialog.tsx`
- `components/campaigns/studio/dialogs/PromptPreviewDialog.tsx`
- `components/campaigns/studio/CampaignStudioView.tsx` — orquestador (header/tabs/routing + dialogo reprocess), movido aqui en el task final.
- `components/campaigns/studio/index.ts` — barrel: re-exporta `CampaignStudioView` y los tipos publicos.

Archivos MODIFICADOS:
- `components/campaigns/CampaignStudioView.tsx` — se vacia incrementalmente (cada task le quita un bloque y lo importa) hasta quedar solo el orquestador; en el task final se ELIMINA.
- `app/app/campaigns/[id]/page.tsx` — repunta import a `@/components/campaigns/studio` (task final).
- `components/campaigns/CampaignCalendar.tsx` — repunta `import type { StudioItem }` a `./studio/types` (task final).

---

### Task S1.1: Extraer funciones puras a `lib/campaigns/studio-view.ts` (TDD)

**Files:**
- Create: `lib/campaigns/studio-view.ts`
- Create (Test): `lib/campaigns/studio-view.test.ts`
- Modify: `components/campaigns/CampaignStudioView.tsx` (reemplaza memo `byFormat` lineas 299-308; reemplaza armado de `notes` lineas 199-209)

**Interfaces:**
- Produces:
  - `export type FormatGroup = { formatId: string; formatName: string; items: StudioItem[] };`
  - `export function groupItemsByFormat(items: StudioItem[]): FormatGroup[];`
  - `export type ReprocessPlanData = { inventedNames?: string[] | null; blockers?: string[] | null };`
  - `export function buildReprocessNotes(data: ReprocessPlanData): string[];`
- Consumes: `import type { StudioItem } from '@/lib/campaigns/studio-item';`

**Steps:**

- [ ] **Step 1: Escribir el test de caracterizacion primero.** Crea `lib/campaigns/studio-view.test.ts` con el patron del repo (`lib/campaigns/plan-grouping.test.ts`):

  ```ts
  import { describe, it, expect } from 'vitest';
  import { groupItemsByFormat, buildReprocessNotes } from './studio-view';
  import type { StudioItem } from '@/lib/campaigns/studio-item';

  const item = (over: Partial<StudioItem>): StudioItem =>
    ({
      id: 'x', formatId: null, formatName: 'Formato', formatDescription: '', templateId: null,
      durationS: null, aspectRatio: null, scene: null, scenePrompt: '', sceneSummary: null,
      caption: null, characterNames: [], scheduledDate: null, status: 'planned', warnings: [],
      generationId: null, isWinner: false, sequenceId: null, sceneIndex: null,
      sequenceLabel: null, locationId: null, characterStateHint: null, ...over,
    });

  describe('groupItemsByFormat', () => {
    it('agrupa por formatId preservando orden de primera aparicion', () => {
      const groups = groupItemsByFormat([
        item({ id: 'a', formatId: 'f1', formatName: 'Reel' }),
        item({ id: 'b', formatId: 'f2', formatName: 'Story' }),
        item({ id: 'c', formatId: 'f1', formatName: 'Reel' }),
      ]);
      expect(groups.map((g) => g.formatId)).toEqual(['f1', 'f2']);
      expect(groups[0].items.map((i) => i.id)).toEqual(['a', 'c']);
    });
    it('mapea formatId null a formatId vacio (clave sin-formato)', () => {
      const groups = groupItemsByFormat([item({ id: 'a', formatId: null })]);
      expect(groups).toHaveLength(1);
      expect(groups[0].formatId).toBe('');
    });
  });

  describe('buildReprocessNotes', () => {
    it('vacio cuando no hay inventados ni blockers', () => {
      expect(buildReprocessNotes({})).toEqual([]);
      expect(buildReprocessNotes({ inventedNames: [], blockers: [] })).toEqual([]);
    });
    it('arma aviso de personajes inventados', () => {
      const notes = buildReprocessNotes({ inventedNames: ['Lia', 'Max'] });
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain('Lia, Max');
      expect(notes[0]).toContain('se inventó su apariencia');
    });
    it('arma aviso de ideas no convertibles y respeta el orden', () => {
      const notes = buildReprocessNotes({ inventedNames: ['Lia'], blockers: ['idea 1', 'idea 2'] });
      expect(notes).toHaveLength(2);
      expect(notes[1]).toContain('idea 1 · idea 2');
    });
  });
  ```

- [ ] **Step 2: Correr el test y verlo FALLAR.** `pnpm test lib/campaigns/studio-view.test.ts`
  Expected: vitest falla con `Failed to resolve import "./studio-view"` (el modulo aun no existe).

- [ ] **Step 3: Crear el modulo puro.** Crea `lib/campaigns/studio-view.ts` copiando la logica EXACTA del componente (memo `byFormat` lineas 299-308 y armado de `notes` lineas 200-209):

  ```ts
  // Helpers PUROS de la vista de campaña (CampaignStudioView). Sin DB ni
  // 'use client': agrupacion por formato para Produccion y armado de avisos del
  // reproceso. Una sola fuente de verdad, testeable bajo vitest.
  import type { StudioItem } from '@/lib/campaigns/studio-item';

  export type FormatGroup = { formatId: string; formatName: string; items: StudioItem[] };

  // Agrupa los items por formato preservando el orden de primera aparicion.
  export function groupItemsByFormat(items: StudioItem[]): FormatGroup[] {
    const map = new Map<string, FormatGroup>();
    for (const item of items) {
      const key = item.formatId ?? 'sin-formato';
      const entry = map.get(key) ?? { formatId: item.formatId ?? '', formatName: item.formatName, items: [] };
      entry.items.push(item);
      map.set(key, entry);
    }
    return [...map.values()];
  }

  export type ReprocessPlanData = { inventedNames?: string[] | null; blockers?: string[] | null };

  // Avisos NO silenciosos tras un reproceso exitoso (source === 'ideas'):
  // personajes inventados e ideas no convertibles.
  export function buildReprocessNotes(data: ReprocessPlanData): string[] {
    const notes: string[] = [];
    if (data.inventedNames?.length) {
      notes.push(
        `${data.inventedNames.join(', ')}: no está(n) en la campaña, se inventó su apariencia (sin imagen de referencia).`,
      );
    }
    if (data.blockers?.length) {
      notes.push(
        `No pude convertir algunas ideas en tomas: ${data.blockers.join(' · ')}. Reescríbelas con una acción concreta.`,
      );
    }
    return notes;
  }
  ```

- [ ] **Step 4: Correr el test y verlo PASAR.** `pnpm test lib/campaigns/studio-view.test.ts`
  Expected: 2 describes, 5 tests pasan (`5 passed`).

- [ ] **Step 5: Cablear el orquestador a los helpers.** En `components/campaigns/CampaignStudioView.tsx`:
  - Agrega `import { groupItemsByFormat, buildReprocessNotes } from '@/lib/campaigns/studio-view';`.
  - Reemplaza el cuerpo del memo (lineas 299-308) por `const byFormat = useMemo(() => groupItemsByFormat(items), [items]);`.
  - En `handleReprocess`, reemplaza el bloque que arma `notes` (declaracion `const notes: string[] = []` y los dos `if`, lineas 199-209) por `const notes = buildReprocessNotes(res.data);` (mantiene intactos el `if (notes.length === 0) { window.location.reload(); return; }` y el `setReprocessDone(...)` siguientes).

- [ ] **Step 6: Verificar suite + tipos + build.** `pnpm typecheck && pnpm test && pnpm build`
  Expected: typecheck sin errores; suite completa verde (incluye `studio-view.test.ts`); build OK (`Compiled successfully`).

- [ ] **Step 7: Commit.** `git add lib/campaigns/studio-view.ts lib/campaigns/studio-view.test.ts components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer groupItemsByFormat y buildReprocessNotes a lib (con tests)"`
  Expected: commit creado (sin trailer Co-Authored-By).

---

### Task S1.2: Extraer tipos + constantes (`types.ts`) y `StatusBadge.tsx`

**Files:**
- Create: `components/campaigns/studio/types.ts`
- Create: `components/campaigns/studio/StatusBadge.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita defs lineas 74-94, 96-98, 100-119, 122, 578-583; ajusta el re-export 70-72)

**Interfaces:**
- Produces (`types.ts`):
  - `export type { StudioItem } from '@/lib/campaigns/studio-item';`
  - `export type StudioTemplate = { id: string; name: string; formatName: string; usesCount: number };`
  - `export type StudioCharacterOption = { id: string; name: string; states: string[] };`
  - `export type StudioLocationOption = { id: string; name: string };`
  - `export type StudioCampaign = { id: string; name: string; status: string; goal: string | null; productName: string; category: string; creditsEstimated: number | null; ideaText: string | null };`
  - `export const STATUS_LABEL: Record<string, { label: string; tone: string; live?: boolean }>;`
  - `export const GOAL_LABEL: Record<string, string>;`
  - `export const FINAL_MODEL = 'bytedance/seedance-2.0/reference-to-video';`
  - `export const STUDIO_TABS: readonly ['plan', 'produccion', 'plantillas', 'calendario'];`
- Produces (`StatusBadge.tsx`): `export function StatusBadge({ status }: { status: string }): JSX.Element;`
- Consumes: `StatusBadge` consume `STATUS_LABEL` desde `./types`; `Loader2` de `lucide-react`.

**Steps:**

- [ ] **Step 1: Crear `types.ts`.** Mueve textualmente desde `CampaignStudioView.tsx`: `StudioTemplate` (74-79), `StudioCharacterOption`/`StudioLocationOption` (81-82), `StudioCampaign` (84-94), `FINAL_MODEL` (98), `STATUS_LABEL` (100-109), `GOAL_LABEL` (578-583), `STUDIO_TABS` (122). Encabeza con `export type { StudioItem } from '@/lib/campaigns/studio-item';`. Sin `'use client'` (modulo de tipos/datos).

- [ ] **Step 2: Crear `StatusBadge.tsx`.** Mueve la funcion `StatusBadge` (111-119); agrega `import { Loader2 } from 'lucide-react';` y `import { STATUS_LABEL } from './types';`. Sin `'use client'` (presentacional puro; valido en arbol cliente).

- [ ] **Step 3: Reapuntar el orquestador.** En `CampaignStudioView.tsx`:
  - Borra las defs movidas (74-122 salvo el bloque de imports, `FINAL_MODEL` 96-98, `STATUS_LABEL`+`StatusBadge` 100-119, `STUDIO_TABS` 122, `GOAL_LABEL` 578-583).
  - Reemplaza el re-export (70-72) por: `export type { StudioItem, StudioTemplate, StudioCharacterOption, StudioLocationOption, StudioCampaign } from './studio/types';`.
  - Agrega imports: `import { StatusBadge } from './studio/StatusBadge';` y `import { STATUS_LABEL, GOAL_LABEL, FINAL_MODEL, STUDIO_TABS, type StudioTemplate, type StudioCharacterOption, type StudioLocationOption, type StudioCampaign, type StudioItem } from './studio/types';` (los que el archivo siga usando: `GOAL_LABEL` en `CampaignSettingsDialog`, `FINAL_MODEL` en `ProductionView`, `STUDIO_TABS` en el orquestador, `StatusBadge` en las filas; `STATUS_LABEL` ya solo lo usa `StatusBadge`, no lo importes si no queda referencia).

- [ ] **Step 4: Verificar tipos + build + suite.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck sin errores; build OK; suite verde. (Recordatorio: typecheck/lint NO ven el gotcha de `'use server'`; aqui no aplica porque no tocamos `'use server'`, pero el build es el net real del split.)

- [ ] **Step 5: Commit.** `git add components/campaigns/studio/types.ts components/campaigns/studio/StatusBadge.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): mover tipos, constantes y StatusBadge a components/campaigns/studio"`
  Expected: commit creado.

---

### Task S1.3: Extraer el hook Realtime `use-campaign-items-realtime.ts`

**Files:**
- Create: `components/campaigns/studio/use-campaign-items-realtime.ts`
- Modify: `components/campaigns/CampaignStudioView.tsx` (reemplaza `useEffect` lineas 260-297)

**Interfaces:**
- Produces:
  - `export type CampaignItemRealtimeRow = { id: string; status: string; warnings?: string[]; generation_id?: string | null };`
  - `export function useCampaignItemsRealtime(campaignId: string, onUpdate: (row: CampaignItemRealtimeRow) => void): void;`
- Consumes: `createClient` de `@/lib/supabase/client` (patron `setAuth` de `components/generation/use-generation-status.ts`).

**Steps:**

- [ ] **Step 1: Crear el hook.** Crea `components/campaigns/studio/use-campaign-items-realtime.ts`. Envuelve el `useEffect` actual (260-297); usa un `useRef` para el callback mas reciente y conserva las deps `[campaignId]` (igual que el original `[campaign.id]`, una sola suscripcion por campaña):

  ```ts
  'use client';
  import { useEffect, useRef } from 'react';
  import { createClient } from '@/lib/supabase/client';

  export type CampaignItemRealtimeRow = {
    id: string;
    status: string;
    warnings?: string[];
    generation_id?: string | null;
  };

  // Suscribe a postgres_changes (UPDATE) de campaign_items de una campaña con el
  // patron setAuth del repo (token fresco antes de subscribe y al rotar). Entrega
  // la fila nueva por onUpdate; el merge en el estado lo hace el caller (identico
  // al inline previo). Deps [campaignId]: una suscripcion por campaña.
  export function useCampaignItemsRealtime(
    campaignId: string,
    onUpdate: (row: CampaignItemRealtimeRow) => void,
  ): void {
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;
    useEffect(() => {
      const supabase = createClient();
      const channel = supabase.channel(`campaign-items:${campaignId}`).on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'campaign_items', filter: `campaign_id=eq.${campaignId}` },
        (payload) => onUpdateRef.current(payload.new as CampaignItemRealtimeRow),
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
        authSub.subscription.unsubscribe();
        supabase.removeChannel(channel);
      };
    }, [campaignId]);
  }
  ```

- [ ] **Step 2: Reapuntar el orquestador.** En `CampaignStudioView.tsx` reemplaza el `useEffect` completo (260-297) por la llamada al hook, conservando EXACTO el merge (incluido el guard de `generation_id` indefinido vs null):

  ```ts
  useCampaignItemsRealtime(campaign.id, (r) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === r.id
          ? {
              ...it,
              status: r.status,
              warnings: r.warnings ?? it.warnings,
              generationId: r.generation_id !== undefined ? r.generation_id : it.generationId,
            }
          : it,
      ),
    );
  });
  ```
  Agrega `import { useCampaignItemsRealtime } from './studio/use-campaign-items-realtime';` y elimina el `import { createClient } from '@/lib/supabase/client';` si ya no queda otro uso en el archivo (verificar con el siguiente step).

- [ ] **Step 3: Verificar que no queden imports muertos.** `pnpm lint`
  Expected: sin errores `no-unused-vars` (si `createClient`/`useEffect` quedaron sin uso, el lint los marca; quitarlos).

- [ ] **Step 4: Verificar tipos + build.** `pnpm typecheck && pnpm build`
  Expected: typecheck sin errores; build OK.

- [ ] **Step 5: Smoke manual (Realtime).** Abre `/app/campaigns/<id>` (campaña Studio) → pestaña Produccion, encola una "Muestra (2)". Verifica que las filas pasan `generando… → borrador listo` sin recargar (el canal Realtime sigue vivo tras la extraccion).

- [ ] **Step 6: Commit.** `git add components/campaigns/studio/use-campaign-items-realtime.ts components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer la suscripcion Realtime a use-campaign-items-realtime"`
  Expected: commit creado.

---

### Task S1.4: Extraer `dialogs/CampaignSettingsDialog.tsx` y `dialogs/PromptPreviewDialog.tsx`

**Files:**
- Create: `components/campaigns/studio/dialogs/CampaignSettingsDialog.tsx`
- Create: `components/campaigns/studio/dialogs/PromptPreviewDialog.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita defs lineas 585-730 y 2179-2242; agrega imports)

**Interfaces:**
- Produces:
  - `export function CampaignSettingsDialog({ campaign, onClose }: { campaign: StudioCampaign; onClose: () => void }): JSX.Element;`
  - `export function PromptPreviewDialog({ preview, onClose }: { preview: { loading: boolean; prompt: string | null; references: Array<{ kind: string; role: string; path: string }>; warnings: string[]; errors: string[] }; onClose: () => void }): JSX.Element;`
- Consumes (Settings): `updateCampaignStudioAction`, `setCampaignStatusAction` de `@/server-actions/campaigns`; `GOAL_LABEL`, `type StudioCampaign` de `../types`; `useRouter`; `toast`; `Dialog*`, `Button`; iconos `Loader2/Trophy/Trash2`.
- Consumes (PromptPreview): `Dialog*`; `Loader2`.

**Steps:**

- [ ] **Step 1: Crear `dialogs/CampaignSettingsDialog.tsx`.** Mueve la funcion `CampaignSettingsDialog` (585-730) con `'use client'`. Imports: `import { useState } from 'react';`, `import { useRouter } from 'next/navigation';`, `import { Loader2, Trophy, Trash2 } from 'lucide-react';`, `import { toast } from 'sonner';`, `import { setCampaignStatusAction, updateCampaignStudioAction } from '@/server-actions/campaigns';`, `import { Button } from '@/components/ui/button';`, `import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';`, `import { GOAL_LABEL, type StudioCampaign } from '../types';`.

- [ ] **Step 2: Crear `dialogs/PromptPreviewDialog.tsx`.** Mueve la funcion `PromptPreviewDialog` (2179-2242). Imports: `import { Loader2 } from 'lucide-react';`, `import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';`. Sin `'use client'` necesario (sin estado; render desde props) — pero anade `'use client'` por consistencia, ya que vive en el arbol cliente y usa `Dialog`.

- [ ] **Step 3: Reapuntar el orquestador.** En `CampaignStudioView.tsx` borra ambas funciones (585-730 y 2179-2242) y agrega `import { CampaignSettingsDialog } from './studio/dialogs/CampaignSettingsDialog';` e `import { PromptPreviewDialog } from './studio/dialogs/PromptPreviewDialog';`. (El orquestador ya importa `GOAL_LABEL` de `./studio/types` del task S1.2; si ya no lo usa directamente, quitarlo del import — `GOAL_LABEL` ahora vive en el dialog.)

- [ ] **Step 4: Verificar tipos + build + lint.** `pnpm typecheck && pnpm build && pnpm lint`
  Expected: typecheck sin errores; build OK; lint sin imports muertos (p.ej. `GOAL_LABEL` ya no usado en el orquestador).

- [ ] **Step 5: Smoke manual.** En `/app/campaigns/<id>`: abre el icono Ajustes (guardar nombre/objetivo, archivar) y el ojo "Ver prompt final" en una fila del Plan (preview compila y muestra referencias/avisos). Ambos identicos a antes.

- [ ] **Step 6: Commit.** `git add components/campaigns/studio/dialogs/CampaignSettingsDialog.tsx components/campaigns/studio/dialogs/PromptPreviewDialog.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer CampaignSettingsDialog y PromptPreviewDialog"`
  Expected: commit creado.

---

### Task S1.5: Extraer `dialogs/EditItemDialog.tsx`

**Files:**
- Create: `components/campaigns/studio/dialogs/EditItemDialog.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita def lineas 1999-2177; agrega import)

**Interfaces:**
- Produces: `export function EditItemDialog({ item, characterOptions, onClose, onSaved }: { item: StudioItem; characterOptions: StudioCharacterOption[]; onClose: () => void; onSaved: (patch: Partial<StudioItem>) => void }): JSX.Element;`
- Consumes: `updateCampaignItemAction` de `@/server-actions/campaigns`; `type StudioItem`, `type StudioCharacterOption` de `../types`; `Dialog*`, `Button`; `Loader2`; `toast`.

**Steps:**

- [ ] **Step 1: Crear `dialogs/EditItemDialog.tsx`.** Mueve la funcion `EditItemDialog` (1999-2177) con `'use client'`. Imports: `import { useState } from 'react';`, `import { Loader2 } from 'lucide-react';`, `import { toast } from 'sonner';`, `import { updateCampaignItemAction } from '@/server-actions/campaigns';`, `import { Button } from '@/components/ui/button';`, `import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';`, `import type { StudioItem, StudioCharacterOption } from '../types';`.

- [ ] **Step 2: Reapuntar el orquestador.** Borra la funcion (1999-2177) y agrega `import { EditItemDialog } from './studio/dialogs/EditItemDialog';`.

- [ ] **Step 3: Verificar tipos + build.** `pnpm typecheck && pnpm build`
  Expected: typecheck sin errores; build OK.

- [ ] **Step 4: Smoke manual.** En el Plan, lapiz "Editar" en una fila editable: cambiar accion/personaje/estado/caption/fecha y Guardar; la fila se actualiza sin recargar y el estado autoritativo (`res.data.status`) se respeta.

- [ ] **Step 5: Commit.** `git add components/campaigns/studio/dialogs/EditItemDialog.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer EditItemDialog"`
  Expected: commit creado.

---

### Task S1.6: Extraer `dialogs/DistillDialog.tsx` y `dialogs/VariantDialog.tsx`

**Files:**
- Create: `components/campaigns/studio/dialogs/DistillDialog.tsx`
- Create: `components/campaigns/studio/dialogs/VariantDialog.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita defs lineas 1718-1768 y 1770-1997; agrega imports)

**Interfaces:**
- Produces:
  - `export function DistillDialog({ item, onClose }: { item: StudioItem; onClose: () => void }): JSX.Element;`
  - `export function VariantDialog({ item, characterOptions, bridgeOptions, onClose }: { item: StudioItem; characterOptions: StudioCharacterOption[]; bridgeOptions: StudioItem[]; onClose: () => void }): JSX.Element;` (incluye el `type VariantMode = 'extend' | 'replace_character' | 'change_action' | 'bridge'` local).
- Consumes (Distill): `distillTemplateAction` de `@/server-actions/campaigns`; `type StudioItem` de `../types`; `Dialog*`, `Button`, `Loader2`, `toast`.
- Consumes (Variant): `createVariantAction` de `@/server-actions/campaigns`; `insufficientCreditsToast` de `../../credits-toast`; `type StudioItem`, `type StudioCharacterOption` de `../types`; `Dialog*`, `Button`, `Loader2`, `toast`.

**Steps:**

- [ ] **Step 1: Crear `dialogs/DistillDialog.tsx`.** Mueve `DistillDialog` (1718-1768) con `'use client'`. Imports: `useState`; `Loader2`; `toast`; `import { distillTemplateAction } from '@/server-actions/campaigns';`; `Button`; `Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle`; `import type { StudioItem } from '../types';`.

- [ ] **Step 2: Crear `dialogs/VariantDialog.tsx`.** Mueve el `type VariantMode` (1770) y la funcion `VariantDialog` (1772-1997) con `'use client'`. Imports: `useState`; `Loader2`; `toast`; `import { createVariantAction } from '@/server-actions/campaigns';`; `import { insufficientCreditsToast } from '../../credits-toast';`; `Button`; `Dialog, DialogContent, DialogHeader, DialogTitle`; `import type { StudioItem, StudioCharacterOption } from '../types';`.

- [ ] **Step 3: Reapuntar el orquestador.** Borra ambas funciones (1718-1997) y agrega `import { DistillDialog } from './studio/dialogs/DistillDialog';` e `import { VariantDialog } from './studio/dialogs/VariantDialog';`. (Estas dos solo las usa `ProductionView`, que sigue en el orquestador hasta S1.8; mantener los imports en el archivo del orquestador permite que `ProductionView` los referencie por ahora.)

- [ ] **Step 4: Verificar tipos + build.** `pnpm typecheck && pnpm build`
  Expected: typecheck sin errores; build OK.

- [ ] **Step 5: Smoke manual.** En Produccion, en un creativo `final_ready`: "Convertir en plantilla" (Distill) y "Variante" (4 modos: extender/cambiar personaje/cambiar accion/escena puente). Ambos dialogos abren y encolan igual que antes.

- [ ] **Step 6: Commit.** `git add components/campaigns/studio/dialogs/DistillDialog.tsx components/campaigns/studio/dialogs/VariantDialog.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer DistillDialog y VariantDialog"`
  Expected: commit creado.

---

### Task S1.7: Extraer `PlanRow.tsx` (fila compartida) y `PlanTable.tsx`

**Files:**
- Create: `components/campaigns/studio/PlanRow.tsx`
- Create: `components/campaigns/studio/PlanTable.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita def `PlanTable` lineas 732-1127; agrega import)

**Interfaces:**
- Produces (`PlanRow.tsx`):
  - `export function PlanRow({ item, campaignId, sceneNumber, editable, generating, generateTitle, onGenerate, onEdit, onPreview, onDelete }: { item: StudioItem; campaignId: string; sceneNumber?: number; editable: boolean; generating: boolean; generateTitle: string; onGenerate: (item: StudioItem) => void; onEdit: (item: StudioItem) => void; onPreview: (id: string) => void; onDelete: (item: StudioItem) => void }): JSX.Element;`
- Produces (`PlanTable.tsx`):
  - `export function PlanTable({ campaignId, items, locationOptions, onEdit, onPreview, onDeleted, onSequenceMerged, onSequenceLocationChanged }: { campaignId: string; items: StudioItem[]; locationOptions: StudioLocationOption[]; onEdit: (item: StudioItem) => void; onPreview: (id: string) => void; onDeleted: (id: string) => void; onSequenceMerged: (sequenceId: string, merged: StudioItem) => void; onSequenceLocationChanged: (sequenceId: string, locationId: string | null) => void }): JSX.Element;`
- Consumes (`PlanRow`): `StatusBadge` de `./StatusBadge`; `type StudioItem` de `./types`; `Link`; iconos `CalendarDays/Loader2/Play/Sparkles/Pencil/Trash2/Eye`.
- Consumes (`PlanTable`): `PlanRow` de `./PlanRow`; `type StudioItem`, `type StudioLocationOption` de `./types`; `groupPlanItems` de `@/lib/campaigns/plan-grouping`; `useConfirm` de `@/components/ui/confirm-dialog`; `insufficientCreditsToast` de `../credits-toast`; `generateItemAction`, `deleteCampaignItemAction`, `mergeSequenceAction`, `assignSequenceLocationAction` de `@/server-actions/campaigns`; iconos `Info/Layers`.

**Steps:**

- [ ] **Step 1: Crear `PlanRow.tsx`.** Construye el `<tr>` UNIFICADO a partir de las dos filas duplicadas (fila-suelta 806-905 y fila-de-secuencia 1020-1118). Son identicas salvo: (a) cuando `sceneNumber` esta definido, anteponer la celda `<td ...>{sceneNumber}</td>` del `#`; (b) el `title` del boton Generar = prop `generateTitle`. Resto exacto (Fecha, Formato + badge serie + characterNames, Escena/accion `hidden md:table-cell`, `<StatusBadge status={item.status} />`, acciones Generar/Refinar(`Link` a `/app/campaigns/${campaignId}/refine/${item.id}`)/Editar/Eliminar + ojo Preview). `'use client'` no es estrictamente necesario (sin estado), pero anadelo por vivir en arbol cliente con handlers.

  ```tsx
  'use client';
  import Link from 'next/link';
  import { CalendarDays, Eye, Loader2, Pencil, Play, Sparkles, Trash2 } from 'lucide-react';
  import { StatusBadge } from './StatusBadge';
  import type { StudioItem } from './types';

  export function PlanRow({
    item, campaignId, sceneNumber, editable, generating, generateTitle,
    onGenerate, onEdit, onPreview, onDelete,
  }: {
    item: StudioItem; campaignId: string; sceneNumber?: number; editable: boolean;
    generating: boolean; generateTitle: string;
    onGenerate: (item: StudioItem) => void; onEdit: (item: StudioItem) => void;
    onPreview: (id: string) => void; onDelete: (item: StudioItem) => void;
  }) {
    return (
      <tr className="border-b border-border/50 last:border-0">
        {sceneNumber !== undefined && (
          <td className="whitespace-nowrap px-3 py-2.5 text-2xs text-muted-foreground">{sceneNumber}</td>
        )}
        {/* Fecha / Formato / Escena / Estado / Acciones: copiar VERBATIM de las
            lineas 808-903 (usando `item`, `generating`, `generateTitle`, callbacks). */}
      </tr>
    );
  }
  ```
  (Copiar las celdas exactas desde el original; no reescribir clases.)

- [ ] **Step 2: Crear `PlanTable.tsx`.** Mueve la funcion `PlanTable` (732-1127) con `'use client'`, PERO:
  - Elimina la funcion interna `renderPlanRow` (805-906) y el JSX inline de la fila de secuencia (1020-1118); en su lugar renderiza `<PlanRow ... />`.
  - Tabla de singles (957): `{singleGroups.map((group) => <PlanRow key={group.item.id} item={group.item} campaignId={campaignId} editable={editable(group.item.status)} generating={generatingItem === group.item.id} generateTitle="Generar esta escena" onGenerate={handleGenerateItem} onEdit={onEdit} onPreview={onPreview} onDelete={handleDelete} />)}`.
  - Cuerpo de secuencia (1019): `{group.scenes.map((scene, i) => <PlanRow key={scene.id} item={scene} campaignId={campaignId} sceneNumber={i + 1} editable={editable(scene.status)} generating={generatingItem === scene.id} generateTitle="Generar esta escena (continúa desde la anterior)" onGenerate={handleGenerateItem} onEdit={onEdit} onPreview={onPreview} onDelete={handleDelete} />)}`.
  - Conserva intactos: `editable` helper, `handleGenerateItem`/`handleDelete`/`handleMergeSequence`/`handleAssignLocation`, los estados `generatingItem`/`assigningLocation`, `groupPlanItems`, el banner de secuencias, los encabezados de tabla y los selectores de locacion / boton "Unir en 1 clip".
  - Imports: `useState` (react); iconos `Info, Layers` (los de las filas viven en `PlanRow`); `Link` NO si ya no se usa fuera de `PlanRow` (verificar con lint); `import { PlanRow } from './PlanRow';`; `import { StatusBadge } from './StatusBadge';` (si queda algun uso directo — en `PlanTable` ya no; lo usa `PlanRow`); `import type { StudioItem, StudioLocationOption } from './types';`; `import { groupPlanItems } from '@/lib/campaigns/plan-grouping';`; `import { useConfirm } from '@/components/ui/confirm-dialog';`; `import { insufficientCreditsToast } from '../credits-toast';`; `import { toast } from 'sonner';`; `import { Button } from '@/components/ui/button';`; acciones de `@/server-actions/campaigns`.

- [ ] **Step 3: Reapuntar el orquestador.** Borra `PlanTable` (732-1127) y agrega `import { PlanTable } from './studio/PlanTable';`.

- [ ] **Step 4: Verificar tipos + build + lint.** `pnpm typecheck && pnpm build && pnpm lint`
  Expected: typecheck sin errores; build OK; lint sin imports muertos.

- [ ] **Step 5: Smoke manual (regresion de dedup).** En el Plan: tabla de clips sueltos y tarjeta(s) de secuencia. Verifica que la fila de secuencia muestra la columna `#` (1,2,3…) y la suelta NO; los botones Generar/Refinar/Editar/Eliminar/Ver funcionan en ambas; el banner "La IA interpretó tus ideas…" y "Unir en 1 clip" + selector de locacion siguen igual.

- [ ] **Step 6: Commit.** `git add components/campaigns/studio/PlanRow.tsx components/campaigns/studio/PlanTable.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer PlanTable y fila compartida PlanRow (dedup plan)"`
  Expected: commit creado.

---

### Task S1.8: Extraer `ProductionGroupCard.tsx` y `ProductionView.tsx`

**Files:**
- Create: `components/campaigns/studio/ProductionGroupCard.tsx`
- Create: `components/campaigns/studio/ProductionView.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita def `ProductionView` lineas 1129-1617; agrega import)

**Interfaces:**
- Produces (`ProductionGroupCard.tsx`):
  - `export function ProductionGroupCard({ group, busy, finalCost, onCancel, onRegenerate, onBatch, onFinal, onRedoSamples, onWinner, onView, onDistill, onVariant }: { group: { formatId: string; formatName: string; items: StudioItem[] }; busy: string | null; finalCost: (resolution: '720p' | '1080p', durationS: number | null) => number | null; onCancel: (generationId: string) => void; onRegenerate: (itemId: string, mode?: RegenMode) => void; onBatch: (formatId: string, mode: 'sample' | 'full') => void; onFinal: (itemId: string, resolution: '720p' | '1080p') => void; onRedoSamples: (formatId: string) => void; onWinner: (item: StudioItem) => void; onView: (v: { generationId: string; title: string }) => void; onDistill: (item: StudioItem) => void; onVariant: (item: StudioItem) => void }): JSX.Element;`
- Produces (`ProductionView.tsx`):
  - `export function ProductionView({ campaignId, groups, characterOptions, pricing, onWinner, onSamplesReset }: { campaignId: string; groups: Array<{ formatId: string; formatName: string; items: StudioItem[] }>; characterOptions: StudioCharacterOption[]; pricing: PricingRow[]; onWinner: (itemId: string, isWinner: boolean) => void; onSamplesReset: (formatId: string) => void }): JSX.Element;`
- Consumes (`ProductionGroupCard`): `type StudioItem` de `./types`; `type RegenMode` de `@/server-actions/campaigns`; `regenModesFor` de `@/lib/campaigns/sequence-chain`; iconos `Clapperboard/Info/Layers/Loader2/Play/RefreshCw/Sparkles/Trophy/X`; `Button`; `Link`.
- Consumes (`ProductionView`): `ProductionGroupCard` de `./ProductionGroupCard`; `DistillDialog`/`VariantDialog` de `./dialogs/...`; `FINAL_MODEL`, `type StudioItem`, `type StudioCharacterOption` de `./types`; `seedanceCostPerItem` de `@/lib/campaigns/estimate`; `type PricingRow` de `@/lib/credits/types`; `cancelGenerationAction` de `@/server-actions/generations`; `approveBatchAction`/`generateItemAction`/`requestFinalAction`/`redoSamplesAction`/`toggleWinnerAction`/`type RegenMode` de `@/server-actions/campaigns`; `insufficientCreditsToast` de `../credits-toast`; `ImagePackCard` de `../CampaignCalendar`; `GenerationViewer` de `../GenerationViewer`; `toast`.

**Steps:**

- [ ] **Step 1: Crear `ProductionGroupCard.tsx`.** Mueve el cuerpo de `groups.map((group) => { ... })` (1247-1583) a un componente que recibe UN `group` y las props del bag. Conserva VERBATIM el calculo de derivados por grupo (`pending`, `generatingItems`, `drafts`, `finalItems`, `sequences`, `loosePending`, `pureSequence`) y todos los sub-bloques (cabecera + botones Muestra/Lote, aviso de secuencia, lista "generando" con Cancelar, lista "borradores" con Ver/Refinar/Regenerar(+modos de secuencia via `regenModesFor`)/Final 720p·1080p con `finalCost`, "regresar borradores", lista "finales" con Ver/Ganador/Convertir-en-plantilla/Variante). Reemplaza referencias a handlers/estado locales por las props (`onCancel`, `onRegenerate`, `busy`, `onView`, `onDistill`, `onVariant`, etc.). `'use client'`.

- [ ] **Step 2: Crear `ProductionView.tsx`.** Mueve `ProductionView` (1129-1617) con `'use client'`. Conserva los estados (`busy`, `distilling`, `varianting`, `viewing`), `finalCost` (usa `seedanceCostPerItem` + `FINAL_MODEL` de `./types`) y los handlers (`handleCancel`/`handleRegenerate`/`handleWinner`/`handleBatch`/`handleFinal`/`handleRedoSamples`). Reemplaza el `groups.map(...)` por:
  ```tsx
  {groups.map((group) => (
    <ProductionGroupCard
      key={group.formatId || group.formatName}
      group={group}
      busy={busy}
      finalCost={finalCost}
      onCancel={handleCancel}
      onRegenerate={handleRegenerate}
      onBatch={handleBatch}
      onFinal={handleFinal}
      onRedoSamples={handleRedoSamples}
      onWinner={handleWinner}
      onView={setViewing}
      onDistill={setDistilling}
      onVariant={setVarianting}
    />
  ))}
  ```
  Conserva intactos, despues del map: `<ImagePackCard ... />`, el parrafo informativo, y los render condicionales de `DistillDialog`/`VariantDialog`/`GenerationViewer` (con `bridgeOptions` calculado igual). Imports relativos: `../CampaignCalendar` (ImagePackCard), `../GenerationViewer`, `../credits-toast`, `./dialogs/DistillDialog`, `./dialogs/VariantDialog`, `./ProductionGroupCard`, `./types`.

- [ ] **Step 3: Reapuntar el orquestador.** Borra `ProductionView` (1129-1617) y agrega `import { ProductionView } from './studio/ProductionView';`. Quita del orquestador los imports que ya solo usaba `ProductionView` (p.ej. `DistillDialog`/`VariantDialog` ahora se importan dentro de `ProductionView`; `cancelGenerationAction`, `seedanceCostPerItem`, `FINAL_MODEL`, `RegenMode`, etc.) — confirmar con lint en el step 4.

- [ ] **Step 4: Verificar tipos + build + lint.** `pnpm typecheck && pnpm build && pnpm lint`
  Expected: typecheck sin errores; build OK; lint sin imports muertos en el orquestador.

- [ ] **Step 5: Smoke manual (flujo critico).** Pestaña Produccion: "Muestra (2)" y "Lote completo" (incl. caso solo-secuencia deshabilita Muestra), Cancelar una generacion en curso, en un borrador Ver/Refinar/Regenerar (+ "solo este"/"este y los siguientes" en escena media de secuencia) y Final 720p/1080p con costo, "regresar borradores", y en un final Ganador/Convertir-en-plantilla/Variante + visor inline. Todo identico.

- [ ] **Step 6: Commit.** `git add components/campaigns/studio/ProductionGroupCard.tsx components/campaigns/studio/ProductionView.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer ProductionView y ProductionGroupCard"`
  Expected: commit creado.

---

### Task S1.9: Extraer `TemplatesView.tsx`

**Files:**
- Create: `components/campaigns/studio/TemplatesView.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (quita def lineas 1619-1716; agrega import)

**Interfaces:**
- Produces: `export function TemplatesView({ templates, onSeriesCreated }: { templates: StudioTemplate[]; onSeriesCreated: (created: StudioItem[]) => void }): JSX.Element;`
- Consumes: `generateSeriesAction` de `@/server-actions/campaigns`; `type StudioTemplate`, `type StudioItem` de `./types`; `Switch` de `@/components/ui/switch`; `Button`; `Loader2/Play`; `toast`.

**Steps:**

- [ ] **Step 1: Crear `TemplatesView.tsx`.** Mueve `TemplatesView` (1619-1716) con `'use client'`. Imports: `useState`; `Loader2, Play`; `toast`; `import { generateSeriesAction } from '@/server-actions/campaigns';`; `Button`; `import { Switch } from '@/components/ui/switch';`; `import type { StudioTemplate, StudioItem } from './types';`.

- [ ] **Step 2: Reapuntar el orquestador.** Borra `TemplatesView` (1619-1716) y agrega `import { TemplatesView } from './studio/TemplatesView';`. Tras esto el orquestador ya no contiene definiciones de subcomponentes (solo el `CampaignStudioView` principal + el `Dialog` reprocess inline).

- [ ] **Step 3: Verificar tipos + build.** `pnpm typecheck && pnpm build`
  Expected: typecheck sin errores; build OK.

- [ ] **Step 4: Smoke manual.** Pestaña Plantillas: estado vacio si no hay; con plantillas, selector de tamaño (2/3/4/6), toggle "Rotar personajes", "Generar serie" agrega items al plan sin recargar.

- [ ] **Step 5: Commit.** `git add components/campaigns/studio/TemplatesView.tsx components/campaigns/CampaignStudioView.tsx && git commit -m "refactor(studio): extraer TemplatesView"`
  Expected: commit creado.

---

### Task S1.10: Mover el orquestador a `studio/`, crear barrel, repuntar consumidores y borrar el archivo viejo

**Files:**
- Create: `components/campaigns/studio/CampaignStudioView.tsx`
- Create: `components/campaigns/studio/index.ts`
- Modify: `app/app/campaigns/[id]/page.tsx` (import lineas 5-10)
- Modify: `components/campaigns/CampaignCalendar.tsx` (import linea 10)
- Delete: `components/campaigns/CampaignStudioView.tsx`

**Interfaces:**
- Produces (`index.ts`):
  - `export { CampaignStudioView } from './CampaignStudioView';`
  - `export type { StudioItem, StudioTemplate, StudioCampaign, StudioCharacterOption, StudioLocationOption } from './types';`
- Consumes: `app/app/campaigns/[id]/page.tsx` importa `CampaignStudioView` + tipos desde `@/components/campaigns/studio`; `CampaignCalendar.tsx` importa `type StudioItem` desde `./studio/types`.

**Steps:**

- [ ] **Step 1: Mover el orquestador.** Mueve el archivo `components/campaigns/CampaignStudioView.tsx` (que ya solo contiene `CampaignStudioView` + el `Dialog` reprocess inline) a `components/campaigns/studio/CampaignStudioView.tsx` (conserva `'use client'`). Ajusta sus imports a la nueva ubicacion:
  - `./studio/PlanTable` → `./PlanTable`; `./studio/ProductionView` → `./ProductionView`; `./studio/TemplatesView` → `./TemplatesView`; `./studio/dialogs/CampaignSettingsDialog` → `./dialogs/CampaignSettingsDialog`; `./studio/dialogs/EditItemDialog` → `./dialogs/EditItemDialog`; `./studio/dialogs/PromptPreviewDialog` → `./dialogs/PromptPreviewDialog`; `./studio/types` → `./types`; `./studio/use-campaign-items-realtime` → `./use-campaign-items-realtime`.
  - `./CampaignCalendar` (CalendarView) → `../CampaignCalendar`.
  - El re-export de tipos (`export type { ... } from './studio/types';`) → `export type { ... } from './types';` (o eliminarlo: el barrel ya re-exporta).
  - Imports `@/...` y `@/server-actions/...` quedan iguales.

- [ ] **Step 2: Crear el barrel `index.ts`.** Crea `components/campaigns/studio/index.ts` con los dos `export`/`export type` de Interfaces.

- [ ] **Step 3: Repuntar `page.tsx`.** En `app/app/campaigns/[id]/page.tsx` cambia el import (lineas 5-10) de `'@/components/campaigns/CampaignStudioView'` a `'@/components/campaigns/studio'` (mismo set: `CampaignStudioView`, `type StudioItem`, `type StudioLocationOption`, `type StudioTemplate`).

- [ ] **Step 4: Repuntar `CampaignCalendar.tsx`.** Cambia la linea 10 `import type { StudioItem } from './CampaignStudioView';` por `import type { StudioItem } from './studio/types';`.

- [ ] **Step 5: Borrar el archivo viejo.** `git rm components/campaigns/CampaignStudioView.tsx`
  Expected: el archivo se elimina del indice.

- [ ] **Step 6: Verificar que no quedan referencias al path viejo.** `pnpm exec grep -rn "campaigns/CampaignStudioView" app components lib || echo "sin referencias"`
  Expected: imprime `sin referencias` (ninguna importacion del modulo eliminado).

- [ ] **Step 7: Verificacion final completa.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  Expected: typecheck sin errores; lint limpio; suite completa verde (incl. `lib/campaigns/studio-view.test.ts`); build OK (`Compiled successfully`, ruta `/app/campaigns/[id]` construida). (Recordatorio: aunque esta unidad no modifica `'use server'`, el `pnpm build` es obligatorio porque es lo unico que valida los boundaries de Client Components de un split de este tamaño.)

- [ ] **Step 8: Confirmar la meta de tamaño.** `pnpm exec wc -l components/campaigns/studio/*.tsx components/campaigns/studio/dialogs/*.tsx`
  Expected: ningun archivo supera ~400 lineas (el mayor, `ProductionGroupCard.tsx`, queda por debajo; orquestador, `PlanTable`, `VariantDialog` y `EditItemDialog` rondan 150-330).

- [ ] **Step 9: Commit.** `git add app/app/campaigns/[id]/page.tsx components/campaigns/CampaignCalendar.tsx components/campaigns/studio/CampaignStudioView.tsx components/campaigns/studio/index.ts && git commit -m "refactor(studio): mover orquestador a studio/, barrel y repuntar consumidores"`
  Expected: commit creado; `git status` limpio.
### Unidad S2: LibraryView (1835 lineas) -> lib/library/ + components/library/

**Objetivo.** `components/library/LibraryView.tsx` concentra hoy 1835 lineas: tipos, 8 helpers puros, agrupacion de sesiones, fetch/descarga de outputs, 17 subcomponentes y toda la maquina de estado (gens optimista, seleccion en lote, favoritos, detalle). Este refactor es **movimiento/extraccion con comportamiento IDENTICO**: primero saco la logica determinista a `lib/library/*` con tests de caracterizacion vitest (RED -> GREEN), luego muevo los subcomponentes a archivos propios bajo `components/library/`, y al final extraigo los hooks de estado dejando `LibraryView.tsx` como orquestador delgado (~180-200 lineas, no las 120-150 idealizadas del audit: `removeGens`/`handleBulkDelete`/`handleDeleteOne` se quedan como glue porque cruzan `confirm`/`router`/seleccion/active y extraerlos arriesga drift). La red de seguridad por task es: suite vitest existente verde + `pnpm typecheck` + `pnpm build` + smoke manual de `/app/library`. Ningun archivo de esta unidad lleva `'use server'`, pero igual corremos `pnpm build` en cada task de componente/hook porque errores de frontera RSC NO los ve `typecheck`.

**Nota de Ola 1 (NO recrear, pero OJO):** `lib/media/image.ts` exporta `inferExtension(mime)` (fallback `'bin'`, sin `ogg`). El helper de la Biblioteca `extFromMime` tiene **comportamiento distinto** (fallback `'jpg'`, mapea `ogg`, coincide con `lib/media-references/download-client.ts`). Por eso `extFromMime` se queda como funcion propia en `lib/library/format.ts` y **NO** se sustituye por `inferExtension`: cambiar el fallback alteraria los nombres de archivo en el zip de descarga.

**File Structure**

Nuevos en `lib/library/`:
- `types.ts` — tipos compartidos: `LibraryGeneration`, `Tab`, `SortKey`, `Session`. Sin React, sin directiva.
- `format.ts` — helpers puros de formato/derivacion: `CAMPAIGN_NONE`, `modelLabel`, `generationToModelKey`, `extFromMime`, `batchLabel`, `reuseHref`, `bucketOf`, `shortTime`, `aspectRatioToNumber`. Sin React.
- `format.test.ts` — caracterizacion de `format.ts`.
- `sessions.ts` — `groupSessions` (+ `rootOf` interno). Sin React.
- `sessions.test.ts` — caracterizacion de cadenas A->B->C, ciclos y orden.
- `output.ts` — IO de output: `fetchOutputUrl`, `downloadOne`, `bulkDownload` (`'use client'`).
- `output.test.ts` — caracterizacion de `fetchOutputUrl` con `fetch` mockeado.
- `use-favorites.ts` — hook de favoritos + filtro fav (`'use client'`).
- `use-bulk-selection.ts` — hook de seleccion en lote + flags de modales (`'use client'`).
- `use-library-items.ts` — hook de gens optimista + sync + `filteredGens` + `sessions` (`'use client'`).

Nuevos en `components/library/`:
- `ToolbarButton.tsx`, `TileBtn.tsx`, `BucketHeader.tsx`, `DetailRow.tsx`, `DetailField.tsx`, `LibEmptyState.tsx`, `MiniAudioPlayer.tsx` — primitivos presentacionales.
- `LibTile.tsx` — tile de imagen/video/audio con hover, descarga, usar-como-ref, seleccion, favorito.
- `SessionsTab.tsx` (+ `SessionCard`), `GridTab.tsx` — tabs de listado.
- `LibHeader.tsx` (+ const `TABS`) — header con tabs, busqueda, sort, filtro fav.
- `CompareModal.tsx`, `AssignCollectionDialog.tsx` — dialogos.
- `CampaignAssigner.tsx`, `SavePresetButton.tsx` — controles del detalle.
- `DetailAside.tsx` (+ `DetailMediaPreview.tsx`, `DetailActions.tsx`, `DetailHistory.tsx`) — panel de detalle.

Modificado:
- `components/library/LibraryView.tsx` — pasa de 1835 a ~180-200 lineas; solo orquesta estado y render, re-exporta `LibraryGeneration` para no tocar `app/app/library/page.tsx`.

---

### Task S2.1: Extraer tipos a lib/library/types.ts

**Files:**
- Create: `lib/library/types.ts`
- Modify: `components/library/LibraryView.tsx` (borra `type LibraryGeneration` :41-57, `type Tab`/`type SortKey` :60-61, `type Session` :152-157; agrega imports + re-export)

**Interfaces:**
- Produces:
  - `export type LibraryGeneration = { id: string; type: string; provider: string; model: string; prompt: string; status: string; thumbnailUrl: string | null; hasOutput: boolean; credits: number; createdAt: string; parentGenerationId: string | null; batchId: string | null; batchKind: string | null; campaignId: string | null; aspectRatio: string | null };`
  - `export type Tab = 'sessions' | 'grid' | 'collections';`
  - `export type SortKey = 'recent' | 'old';`
  - `export type Session = { id: string; items: LibraryGeneration[]; head: LibraryGeneration; latest: LibraryGeneration };`
- Consumes: ninguno.

**Steps:**
- [ ] **Step 1: Crear `lib/library/types.ts`.** Pega el contenido (tipos movidos verbatim desde las lineas indicadas):
  ```ts
  export type LibraryGeneration = {
    id: string;
    type: string;
    provider: string;
    model: string;
    prompt: string;
    status: string;
    thumbnailUrl: string | null;
    hasOutput: boolean;
    credits: number;
    createdAt: string;
    parentGenerationId: string | null;
    batchId: string | null;
    batchKind: string | null;
    campaignId: string | null;
    aspectRatio: string | null;
  };

  export type Tab = 'sessions' | 'grid' | 'collections';
  export type SortKey = 'recent' | 'old';

  export type Session = {
    id: string;
    items: LibraryGeneration[];
    head: LibraryGeneration;
    latest: LibraryGeneration;
  };
  ```
- [ ] **Step 2: Borrar los tipos locales en `LibraryView.tsx`.** Elimina los bloques `export type LibraryGeneration` (:41-57), `type Tab` + `type SortKey` (:60-61) y `type Session` (:152-157).
- [ ] **Step 3: Agregar import + re-export en `LibraryView.tsx`.** Justo bajo el bloque de imports (despues de la linea 37 `import { PageEmptyState }`), agrega:
  ```ts
  import type { LibraryGeneration, Tab, SortKey, Session } from '@/lib/library/types';

  export type { LibraryGeneration };
  ```
  El `export type { LibraryGeneration }` mantiene vivo `import { ..., type LibraryGeneration } from '@/components/library/LibraryView'` en `app/app/library/page.tsx:5` (no se toca esa pagina).
- [ ] **Step 4: Verificar typecheck.** Comando: `pnpm typecheck`. Expected: sin errores (exit 0).
- [ ] **Step 5: Verificar build.** Comando: `pnpm build`. Expected: `Compiled successfully`, sin error de tipos ni de ruta. (Recordatorio: `typecheck`/`lint` no detectan el gotcha de `'use server'`; aqui no aplica porque ningun archivo lleva esa directiva, pero `build` es el unico que validaria fronteras RSC.)
- [ ] **Step 6: Commit.** Comando: `git add -A && git commit -m "refactor(library): tipos compartidos a lib/library/types.ts"`. Expected: commit creado, sin trailer Co-Authored-By.

---

### Task S2.2: Extraer helpers puros a lib/library/format.ts (TDD)

**Files:**
- Create: `lib/library/format.ts`
- Test: `lib/library/format.test.ts`
- Modify: `components/library/LibraryView.tsx` (borra `CAMPAIGN_NONE` :39, `MODEL_LABEL` :69-73, `modelLabel` :75-77, `generationToModelKey` :82-87, `extFromMime` :89-98, `batchLabel` :100-107, `reuseHref` :109-119, `bucketOf` :121-135, `shortTime` :137-150; reemplaza el calculo inline de ratio en `LibTile` :946-948 y `DetailAside` :1202-1204; agrega import)

**Interfaces:**
- Consumes (Ola 1): NINGUNO directo. NO usar `lib/media/image.ts#inferExtension` (fallback distinto, ver nota de cabecera).
- Produces:
  - `export const CAMPAIGN_NONE = '__none__';`
  - `export function modelLabel(g: { provider: string; model: string }): string;`
  - `export function generationToModelKey(g: { provider: string; model: string }): string;`
  - `export function extFromMime(type: string): string;`
  - `export function batchLabel(kind: string): string;`
  - `export function reuseHref(g: LibraryGeneration): string;`
  - `export function bucketOf(iso: string): string;`
  - `export function shortTime(iso: string): string;`
  - `export function aspectRatioToNumber(raw: string | null): number;`

**Steps:**
- [ ] **Step 1: Escribir el test de caracterizacion (RED).** Crea `lib/library/format.test.ts`:
  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  import {
    CAMPAIGN_NONE,
    aspectRatioToNumber,
    batchLabel,
    bucketOf,
    extFromMime,
    generationToModelKey,
    modelLabel,
    reuseHref,
    shortTime,
  } from './format';
  import type { LibraryGeneration } from './types';

  const baseGen: LibraryGeneration = {
    id: '11111111-2222-3333-4444-555555555555',
    type: 'image', provider: 'nano-banana', model: 'gemini-3-pro-image-preview',
    prompt: 'un gato astronauta', status: 'done', thumbnailUrl: null, hasOutput: true,
    credits: 4, createdAt: '2026-06-27T12:00:00.000Z', parentGenerationId: null,
    batchId: null, batchKind: null, campaignId: null, aspectRatio: '16:9',
  };

  describe('modelLabel', () => {
    it('mapea modelos conocidos y cae a provider/model', () => {
      expect(modelLabel({ provider: 'nano-banana', model: 'gemini-3-pro-image-preview' })).toBe('Nano Banana Pro');
      expect(modelLabel({ provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview' })).toBe('Nano Flash');
      expect(modelLabel({ provider: 'flux', model: 'flux-2-pro-preview' })).toBe('FLUX 2 Pro');
      expect(modelLabel({ provider: 'veo', model: 'veo-3.1-generate-preview' })).toBe('veo/veo-3.1-generate-preview');
    });
  });

  describe('generationToModelKey', () => {
    it('flux/nano-flash/nano-pro y fallback auto', () => {
      expect(generationToModelKey({ provider: 'flux', model: 'x' })).toBe('flux');
      expect(generationToModelKey({ provider: 'nano-banana', model: 'gemini-3.1-flash-image-preview' })).toBe('nano-flash');
      expect(generationToModelKey({ provider: 'nano-banana', model: 'gemini-3-pro-image-preview' })).toBe('nano-pro');
      expect(generationToModelKey({ provider: 'veo', model: 'veo-3.1-generate-preview' })).toBe('auto');
    });
  });

  describe('extFromMime', () => {
    it('mapea mimes con fallback jpg (incluye ogg)', () => {
      expect(extFromMime('image/png')).toBe('png');
      expect(extFromMime('image/webp')).toBe('webp');
      expect(extFromMime('video/mp4')).toBe('mp4');
      expect(extFromMime('video/webm')).toBe('webm');
      expect(extFromMime('audio/mpeg')).toBe('mp3');
      expect(extFromMime('audio/mp3')).toBe('mp3');
      expect(extFromMime('audio/wav')).toBe('wav');
      expect(extFromMime('audio/ogg')).toBe('ogg');
      expect(extFromMime('image/jpeg')).toBe('jpg');
      expect(extFromMime('application/octet-stream')).toBe('jpg');
    });
  });

  describe('batchLabel', () => {
    it('etiqueta por tipo de batch', () => {
      expect(batchLabel('storyboard')).toBe('SB');
      expect(batchLabel('variations')).toBe('VAR');
      expect(batchLabel('smart_crop')).toBe('CROP');
      expect(batchLabel('otro')).toBe('BATCH');
    });
  });

  describe('reuseHref', () => {
    it('arma la URL con prompt/aspect/model y rutea por tipo', () => {
      const href = reuseHref(baseGen);
      const qs = new URLSearchParams(href.split('?')[1]);
      expect(href.startsWith('/app/create/image?')).toBe(true);
      expect(qs.get('prompt')).toBe('un gato astronauta');
      expect(qs.get('aspect')).toBe('16:9');
      expect(qs.get('model')).toBe('nano-pro');
      expect(reuseHref({ ...baseGen, type: 'video' }).startsWith('/app/create/video?')).toBe(true);
      expect(reuseHref({ ...baseGen, type: 'audio' }).startsWith('/app/create/audio?')).toBe(true);
    });
  });

  describe('aspectRatioToNumber', () => {
    it('parsea w:h, null -> 1, divisor 0 -> 1, basura -> 1', () => {
      expect(aspectRatioToNumber('16:9')).toBeCloseTo(16 / 9);
      expect(aspectRatioToNumber('1:1')).toBe(1);
      expect(aspectRatioToNumber(null)).toBe(1);
      expect(aspectRatioToNumber('1:0')).toBe(1);
      expect(aspectRatioToNumber('texto')).toBe(1);
    });
  });

  describe('bucketOf / shortTime', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-06-27T15:00:00')); });
    afterEach(() => { vi.useRealTimers(); });
    it('bucketOf agrupa por recencia', () => {
      expect(bucketOf(new Date('2026-06-27T08:00:00').toISOString())).toBe('Hoy');
      expect(bucketOf(new Date('2026-06-26T23:00:00').toISOString())).toBe('Ayer');
      expect(bucketOf(new Date('2026-06-23T10:00:00').toISOString())).toBe('Esta semana');
      expect(bucketOf(new Date('2026-02-10T10:00:00').toISOString())).toMatch(/^[A-ZÁÉÍÓÚ]/);
      expect(bucketOf(new Date('2024-03-10T10:00:00').toISOString())).toMatch(/2024$/);
    });
    it('shortTime prefija Hoy/Ayer', () => {
      expect(shortTime(new Date('2026-06-27T08:30:00').toISOString())).toMatch(/^Hoy · /);
      expect(shortTime(new Date('2026-06-26T08:30:00').toISOString())).toMatch(/^Ayer · /);
    });
  });

  it('CAMPAIGN_NONE es el sentinel esperado', () => {
    expect(CAMPAIGN_NONE).toBe('__none__');
  });
  ```
  Comando: `pnpm test lib/library/format.test.ts`. Expected: FALLA al resolver el modulo (`Failed to resolve import "./format"` / "No test files" no aplica — el error es de import). Esto confirma RED.
- [ ] **Step 2: Crear `lib/library/format.ts` (GREEN).** Mueve los cuerpos verbatim desde `LibraryView.tsx` y agrega `aspectRatioToNumber` (extraido del calculo repetido `aspect.split(':').map(Number)` de `LibTile`/`DetailAside`):
  ```ts
  import type { LibraryGeneration } from './types';

  export const CAMPAIGN_NONE = '__none__';

  const MODEL_LABEL: Record<string, string> = {
    'gemini-3-pro-image-preview': 'Nano Banana Pro',
    'gemini-3.1-flash-image-preview': 'Nano Flash',
    'flux-2-pro-preview': 'FLUX 2 Pro',
  };

  export function modelLabel(g: { provider: string; model: string }): string {
    return MODEL_LABEL[g.model] ?? `${g.provider}/${g.model}`;
  }

  export function generationToModelKey(g: { provider: string; model: string }): string {
    if (g.provider === 'flux') return 'flux';
    if (g.model === 'gemini-3.1-flash-image-preview') return 'nano-flash';
    if (g.model === 'gemini-3-pro-image-preview') return 'nano-pro';
    return 'auto';
  }

  export function extFromMime(type: string): string {
    if (type.includes('png')) return 'png';
    if (type.includes('webp')) return 'webp';
    if (type.includes('mp4')) return 'mp4';
    if (type.includes('webm')) return 'webm';
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
    if (type.includes('wav')) return 'wav';
    if (type.includes('ogg')) return 'ogg';
    return 'jpg';
  }

  export function batchLabel(kind: string): string {
    switch (kind) {
      case 'storyboard': return 'SB';
      case 'variations': return 'VAR';
      case 'smart_crop': return 'CROP';
      default: return 'BATCH';
    }
  }

  export function reuseHref(g: LibraryGeneration): string {
    const params = new URLSearchParams();
    if (g.prompt) params.set('prompt', g.prompt);
    if (g.aspectRatio) params.set('aspect', g.aspectRatio);
    params.set('model', generationToModelKey(g));
    const base =
      g.type === 'video' ? '/app/create/video'
      : g.type === 'audio' ? '/app/create/audio'
      : '/app/create/image';
    return `${base}?${params.toString()}`;
  }

  export function bucketOf(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const t = date.getTime();
    if (t >= today0) return 'Hoy';
    if (t >= today0 - dayMs) return 'Ayer';
    if (t >= today0 - 7 * dayMs) return 'Esta semana';
    if (date.getFullYear() === now.getFullYear()) {
      const m = date.toLocaleString('es-MX', { month: 'long' });
      return m.charAt(0).toUpperCase() + m.slice(1);
    }
    return `${date.toLocaleString('es-MX', { month: 'short' })} ${date.getFullYear()}`;
  }

  export function shortTime(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const t = date.getTime();
    const hhmm = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    if (t >= today0) return `Hoy · ${hhmm}`;
    if (t >= today0 - dayMs) return `Ayer · ${hhmm}`;
    if (t >= today0 - 7 * dayMs) {
      return date.toLocaleDateString('es-MX', { weekday: 'short' }) + ` · ${hhmm}`;
    }
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  }

  // Convierte 'w:h' al ratio numerico que usa style.aspectRatio. null -> 1,
  // divisor 0 o basura -> 1 (replica el calculo inline de LibTile/DetailAside).
  export function aspectRatioToNumber(raw: string | null): number {
    const aspect = raw ?? '1:1';
    const [w, h] = aspect.split(':').map(Number);
    return h > 0 ? w / h : 1;
  }
  ```
  Comando: `pnpm test lib/library/format.test.ts`. Expected: todos los tests PASAN (GREEN).
- [ ] **Step 3: Cablear `LibraryView.tsx` a `format.ts`.** Borra de `LibraryView.tsx`: `const CAMPAIGN_NONE` (:39), `MODEL_LABEL` (:69-73), `modelLabel` (:75-77), `generationToModelKey` (:82-87), `extFromMime` (:89-98), `batchLabel` (:100-107), `reuseHref` (:109-119), `bucketOf` (:121-135), `shortTime` (:137-150). Agrega al bloque de imports:
  ```ts
  import {
    CAMPAIGN_NONE,
    aspectRatioToNumber,
    batchLabel,
    bucketOf,
    extFromMime,
    modelLabel,
    reuseHref,
    shortTime,
  } from '@/lib/library/format';
  ```
  (`generationToModelKey` no se importa: solo lo usa `reuseHref`, que ya vive en `format.ts`.)
- [ ] **Step 4: Reemplazar el calculo de ratio inline.** En `LibTile` (orig :946-948) sustituye las 3 lineas por:
  ```ts
  const ratio = aspectRatioToNumber(compact ? '1:1' : gen.aspectRatio);
  ```
  En `DetailAside` (orig :1202-1204) sustituye las 3 lineas por:
  ```ts
  const ratio = aspectRatioToNumber(generation.aspectRatio);
  ```
- [ ] **Step 5: Verificar typecheck + suite + build.** Comando: `pnpm typecheck && pnpm test && pnpm build`. Expected: typecheck exit 0; vitest todo verde (incluido `format.test.ts`); build `Compiled successfully`.
- [ ] **Step 6: Commit.** Comando: `git add -A && git commit -m "refactor(library): helpers puros a lib/library/format.ts + test"`. Expected: commit creado.

---

### Task S2.3: Extraer groupSessions a lib/library/sessions.ts (TDD)

**Files:**
- Create: `lib/library/sessions.ts`
- Test: `lib/library/sessions.test.ts`
- Modify: `components/library/LibraryView.tsx` (borra `groupSessions` + `rootOf` :159-201; agrega import)

**Interfaces:**
- Consumes: `LibraryGeneration`, `SortKey`, `Session` de `@/lib/library/types`.
- Produces: `export function groupSessions(gens: LibraryGeneration[], sort: SortKey): Session[];`

**Steps:**
- [ ] **Step 1: Escribir test de caracterizacion (RED).** Crea `lib/library/sessions.test.ts`:
  ```ts
  import { describe, expect, it } from 'vitest';
  import { groupSessions } from './sessions';
  import type { LibraryGeneration } from './types';

  function gen(id: string, parent: string | null, createdAt: string): LibraryGeneration {
    return {
      id, type: 'image', provider: 'nano-banana', model: 'gemini-3-pro-image-preview',
      prompt: id, status: 'done', thumbnailUrl: null, hasOutput: true, credits: 1,
      createdAt, parentGenerationId: parent, batchId: null, batchKind: null,
      campaignId: null, aspectRatio: null,
    };
  }

  describe('groupSessions', () => {
    it('agrupa una cadena A->B->C bajo la raiz A', () => {
      const sessions = groupSessions([
        gen('A', null, '2026-06-27T10:00:00Z'),
        gen('B', 'A', '2026-06-27T10:01:00Z'),
        gen('C', 'B', '2026-06-27T10:02:00Z'),
      ], 'recent');
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('A');
      expect(sessions[0].head.id).toBe('A');
      expect(sessions[0].latest.id).toBe('C');
      expect(sessions[0].items.map((i) => i.id)).toEqual(['A', 'B', 'C']);
    });

    it('los items intra-sesion van cronologicos sin importar el sort', () => {
      const sessions = groupSessions([
        gen('C', 'B', '2026-06-27T10:02:00Z'),
        gen('A', null, '2026-06-27T10:00:00Z'),
        gen('B', 'A', '2026-06-27T10:01:00Z'),
      ], 'old');
      expect(sessions[0].items.map((i) => i.id)).toEqual(['A', 'B', 'C']);
    });

    it('ordena las sesiones por latest segun el sort', () => {
      const gens = [
        gen('A', null, '2026-06-27T10:00:00Z'),
        gen('X', null, '2026-06-27T12:00:00Z'),
      ];
      expect(groupSessions(gens, 'recent').map((s) => s.id)).toEqual(['X', 'A']);
      expect(groupSessions(gens, 'old').map((s) => s.id)).toEqual(['A', 'X']);
    });

    it('no se cuelga con un ciclo de parents', () => {
      const sessions = groupSessions([
        gen('A', 'B', '2026-06-27T10:00:00Z'),
        gen('B', 'A', '2026-06-27T10:01:00Z'),
      ], 'recent');
      expect(sessions.reduce((n, s) => n + s.items.length, 0)).toBe(2);
    });

    it('un parent fuera de la lista visible inicia su propia sesion', () => {
      const sessions = groupSessions([gen('B', 'A-ausente', '2026-06-27T10:00:00Z')], 'recent');
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('B');
    });
  });
  ```
  Comando: `pnpm test lib/library/sessions.test.ts`. Expected: FALLA al resolver `./sessions` (RED).
- [ ] **Step 2: Crear `lib/library/sessions.ts` (GREEN).** Mueve verbatim `groupSessions` + `rootOf` (orig :159-201) y agrega imports de tipos:
  ```ts
  import type { LibraryGeneration, Session, SortKey } from './types';

  export function groupSessions(gens: LibraryGeneration[], sort: SortKey): Session[] {
    const byId = new Map(gens.map((g) => [g.id, g]));
    function rootOf(g: LibraryGeneration): string {
      let cur = g;
      const visited = new Set<string>([cur.id]);
      while (cur.parentGenerationId) {
        const parent = byId.get(cur.parentGenerationId);
        if (!parent || visited.has(parent.id)) break;
        visited.add(parent.id);
        cur = parent;
      }
      return cur.id;
    }

    const map = new Map<string, LibraryGeneration[]>();
    for (const g of gens) {
      const key = rootOf(g);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    const sessions: Session[] = [];
    for (const [id, items] of map.entries()) {
      items.sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const head = items.find((i) => i.id === id) ?? items[0];
      const latest = items[items.length - 1];
      sessions.push({ id, items, head, latest });
    }
    sessions.sort((a, b) => {
      const ta = new Date(a.latest.createdAt).getTime();
      const tb = new Date(b.latest.createdAt).getTime();
      return sort === 'old' ? ta - tb : tb - ta;
    });
    return sessions;
  }
  ```
  (Conserva los comentarios originales de `groupSessions`/`rootOf` al mover.) Comando: `pnpm test lib/library/sessions.test.ts`. Expected: PASA (GREEN).
- [ ] **Step 3: Cablear `LibraryView.tsx`.** Borra `groupSessions`/`rootOf` (orig :159-201). Agrega `import { groupSessions } from '@/lib/library/sessions';`.
- [ ] **Step 4: Verificar.** Comando: `pnpm typecheck && pnpm test && pnpm build`. Expected: typecheck 0; vitest verde; build `Compiled successfully`.
- [ ] **Step 5: Commit.** Comando: `git add -A && git commit -m "refactor(library): groupSessions a lib/library/sessions.ts + test"`. Expected: commit creado.

---

### Task S2.4: Extraer IO de output a lib/library/output.ts (TDD parcial)

**Files:**
- Create: `lib/library/output.ts`
- Test: `lib/library/output.test.ts`
- Modify: `components/library/LibraryView.tsx` (reescribe `handleBulkDownload` :261-326 como llamada a `bulkDownload`; `LibTile.handleDownload` :950-964 usa `downloadOne`; agrega import)

**Interfaces:**
- Consumes: `extFromMime` de `@/lib/library/format`; `LibraryGeneration` de `@/lib/library/types`; `downloadGenerationImage` de `@/lib/media-references/download-client`; `toast` de `sonner`.
- Produces:
  - `export async function fetchOutputUrl(generationId: string): Promise<string | null>;`
  - `export async function downloadOne(generationId: string, filenameHint: string): Promise<void>;`
  - `export async function bulkDownload(selected: LibraryGeneration[]): Promise<void>;`

**Steps:**
- [ ] **Step 1: Escribir test de `fetchOutputUrl` (RED).** Crea `lib/library/output.test.ts`. Solo `fetchOutputUrl` es testeable en env node (no toca DOM/JSZip); `downloadOne`/`bulkDownload` se validan con build + smoke.
  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { fetchOutputUrl } from './output';

  afterEach(() => { vi.restoreAllMocks(); });

  describe('fetchOutputUrl', () => {
    it('devuelve outputUrl cuando la API responde ok', async () => {
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response(JSON.stringify({ outputUrl: 'https://x.supabase.co/o.png' }), { status: 200 })));
      expect(await fetchOutputUrl('gen-1')).toBe('https://x.supabase.co/o.png');
      expect(fetch).toHaveBeenCalledWith('/api/generations/gen-1', { cache: 'no-store' });
    });
    it('devuelve null si la respuesta no es ok', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
      expect(await fetchOutputUrl('gen-2')).toBeNull();
    });
    it('devuelve null si no hay outputUrl', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
      expect(await fetchOutputUrl('gen-3')).toBeNull();
    });
  });
  ```
  Comando: `pnpm test lib/library/output.test.ts`. Expected: FALLA al resolver `./output` (RED).
- [ ] **Step 2: Crear `lib/library/output.ts` (GREEN).** `fetchOutputUrl` unifica el patron `fetch('/api/generations/{id}') -> json().outputUrl` (devuelve null en !ok o sin outputUrl, compatible con los 3 call sites). `bulkDownload` mueve verbatim el cuerpo de `handleBulkDownload` (orig :262-325), parametrizando `gens.filter(g => selectedIds.has(g.id))` por `selected` y reusando `fetchOutputUrl`/`extFromMime`.
  ```ts
  'use client';

  import { toast } from 'sonner';
  import { downloadGenerationImage } from '@/lib/media-references/download-client';
  import { extFromMime } from './format';
  import type { LibraryGeneration } from './types';

  export async function fetchOutputUrl(generationId: string): Promise<string | null> {
    const res = await fetch(`/api/generations/${generationId}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { outputUrl?: string };
    return data.outputUrl ?? null;
  }

  // Descarga un unico output. Lanza si no hay output; el caller maneja el toast
  // para conservar su texto exacto.
  export async function downloadOne(generationId: string, filenameHint: string): Promise<void> {
    const url = await fetchOutputUrl(generationId);
    if (!url) throw new Error('sin output');
    await downloadGenerationImage(url, filenameHint);
  }

  // Empaqueta la seleccion en un unico .zip. El navegador bloquea descargas
  // multiples automaticas, asi que un solo zip es lo fiable. JSZip on-demand.
  export async function bulkDownload(selected: LibraryGeneration[]): Promise<void> {
    const items = selected.filter((g) => g.hasOutput);
    if (items.length === 0) {
      toast.error('Nada que descargar en la seleccion');
      return;
    }
    if (items.length === 1) {
      try {
        await downloadOne(items[0].id, `1to1-${items[0].id.slice(0, 8)}`);
      } catch {
        toast.error('No se pudo descargar');
      }
      return;
    }
    const toastId = toast.loading(`Preparando ${items.length} archivos…`);
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      let added = 0;
      for (let i = 0; i < items.length; i++) {
        const g = items[i];
        try {
          const outputUrl = await fetchOutputUrl(g.id);
          if (!outputUrl) continue;
          const fileRes = await fetch(outputUrl);
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          zip.file(
            `${String(i + 1).padStart(2, '0')}-1to1-${g.id.slice(0, 8)}.${extFromMime(blob.type)}`,
            blob,
          );
          added += 1;
        } catch {
          // saltar este archivo, seguir con el resto
        }
      }
      if (added === 0) {
        toast.error('No se pudo descargar la seleccion', { id: toastId });
        return;
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '1to1-biblioteca.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const skipped = items.length - added;
      toast.success(
        `${added} archivo${added === 1 ? '' : 's'} en un zip${skipped > 0 ? ` · ${skipped} omitido${skipped === 1 ? '' : 's'}` : ''}`,
        { id: toastId },
      );
    } catch {
      toast.error('No se pudo preparar la descarga', { id: toastId });
    }
  }
  ```
  Nota de fidelidad: la version original de `handleBulkDownload` (single-item, :268-277) hacia `fetch` directo y, ante outputUrl ausente, `throw 'sin output'` -> `catch` -> `toast.error('No se pudo descargar')` (sin punto). `downloadOne` lanza `'sin output'` y el caller toastea el mismo texto -> comportamiento identico. En `LibTile` el texto era `'No se pudo descargar.'` (con punto) -> se conserva en el caller (Step 4).
  Comando: `pnpm test lib/library/output.test.ts`. Expected: 3 tests PASAN (GREEN).
- [ ] **Step 3: Cablear `handleBulkDownload` en `LibraryView.tsx`.** Reemplaza el cuerpo completo de `handleBulkDownload` (orig :261-326) por:
  ```ts
  async function handleBulkDownload() {
    await bulkDownload(gens.filter((g) => selectedIds.has(g.id)));
  }
  ```
  Agrega al import: `import { bulkDownload, downloadOne } from '@/lib/library/output';`. Quita el import ahora muerto `downloadGenerationImage as downloadGenerationFile` (orig :25) solo si ya no quedan usos en `LibraryView.tsx` (todavia lo usa `LibTile.handleDownload` y `DetailAside.handleDownload`; mantenlo hasta extraer esos componentes — en este task NO lo borres).
- [ ] **Step 4: Cablear `LibTile.handleDownload` a `downloadOne`.** Reemplaza el cuerpo de `handleDownload` en `LibTile` (orig :950-964) por:
  ```ts
  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    if (!gen.hasOutput || downloading) return;
    setDownloading(true);
    try {
      await downloadOne(gen.id, `1to1-${gen.id.slice(0, 8)}`);
    } catch {
      toast.error('No se pudo descargar.');
    } finally {
      setDownloading(false);
    }
  }
  ```
- [ ] **Step 5: Verificar.** Comando: `pnpm typecheck && pnpm test && pnpm build`. Expected: typecheck 0; vitest verde; build `Compiled successfully`.
- [ ] **Step 6: Smoke manual.** Abrir `/app/library`, pestana Cuadricula: hover en un tile con output -> boton Descargar baja el archivo. Seleccionar 1 item -> barra inferior Descargar baja 1 archivo. Seleccionar 3 -> Descargar genera `1to1-biblioteca.zip`. Expected: descargas correctas sin error.
- [ ] **Step 7: Commit.** Comando: `git add -A && git commit -m "refactor(library): fetch/descarga de output a lib/library/output.ts + test"`. Expected: commit creado.

---

### Task S2.5: Extraer primitivos presentacionales a components/library/

**Files:**
- Create: `components/library/ToolbarButton.tsx`, `components/library/TileBtn.tsx`, `components/library/BucketHeader.tsx`, `components/library/DetailRow.tsx`, `components/library/DetailField.tsx`, `components/library/LibEmptyState.tsx`, `components/library/MiniAudioPlayer.tsx`
- Modify: `components/library/LibraryView.tsx` (borra esas 7 funciones; agrega imports)

**Interfaces:**
- Consumes: `cn` de `@/lib/utils`; `Tab` de `@/lib/library/types` (solo `LibEmptyState`); `PageEmptyState` de `@/components/ui/page-empty-state` (solo `LibEmptyState`); iconos lucide segun cada archivo.
- Produces:
  - `export function ToolbarButton(props: { icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; label: string; onClick: () => void; destructive?: boolean }): React.JSX.Element;`
  - `export function TileBtn(props: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string; busy?: boolean }): React.JSX.Element;`
  - `export function BucketHeader(props: { name: string; count: number }): React.JSX.Element;`
  - `export function DetailRow(props: { label: string; children: React.ReactNode }): React.JSX.Element;`
  - `export function DetailField(props: { label: string; value: string; mono?: boolean }): React.JSX.Element;`
  - `export function LibEmptyState(props: { tab: Tab }): React.JSX.Element;`
  - `export function MiniAudioPlayer(props: { src: string }): React.JSX.Element;`

**Steps:**
- [ ] **Step 1: Crear `ToolbarButton.tsx` y `TileBtn.tsx`.** Cada archivo: `'use client';` + imports + la funcion movida verbatim, cambiando `function X` por `export function X`.
  - `ToolbarButton.tsx`: mueve `ToolbarButton` (orig :1097-1125); import `import { cn } from '@/lib/utils';`.
  - `TileBtn.tsx`: mueve `TileBtn` (orig :1127-1149); imports `import { Loader2 } from 'lucide-react';`.
- [ ] **Step 2: Crear `BucketHeader.tsx`, `DetailRow.tsx`, `DetailField.tsx`.** Sin hooks (no requieren `'use client'`, pero agregalo igual por consistencia con CollectionsTab).
  - `BucketHeader.tsx`: mueve `BucketHeader` (orig :849-859).
  - `DetailRow.tsx`: mueve `DetailRow` (orig :1661-1676).
  - `DetailField.tsx`: mueve `DetailField` (orig :1678-1700); import `import { cn } from '@/lib/utils';`.
- [ ] **Step 3: Crear `LibEmptyState.tsx`.** Mueve `LibEmptyState` (orig :1702-1728). Imports: `import { FolderKanban, Image as ImageIcon, Library, Sparkles } from 'lucide-react';`, `import { PageEmptyState } from '@/components/ui/page-empty-state';`, `import type { Tab } from '@/lib/library/types';`.
- [ ] **Step 4: Crear `MiniAudioPlayer.tsx`.** `'use client';` + mueve `MiniAudioPlayer` (orig :1730-1835). Imports: `import { useEffect, useRef, useState } from 'react';`.
- [ ] **Step 5: Borrar las 7 funciones de `LibraryView.tsx` y agregar imports.** Elimina los bloques movidos. Agrega:
  ```ts
  import { ToolbarButton } from './ToolbarButton';
  import { BucketHeader } from './BucketHeader';
  import { DetailRow } from './DetailRow';
  import { DetailField } from './DetailField';
  import { LibEmptyState } from './LibEmptyState';
  import { MiniAudioPlayer } from './MiniAudioPlayer';
  import { TileBtn } from './TileBtn';
  ```
  (Limpia de los imports de `LibraryView.tsx` los iconos que dejaron de usarse ahi — p.ej. si `Library`/`ImageIcon` ya no aparecen fuera de `LibEmptyState`; deja los que sigan en uso por `LibHeader`/`LibTile` aun inline. Si dudas, dejalos: `tsc`/`eslint` marcaran los no usados en el Step 6.)
- [ ] **Step 6: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint sin `no-unused-vars`; build `Compiled successfully`; vitest verde.
- [ ] **Step 7: Commit.** Comando: `git add -A && git commit -m "refactor(library): primitivos presentacionales a components/library/"`. Expected: commit creado.

---

### Task S2.6: Extraer LibTile a components/library/LibTile.tsx

**Files:**
- Create: `components/library/LibTile.tsx`
- Modify: `components/library/LibraryView.tsx` (borra `LibTile` :921-1095; agrega import)

**Interfaces:**
- Consumes: `cn` (`@/lib/utils`); `LibraryGeneration` (`@/lib/library/types`); `downloadOne` (`@/lib/library/output`); `addGenerationAsReferenceAction` (`@/server-actions/media-references`); `aspectRatioToNumber` (`@/lib/library/format`); `TileBtn` (`./TileBtn`); iconos `Check, Download, ImagePlus, Music, Video as VideoIcon, Heart`; `toast` (`sonner`); `useState, useTransition` (`react`).
- Produces: `export function LibTile(props: { gen: LibraryGeneration; onClick: () => void; variantTag?: string; compact?: boolean; selected?: boolean; onToggleSelect?: () => void; isFavorite?: boolean; onToggleFav?: () => void }): React.JSX.Element;`

**Steps:**
- [ ] **Step 1: Crear `components/library/LibTile.tsx`.** `'use client';` + mueve `LibTile` (orig :921-1095) verbatim como `export function LibTile`. El cuerpo ya usa `downloadOne` (Task S2.4 Step 4) y `aspectRatioToNumber` (Task S2.2 Step 4). Imports del archivo:
  ```ts
  'use client';

  import { useState, useTransition } from 'react';
  import { toast } from 'sonner';
  import { Check, Download, Heart, ImagePlus, Music, Video as VideoIcon } from 'lucide-react';
  import { cn } from '@/lib/utils';
  import { aspectRatioToNumber } from '@/lib/library/format';
  import { downloadOne } from '@/lib/library/output';
  import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
  import type { LibraryGeneration } from '@/lib/library/types';
  import { TileBtn } from './TileBtn';
  ```
- [ ] **Step 2: Borrar `LibTile` de `LibraryView.tsx` + import.** Elimina el bloque (orig :921-1095). Agrega `import { LibTile } from './LibTile';`.
- [ ] **Step 3: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint limpio; build OK; vitest verde.
- [ ] **Step 4: Smoke manual.** `/app/library` Cuadricula: hover en tile -> aparecen Descargar y (solo imagen) "Usar como referencia"; clic en estrella togglea favorito; en seleccion (estado done) aparece el checkbox. Expected: igual que antes.
- [ ] **Step 5: Commit.** Comando: `git add -A && git commit -m "refactor(library): LibTile a archivo propio"`. Expected: commit creado.

---

### Task S2.7: Extraer SessionsTab/SessionCard y GridTab

**Files:**
- Create: `components/library/SessionsTab.tsx` (incluye `SessionCard`), `components/library/GridTab.tsx`
- Modify: `components/library/LibraryView.tsx` (borra `SessionsTab` :762-801, `SessionCard` :861-919, `GridTab` :803-846; agrega imports)

**Interfaces:**
- Consumes: `Session`, `LibraryGeneration` (`@/lib/library/types`); `bucketOf`, `modelLabel`, `shortTime`, `batchLabel` (`@/lib/library/format`); `LibTile` (`./LibTile`), `BucketHeader` (`./BucketHeader`), `LibEmptyState` (`./LibEmptyState`); `cn` (`@/lib/utils`); `useMemo` (`react`).
- Produces:
  - `export function SessionsTab(props: { sessions: Session[]; onOpen: (id: string) => void; favIds: Set<string>; onToggleFav: (id: string) => void }): React.JSX.Element;`
  - `export function GridTab(props: { items: LibraryGeneration[]; onOpen: (id: string) => void; selectedIds: Set<string>; onToggleSelect: (id: string) => void; favIds: Set<string>; onToggleFav: (id: string) => void }): React.JSX.Element;`

**Steps:**
- [ ] **Step 1: Crear `SessionsTab.tsx`.** `'use client';` + mueve `SessionsTab` (orig :762-801) y `SessionCard` (orig :861-919) al mismo archivo (`SessionCard` queda local, no exportado). Imports:
  ```ts
  'use client';

  import { useMemo } from 'react';
  import { cn } from '@/lib/utils';
  import { bucketOf, modelLabel, shortTime } from '@/lib/library/format';
  import type { LibraryGeneration, Session } from '@/lib/library/types';
  import { BucketHeader } from './BucketHeader';
  import { LibEmptyState } from './LibEmptyState';
  import { LibTile } from './LibTile';
  ```
  (`SessionCard` usa `LibraryGeneration` solo via `Session`; deja el import de `Session` y agrega `LibraryGeneration` si `tsc` lo pide.)
- [ ] **Step 2: Crear `GridTab.tsx`.** `'use client';` + mueve `GridTab` (orig :803-846). Imports:
  ```ts
  'use client';

  import { useMemo } from 'react';
  import { batchLabel, bucketOf } from '@/lib/library/format';
  import type { LibraryGeneration } from '@/lib/library/types';
  import { BucketHeader } from './BucketHeader';
  import { LibEmptyState } from './LibEmptyState';
  import { LibTile } from './LibTile';
  ```
- [ ] **Step 3: Borrar de `LibraryView.tsx` + imports.** Elimina `SessionsTab`, `SessionCard`, `GridTab`. Agrega:
  ```ts
  import { SessionsTab } from './SessionsTab';
  import { GridTab } from './GridTab';
  ```
- [ ] **Step 4: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint limpio; build OK; vitest verde.
- [ ] **Step 5: Smoke manual.** `/app/library`: pestana Sesiones agrupa por bucket (Hoy/Ayer/…) y muestra cards con variaciones v1, v2…; pestana Cuadricula muestra grid con badges de batch. Vacio -> empty state correcto. Expected: igual que antes.
- [ ] **Step 6: Commit.** Comando: `git add -A && git commit -m "refactor(library): SessionsTab/SessionCard y GridTab a archivos propios"`. Expected: commit creado.

---

### Task S2.8: Extraer LibHeader (+ TABS) a components/library/LibHeader.tsx

**Files:**
- Create: `components/library/LibHeader.tsx`
- Modify: `components/library/LibraryView.tsx` (borra `TABS` :63-67 y `LibHeader` :642-760; agrega import)

**Interfaces:**
- Consumes: `Tab`, `SortKey` (`@/lib/library/types`); `cn` (`@/lib/utils`); `Link` (`next/link`); `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` (`@/components/ui/select`); iconos `FolderKanban, Heart, Image as ImageIcon, Library, Search, Sparkles`.
- Produces: `export function LibHeader(props: { tab: Tab; setTab: (t: Tab) => void; query: string; setQuery: (q: string) => void; sort: SortKey; setSort: (s: SortKey) => void; totalImages: number; totalSessions: number; workspaceName: string; showFavOnly: boolean; setShowFavOnly: (v: boolean) => void; favCount: number }): React.JSX.Element;`

**Steps:**
- [ ] **Step 1: Crear `LibHeader.tsx`.** `'use client';` + mueve `TABS` (orig :63-67, queda local al archivo, no exportado) y `LibHeader` (orig :642-760). Imports:
  ```ts
  'use client';

  import Link from 'next/link';
  import { FolderKanban, Heart, Image as ImageIcon, Library, Search, Sparkles } from 'lucide-react';
  import { cn } from '@/lib/utils';
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
  import type { SortKey, Tab } from '@/lib/library/types';

  const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[] = [
    { id: 'sessions', label: 'Sesiones', icon: Library },
    { id: 'grid', label: 'Cuadrícula', icon: ImageIcon },
    { id: 'collections', label: 'Colecciones', icon: FolderKanban },
  ];
  ```
- [ ] **Step 2: Borrar `TABS` + `LibHeader` de `LibraryView.tsx` + import.** Elimina ambos bloques. Agrega `import { LibHeader } from './LibHeader';`. Limpia de los imports de `LibraryView.tsx` los iconos/`Select*` que ya no use directamente (los marcara el lint).
- [ ] **Step 3: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint limpio; build OK; vitest verde.
- [ ] **Step 4: Smoke manual.** `/app/library`: cambiar entre tabs, escribir en busqueda (filtra por prompt/modelo), cambiar sort recientes/antiguos, togglear filtro de favoritos (badge con count). Header muestra "N imagenes · M sesiones · ordenado por … · workspace". Expected: igual.
- [ ] **Step 5: Commit.** Comando: `git add -A && git commit -m "refactor(library): LibHeader a archivo propio"`. Expected: commit creado.

---

### Task S2.9: Extraer CompareModal y AssignCollectionDialog

**Files:**
- Create: `components/library/CompareModal.tsx`, `components/library/AssignCollectionDialog.tsx`
- Modify: `components/library/LibraryView.tsx` (borra `AssignCollectionDialog` :527-601 y `CompareModal` :604-640; agrega imports)

**Interfaces:**
- Consumes: `LibraryGeneration` (`@/lib/library/types`); `CAMPAIGN_NONE`, `modelLabel` (`@/lib/library/format`); `listCampaignsAction` (`@/server-actions/campaigns`); `Dialog*` (`@/components/ui/dialog`), `Select*` (`@/components/ui/select`); `cn` (`@/lib/utils`); `Loader2` (lucide); `useEffect, useState` (react).
- Produces:
  - `export function CompareModal(props: { generations: LibraryGeneration[]; onClose: () => void }): React.JSX.Element;`
  - `export function AssignCollectionDialog(props: { count: number; onAssign: (campaignId: string | null) => Promise<void>; onClose: () => void }): React.JSX.Element;`

**Steps:**
- [ ] **Step 1: Crear `CompareModal.tsx`.** `'use client';` + mueve `CompareModal` (orig :604-640). Imports: `cn` (`@/lib/utils`), `modelLabel` (`@/lib/library/format`), `LibraryGeneration` (`@/lib/library/types`), `Dialog, DialogContent, DialogHeader, DialogTitle` (`@/components/ui/dialog`).
- [ ] **Step 2: Crear `AssignCollectionDialog.tsx`.** `'use client';` + mueve `AssignCollectionDialog` (orig :527-601). Imports: `useEffect, useState` (react), `Loader2` (lucide), `CAMPAIGN_NONE` (`@/lib/library/format`), `listCampaignsAction` (`@/server-actions/campaigns`), `Dialog*` (`@/components/ui/dialog`), `Select*` (`@/components/ui/select`).
- [ ] **Step 3: Borrar ambas de `LibraryView.tsx` + imports.** Elimina los bloques. Agrega:
  ```ts
  import { CompareModal } from './CompareModal';
  import { AssignCollectionDialog } from './AssignCollectionDialog';
  ```
- [ ] **Step 4: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint limpio; build OK; vitest verde.
- [ ] **Step 5: Smoke manual.** `/app/library` Cuadricula: seleccionar 2-4 items -> "Comparar" abre el modal A/B con previews + prompt + modelo. Seleccionar N -> "Asignar" abre el dialogo, elegir coleccion -> toast de asignados; "Sin coleccion (quitar)" remueve. Expected: igual.
- [ ] **Step 6: Commit.** Comando: `git add -A && git commit -m "refactor(library): CompareModal y AssignCollectionDialog a archivos propios"`. Expected: commit creado.

---

### Task S2.10: Extraer CampaignAssigner y SavePresetButton

**Files:**
- Create: `components/library/CampaignAssigner.tsx`, `components/library/SavePresetButton.tsx`
- Modify: `components/library/LibraryView.tsx` (borra `CampaignAssigner` :1523-1568 y `SavePresetButton` :1570-1659; agrega imports)

**Interfaces:**
- Consumes: `LibraryGeneration` (`@/lib/library/types`); `CAMPAIGN_NONE` (`@/lib/library/format`); `assignCampaignAction, listCampaignsAction` (`@/server-actions/campaigns`); `savePresetAction` (`@/server-actions/presets`); `Select*` (`@/components/ui/select`), `Switch` (`@/components/ui/switch`); `Bookmark, FolderKanban, Loader2` (lucide); `toast` (sonner); `useEffect, useState, useTransition` (react).
- Produces:
  - `export function CampaignAssigner(props: { generation: LibraryGeneration }): React.JSX.Element | null;`
  - `export function SavePresetButton(props: { generation: LibraryGeneration }): React.JSX.Element;`

**Steps:**
- [ ] **Step 1: Crear `CampaignAssigner.tsx`.** `'use client';` + mueve `CampaignAssigner` (orig :1523-1568). Imports: `useEffect, useState, useTransition` (react), `FolderKanban` (lucide), `toast` (sonner), `CAMPAIGN_NONE` (`@/lib/library/format`), `assignCampaignAction, listCampaignsAction` (`@/server-actions/campaigns`), `Select*` (`@/components/ui/select`), `LibraryGeneration` (`@/lib/library/types`).
- [ ] **Step 2: Crear `SavePresetButton.tsx`.** `'use client';` + mueve `SavePresetButton` (orig :1570-1659). Imports: `useState, useTransition` (react), `Bookmark, Loader2` (lucide), `toast` (sonner), `savePresetAction` (`@/server-actions/presets`), `Switch` (`@/components/ui/switch`), `LibraryGeneration` (`@/lib/library/types`).
- [ ] **Step 3: Borrar ambas de `LibraryView.tsx` + imports.** Elimina los bloques. Agrega:
  ```ts
  import { CampaignAssigner } from './CampaignAssigner';
  import { SavePresetButton } from './SavePresetButton';
  ```
  Estos dos solo los usa `DetailAside`, que aun vive en `LibraryView.tsx` en este task (se extrae en S2.11). El import queda valido.
- [ ] **Step 4: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint limpio; build OK; vitest verde.
- [ ] **Step 5: Smoke manual.** `/app/library`: abrir el detalle de una imagen `done` -> "Guardar como preset" abre el form (nombre/descripcion/switch publico) y guarda; el selector "Coleccion" lista campañas y asigna/quita. Expected: igual.
- [ ] **Step 6: Commit.** Comando: `git add -A && git commit -m "refactor(library): CampaignAssigner y SavePresetButton a archivos propios"`. Expected: commit creado.

---

### Task S2.11: Extraer DetailAside (+ DetailMediaPreview, DetailActions, DetailHistory)

**Files:**
- Create: `components/library/DetailMediaPreview.tsx`, `components/library/DetailActions.tsx`, `components/library/DetailHistory.tsx`, `components/library/DetailAside.tsx`
- Modify: `components/library/LibraryView.tsx` (borra `DetailAside` :1152-1521; agrega import; elimina imports ya muertos)

**Interfaces:**
- Consumes: `LibraryGeneration` (`@/lib/library/types`); `aspectRatioToNumber`, `batchLabel`, `modelLabel`, `reuseHref`, `shortTime` (`@/lib/library/format`); `downloadGenerationImage` (`@/lib/media-references/download-client`); `addGenerationAsReferenceAction` (`@/server-actions/media-references`); `DetailRow`, `DetailField`, `MiniAudioPlayer`, `CampaignAssigner`, `SavePresetButton` (`./*`); `cn` (`@/lib/utils`); `Link` (next/link); iconos `Copy, Download, Heart, ImagePlus, Loader2, Music, RotateCcw, Trash2, X`; `useEffect, useState, useTransition` (react); `toast` (sonner).
- Produces:
  - `export function DetailAside(props: { generation: LibraryGeneration; allGenerations: LibraryGeneration[]; onClose: () => void; onNavigate: (id: string) => void; isFavorite: boolean; onToggleFav: (id: string) => void; onDelete: () => void }): React.JSX.Element;`
  - `export function DetailMediaPreview(props: { generation: LibraryGeneration; outputUrl: string | null; loading: boolean; ratio: number }): React.JSX.Element;`
  - `export function DetailActions(props: { generation: LibraryGeneration; outputUrl: string | null; isFavorite: boolean; onToggleFav: (id: string) => void; onDownload: () => void; downloading: boolean; onUseAsRef: () => void; addingRef: boolean; onDelete: () => void }): React.JSX.Element;`
  - `export function DetailHistory(props: { generation: LibraryGeneration; allGenerations: LibraryGeneration[]; onNavigate: (id: string) => void }): React.JSX.Element | null;`

**Steps:**
- [ ] **Step 1: Crear `DetailMediaPreview.tsx`.** `'use client';` + extrae el bloque de preview de media de `DetailAside` (orig :1262-1357: el `generation.type === 'audio' ? … : 'video' ? … : (imagen) …` que incluye loaders, `MiniAudioPlayer`, video y `img`). Props: `{ generation, outputUrl, loading, ratio }`. Imports: `Loader2, Music` (lucide), `modelLabel, shortTime` (`@/lib/library/format`), `MiniAudioPlayer` (`./MiniAudioPlayer`), `LibraryGeneration` (`@/lib/library/types`). El JSX devuelto es el contenedor del media (los 3 ramos del condicional).
- [ ] **Step 2: Crear `DetailActions.tsx`.** `'use client';` + extrae el bloque de botones de accion (orig :1368-1420: Reusar prompt NO — ese se queda fuera; mover el `div` de acciones favorito/descargar/usar-ref/preset/eliminar de :1368-1420). Props segun firma arriba. Imports: `Download, Heart, ImagePlus, Loader2, Trash2` (lucide), `cn` (`@/lib/utils`), `SavePresetButton` (`./SavePresetButton`), `LibraryGeneration` (`@/lib/library/types`). (El boton "Reusar prompt" :1359-1366 y el bloque "Prompt" con copiar :1422-1437 se quedan inline en `DetailAside`.)
- [ ] **Step 3: Crear `DetailHistory.tsx`.** `'use client';` + extrae la IIFE de Historial (orig :1455-1517) como componente con props `{ generation, allGenerations, onNavigate }`; devuelve `null` cuando no hay parent/children/siblings (misma guarda). Imports: `batchLabel` (`@/lib/library/format`), `LibraryGeneration` (`@/lib/library/types`).
- [ ] **Step 4: Crear `DetailAside.tsx`.** `'use client';` + mueve el resto de `DetailAside` (orig :1152-1521): el `useEffect` de fetch de output (usa `fetchOutputUrl`? NO — conserva el fetch inline original :1178-1182 con guarda `r.ok`, identico), el `useEffect` de Escape, `ratio = aspectRatioToNumber(generation.aspectRatio)`, `handleDownload`/`handleUseAsRef`/`handleCopyPrompt`, y el `return` componiendo header + `DetailMediaPreview` + boton Reusar prompt + `DetailActions` + bloque Prompt (`DetailRow` + copiar) + los `DetailField` (orig :1439-1451) + `CampaignAssigner` + `DetailHistory`. Imports: `useEffect, useState, useTransition` (react), `Link` (next/link), `Copy, Download, Loader2, RotateCcw, X` (lucide), `toast` (sonner), `cn` (`@/lib/utils`), `aspectRatioToNumber, modelLabel, reuseHref, shortTime` (`@/lib/library/format`), `downloadGenerationImage` (`@/lib/media-references/download-client`), `addGenerationAsReferenceAction` (`@/server-actions/media-references`), `LibraryGeneration` (`@/lib/library/types`), y `./DetailMediaPreview`, `./DetailActions`, `./DetailHistory`, `./DetailRow`, `./DetailField`, `./CampaignAssigner`. `handleDownload` mantiene su `toast.error('No se pudo descargar.')` exacto.
- [ ] **Step 5: Borrar `DetailAside` de `LibraryView.tsx` + import.** Elimina el bloque (orig :1152-1521). Agrega `import { DetailAside } from './DetailAside';`. Ahora `LibraryView.tsx` ya no usa directamente `DetailRow`, `DetailField`, `MiniAudioPlayer`, `CampaignAssigner`, `SavePresetButton`, `downloadGenerationImage`, ni varios iconos -> elimina esos imports muertos (el lint del Step 6 los marca uno a uno).
- [ ] **Step 6: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint sin imports sin usar; build `Compiled successfully`; vitest verde.
- [ ] **Step 7: Smoke manual.** `/app/library`: abrir detalle de imagen, video y audio -> preview correcto (loader -> media), boton Reusar prompt, favorito, Descargar, Usar como referencia (solo imagen done), Guardar preset, Eliminar; bloque Prompt con Copiar; campos Modelo/Aspecto/Estado/Creditos/Generado/ID; Historial con Padre/Batch/Derivadas navegables; Esc cierra; backdrop movil cierra. Expected: identico al actual.
- [ ] **Step 8: Commit.** Comando: `git add -A && git commit -m "refactor(library): DetailAside + DetailMediaPreview/DetailActions/DetailHistory a archivos propios"`. Expected: commit creado.

---

### Task S2.12: Extraer hooks useFavorites y useBulkSelection

**Files:**
- Create: `lib/library/use-favorites.ts`, `lib/library/use-bulk-selection.ts`
- Modify: `components/library/LibraryView.tsx` (reemplaza estado/handlers de favoritos y seleccion por los hooks)

**Interfaces:**
- Consumes: `toggleFavoriteAction` (`@/server-actions/favorites`); `toast` (sonner); `useState` (react).
- Produces:
  - `export function useFavorites(initialFavoriteIds: string[]): { favIds: Set<string>; showFavOnly: boolean; setShowFavOnly: (v: boolean) => void; toggleFav: (id: string) => void };`
  - `export function useBulkSelection(): { selectedIds: Set<string>; toggleSelect: (id: string) => void; clear: () => void; showCompare: boolean; setShowCompare: (v: boolean) => void; showAssign: boolean; setShowAssign: (v: boolean) => void };`

**Steps:**
- [ ] **Step 1: Crear `lib/library/use-favorites.ts`.** Mueve el estado `favIds`/`showFavOnly` (orig :221-222) y `handleToggleFav` (orig :346-375, renombrado `toggleFav`):
  ```ts
  'use client';

  import { useState } from 'react';
  import { toast } from 'sonner';
  import { toggleFavoriteAction } from '@/server-actions/favorites';

  export function useFavorites(initialFavoriteIds: string[]) {
    const [favIds, setFavIds] = useState<Set<string>>(() => new Set(initialFavoriteIds));
    const [showFavOnly, setShowFavOnly] = useState(false);

    function toggleFav(id: string) {
      const wasFav = favIds.has(id);
      setFavIds((prev) => {
        const next = new Set(prev);
        if (wasFav) next.delete(id);
        else next.add(id);
        return next;
      });
      toggleFavoriteAction(id)
        .then((res) => {
          if (!res.ok) {
            toast.error(res.message || 'Error al actualizar favorito');
            setFavIds((prev) => {
              const next = new Set(prev);
              if (wasFav) next.add(id);
              else next.delete(id);
              return next;
            });
          }
        })
        .catch(() => {
          toast.error('Error al actualizar favorito');
          setFavIds((prev) => {
            const next = new Set(prev);
            if (wasFav) next.add(id);
            else next.delete(id);
            return next;
          });
        });
    }

    return { favIds, showFavOnly, setShowFavOnly, toggleFav };
  }
  ```
- [ ] **Step 2: Crear `lib/library/use-bulk-selection.ts`.** Mueve `selectedIds`/`showCompare`/`showAssign` (orig :218-220) y `toggleSelect` (orig :377-384), mas `clear`:
  ```ts
  'use client';

  import { useState } from 'react';

  export function useBulkSelection() {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showCompare, setShowCompare] = useState(false);
    const [showAssign, setShowAssign] = useState(false);

    function toggleSelect(id: string) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < 50) next.add(id);
        return next;
      });
    }

    function clear() {
      setSelectedIds(new Set());
    }

    return { selectedIds, toggleSelect, clear, showCompare, setShowCompare, showAssign, setShowAssign };
  }
  ```
- [ ] **Step 3: Cablear `LibraryView.tsx`.** Borra el estado/handlers movidos (orig :218-222 de seleccion+fav, `handleToggleFav` :346-375, `toggleSelect` :377-384). Agrega cerca del tope del componente:
  ```ts
  const { favIds, showFavOnly, setShowFavOnly, toggleFav: handleToggleFav } = useFavorites(initialFavoriteIds);
  const { selectedIds, toggleSelect, clear: clearSelection, showCompare, setShowCompare, showAssign, setShowAssign } = useBulkSelection();
  ```
  Sustituye en `LibraryView`: las llamadas `setSelectedIds(new Set())` (orig :480, :514) por `clearSelection()`. En `removeGens` (orig :234-239) reemplaza `setSelectedIds(new Set())` por `clearSelection()`. Agrega imports:
  ```ts
  import { useFavorites } from '@/lib/library/use-favorites';
  import { useBulkSelection } from '@/lib/library/use-bulk-selection';
  ```
- [ ] **Step 4: Verificar.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint limpio; build OK; vitest verde.
- [ ] **Step 5: Smoke manual.** `/app/library`: togglear favoritos (optimista, con rollback si falla), filtro "solo favoritos"; seleccionar/deseleccionar items (tope 50), abrir Comparar/Asignar, limpiar seleccion (X). Expected: identico.
- [ ] **Step 6: Commit.** Comando: `git add -A && git commit -m "refactor(library): hooks useFavorites y useBulkSelection"`. Expected: commit creado.

---

### Task S2.13: Extraer useLibraryItems, adelgazar LibraryView y verificacion final

**Files:**
- Create: `lib/library/use-library-items.ts`
- Modify: `components/library/LibraryView.tsx` (reemplaza estado gens/derivaciones por el hook; queda como orquestador ~180-200 lineas)

**Interfaces:**
- Consumes: `LibraryGeneration`, `SortKey`, `Session` (`@/lib/library/types`); `groupSessions` (`@/lib/library/sessions`); `modelLabel` (`@/lib/library/format`); `useMemo, useState` (react).
- Produces:
  - `export function useLibraryItems(generations: LibraryGeneration[], opts: { query: string; sort: SortKey; showFavOnly: boolean; favIds: Set<string> }): { gens: LibraryGeneration[]; setGens: React.Dispatch<React.SetStateAction<LibraryGeneration[]>>; filteredGens: LibraryGeneration[]; sessions: Session[] };`

**Steps:**
- [ ] **Step 1: Crear `lib/library/use-library-items.ts`.** Mueve el estado `gens`/`prevInitial` + sync (orig :227-232), el memo `filteredGens` (orig :386-406) y el memo `sessions` (orig :408):
  ```ts
  'use client';

  import { useMemo, useState } from 'react';
  import { modelLabel } from '@/lib/library/format';
  import { groupSessions } from '@/lib/library/sessions';
  import type { LibraryGeneration, Session, SortKey } from '@/lib/library/types';

  export function useLibraryItems(
    generations: LibraryGeneration[],
    opts: { query: string; sort: SortKey; showFavOnly: boolean; favIds: Set<string> },
  ): {
    gens: LibraryGeneration[];
    setGens: React.Dispatch<React.SetStateAction<LibraryGeneration[]>>;
    filteredGens: LibraryGeneration[];
    sessions: Session[];
  } {
    const { query, sort, showFavOnly, favIds } = opts;
    const [gens, setGens] = useState(generations);
    const [prevInitial, setPrevInitial] = useState(generations);
    if (prevInitial !== generations) {
      setPrevInitial(generations);
      setGens(generations);
    }

    const filteredGens = useMemo(() => {
      const needle = query.trim().toLowerCase();
      let list = gens;
      if (showFavOnly) list = list.filter((g) => favIds.has(g.id));
      if (needle) {
        list = list.filter(
          (g) =>
            g.prompt.toLowerCase().includes(needle) ||
            modelLabel(g).toLowerCase().includes(needle),
        );
      }
      if (sort === 'old') {
        list = [...list].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      }
      return list;
    }, [gens, query, sort, showFavOnly, favIds]);

    const sessions = useMemo(() => groupSessions(filteredGens, sort), [filteredGens, sort]);

    return { gens, setGens, filteredGens, sessions };
  }
  ```
- [ ] **Step 2: Cablear `LibraryView.tsx`.** Borra el estado `gens`/`prevInitial` + sync (orig :227-232), `filteredGens` (orig :386-406), `sessions` (orig :408). Agrega:
  ```ts
  const { gens, setGens, filteredGens, sessions } = useLibraryItems(generations, { query, sort, showFavOnly, favIds });
  ```
  `removeGens` queda en `LibraryView` y usa `setGens` del hook:
  ```ts
  function removeGens(ids: string[]) {
    const set = new Set(ids);
    setGens((prev) => prev.filter((g) => !set.has(g.id)));
    clearSelection();
    if (activeId && set.has(activeId)) setActiveId(null);
  }
  ```
  Agrega `import { useLibraryItems } from '@/lib/library/use-library-items';`.
- [ ] **Step 3: Confirmar el orden de hooks/estado en `LibraryView`.** El componente debe declarar, en este orden: `tab`/`query`/`sort`/`activeId` (`useState`), `router`/`confirm`, `useFavorites`, `useBulkSelection`, `useLibraryItems(generations, { query, sort, showFavOnly, favIds })`, `active = useMemo(() => gens.find(...) , [gens, activeId])` (orig :409-412). Verifica que ningun hook quede condicional.
- [ ] **Step 4: Verificacion final completa.** Comando: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`. Expected: typecheck 0; lint sin warnings de no usados; build `Compiled successfully`; vitest TODA la suite verde (incluye `format.test.ts`, `sessions.test.ts`, `output.test.ts`). (Recordatorio: ningun archivo de la unidad es `'use server'`, asi que el gotcha de export-de-objetos no aplica; aun asi el `build` es obligatorio porque valida fronteras RSC que `typecheck` no ve.)
- [ ] **Step 5: Confirmar el tamaño objetivo.** Comando: `wc -l components/library/LibraryView.tsx`. Expected: ~180-200 lineas (desde 1835). Si quedara muy por encima, revisar imports muertos restantes.
- [ ] **Step 6: Smoke manual integral.** `/app/library`: recorrer Sesiones, Cuadricula, Colecciones; busqueda + sort + filtro fav; abrir detalle (imagen/video/audio) y todas sus acciones; seleccion multiple -> Asignar/Descargar(zip)/Comparar/Eliminar; borrado individual desde el detalle; `router.refresh()` tras operaciones. Expected: comportamiento identico al de antes del refactor.
- [ ] **Step 7: Commit.** Comando: `git add -A && git commit -m "refactor(library): hook useLibraryItems y LibraryView como orquestador delgado"`. Expected: commit creado.
### Unidad S3: ControlsPanel (805) + VideoControlsPanel (738) -> dedup + sub-componentes

**Objetivo.** Deduplicar los dos paneles de controles (imagen y video) extrayendo el andamiaje compartido, los primitivos de UI repetidos y la lógica de capacidades de modelo de video a módulos reutilizables, sin cambiar una sola pixel del comportamiento observable. El refactor es de movimiento/extracción: la red de seguridad es `pnpm typecheck && pnpm build && pnpm test` verde tras cada task, más un smoke manual en las dos pantallas de creación. La única lógica genuinamente pura que se extrae —la matriz de capacidades por modelo y el clamp de opciones de `handleModelChange`— se cubre con un test de caracterización vitest (TDD real). Se consume la fuente única de slugs/labels de Ola 1 (`lib/generation/models.ts`: `VideoModelKey`, `VIDEO_MODEL_LABEL`).

**Nota sobre el gotcha 'use server'.** Esta unidad NO toca ningún archivo `'use server'`. Los dos paneles y todos los sub-componentes son `'use client'`; el único server-action involucrado (`server-actions/prompt-enhancer.ts`) solo se **consume** (se importa `enhancePromptAction`), no se modifica. Por lo tanto el gotcha de exportar objetos desde `'use server'` no aplica. Aun así, cada task que cambia un tipo re-exportado a través del límite cliente/servidor termina con `pnpm build` como verificación de integración (typecheck no siempre ve roturas de re-export en el bundle).

**Decisión de alcance vs. audit.** El audit propone "extender `EnhanceButton` con `hint?` y eliminar la reimplementación dentro de `PromptArea`". Las dos implementaciones de enhance tienen UI distinta (ubicación del botón, toast de éxito, tarjeta de sugerencia con estilos diferentes y mapeo de error con 4 ramas vs. 2). Para mantener comportamiento IDÉNTICO no se puede reemplazar `PromptArea` por `EnhanceButton`. En su lugar se extrae el **hook compartido** `lib/generation/use-prompt-enhance.ts` con la lógica duplicada (ref anti-doble-click + `useTransition` + `canEnhance` + dispatch), y cada caller conserva sus callbacks/toasts exactos. No se añade `hint?` a `EnhanceButton`.

#### File Structure

Nuevos:
- `lib/generation/video-models.ts` — función pura `videoModelCapabilities(model)` (matriz de capacidades: isVeo/isSeedance/isKling, supportsImages, maxImages, aspectRatios, maxResolution) y `reconcileVideoOptions(next, current)` (reducer puro del clamp de `handleModelChange`). Define y exporta `VideoAspectRatio` y `SeedanceResolutionUi`. Consume `VideoModelKey` de Ola 1.
- `lib/generation/video-models.test.ts` — caracterización vitest de las dos funciones puras.
- `components/generation/ControlsShell.tsx` — andamiaje compartido (`border-r` + header `CreateModeTabs` + área scroll + slot `footer`) usado por ambos paneles.
- `components/generation/OptionButton.tsx` — botón de opción con estados active/locked (los 4 grupos de pickers de video).
- `components/generation/video/SeedanceDurationQuality.tsx` — Paso 2 (rama Seedance: slider de duración + resolución + seed).
- `components/generation/video/VeoDurationQuality.tsx` — Paso 2 (rama Veo: duración + resolución).
- `components/generation/video/KlingDurationQuality.tsx` — Paso 2 (rama Kling: slider de duración).
- `components/generation/video/VideoAspectPicker.tsx` — Paso 3 (proporción).
- `components/generation/video/AudioToggle.tsx` — Paso 5 (audio por proveedor).
- `components/generation/video/ReferenceImagesPanel.tsx` — Paso 4 (imágenes de referencia: toggle, upload, preview, remove; mueve `handleFile`/`removeRef`/`uploading`/`useRefImages`/`fileRef`).
- `lib/generation/use-prompt-enhance.ts` — hook cliente con la lógica de enhance compartida por `PromptArea` y `EnhanceButton`.

Modificados:
- `components/generation/VideoControlsPanel.tsx` — adopta capabilities/reconcile, `ControlsShell`, `OptionButton` y los sub-componentes; pasa a usar `VideoModelKey` de Ola 1; queda como composición de Steps.
- `components/generation/ControlsPanel.tsx` — adopta `ControlsShell`, el hook de enhance, y renombra `ModelKey`→`ImageModelKey`.
- `components/generation/types.ts` — renombra `ModelKey`→`ImageModelKey`.
- `components/generation/ImageGenerator.tsx` — consume `ImageModelKey`.
- `components/generation/EnhanceButton.tsx` — adopta el hook compartido.
- `lib/generation/video-meta.ts` — elimina `MODEL_LABEL` (vive en Ola 1) y deja `estimateVideoEta` tipado con `VideoModelKey`.
- `components/generation/VideoPreview.tsx` — consume `VideoModelKey` + `VIDEO_MODEL_LABEL` de Ola 1.
- `components/generation/VideoGenerator.tsx` — consume `VideoModelKey` de Ola 1.

---

### Task S3.1: `lib/generation/video-models.ts` puro + test de caracterización

**Files:**
- Create `lib/generation/video-models.ts`
- Create (Test) `lib/generation/video-models.test.ts`

**Interfaces:**
- Consumes (Ola 1): `import type { VideoModelKey } from '@/lib/generation/models';`
- Produces:
  ```ts
  export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  export type SeedanceResolutionUi = '480p' | '720p' | '1080p';
  export type VideoModelCapabilities = {
    isVeo: boolean;
    isSeedance: boolean;
    isKling: boolean;
    supportsImages: boolean;
    maxImages: number;
    aspectRatios: readonly VideoAspectRatio[];
    maxResolution: SeedanceResolutionUi;
  };
  export function videoModelCapabilities(model: VideoModelKey): VideoModelCapabilities;
  export type VideoOptionsPlan = {
    aspectRatio: VideoAspectRatio;
    seedanceResolution: SeedanceResolutionUi;
    clearSeedanceRefs: boolean;
    clearReferenceImages: boolean;
    resetUseRefImages: boolean;
    trimReferenceImagesTo: number | null;
  };
  export function reconcileVideoOptions(
    next: VideoModelKey,
    current: {
      aspectRatio: VideoAspectRatio;
      seedanceResolution: SeedanceResolutionUi;
      seedanceRefsCount: number;
      referenceImagesCount: number;
    },
  ): VideoOptionsPlan;
  ```

**Steps:**

- [ ] **Step 1: Escribir el test de caracterización primero (debe fallar: el módulo no existe).** Crear `lib/generation/video-models.test.ts` con los casos derivados del comportamiento ACTUAL de `handleModelChange` (VideoControlsPanel.tsx:161-195) y de las derivaciones de render (líneas 108-120):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { videoModelCapabilities, reconcileVideoOptions } from './video-models';

  describe('videoModelCapabilities', () => {
    it('veo fast: 1 imagen, sin soporte de imágenes, ratios 16:9/9:16, max 1080p', () => {
      const c = videoModelCapabilities('veo-3.1-fast-generate-preview');
      expect(c).toMatchObject({
        isVeo: true, isSeedance: false, isKling: false,
        supportsImages: false, maxImages: 1, maxResolution: '1080p',
      });
      expect([...c.aspectRatios]).toEqual(['16:9', '9:16']);
    });
    it('veo standard: soporta imágenes', () => {
      expect(videoModelCapabilities('veo-3.1-generate-preview').supportsImages).toBe(true);
    });
    it('seedance fast: max 720p, 6 ratios, sin soporte de imágenes', () => {
      const c = videoModelCapabilities('seedance-2.0-fast');
      expect(c.isSeedance).toBe(true);
      expect(c.maxResolution).toBe('720p');
      expect(c.supportsImages).toBe(false);
      expect([...c.aspectRatios]).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
    });
    it('seedance estándar: max 1080p', () => {
      expect(videoModelCapabilities('seedance-2.0').maxResolution).toBe('1080p');
    });
    it('kling: soporta imágenes, 2 imágenes, ratios 16:9/9:16/1:1', () => {
      const c = videoModelCapabilities('fal-ai/kling-video/v3/standard/text-to-video');
      expect(c).toMatchObject({ isKling: true, supportsImages: true, maxImages: 2 });
      expect([...c.aspectRatios]).toEqual(['16:9', '9:16', '1:1']);
    });
  });

  describe('reconcileVideoOptions', () => {
    const base = { aspectRatio: '1:1' as const, seedanceResolution: '1080p' as const, seedanceRefsCount: 0, referenceImagesCount: 0 };
    it('a veo: clampa ratio 1:1 -> 16:9', () => {
      expect(reconcileVideoOptions('veo-3.1-fast-generate-preview', base).aspectRatio).toBe('16:9');
    });
    it('a veo con ratio 9:16: lo conserva', () => {
      expect(reconcileVideoOptions('veo-3.1-fast-generate-preview', { ...base, aspectRatio: '9:16' }).aspectRatio).toBe('9:16');
    });
    it('a veo sin soporte de imágenes con 2 imágenes: las limpia y resetea el toggle', () => {
      const p = reconcileVideoOptions('veo-3.1-fast-generate-preview', { ...base, referenceImagesCount: 2 });
      expect(p.clearReferenceImages).toBe(true);
      expect(p.resetUseRefImages).toBe(true);
      expect(p.trimReferenceImagesTo).toBeNull();
    });
    it('a veo standard (soporta 1 imagen) con 2 imágenes: recorta a 1, no limpia', () => {
      const p = reconcileVideoOptions('veo-3.1-generate-preview', { ...base, aspectRatio: '16:9', referenceImagesCount: 2 });
      expect(p.clearReferenceImages).toBe(false);
      expect(p.trimReferenceImagesTo).toBe(1);
    });
    it('a seedance fast con 1080p: baja a 720p', () => {
      expect(reconcileVideoOptions('seedance-2.0-fast', { ...base, aspectRatio: '16:9' }).seedanceResolution).toBe('720p');
    });
    it('a seedance estándar con 1080p: lo conserva', () => {
      expect(reconcileVideoOptions('seedance-2.0', { ...base, aspectRatio: '16:9' }).seedanceResolution).toBe('1080p');
    });
    it('a kling con ratio 4:3: clampa a 16:9 y limpia seedanceRefs', () => {
      const p = reconcileVideoOptions('fal-ai/kling-video/v3/standard/text-to-video', { ...base, aspectRatio: '4:3', seedanceRefsCount: 2 });
      expect(p.aspectRatio).toBe('16:9');
      expect(p.clearSeedanceRefs).toBe(true);
    });
    it('a seedance: no limpia seedanceRefs', () => {
      expect(reconcileVideoOptions('seedance-2.0', { ...base, aspectRatio: '16:9', seedanceRefsCount: 2 }).clearSeedanceRefs).toBe(false);
    });
  });
  ```
  Expected al correr `pnpm test lib/generation/video-models.test.ts`: falla con error de resolución de módulo (`Failed to resolve import "./video-models"` o `Cannot find module`).

- [ ] **Step 2: Implementar `lib/generation/video-models.ts`.** Crear el archivo con:
  ```ts
  import type { VideoModelKey } from '@/lib/generation/models';

  export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  export type SeedanceResolutionUi = '480p' | '720p' | '1080p';

  const SEEDANCE_RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
  const VEO_RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16'];
  const KLING_RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1'];

  export type VideoModelCapabilities = {
    isVeo: boolean;
    isSeedance: boolean;
    isKling: boolean;
    supportsImages: boolean;
    maxImages: number;
    aspectRatios: readonly VideoAspectRatio[];
    maxResolution: SeedanceResolutionUi;
  };

  export function videoModelCapabilities(model: VideoModelKey): VideoModelCapabilities {
    const isVeo = model.startsWith('veo-');
    const isSeedance = model.startsWith('seedance');
    const isKling = !isVeo && !isSeedance;
    const isVeoStandard = model === 'veo-3.1-generate-preview';
    return {
      isVeo,
      isSeedance,
      isKling,
      supportsImages: isKling || isVeoStandard,
      maxImages: isVeo ? 1 : 2,
      aspectRatios: isSeedance ? SEEDANCE_RATIOS : isVeo ? VEO_RATIOS : KLING_RATIOS,
      maxResolution: model === 'seedance-2.0-fast' ? '720p' : '1080p',
    };
  }

  export type VideoOptionsPlan = {
    aspectRatio: VideoAspectRatio;
    seedanceResolution: SeedanceResolutionUi;
    clearSeedanceRefs: boolean;
    clearReferenceImages: boolean;
    resetUseRefImages: boolean;
    trimReferenceImagesTo: number | null;
  };

  export function reconcileVideoOptions(
    next: VideoModelKey,
    current: {
      aspectRatio: VideoAspectRatio;
      seedanceResolution: SeedanceResolutionUi;
      seedanceRefsCount: number;
      referenceImagesCount: number;
    },
  ): VideoOptionsPlan {
    const caps = videoModelCapabilities(next);
    const aspectRatio = caps.aspectRatios.includes(current.aspectRatio) ? current.aspectRatio : '16:9';
    const seedanceResolution =
      next === 'seedance-2.0-fast' && current.seedanceResolution === '1080p' ? '720p' : current.seedanceResolution;
    const clearSeedanceRefs = !caps.isSeedance && current.seedanceRefsCount > 0;
    const clearReferenceImages = !caps.supportsImages && current.referenceImagesCount > 0;
    const trimReferenceImagesTo =
      !clearReferenceImages && current.referenceImagesCount > caps.maxImages ? caps.maxImages : null;
    return {
      aspectRatio,
      seedanceResolution,
      clearSeedanceRefs,
      clearReferenceImages,
      resetUseRefImages: clearReferenceImages,
      trimReferenceImagesTo,
    };
  }
  ```

- [ ] **Step 3: Correr el test y verificar verde.** `pnpm test lib/generation/video-models.test.ts`
  Expected: `Test Files 1 passed`, los 13 casos en verde.

- [ ] **Step 4: typecheck.** `pnpm typecheck`
  Expected: sin errores (módulo nuevo y aislado, ningún consumidor todavía).

- [ ] **Step 5: commit.** `git add lib/generation/video-models.ts lib/generation/video-models.test.ts && git commit -m "test(video): caracteriza capabilities + reconcile de opciones de video"`
  Expected: commit creado, sin trailer Co-Authored-By.

---

### Task S3.2: Adoptar capabilities/reconcile en VideoControlsPanel + migrar a `VideoModelKey`

**Files:**
- Modify `components/generation/VideoControlsPanel.tsx` (importes 23-28; tipo local `ModelKey` 30-39; alias `VideoAspectRatio`/`SeedanceResolutionUi` 41-42; derivaciones 108-120; `handleModelChange` 161-195)

**Interfaces:**
- Consumes: `videoModelCapabilities`, `reconcileVideoOptions`, `VideoAspectRatio`, `SeedanceResolutionUi` de `@/lib/generation/video-models`; `VideoModelKey` de `@/lib/generation/models` (Ola 1).
- Produces (sin cambios externos): re-exporta `ModelKey` (alias deprecado de `VideoModelKey`), `VideoAspectRatio`, `SeedanceResolutionUi`, `ReferenceImage` para no romper a `VideoGenerator`/`VideoPreview`/`video-meta` todavía.

**Steps:**

- [ ] **Step 1: Reemplazar el tipo local `ModelKey` y los alias de ratio/resolución por imports + re-export.** En VideoControlsPanel.tsx borrar el bloque `export type ModelKey = …` (líneas 30-39) y `export type VideoAspectRatio = …` / `export type SeedanceResolutionUi = …` (41-42). Añadir junto a los imports:
  ```ts
  import type { VideoModelKey } from '@/lib/generation/models';
  import {
    videoModelCapabilities,
    reconcileVideoOptions,
    type VideoAspectRatio,
    type SeedanceResolutionUi,
  } from '@/lib/generation/video-models';

  // Alias de compatibilidad: los consumidores migran en S3.9.
  /** @deprecated usa VideoModelKey de @/lib/generation/models */
  export type ModelKey = VideoModelKey;
  export type { VideoAspectRatio, SeedanceResolutionUi };
  ```
  Dejar intacto `export type ReferenceImage = {…}` (44-48). Mantener todas las firmas internas que dicen `ModelKey` (`VideoControlsProps.model`, `setModel`, `handleModelChange`, el cast en `onValueChange`) — siguen válidas vía alias.

- [ ] **Step 2: Reemplazar las derivaciones de render por `videoModelCapabilities`.** Sustituir las líneas 108-120 (los `const isVeo = …` hasta `seedanceMaxRes`) por:
  ```ts
  const caps = videoModelCapabilities(props.model);
  const isVeo = caps.isVeo;
  const isSeedance = caps.isSeedance;
  const isKling = caps.isKling;
  const maxImages = caps.maxImages;
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [useRefImages, setUseRefImages] = useState(false);

  const supportsImages = caps.supportsImages;
  const klingHasImage = isKling && props.referenceImages.length > 0;
  const seedanceRatios = caps.aspectRatios;
  const seedanceMaxRes = caps.maxResolution;
  ```
  (Se elimina `isVeoStandard`, que solo alimentaba `supportsImages`.) Nota: el Paso 3 (proporción) usa el ternario inline de ratios en 398-404; reemplazarlo por `caps.aspectRatios` directamente: `{caps.aspectRatios.map((r) => (…))}` — equivalente exacto a `isSeedance ? seedanceRatios : isVeo ? ['16:9','9:16'] : ['16:9','9:16','1:1']`.

- [ ] **Step 3: Reescribir `handleModelChange` usando `reconcileVideoOptions`.** Reemplazar el cuerpo (162-195) por:
  ```ts
  function handleModelChange(next: ModelKey) {
    props.setModel(next);
    const plan = reconcileVideoOptions(next, {
      aspectRatio: props.aspectRatio,
      seedanceResolution: props.seedanceResolution,
      seedanceRefsCount: props.seedanceRefs.length,
      referenceImagesCount: props.referenceImages.length,
    });
    if (plan.aspectRatio !== props.aspectRatio) props.setAspectRatio(plan.aspectRatio);
    if (plan.seedanceResolution !== props.seedanceResolution) props.setSeedanceResolution(plan.seedanceResolution);
    if (plan.clearSeedanceRefs) {
      props.seedanceRefs.forEach((r) => URL.revokeObjectURL(r.previewUrl));
      props.setSeedanceRefs([]);
    }
    if (plan.clearReferenceImages) {
      props.referenceImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      props.setReferenceImages([]);
      if (plan.resetUseRefImages) setUseRefImages(false);
    } else if (plan.trimReferenceImagesTo !== null) {
      const kept = props.referenceImages.slice(0, plan.trimReferenceImagesTo);
      const dropped = props.referenceImages.slice(plan.trimReferenceImagesTo);
      dropped.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      props.setReferenceImages(kept);
    }
  }
  ```
  Los efectos secundarios (revoke + setState) quedan en el componente; la decisión es pura. Comportamiento idéntico al original.

- [ ] **Step 4: typecheck + build + suite.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck sin errores; build OK; `Test Files … passed` (incluida `video-models.test.ts`).

- [ ] **Step 5: Smoke manual.** Abrir Crear > Video. Cambiar el selector de modelo entre Seedance/Kling/Veo y verificar: (a) al pasar a Veo desde una proporción 1:1, la proporción salta a 16:9; (b) al pasar a Seedance Fast con 1080p elegido, baja a 720p; (c) al pasar a un modelo sin imágenes con imágenes cargadas, se limpian; (d) al pasar a Veo Standard con 2 imágenes Kling, queda 1. Sin errores en consola.

- [ ] **Step 6: commit.** `git commit -am "refactor(video): deriva capacidades/clamp desde lib/generation/video-models"`
  Expected: commit creado.

---

### Task S3.3: `ControlsShell` compartido + adopción en ambos paneles

**Files:**
- Create `components/generation/ControlsShell.tsx`
- Modify `components/generation/VideoControlsPanel.tsx` (JSX externo 209-214 + cierre 722-737)
- Modify `components/generation/ControlsPanel.tsx` (JSX externo 138-143 + bloque GenerateBar 293-307)

**Interfaces:**
- Produces:
  ```ts
  export function ControlsShell(props: { children: React.ReactNode; footer?: React.ReactNode }): React.JSX.Element;
  ```
- Consumes: `CreateModeTabs` de `./CreateModeTabs`.

**Steps:**

- [ ] **Step 1: Crear `components/generation/ControlsShell.tsx`** con las clases EXACTAS de ambos paneles (idénticas hoy):
  ```tsx
  'use client';

  import { CreateModeTabs } from './CreateModeTabs';

  export function ControlsShell({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) {
    return (
      <div className="flex h-full min-h-0 flex-col border-r border-border bg-card/30">
        <div className="border-b border-border/60 px-4 py-2.5">
          <CreateModeTabs />
        </div>
        <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-4 py-[18px] pb-2">
          {children}
        </div>
        {footer}
      </div>
    );
  }
  ```

- [ ] **Step 2: Adoptar en VideoControlsPanel.** Importar `ControlsShell`, quitar el import directo de `CreateModeTabs` (línea 20). Reemplazar el `return (` externo: el `<div className="flex h-full …">` + header tabs + `<div className="scroll-thin …">` pasa a `<ControlsShell footer={<GenerateBar … />}>`, con los Steps como children y el `</div>`/`</div>` de cierre eliminados. El `<GenerateBar>` (724-735) se mueve al prop `footer`.

- [ ] **Step 3: Adoptar en ControlsPanel (imagen).** Importar `ControlsShell`, quitar el import de `CreateModeTabs` (línea 21). Reemplazar el `<div className="flex h-full …">`+tabs+scroll por `<ControlsShell footer={props.hideCta ? undefined : <GenerateBar … />}>`. El bloque `{!props.hideCta && (<GenerateBar … />)}` (293-306) se traduce a `footer={props.hideCta ? undefined : (<GenerateBar … />)}`.

- [ ] **Step 4: typecheck + build + suite.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck OK; build OK; suite verde.

- [ ] **Step 5: Smoke manual.** Abrir Crear > Imagen y Crear > Video: ambos paneles renderizan con el mismo borde/scroll/tabs; en imagen, en modo conversacional (`hideCta`) la barra de generar NO aparece y el chat sí; en imagen normal y en video la barra aparece abajo.

- [ ] **Step 6: commit.** `git commit -am "refactor(controls): andamiaje compartido ControlsShell en ambos paneles"`
  Expected: commit creado.

---

### Task S3.4: `OptionButton` + adopción en los 4 pickers de video

**Files:**
- Create `components/generation/OptionButton.tsx`
- Modify `components/generation/VideoControlsPanel.tsx` (pickers: Seedance resolución 273-294; Veo duración 322-342; Veo resolución 347-364; proporción 405-420)

**Interfaces:**
- Produces:
  ```ts
  export function OptionButton(props: {
    label: React.ReactNode;
    active: boolean;
    locked?: boolean;
    title?: string;
    onClick: () => void;
  }): React.JSX.Element;
  ```

**Steps:**

- [ ] **Step 1: Crear `components/generation/OptionButton.tsx`** con la clase canónica (la que ya comparten Seedance-resolución, Veo-duración y proporción):
  ```tsx
  'use client';

  import { cn } from '@/lib/utils';

  export function OptionButton({
    label,
    active,
    locked = false,
    title,
    onClick,
  }: {
    label: React.ReactNode;
    active: boolean;
    locked?: boolean;
    title?: string;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!locked) onClick();
        }}
        title={title}
        className={cn(
          'flex-1 rounded-md border px-3 py-1.5 text-[12.5px] transition-colors',
          locked
            ? 'cursor-not-allowed border-border/50 text-muted-foreground/30'
            : active
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:border-muted-foreground/40',
        )}
      >
        {label}
      </button>
    );
  }
  ```

- [ ] **Step 2: Convertir el picker de resolución Seedance (273-294).** Reemplazar el `.map` por:
  ```tsx
  {(['480p', '720p', '1080p'] as const).map((r) => {
    const locked = r === '1080p' && seedanceMaxRes !== '1080p';
    return (
      <OptionButton
        key={r}
        label={r}
        active={props.seedanceResolution === r}
        locked={locked}
        title={locked ? 'Fast llega a 720p; usa Seedance 2.0 para 1080p' : undefined}
        onClick={() => props.setSeedanceResolution(r)}
      />
    );
  })}
  ```

- [ ] **Step 3: Convertir el picker de duración Veo (322-342).** Reemplazar por:
  ```tsx
  {([4, 6, 8] as const).map((d) => {
    const locked = (props.veoResolution === '1080p' || props.referenceImages.length > 0) && d !== 8;
    return (
      <OptionButton
        key={d}
        label={`${d}s`}
        active={props.veoDuration === d}
        locked={locked}
        title={locked ? '1080p o imagen requiere 8s' : undefined}
        onClick={() => props.setVeoDuration(d)}
      />
    );
  })}
  ```

- [ ] **Step 4: Convertir el picker de resolución Veo (347-364) y proporción (405-420).** Resolución Veo:
  ```tsx
  {(['720p', '1080p'] as const).map((r) => (
    <OptionButton
      key={r}
      label={r}
      active={props.veoResolution === r}
      onClick={() => {
        props.setVeoResolution(r);
        if (r === '1080p') props.setVeoDuration(8);
      }}
    />
  ))}
  ```
  Proporción (dentro del contenedor `<div className={cn('gap-2', isSeedance ? 'grid grid-cols-3' : 'flex')}>`):
  ```tsx
  {caps.aspectRatios.map((r) => (
    <OptionButton
      key={r}
      label={r}
      active={props.aspectRatio === r}
      locked={klingHasImage}
      onClick={() => props.setAspectRatio(r)}
    />
  ))}
  ```
  Nota de riesgo: los botones de **resolución Veo** ganan `transition-colors` (antes no lo tenían). Es puramente cosmético (anima el color en hover/cambio, igual que el resto de pickers) y no altera lógica ni estados.

- [ ] **Step 5: Añadir el import** `import { OptionButton } from './OptionButton';` en VideoControlsPanel.tsx.

- [ ] **Step 6: typecheck + build + suite.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: todo OK/verde.

- [ ] **Step 7: Smoke manual.** Crear > Video: en Seedance verificar que 1080p aparece deshabilitado en Fast (gris, cursor-not-allowed) y activo en estándar; en Veo verificar que con 1080p o imagen, 4s/6s quedan bloqueados; proporción se bloquea cuando Kling tiene imagen. Estados visuales idénticos a antes.

- [ ] **Step 8: commit.** `git commit -am "refactor(video): OptionButton para los pickers de duración/resolución/proporción"`
  Expected: commit creado.

---

### Task S3.5: Partir Pasos 2/3/5 de video en sub-componentes presentacionales

**Files:**
- Create `components/generation/video/SeedanceDurationQuality.tsx`
- Create `components/generation/video/VeoDurationQuality.tsx`
- Create `components/generation/video/KlingDurationQuality.tsx`
- Create `components/generation/video/VideoAspectPicker.tsx`
- Create `components/generation/video/AudioToggle.tsx`
- Modify `components/generation/VideoControlsPanel.tsx` (Paso 2 246-391; Paso 3 393-422; Paso 5 587-654)

**Interfaces:**
- Produces:
  ```ts
  export function SeedanceDurationQuality(props: {
    duration: number; setDuration: (v: number) => void;
    resolution: SeedanceResolutionUi; setResolution: (v: SeedanceResolutionUi) => void;
    seed: string; setSeed: (v: string) => void;
    maxResolution: SeedanceResolutionUi;
  }): React.JSX.Element;
  export function VeoDurationQuality(props: {
    duration: 4 | 6 | 8; setDuration: (v: 4 | 6 | 8) => void;
    resolution: '720p' | '1080p'; setResolution: (v: '720p' | '1080p') => void;
    hasReferenceImage: boolean;
  }): React.JSX.Element;
  export function KlingDurationQuality(props: {
    duration: number; setDuration: (v: number) => void;
  }): React.JSX.Element;
  export function VideoAspectPicker(props: {
    ratios: readonly VideoAspectRatio[]; isSeedance: boolean;
    value: VideoAspectRatio; locked: boolean; onChange: (v: VideoAspectRatio) => void;
  }): React.JSX.Element;
  export function AudioToggle(props: {
    isSeedance: boolean; isVeo: boolean;
    generateAudio: boolean; setGenerateAudio: (v: boolean) => void;
  }): React.JSX.Element;
  ```
- Consumes: `SectionHeading` de `../Step`; `OptionButton` de `../OptionButton`; `VideoAspectRatio`/`SeedanceResolutionUi` de `@/lib/generation/video-models`; `Volume2`/`VolumeOff` de `lucide-react`.

**Steps:**

- [ ] **Step 1: Crear `SeedanceDurationQuality.tsx`** moviendo TAL CUAL el JSX de la rama `isSeedance` del Paso 2 (VideoControlsPanel 247-317: slider de duración 4-15s, el texto guía, `SectionHeading Resolución` con los `OptionButton` ya convertidos en S3.4, y el input numérico de seed). Cablear props `duration/setDuration`, `resolution/setResolution`, `seed/setSeed`, `maxResolution` (sustituye `seedanceMaxRes`). Sin cambios de clases ni de textos.

- [ ] **Step 2: Crear `VeoDurationQuality.tsx`** moviendo la rama `isVeo` del Paso 2 (319-367): `SectionHeading Duración` con `OptionButton` (locked = `(resolution === '1080p' || hasReferenceImage) && d !== 8`), y `SectionHeading Resolución` con `OptionButton`. `hasReferenceImage` sustituye `props.referenceImages.length > 0`.

- [ ] **Step 3: Crear `KlingDurationQuality.tsx`** moviendo la rama `else` del Paso 2 (369-390): slider 5-10s con su header y labels.

- [ ] **Step 4: Crear `VideoAspectPicker.tsx`** moviendo el interior del Paso 3 (398-421): el contenedor `<div className={cn('gap-2', isSeedance ? 'grid grid-cols-3' : 'flex')}>` y el `.map(ratios)` con `OptionButton` (locked = `props.locked`, que es `klingHasImage`).

- [ ] **Step 5: Crear `AudioToggle.tsx`** moviendo el interior del Paso 5 (592-653): las tres ramas (`isSeedance` botón toggle + nota; `isVeo` chip informativo + nota; Kling botón toggle + nota). Conserva textos exactos.

- [ ] **Step 6: Recablear VideoControlsPanel** para componer: Paso 2 pasa a `{isSeedance ? <SeedanceDurationQuality … /> : isVeo ? <VeoDurationQuality … /> : <KlingDurationQuality … />}`; Paso 3 a `<VideoAspectPicker ratios={caps.aspectRatios} isSeedance={isSeedance} value={props.aspectRatio} locked={klingHasImage} onChange={props.setAspectRatio} />`; Paso 5 a `<AudioToggle isSeedance={isSeedance} isVeo={isVeo} generateAudio={props.generateAudio} setGenerateAudio={props.setGenerateAudio} />`. Añadir los 5 imports.

- [ ] **Step 7: typecheck + build + suite.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: todo OK/verde.

- [ ] **Step 8: Smoke manual.** Crear > Video: recorrer los 3 modelos y confirmar que Paso 2 (duración/calidad/seed), Paso 3 (proporción) y Paso 5 (audio) lucen y se comportan igual; mover el slider, escribir seed, togglear audio.

- [ ] **Step 9: commit.** `git commit -am "refactor(video): extrae sub-componentes de duración, proporción y audio"`
  Expected: commit creado.

---

### Task S3.6: Extraer `ReferenceImagesPanel` (mueve estado de upload)

**Files:**
- Create `components/generation/video/ReferenceImagesPanel.tsx`
- Modify `components/generation/VideoControlsPanel.tsx` (estado `fileRef`/`uploading`/`useRefImages`; `handleFile` 122-153; `removeRef` 155-159; Paso 4 supportsImages 471-585)

**Interfaces:**
- Produces:
  ```ts
  export function ReferenceImagesPanel(props: {
    isVeo: boolean;
    maxImages: number;
    referenceImages: ReferenceImage[];
    setReferenceImages: (v: ReferenceImage[]) => void;
    onEnableVeoDefaults: () => void;
  }): React.JSX.Element;
  ```
- Consumes: `uploadReferenceFile` de `@/lib/media-references/upload-client`; `toast` de `sonner`; `cn`; `AlertTriangle`/`ImagePlus`/`Loader2`/`X` de `lucide-react`; `ReferenceImage` de `../VideoControlsPanel`.

**Steps:**

- [ ] **Step 1: Crear `ReferenceImagesPanel.tsx`** con su propio estado local `const fileRef = useRef<HTMLInputElement>(null)`, `const [uploading, setUploading] = useState(false)`, `const [useRefImages, setUseRefImages] = useState(false)`. Mover `handleFile` (122-153, ajustando `maxImages`→`props.maxImages` y `props.referenceImages`→`props.referenceImages`/`props.setReferenceImages`) y `removeRef` (155-159). El cuerpo es el `<Step index={4}…>` de supportsImages (472-584) tal cual; el toggle que hacía `props.setVeoResolution('1080p'); props.setVeoDuration(8)` pasa a llamar `props.onEnableVeoDefaults()`.

- [ ] **Step 2: Quitar de VideoControlsPanel** el estado `fileRef`/`uploading`/`useRefImages`, `handleFile`, `removeRef` y el `<Step index={4}>` de supportsImages. Reemplazar el bloque `{supportsImages && (<Step …>)}` por:
  ```tsx
  {supportsImages && (
    <ReferenceImagesPanel
      isVeo={isVeo}
      maxImages={maxImages}
      referenceImages={props.referenceImages}
      setReferenceImages={props.setReferenceImages}
      onEnableVeoDefaults={() => {
        props.setVeoResolution('1080p');
        props.setVeoDuration(8);
      }}
    />
  )}
  ```
  Importante: `useRefImages` ya NO existe en el panel; verificar que su única lectura externa era el `handleModelChange` (`setUseRefImages(false)` al limpiar). Ese reset ahora vive dentro de `ReferenceImagesPanel` cuando el modelo deja de soportar imágenes: como el panel se desmonta (`{supportsImages && …}` pasa a false), el estado `useRefImages` se descarta solo. Comportamiento equivalente: al volver a un modelo con soporte, el toggle reaparece apagado, igual que hoy tras el `setUseRefImages(false)`. Documentar este punto en el PR.

- [ ] **Step 3: Quitar imports muertos** en VideoControlsPanel (`uploadReferenceFile`, `AlertTriangle`, `Loader2`, `useCallback`, y los iconos que ya solo usaba el Paso 4) si dejan de usarse; conservar los que sigan en uso (p.ej. `ImagePlus`/`X` se usan también en el Paso 4 de Seedance start-frame — verificar con `pnpm lint`).

- [ ] **Step 4: typecheck + build + lint + suite.** `pnpm typecheck && pnpm build && pnpm lint && pnpm test`
  Expected: typecheck OK; build OK; lint sin `no-unused-vars`; suite verde.

- [ ] **Step 5: Smoke manual.** Crear > Video con Kling y con Veo Standard: activar "referencias", subir 1-2 imágenes, quitarlas, y cambiar de modelo a uno sin soporte para confirmar que se limpian y el toggle reaparece apagado. En Veo, activar referencias fuerza 1080p/8s (banner ámbar visible).

- [ ] **Step 6: commit.** `git commit -am "refactor(video): extrae ReferenceImagesPanel con su estado de upload"`
  Expected: commit creado.

---

### Task S3.7: Hook `usePromptEnhance` compartido (PromptArea + EnhanceButton)

**Files:**
- Create `lib/generation/use-prompt-enhance.ts`
- Modify `components/generation/ControlsPanel.tsx` (`PromptArea` 493-641: lógica de enhance 506-552)
- Modify `components/generation/EnhanceButton.tsx` (lógica 22-44)

**Interfaces:**
- Produces:
  ```ts
  export type EnhanceArgs = {
    type?: 'image' | 'video' | 'audio';
    hint?: 'photoreal' | 'illustration' | 'text-in-image';
  };
  export function usePromptEnhance(opts: {
    prompt: string;
    cost: number;
    balance: number;
    args: EnhanceArgs;
    onSuccess: (enhanced: string, cost: number) => void;
    onError: (res: { error: string; message?: string }) => void;
  }): { enhancing: boolean; canEnhance: boolean; enhance: () => void };
  ```
- Consumes: `enhancePromptAction` de `@/server-actions/prompt-enhancer` (solo import, no se modifica el server-action).

**Steps:**

- [ ] **Step 1: Crear `lib/generation/use-prompt-enhance.ts`** (cliente, NO 'use server') con la lógica común (ref anti-doble-cobro + `useTransition` + `canEnhance`):
  ```ts
  'use client';

  import { useRef, useTransition } from 'react';
  import { enhancePromptAction } from '@/server-actions/prompt-enhancer';

  export type EnhanceArgs = {
    type?: 'image' | 'video' | 'audio';
    hint?: 'photoreal' | 'illustration' | 'text-in-image';
  };

  export function usePromptEnhance(opts: {
    prompt: string;
    cost: number;
    balance: number;
    args: EnhanceArgs;
    onSuccess: (enhanced: string, cost: number) => void;
    onError: (res: { error: string; message?: string }) => void;
  }) {
    const [enhancing, startEnhance] = useTransition();
    const inFlight = useRef(false);
    const canEnhance =
      opts.prompt.trim().length >= 3 && !enhancing && opts.balance >= opts.cost;

    function enhance() {
      if (!canEnhance || inFlight.current) return;
      inFlight.current = true;
      startEnhance(async () => {
        const res = await enhancePromptAction({ prompt: opts.prompt, ...opts.args });
        inFlight.current = false;
        if (!res.ok) {
          opts.onError(res);
          return;
        }
        opts.onSuccess(res.enhanced, res.cost);
      });
    }

    return { enhancing, canEnhance, enhance };
  }
  ```

- [ ] **Step 2: Adoptar en `EnhanceButton.tsx`.** Reemplazar `useState`/`useTransition`/`inFlight`/`canEnhance`/`handleEnhance` (22-44) por:
  ```tsx
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const { enhancing, canEnhance, enhance } = usePromptEnhance({
    prompt,
    cost,
    balance,
    args: { type },
    onSuccess: (enhanced) => setSuggestion(enhanced),
    onError: (res) =>
      toast.error(
        res.error === 'insufficient_credits'
          ? `Necesitas ${cost} créditos`
          : res.message || 'No se pudo mejorar',
      ),
  });
  ```
  Cambiar el `onClick={handleEnhance}` por `onClick={enhance}`. Quitar imports muertos (`useRef`, `useTransition`, `enhancePromptAction`). Toasts y UI idénticos.

- [ ] **Step 3: Adoptar en `PromptArea` (ControlsPanel).** Reemplazar `useTransition`/`inFlight`/`canEnhance`/`handleEnhance` (508-552) por:
  ```tsx
  const { enhancing, canEnhance, enhance } = usePromptEnhance({
    prompt: value,
    cost: enhanceCost,
    balance,
    args: { hint: enhanceHint },
    onSuccess: (enhanced, cost) => {
      setSuggestion(enhanced);
      toast.success(`Sugerencia lista · −${cost} cr`);
    },
    onError: (res) => {
      const msg =
        res.error === 'insufficient_credits'
          ? `Te faltan créditos (necesitas ${enhanceCost}).`
          : res.error === 'safety'
            ? 'Gemini rechazó la mejora por políticas de seguridad.'
            : res.error === 'validation_error'
              ? 'Escribe al menos 3 caracteres.'
              : res.message || 'No se pudo mejorar el prompt.';
      toast.error(msg);
    },
  });
  ```
  Mantener `tooShort`/`noBalance` (522-525, dependen de `value`/`balance`/`enhanceCost`, ya no de `enhancing`). Cambiar `onClick={handleEnhance}` por `onClick={enhance}`. Quitar imports muertos (`useTransition`, `enhancePromptAction`) si ya no se usan en el archivo — verificar que `ControlsPanel` no los use en otro lado (no lo hace; `enhancePromptAction` se importaba solo para `PromptArea`).

- [ ] **Step 4: typecheck + build + lint + suite.** `pnpm typecheck && pnpm build && pnpm lint && pnpm test`
  Expected: todo OK/verde; sin imports sin usar.

- [ ] **Step 5: Smoke manual.** Crear > Imagen: escribir un prompt, "Mejorar" → aparece tarjeta de sugerencia + toast "Sugerencia lista · −N cr"; doble-click rápido NO cobra doble (un solo toast). Crear > Video: botón "Mejorar con IA" → tarjeta inline con Aceptar/Descartar. Probar caso sin saldo (botón deshabilitado con title correcto).

- [ ] **Step 6: commit.** `git commit -am "refactor(enhance): hook usePromptEnhance compartido por imagen y video"`
  Expected: commit creado.

---

### Task S3.8: Renombrar `ModelKey` (imagen) -> `ImageModelKey`

**Files:**
- Modify `components/generation/types.ts` (línea 1)
- Modify `components/generation/ControlsPanel.tsx` (import 37; props 76-77; firmas internas 50, 451-456)
- Modify `components/generation/ImageGenerator.tsx` (import 23; `initialModelKey` 41; `useState` 54)

**Interfaces:**
- Produces: `export type ImageModelKey = 'auto' | 'nano-pro' | 'nano-flash' | 'flux';` (en `types.ts`).
- Consumes: ninguno de Ola 1 (el `ModelKey` de imagen no vive en `lib/generation/models.ts`, que es solo video).

**Steps:**

- [ ] **Step 1: Renombrar en `types.ts`.** Cambiar la línea 1 a `export type ImageModelKey = 'auto' | 'nano-pro' | 'nano-flash' | 'flux';`.

- [ ] **Step 2: Actualizar `ControlsPanel.tsx`.** En el import (37) cambiar `ModelKey`→`ImageModelKey`; en `MODEL_META` (50), `ControlsPanelProps.modelKey`/`setModelKey` (76-77) y `ModelPicker` (451-456) reemplazar todas las apariciones de `ModelKey` por `ImageModelKey` (incluido el cast `Object.entries(MODEL_META) as [ImageModelKey, …]`).

- [ ] **Step 3: Actualizar `ImageGenerator.tsx`.** En el import (23) cambiar `ModelKey`→`ImageModelKey`; `initialModelKey?: ImageModelKey` (41) y `useState<ImageModelKey>` (54).
  Nota: `app/app/create/image/page.tsx` NO importa el tipo (usa el union literal inline en la línea 47), así que no requiere cambios.

- [ ] **Step 4: typecheck + build + suite.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: todo OK/verde. Build incluido porque `ControlsPanel`/`ImageGenerator` cruzan el límite cliente.

- [ ] **Step 5: commit.** `git commit -am "refactor(image): renombra ModelKey a ImageModelKey"`
  Expected: commit creado.

---

### Task S3.9: Migrar consumidores de video a Ola 1 (`VideoModelKey`/`VIDEO_MODEL_LABEL`) + verificación final

**Files:**
- Modify `lib/generation/video-meta.ts` (import 5; `MODEL_LABEL` 7-15; firma `estimateVideoEta` 21)
- Modify `components/generation/VideoControlsPanel.tsx` (import label 28; alias `ModelKey` re-export; uso `MODEL_LABEL` 725; firmas `VideoControlsProps`)
- Modify `components/generation/VideoPreview.tsx` (imports 18-19; `model` 46; usos `MODEL_LABEL` 71/88)
- Modify `components/generation/VideoGenerator.tsx` (import 14-21; `seedanceSlug`/`calcCost`/`useState` usos de `ModelKey`)

**Interfaces:**
- Consumes (Ola 1): `VideoModelKey`, `VIDEO_MODEL_LABEL` de `@/lib/generation/models`.
- Produces: `VideoControlsPanel` deja de exportar el alias `ModelKey`; sigue re-exportando `VideoAspectRatio`, `SeedanceResolutionUi`, `ReferenceImage`.

**Steps:**

- [ ] **Step 1: `lib/generation/video-meta.ts`.** Borrar `MODEL_LABEL` (7-15). Cambiar el import (5) a `import type { VideoModelKey } from './models';` y la firma `estimateVideoEta(model: VideoModelKey, …)` (21). (Las heurísticas internas usan `model.startsWith(...)` y comparaciones de string — sin cambios.)

- [ ] **Step 2: `VideoControlsPanel.tsx`.** Cambiar `import { MODEL_LABEL, estimateVideoEta } from '@/lib/generation/video-meta';` por `import { estimateVideoEta } from '@/lib/generation/video-meta';` + `import { VIDEO_MODEL_LABEL, type VideoModelKey } from '@/lib/generation/models';`. Reemplazar `MODEL_LABEL[props.model]` (725) por `VIDEO_MODEL_LABEL[props.model]`. Eliminar el alias `export type ModelKey = VideoModelKey` y sustituir las firmas internas que decían `ModelKey` por `VideoModelKey` (`VideoControlsProps.model`/`setModel`, `handleModelChange`, cast en `onValueChange`). Conservar `export type ReferenceImage` y los re-export de `VideoAspectRatio`/`SeedanceResolutionUi`.

- [ ] **Step 3: `VideoPreview.tsx`.** Cambiar `import type { ModelKey } from './VideoControlsPanel';` (18) por `import type { VideoModelKey } from '@/lib/generation/models';` y `import { MODEL_LABEL } from '@/lib/generation/video-meta';` (19) por `import { VIDEO_MODEL_LABEL } from '@/lib/generation/models';`. `model: VideoModelKey` (46) y `VIDEO_MODEL_LABEL[props.model]` (71, 88).

- [ ] **Step 4: `VideoGenerator.tsx`.** En el import desde `./VideoControlsPanel` (14-21) quitar `type ModelKey` y añadir `import type { VideoModelKey } from '@/lib/generation/models';`. Reemplazar `ModelKey`→`VideoModelKey` en `seedanceSlug` (28), `calcCost` (35) y `useState<VideoModelKey>('seedance-2.0')` (68). Mantener `ReferenceImage`/`SeedanceResolutionUi`/`VideoAspectRatio` desde `./VideoControlsPanel` (siguen re-exportados).

- [ ] **Step 5: Verificación de no-residuos.** Buscar referencias colgantes: `pnpm exec tsc --noEmit` y además confirmar que nadie más importa el `ModelKey` de video. Expected de `git grep -n "from './VideoControlsPanel'"`: solo imports de `VideoControlsPanel`, `VIDEO_STYLES`, `ReferenceImage`, `SeedanceResolutionUi`, `VideoAspectRatio` (ningún `ModelKey`).

- [ ] **Step 6: typecheck + build + lint + suite completa.** `pnpm typecheck && pnpm build && pnpm lint && pnpm test`
  Expected: typecheck OK; build OK (verificación de integración del re-export a través del límite cliente); lint limpio; toda la suite verde, incluida `lib/generation/video-models.test.ts`.

- [ ] **Step 7: Smoke manual final.** Crear > Video: el label del modelo en la barra de generar y en el preview coincide con el seleccionado (Seedance/Kling/Veo, todas las variantes). Crear > Imagen: panel completo funciona (enhance, referencias, formato, avanzado). Sin errores de consola en ninguna.

- [ ] **Step 8: commit.** `git commit -am "refactor(video): consume VideoModelKey/VIDEO_MODEL_LABEL de lib/generation/models"`
  Expected: commit creado.
### Unidad S4: app/page.tsx (910 lineas, landing) -> Server Component + components/landing/

**Objetivo.** Hoy `app/page.tsx` esta marcado entero `'use client'` aunque ~85% es estatico, lo que impide exportar `metadata`/`openGraph` (clave SEO/social de la landing publica) y mete toda la pagina al bundle de cliente. Este refactor es puro **movimiento/extraccion, comportamiento identico**: partir el archivo en `components/landing/` (islas `'use client'` minimas para lo realmente interactivo: tipeo, scroll, canvas, chat) y secciones como Server Components, dejando `app/page.tsx` como un Server Component de ~50 lineas que compone secciones y **exporta `metadata`**. Se extrae la unica logica determinista (la matematica de la onda del canvas) a `lib/landing/wave.ts` con test de caracterizacion vitest. Riesgo bajo, quick-win.

**Nota de cobertura/TDD.** El entorno vitest del repo es `environment: 'node'` y **no hay** `@testing-library/react`: hooks y componentes React no son unit-testeables aqui sin mocks pesados. Por eso solo **una** funcion pura se extrae a `lib/` y lleva test de caracterizacion (S4.1); el resto de tasks (componentes/islas) verifican con `pnpm typecheck && pnpm build && pnpm test` (suite existente verde) + una nota de smoke manual concreta.

**Nota gotcha `'use server'`.** Esta unidad **NO toca ningun archivo `'use server'`** (ni server-actions ni barrels de mutacion), asi que el gotcha de "solo funciones async exportables" no aplica directamente. Pero el flip final de `app/page.tsx` de cliente a Server Component (S4.10) **solo se valida con `pnpm build`**: errores de frontera RSC/cliente (p. ej. pasar un handler a un Server Component, o que el `export const metadata` conviva con `'use client'`) NO los ve `typecheck` ni `lint` — igual que el gotcha de `'use server'`, son visibles **solo en build**. Por eso S4.10 incluye `pnpm build` obligatorio.

**Ola 1.** Esta unidad **no consume** helpers de Ola 1 (no hay `Result`, ni media, ni providers, ni creditos en la landing). Es UI estatica pura.

---

#### File Structure

**Nuevos:**
- `lib/landing/wave.ts` — funcion pura `bentoWaveOffset(u, time)`: desplazamiento vertical (px, respecto al eje medio) de un punto de la onda del canvas Audio. Sin IO.
- `lib/landing/wave.test.ts` — test de caracterizacion del comportamiento actual de la onda.
- `components/landing/icons.tsx` — Server Component: `BrandLogo`, `ArrowIcon`, `CheckIcon`, `SparkleIcon`, `CreditIcon` (SVG/`<img>` puros, sin hooks).
- `components/landing/hooks/useTypingAnimation.ts` — `'use client'`: hook de tipeo.
- `components/landing/hooks/useScrolled.ts` — `'use client'`: hook de estado de scroll.
- `components/landing/TypingPrompt.tsx` — `'use client'`: isla que renderiza el prompt tipeado del hero shot.
- `components/landing/BentoWave.tsx` — `'use client'`: canvas de la onda (usa `lib/landing/wave.ts`).
- `components/landing/AnimatedChat.tsx` — `'use client'`: simulacion de chat + `CHAT_FLOW`.
- `components/landing/NavShell.tsx` — `'use client'`: aplica la clase `scrolled` al `<nav>` (isla minima).
- `components/landing/LandingNav.tsx` — Server Component: contenido estatico del nav dentro de `NavShell`.
- `components/landing/Hero.tsx` — Server Component: header + hero shot (renderiza `<TypingPrompt/>`).
- `components/landing/BentoSection.tsx` — Server Component: grid bento (renderiza `<BentoWave/>` y `<AnimatedChat/>`).
- `components/landing/ModelsSection.tsx` — Server Component estatico.
- `components/landing/PricingSection.tsx` — Server Component estatico.
- `components/landing/FaqSection.tsx` — Server Component estatico.
- `components/landing/CtaSection.tsx` — Server Component estatico.
- `components/landing/LandingFooter.tsx` — Server Component estatico.

**Modificados:**
- `app/page.tsx` — pasa de `'use client'` (910 lineas) a Server Component (~50 lineas) que compone secciones y exporta `metadata`/`openGraph`; se borra `landingImages.chat1/2/3` (codigo muerto).
- `app/landing.css` — nuevas clases que reemplazan los muros de estilo inline del hero shot y la card de video bento (S4.11).

**Orden e invariante.** Fases A (S4.1-S4.9): `app/page.tsx` se mantiene `'use client'` y va importando las piezas extraidas; tras cada task compila (`typecheck`) y la suite pasa (`test`). Fase B (S4.10): flip a Server Component + `metadata` con `build` obligatorio. Cosmetica (S4.11): inline-styles -> clases. Tras CADA task el repo compila y la suite queda verde.

---

### Task S4.1: Extraer la matematica de la onda a `lib/landing/wave.ts` (funcion pura + test de caracterizacion)

Unica logica determinista del archivo. TDD real: test primero (falla por modulo inexistente), luego implementacion, luego verde.

**Files:**
- Create: `lib/landing/wave.ts`
- Create (Test): `lib/landing/wave.test.ts`
- Modify: `app/page.tsx` (cuerpo de `BentoWave`, lineas 45-71: sustituir el calculo inline de `y` por `bentoWaveOffset`)

**Interfaces:**
- Consumes: (ninguno de Ola 1)
- Produces:
  ```ts
  // lib/landing/wave.ts
  export function bentoWaveOffset(u: number, time: number): number;
  ```
  Contrato: replica exacta de las lineas 62-68 de `app/page.tsx`, devolviendo el termino `a * env * edge * 36` (el offset en px respecto a `MID`). El llamador hace `y = MID + bentoWaveOffset(u, time)`.

**Steps:**
- [ ] **Step 1: Escribir el test de caracterizacion (debe fallar).** Crear `lib/landing/wave.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { bentoWaveOffset } from './wave';

  // Reimplementacion independiente de la formula original (app/page.tsx:62-68)
  // para fijar el comportamiento: cualquier cambio futuro de la onda rompe el test.
  function reference(u: number, time: number): number {
    const edge = Math.sin(u * Math.PI);
    const a =
      Math.sin(time * 2 + u * 8) * 0.55 +
      Math.sin(time * 3.4 + u * 15) * 0.32 +
      Math.sin(time * 5.8 + u * 24) * 0.18;
    const env = 0.5 + 0.5 * Math.sin(time * 0.7 + u * 2);
    return a * env * edge * 36;
  }

  describe('bentoWaveOffset', () => {
    it('en el borde izquierdo (u=0) el offset es exactamente 0 para cualquier t', () => {
      expect(bentoWaveOffset(0, 0)).toBe(0);
      expect(bentoWaveOffset(0, 1.23)).toBe(0);
      expect(bentoWaveOffset(0, 99)).toBe(0);
    });

    it('es deterministico: misma entrada -> misma salida', () => {
      expect(bentoWaveOffset(0.5, 2)).toBe(bentoWaveOffset(0.5, 2));
    });

    it('coincide con la formula original en una rejilla de muestras', () => {
      for (let i = 0; i <= 48; i++) {
        const u = i / 48;
        for (const t of [0, 0.5, 1.7, 3.3, 10]) {
          expect(bentoWaveOffset(u, t)).toBeCloseTo(reference(u, t), 12);
        }
      }
    });
  });
  ```
  Correr: `pnpm test lib/landing/wave.test.ts`
  Expected: falla con error de resolucion de modulo (`Failed to resolve import "./wave"` / "Cannot find module"), porque `wave.ts` aun no existe.

- [ ] **Step 2: Implementar el modulo.** Crear `lib/landing/wave.ts`:
  ```ts
  // Matematica pura de la onda del canvas "Audio" de la landing.
  // Extraida verbatim de app/page.tsx (BentoWave). Comportamiento identico.
  export function bentoWaveOffset(u: number, time: number): number {
    const edge = Math.sin(u * Math.PI);
    const a =
      Math.sin(time * 2 + u * 8) * 0.55 +
      Math.sin(time * 3.4 + u * 15) * 0.32 +
      Math.sin(time * 5.8 + u * 24) * 0.18;
    const env = 0.5 + 0.5 * Math.sin(time * 0.7 + u * 2);
    return a * env * edge * 36;
  }
  ```
  Correr: `pnpm test lib/landing/wave.test.ts`
  Expected: `3 passed`.

- [ ] **Step 3: Cablear `BentoWave` (en `app/page.tsx`) al modulo nuevo.** En el loop del canvas (lineas 62-68), reemplazar el calculo inline de `edge`/`a`/`env`/`y` por:
  ```ts
  const u = i / N;
  const x = u * W;
  const y = MID + bentoWaveOffset(u, time);
  ```
  Y agregar al inicio de `app/page.tsx` (debajo del `import "./landing.css";` de la linea 6):
  ```ts
  import { bentoWaveOffset } from "@/lib/landing/wave";
  ```
  Correr: `pnpm typecheck`
  Expected: sin errores (exit 0).

- [ ] **Step 4: Verificacion + commit.** Correr `pnpm test && pnpm typecheck`.
  Expected: toda la suite verde, typecheck limpio.
  Commit: `git switch -c refactor/landing-split 2>/dev/null || git switch refactor/landing-split` y luego `git commit -am "refactor(landing): extrae bentoWaveOffset puro + test de caracterizacion"`.

---

### Task S4.2: Extraer los iconos SVG a `components/landing/icons.tsx` (Server Components)

Componentes presentacionales sin hooks -> Server Components puros.

**Files:**
- Create: `components/landing/icons.tsx`
- Modify: `app/page.tsx` (borrar definiciones `BrandLogo` 180-190, `ArrowIcon` 192-207, `CheckIcon` 209-224, `SparkleIcon` 226-240, `CreditIcon` 242-248; agregar import)

**Interfaces:**
- Consumes: (ninguno de Ola 1)
- Produces:
  ```ts
  // components/landing/icons.tsx
  export function BrandLogo(props: { height?: number }): React.JSX.Element;
  export function ArrowIcon(): React.JSX.Element;
  export function CheckIcon(): React.JSX.Element;
  export function SparkleIcon(): React.JSX.Element;
  export function CreditIcon(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear el archivo.** Crear `components/landing/icons.tsx` SIN directiva `'use client'`, moviendo verbatim las 5 funciones de `app/page.tsx:180-248` (incluidos los comentarios `eslint-disable-next-line @next/next/no-img-element` de `BrandLogo`). El archivo no importa nada (solo JSX). Mantener la firma `BrandLogo({ height = 40 }: { height?: number })`.

- [ ] **Step 2: Borrar las definiciones viejas y agregar import.** En `app/page.tsx`, eliminar las funciones `BrandLogo`/`ArrowIcon`/`CheckIcon`/`SparkleIcon`/`CreditIcon` (lineas 177-248, incluyendo el banner de comentario `/* SVG Icons */`). Agregar import bajo la linea 6:
  ```ts
  import { BrandLogo, ArrowIcon, CheckIcon, SparkleIcon, CreditIcon } from "@/components/landing/icons";
  ```

- [ ] **Step 3: Verificacion + commit.** Correr `pnpm typecheck && pnpm test`.
  Expected: typecheck limpio (exit 0), suite verde (mismo numero de tests que antes).
  Commit: `git commit -am "refactor(landing): mueve iconos a components/landing/icons"`.

---

### Task S4.3: Extraer `useTypingAnimation` + isla `TypingPrompt`

El hook de tipeo y el bloque que lo consume (prompt del hero shot) se vuelven una isla `'use client'` autocontenida.

**Files:**
- Create: `components/landing/hooks/useTypingAnimation.ts`
- Create: `components/landing/TypingPrompt.tsx`
- Modify: `app/page.tsx` (borrar `useTypingAnimation` 11-32; borrar la llamada `const typedText = useTypingAnimation(...)` 255-257; reemplazar el `<div className="l-shot-prompt">...</div>` 368-371 por `<TypingPrompt/>`)

**Interfaces:**
- Consumes: (ninguno de Ola 1)
- Produces:
  ```ts
  // components/landing/hooks/useTypingAnimation.ts
  export function useTypingAnimation(text: string, speed?: number, pause?: number): string;
  // components/landing/TypingPrompt.tsx
  export function TypingPrompt(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear el hook.** Crear `components/landing/hooks/useTypingAnimation.ts`:
  ```ts
  'use client';
  import { useEffect, useState } from "react";

  export function useTypingAnimation(text: string, speed = 40, pause = 4500): string {
    const [displayed, setDisplayed] = useState("");
    useEffect(() => {
      let i = 0;
      let timer: ReturnType<typeof setTimeout>;
      function type() {
        if (i <= text.length) {
          setDisplayed(text.slice(0, i));
          i++;
          timer = setTimeout(type, speed + Math.random() * 50);
        } else {
          timer = setTimeout(() => {
            i = 0;
            type();
          }, pause);
        }
      }
      type();
      return () => clearTimeout(timer);
    }, [text, speed, pause]);
    return displayed;
  }
  ```
  (Cuerpo identico a `app/page.tsx:11-32`.)

- [ ] **Step 2: Crear la isla `TypingPrompt`.** Crear `components/landing/TypingPrompt.tsx`:
  ```tsx
  'use client';
  import { useTypingAnimation } from "./hooks/useTypingAnimation";

  const PROMPT =
    "Retrato editorial de una mujer, luz suave de ventana, pelicula 35mm, fondo gris calido";

  export function TypingPrompt() {
    const typedText = useTypingAnimation(PROMPT);
    return (
      <div className="l-shot-prompt">
        <span>{typedText}</span>
        <span className="l-caret" />
      </div>
    );
  }
  ```
  (El string PROMPT es el mismo de `app/page.tsx:256`.)

- [ ] **Step 3: Limpiar `app/page.tsx`.** Eliminar la funcion `useTypingAnimation` (lineas 8-32, con su banner de comentario). Eliminar `const typedText = useTypingAnimation(...)` (255-257). Reemplazar el bloque del prompt (368-371):
  ```tsx
  <div className="l-shot-prompt">
    <span>{typedText}</span>
    <span className="l-caret" />
  </div>
  ```
  por `<TypingPrompt />`. Agregar import bajo la linea 6:
  ```ts
  import { TypingPrompt } from "@/components/landing/TypingPrompt";
  ```

- [ ] **Step 4: Verificacion + commit.** Correr `pnpm typecheck && pnpm test`.
  Expected: typecheck limpio, suite verde.
  Smoke manual: `pnpm dev`, abrir `http://localhost:3000/`; el prompt del hero shot (paso "2 Describe tu imagen") sigue tipeandose letra por letra y reiniciando con la pausa.
  Commit: `git commit -am "refactor(landing): isla TypingPrompt + hook useTypingAnimation"`.

---

### Task S4.4: Extraer `BentoWave` a `components/landing/BentoWave.tsx`

**Files:**
- Create: `components/landing/BentoWave.tsx`
- Modify: `app/page.tsx` (borrar `BentoWave` 34-93 y el import de `bentoWaveOffset` agregado en S4.1; agregar import del componente; el `import { useRef }` se limpia cuando deje de usarse — ver Step 3)

**Interfaces:**
- Consumes: `bentoWaveOffset` de `@/lib/landing/wave` (producido en S4.1).
- Produces:
  ```ts
  // components/landing/BentoWave.tsx
  export function BentoWave(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear el componente.** Crear `components/landing/BentoWave.tsx` con directiva `'use client'`, moviendo verbatim la funcion `BentoWave` de `app/page.tsx:37-93` (ya con `const y = MID + bentoWaveOffset(u, time);` del S4.1). Imports del archivo:
  ```ts
  'use client';
  import { useEffect, useRef } from "react";
  import { bentoWaveOffset } from "@/lib/landing/wave";
  ```

- [ ] **Step 2: Limpiar `app/page.tsx`.** Eliminar la funcion `BentoWave` (lineas 34-93, con su banner) y el import `import { bentoWaveOffset } from "@/lib/landing/wave";` (ya no se usa en page). Agregar import:
  ```ts
  import { BentoWave } from "@/components/landing/BentoWave";
  ```
  (El uso `<BentoWave />` en la card Audio, linea 553, queda igual.)

- [ ] **Step 3: Revisar imports de `react` en page.** En `app/page.tsx`, `useRef` aun lo usa `AnimatedChat` (linea 111), asi que el import `useRef` se mantiene por ahora. Correr `pnpm lint` para confirmar que no quedo ningun import sin usar de esta task.
  Expected: lint sin nuevos errores de `no-unused-vars` (exit 0).

- [ ] **Step 4: Verificacion + commit.** Correr `pnpm typecheck && pnpm test`.
  Expected: typecheck limpio, suite verde.
  Smoke manual: en `/`, la card "Audio" del bento sigue mostrando la onda animada (linea azul ondulante).
  Commit: `git commit -am "refactor(landing): mueve BentoWave a components/landing"`.

---

### Task S4.5: Extraer `AnimatedChat` + `CHAT_FLOW` a `components/landing/AnimatedChat.tsx`

**Files:**
- Create: `components/landing/AnimatedChat.tsx`
- Modify: `app/page.tsx` (borrar `CHAT_FLOW` 95-105 y `AnimatedChat` 107-175; agregar import; limpiar `useRef` del import de react)

**Interfaces:**
- Consumes: (ninguno de Ola 1)
- Produces:
  ```ts
  // components/landing/AnimatedChat.tsx
  export function AnimatedChat(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear el componente.** Crear `components/landing/AnimatedChat.tsx` con `'use client'`, moviendo verbatim `CHAT_FLOW` (`app/page.tsx:98-105`) y la funcion `AnimatedChat` (`107-175`). Imports:
  ```ts
  'use client';
  import { useEffect, useRef, useState } from "react";
  ```
  (Conserva el comentario `eslint-disable-next-line @next/next/no-img-element` de la linea 153 y el `<img>` raw del mensaje bot — son parte del comportamiento actual.)

- [ ] **Step 2: Limpiar `app/page.tsx`.** Eliminar `CHAT_FLOW` (95-105) y `AnimatedChat` (107-175) con sus banners. Agregar import:
  ```ts
  import { AnimatedChat } from "@/components/landing/AnimatedChat";
  ```
  El uso `<AnimatedChat />` (linea 565, card "Edicion conversacional") queda igual. Ahora `useRef` ya no se usa en `app/page.tsx`: quitarlo del `import { useEffect, useRef, useState } from "react";` -> `import { useEffect, useState } from "react";`.

- [ ] **Step 3: Verificacion + commit.** Correr `pnpm typecheck && pnpm lint && pnpm test`.
  Expected: typecheck limpio, lint sin `no-unused-vars`, suite verde.
  Smoke manual: en `/`, la card "Edicion conversacional" reproduce la conversacion simulada (mensajes usuario + imagenes bot + dots de "escribiendo") y reinicia el loop.
  Commit: `git commit -am "refactor(landing): mueve AnimatedChat + CHAT_FLOW a components/landing"`.

---

### Task S4.6: Extraer el nav — `useScrolled` + isla `NavShell` + `LandingNav` (SC)

El estado `scrolled` se aisla a una isla minima; el contenido del nav (brand, links, CTAs) queda como Server Component.

**Files:**
- Create: `components/landing/hooks/useScrolled.ts`
- Create: `components/landing/NavShell.tsx`
- Create: `components/landing/LandingNav.tsx`
- Modify: `app/page.tsx` (borrar `const [scrolled, setScrolled]...` + `useEffect` 270-275; reemplazar el bloque `<nav>...</nav>` 281-305 por `<LandingNav/>`; limpiar `useEffect`/`useState` del import de react)

**Interfaces:**
- Consumes: `BrandLogo` de `@/components/landing/icons` (S4.2).
- Produces:
  ```ts
  // components/landing/hooks/useScrolled.ts
  export function useScrolled(threshold?: number): boolean;
  // components/landing/NavShell.tsx
  export function NavShell(props: { children: React.ReactNode }): React.JSX.Element;
  // components/landing/LandingNav.tsx
  export function LandingNav(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear el hook `useScrolled`.** Crear `components/landing/hooks/useScrolled.ts`:
  ```ts
  'use client';
  import { useEffect, useState } from "react";

  export function useScrolled(threshold = 12): boolean {
    const [scrolled, setScrolled] = useState(false);
    useEffect(() => {
      const handler = () => setScrolled(window.scrollY > threshold);
      window.addEventListener("scroll", handler, { passive: true });
      return () => window.removeEventListener("scroll", handler);
    }, [threshold]);
    return scrolled;
  }
  ```
  (Logica identica a `app/page.tsx:270-275`, con el umbral `12`.)

- [ ] **Step 2: Crear la isla `NavShell`.** Crear `components/landing/NavShell.tsx`:
  ```tsx
  'use client';
  import type { ReactNode } from "react";
  import { useScrolled } from "./hooks/useScrolled";

  export function NavShell({ children }: { children: ReactNode }) {
    const scrolled = useScrolled();
    return <nav className={`l-nav${scrolled ? " scrolled" : ""}`}>{children}</nav>;
  }
  ```

- [ ] **Step 3: Crear `LandingNav` (Server Component).** Crear `components/landing/LandingNav.tsx` SIN `'use client'`, moviendo el contenido interno del nav (`app/page.tsx:283-304`, el `<div className="container-l l-nav-row">...</div>`) como children de `NavShell`:
  ```tsx
  import Link from "next/link";
  import { BrandLogo } from "./icons";
  import { NavShell } from "./NavShell";

  export function LandingNav() {
    return (
      <NavShell>
        <div className="container-l l-nav-row">
          <Link href="/" className="l-brand">
            <span className="l-brand-mark">
              <BrandLogo />
            </span>
            1to1 Studio
          </Link>
          <div className="l-nav-links">
            <a href="#producto">Producto</a>
            <a href="#modelos">Modelos</a>
            <a href="#precios">Precios</a>
            <a href="#faq">Preguntas</a>
          </div>
          <div className="l-nav-cta">
            <Link href="/login" className="btn-l btn-l-ghost">
              Iniciar sesion
            </Link>
            <Link href="/signup" className="btn-l btn-l-primary">
              Empezar gratis
            </Link>
          </div>
        </div>
      </NavShell>
    );
  }
  ```

- [ ] **Step 4: Limpiar `app/page.tsx`.** Eliminar el estado `scrolled` y su `useEffect` (lineas 270-275). Reemplazar el bloque `<nav className={...}>...</nav>` (281-305) por `<LandingNav />`. Agregar import:
  ```ts
  import { LandingNav } from "@/components/landing/LandingNav";
  ```
  Ya no se usan `useEffect` ni `useState` en `app/page.tsx`: eliminar por completo la linea `import { useEffect, useState } from "react";`.

- [ ] **Step 5: Verificacion + commit.** Correr `pnpm typecheck && pnpm lint && pnpm test`.
  Expected: typecheck limpio, lint sin imports muertos, suite verde.
  Smoke manual: en `/`, al hacer scroll > 12px el nav cambia su `border-bottom` (clase `scrolled`); brand y links siguen funcionando.
  Commit: `git commit -am "refactor(landing): nav como LandingNav (SC) + isla NavShell/useScrolled"`.

---

### Task S4.7: Extraer `Hero` a `components/landing/Hero.tsx` (Server Component)

Mueve el `<header className="l-hero">` completo. La unica parte interactiva (el prompt tipeado) ya es `<TypingPrompt/>` (S4.3). El hero shot usa `next/image`, valido en Server Component.

**Files:**
- Create: `components/landing/Hero.tsx`
- Modify: `app/page.tsx` (reemplazar el bloque `<header className="l-hero">...</header>` 307-446 por `<Hero/>`; quitar `landingImages.hero` del objeto local)

**Interfaces:**
- Consumes: `ArrowIcon`, `SparkleIcon` de `@/components/landing/icons` (S4.2); `TypingPrompt` de `@/components/landing/TypingPrompt` (S4.3).
- Produces:
  ```ts
  // components/landing/Hero.tsx
  export function Hero(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear `Hero.tsx`.** Crear `components/landing/Hero.tsx` SIN `'use client'`, moviendo verbatim el `<header className="l-hero">...</header>` (`app/page.tsx:308-446`). Cambios minimos:
  - Imports:
    ```ts
    import Link from "next/link";
    import Image from "next/image";
    import { ArrowIcon, SparkleIcon } from "./icons";
    import { TypingPrompt } from "./TypingPrompt";

    const HERO_IMAGE = "/landing/gen-4.jpg";
    ```
  - El bloque del prompt (368-371) ya es `<TypingPrompt />` desde S4.3 — mantenerlo.
  - El `<Image src={landingImages.hero} ...>` (linea 430) pasa a `<Image src={HERO_IMAGE} ...>`. Resto de props identicas (`alt="Generacion de ejemplo" fill priority sizes="(max-width: 900px) 90vw, 600px" className="object-cover"`).
  - **Nota:** conservar TODOS los `style={{...}}` inline tal cual (la migracion a clases es S4.11; aqui es movimiento puro).

- [ ] **Step 2: Limpiar `app/page.tsx`.** Reemplazar el bloque `<header className="l-hero">...</header>` (307-446) por `<Hero />`. En el objeto `landingImages` (259-268), eliminar la entrada `hero: '/landing/gen-4.jpg',`. Agregar import:
  ```ts
  import { Hero } from "@/components/landing/Hero";
  ```

- [ ] **Step 3: Verificacion + commit.** Correr `pnpm typecheck && pnpm test`.
  Expected: typecheck limpio, suite verde.
  Smoke manual: en `/`, el hero (titulo "Create Beyond Limits", CTAs, hero shot con la imagen y el prompt tipeado) se ve identico.
  Commit: `git commit -am "refactor(landing): extrae Hero (SC) con TypingPrompt island"`.

---

### Task S4.8: Extraer `BentoSection` a `components/landing/BentoSection.tsx` (Server Component)

Mueve el `<section className="l-bento-section">`. Renderiza las islas `BentoWave` (S4.4) y `AnimatedChat` (S4.5).

**Files:**
- Create: `components/landing/BentoSection.tsx`
- Modify: `app/page.tsx` (reemplazar `<section className="l-bento-section" id="features">...</section>` 448-570 por `<BentoSection/>`; quitar `bento1a/b/c` y `bento2` del objeto local; borrar el objeto `landingImages` ya vacio; quitar import `Image` si dejo de usarse en page)

**Interfaces:**
- Consumes: `BentoWave` de `@/components/landing/BentoWave` (S4.4); `AnimatedChat` de `@/components/landing/AnimatedChat` (S4.5).
- Produces:
  ```ts
  // components/landing/BentoSection.tsx
  export function BentoSection(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Crear `BentoSection.tsx`.** Crear `components/landing/BentoSection.tsx` SIN `'use client'`, moviendo verbatim el `<section className="l-bento-section" id="features">...</section>` (`app/page.tsx:449-570`). Imports + constantes de imagen locales:
  ```ts
  import Image from "next/image";
  import { BentoWave } from "./BentoWave";
  import { AnimatedChat } from "./AnimatedChat";

  const BENTO_IMG_1A = "/landing/gen-2.jpg";
  const BENTO_IMG_1B = "/landing/gen-3.jpg";
  const BENTO_IMG_1C = "/landing/gen-4.jpg";
  const BENTO_IMG_2 = "/landing/gen-1.jpg";
  ```
  Sustituir en el JSX: `landingImages.bento1a` -> `BENTO_IMG_1A`, `bento1b` -> `BENTO_IMG_1B`, `bento1c` -> `BENTO_IMG_1C`, `bento2` -> `BENTO_IMG_2` (lineas 472/475/478/501). `<BentoWave />` (553) y `<AnimatedChat />` (565) quedan igual. Conservar los `style={{...}}` inline (migracion en S4.11).

- [ ] **Step 2: Limpiar `app/page.tsx`.** Reemplazar el bloque del bento (448-570) por `<BentoSection />`. Eliminar el objeto `landingImages` por completo (ya solo le quedaban `bento1a/b/c`, `bento2` y los muertos `chat1/2/3`) — esto borra el **codigo muerto** `chat1/2/3`. Agregar import:
  ```ts
  import { BentoSection } from "@/components/landing/BentoSection";
  ```
  Si `Image` ya no se usa en `app/page.tsx` (el hero salio en S4.7 y el bento aqui), eliminar `import Image from "next/image";`.

- [ ] **Step 3: Verificacion + commit.** Correr `pnpm typecheck && pnpm lint && pnpm test`.
  Expected: typecheck limpio, lint sin imports muertos ni variables sin usar, suite verde.
  Smoke manual: en `/`, las 4 cards del bento (Imagen con stack de 3 tiles, Video con play, Audio con onda, Edicion conversacional con chat) se ven identicas.
  Commit: `git commit -am "refactor(landing): extrae BentoSection (SC) + borra landingImages muerto (chat1/2/3)"`.

---

### Task S4.9: Extraer secciones estaticas restantes (Models, Pricing, Faq, Cta, Footer)

Cinco Server Components puros sin hooks ni interactividad. Movimiento JSX verbatim.

**Files:**
- Create: `components/landing/ModelsSection.tsx`
- Create: `components/landing/PricingSection.tsx`
- Create: `components/landing/FaqSection.tsx`
- Create: `components/landing/CtaSection.tsx`
- Create: `components/landing/LandingFooter.tsx`
- Modify: `app/page.tsx` (reemplazar bloques 572-676, 678-797, 799-845, 847-864, 866-906 por los componentes; quitar import `Link` si dejo de usarse en page)

**Interfaces:**
- Consumes: `CheckIcon`, `CreditIcon` (Pricing/Models), `BrandLogo` (Footer), `ArrowIcon` (Cta) de `@/components/landing/icons`.
- Produces:
  ```ts
  export function ModelsSection(): React.JSX.Element;
  export function PricingSection(): React.JSX.Element;
  export function FaqSection(): React.JSX.Element;
  export function CtaSection(): React.JSX.Element;
  export function LandingFooter(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: `ModelsSection.tsx`.** Crear el archivo (sin `'use client'`) moviendo verbatim `<section className="l-models-section" id="modelos">...</section>` (`app/page.tsx:573-676`). Import: `import { CheckIcon } from "./icons";`.

- [ ] **Step 2: `PricingSection.tsx`.** Crear el archivo moviendo verbatim `<section className="l-pricing-section" id="precios">...</section>` (`679-797`). Imports:
  ```ts
  import Link from "next/link";
  import { CheckIcon, CreditIcon } from "./icons";
  ```

- [ ] **Step 3: `FaqSection.tsx`.** Crear el archivo moviendo verbatim `<section className="l-faq-section" id="faq">...</section>` (`800-845`). Sin imports (solo `<details>`/`<summary>` estaticos).

- [ ] **Step 4: `CtaSection.tsx`.** Crear el archivo moviendo verbatim `<section className="l-cta-section">...</section>` (`848-864`). Imports:
  ```ts
  import Link from "next/link";
  import { ArrowIcon } from "./icons";
  ```

- [ ] **Step 5: `LandingFooter.tsx`.** Crear el archivo moviendo verbatim `<footer className="l-footer">...</footer>` (`867-906`). Imports:
  ```ts
  import Link from "next/link";
  import { BrandLogo } from "./icons";
  ```

- [ ] **Step 6: Limpiar `app/page.tsx`.** Reemplazar los cinco bloques por `<ModelsSection />`, `<PricingSection />`, `<FaqSection />`, `<CtaSection />`, `<LandingFooter />`. Agregar imports:
  ```ts
  import { ModelsSection } from "@/components/landing/ModelsSection";
  import { PricingSection } from "@/components/landing/PricingSection";
  import { FaqSection } from "@/components/landing/FaqSection";
  import { CtaSection } from "@/components/landing/CtaSection";
  import { LandingFooter } from "@/components/landing/LandingFooter";
  ```
  Si `Link` ya no se usa en `app/page.tsx`, eliminar `import Link from "next/link";`.

- [ ] **Step 7: Verificacion + commit.** Correr `pnpm typecheck && pnpm lint && pnpm test`.
  Expected: typecheck limpio, lint sin imports muertos, suite verde.
  Smoke manual: en `/`, secciones Modelos, Precios, Preguntas (FAQ con el primer item `open`), CTA final y footer identicas.
  Commit: `git commit -am "refactor(landing): extrae Models/Pricing/Faq/Cta/Footer como Server Components"`.

---

### Task S4.10: Flip `app/page.tsx` a Server Component + exportar `metadata` (build obligatorio)

En este punto `app/page.tsx` ya no contiene ningun hook ni estado: todo lo interactivo vive en islas. Se elimina `'use client'`, se convierte a Server Component de composicion y se agrega `metadata`/`openGraph` (antes imposible por ser cliente).

**Files:**
- Modify: `app/page.tsx` (reescritura del archivo completo: quitar `'use client'`, imports muertos, fragment `<>`; agregar `export const metadata`)

**Interfaces:**
- Consumes: todas las secciones de `@/components/landing/*` (S4.6-S4.9).
- Produces:
  ```ts
  // app/page.tsx
  export const metadata: import("next").Metadata;
  export default function LandingPage(): React.JSX.Element;
  ```

**Steps:**
- [ ] **Step 1: Reescribir `app/page.tsx`.** Dejar el archivo asi (Server Component, sin `'use client'`):
  ```tsx
  import type { Metadata } from "next";
  import "./landing.css";
  import { LandingNav } from "@/components/landing/LandingNav";
  import { Hero } from "@/components/landing/Hero";
  import { BentoSection } from "@/components/landing/BentoSection";
  import { ModelsSection } from "@/components/landing/ModelsSection";
  import { PricingSection } from "@/components/landing/PricingSection";
  import { FaqSection } from "@/components/landing/FaqSection";
  import { CtaSection } from "@/components/landing/CtaSection";
  import { LandingFooter } from "@/components/landing/LandingFooter";

  export const metadata: Metadata = {
    title: { absolute: "1to1 Studio — Create Beyond Limits" },
    description:
      "Genera imagenes, videos y audio de alta calidad con los mejores modelos del mercado. Una sola herramienta para todo tu trabajo creativo, sin curva de aprendizaje.",
    openGraph: {
      title: "1to1 Studio — Create Beyond Limits",
      description:
        "Imagen, video y audio con IA bajo una misma interfaz. 500 creditos gratis al registrarte.",
      type: "website",
    },
  };

  export default function LandingPage() {
    return (
      <div className="landing-page">
        <LandingNav />
        <Hero />
        <BentoSection />
        <ModelsSection />
        <PricingSection />
        <FaqSection />
        <CtaSection />
        <LandingFooter />
      </div>
    );
  }
  ```
  (Nota: `title.absolute` evita que el template `%s · 1to1 Studio` de `app/layout.tsx:24-27` duplique la marca.)

- [ ] **Step 2: `pnpm typecheck`.** Expected: exit 0, sin errores.

- [ ] **Step 3: `pnpm build` (OBLIGATORIO — el unico que valida la frontera RSC/cliente y el `export const metadata`).** Correr `pnpm build`.
  Expected: build OK (`Compiled successfully`), `/` aparece como ruta estatica (prerendered) en el resumen de rutas. Si el build falla con "You are attempting to export metadata from a component marked with use client" o errores de frontera cliente/servidor, revisar que ningun componente importado por `app/page.tsx` arrastre `'use client'` indebidamente.
  Recordatorio: `typecheck` y `lint` NO detectan estos fallos de frontera/metadata; solo `build` los ve.

- [ ] **Step 4: Verificacion + commit.** Correr `pnpm test && pnpm lint`.
  Expected: suite verde, lint limpio.
  Smoke manual: `pnpm dev`, abrir `/`; revisar en DevTools que el `<title>` sea "1to1 Studio — Create Beyond Limits" y que existan `<meta property="og:title">`/`og:description`. Verificar que toda la landing se vea y se comporte igual (tipeo, scroll-nav, onda, chat).
  Commit: `git commit -am "refactor(landing): app/page.tsx como Server Component + metadata/openGraph"`.

---

### Task S4.11: Mover los muros de estilo inline del hero shot y card de video a clases en `app/landing.css`

Cosmetica final: extraer los `style={{...}}` multi-propiedad (los "muros") a clases CSS con declaraciones identicas. No cambia comportamiento visual.

**Files:**
- Modify: `app/landing.css` (agregar clases nuevas; ubicarlas junto a las relacionadas existentes — `.l-shot-*` cerca de la linea 347, la card de video cerca de `.l-b1-tile` linea 602)
- Modify: `components/landing/Hero.tsx` (reemplazar muros inline por `className`)
- Modify: `components/landing/BentoSection.tsx` (reemplazar el muro de la card de video por `className`)

**Interfaces:**
- Consumes: (ninguno de Ola 1)
- Produces: clases CSS nuevas (sin API TS). Clases a crear (declaraciones copiadas verbatim de los `style` inline correspondientes):
  - `.l-shot-model-select` (de `Hero.tsx`, el `<div style>` del selector "Nano Banana Pro", origen `app/page.tsx:355`)
  - `.l-shot-model-hint` (el `<div style>` "Calidad editorial...", origen `:359`)
  - `.l-shot-badge` (el `<div style>` "Sin brand kit", origen `:385`)
  - `.l-shot-toggle` (los dos `<div style>` "Sin fondo"/"Texto en imagen", origen `:409` y `:413`)
  - `.l-shot-toggle-box` (el cuadradito `12x12` interno, origen `:410`/`:414`)
  - `.l-shot-result-meta` (la barra `mono` sobre la imagen, origen `:432`)
  - `.l-shot-download` (el boton circular de descarga, origen `:436`)
  - `.l-b2-video` (el contenedor `aspectRatio 16/9` de la card Video, origen `:491-499`)
  - `.l-b2-play` (el boton play circular, origen `:510-521`)
  - `.l-b2-time` (el badge `mono` "0:05 / 0:10", origen `:527-538`)

**Steps:**
- [ ] **Step 1: Agregar las clases a `app/landing.css`.** Escribir cada clase con las MISMAS declaraciones que el `style` inline que reemplaza (mismos valores px, `var(--...)`, etc.). Ejemplo para una de ellas (resto analogo, copiando verbatim de los inline):
  ```css
  .l-b2-video {
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid var(--hairline);
    position: relative;
  }
  .l-b2-play {
    width: 36px;
    height: 36px;
    border-radius: 999px;
    background: rgba(11, 15, 25, 0.6);
    border: 1px solid var(--hairline-strong);
    display: grid;
    place-items: center;
    backdrop-filter: blur(6px);
  }
  ```
  (Las demas — `.l-shot-model-select`, `.l-shot-model-hint`, etc. — se transcriben igual desde sus `style` de origen listados arriba.)

- [ ] **Step 2: Reemplazar inline por `className` en los componentes.** En `Hero.tsx` y `BentoSection.tsx`, sustituir cada `style={{...}}` de la lista por su `className` correspondiente, eliminando el objeto inline. Mantener intactos los `style` de un solo valor dinamico que no migran (p. ej. `style={{ gridColumn: "1 / -1", gridRow: "1 / -1", marginTop: 0, position: "relative" }}` del `.l-shot-img` se puede dejar o migrar a `.l-shot-img-hero` — incluirlo como clase `.l-shot-img-hero` con esas 4 props si se quiere cerrar el muro).

- [ ] **Step 3: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test && pnpm lint`.
  Expected: typecheck limpio, build OK, suite verde, lint limpio.
  Smoke manual (critico por ser cambio visual): `pnpm dev`, comparar `/` lado a lado contra la version previa: el hero shot (selector de modelo, hint azul, toggles, barra meta sobre la imagen, boton descarga) y la card de Video (marco 16:9, boton play, badge de tiempo) deben verse pixel-identicos. Verificar tambien en viewport movil (<= 900px) que no cambio el layout.
  Commit: `git commit -am "refactor(landing): muros de estilo inline a clases en landing.css"`.

- [ ] **Step 4: Cierre de unidad.** Confirmar arbol final: `lib/landing/` (wave.ts + test) y `components/landing/` (icons, hooks/, TypingPrompt, BentoWave, AnimatedChat, NavShell, LandingNav, Hero, BentoSection, ModelsSection, PricingSection, FaqSection, CtaSection, LandingFooter) creados; `app/page.tsx` reducido a Server Component de composicion con `metadata`. Correr una vez mas `pnpm test && pnpm build` como verificacion final de la unidad.
  Expected: suite verde, build OK.


---

## Ola 3 — Server actions (gotcha use server)

*Consumen los helpers de la Ola 1. Cada task que toca un archivo `'use server'` DEBE correr `pnpm build` — typecheck/lint no detectan el gotcha.*

### Unidad S5: server-actions/campaigns.ts (2453 lineas, 25 acciones) -> directorio por dominio + lib/campaigns/

**Objetivo.** Partir el barrel monolitico `server-actions/campaigns.ts` (26 acciones, 2453 lineas) en archivos `campaign-*.ts` por subdominio (cada uno `'use server'`, thin) y mover la logica determinista a `lib/campaigns/` (sin `'use server'`, testeable con vitest). El comportamiento es IDENTICO: ninguna firma publica cambia, `@/server-actions/campaigns` sigue exportando exactamente los mismos nombres (los 6 consumidores en `components/` no se tocan). La red de seguridad es: 4 tests de caracterizacion nuevos para las funciones puras + la suite vitest existente verde + `pnpm typecheck` + `pnpm build` + smoke manual del Studio.

Realizamos el "directorio por dominio" como **modulos hermanos `campaign-*.ts`** (no una subcarpeta `campaigns/`) para NO sombrear la resolucion de `@/server-actions/campaigns` (un archivo `campaigns.ts` y una carpeta `campaigns/index.ts` compiten por la misma ruta). `campaigns.ts` queda como el **barrel `'use server'`** que re-exporta las acciones (funciones async) de los hermanos y re-exporta los tipos via `export type` — exactamente el patron que la Ola 1 prescribe ("nunca objetos/valores desde el barrel `'use server'`; tipos via `export type`").

GOTCHA `'use server'` (recordatorio para TODOS los tasks de esta unidad): un archivo `'use server'` solo puede exportar funciones async (y tipos via `export type`). Constantes (`DRAFT_MODEL`, `FINAL_MODEL`), esquemas zod locales y helpers NO se exportan desde esos archivos — los compartidos van a `lib/campaigns/shared.ts`, los locales quedan como `const` no exportadas. **`pnpm typecheck` y `pnpm lint` NO detectan la violacion; SOLO `pnpm build` la ve.** Por eso cada task que toca un archivo `'use server'` corre `pnpm build` y espera exito.

**File Structure**

Nuevos modulos puros (sin `'use server'`, testeables):
- `lib/campaigns/shared.ts` — constantes `DRAFT_MODEL`/`FINAL_MODEL` + helpers puros `coerceGoal`, `resolveProductImageIds`, `toFormatsMap`, `itemWorkspaceId` (dedup del cast `campaigns!inner(workspace_id)`).
- `lib/campaigns/variant-prompts.ts` — `buildVariantPrompt` (los 4 modos de `createVariantAction`: extend/change_action/bridge/replace_character + sufijo de idioma).
- `lib/campaigns/image-pack.ts` — `buildImagePackSpecs` (mix posts/banners/stills + `compile` FLUX de `buildImagePackAction`).
- `lib/campaigns/idea-matcher-resolve.ts` — `toDirectedIdea` (puro, el triple `directed.push`) + `resolveDirectedFromMatches` (orquesta el loop de `matched.matches` con la creacion de formato custom inyectada).

Nuevos archivos de acciones (`'use server'`, thin):
- `server-actions/campaign-plan.ts` — `generatePlanAction`.
- `server-actions/campaign-items.ts` — `updateCampaignItemAction`, `addCampaignItemAction`, `redoSamplesAction`, `deleteCampaignItemAction`, `updateItemScheduleAction`, `toggleWinnerAction`.
- `server-actions/campaign-generate.ts` — `generateItemAction` (+ `export type RegenMode`), `approveBatchAction`, `requestFinalAction`.
- `server-actions/campaign-templates.ts` — `distillTemplateAction`, `generateSeriesAction`, `createVariantAction`.
- `server-actions/campaign-delivery.ts` — `exportCampaignCsvAction`, `buildImagePackAction`, `previewItemPromptAction`.
- `server-actions/campaign-sequence.ts` — `mergeSequenceAction`, `assignSequenceLocationAction`.

Modificado:
- `server-actions/campaigns.ts` — conserva las 8 acciones de colecciones V1 + lifecycle studio (`createCampaignAction`, `updateCampaignAction`, `deleteCampaignAction`, `updateCampaignStudioAction`, `setCampaignStatusAction`, `assignCampaignAction`, `listCampaignsAction`, `createCampaignStudioAction`) y se vuelve el barrel `'use server'` que re-exporta los hermanos. Su `type Result` local se reemplaza por el de Ola 1.

Tests nuevos: `lib/campaigns/shared.test.ts`, `lib/campaigns/variant-prompts.test.ts`, `lib/campaigns/image-pack.test.ts`, `lib/campaigns/idea-matcher-resolve.test.ts`.

Orden: primero los 4 modulos puros con su test (S5.1-S5.4, no tocan nada `'use server'`, la app no cambia). Luego los 6 splits que CONSUMEN esos modulos (S5.5-S5.10). Cierre (S5.11) convierte `campaigns.ts` en barrel limpio y verifica todo. Tras CADA task el repo compila y la suite pasa.

---

### Task S5.1: lib/campaigns/shared.ts (constantes + helpers puros)

**Files:**
- Create: `lib/campaigns/shared.ts`
- Test: `lib/campaigns/shared.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DRAFT_MODEL: 'bytedance/seedance-2.0/fast/reference-to-video';
  export const FINAL_MODEL: 'bytedance/seedance-2.0/reference-to-video';
  export type CampaignGoal = 'awareness' | 'conversion' | 'mixed';
  export function coerceGoal(raw: unknown): CampaignGoal;
  export function resolveProductImageIds(
    kit: { product_image_ids?: unknown; reference_image_ids?: unknown } | null | undefined,
  ): string[];
  export type FormatMapValue = {
    id: string; slug: string; name: string;
    register: string | null; camera_style: string | null; pacing: string | null;
    required_refs: string[]; default_duration_s: number; default_audio: boolean;
  };
  export function toFormatsMap(rows: Array<Record<string, unknown>>): Map<string, FormatMapValue>;
  export function itemWorkspaceId(item: unknown): string | undefined;
  ```
- Consumes: nada (modulo puro, sin imports de runtime; NO `'use server'`, NO `'server-only'`).

**Steps:**
- [ ] **Step 1: Escribir el test de caracterizacion primero.** Crear `lib/campaigns/shared.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    DRAFT_MODEL, FINAL_MODEL, coerceGoal, resolveProductImageIds, toFormatsMap, itemWorkspaceId,
  } from './shared';

  describe('constants', () => {
    it('mantiene los slugs de tier draft y final', () => {
      expect(DRAFT_MODEL).toBe('bytedance/seedance-2.0/fast/reference-to-video');
      expect(FINAL_MODEL).toBe('bytedance/seedance-2.0/reference-to-video');
    });
  });

  describe('coerceGoal', () => {
    it('pasa goals validos', () => {
      expect(coerceGoal('awareness')).toBe('awareness');
      expect(coerceGoal('conversion')).toBe('conversion');
      expect(coerceGoal('mixed')).toBe('mixed');
    });
    it('cae a mixed con valores invalidos/null', () => {
      expect(coerceGoal('weird')).toBe('mixed');
      expect(coerceGoal(null)).toBe('mixed');
      expect(coerceGoal(undefined)).toBe('mixed');
    });
  });

  describe('resolveProductImageIds', () => {
    it('prefiere product_image_ids cuando tiene elementos', () => {
      expect(resolveProductImageIds({ product_image_ids: ['a'], reference_image_ids: ['b'] })).toEqual(['a']);
    });
    it('cae a reference_image_ids cuando product esta vacio', () => {
      expect(resolveProductImageIds({ product_image_ids: [], reference_image_ids: ['b'] })).toEqual(['b']);
    });
    it('devuelve [] cuando no hay nada o kit es null', () => {
      expect(resolveProductImageIds(null)).toEqual([]);
      expect(resolveProductImageIds({})).toEqual([]);
    });
  });

  describe('toFormatsMap', () => {
    it('mapea por id con required_refs default []', () => {
      const map = toFormatsMap([
        { id: 'f1', slug: 's1', name: 'N1', register: null, camera_style: null, pacing: null, required_refs: null, default_duration_s: 8, default_audio: true },
        { id: 'f2', slug: 's2', name: 'N2', register: 'r', camera_style: 'c', pacing: 'p', required_refs: ['product'], default_duration_s: 12, default_audio: false },
      ]);
      expect(map.get('f1')?.required_refs).toEqual([]);
      expect(map.get('f2')).toMatchObject({ slug: 's2', register: 'r', required_refs: ['product'], default_duration_s: 12, default_audio: false });
      expect(map.size).toBe(2);
    });
  });

  describe('itemWorkspaceId', () => {
    it('extrae campaigns.workspace_id del join', () => {
      expect(itemWorkspaceId({ id: 'x', campaigns: { workspace_id: 'ws-1' } })).toBe('ws-1');
    });
    it('devuelve undefined si falta el join', () => {
      expect(itemWorkspaceId({ id: 'x' })).toBeUndefined();
      expect(itemWorkspaceId(null)).toBeUndefined();
    });
  });
  ```
- [ ] **Step 2: Correr el test y verificar que FALLA (modulo no existe).** `pnpm test lib/campaigns/shared.test.ts`
  Expected: vitest aborta con "Failed to resolve import './shared'" / "Cannot find module" — 0 passed.
- [ ] **Step 3: Implementar `lib/campaigns/shared.ts`** con la logica EXACTA hoy inline en `campaigns.ts`:
  ```ts
  export const DRAFT_MODEL = 'bytedance/seedance-2.0/fast/reference-to-video';
  export const FINAL_MODEL = 'bytedance/seedance-2.0/reference-to-video';

  export type CampaignGoal = 'awareness' | 'conversion' | 'mixed';

  // Copia exacta de campaigns.ts:640-642 / 895-897 / 1666-1668.
  export function coerceGoal(raw: unknown): CampaignGoal {
    return (['awareness', 'conversion', 'mixed'].includes(raw as string) ? raw : 'mixed') as CampaignGoal;
  }

  // Copia exacta del fallback product->reference de campaigns.ts:241-243 / 404-406 / 2138-2141.
  export function resolveProductImageIds(
    kit: { product_image_ids?: unknown; reference_image_ids?: unknown } | null | undefined,
  ): string[] {
    const product = (kit?.product_image_ids as string[] | null) ?? [];
    const reference = (kit?.reference_image_ids as string[] | null) ?? [];
    return product.length ? product : reference;
  }

  export type FormatMapValue = {
    id: string; slug: string; name: string;
    register: string | null; camera_style: string | null; pacing: string | null;
    required_refs: string[]; default_duration_s: number; default_audio: boolean;
  };

  // Copia exacta del Map de campaigns.ts:1278-1293 / 1350-1365.
  export function toFormatsMap(rows: Array<Record<string, unknown>>): Map<string, FormatMapValue> {
    return new Map(
      rows.map((f) => [
        f.id as string,
        {
          id: f.id as string,
          slug: f.slug as string,
          name: f.name as string,
          register: (f.register as string | null) ?? null,
          camera_style: (f.camera_style as string | null) ?? null,
          pacing: (f.pacing as string | null) ?? null,
          required_refs: (f.required_refs as string[]) ?? [],
          default_duration_s: f.default_duration_s as number,
          default_audio: f.default_audio as boolean,
        },
      ]),
    );
  }

  // Dedup del cast repetido `(item as { campaigns?: { workspace_id?: string } })?.campaigns?.workspace_id`
  // (campaigns.ts:789, 994, 1029, 1416, 1606, 2004, 2229).
  export function itemWorkspaceId(item: unknown): string | undefined {
    return (item as { campaigns?: { workspace_id?: string } } | null)?.campaigns?.workspace_id;
  }
  ```
- [ ] **Step 4: Correr el test y verificar que PASA.** `pnpm test lib/campaigns/shared.test.ts`
  Expected: "Test Files 1 passed", todos los `it` verdes.
- [ ] **Step 5: typecheck.** `pnpm typecheck`
  Expected: sin errores (exit 0). (No hay `'use server'` tocado, no hace falta build aqui.)
- [ ] **Step 6: commit.** `git add lib/campaigns/shared.ts lib/campaigns/shared.test.ts && git commit -m "test(campaigns): helpers puros compartidos (coerceGoal, formatsMap, productImageIds)"`
  Expected: 1 commit, 2 archivos.

---

### Task S5.2: lib/campaigns/variant-prompts.ts (buildVariantPrompt)

**Files:**
- Create: `lib/campaigns/variant-prompts.ts`
- Test: `lib/campaigns/variant-prompts.test.ts`

**Interfaces:**
- Consumes: `import { DIALOGUE_LANGUAGE } from '@/lib/prompt-director/compilers/seedance';` (constante pura).
- Produces:
  ```ts
  export type VariantPromptInput =
    | { mode: 'extend'; extendSeconds: number; continuation?: string }
    | { mode: 'change_action'; newAction: string; sourceDuration: number }
    | { mode: 'bridge'; bridgeSeconds: number }
    | { mode: 'replace_character'; sourceDuration: number };
  export function buildVariantPrompt(
    input: VariantPromptInput,
    language: 'es' | 'en',
  ): { prompt: string; durationS: number };
  ```

**Steps:**
- [ ] **Step 1: Test de caracterizacion primero.** Crear `lib/campaigns/variant-prompts.test.ts` capturando la salida ACTUAL (`createVariantAction` campaigns.ts:1831-1916):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildVariantPrompt } from './variant-prompts';

  describe('buildVariantPrompt', () => {
    it('extend: duracion = la extension y mete la continuacion con punto', () => {
      const { prompt, durationS } = buildVariantPrompt(
        { mode: 'extend', extendSeconds: 6, continuation: 'she smiles' }, 'es');
      expect(durationS).toBe(6);
      expect(prompt).toContain('Extend @Video1 by 6 seconds.');
      expect(prompt).toContain('she smiles.');
      expect(prompt).toContain('No on-screen text');
    });

    it('change_action: clampa la duracion del origen a [4,15] y conserva sujeto/escena', () => {
      expect(buildVariantPrompt({ mode: 'change_action', newAction: 'pours the drink', sourceDuration: 20 }, 'es').durationS).toBe(15);
      const { prompt } = buildVariantPrompt({ mode: 'change_action', newAction: 'pours the drink', sourceDuration: 8 }, 'es');
      expect(prompt).toContain('change the action and outcome: pours the drink.');
    });

    it('bridge: duracion = bridgeSeconds y conecta @Video1 con @Video2', () => {
      const { prompt, durationS } = buildVariantPrompt({ mode: 'bridge', bridgeSeconds: 5 }, 'es');
      expect(durationS).toBe(5);
      expect(prompt).toContain('5-second bridge scene that connects @Video1 to @Video2');
    });

    it('replace_character: clampa y pide reemplazar al presentador por @Image1', () => {
      const { prompt, durationS } = buildVariantPrompt({ mode: 'replace_character', sourceDuration: 3 }, 'es');
      expect(durationS).toBe(4);
      expect(prompt).toContain('replace the presenter with the person in @Image1');
    });

    it('agrega la cadencia de idioma al final (es != en)', () => {
      const es = buildVariantPrompt({ mode: 'extend', extendSeconds: 4 }, 'es').prompt;
      const en = buildVariantPrompt({ mode: 'extend', extendSeconds: 4 }, 'en').prompt;
      expect(es).not.toBe(en);
    });
  });
  ```
- [ ] **Step 2: Correr y ver FALLO.** `pnpm test lib/campaigns/variant-prompts.test.ts`
  Expected: no resuelve `./variant-prompts` — FAIL.
- [ ] **Step 3: Implementar `lib/campaigns/variant-prompts.ts`** moviendo VERBATIM la construccion de `prompt`/`durationS` de los 4 ramos (campaigns.ts:1831-1913) + el sufijo de idioma (campaigns.ts:1916 `prompt = \`${prompt} ${DIALOGUE_LANGUAGE[variantLanguage]}\``). Estructura:
  ```ts
  import { DIALOGUE_LANGUAGE } from '@/lib/prompt-director/compilers/seedance';

  export type VariantPromptInput =
    | { mode: 'extend'; extendSeconds: number; continuation?: string }
    | { mode: 'change_action'; newAction: string; sourceDuration: number }
    | { mode: 'bridge'; bridgeSeconds: number }
    | { mode: 'replace_character'; sourceDuration: number };

  export function buildVariantPrompt(
    input: VariantPromptInput,
    language: 'es' | 'en',
  ): { prompt: string; durationS: number } {
    let prompt: string;
    let durationS: number;
    if (input.mode === 'extend') {
      durationS = input.extendSeconds;
      const continuation = input.continuation?.trim()
        ? ` ${input.continuation.trim().replace(/\.?$/, '.')}`
        : '';
      prompt =
        `Extend @Video1 by ${durationS} seconds.${continuation} ` +
        'Continue the motion smoothly from the last frame with no cuts: same camera angle, lighting, ' +
        'pacing and subject appearance. No on-screen text, no captions, no watermarks.';
    } else if (input.mode === 'change_action') {
      durationS = Math.min(15, Math.max(4, input.sourceDuration));
      const action = input.newAction.trim().replace(/\.?$/, '.');
      prompt =
        'In @Video1, keep the subject identity, the setting, the lighting and the camera style ' +
        `exactly as shown; change the action and outcome: ${action} ` +
        'One continuous take, no cuts. No on-screen text, no captions, no watermarks.';
    } else if (input.mode === 'bridge') {
      durationS = input.bridgeSeconds;
      prompt =
        `Generate a ${durationS}-second bridge scene that connects @Video1 to @Video2: ` +
        'start from the final frame of @Video1 and end matching the first frame of @Video2. ' +
        'Maintain continuity of subject, environment, lighting and camera style throughout; ' +
        'one smooth camera move, no cuts. No on-screen text, no captions, no watermarks.';
    } else {
      durationS = Math.min(15, Math.max(4, input.sourceDuration));
      prompt =
        'In @Video1, replace the presenter with the person in @Image1 — exact appearance from the ' +
        'reference: same face, same hair, same build. Replicate the original actions, gestures, ' +
        'expressions and timing frame by frame. Keep the scene, lighting and camera movements ' +
        'unchanged. No on-screen text, no captions, no watermarks.';
    }
    prompt = `${prompt} ${DIALOGUE_LANGUAGE[language]}`;
    return { prompt, durationS };
  }
  ```
  Nota: el `?? 5`/`?? 5` de extend/bridge y el `?? 5` de replace viven en el caller (vienen del zod default); `buildVariantPrompt` recibe los valores ya resueltos.
- [ ] **Step 4: Correr y ver PASA.** `pnpm test lib/campaigns/variant-prompts.test.ts`
  Expected: 5 `it` verdes.
- [ ] **Step 5: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 6: commit.** `git add lib/campaigns/variant-prompts.ts lib/campaigns/variant-prompts.test.ts && git commit -m "test(campaigns): buildVariantPrompt (4 modos de createVariant)"`

---

### Task S5.3: lib/campaigns/image-pack.ts (buildImagePackSpecs)

**Files:**
- Create: `lib/campaigns/image-pack.ts`
- Test: `lib/campaigns/image-pack.test.ts`

**Interfaces:**
- Consumes: `import { compile } from '@/lib/prompt-director';` (puro, deterministico).
- Produces:
  ```ts
  export type ImagePackSpec = { prompt: string; aspectRatio: '1:1' | '16:9'; kind: string };
  export type ImagePackProduct = { name: string; visualDetails?: string; palette?: string[]; imagePaths: string[] };
  export function buildImagePackSpecs(opts: {
    count: number;
    product: ImagePackProduct;
    scenes: string[];
  }): ImagePackSpec[];
  ```

**Steps:**
- [ ] **Step 1: Test de caracterizacion primero.** Crear `lib/campaigns/image-pack.test.ts` (assert sobre invariantes estables del mix, no sobre el texto completo del compiler):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { buildImagePackSpecs } from './image-pack';

  const product = { name: 'Lumen Water', visualDetails: 'glass bottle', palette: ['#fff'], imagePaths: [] };

  describe('buildImagePackSpecs', () => {
    it('respeta el mix posts(ceil/2)/banners(ceil/4)/stills(resto) para count=8', () => {
      const specs = buildImagePackSpecs({ count: 8, product, scenes: ['a sunlit kitchen'] });
      const byKind = (k: string) => specs.filter((s) => s.kind === k).length;
      // posts=4, banners=2, stills=2
      expect(byKind('post')).toBe(4);
      expect(byKind('banner')).toBe(2);
      expect(byKind('still')).toBe(2);
      expect(specs.length).toBe(8);
    });
    it('posts son 1:1, banners 16:9, stills 1:1', () => {
      const specs = buildImagePackSpecs({ count: 4, product, scenes: ['a city rooftop'] });
      expect(specs.filter((s) => s.kind === 'banner').every((s) => s.aspectRatio === '16:9')).toBe(true);
      expect(specs.filter((s) => s.kind !== 'banner').every((s) => s.aspectRatio === '1:1')).toBe(true);
    });
    it('mete el nombre del producto en cada prompt y nunca prompt vacio', () => {
      const specs = buildImagePackSpecs({ count: 6, product, scenes: ['a studio backdrop'] });
      expect(specs.every((s) => s.prompt.includes('Lumen Water'))).toBe(true);
      expect(specs.every((s) => s.prompt.length > 0)).toBe(true);
    });
  });
  ```
- [ ] **Step 2: Correr y ver FALLO.** `pnpm test lib/campaigns/image-pack.test.ts`
  Expected: no resuelve `./image-pack` — FAIL.
- [ ] **Step 3: Implementar `lib/campaigns/image-pack.ts`** moviendo VERBATIM el bloque de `buildImagePackAction` (campaigns.ts:2160-2202): calculo `posts/banners/stills`, el closure `pushSpec` (que llama `compile({ modelSlug:'flux-2-pro-preview', scenePrompt, aspectRatio }, { product, scene })`) y los 3 loops con los MISMOS literales de prompt:
  ```ts
  import { compile } from '@/lib/prompt-director';

  export type ImagePackSpec = { prompt: string; aspectRatio: '1:1' | '16:9'; kind: string };
  export type ImagePackProduct = { name: string; visualDetails?: string; palette?: string[]; imagePaths: string[] };

  export function buildImagePackSpecs(opts: {
    count: number;
    product: ImagePackProduct;
    scenes: string[];
  }): ImagePackSpec[] {
    const { count, product, scenes } = opts;
    const specs: ImagePackSpec[] = [];
    const posts = Math.ceil(count / 2);
    const banners = Math.ceil(count / 4);
    const stills = count - posts - banners;

    const pushSpec = (scenePrompt: string, sceneFragment: string | undefined, aspectRatio: '1:1' | '16:9', kind: string) => {
      const compiled = compile(
        { modelSlug: 'flux-2-pro-preview', scenePrompt, aspectRatio },
        { product, scene: sceneFragment ? { fragment: sceneFragment } : undefined },
      );
      if (compiled.ok) specs.push({ prompt: compiled.compiled.prompt, aspectRatio, kind });
    };

    for (let i = 0; i < posts; i++) {
      pushSpec(
        `Lifestyle still of the ${product.name} as the natural focus of the scene, social-media ready, no people in frame unless implied by context`,
        scenes[i % scenes.length], '1:1', 'post',
      );
    }
    for (let i = 0; i < banners; i++) {
      pushSpec(
        `Hero banner composition of the ${product.name}: product on one third of the frame, generous clean negative space on the other side for campaign copy, premium minimal styling`,
        undefined, '16:9', 'banner',
      );
    }
    for (let i = 0; i < stills; i++) {
      pushSpec(
        `Studio product still of the ${product.name} on a simple textured surface, no people, label facing the camera, subtle props that suggest the product context`,
        undefined, '1:1', 'still',
      );
    }
    return specs;
  }
  ```
- [ ] **Step 4: Correr y ver PASA.** `pnpm test lib/campaigns/image-pack.test.ts`
  Expected: 3 `it` verdes.
- [ ] **Step 5: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 6: commit.** `git add lib/campaigns/image-pack.ts lib/campaigns/image-pack.test.ts && git commit -m "test(campaigns): buildImagePackSpecs (mix posts/banners/stills)"`

---

### Task S5.4: lib/campaigns/idea-matcher-resolve.ts (toDirectedIdea + resolveDirectedFromMatches)

**Files:**
- Create: `lib/campaigns/idea-matcher-resolve.ts`
- Test: `lib/campaigns/idea-matcher-resolve.test.ts`

**Interfaces:**
- Consumes (solo tipos, sin runtime IO; el IO de DB se INYECTA via callback):
  ```ts
  import type { DirectedIdea, PlannerFormat } from './planner';
  import type { MatcherResult } from '@/lib/prompt-director/format-matcher';
  import type { CustomFormatInput, CustomFormatOutcome } from './custom-format';
  ```
- Produces:
  ```ts
  export type MatchedIdea = MatcherResult['matches'][number];
  export type InventedByName = Map<string, { name: string; description: string }>;
  export function toDirectedIdea(
    match: MatchedIdea, format: PlannerFormat, inventedByName: InventedByName,
  ): DirectedIdea;
  export type ResolveDirectedResult = {
    directed: DirectedIdea[];
    blockers: string[];
    inventedNames: string[];
    createdCustom: boolean;
    matcherError?: 'sin_match';
  };
  export async function resolveDirectedFromMatches(opts: {
    matches: MatchedIdea[];
    formats: PlannerFormat[]; // mutado in-place: los customs creados se agregan (reuse por slug en la misma corrida)
    language: 'es' | 'en';
    recoverCustomFormat: (cf: CustomFormatInput) => Promise<CustomFormatOutcome>;
  }): Promise<ResolveDirectedResult>;
  ```

**Steps:**
- [ ] **Step 1: Test de caracterizacion primero.** Crear `lib/campaigns/idea-matcher-resolve.test.ts`. Helper `fakeMatch(overrides)` que arma un `MatchedIdea` minimo (cast controlado, sin API real):
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { toDirectedIdea, resolveDirectedFromMatches, type MatchedIdea, type InventedByName } from './idea-matcher-resolve';
  import type { PlannerFormat } from './planner';

  const FMT: PlannerFormat = { id: 'fmt-1', slug: 'voz-cercana', name: 'Voz cercana', requiredRefs: ['product'], defaultDurationS: 9, defaultAudio: true };

  function fakeMatch(o: Partial<MatchedIdea> = {}): MatchedIdea {
    return {
      ideaText: 'una idea', formatId: null, customFormat: null, count: 1,
      scenePrompt: 'a person opens the bottle', durationS: null, sceneSummary: null,
      scenes: [], sequenceLabel: null, characterStateHint: null, blocker: null,
      characterIds: [], inventedCharacters: [], ...o,
    } as MatchedIdea;
  }

  describe('toDirectedIdea', () => {
    it('mapea el match a DirectedIdea resolviendo invented desde el map', () => {
      const invented: InventedByName = new Map([['ana', { name: 'Ana', description: 'tall woman' }]]);
      const m = fakeMatch({ count: 2, durationS: 7, inventedCharacters: [{ name: 'Ana', description: 'x' }] as never });
      const d = toDirectedIdea(m, FMT, invented);
      expect(d.format).toBe(FMT);
      expect(d.count).toBe(2);
      expect(d.durationS).toBe(7);
      expect(d.invented).toEqual([{ name: 'Ana', description: 'tall woman' }]);
    });
  });

  describe('resolveDirectedFromMatches', () => {
    it('formatId existente -> 1 directed, sin custom', async () => {
      const r = await resolveDirectedFromMatches({
        matches: [fakeMatch({ formatId: 'fmt-1' })], formats: [FMT], language: 'es',
        recoverCustomFormat: vi.fn(),
      });
      expect(r.directed).toHaveLength(1);
      expect(r.createdCustom).toBe(false);
      expect(r.matcherError).toBeUndefined();
    });

    it('blocker -> va a blockers, no crea item', async () => {
      const r = await resolveDirectedFromMatches({
        matches: [fakeMatch({ blocker: 'idea demasiado vaga' })], formats: [FMT], language: 'es',
        recoverCustomFormat: vi.fn(),
      });
      expect(r.directed).toHaveLength(0);
      expect(r.blockers).toContain('idea demasiado vaga');
      expect(r.matcherError).toBe('sin_match');
    });

    it('customFormat nuevo -> recoverCustomFormat se llama, createdCustom true, formats crece', async () => {
      const cf = { slug: 'nuevo-fmt', name: 'Nuevo', description: '', register: null, cameraStyle: null, pacing: null, requiredRefs: ['product'], defaultDurationS: 8, defaultAudio: true };
      const formats = [FMT];
      const recover = vi.fn().mockResolvedValue({ status: 'created', id: 'fmt-new', slug: 'nuevo-fmt' });
      const r = await resolveDirectedFromMatches({
        matches: [fakeMatch({ customFormat: cf as never })], formats, language: 'es', recoverCustomFormat: recover,
      });
      expect(recover).toHaveBeenCalledOnce();
      expect(r.createdCustom).toBe(true);
      expect(r.directed).toHaveLength(1);
      expect(formats.some((f) => f.slug === 'nuevo-fmt')).toBe(true);
    });

    it('customFormat cuyo slug ya esta en formats -> reusa, NO llama recover', async () => {
      const recover = vi.fn();
      const cf = { slug: 'voz-cercana', name: 'X', description: '', register: null, cameraStyle: null, pacing: null, requiredRefs: ['product'], defaultDurationS: 8, defaultAudio: true };
      const r = await resolveDirectedFromMatches({
        matches: [fakeMatch({ customFormat: cf as never })], formats: [FMT], language: 'es', recoverCustomFormat: recover,
      });
      expect(recover).not.toHaveBeenCalled();
      expect(r.directed).toHaveLength(1);
    });
  });
  ```
- [ ] **Step 2: Correr y ver FALLO.** `pnpm test lib/campaigns/idea-matcher-resolve.test.ts`
  Expected: no resuelve `./idea-matcher-resolve` — FAIL.
- [ ] **Step 3: Implementar `lib/campaigns/idea-matcher-resolve.ts`** trasladando la logica de `generatePlanAction` campaigns.ts:525-622 (poblar `inventedByName`, el branch `blocker`, el branch `formatId`, el branch `customFormat` con reuse-por-slug + `recoverCustomFormat` inyectado + el blocker PD-04 cuando falla la creacion, y el `sin_match` final). `toDirectedIdea` encapsula el triple `directed.push` (campaigns.ts:542-553 / 562-573 / 592-603). Esqueleto:
  ```ts
  import type { DirectedIdea, PlannerFormat } from './planner';
  import type { MatcherResult } from '@/lib/prompt-director/format-matcher';
  import type { CustomFormatInput, CustomFormatOutcome } from './custom-format';

  export type MatchedIdea = MatcherResult['matches'][number];
  export type InventedByName = Map<string, { name: string; description: string }>;

  export function toDirectedIdea(match: MatchedIdea, format: PlannerFormat, inventedByName: InventedByName): DirectedIdea {
    return {
      format,
      count: match.count,
      durationS: match.durationS,
      scenePrompt: match.scenePrompt,
      sceneSummary: match.sceneSummary,
      characterIds: match.characterIds,
      invented: match.inventedCharacters.map((p) => inventedByName.get(p.name.toLowerCase())!),
      scenes: match.scenes,
      sequenceLabel: match.sequenceLabel,
      characterStateHint: match.characterStateHint ?? null,
    };
  }

  export type ResolveDirectedResult = {
    directed: DirectedIdea[]; blockers: string[]; inventedNames: string[];
    createdCustom: boolean; matcherError?: 'sin_match';
  };

  export async function resolveDirectedFromMatches(opts: {
    matches: MatchedIdea[]; formats: PlannerFormat[]; language: 'es' | 'en';
    recoverCustomFormat: (cf: CustomFormatInput) => Promise<CustomFormatOutcome>;
  }): Promise<ResolveDirectedResult> {
    const { matches, formats, language, recoverCustomFormat } = opts;
    const inventedByName: InventedByName = new Map();
    for (const m of matches) for (const p of m.inventedCharacters) {
      const key = p.name.toLowerCase();
      if (!inventedByName.has(key)) inventedByName.set(key, p);
    }
    const directed: DirectedIdea[] = [];
    const blockers: string[] = [];
    let createdCustom = false;
    for (const m of matches) {
      if (m.blocker) { blockers.push(m.blocker); continue; }
      if (m.formatId) {
        const f = formats.find((x) => x.id === m.formatId);
        if (f) directed.push(toDirectedIdea(m, f, inventedByName));
      } else if (m.customFormat) {
        const cf = m.customFormat;
        const existing = formats.find((x) => x.slug === cf.slug);
        if (existing) { directed.push(toDirectedIdea(m, existing, inventedByName)); continue; }
        const outcome = await recoverCustomFormat(cf);
        if (outcome.status === 'created' || outcome.status === 'recovered') {
          const pf: PlannerFormat = {
            id: outcome.id, slug: outcome.slug, name: cf.name,
            requiredRefs: cf.requiredRefs, defaultDurationS: cf.defaultDurationS, defaultAudio: cf.defaultAudio,
          };
          if (outcome.status === 'created') createdCustom = true;
          formats.push(pf);
          directed.push(toDirectedIdea(m, pf, inventedByName));
        } else {
          console.error('[resolveDirectedFromMatches] formato custom no creado; idea descartada', { slug: cf.slug, outcome: outcome.status });
          blockers.push(
            language === 'en'
              ? `Could not create a format for one of your ideas ("${m.ideaText.slice(0, 60)}")`
              : `No pude crear un formato para una de tus ideas ("${m.ideaText.slice(0, 60)}")`,
          );
        }
      }
    }
    const inventedNames = [...inventedByName.values()].map((p) => p.name);
    return { directed, blockers, inventedNames, createdCustom, ...(directed.length === 0 ? { matcherError: 'sin_match' as const } : {}) };
  }
  ```
  Nota: el `matcherError` del catch de Gemini y la carga de imagenes del matcher se quedan en `generatePlanAction` (S5.6); aqui solo el post-procesado de `matched.matches`.
- [ ] **Step 4: Correr y ver PASA.** `pnpm test lib/campaigns/idea-matcher-resolve.test.ts`
  Expected: `toDirectedIdea` + 4 casos de `resolveDirectedFromMatches` verdes.
- [ ] **Step 5: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 6: commit.** `git add lib/campaigns/idea-matcher-resolve.ts lib/campaigns/idea-matcher-resolve.test.ts && git commit -m "test(campaigns): resolveDirectedFromMatches + toDirectedIdea (loop del matcher)"`

---

### Task S5.5: extraer campaign-plan.ts (generatePlanAction) consumiendo el resolve

**Files:**
- Create: `server-actions/campaign-plan.ts` (`'use server'`)
- Modify: `server-actions/campaigns.ts` (quitar `generatePlanAction` def 358-775; añadir re-export; reemplazar `type Result` local por el de Ola 1)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';` (Ola 1); `import { coerceGoal, resolveProductImageIds, DRAFT_MODEL } from '@/lib/campaigns/shared';`; `import { resolveDirectedFromMatches } from '@/lib/campaigns/idea-matcher-resolve';`; `import { insertOrRecoverCustomFormat } from '@/lib/campaigns/custom-format';` (para el closure `recoverCustomFormat`).
- Produces: `export async function generatePlanAction(input: unknown): Promise<Result<{ items: number; creditsEstimated: number; source: 'ideas' | 'mix'; matcherError?: string; inventedNames?: string[]; blockers?: string[] }>>;` (firma IDENTICA a hoy).

**Steps:**
- [ ] **Step 1: Crear `server-actions/campaign-plan.ts`** con `'use server'` + `import 'server-only'`, y MOVER `generatePlanAction` (campaigns.ts:358-775) tal cual, con estos 3 cambios quirurgicos:
  - El `goal` (640-642) -> `const goal = coerceGoal(campaign.goal);`.
  - El fallback de ids de producto (404-406) -> `const productIds = resolveProductImageIds(kit);`.
  - El bloque del matcher 525-622 (`for (const m of matched.matches)` ... `if (directed.length === 0) matcherError = 'sin_match';`) -> sustituir por:
    ```ts
    const resolved = await resolveDirectedFromMatches({
      matches: matched.matches,
      formats,
      language: campaignLanguage,
      recoverCustomFormat: (cf) => insertOrRecoverCustomFormat(supabase, workspace.id, cf, { uniquifyOnConflict: true }),
    });
    directed.push(...resolved.directed);
    ideaBlockers.push(...resolved.blockers);
    if (resolved.createdCustom) revalidatePath('/app/formats');
    if (resolved.matcherError) matcherError = resolved.matcherError;
    ```
    Y mas abajo, donde hoy se calcula `inventedNamesList` (763), usar `resolved.inventedNames`. (El `inventedByName` local y `let createdCustom` se eliminan.) DRAFT_MODEL ahora viene del import.
- [ ] **Step 2: En `campaigns.ts`, borrar la definicion 358-775** de `generatePlanAction` y añadir al barrel (junto a los demas re-exports que iremos sumando): `export { generatePlanAction } from './campaign-plan';`. Reemplazar el `type Result` local (linea 59) por `import type { Result } from './_shared/result';` (lo usan aun las acciones de colecciones que quedan). Dejar `DRAFT_MODEL`/`FINAL_MODEL` locales por ahora (los siguen usando addItem/requestFinal mientras no migren).
- [ ] **Step 3: typecheck.** `pnpm typecheck`
  Expected: exit 0. (Recordatorio: typecheck NO ve el gotcha `'use server'`.)
- [ ] **Step 4: build — CRITICO para el gotcha.** `pnpm build`
  Expected: "Compiled successfully" / build OK. Si `campaign-plan.ts` exportara algo que no sea funcion async, fallaria AQUI (no antes).
- [ ] **Step 5: suite completa.** `pnpm test`
  Expected: todos los archivos verdes, incluido `lib/campaigns/idea-matcher-resolve.test.ts` y el resto de `lib/campaigns/*`.
- [ ] **Step 6: Smoke manual (nota).** Abrir `/app/campaigns/<id>` de una campaña con brief, escribir una idea y pulsar "Generar plan": el plan debe crear items y, si hay formato custom, aparece en `/app/formats`; sin ideas, cae al mix (toast `source: mix`).
- [ ] **Step 7: commit.** `git add server-actions/campaign-plan.ts server-actions/campaigns.ts && git commit -m "refactor(campaigns): generatePlanAction a campaign-plan.ts; loop del matcher via lib"`

---

### Task S5.6: extraer campaign-items.ts (update/add/redo/delete/schedule/toggleWinner)

**Files:**
- Create: `server-actions/campaign-items.ts` (`'use server'`)
- Modify: `server-actions/campaigns.ts` (quitar las 6 defs; añadir re-exports)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';`; `import { coerceGoal, DRAFT_MODEL, itemWorkspaceId } from '@/lib/campaigns/shared';`; reutiliza `validateOwnedCharacters`, `buildCaption` ya existentes.
- Produces (firmas IDENTICAS):
  ```ts
  export async function updateCampaignItemAction(input: unknown): Promise<Result<{ updated: true; status: string }>>;
  export async function addCampaignItemAction(input: unknown): Promise<Result<{ id: string; aspectRatio: string; durationS: number; caption: string; scheduledDate: string | null }>>;
  export async function redoSamplesAction(campaignId: string, formatId: string): Promise<Result<{ reset: number }>>;
  export async function deleteCampaignItemAction(itemId: string): Promise<Result<{ deleted: true }>>;
  export async function updateItemScheduleAction(itemId: string, dateIso: string): Promise<Result<{ updated: true }>>;
  export async function toggleWinnerAction(itemId: string): Promise<Result<{ isWinner: boolean }>>;
  ```

**Steps:**
- [ ] **Step 1: Crear `server-actions/campaign-items.ts`** (`'use server'` + `import 'server-only'`) y MOVER verbatim: `updateCampaignItemAction` (777-860), `addCampaignItemAction` (863-947), `redoSamplesAction` (952-981), `deleteCampaignItemAction` (983-1003), `updateItemScheduleAction` (1990-2013), `toggleWinnerAction` (1594-1620). Cambios quirurgicos: sustituir cada cast inline `(item as { campaigns?... })?.campaigns?.workspace_id` por `itemWorkspaceId(item)`; en addItem usar `coerceGoal(campaign.goal)` y `DRAFT_MODEL` del import.
- [ ] **Step 2: En `campaigns.ts`** borrar esas 6 definiciones y añadir `export { updateCampaignItemAction, addCampaignItemAction, redoSamplesAction, deleteCampaignItemAction, updateItemScheduleAction, toggleWinnerAction } from './campaign-items';`.
- [ ] **Step 3: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 4: build (gotcha `'use server'`).** `pnpm build` -> build OK.
- [ ] **Step 5: suite.** `pnpm test` -> verde.
- [ ] **Step 6: Smoke (nota).** En el Studio: editar el prompt de un item (debe volver a `planned`), agregar un creativo suelto, "rehacer muestra" de un formato, borrar un item planned, mover fecha en el calendario, marcar un final como ganador.
- [ ] **Step 7: commit.** `git add server-actions/campaign-items.ts server-actions/campaigns.ts && git commit -m "refactor(campaigns): acciones de items a campaign-items.ts"`

---

### Task S5.7: extraer campaign-generate.ts (generateItem/approveBatch/requestFinal)

**Files:**
- Create: `server-actions/campaign-generate.ts` (`'use server'`)
- Modify: `server-actions/campaigns.ts` (quitar 3 defs + `RegenMode`; añadir re-exports valor y tipo)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';`; `import { FINAL_MODEL, toFormatsMap, itemWorkspaceId, coerceGoal } from '@/lib/campaigns/shared';`; `import { reserveOrDeleteGeneration, safeFailGeneration } from '@/lib/generation/credit-lifecycle';` (Ola 1, para `requestFinalAction`).
- Produces (firmas IDENTICAS):
  ```ts
  export type RegenMode = 'auto' | 'only-this' | 'this-and-forward';
  export async function generateItemAction(itemId: string, mode?: RegenMode): Promise<Result<{ generationId?: string }>>;
  export async function approveBatchAction(input: unknown): Promise<Result<{ enqueued: number; skipped: number; creditsReserved: number }>>;
  export async function requestFinalAction(input: unknown): Promise<Result<{ generationId: string }>>;
  ```

**Steps:**
- [ ] **Step 1: Crear `server-actions/campaign-generate.ts`** (`'use server'` + `import 'server-only'`) y MOVER verbatim: `generateItemAction` (1012-1319, incluyendo `export type RegenMode` 1010), `approveBatchAction` (1322-1400), `requestFinalAction` (1404-1500). Cambios quirurgicos:
  - En `generateItemAction` y `approveBatchAction`, sustituir el `new Map((formatRows ?? []).map(...))` (1278-1293 / 1350-1365) por `toFormatsMap(formatRows ?? [])`, y el cast de ws por `itemWorkspaceId(item)`. `FINAL_MODEL` del import en `requestFinalAction`.
  - En `requestFinalAction`, reemplazar el bloque reserve+delete-on-fail+catch-fail (1472-1499) por Ola 1:
    ```ts
    const reserved = await reserveOrDeleteGeneration({ userId: user.id, cost, generationId });
    if (!reserved) return { ok: false, error: 'insufficient_credits' };
    try {
      await enqueueJob({ generationId, action: 'submit' });
      await supabase.from('campaign_items').update({ status: 'approved', generation_id: generationId }).eq('id', item.id);
      revalidatePath(`/app/campaigns/${item.campaign_id}`);
      return { ok: true, data: { generationId } };
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown';
      await safeFailGeneration({ userId: user.id, generationId, refund: cost, reason: `final_enqueue: ${message}`, logLabel: 'request_final:fail_generation' });
      return { ok: false, error: 'internal_error', message };
    }
    ```
  - **NO tocar** el bloque de re-generacion encadenada de `generateItemAction` (1073-1257): se mueve a `lib/campaigns` en la Ola 4 (`regenerateChainClip`). Aqui solo se traslada el archivo; `generateItemAction` queda grande a proposito (fuera de alcance de S5). Su reserva con limpieza de `closingRef` (1210-1219) se conserva bespoke (NO se migra a `reserveOrDeleteGeneration`, que no limpia el frame de cierre del Storage).
- [ ] **Step 2: En `campaigns.ts`** borrar esas 3 defs y `RegenMode`; añadir `export { generateItemAction, approveBatchAction, requestFinalAction } from './campaign-generate';` y `export type { RegenMode } from './campaign-generate';` (el tipo lo importa `CampaignStudioView.tsx:28` via `type RegenMode`).
- [ ] **Step 3: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 4: build (gotcha; `export type RegenMode` debe sobrevivir el barrel `'use server'`).** `pnpm build` -> build OK.
- [ ] **Step 5: suite.** `pnpm test` -> verde.
- [ ] **Step 6: Smoke (nota).** Generar UNA escena (Tier 1), aprobar muestra de un formato (`sample`), y de un draft listo pedir "render final" (debe encolar a 720p y pasar el item a `approved`). Verificar que, sin creditos, devuelve `insufficient_credits` sin dejar la generacion colgada.
- [ ] **Step 7: commit.** `git add server-actions/campaign-generate.ts server-actions/campaigns.ts && git commit -m "refactor(campaigns): generate/approve/final a campaign-generate.ts; requestFinal via credit-lifecycle"`

---

### Task S5.8: extraer campaign-templates.ts (distill/generateSeries/createVariant)

**Files:**
- Create: `server-actions/campaign-templates.ts` (`'use server'`)
- Modify: `server-actions/campaigns.ts` (quitar 3 defs; añadir re-exports)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';`; `import { coerceGoal } from '@/lib/campaigns/shared';`; `import { buildVariantPrompt } from '@/lib/campaigns/variant-prompts';`; `import { reserveOrDeleteGeneration, safeFailGeneration } from '@/lib/generation/credit-lifecycle';` (Ola 1, para `createVariantAction`).
- Produces (firmas IDENTICAS):
  ```ts
  export async function distillTemplateAction(input: unknown): Promise<Result<{ templateId: string }>>;
  export async function generateSeriesAction(input: unknown): Promise<Result<{ items: number; campaignId: string; created: StudioItem[] }>>;
  export async function createVariantAction(input: unknown): Promise<Result<{ generationId: string }>>;
  ```

**Steps:**
- [ ] **Step 1: Crear `server-actions/campaign-templates.ts`** (`'use server'` + `import 'server-only'`) y MOVER verbatim: `distillTemplateAction` (1509-1591), `generateSeriesAction` (1625-1778), `createVariantAction` (1782-1981). Cambios quirurgicos:
  - `generateSeriesAction`: `seriesGoal` (1666-1668) -> `coerceGoal(campaignRow?.goal)`.
  - `createVariantAction`: reemplazar el bloque de prompt+durationS de los 4 modos (1831-1916) por `buildVariantPrompt`. La resolucion de DB (videoRefPath, targetRefPath del bridge, master del personaje en replace_character, y los arrays `imagePaths`/`videoPaths`) se queda en la accion; solo la cadena del prompt sale:
    ```ts
    // extend
    const { prompt, durationS } = buildVariantPrompt(
      { mode: 'extend', extendSeconds: parsed.data.extendSeconds ?? 5, continuation: parsed.data.continuation }, variantLanguage);
    // change_action
    const { prompt, durationS } = buildVariantPrompt({ mode: 'change_action', newAction: parsed.data.newAction as string, sourceDuration }, variantLanguage);
    // bridge (tras resolver target + push a videoPaths)
    const { prompt, durationS } = buildVariantPrompt({ mode: 'bridge', bridgeSeconds: parsed.data.bridgeSeconds ?? 5 }, variantLanguage);
    // replace_character (tras resolver master + push a imagePaths)
    const { prompt, durationS } = buildVariantPrompt({ mode: 'replace_character', sourceDuration }, variantLanguage);
    ```
    (declarar `let prompt: string; let durationS: number;` y asignar en cada ramo, como hoy). El sufijo `DIALOGUE_LANGUAGE` ya queda dentro de `buildVariantPrompt`, así que se ELIMINA la linea 1916.
  - `createVariantAction`: reemplazar el bloque reserve+delete+catch-fail (1956-1980) por `reserveOrDeleteGeneration` + `safeFailGeneration` (logLabel `'create_variant:fail_generation'`), igual patron que requestFinal en S5.7.
- [ ] **Step 2: En `campaigns.ts`** borrar esas 3 defs y añadir `export { distillTemplateAction, generateSeriesAction, createVariantAction } from './campaign-templates';`.
- [ ] **Step 3: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 4: build (gotcha).** `pnpm build` -> build OK.
- [ ] **Step 5: suite.** `pnpm test` -> verde.
- [ ] **Step 6: Smoke (nota).** Sobre un video terminado: destilar a plantilla (debe marcar el item `is_winner`), generar una serie de N>=2 items, y crear una variante en cada modo (extend / change_action / bridge / replace_character) — verificar que el prompt sigue terminando en la cadencia de idioma de la campaña.
- [ ] **Step 7: commit.** `git add server-actions/campaign-templates.ts server-actions/campaigns.ts && git commit -m "refactor(campaigns): plantillas/variantes a campaign-templates.ts; prompts de variante via lib"`

---

### Task S5.9: extraer campaign-delivery.ts (exportCsv/buildImagePack/previewItemPrompt)

**Files:**
- Create: `server-actions/campaign-delivery.ts` (`'use server'`)
- Modify: `server-actions/campaigns.ts` (quitar 3 defs; añadir re-exports)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';`; `import { resolveProductImageIds } from '@/lib/campaigns/shared';`; `import { buildImagePackSpecs } from '@/lib/campaigns/image-pack';`; reutiliza `buildCampaignCsv`, `signedOutputUrl`, `compile`/`fromFormatRow`, `loadCampaignContext`, `resolveLocations`, `itemCharacterIds` ya existentes.
- Produces (firmas IDENTICAS):
  ```ts
  export async function exportCampaignCsvAction(campaignId: string): Promise<Result<{ csv: string; filename: string }>>;
  export async function buildImagePackAction(campaignId: string, count: number): Promise<Result<{ specs: Array<{ prompt: string; aspectRatio: '1:1' | '16:9'; kind: string }>; references: Array<{ id: string; storagePath: string }> }>>;
  export async function previewItemPromptAction(itemId: string): Promise<Result<{ prompt: string | null; references: Array<{ kind: string; role: string; path: string }>; warnings: string[]; errors: string[] }>>;
  ```

**Steps:**
- [ ] **Step 1: Crear `server-actions/campaign-delivery.ts`** (`'use server'` + `import 'server-only'`) y MOVER verbatim: `exportCampaignCsvAction` (2017-2083), `buildImagePackAction` (2089-2203), `previewItemPromptAction` (2209-2326). Cambios quirurgicos en `buildImagePackAction`:
  - El fallback de ids (2138-2141) -> `const ids = resolveProductImageIds(kit).slice(0, 3);`.
  - El bloque de mix + `pushSpec` + 3 loops (2160-2202) -> `const specs = buildImagePackSpecs({ count, product, scenes });` (el `product` se arma igual que hoy con `references.map((r) => r.storagePath)` en `imagePaths`).
- [ ] **Step 2: En `campaigns.ts`** borrar esas 3 defs y añadir `export { exportCampaignCsvAction, buildImagePackAction, previewItemPromptAction } from './campaign-delivery';`.
- [ ] **Step 3: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 4: build (gotcha).** `pnpm build` -> build OK.
- [ ] **Step 5: suite.** `pnpm test` -> verde.
- [ ] **Step 6: Smoke (nota).** Exportar el CSV del calendario (descarga con URLs firmadas en items listos), abrir el preview del prompt de un item (solo lectura, sin cobro), y generar un image pack (count 4/6/8) — verificar que devuelve `count` specs con el mix esperado.
- [ ] **Step 7: commit.** `git add server-actions/campaign-delivery.ts server-actions/campaigns.ts && git commit -m "refactor(campaigns): entrega/preview a campaign-delivery.ts; image-pack via lib"`

---

### Task S5.10: extraer campaign-sequence.ts (mergeSequence/assignSequenceLocation)

**Files:**
- Create: `server-actions/campaign-sequence.ts` (`'use server'`)
- Modify: `server-actions/campaigns.ts` (quitar 2 defs; añadir re-exports)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';`; reutiliza `mergeScenes`, `toStudioItem` (`StudioItem`) ya existentes. `itemWorkspaceId` no aplica aqui (la ownership va por `rows[0].campaigns` y por query directa a `campaigns`/`locations`).
- Produces (firmas IDENTICAS, incl. el retorno bespoke de assign):
  ```ts
  export async function mergeSequenceAction(input: unknown): Promise<Result<{ merged: true; item: StudioItem }>>;
  export async function assignSequenceLocationAction(campaignId: string, sequenceId: string, locationId: string | null): Promise<{ ok: true } | { ok: false; error: string }>;
  ```

**Steps:**
- [ ] **Step 1: Crear `server-actions/campaign-sequence.ts`** (`'use server'` + `import 'server-only'`) y MOVER verbatim: `mergeSequenceAction` (2335-2412) y `assignSequenceLocationAction` (2414-2452). `assignSequenceLocationAction` conserva su retorno propio `{ ok: true } | { ok: false; error: string }` (NO se cambia a `Result`, para no alterar la forma que consume el cliente).
- [ ] **Step 2: En `campaigns.ts`** borrar esas 2 defs y añadir `export { mergeSequenceAction, assignSequenceLocationAction } from './campaign-sequence';`.
- [ ] **Step 3: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 4: build (gotcha).** `pnpm build` -> build OK.
- [ ] **Step 5: suite.** `pnpm test` -> verde (incluye `campaigns.test.ts`, que ejercita `MergeSequenceSchema`/`mergeScenes`).
- [ ] **Step 6: Smoke (nota).** En una campaña con secuencia: asignar una locación a la secuencia y unir (merge) sus escenas `planned` en un solo clip — el item fusionado debe aparecer sin recargar.
- [ ] **Step 7: commit.** `git add server-actions/campaign-sequence.ts server-actions/campaigns.ts && git commit -m "refactor(campaigns): secuencias a campaign-sequence.ts"`

---

### Task S5.11: campaigns.ts queda como barrel + colecciones; limpieza y verificacion final

En este punto `campaigns.ts` ya solo contiene: las 8 acciones de colecciones/lifecycle (createCampaign, updateCampaign, deleteCampaign, updateCampaignStudio, setCampaignStatus, assignCampaign, listCampaigns, createCampaignStudio), sus zod locales, y los re-exports añadidos en S5.5-S5.10. Este task lo deja prolijo y verifica el conjunto.

**Files:**
- Modify: `server-actions/campaigns.ts` (consumir helpers en createCampaignStudio; eliminar imports y consts muertas)

**Interfaces:**
- Consumes: `import type { Result } from './_shared/result';`; `import { resolveProductImageIds } from '@/lib/campaigns/shared';` (createCampaignStudio).
- Produces: barrel `'use server'` que reexporta TODO; las 8 acciones de colecciones se quedan definidas aqui (firmas sin cambios).

**Steps:**
- [ ] **Step 1: En `createCampaignStudioAction`** (campaigns.ts:219-351) sustituir el fallback `((kit.product_image_ids as string[]) ?? []).length ? ... : ...` (241-243) por `resolveProductImageIds(kit)`.
- [ ] **Step 2: Eliminar codigo muerto en `campaigns.ts`:** borrar las consts locales `DRAFT_MODEL`/`FINAL_MODEL` (61-62, ya en `lib/campaigns/shared.ts` y sin uso restante aqui) y los imports que dejaron de usarse tras mover acciones (p. ej. `buildDirectedPlan`, `buildPlan`, `matchIdeas`, `mergeScenes`, `seedanceCostPerItem`, `buildVariantPrompt`-no aplica, `enqueueBatch`, `copyOutputVideoToReferences`, `buildCampaignCsv`, etc., los que YA no referencie ninguna de las 8 acciones que quedan). Mantener solo los imports que las colecciones usan (`requireWorkspace`, `createClient`, `revalidatePath`, `z`, `CreateCampaignStudioSchema`, `analyzeProductBrief`, `fetchProductPageText`, `downloadReferenceBuffer`, `validateOwnedCharacters`, `resolveProductImageIds`).
- [ ] **Step 3: lint para cazar imports/vars sin uso.** `pnpm lint`
  Expected: sin errores `no-unused-vars`/`unused import` en `campaigns.ts`.
- [ ] **Step 4: typecheck.** `pnpm typecheck` -> exit 0.
- [ ] **Step 5: build — verificacion final del gotcha sobre el barrel completo.** `pnpm build`
  Expected: build OK. Confirma que el barrel `'use server'` re-exportando 18 acciones de 6 archivos + `export type RegenMode` + definiendo 8 acciones es valido en produccion (lo unico que detecta el gotcha).
- [ ] **Step 6: suite completa final.** `pnpm test`
  Expected: TODO verde, incluidos los 4 tests nuevos (`shared`, `variant-prompts`, `image-pack`, `idea-matcher-resolve`) y `lib/campaigns/campaigns.test.ts`.
- [ ] **Step 7: Verificar que ningun consumidor se rompio (imports intactos).** `git grep -n "from '@/server-actions/campaigns'" components/` 
  Expected: las 6 lineas siguen resolviendo (mismos nombres exportados por el barrel); ningun componente importa de `campaign-*.ts` directamente.
- [ ] **Step 8: Smoke manual integral (nota).** Recorrer el Studio de punta a punta una vez: crear campaña studio (wizard), generar plan, generar una escena, aprobar muestra, render final, destilar plantilla, exportar CSV. Confirmar que no hay 500 ni toasts de error inesperados.
- [ ] **Step 9: commit.** `git add server-actions/campaigns.ts && git commit -m "refactor(campaigns): campaigns.ts como barrel + colecciones; limpieza de imports muertos"`

**Cierre de la unidad.** Resultado: `server-actions/campaigns.ts` baja de 2453 lineas a ~360 (8 acciones de colecciones + barrel); 6 archivos `campaign-*.ts` thin; 4 modulos puros en `lib/campaigns/` con cobertura de caracterizacion. `generatePlanAction` y `generateItemAction` siguen siendo las acciones mas largas (carga de datos / cadena encadenada respectivamente); la extraccion de `regenerateChainClip` de `generateItemAction` es trabajo de la Ola 4 (orchestrator), fuera de alcance aqui.
### Unidad S6: server-actions/generations.ts (798 lineas, 5 dominios) -> split por medio + consume Ola 1

**Objetivo.** `server-actions/generations.ts` mezcla cinco dominios (imagen, audio, video/seedance, lifecycle cancel/delete, y un `previewCostAction`) y reimplementa boilerplate que Ola 1 ya unifico: el ciclo sincrono reserve->generar->subir->thumbnail->complete->catch{fail} (imagen), el patron reserve+delete-on-fail + failGeneration-tragado (audio/video/seedance), la carga del parent conversacional con guard de `thought_signature`, y copias locales de `inferExtension`/`nanoVariantToResolution`/`makeThumbnail`. Vamos a (1) extraer las tres funciones puras de costo (`estimateTtsCost`/`estimateKlingCost`/`estimateVeoCost`) a `lib/credits/estimator.ts` con tests de caracterizacion; (2) partir el archivo en `server-actions/generations/{image,audio,video,lifecycle}.ts` + barrel; (3) reemplazar el boilerplate por los helpers de Ola 1 (`runSyncGeneration`, `reserveOrDeleteGeneration`, `safeFailGeneration`, `loadPreviousTurn`, `finalizeGeneration`, `nanoVariantToResolution`, `inferExtension`, `Result`/`ActionError`); (4) borrar codigo muerto (`megapixelsToVariant` identidad, copias locales) y anadir gate de auth a `previewCostAction`. Comportamiento IDENTICO; sin features nuevas. Invariantes intactos: creditos solo via RPC (ahora encapsulado en los helpers de Ola 1, que llaman a `reserve/complete/fail`), QStash polling para lo async (audio/video/seedance siguen `enqueueJob`), URLs internas (la pipeline sincrona de imagen sube a Storage via `finalizeGeneration`). Todos los archivos resultantes llevan `'use server'` -> **cada task incluye `pnpm build`** (typecheck y lint NO detectan el gotcha de exportar no-funciones desde `'use server'`).

**Decision de incrementalidad (importante).** Mantenemos `server-actions/generations.ts` como el modulo de entrada (lo que resuelve `@/server-actions/generations`, usado por los 11 consumidores) durante todo el split, y lo vamos vaciando: cada dominio extraido a `server-actions/generations/<dominio>.ts` se re-exporta desde `generations.ts` con `export { ... } from './generations/<dominio>'`. Mientras NO exista `server-actions/generations/index.ts`, el resolver elige el archivo `generations.ts` (no la carpeta), asi que no hay ambiguedad. El ultimo task renombra `generations.ts` -> `generations/index.ts` (ya es solo re-exports) y reescribe las rutas relativas. Asi la app compila y la suite pasa despues de CADA task. NINGUN consumidor cambia (todos importan del barrel `@/server-actions/generations`).

**File Structure**

| Archivo | Estado | Responsabilidad |
|---|---|---|
| `lib/credits/estimator.ts` | Modify | Agrega `estimateTtsCost`/`estimateKlingCost`/`estimateVeoCost` (puras, movidas desde generations.ts). |
| `lib/credits/estimator.test.ts` | Create | Tests de caracterizacion de las tres funciones de costo movidas. |
| `server-actions/generations/lifecycle.ts` | Create (`'use server'`) | `cancelGenerationAction`, `deleteGenerationAction` (+ `UUID_RE` privado). |
| `server-actions/generations/audio.ts` | Create (`'use server'`) | `submitAudioGenerationAction` (consume credit-lifecycle de Ola 1). |
| `server-actions/generations/video.ts` | Create (`'use server'`) | `submitVideoGenerationAction` + `submitSeedanceGeneration` (privada). |
| `server-actions/generations/image.ts` | Create (`'use server'`) | `previewCostAction` (con gate de auth) + `submitGenerationAction` (consume `runSyncGeneration`, `loadPreviousTurn`, `nanoVariantToResolution`) + helpers locales `paramsForEstimator`/`loadReferences`. |
| `server-actions/generations.ts` | Modify -> rename | Va perdiendo cuerpo (cada task lo vacia a re-exports); en el ultimo task se renombra a `server-actions/generations/index.ts`. |
| `server-actions/generations/index.ts` | Create (en el ultimo task, por rename) | Barrel: re-export de las 6 funciones async (`previewCostAction`, `submitGenerationAction`, `submitAudioGenerationAction`, `submitVideoGenerationAction`, `cancelGenerationAction`, `deleteGenerationAction`). |

Helpers de Ola 1 consumidos (ya existiran): `server-actions/_shared/result.ts` (`Result`, `ActionError`), `lib/media/image.ts` (`inferExtension`, `nanoVariantToResolution`), `lib/generation/previous-turn.ts` (`loadPreviousTurn`, `PreviousTurn`, `ServerSupabaseClient`), `lib/generation/credit-lifecycle.ts` (`reserveOrDeleteGeneration`, `safeFailGeneration`), `lib/generation/run-sync-generation.ts` (`runSyncGeneration`, `SyncGenerationOutcome`), `lib/jobs/finalize.ts` (`finalizeGeneration`, ya refactorizado para devolver `{outputPath,thumbnailPath}` y aceptar `revalidatePaths`; lo usa internamente `runSyncGeneration`).

---

### Task S6.1: Extraer las funciones de costo puras a lib/credits/estimator.ts (TDD)

Mueve `estimateTtsCost` (generations.ts:362-373), `estimateKlingCost` (:465-475) y `estimateVeoCost` (:477-488) a `lib/credits/estimator.ts`. Son puras (solo leen `PricingRow[]`), unicas consumidoras viven en generations.ts. Primero test de caracterizacion (falla porque no existen aun en estimator), luego mover, luego verde.

**Files:**
- Create: `lib/credits/estimator.test.ts`
- Modify: `lib/credits/estimator.ts` (append tras la linea 99)
- Modify: `server-actions/generations.ts` (borra defs :362-373, :465-475, :477-488; agrega import)

**Interfaces:**
- Consumes: `import type { PricingRow } from './types';` (ya re-exportado por estimator.ts:3).
- Produces (en `lib/credits/estimator.ts`):
  ```ts
  export function estimateTtsCost(pricing: PricingRow[], modelId: string, chars: number): number;
  export function estimateKlingCost(pricing: PricingRow[], model: string, duration: number): number;
  export function estimateVeoCost(pricing: PricingRow[], model: string, durationSeconds: 4 | 6 | 8): number;
  ```

**Steps:**

- [ ] **Step 1: Escribir test de caracterizacion.** Crea `lib/credits/estimator.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { estimateTtsCost, estimateKlingCost, estimateVeoCost } from './estimator';
  import type { PricingRow } from './types';

  const ttsRow: PricingRow = { provider: 'elevenlabs', model_id: 'eleven_v3', variant: 'default', credits_cost: 5, unit_size: 1000, unit_label: 'chars' };
  const klingRow: PricingRow = { provider: 'kling', model_id: 'fal-ai/kling-video/v3/pro/text-to-video', variant: 'per_second', credits_cost: 8, unit_size: null, unit_label: null };
  const veoRow: PricingRow = { provider: 'veo', model_id: 'veo-3.1-generate-preview', variant: '1080p', credits_cost: 20, unit_size: null, unit_label: null };

  describe('estimateTtsCost', () => {
    it('cobra por bloques de unit_size con ceil', () => {
      expect(estimateTtsCost([ttsRow], 'eleven_v3', 2500)).toBe(15); // ceil(2500/1000)=3 * 5
    });
    it('minimo 1 unidad aunque chars=0', () => {
      expect(estimateTtsCost([ttsRow], 'eleven_v3', 0)).toBe(5);
    });
    it('lanza si no encuentra pricing', () => {
      expect(() => estimateTtsCost([], 'eleven_v3', 100)).toThrow();
    });
  });

  describe('estimateKlingCost', () => {
    it('cobra duracion * credits_cost (variant per_second)', () => {
      expect(estimateKlingCost([klingRow], 'fal-ai/kling-video/v3/pro/text-to-video', 5)).toBe(40);
    });
    it('lanza si falta pricing per_second', () => {
      expect(() => estimateKlingCost([], 'x', 5)).toThrow();
    });
  });

  describe('estimateVeoCost', () => {
    it('cobra segundos * credits_cost (variant 1080p)', () => {
      expect(estimateVeoCost([veoRow], 'veo-3.1-generate-preview', 8)).toBe(160);
    });
    it('lanza si falta pricing 1080p', () => {
      expect(() => estimateVeoCost([], 'veo-3.1-generate-preview', 8)).toThrow();
    });
  });
  ```

- [ ] **Step 2: Correr el test y verificar que FALLA.** `pnpm test lib/credits/estimator.test.ts`
  Expected: falla en import/resolucion — `estimateTtsCost`/`estimateKlingCost`/`estimateVeoCost` no estan exportadas por `./estimator` (test rojo). Confirma que el modulo destino aun no tiene las funciones.

- [ ] **Step 3: Mover las tres funciones a estimator.ts.** Append al final de `lib/credits/estimator.ts` (tras :99), copiando la logica EXACTA de generations.ts (cambiando solo el tipo del primer parametro de `Awaited<ReturnType<typeof loadPricing>>` a `PricingRow[]`, que es equivalente):
  ```ts
  export function estimateTtsCost(pricing: PricingRow[], modelId: string, chars: number): number {
    const row = pricing.find(
      (p) => p.provider === 'elevenlabs' && p.model_id === modelId && p.variant === 'default',
    );
    if (!row || !row.unit_size) throw new Error(`pricing no encontrado para ${modelId}`);
    const units = Math.max(1, Math.ceil(chars / row.unit_size));
    return units * Number(row.credits_cost);
  }

  export function estimateKlingCost(pricing: PricingRow[], model: string, duration: number): number {
    const row = pricing.find(
      (p) => p.provider === 'kling' && p.model_id === model && p.variant === 'per_second',
    );
    if (!row) throw new Error(`pricing no encontrado para Kling ${model}/per_second`);
    return duration * Number(row.credits_cost);
  }

  export function estimateVeoCost(pricing: PricingRow[], model: string, durationSeconds: 4 | 6 | 8): number {
    // Pricing seeded por segundo a 1080p; costo total = segundos * credits_cost.
    const row = pricing.find(
      (p) => p.provider === 'veo' && p.model_id === model && p.variant === '1080p',
    );
    if (!row) throw new Error(`pricing no encontrado para Veo ${model}`);
    return durationSeconds * Number(row.credits_cost);
  }
  ```

- [ ] **Step 4: Borrar las defs viejas y reapuntar el import en generations.ts.** En `server-actions/generations.ts` borra los cuerpos `estimateTtsCost` (:362-373), `estimateKlingCost` (:465-475), `estimateVeoCost` (:477-488), y agrega a la importacion existente de estimator (linea 18 `import { estimateCredits } from '@/lib/credits/estimator';`):
  ```ts
  import { estimateCredits, estimateTtsCost, estimateKlingCost, estimateVeoCost } from '@/lib/credits/estimator';
  ```

- [ ] **Step 5: Correr el test y verificar que PASA.** `pnpm test lib/credits/estimator.test.ts`
  Expected: 7 tests verdes (3 tts + 2 kling + 2 veo).

- [ ] **Step 6: Verificacion completa.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck sin errores; `build` OK (recordatorio: generations.ts sigue siendo `'use server'` y solo exporta funciones async — el build lo confirma); suite completa verde.

- [ ] **Step 7: Commit.** `git add lib/credits/estimator.ts lib/credits/estimator.test.ts server-actions/generations.ts && git commit -m "refactor(credits): mover estimateTts/Kling/Veo a lib/credits/estimator con tests"`
  Expected: commit creado (sin trailer Co-Authored-By).

---

### Task S6.2: Extraer lifecycle (cancel/delete) a server-actions/generations/lifecycle.ts

Mueve `cancelGenerationAction` (generations.ts:732-751), `deleteGenerationAction` (:757-798) y la const privada `UUID_RE` (:730) a un modulo nuevo. Solo IO/DB (sin funcion pura nueva): la verificacion es typecheck + build + suite. Reemplaza el `type ActionError`/`type Result` locales por los de Ola 1 (`_shared/result.ts`).

**Files:**
- Create: `server-actions/generations/lifecycle.ts`
- Modify: `server-actions/generations.ts` (borra :730 `UUID_RE`, :732-751 cancel, :757-798 delete; agrega re-export; limpia imports que solo usaban estas funciones)

**Interfaces:**
- Consumes (Ola 1): `import type { Result } from '@/server-actions/_shared/result';`
- Consumes (existentes): `requireWorkspace` (`@/lib/auth/dal`), `createClient` (`@/lib/supabase/server`), `createAdminClient` (`@/lib/supabase/admin`), `OUTPUTS_BUCKET`, `THUMBNAILS_BUCKET` (`@/lib/supabase/storage`), `revalidatePath` (`next/cache`).
- Produces:
  ```ts
  export async function cancelGenerationAction(generationId: string): Promise<Result<{ canceled: true }>>;
  export async function deleteGenerationAction(generationId: string): Promise<Result<{ deleted: true }>>;
  ```

**Steps:**

- [ ] **Step 1: Crear lifecycle.ts.** Crea `server-actions/generations/lifecycle.ts` con `'use server'` + `import 'server-only'`, moviendo VERBATIM los cuerpos de `cancelGenerationAction` y `deleteGenerationAction` y la const privada `UUID_RE` (no exportada — `'use server'` solo exporta funciones async, una const no exportada es legal). Encabezado:
  ```ts
  'use server';

  import 'server-only';
  import { revalidatePath } from 'next/cache';
  import { requireWorkspace } from '@/lib/auth/dal';
  import { createClient } from '@/lib/supabase/server';
  import { createAdminClient } from '@/lib/supabase/admin';
  import { OUTPUTS_BUCKET, THUMBNAILS_BUCKET } from '@/lib/supabase/storage';
  import type { Result } from '@/server-actions/_shared/result';

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  ```
  Tras eso, pega los dos cuerpos tal cual estan en generations.ts:732-751 y :757-798.

- [ ] **Step 2: Vaciar generations.ts y re-exportar.** En `server-actions/generations.ts`: borra `UUID_RE` (:730), `cancelGenerationAction` (:732-751), `deleteGenerationAction` (:757-798). Quita de las importaciones lo que ya NO se usa en generations.ts (revisar: `OUTPUTS_BUCKET`/`THUMBNAILS_BUCKET` de la linea 14-15 solo los usaba delete -> quitarlos del import de storage). Agrega al final del archivo:
  ```ts
  export { cancelGenerationAction, deleteGenerationAction } from './generations/lifecycle';
  ```
  Nota: re-exportar funciones async desde un archivo `'use server'` hacia otro archivo `'use server'` es legal (solo funciones).

- [ ] **Step 3: Verificacion.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck OK; `build` OK (CRITICO: `build` es lo unico que valida que el re-export desde `'use server'` no rompa la ruta — typecheck/lint NO lo detectan); suite verde. Smoke manual: abrir `/app/library`, borrar una generacion en estado `done` y cancelar una en cola — deben seguir funcionando.

- [ ] **Step 4: Commit.** `git add server-actions/generations.ts server-actions/generations/lifecycle.ts && git commit -m "refactor(generations): extraer lifecycle (cancel/delete) a su modulo"`
  Expected: commit creado.

---

### Task S6.3: Extraer audio a server-actions/generations/audio.ts (consume credit-lifecycle)

Mueve `submitAudioGenerationAction` (generations.ts:375-463) y reemplaza el bloque reserve+delete-on-fail + failGeneration-tragado (:427-462) por `reserveOrDeleteGeneration` + `safeFailGeneration` de Ola 1. `estimateTtsCost` ahora viene de `lib/credits/estimator` (Task S6.1). Sin test unitario nuevo (IO/red); verificacion por typecheck+build+suite + smoke.

**Files:**
- Create: `server-actions/generations/audio.ts`
- Modify: `server-actions/generations.ts` (borra :375-463; agrega re-export; limpia imports `SubmitTtsSchema`/`estimateTtsCost` si quedan sin uso)

**Interfaces:**
- Consumes (Ola 1): `import type { Result } from '@/server-actions/_shared/result';`, `import { reserveOrDeleteGeneration, safeFailGeneration } from '@/lib/generation/credit-lifecycle';`
- Consumes (existentes): `requireWorkspace`, `createClient`, `loadPricing` (`@/lib/credits/pricing`), `estimateTtsCost` (`@/lib/credits/estimator`), `SubmitTtsSchema` (`@/lib/schemas/audio`), `enqueueJob` (`@/lib/jobs/queue`), `revalidatePath`.
- Produces:
  ```ts
  export async function submitAudioGenerationAction(input: unknown): Promise<Result<{ generationId: string }>>;
  ```

**Steps:**

- [ ] **Step 1: Crear audio.ts.** Crea `server-actions/generations/audio.ts` con `'use server'` + `import 'server-only'`. Mantiene VERBATIM el parse + `requireWorkspace` + `loadPricing` + `estimateTtsCost` + el insert a `generations` (:378-422). Sustituye el bloque `let reserved...try/catch` (:427-462) por la version con helpers de Ola 1:
  ```ts
    const reserved = await reserveOrDeleteGeneration({ userId: user.id, cost, generationId });
    if (!reserved) return { ok: false, error: 'insufficient_credits' };
    try {
      await enqueueJob({ generationId, action: 'submit' });
      revalidatePath('/app/library');
      return { ok: true, data: { generationId } };
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown';
      await safeFailGeneration({
        userId: user.id,
        generationId,
        refund: cost,
        reason: message,
        logLabel: 'fail_generation:audio',
      });
      return {
        ok: false,
        error: message.includes('429') ? 'provider_error' : 'internal_error',
        message,
      };
    }
  ```
  (Comportamiento identico: `reserveOrDeleteGeneration` encapsula reserve + delete-on-false; en el catch la reserva ya ocurrio, asi que `refund: cost` — igual que el `reserved ? cost : 0` original, donde aqui siempre es post-reserva.)

- [ ] **Step 2: Vaciar generations.ts y re-exportar.** Borra `submitAudioGenerationAction` (:375-463) y agrega:
  ```ts
  export { submitAudioGenerationAction } from './generations/audio';
  ```
  Quita de los imports de generations.ts `SubmitTtsSchema`/`SubmitTtsInput` (:30) y `estimateTtsCost` del import de estimator si ya no se usan en el archivo (siguen usandose Kling/Veo hasta S6.4).

- [ ] **Step 3: Verificacion.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck OK; `build` OK (valida el re-export `'use server'`); suite verde. Smoke manual: `/app/create/audio`, generar un TTS corto — la generacion entra a cola (`queued`) y aparece en biblioteca; con balance insuficiente devuelve "creditos insuficientes" sin dejar fila huerfana.

- [ ] **Step 4: Commit.** `git add server-actions/generations.ts server-actions/generations/audio.ts && git commit -m "refactor(generations): extraer audio + consumir credit-lifecycle de Ola 1"`
  Expected: commit creado.

---

### Task S6.4: Extraer video+seedance a server-actions/generations/video.ts (consume credit-lifecycle)

Mueve `submitVideoGenerationAction` (generations.ts:609-728) y la privada `submitSeedanceGeneration` (:490-607). Reemplaza los DOS bloques reserve+delete+fail (seedance :576-606 y video :695-727) por `reserveOrDeleteGeneration` + `safeFailGeneration`. `estimateKlingCost`/`estimateVeoCost` vienen de `lib/credits/estimator` (S6.1); `seedanceCostPerItem` de `lib/campaigns/estimate`.

**Files:**
- Create: `server-actions/generations/video.ts`
- Modify: `server-actions/generations.ts` (borra :490-607 y :609-728; agrega re-export; limpia imports de schemas de video/campaigns y `seedanceCostPerItem`/`estimateKlingCost`/`estimateVeoCost`)

**Interfaces:**
- Consumes (Ola 1): `import type { Result } from '@/server-actions/_shared/result';`, `import { reserveOrDeleteGeneration, safeFailGeneration } from '@/lib/generation/credit-lifecycle';`
- Consumes (existentes): `requireWorkspace`, `createClient`, `loadPricing`, `estimateKlingCost`/`estimateVeoCost` (`@/lib/credits/estimator`), `seedanceCostPerItem` (`@/lib/campaigns/estimate`), `SubmitVideoSchema`/`SubmitKlingInput`/`SubmitVeoInput` (`@/lib/schemas/video`), `SubmitSeedanceSchema`/`SubmitSeedanceInput` (`@/lib/schemas/campaigns`), `enqueueJob`, `revalidatePath`.
- Produces:
  ```ts
  export async function submitVideoGenerationAction(input: unknown): Promise<Result<{ generationId: string }>>;
  // submitSeedanceGeneration permanece privada (no exportada) dentro de video.ts
  ```

**Steps:**

- [ ] **Step 1: Crear video.ts.** Crea `server-actions/generations/video.ts` con `'use server'` + `import 'server-only'`. Mueve VERBATIM `submitSeedanceGeneration` (sin `export`, sigue privada) y `submitVideoGenerationAction`. En AMBOS, sustituye el bloque `let reserved...try/catch` por la version Ola 1, conservando el prefijo `queue_failed: ` del `reason` (el original lo usa en video/seedance, a diferencia de audio):
  ```ts
    const reserved = await reserveOrDeleteGeneration({ userId: user.id, cost, generationId });
    if (!reserved) return { ok: false, error: 'insufficient_credits' };
    try {
      await enqueueJob({ generationId, action: 'submit' });
      revalidatePath('/app/library');
      return { ok: true, data: { generationId } };
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown';
      await safeFailGeneration({
        userId: user.id,
        generationId,
        refund: cost,
        reason: `queue_failed: ${message}`,
        logLabel: 'fail_generation:seedance', // en submitVideoGenerationAction usar 'fail_generation:video'
      });
      return {
        ok: false,
        error: message.includes('429') ? 'provider_error' : 'internal_error',
        message,
      };
    }
  ```
  El resto de cada funcion (parse del `kind`, checks de prefijo `${workspace.id}/`, deteccion de `operation`/`expectedOp`, calculo de `cost`, insert a `generations`) se conserva sin cambios.

- [ ] **Step 2: Vaciar generations.ts y re-exportar.** Borra `submitSeedanceGeneration` (:490-607) y `submitVideoGenerationAction` (:609-728), agrega:
  ```ts
  export { submitVideoGenerationAction } from './generations/video';
  ```
  Limpia de generations.ts los imports que ya solo usaba video/seedance: `SubmitVideoSchema`/`SubmitKlingInput`/`SubmitVeoInput` (:31-35), `SubmitSeedanceSchema`/`SubmitSeedanceInput` (:36), `seedanceCostPerItem` (:37), y `estimateKlingCost`/`estimateVeoCost` del import de estimator. Tras este task generations.ts solo conserva el dominio imagen + los re-exports.

- [ ] **Step 3: Verificacion.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck OK; `build` OK (valida el re-export `'use server'`); suite verde. Smoke manual: `/app/create/video` — generar un clip Veo y uno Kling (entran a `queued`); una campania que dispare Seedance via `submitVideoGenerationAction({ kind: 'seedance', ... })` debe seguir encolando. Verificar que una referencia fuera del prefijo `${workspace.id}/` devuelve `forbidden`.

- [ ] **Step 4: Commit.** `git add server-actions/generations.ts server-actions/generations/video.ts && git commit -m "refactor(generations): extraer video+seedance + consumir credit-lifecycle"`
  Expected: commit creado.

---

### Task S6.5: Extraer imagen a server-actions/generations/image.ts (consume run-sync-generation, previous-turn, media helpers) + gate de auth en previewCostAction

El dominio mas pesado: `previewCostAction` (:85-100), `submitGenerationAction` (:141-360) y los helpers locales `paramsForEstimator` (:72-83), `loadReferences` (:102-126). Reemplaza: (a) el ciclo sincrono reserve->generar->subir->thumbnail->complete->catch{fail} (:217-359) por `runSyncGeneration`; (b) la carga inline del parent + guard de `thought_signature` (:234-273) por `loadPreviousTurn`; (c) `nanoVariantToResolution` local (:59-70) por el de `lib/media/image`; (d) borra `megapixelsToVariant` (:55-57, identidad inutil), `makeThumbnail` (:128-133, ya lo hace `finalizeGeneration` dentro de `runSyncGeneration`) e `inferExtension` (:135-139, idem). Anade gate de auth a `previewCostAction`.

**Files:**
- Create: `server-actions/generations/image.ts`
- Modify: `server-actions/generations.ts` (borra el resto del dominio imagen :55-360; queda como barrel puro de re-exports)

**Interfaces:**
- Consumes (Ola 1): `import type { Result } from '@/server-actions/_shared/result';`, `import { runSyncGeneration } from '@/lib/generation/run-sync-generation';`, `import { loadPreviousTurn, type PreviousTurn } from '@/lib/generation/previous-turn';`, `import { nanoVariantToResolution } from '@/lib/media/image';`
- Consumes (existentes): `requireWorkspace`, `createClient`, `loadPricing`, `estimateCredits` (`@/lib/credits/estimator`), `SubmitGenerationSchema`/`PreviewCostSchema`/`SubmitGenerationInput`/`fluxDimensions` (`@/lib/schemas/generations`), `downloadReferenceBuffer` (`@/lib/supabase/storage`), `generate as generateNanoBanana` (`@/lib/providers/nano-banana`), `generate as generateFlux` (`@/lib/providers/flux`), `type ImageReference`/`type GenerationResult` (`@/lib/providers/types`).
- Produces:
  ```ts
  export async function previewCostAction(input: unknown): Promise<Result<{ total: number; breakdown: ReturnType<typeof estimateCredits> }>>;
  export async function submitGenerationAction(input: unknown): Promise<Result<{ generationId: string }>>;
  // paramsForEstimator y loadReferences quedan privadas dentro de image.ts
  ```
- **Contrato con `runSyncGeneration` (asuncion de Ola 1):** `runSyncGeneration` ejecuta reserve (via `reserveOrDeleteGeneration`) -> `generate()` -> `finalizeGeneration` (sube output + thumbnail + `completeGeneration`) -> `onComplete`, y en error llama `safeFailGeneration`. El `meta` del `GenerationResult` que devuelve `generate()` se propaga como `metadata` de `finalizeGeneration` (-> `provider_payload`). Por eso el `thought_signature` se transporta via `meta` (abajo). Si `runSyncGeneration` NO reenviara `meta`, es un bug de integracion de Ola 1 -> flaguear, NO hand-patch.

**Steps:**

- [ ] **Step 1: Crear image.ts (preview + helpers + gate de auth).** Crea `server-actions/generations/image.ts` con `'use server'` + `import 'server-only'`. Mueve `paramsForEstimator` (sin `megapixelsToVariant`: usa `input.megapixels` directo) y `loadReferences` como privadas. Mueve `previewCostAction` ANADIENDO `await requireWorkspace()` como gate (antes del `try`, despues del parse para que un input invalido siga devolviendo `validation_error`):
  ```ts
  function paramsForEstimator(input: SubmitGenerationInput) {
    if (input.provider === 'flux') {
      return { megapixels: input.megapixels, references: input.references.length };
    }
    return { conversational: input.conversational, useGrounding: input.useGrounding };
  }

  export async function previewCostAction(
    input: unknown,
  ): Promise<Result<{ total: number; breakdown: ReturnType<typeof estimateCredits> }>> {
    const parsed = PreviewCostSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: 'validation_error' };
    await requireWorkspace(); // gate de auth: previewCost no debe responder a no autenticados
    try {
      const pricing = await loadPricing();
      const breakdown = estimateCredits(pricing, {
        provider: parsed.data.provider,
        model: parsed.data.model,
        variant: parsed.data.variant,
        params: paramsForEstimator(parsed.data),
      });
      return { ok: true, data: { total: breakdown.total, breakdown } };
    } catch (e) {
      return { ok: false, error: 'internal_error', message: (e as Error).message };
    }
  }
  ```
  `loadReferences` se copia VERBATIM de generations.ts:102-126.

- [ ] **Step 2: Mover submitGenerationAction usando runSyncGeneration + loadPreviousTurn.** En el mismo `image.ts`, agrega `submitGenerationAction`. Conserva VERBATIM el parse, `requireWorkspace`, recalculo de `cost` (`estimateCredits` + `paramsForEstimator`), construccion de `insertParams`/`parentGenerationId`, y el insert a `generations` (status `'processing'`, :163-213). Reemplaza el bloque `let reserved...try/catch` (:217-359) por:
  ```ts
    const outcome = await runSyncGeneration<{ generationId: string }>({
      userId: user.id,
      workspaceId: workspace.id,
      generationId,
      type: 'image',
      cost,
      revalidatePaths: ['/app/library', '/app/create/image'],
      logLabel: 'submit',
      generate: async () => {
        const references = await loadReferences(workspace.id, data.references);
        let previousTurn: PreviousTurn | null = null;
        if (data.provider === 'nano-banana' && data.conversational && data.parentGenerationId) {
          previousTurn = await loadPreviousTurn(supabase, {
            parentGenerationId: data.parentGenerationId,
            workspaceId: workspace.id,
            expectedModelId: data.model,
          });
        }
        let result: GenerationResult;
        if (data.provider === 'nano-banana') {
          result = await generateNanoBanana({
            model: data.model,
            prompt: data.prompt,
            aspectRatio: data.aspectRatio,
            resolution: nanoVariantToResolution(data.variant),
            references,
            previousTurn,
            useGrounding: data.useGrounding,
            conversational: data.conversational,
            hasTextInImage: data.hasTextInImage,
            noBackground: data.noBackground,
          });
        } else {
          const { width, height } = fluxDimensions(data.aspectRatio, data.megapixels);
          result = await generateFlux({
            prompt: data.prompt,
            width,
            height,
            references,
            photoreal: data.photoreal,
          });
        }
        // El thought_signature se persiste como provider_payload via finalize:
        // lo transportamos en meta (finalize escribe metadata -> provider_payload).
        if (result.thoughtSignature) {
          return {
            buffer: result.buffer,
            mimeType: result.mimeType,
            thoughtSignature: result.thoughtSignature,
            meta: { thought_signature: result.thoughtSignature },
          };
        }
        return { buffer: result.buffer, mimeType: result.mimeType };
      },
      onComplete: async () => ({ generationId }),
    });

    if (!outcome.ok) {
      if (outcome.error === 'insufficient_credits') return { ok: false, error: 'insufficient_credits' };
      return { ok: false, error: outcome.error, message: outcome.message };
    }
    return { ok: true, data: outcome.data };
  ```
  Notas de equivalencia: (1) `loadPreviousTurn` encapsula el guard `parent.model_id === data.model` (solo pasa `thoughtSignature` si el modelo coincide) y el filtro `workspace_id`/`status==='done'`/`output_url` (era :245-272). (2) `runSyncGeneration` mapea `outcome.error` `'safety'`/`'provider_error'` desde el `ProviderError` interno, equivalente al catch original (:355-358). (3) la pipeline de subida/thumbnail/`completeGeneration` (:300-331) ahora vive en `finalizeGeneration` dentro de `runSyncGeneration`, con `revalidatePaths` identicas.

- [ ] **Step 3: Vaciar generations.ts a barrel puro.** Borra de generations.ts TODO el dominio imagen restante: `megapixelsToVariant` (:55-57, codigo muerto — NO se reimplementa), `nanoVariantToResolution` (:59-70), `paramsForEstimator` (:72-83), `previewCostAction` (:85-100), `loadReferences` (:102-126), `makeThumbnail` (:128-133), `inferExtension` (:135-139), `submitGenerationAction` (:141-360), y todos los imports que solo el dominio imagen usaba (`sharp`, `downloadOutputBuffer`/`downloadReferenceBuffer`/`uploadOutput`/`uploadThumbnail`, `completeGeneration`/`failGeneration`/`reserveCredits`, `nano-banana`/`flux`/`types`, schemas de generations, etc.). El archivo queda SOLO con las 4 lineas de re-export:
  ```ts
  export { previewCostAction, submitGenerationAction } from './generations/image';
  export { submitAudioGenerationAction } from './generations/audio';
  export { submitVideoGenerationAction } from './generations/video';
  export { cancelGenerationAction, deleteGenerationAction } from './generations/lifecycle';
  ```
  (Mantener `'use server'` + `import 'server-only'` arriba es opcional en un barrel de puro re-export; dejar `'use server'` no rompe porque solo re-exporta funciones async.)

- [ ] **Step 4: Verificacion.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck OK; `build` OK (CRITICO aqui: el barrel re-exporta desde 4 archivos `'use server'`; solo `build` valida que la ruta no se rompa); suite verde (incluido `components/creation/generate.test.ts`, que mockea `@/server-actions/generations` -> sigue resolviendo al barrel). Smoke manual: (1) `/app/create/image` generar imagen Nano Banana single-turn y FLUX -> aparece en biblioteca. (2) **Conversacional (clave):** generar una imagen Nano Banana, luego "continuar" desde ella (parent + `conversational:true`) -> la segunda debe EDITAR la anterior (no pegar la cara), lo que confirma que `loadPreviousTurn` cargo el parent y `thought_signature` se persistio via `meta`/`finalize`. (3) con balance insuficiente -> "creditos insuficientes" sin fila huerfana. (4) `previewCostAction` desde la UI sigue mostrando el costo estimado.

- [ ] **Step 5: Commit.** `git add server-actions/generations.ts server-actions/generations/image.ts && git commit -m "refactor(generations): extraer imagen + consumir runSyncGeneration/previousTurn/media; borrar codigo muerto"`
  Expected: commit creado.

---

### Task S6.6: Convertir generations.ts en generations/index.ts (barrel canonico) + verificacion final

`generations.ts` ya es solo re-exports. Renombrarlo a `server-actions/generations/index.ts` lo vuelve el modulo-directorio canonico que pedia el audit y reescribe las rutas relativas `./generations/<x>` -> `./<x>`. El especificador `@/server-actions/generations` que usan los 11 consumidores resuelve ahora al `index.ts` del directorio.

**Files:**
- Modify (rename): `server-actions/generations.ts` -> `server-actions/generations/index.ts`

**Interfaces:**
- Produces (barrel `server-actions/generations/index.ts`):
  ```ts
  export { previewCostAction, submitGenerationAction } from './image';
  export { submitAudioGenerationAction } from './audio';
  export { submitVideoGenerationAction } from './video';
  export { cancelGenerationAction, deleteGenerationAction } from './lifecycle';
  ```

**Steps:**

- [ ] **Step 1: Rename con git.** `git mv server-actions/generations.ts server-actions/generations/index.ts`
  Expected: el archivo pasa a `server-actions/generations/index.ts`; `git status` muestra rename. (git mv es atomico: no coexisten `generations.ts` y `generations/index.ts`, evitando ambiguedad del resolver.)

- [ ] **Step 2: Reescribir rutas relativas en el barrel.** En `server-actions/generations/index.ts` cambia cada `from './generations/<x>'` a `from './<x>'`:
  ```ts
  export { previewCostAction, submitGenerationAction } from './image';
  export { submitAudioGenerationAction } from './audio';
  export { submitVideoGenerationAction } from './video';
  export { cancelGenerationAction, deleteGenerationAction } from './lifecycle';
  ```

- [ ] **Step 3: Verificacion final.** `pnpm typecheck && pnpm build && pnpm test`
  Expected: typecheck OK; `build` OK (confirma que `@/server-actions/generations` resuelve al `index.ts` del directorio y que ningun `'use server'` exporta no-funciones); suite completa verde. Smoke manual (regresion rapida de los 5 dominios via barrel): generar 1 imagen, 1 audio, 1 video; cancelar 1 en cola; borrar 1 `done` — todo desde la UeI normal, confirmando que los 11 consumidores siguen importando del barrel sin cambios.

- [ ] **Step 4: Confirmar que no quedan referencias al path viejo.** `git grep -n "server-actions/generations.ts\|./generations/image\|./generations/audio\|./generations/video\|./generations/lifecycle"`
  Expected: sin resultados (ninguna ruta apunta al archivo viejo ni a los paths `./generations/<x>` intermedios).

- [ ] **Step 5: Commit.** `git add -A server-actions/generations && git commit -m "refactor(generations): barrel canonico en generations/index.ts"`
  Expected: commit creado; el split queda en 5 modulos (image/audio/video/lifecycle/index) + estimators puros en lib/credits.
### Unidad S7: server-actions/storyboard.ts (808 lineas) -> extraccion + compiler + zod

**Objetivo.** `server-actions/storyboard.ts` no es un monstruo de tamano pero tiene triple duplicacion del ciclo sincrono Nano Banana (insert -> reserve -> refs -> previousTurn -> generar -> subir -> thumbnail -> complete -> fail/refund -> promote) repartido entre `generatePanelAction` y `refinePanelAction`, mas el ensamblado inline del prompt encadenado dentro de la accion, y CERO validacion zod en las 4 acciones exportadas (viola la convencion del repo). Esta unidad lo deja como **capa fina**: `validar(zod) -> cargar item+campania(ownership) -> compilar prompt -> delegar el ciclo a Ola 1 (`runSyncGeneration`) -> linkear `campaign_items`. Para lograrlo: (1) se extrae la unica pieza pura nueva, `compileChainedPanel()`, al modulo pure ya existente `lib/campaigns/storyboard.ts` con test de caracterizacion; (2) se crean los esquemas zod de las 4 acciones en `lib/schemas/storyboard.ts` con test; (3) se consumen los helpers de Ola 1 (`runSyncGeneration`, `loadPreviousTurn`, `result.ts`, `lib/media/image.ts`). Comportamiento IDENTICO en el camino feliz; el unico cambio intencional de comportamiento es que entradas malformadas ahora devuelven `validation_error` de forma uniforme (la convencion que el audit pide arreglar).

**File Structure**

| Archivo | Accion | Responsabilidad |
|---|---|---|
| `lib/schemas/storyboard.ts` | **Create** | 4 esquemas zod (`GeneratePanelSchema`, `RefinePanelSchema`, `SetStoryboardLocationSchema`, `SetBeatAudioSchema`) + tipos inferidos. Validacion de los args de las 4 acciones. Modulo puro (NO `'use server'`). |
| `lib/schemas/storyboard.test.ts` | **Create** | Caracterizacion de los 4 esquemas (acepta valido, rechaza limites). |
| `lib/campaigns/storyboard.ts` | **Modify** | Agregar `compileChainedPanel()` + constantes `PANEL_NO_TEXT` / `PRODUCT_REF_POINTER`. Modulo puro existente, ya re-exporta `humanRealismDirective`/`chainedProductFidelity` usados aqui. |
| `lib/campaigns/storyboard.test.ts` | **Modify** | Agregar `describe('compileChainedPanel')` con los 3 casos (fresco / encadenado sin pointer / encadenado con pointer). |
| `server-actions/storyboard.ts` | **Modify** | Capa fina. Reemplaza tipos locales `ActionError`/`Result`, util locales (`inferExtension`, `nanoVariantToResolution`, `makeThumbnail`), el ensamblado inline del prompt encadenado, y los dos ciclos sincronos por delegacion a Ola 1. Sigue siendo `'use server'`. |

**Helpers de Ola 1 que consume esta unidad (NO recrear):**
- `server-actions/_shared/result.ts` -> `type ActionError`, `type Result<T>`
- `lib/media/image.ts` -> `inferExtension`, `nanoVariantToResolution`
- `lib/generation/previous-turn.ts` -> `loadPreviousTurn`, `type PreviousTurn`
- `lib/generation/run-sync-generation.ts` -> `runSyncGeneration`, `type SyncGenerationOutcome`
  (que a su vez usa internamente `lib/jobs/finalize.ts`, `lib/generation/credit-lifecycle.ts` — esta unidad NO los importa directo)

> RECORDATORIO GOTCHA `'use server'`: `server-actions/storyboard.ts` empieza con `'use server'` (linea 1). Un archivo `'use server'` SOLO puede exportar funciones async; exportar objetos/constantes/esquemas rompe la ruta en produccion y NI `pnpm typecheck` NI `pnpm lint` lo detectan — SOLO `pnpm build`. Por eso los esquemas zod viven en `lib/schemas/` (no aqui), `ActionError`/`Result` entran con `import type`, y **todo task que toque este archivo incluye un paso `pnpm build`**.

---

### Task S7.1: Esquemas zod de las 4 acciones (lib/schemas/storyboard.ts)

**Files:**
- Create: `lib/schemas/storyboard.ts`
- Test: `lib/schemas/storyboard.test.ts`

**Interfaces:**
- Consumes: `zod`
- Produces:
  ```ts
  export const GeneratePanelSchema: z.ZodObject<{ itemId: z.ZodString; productRefInChat: z.ZodOptional<z.ZodBoolean> }>;
  export const RefinePanelSchema: z.ZodObject<{ itemId: z.ZodString; instruction: z.ZodString }>;
  export const SetStoryboardLocationSchema: z.ZodObject<{ campaignId: z.ZodString; locationId: z.ZodNullable<z.ZodString>; creative: z.ZodObject<{ sequenceId: z.ZodNullable<z.ZodString>; itemId: z.ZodString }> }>;
  export const SetBeatAudioSchema: z.ZodObject<{ itemId: z.ZodString; dialogue: z.ZodString; durationS: z.ZodNumber }>;
  export type GeneratePanelInput = z.infer<typeof GeneratePanelSchema>;
  export type RefinePanelInput = z.infer<typeof RefinePanelSchema>;
  export type SetStoryboardLocationInput = z.infer<typeof SetStoryboardLocationSchema>;
  export type SetBeatAudioInput = z.infer<typeof SetBeatAudioSchema>;
  ```

**Steps:**

- [ ] **Step 1: escribir el test de caracterizacion primero (debe fallar: el modulo no existe).** Crear `lib/schemas/storyboard.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import {
    GeneratePanelSchema,
    RefinePanelSchema,
    SetStoryboardLocationSchema,
    SetBeatAudioSchema,
  } from './storyboard';

  const UUID = '11111111-1111-4111-8111-111111111111';
  const UUID2 = '22222222-2222-4222-8222-222222222222';

  describe('GeneratePanelSchema', () => {
    it('acepta itemId uuid y productRefInChat opcional', () => {
      expect(GeneratePanelSchema.safeParse({ itemId: UUID }).success).toBe(true);
      expect(GeneratePanelSchema.safeParse({ itemId: UUID, productRefInChat: true }).success).toBe(true);
    });
    it('rechaza itemId vacio o no-uuid', () => {
      expect(GeneratePanelSchema.safeParse({ itemId: '' }).success).toBe(false);
      expect(GeneratePanelSchema.safeParse({ itemId: 'nope' }).success).toBe(false);
    });
  });

  describe('RefinePanelSchema', () => {
    it('acepta instruction no vacia (trim)', () => {
      const r = RefinePanelSchema.safeParse({ itemId: UUID, instruction: '  warmer light  ' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.instruction).toBe('warmer light');
    });
    it('rechaza instruction vacia o solo espacios', () => {
      expect(RefinePanelSchema.safeParse({ itemId: UUID, instruction: '   ' }).success).toBe(false);
    });
  });

  describe('SetStoryboardLocationSchema', () => {
    it('acepta locationId uuid o null y creative.sequenceId null', () => {
      expect(SetStoryboardLocationSchema.safeParse({ campaignId: UUID, locationId: UUID2, creative: { sequenceId: null, itemId: UUID } }).success).toBe(true);
      expect(SetStoryboardLocationSchema.safeParse({ campaignId: UUID, locationId: null, creative: { sequenceId: UUID2, itemId: UUID } }).success).toBe(true);
    });
    it('rechaza creative sin itemId', () => {
      expect(SetStoryboardLocationSchema.safeParse({ campaignId: UUID, locationId: null, creative: { sequenceId: null, itemId: '' } }).success).toBe(false);
    });
  });

  describe('SetBeatAudioSchema', () => {
    it('acepta dialogo <=600 y duracion entera 4..15', () => {
      expect(SetBeatAudioSchema.safeParse({ itemId: UUID, dialogue: '', durationS: 4 }).success).toBe(true);
      expect(SetBeatAudioSchema.safeParse({ itemId: UUID, dialogue: 'x'.repeat(600), durationS: 15 }).success).toBe(true);
    });
    it('rechaza dialogo >600, duracion fuera de rango o no entera', () => {
      expect(SetBeatAudioSchema.safeParse({ itemId: UUID, dialogue: 'x'.repeat(601), durationS: 8 }).success).toBe(false);
      expect(SetBeatAudioSchema.safeParse({ itemId: UUID, dialogue: 'hola', durationS: 3 }).success).toBe(false);
      expect(SetBeatAudioSchema.safeParse({ itemId: UUID, dialogue: 'hola', durationS: 16 }).success).toBe(false);
      expect(SetBeatAudioSchema.safeParse({ itemId: UUID, dialogue: 'hola', durationS: 8.5 }).success).toBe(false);
    });
  });
  ```
  Correr: `pnpm test lib/schemas/storyboard.test.ts`
  Expected: FALLA con error de resolucion de modulo (`Cannot find module './storyboard'` / `Failed to load`).

- [ ] **Step 2: crear el modulo de esquemas.** Crear `lib/schemas/storyboard.ts`:
  ```ts
  import { z } from 'zod';

  // Esquemas zod de las acciones de storyboard. Las 4 acciones reciben args posicionales
  // tipados desde el cliente (StoryboardView.tsx); estos esquemas son la red de validacion
  // en runtime (RLS + ownership siguen siendo la ultima linea). Limites espejo de la
  // validacion ad-hoc previa: dialogo <=600, duracion entera 4..15, instruction no vacia.
  export const GeneratePanelSchema = z.object({
    itemId: z.string().uuid(),
    productRefInChat: z.boolean().optional(),
  });

  export const RefinePanelSchema = z.object({
    itemId: z.string().uuid(),
    instruction: z.string().trim().min(1),
  });

  export const SetStoryboardLocationSchema = z.object({
    campaignId: z.string().uuid(),
    locationId: z.string().uuid().nullable(),
    creative: z.object({
      sequenceId: z.string().uuid().nullable(),
      itemId: z.string().uuid(),
    }),
  });

  export const SetBeatAudioSchema = z.object({
    itemId: z.string().uuid(),
    dialogue: z.string().max(600),
    durationS: z.number().int().min(4).max(15),
  });

  export type GeneratePanelInput = z.infer<typeof GeneratePanelSchema>;
  export type RefinePanelInput = z.infer<typeof RefinePanelSchema>;
  export type SetStoryboardLocationInput = z.infer<typeof SetStoryboardLocationSchema>;
  export type SetBeatAudioInput = z.infer<typeof SetBeatAudioSchema>;
  ```

- [ ] **Step 3: verificar test verde.** Correr: `pnpm test lib/schemas/storyboard.test.ts`
  Expected: `Test Files  1 passed (1)`, todos los `it` en verde.

- [ ] **Step 4: typecheck (no toca `'use server'`, basta tsc).** Correr: `pnpm typecheck`
  Expected: sin errores, exit 0.

- [ ] **Step 5: commit.** Correr: `git add lib/schemas/storyboard.ts lib/schemas/storyboard.test.ts && git commit -m "test(storyboard): esquemas zod de las 4 acciones + caracterizacion"`
  Expected: 1 commit, 2 archivos creados.

---

### Task S7.2: Extraer compileChainedPanel a lib/campaigns/storyboard.ts (pure)

Mueve fuera de la accion el ensamblado del prompt encadenado/fresco (hoy inline en `server-actions/storyboard.ts:269-298`): las constantes `noText` y el pointer del producto, el template "Same scene as the provided previous shot ...", y la composicion con `humanRealismDirective` / `chainedProductFidelity`. Funcion PURA (sin IO) -> test de caracterizacion real.

**Files:**
- Modify: `lib/campaigns/storyboard.ts` (agregar al final, tras `chainedProductFidelity` en :71-75 y antes/junto a `compilePanelEdit` :79-89)
- Test: `lib/campaigns/storyboard.test.ts` (agregar `describe('compileChainedPanel')`)

**Interfaces:**
- Consumes (mismo modulo): `humanRealismDirective(ctx: DirectorContext, scenePrompt: string): string`, `chainedProductFidelity(ctx: DirectorContext): string`, `type DirectorContext` (ya importado de `@/lib/prompt-director`)
- Produces:
  ```ts
  export function compileChainedPanel(opts: {
    chained: boolean;        // hay panel anterior (encadena) vs panel fresco
    freshPrompt: string;     // compiled.compiled.prompt del panel fresco (FLUX compiler)
    scenePrompt: string;     // item.scene_prompt crudo
    ctx: DirectorContext;
    productRefInChat: boolean; // ya resuelto por la accion (toggle UI + env flag); solo aplica si chained
  }): string;
  ```

**Steps:**

- [ ] **Step 1: agregar el test de caracterizacion primero (debe fallar: aun no se exporta).** En `lib/campaigns/storyboard.test.ts`, agregar `compileChainedPanel` al import existente (linea 2-9) y anexar al final:
  ```ts
  describe('compileChainedPanel', () => {
    const ctx = {
      product: { name: 'Family Portrait Canvas', visualDetails: 'two women and one man', imagePaths: ['ws/canvas.png'] },
      characters: [{ name: 'Ana', description: 'mujer', masterImagePath: 'ws/ana.png' }],
    };

    it('panel fresco: prompt compilado + realismo humano + clausula sin-texto al final', () => {
      const out = compileChainedPanel({ chained: false, freshPrompt: 'COMPILED_FRESH', scenePrompt: 'she smiles', ctx, productRefInChat: false });
      expect(out.startsWith('COMPILED_FRESH')).toBe(true);
      expect(out).toContain('real, photographed human beings');
      expect(out.endsWith('watermark in the image.')).toBe(true);
    });

    it('panel encadenado: re-frame + fidelidad del producto, sin pointer cuando productRefInChat=false', () => {
      const out = compileChainedPanel({ chained: true, freshPrompt: 'IGNORED', scenePrompt: '  close up of the canvas  ', ctx, productRefInChat: false });
      expect(out).toContain('Same scene as the provided previous shot');
      expect(out).toContain('close up of the canvas.'); // scenePrompt.trim() + punto del template
      expect(out).not.toContain('IGNORED');
      expect(out).toContain('Reproduce the product'); // chainedProductFidelity por texto
      expect(out).not.toContain('A reference image of the product is also attached');
      expect(out.endsWith('watermark in the image.')).toBe(true);
    });

    it('panel encadenado con productRefInChat=true agrega el pointer de la imagen del producto', () => {
      const out = compileChainedPanel({ chained: true, freshPrompt: '', scenePrompt: 'wide shot', ctx, productRefInChat: true });
      expect(out).toContain('A reference image of the product is also attached');
    });
  });
  ```
  Correr: `pnpm test lib/campaigns/storyboard.test.ts`
  Expected: FALLA (`compileChainedPanel is not a function` / no exportada).

- [ ] **Step 2: implementar compileChainedPanel.** En `lib/campaigns/storyboard.ts`, agregar tras `chainedProductFidelity` (:71-75):
  ```ts
  // Clausula que prohibe texto dentro del panel (mismas palabras que la accion usaba inline).
  const PANEL_NO_TEXT =
    ' Do not render any text, captions, speech bubbles, subtitles, labels or watermark in the image.';

  // Puntero EXPERIMENTAL del producto re-anclado en el turno de chat de un panel encadenado.
  // Aclara que la imagen adjunta es el producto a reproducir, no la toma a editar.
  const PRODUCT_REF_POINTER =
    ' A reference image of the product is also attached — reproduce its printed image and design exactly. The previous panel remains the base shot to re-frame; do not replace the scene with the product image.';

  // Ensambla el prompt final del panel del storyboard. Panel FRESCO: el prompt compilado
  // (FLUX compiler) + realismo humano (subordinado a fidelidad) + sin-texto. Panel ENCADENADO:
  // re-encuadre conversacional del panel anterior (conserva escena/producto/personajes) con la
  // accion del beat, fidelidad del producto por TEXTO (la cadena descarta refs externas) y, si
  // el toggle lo pide, el pointer de la imagen del producto. PURA: no toca DB ni red.
  export function compileChainedPanel(opts: {
    chained: boolean;
    freshPrompt: string;
    scenePrompt: string;
    ctx: DirectorContext;
    productRefInChat: boolean;
  }): string {
    const { chained, freshPrompt, scenePrompt, ctx, productRefInChat } = opts;
    if (!chained) {
      return `${freshPrompt}${humanRealismDirective(ctx, scenePrompt)}${PANEL_NO_TEXT}`;
    }
    const pointer = productRefInChat ? PRODUCT_REF_POINTER : '';
    return `Same scene as the provided previous shot — keep the SAME location, the SAME product (faithful and in the same position in the scene), and the SAME characters and wardrobe. But RE-FRAME this as a clearly DIFFERENT camera shot: change the angle, distance and composition so it is visibly a NEW shot, NOT the same frame as the previous one. Follow the framing and action described here exactly: ${scenePrompt.trim()}.${chainedProductFidelity(ctx)}${pointer}${PANEL_NO_TEXT}`;
  }
  ```

- [ ] **Step 3: verificar suite del modulo verde.** Correr: `pnpm test lib/campaigns/storyboard.test.ts`
  Expected: `Test Files  1 passed`, incluyendo los 3 nuevos `it` de `compileChainedPanel` y los existentes (sin regresion).

- [ ] **Step 4: typecheck.** Correr: `pnpm typecheck`
  Expected: sin errores, exit 0. (Este task NO toca el archivo `'use server'`, no requiere build.)

- [ ] **Step 5: commit.** Correr: `git add lib/campaigns/storyboard.ts lib/campaigns/storyboard.test.ts && git commit -m "refactor(storyboard): extraer compileChainedPanel (prompt fresco/encadenado) a lib pura"`
  Expected: 1 commit, 2 archivos modificados.

---

### Task S7.3: Tipos compartidos + validacion zod en las 4 acciones (capa fina, parte 1)

Reemplaza el `type ActionError`/`type Result` locales por los de Ola 1 y agrega `safeParse` zod al inicio de las 4 acciones. NO toca todavia los ciclos sincronos (eso es S7.4/S7.5) — solo entrada y tipos, para que cada paso quede verde. PRIMER task que toca `'use server'`: incluye `pnpm build`.

**Files:**
- Modify: `server-actions/storyboard.ts`
  - eliminar `type ActionError` (:45-55) y `type Result<T>` (:57)
  - agregar imports `import type { ActionError, Result } from './_shared/result';` y `import { GeneratePanelSchema, RefinePanelSchema, SetStoryboardLocationSchema, SetBeatAudioSchema } from '@/lib/schemas/storyboard';`
  - `generatePanelAction` validacion (:206) ; `setStoryboardLocationAction` validacion (:480-481) ; `refinePanelAction` validacion (:527-530) ; `setBeatAudioAction` validacion (:783-789)

**Interfaces:**
- Consumes (Ola 1): `import type { ActionError, Result } from '@/server-actions/_shared/result'` — ruta relativa `./_shared/result`; `type ActionError` ya incluye `'no_panel'` y `'compile_error'` (superset del union local actual).
- Consumes (S7.1): los 4 esquemas.
- Produces: firmas de las 4 acciones SIN cambios (mismos args posicionales, mismo `Result<...>`).

**Steps:**

- [ ] **Step 1: borrar tipos locales e importar los de Ola 1.** En `server-actions/storyboard.ts`, eliminar el bloque `type ActionError = ... ;` (:45-55) y `type Result<T> = ...;` (:57). En la zona de imports (tras :32) agregar:
  ```ts
  import type { ActionError, Result } from './_shared/result';
  import {
    GeneratePanelSchema,
    RefinePanelSchema,
    SetStoryboardLocationSchema,
    SetBeatAudioSchema,
  } from '@/lib/schemas/storyboard';
  ```
  (`import type` es seguro en `'use server'`: los tipos se borran en compilacion, no son exports de valor.)

- [ ] **Step 2: zod en generatePanelAction.** Reemplazar la guarda `if (!itemId) ...` (:206) por:
  ```ts
  const parsed = GeneratePanelSchema.safeParse({ itemId, productRefInChat: opts?.productRefInChat });
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.issues[0]?.message };
  }
  ```
  (El resto de la accion sigue usando `itemId` y `opts?.productRefInChat`; mas adelante S7.4 leera `parsed.data` donde convenga.)

- [ ] **Step 3: zod en setStoryboardLocationAction.** Reemplazar las 2 guardas `if (!campaignId) ...` / `if (!creative?.itemId) ...` (:480-481) por:
  ```ts
  const parsed = SetStoryboardLocationSchema.safeParse({ campaignId, locationId, creative });
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.issues[0]?.message };
  }
  ```

- [ ] **Step 4: zod en refinePanelAction.** Reemplazar las 2 guardas `if (!itemId) ...` / `if (!instruction?.trim()) ...` (:527-530) por:
  ```ts
  const parsed = RefinePanelSchema.safeParse({ itemId, instruction });
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.issues[0]?.message };
  }
  const instructionClean = parsed.data.instruction;
  ```
  y usar `instructionClean` donde la accion pasa la instruccion al compiler (`compilePanelEdit(instructionClean, ...)`, hoy en :584). Asi se preserva el `.trim()` que hacia la guarda previa.

- [ ] **Step 5: zod en setBeatAudioAction.** Reemplazar las 3 guardas (:783-789) por:
  ```ts
  const parsed = SetBeatAudioSchema.safeParse({ itemId, dialogue, durationS });
  if (!parsed.success) {
    return { ok: false, error: 'validation_error', message: parsed.error.issues[0]?.message };
  }
  ```

- [ ] **Step 6: typecheck.** Correr: `pnpm typecheck`
  Expected: sin errores. (`Result<...>` y `ActionError` resuelven desde `./_shared/result`.)

- [ ] **Step 7: build (GOTCHA `'use server'`: typecheck/lint NO ven el error de export; solo build).** Correr: `pnpm build`
  Expected: `Compiled successfully`, exit 0, sin error tipo "A 'use server' file can only export async functions". (`./_shared/result` es modulo de tipos, no `'use server'`; `import type` no genera export de valor.)

- [ ] **Step 8: suite completa (sin regresion en lo existente).** Correr: `pnpm test`
  Expected: `Test Files  N passed` (todos verdes; ningun test depende de la firma cambiada).

- [ ] **Step 9: commit.** Correr: `git add server-actions/storyboard.ts && git commit -m "refactor(storyboard): validacion zod en las 4 acciones + Result/ActionError compartidos"`
  Expected: 1 commit, 1 archivo modificado.

---

### Task S7.4: generatePanelAction -> runSyncGeneration + compileChainedPanel + loadPreviousTurn

Sustituye el ciclo sincrono inline de `generatePanelAction` (reserve+delete, refs, generar Nano, subir, thumbnail, complete, catch{fail/refund}, promote: :342-467) por `runSyncGeneration` de Ola 1, usa `compileChainedPanel` (S7.2) para el prompt y delega la carga del turno previo a `loadPreviousTurn` reescribiendo el helper local `loadPreviousPanelTurn`.

**Files:**
- Modify: `server-actions/storyboard.ts`
  - imports: agregar `runSyncGeneration`, `loadPreviousTurn`/`type PreviousTurn`, `compileChainedPanel`; quitar `humanRealismDirective`, `chainedProductFidelity` del import de `@/lib/campaigns/storyboard` (:31)
  - `loadPreviousPanelTurn` (:149-198): reescribir para que solo resuelva el `prevGenId` (query campaign_items) y delegue la carga a `loadPreviousTurn`
  - `generatePanelAction`: reemplazar ensamblado inline del prompt (:269-298) por `compileChainedPanel`; reemplazar el bloque try/catch sincrono (:342-467) por `runSyncGeneration` + `onComplete` (promocion + link)
  - consolidar a un unico `const supabase = await createClient()` reusado para locaciones, prevTurn, insert y el update de `onComplete` (hoy hay `locClient` :225 y `supabase` :311)

**Interfaces:**
- Consumes (Ola 1):
  ```ts
  import { runSyncGeneration } from '@/lib/generation/run-sync-generation';
  import { loadPreviousTurn, type PreviousTurn } from '@/lib/generation/previous-turn';
  // runSyncGeneration<T>(opts: { userId; workspaceId; generationId; type:'image'|'video'|'audio'; cost; revalidatePaths; logLabel; generate: () => Promise<GenerationResult>; onComplete?: (ctx:{outputPath; thumbnailPath; generationId; result}) => Promise<T> }): Promise<SyncGenerationOutcome<T>>
  // loadPreviousTurn(supabase, { parentGenerationId; workspaceId; expectedModelId }): Promise<PreviousTurn | null>
  ```
- Consumes (S7.2): `compileChainedPanel`
- Produces: `loadPreviousPanelTurn(supabase, workspaceId, campaignId, sceneIndex, sequenceId): Promise<PreviousTurn | null>` (firma estable, ahora delega); `generatePanelAction(itemId, opts?): Promise<Result<{ imageId: string | null; generationId: string }>>` (sin cambios de firma).

**Steps:**

- [ ] **Step 1: ajustar imports.** En `server-actions/storyboard.ts`:
  - cambiar `import { compilePanel, compilePanelEdit, humanRealismDirective, chainedProductFidelity } from '@/lib/campaigns/storyboard';` (:31) por `import { compilePanel, compilePanelEdit, compileChainedPanel } from '@/lib/campaigns/storyboard';`
  - agregar:
    ```ts
    import { runSyncGeneration } from '@/lib/generation/run-sync-generation';
    import { loadPreviousTurn, type PreviousTurn } from '@/lib/generation/previous-turn';
    ```

- [ ] **Step 2: reescribir loadPreviousPanelTurn para delegar.** Reemplazar el cuerpo de `loadPreviousPanelTurn` (:149-198) por la version que solo resuelve `prevGenId` y delega:
  ```ts
  async function loadPreviousPanelTurn(
    supabase: Awaited<ReturnType<typeof createClient>>,
    workspaceId: string,
    campaignId: string,
    sceneIndex: number | null,
    sequenceId: string | null,
  ): Promise<PreviousTurn | null> {
    // Encadenado solo DENTRO de una secuencia y no en la primera escena.
    if (sceneIndex == null || sequenceId == null) return null;
    const { data: rows } = await supabase
      .from('campaign_items')
      .select('scene_index, storyboard_generation_id')
      .eq('campaign_id', campaignId)
      .eq('sequence_id', sequenceId)
      .lt('scene_index', sceneIndex)
      .not('storyboard_generation_id', 'is', null)
      .order('scene_index', { ascending: false })
      .limit(1);
    const prevGenId = (rows?.[0]?.storyboard_generation_id as string | null | undefined) ?? null;
    if (!prevGenId) return null;
    // La carga del turno (output + thought_signature con guard de modelo) la hace Ola 1.
    return loadPreviousTurn(supabase, {
      parentGenerationId: prevGenId,
      workspaceId,
      expectedModelId: NANO_MODEL_SLUG,
    });
  }
  ```
  (El download del output, el guard de ownership/status y el guard `model_id === NANO_MODEL_SLUG` los aplica `loadPreviousTurn`.)

- [ ] **Step 3: consolidar cliente y prompt en generatePanelAction.** Dentro de `generatePanelAction`, tras `const { item, campaign } = loaded;`: cambiar `const locClient = await createClient();` (:225) por `const supabase = await createClient();` y usar `supabase` en `resolveLocations(supabase, ...)` (:226) y en `loadPreviousPanelTurn(supabase, ...)` (:273). Eliminar el `const supabase = await createClient();` duplicado (:311). Reemplazar el bloque de ensamblado inline del prompt (:269-298) por:
  ```ts
  const prevTurn = await loadPreviousPanelTurn(
    supabase, workspace.id, item.campaign_id, item.scene_index, item.sequence_id,
  );
  // Toggle UI per-panel; fallback al env flag para "Generar todos". Solo aplica encadenado.
  const productRefInChat =
    Boolean(prevTurn) &&
    (parsed.data.productRefInChat ?? process.env.STORYBOARD_PRODUCT_REF_IN_CHAT === '1');
  const panelPrompt = compileChainedPanel({
    chained: Boolean(prevTurn),
    freshPrompt: compiled.compiled.prompt,
    scenePrompt: item.scene_prompt,
    ctx: dirCtx,
    productRefInChat,
  });
  ```

- [ ] **Step 4: reemplazar el ciclo sincrono por runSyncGeneration.** El bloque insert (:312-340) se conserva (sigue creando la fila `generations` y `generationId`). Reemplazar todo el `let reserved = false; ... } catch (err) { ... }` (:342-467) por:
  ```ts
  const outcome = await runSyncGeneration<{ imageId: string | null; generationId: string }>({
    userId: user.id,
    workspaceId: workspace.id,
    generationId,
    type: 'image',
    cost,
    revalidatePaths: [`/app/campaigns/${item.campaign_id}/storyboard`, '/app/library'],
    logLabel: 'storyboard:generate',
    generate: async () => {
      // refs limpias (producto/personaje/locacion); ownership ya validado en loadCampaignContext.
      const references = await Promise.all(
        compiled.compiled.references
          .filter((r) => r.kind === 'image')
          .map(async (r): Promise<ImageReference> => {
            const { buffer, mimeType } = await downloadReferenceBuffer(r.storagePath);
            return { buffer, mimeType };
          }),
      );
      // EXPERIMENTAL: imagen del producto re-anclada en el turno de chat (solo con flag).
      const productChatRefs = productRefInChat
        ? await Promise.all(
            compiled.compiled.references
              .filter((r) => r.kind === 'image' && r.role === 'product')
              .map(async (r): Promise<ImageReference> => {
                const { buffer, mimeType } = await downloadReferenceBuffer(r.storagePath);
                return { buffer, mimeType };
              }),
          )
        : undefined;
      return generateNanoBanana({
        model: NANO_MODEL_SLUG,
        prompt: panelPrompt,
        aspectRatio: item.aspect_ratio ?? '9:16',
        resolution: nanoVariantToResolution(NANO_VARIANT),
        references,
        previousTurn: prevTurn,
        conversational: Boolean(prevTurn),
        useGrounding: false,
        hasTextInImage: false,
        chatReferences: productChatRefs,
      });
    },
    onComplete: async ({ outputPath }) => {
      // Promocion best-effort: output -> media_reference -> campaign_item.
      let imageId: string | null = null;
      try {
        imageId = await promoteOutputToReference(workspace.id, user.id, outputPath, generationId);
        await supabase
          .from('campaign_items')
          .update({ storyboard_image_id: imageId, storyboard_generation_id: generationId })
          .eq('id', itemId);
      } catch (promoteErr) {
        console.error('[storyboard:promote]', { generationId, itemId, error: (promoteErr as Error)?.message });
      }
      return { imageId, generationId };
    },
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: outcome.data };
  ```
  (`outcome.error` es `'insufficient_credits' | 'safety' | 'provider_error'`, subconjunto de `ActionError`, asi que `return outcome` typechea contra `Result<...>`. El `revalidatePath` ahora lo hace `runSyncGeneration` via `revalidatePaths`.)

- [ ] **Step 5: typecheck.** Correr: `pnpm typecheck`
  Expected: sin errores. (Si marca `nanoVariantToResolution`/`inferExtension`/`makeThumbnail` como locales aun usados, OK — siguen definidos; se purgan en S7.6.)

- [ ] **Step 6: build (GOTCHA `'use server'`).** Correr: `pnpm build`
  Expected: `Compiled successfully`, exit 0. Recordatorio: typecheck/lint NO detectan un export ilegal en `'use server'`; este build es el unico que valida que el archivo sigue exportando solo funciones async.

- [ ] **Step 7: suite completa.** Correr: `pnpm test`
  Expected: `Test Files  N passed`, sin regresion.

- [ ] **Step 8 (smoke manual, no automatizable — IO real).** Levantar `pnpm dev`, abrir `/app/campaigns/<id>/storyboard`. Verificar: (a) un beat suelto genera panel fresco (aparece la imagen, se descuentan creditos una vez); (b) en una secuencia de >=2 beats, "Generar todos" produce el panel 2 como RE-ENCUADRE de la misma escena (no copia del frame anterior) — el encadenado conversacional sigue vivo; (c) ante error del proveedor, los creditos se reembolsan (no quedan reservados). Nota: no requiere API mockeada; lo corre el usuario.

- [ ] **Step 9: commit.** Correr: `git add server-actions/storyboard.ts && git commit -m "refactor(storyboard): generatePanelAction usa runSyncGeneration + compileChainedPanel"`
  Expected: 1 commit, 1 archivo modificado.

---

### Task S7.5: refinePanelAction -> runSyncGeneration + loadPreviousTurn

Sustituye el ciclo sincrono inline de `refinePanelAction` (:631-772) por `runSyncGeneration` y reemplaza la carga inline del parent (:652-684) por `loadPreviousTurn`.

**Files:**
- Modify: `server-actions/storyboard.ts`
  - `refinePanelAction`: consolidar cliente (hoy `locClient` :553 + `supabase` :599); reemplazar bloque try/catch sincrono (:631-772) por `runSyncGeneration` con `generate` (refs + `loadPreviousTurn` para el parent) y `onComplete` (promocion + link)

**Interfaces:**
- Consumes (Ola 1, ya importados en S7.4): `runSyncGeneration`, `loadPreviousTurn`.
- Produces: `refinePanelAction(itemId, instruction): Promise<Result<{ imageId: string | null; generationId: string }>>` (firma sin cambios).

**Steps:**

- [ ] **Step 1: consolidar cliente en refinePanelAction.** Cambiar `const locClient = await createClient();` (:553) por `const supabase = await createClient();`, usarlo en `resolveLocations(supabase, ...)` (:554), y eliminar el `const supabase = await createClient();` duplicado (:599). El insert (:600-624) y el `generationId` se conservan.

- [ ] **Step 2: reemplazar el ciclo sincrono por runSyncGeneration.** Reemplazar el `let reserved = false; ... } catch (err) { ... }` (:631-772) por:
  ```ts
  const outcome = await runSyncGeneration<{ imageId: string | null; generationId: string }>({
    userId: user.id,
    workspaceId: workspace.id,
    generationId,
    type: 'image',
    cost,
    revalidatePaths: [`/app/campaigns/${item.campaign_id}/storyboard`, '/app/library'],
    logLabel: 'storyboard:refine',
    generate: async () => {
      const references = await Promise.all(
        compiled.compiled.references
          .filter((r) => r.kind === 'image')
          .map(async (r): Promise<ImageReference> => {
            const { buffer, mimeType } = await downloadReferenceBuffer(r.storagePath);
            return { buffer, mimeType };
          }),
      );
      // Turno previo conversacional: output + thought_signature del panel base (guard de modelo en Ola 1).
      const previousTurn = item.storyboard_generation_id
        ? await loadPreviousTurn(supabase, {
            parentGenerationId: item.storyboard_generation_id,
            workspaceId: workspace.id,
            expectedModelId: NANO_MODEL_SLUG,
          })
        : null;
      return generateNanoBanana({
        model: NANO_MODEL_SLUG,
        prompt: compiled.compiled.prompt,
        aspectRatio: item.aspect_ratio ?? '9:16',
        resolution: nanoVariantToResolution(NANO_VARIANT),
        references,
        previousTurn,
        useGrounding: false,
        conversational: true,
        hasTextInImage: false,
        noBackground: false,
      });
    },
    onComplete: async ({ outputPath }) => {
      let imageId: string | null = null;
      try {
        imageId = await promoteOutputToReference(workspace.id, user.id, outputPath, generationId);
        await supabase
          .from('campaign_items')
          .update({ storyboard_image_id: imageId, storyboard_generation_id: generationId })
          .eq('id', itemId);
      } catch (promoteErr) {
        console.error('[storyboard:promote]', { generationId, itemId, error: (promoteErr as Error)?.message });
      }
      return { imageId, generationId };
    },
  });
  if (!outcome.ok) return outcome;
  return { ok: true, data: outcome.data };
  ```
  (Nota: el `parent_generation_id` ya se guarda en el insert :617 con `item.storyboard_generation_id`; aqui solo se carga el turno para el modo conversacional.)

- [ ] **Step 3: typecheck.** Correr: `pnpm typecheck`
  Expected: sin errores.

- [ ] **Step 4: build (GOTCHA `'use server'`).** Correr: `pnpm build`
  Expected: `Compiled successfully`, exit 0.

- [ ] **Step 5: suite completa.** Correr: `pnpm test`
  Expected: `Test Files  N passed`, sin regresion.

- [ ] **Step 6 (smoke manual).** En `/app/campaigns/<id>/storyboard`, sobre un beat que YA tiene panel, escribir una instruccion de refinado (p.ej. "make the lighting warmer") y enviar. Verificar: la edicion preserva composicion/identidad/producto (es edicion conversacional del panel base, no un re-render) y el panel se actualiza. Sin panel previo debe seguir devolviendo `no_panel`. Lo corre el usuario.

- [ ] **Step 7: commit.** Correr: `git add server-actions/storyboard.ts && git commit -m "refactor(storyboard): refinePanelAction usa runSyncGeneration + loadPreviousTurn"`
  Expected: 1 commit, 1 archivo modificado.

---

### Task S7.6: Borrar codigo muerto + verificacion final

Tras S7.4/S7.5, las utilidades locales y varios imports quedaron sin uso. Se eliminan, se importa `nanoVariantToResolution` desde Ola 1, y se hace la verificacion final completa.

**Files:**
- Modify: `server-actions/storyboard.ts`
  - eliminar `makeThumbnail` (:59-64), `inferExtension` (:66-70), `nanoVariantToResolution` (:72-83) locales
  - agregar `import { nanoVariantToResolution } from '@/lib/media/image';`
  - podar imports ya sin uso: `sharp` (:5), `createAdminClient` (:8), de `@/lib/supabase/storage` quitar `uploadOutput`, `uploadThumbnail` y `downloadOutputBuffer` (mantener `downloadReferenceBuffer`, `promoteOutputToReference`), `completeGeneration`/`failGeneration`/`reserveCredits` de `@/lib/credits/operations`

**Interfaces:**
- Consumes (Ola 1): `import { nanoVariantToResolution } from '@/lib/media/image'`.
- Produces: ningun cambio de firma publica; el archivo queda como capa fina.

**Steps:**

- [ ] **Step 1: eliminar utilidades locales.** Borrar de `server-actions/storyboard.ts` las funciones `makeThumbnail` (:59-64), `inferExtension` (:66-70) y `nanoVariantToResolution` (:72-83). (`inferExtension` ya no se usa: el `ext`+`uploadOutput` los hace `finalizeGeneration` dentro de `runSyncGeneration`.)

- [ ] **Step 2: importar nanoVariantToResolution de Ola 1.** Agregar `import { nanoVariantToResolution } from '@/lib/media/image';` en la zona de imports. (`inferExtension` NO se importa: la accion ya no lo usa.)

- [ ] **Step 3: podar imports sin uso.** En `server-actions/storyboard.ts`:
  - eliminar `import sharp from 'sharp';` (:5)
  - eliminar `import { createAdminClient } from '@/lib/supabase/admin';` (:8)
  - en el import de `@/lib/supabase/storage` (:9-15) dejar solo `downloadReferenceBuffer` y `promoteOutputToReference` (quitar `downloadOutputBuffer`, `uploadOutput`, `uploadThumbnail`)
  - eliminar `import { completeGeneration, failGeneration, reserveCredits } from '@/lib/credits/operations';` (:18-22) por completo si ya nada de ahi se usa (verificar en Step 4 con lint).

- [ ] **Step 4: lint (detecta imports/binders sin uso).** Correr: `pnpm lint`
  Expected: sin warnings de `no-unused-vars` en `server-actions/storyboard.ts`. Si marca algun import restante sin uso, eliminarlo.

- [ ] **Step 5: typecheck.** Correr: `pnpm typecheck`
  Expected: sin errores.

- [ ] **Step 6: build (GOTCHA `'use server'` — verificacion final del invariante de export).** Correr: `pnpm build`
  Expected: `Compiled successfully`, exit 0. El archivo solo exporta funciones async (`generatePanelAction`, `setStoryboardLocationAction`, `refinePanelAction`, `setBeatAudioAction`); los esquemas/constantes viven en `lib/`.

- [ ] **Step 7: suite completa final.** Correr: `pnpm test`
  Expected: `Test Files  N passed`, 0 fallidos.

- [ ] **Step 8: commit.** Correr: `git add server-actions/storyboard.ts && git commit -m "refactor(storyboard): purgar utilidades e imports muertos tras delegar a Ola 1"`
  Expected: 1 commit, 1 archivo modificado.

---

**Riesgos / notas para el ejecutor:**
1. **thought_signature (critico para el encadenado).** Hoy la accion guarda `result.thoughtSignature` en `provider_payload.thought_signature` via `completeGeneration` (:408-420 y :711-725). Al delegar a `runSyncGeneration`, esa escritura pasa a ser responsabilidad del paso "complete" que posee Ola 1 (`finalizeGeneration`, que recibe `result` con `thoughtSignature`). VERIFICAR en la implementacion de Ola 1 que `runSyncGeneration`/`finalizeGeneration` persisten `result.thoughtSignature` en `provider_payload`. Si NO lo hacen, el refinado conversacional (que lee `parent.provider_payload.thought_signature` via `loadPreviousTurn`) y el encadenado del 2do panel pierden la firma -> es un BUG de Ola 1 a flagear, NO duplicar la escritura aqui (rompe la capa fina).
2. **Validacion mas estricta (cambio intencional).** Pasar de chequeos de truthiness a zod `uuid()` rechaza entradas malformadas que antes "pasaban": p.ej. `locationId === ''` que el codigo viejo trataba como "quitar locacion" ahora devuelve `validation_error`. El cliente real (`StoryboardView.tsx`) siempre manda uuid o `null`, asi que el camino feliz es identico; mencionar en el reporte de PR.
3. **Orden de revalidate vs promocion.** El original hace `revalidatePath` DESPUES de promover+linkear; ahora `runSyncGeneration` revalida via `revalidatePaths` alrededor del `finalize`/`onComplete`. `revalidatePath` es idempotente, pero el smoke (S7.4/S7.5) debe confirmar que la grilla del storyboard refresca tras generar/refinar.
4. **chatReferences (rama experimental).** El re-anclado de la imagen del producto en chat (`productChatRefs` -> `chatReferences`) se movio dentro del closure `generate`. Solo se activa con el toggle UI o `STORYBOARD_PRODUCT_REF_IN_CHAT=1`; si el usuario no lo usa, no hay que smoke-probarlo, pero la ruta de codigo debe compilar (cubierto por build).
5. **Cliente Supabase unico.** S7.4/S7.5 consolidan `locClient`+`supabase` en un solo `createClient()` por accion. `loadItemAndCampaign` sigue creando el suyo internamente (sin cambio); es aceptable y reduce ruido en los closures.


---

## Ola 4 — Hot path (créditos / encadenado)

*Refactor de movimiento puro apoyado en los tests existentes (director-context, continuation-prompt, sequence-chain, storyboard-video) como red. Correr la suite ANTES y DESPUÉS de cada task. `orchestrator.ts` y `route.ts` se mantienen como barrel/entrypoint para no romper callers.*

### Unidad S8: lib/campaigns/orchestrator.ts (1041 lineas, god module) -> modulos por responsabilidad

**Objetivo.** `lib/campaigns/orchestrator.ts` es un god module en el HOT PATH de creditos/encadenado: mezcla tipos compartidos, resolvers de DB, prompt puro, persistencia de generaciones y el bucle de encolado. Lo partimos por responsabilidad en modulos < 250 lineas con las funciones deterministas cubiertas por tests de caracterizacion en node, dejando `orchestrator.ts` como **barrel re-exportador** para que los 3 callers de produccion (`app/api/jobs/process/route.ts`, `server-actions/campaigns.ts`, `server-actions/storyboard.ts`) sigan importando exactamente lo mismo y NO se toquen. Es un refactor de **movimiento puro, comportamiento identico**: la red de seguridad son los tests existentes (`director-context.test`, `continuation-prompt.test`, `sequence-chain.test`, `storyboard-video.test`, `campaigns.test`) que deben quedar verdes ANTES y DESPUES de cada task. No se consolidan los fail-paths de creditos (delete vs mark-failed vs keep-for-resume difieren entre sitios); solo se comparten helpers PUROS. `regenerateChainClip` NO se extrae aqui (vive en `server-actions/campaigns.ts`, dominio de Ola 3): S8 solo provee sus building blocks via el barrel.

**Nota de invariantes.** `orchestrator.ts` usa `import 'server-only'` pero NO es `'use server'`, asi que puede re-exportar tipos y valores libremente. Aun asi, los callers `campaigns.ts`/`storyboard.ts` SI son `'use server'`: el gotcha de `'use server'` (typecheck/lint NO lo detectan, solo `pnpm build`) obliga a correr `pnpm build` en cada task que altere el grafo de imports. `server-only` esta aliasado a `node_modules/server-only/empty.js` en `vitest.config.ts:17`, por lo que los modulos con `import 'server-only'` SON testeables bajo vitest. Regla anti-ciclo: los submodulos importan entre si directamente (`./context-loader`, `./director-context`, ...), NUNCA desde el barrel `./orchestrator`.

#### File Structure

Nuevos:
- `lib/campaigns/context-types.ts` (sin server-only) — tipos compartidos `ItemRow`, `FormatRow`, `CampaignContext`, `BatchResult`, `ChainParams` + funcion pura `itemCharacterIds`. Base comun importable por modulos puros e IO sin arrastrar `server-only`.
- `lib/campaigns/context-types.test.ts` — caracterizacion de `itemCharacterIds`.
- `lib/campaigns/director-context.ts` (sin server-only) — `directorContextFor` (puro).
- `lib/campaigns/continuation-prompt.ts` (sin server-only) — `buildContinuationPrompt` (puro) + `chainSupported` (lee env).
- `lib/campaigns/context-loader.ts` (`server-only`) — resolvers/loaders de DB: `resolvePaths`, `resolveUsages`, `resolveLocations`, `resolveCharacterMasterPaths`, `resolveCharacterMasterPathsAdmin`, `loadTemplateVideoPaths`, `loadCampaignContext`.
- `lib/campaigns/chain-frame.ts` (`server-only`) — `storeChainFrame` (descarga fotograma + sube a references).
- `lib/campaigns/chain-advance.ts` (`server-only`) — `advanceSequenceChain` (avance de cadena en el worker).
- `lib/campaigns/batch-params.ts` (sin server-only) — helpers PUROS `computeChainRoles` + `buildItemGenerationParams`.
- `lib/campaigns/batch-params.test.ts` — caracterizacion de ambos.
- `lib/campaigns/batch-enqueue.ts` (`server-only`) — `enqueueBatch` (bucle de encolado del lote).

Modificados:
- `lib/campaigns/orchestrator.ts` — se vacia a barrel re-exportador (mantiene `import 'server-only'`).
- `lib/campaigns/director-context.test.ts` — repunta imports a `./director-context`, `./context-loader`, `./context-types`.
- `lib/campaigns/continuation-prompt.test.ts` — repunta import a `./continuation-prompt`.

NO modificados (validacion clave del barrel): `app/api/jobs/process/route.ts`, `server-actions/campaigns.ts`, `server-actions/storyboard.ts`.

---

### Task S8.1: Extraer tipos compartidos + itemCharacterIds a context-types.ts

**Files:**
- Create: `lib/campaigns/context-types.ts`
- Create: `lib/campaigns/context-types.test.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve tipos 27-53, 88-98, 100-114, 385-389, 399-420 y `itemCharacterIds` 56-59; el resto del archivo importa desde el nuevo modulo y re-exporta)

**Interfaces:**
- Consumes (Ola 1): ninguno.
- Produces:
  - `export type ItemRow = { id: string; campaign_id: string; format_id: string | null; template_id: string | null; model_slug: string; duration_s: number | null; aspect_ratio: string | null; scene: string | null; audio: boolean; character_id: string | null; character_ids: string[] | null; reference_ids: string[] | null; scene_prompt: string; status: string; sequence_id: string | null; scene_index: number | null; location_id: string | null; storyboard_image_id: string | null; character_state_hint: string | null };` (verbatim de orchestrator.ts:27-53)
  - `export type FormatRow = { id: string; slug: string; name: string; register: string | null; camera_style: string | null; pacing: string | null; required_refs: string[]; default_duration_s: number; default_audio: boolean };` (verbatim de 88-98, ahora exportado)
  - `export type CampaignContext = { productName: string; visualDetails?: string; palette?: string[]; productImagePaths: string[]; packagingImagePaths: string[]; characters: Map<string, { name: string; description: string; masterImagePath: string; angleImagePaths: string[]; states?: Record<string, string> }>; language: 'es' | 'en'; audioRefPath?: string; productImageUsages?: Record<string, string> };` (verbatim de 100-114)
  - `export type BatchResult = { enqueued: number; skipped: Array<{ itemId: string; reason: string }>; creditsReserved: number };` (verbatim de 385-389)
  - `export type ChainParams = { campaignId: string; sequenceId: string; sceneIndex: number; productImagePaths?: string[]; characterImagePaths?: string[]; prevFramePath?: string; resolution?: SeedanceResolution; language?: 'es' | 'en'; audioRefPath?: string };` (verbatim de 399-420; importa `SeedanceResolution` de `@/lib/providers/seedance`)
  - `export function itemCharacterIds(item: Pick<ItemRow, 'character_id' | 'character_ids'>): string[];` (verbatim de 56-59)

**Steps:**
- [ ] **Step 1: Baseline verde.** Correr `pnpm test lib/campaigns` y anotar el conteo. Expected: todos los archivos `lib/campaigns/*.test.ts` pasan (incl. `director-context.test.ts`, `continuation-prompt.test.ts`, `sequence-chain.test.ts`, `storyboard-video.test.ts`, `campaigns.test.ts`), `0 failed`.
- [ ] **Step 2: Test de caracterizacion (red).** Crear `lib/campaigns/context-types.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { itemCharacterIds } from './context-types';

  describe('itemCharacterIds', () => {
    it('usa character_ids cuando existe y lo corta a 3', () => {
      expect(itemCharacterIds({ character_ids: ['a', 'b', 'c', 'd'], character_id: 'z' })).toEqual(['a', 'b', 'c']);
    });
    it('cae al character_id legacy cuando character_ids es null/vacio', () => {
      expect(itemCharacterIds({ character_ids: null, character_id: 'z' })).toEqual(['z']);
      expect(itemCharacterIds({ character_ids: [], character_id: 'z' })).toEqual(['z']);
    });
    it('sin ninguno devuelve []', () => {
      expect(itemCharacterIds({ character_ids: null, character_id: null })).toEqual([]);
    });
  });
  ```
  Correr `pnpm test lib/campaigns/context-types.test.ts`. Expected: FALLA con "Failed to resolve import './context-types'" (el modulo aun no existe).
- [ ] **Step 3: Crear el modulo.** Crear `lib/campaigns/context-types.ts` con `import type { SeedanceResolution } from '@/lib/providers/seedance';` y mover **verbatim** desde `orchestrator.ts` los tipos `ItemRow` (27-53), `FormatRow` (88-98, anteponiendo `export`), `CampaignContext` (100-114), `BatchResult` (385-389), `ChainParams` (399-420 incluido su comentario) y la funcion `itemCharacterIds` (55-59). Sin `import 'server-only'`.
- [ ] **Step 4: Test verde.** Correr `pnpm test lib/campaigns/context-types.test.ts`. Expected: `3 passed`.
- [ ] **Step 5: Rewire orchestrator.** En `orchestrator.ts`: borrar las definiciones movidas; agregar `import { itemCharacterIds, type ItemRow, type FormatRow, type CampaignContext, type BatchResult, type ChainParams } from './context-types';` y, al final, re-exportar la superficie publica: `export { itemCharacterIds } from './context-types'; export type { ItemRow, FormatRow, CampaignContext, BatchResult, ChainParams } from './context-types';`. Mantener `import type { SeedanceResolution }` solo si sigue usandose en el archivo (ya no: queda en context-types) — eliminarlo si queda sin uso.
- [ ] **Step 6: Verificacion (incluye build por el gotcha 'use server').** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck sin errores; build "Compiled successfully"; suite de campaigns verde. Recordatorio: typecheck/lint NO ven una ruptura del grafo `'use server'`; por eso el `pnpm build`.
- [ ] **Step 7: Commit.** `git add lib/campaigns/context-types.ts lib/campaigns/context-types.test.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer tipos compartidos e itemCharacterIds a context-types"`. Expected: commit creado, sin trailer Co-Authored-By.

---

### Task S8.2: Extraer buildContinuationPrompt + chainSupported a continuation-prompt.ts

**Files:**
- Create: `lib/campaigns/continuation-prompt.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve `chainSupported` 393-395 y `buildContinuationPrompt` 426-466; re-exporta)
- Test: `lib/campaigns/continuation-prompt.test.ts` (repunta import a `./continuation-prompt`)

**Interfaces:**
- Consumes: `DIALOGUE_LANGUAGE`, `SPEECH_DIRECTION`, `hasSpokenDialogue`, `sceneHasVoice` de `@/lib/prompt-director/compilers/seedance` (import profundo existente, se mueve verbatim).
- Produces:
  - `export function chainSupported(): boolean;` (verbatim de 393-395; `process.env.SEEDANCE_PROVIDER === 'atlas'`)
  - `export function buildContinuationPrompt(scenePrompt: string, productCount: number, characterCount: number, opts?: { withClosingFrame?: boolean; language?: 'es' | 'en'; generateAudio?: boolean }): string;` (verbatim de 426-466)

**Steps:**
- [ ] **Step 1: Crear el modulo.** Crear `lib/campaigns/continuation-prompt.ts` con `import { DIALOGUE_LANGUAGE, SPEECH_DIRECTION, hasSpokenDialogue, sceneHasVoice } from '@/lib/prompt-director/compilers/seedance';` y mover **verbatim** `chainSupported` (391-395 con su comentario) y `buildContinuationPrompt` (422-466 con su comentario). Sin `server-only`.
- [ ] **Step 2: Repuntar el test existente (caracterizacion).** En `lib/campaigns/continuation-prompt.test.ts:2` cambiar `import { buildContinuationPrompt } from './orchestrator';` por `import { buildContinuationPrompt } from './continuation-prompt';`.
- [ ] **Step 3: Test verde.** Correr `pnpm test lib/campaigns/continuation-prompt.test.ts`. Expected: los 9 casos pasan (`9 passed`).
- [ ] **Step 4: Rewire orchestrator.** En `orchestrator.ts`: borrar `chainSupported` y `buildContinuationPrompt`; borrar el import de `@/lib/prompt-director/compilers/seedance` si queda sin uso en el archivo; agregar al barrel `export { buildContinuationPrompt, chainSupported } from './continuation-prompt';`.
- [ ] **Step 5: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck OK; build "Compiled successfully"; suite verde (`continuation-prompt.test` incluido). El `pnpm build` cubre el gotcha 'use server' de `campaigns.ts` (que importa `buildContinuationPrompt` via barrel).
- [ ] **Step 6: Commit.** `git add lib/campaigns/continuation-prompt.ts lib/campaigns/continuation-prompt.test.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer buildContinuationPrompt y chainSupported"`. Expected: commit creado.

---

### Task S8.3: Extraer directorContextFor a director-context.ts

**Files:**
- Create: `lib/campaigns/director-context.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve `directorContextFor` 321-364; re-exporta)
- Test: `lib/campaigns/director-context.test.ts` (repunta imports de `directorContextFor`/`CampaignContext`; `resolveLocations` se deja apuntando al barrel hasta S8.4)

**Interfaces:**
- Consumes: `fromFormatRow`, `type DirectorContext` de `@/lib/prompt-director`; `itemCharacterIds`, `type ItemRow`, `type FormatRow`, `type CampaignContext` de `./context-types`.
- Produces:
  - `export function directorContextFor(item: ItemRow, format: FormatRow | null, ctx: CampaignContext, templateVideoPath?: string, extraImagePaths?: string[], location?: { name?: string; description?: string; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }): DirectorContext;` (verbatim de 321-364)

**Steps:**
- [ ] **Step 1: Crear el modulo.** Crear `lib/campaigns/director-context.ts` con:
  ```ts
  import { fromFormatRow, type DirectorContext } from '@/lib/prompt-director';
  import { itemCharacterIds, type CampaignContext, type FormatRow, type ItemRow } from './context-types';
  ```
  y mover **verbatim** la funcion `directorContextFor` (321-364). Sin `server-only`.
- [ ] **Step 2: Repuntar el test (caracterizacion).** En `lib/campaigns/director-context.test.ts:2` separar imports:
  ```ts
  import { directorContextFor } from './director-context';
  import { resolveLocations } from './orchestrator';
  import type { CampaignContext } from './context-types';
  ```
  (`resolveLocations` sigue desde `./orchestrator` hasta S8.4.)
- [ ] **Step 3: Test verde.** Correr `pnpm test lib/campaigns/director-context.test.ts`. Expected: todos los describes pasan (scaleMap P15, audioRefPath P16, productImageUsages AM, character_state_hint P05, resolveLocations P15).
- [ ] **Step 4: Rewire orchestrator.** En `orchestrator.ts`: borrar `directorContextFor`; asegurar que `fromFormatRow`/`DirectorContext`/`onlyCharacterRefs`/`compile` siguen importados solo si el archivo aun los usa (a esta altura `enqueueBatch` sigue en orchestrator, asi que `compile`/`onlyCharacterRefs`/`fromFormatRow` se mantienen); agregar import interno `import { directorContextFor } from './director-context';` (lo usa `enqueueBatch` linea 826) y al barrel `export { directorContextFor } from './director-context';`.
- [ ] **Step 5: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck OK; build OK; suite verde. `pnpm build` cubre `storyboard.ts` (importa `directorContextFor` via barrel).
- [ ] **Step 6: Commit.** `git add lib/campaigns/director-context.ts lib/campaigns/director-context.test.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer directorContextFor a director-context"`. Expected: commit creado.

---

### Task S8.4: Extraer resolvers y loaders de DB a context-loader.ts

**Files:**
- Create: `lib/campaigns/context-loader.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve `resolveCharacterMasterPaths` 66-86, `resolvePaths` 117-134, `resolveUsages` 138-155, `resolveLocations` 159-204, `loadCampaignContext` 206-319, `loadTemplateVideoPaths` 367-383, `resolveCharacterMasterPathsAdmin` 494-523; re-exporta)
- Test: `lib/campaigns/director-context.test.ts` (repunta `resolveLocations` a `./context-loader`)

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server`; `createAdminClient` de `@/lib/supabase/admin`; `resolvePaths` (interno) por los demas resolvers; tipos `CampaignContext`, `ItemRow` de `./context-types`.
- Produces (todas verbatim, firmas sin cambio):
  - `export async function resolvePaths(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, ids: string[]): Promise<Map<string, string>>;`
  - `export async function resolveUsages(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, ids: string[]): Promise<Map<string, string>>;`
  - `export async function resolveLocations(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, locationIds: string[]): Promise<Map<string, { name: string; description: string | null; imagePaths: string[]; scaleMap?: { path: string; notes?: string } }>>;`
  - `export async function resolveCharacterMasterPaths(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string, characterIds: string[]): Promise<string[]>;`
  - `export async function resolveCharacterMasterPathsAdmin(admin: ReturnType<typeof createAdminClient>, workspaceId: string, characterIds: string[]): Promise<string[]>;`
  - `export async function loadTemplateVideoPaths(supabase: Awaited<ReturnType<typeof createClient>>, items: ItemRow[]): Promise<Map<string, string>>;`
  - `export async function loadCampaignContext(workspaceId: string, campaign: { brand_kit_id: string | null; product_brief: Record<string, unknown> | null; language?: string | null; include_packaging?: boolean | null; music_ref_id?: string | null }, characterIds: string[]): Promise<CampaignContext>;`

**Steps:**
- [ ] **Step 1: Crear el modulo.** Crear `lib/campaigns/context-loader.ts` con cabecera:
  ```ts
  import 'server-only';
  import { createClient } from '@/lib/supabase/server';
  import { createAdminClient } from '@/lib/supabase/admin';
  import type { CampaignContext, ItemRow } from './context-types';
  ```
  Mover **verbatim** y anteponer `export` donde haga falta: `resolvePaths` (116-134), `resolveUsages` (136-155), `resolveLocations` (157-204, ya exportada), `resolveCharacterMasterPaths` (60-86, ya exportada), `resolveCharacterMasterPathsAdmin` (491-523), `loadTemplateVideoPaths` (366-383), `loadCampaignContext` (206-319). `resolvePaths`/`resolveUsages`/`loadTemplateVideoPaths` pasan de privadas a `export` (las usa `batch-enqueue` en S8.8 y `resolveCharacterMasterPaths` internamente). Nota: el tipo del Map de `resolveLocations` se mantiene identico (incluye `scaleMap`).
- [ ] **Step 2: Repuntar resolveLocations en el test.** En `lib/campaigns/director-context.test.ts` cambiar `import { resolveLocations } from './orchestrator';` por `import { resolveLocations } from './context-loader';`.
- [ ] **Step 3: Test verde.** Correr `pnpm test lib/campaigns/director-context.test.ts`. Expected: describes de `resolveLocations` (P15) y `directorContextFor` pasan.
- [ ] **Step 4: Rewire orchestrator.** En `orchestrator.ts`: borrar las 7 funciones movidas; quitar imports que queden sin uso por el momento (`createAdminClient` sigue usado por `advanceSequenceChain` y `enqueueBatch`, que aun viven aqui; `createClient` idem). Agregar imports internos que `advanceSequenceChain`/`enqueueBatch` necesiten (`resolveCharacterMasterPathsAdmin`, `resolvePaths`, `resolveLocations`, `loadTemplateVideoPaths`, `loadCampaignContext`) desde `./context-loader`. Agregar al barrel `export { resolvePaths, resolveUsages, resolveLocations, resolveCharacterMasterPaths, resolveCharacterMasterPathsAdmin, loadTemplateVideoPaths, loadCampaignContext } from './context-loader';`.
- [ ] **Step 5: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck OK; build OK; suite verde. `pnpm build` cubre `campaigns.ts` y `storyboard.ts` (importan `loadCampaignContext`/`resolveLocations`/`resolveCharacterMasterPaths` via barrel).
- [ ] **Step 6: Commit.** `git add lib/campaigns/context-loader.ts lib/campaigns/director-context.test.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer resolvers y loaders de DB a context-loader"`. Expected: commit creado.

---

### Task S8.5: Extraer storeChainFrame a chain-frame.ts

**Files:**
- Create: `lib/campaigns/chain-frame.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve `storeChainFrame` 472-489; re-exporta)

**Interfaces:**
- Consumes: `uploadReference` de `@/lib/supabase/storage`.
- Produces:
  - `export async function storeChainFrame(workspaceId: string, sequenceId: string, sceneIndex: number, frameUrl: string): Promise<string | null>;` (verbatim de 472-489)

**Steps:**
- [ ] **Step 1: Crear el modulo.** Crear `lib/campaigns/chain-frame.ts`:
  ```ts
  import 'server-only';
  import { uploadReference } from '@/lib/supabase/storage';
  ```
  y mover **verbatim** `storeChainFrame` (468-489 con su comentario). Mantener el calculo inline de extension (`mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'`) sin sustituir por `inferExtension` de Ola 1: el mapeo difiere (inferExtension cubre webp y otros) y este refactor exige comportamiento identico.
- [ ] **Step 2: Rewire orchestrator.** En `orchestrator.ts`: borrar `storeChainFrame`; quitar el import de `uploadReference` si queda sin uso (lo usaba solo `storeChainFrame`); agregar import interno `import { storeChainFrame } from './chain-frame';` (lo usa `advanceSequenceChain`, que aun vive aqui) y al barrel `export { storeChainFrame } from './chain-frame';`.
- [ ] **Step 3: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck OK; build OK; suite verde. `pnpm build` cubre `route.ts` (importa `storeChainFrame` via barrel).
- [ ] **Step 4: Commit.** `git add lib/campaigns/chain-frame.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer storeChainFrame a chain-frame"`. Expected: commit creado.

**Smoke manual (opcional, lo corre el usuario):** No aplica UI. `storeChainFrame` solo se ejercita en el worker con URL real de proveedor; queda cubierto por el smoke de encadenado que corre el usuario.

---

### Task S8.6: Extraer advanceSequenceChain a chain-advance.ts

**Files:**
- Create: `lib/campaigns/chain-advance.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve `advanceSequenceChain` 532-687; re-exporta)

**Interfaces:**
- Consumes (Ola 1): `safeFailGeneration` de `@/lib/generation/credit-lifecycle` (reemplaza el `try { failGeneration } catch { console.error }` de 677-681, 1:1, swallow + log).
- Consumes (resto): `createAdminClient` de `@/lib/supabase/admin`; `loadPricing` de `@/lib/credits/pricing`; `reserveCredits` de `@/lib/credits/operations`; `enqueueJob` de `@/lib/jobs/queue`; `seedanceCostPerItem` de `./estimate`; `nextSceneItem`, `shouldReturnLastFrame` de `./sequence-chain`; `buildContinuationPrompt` de `./continuation-prompt`; `storeChainFrame` de `./chain-frame`; `resolveCharacterMasterPathsAdmin` de `./context-loader`; `itemCharacterIds`, `type ChainParams` de `./context-types`; `type SeedanceResolution` de `@/lib/providers/seedance`.
- Produces:
  - `export async function advanceSequenceChain(gen: { id: string; user_id: string; workspace_id: string; model_id: string; params: Record<string, unknown> }, frame: { path?: string; url?: string }): Promise<void>;` (de 532-687)

**Steps:**
- [ ] **Step 1: Crear el modulo.** Crear `lib/campaigns/chain-advance.ts` con `import 'server-only';` y los imports de la seccion Interfaces. Mover **verbatim** `advanceSequenceChain` (524-687 con su comentario de cabecera).
- [ ] **Step 2: Consumir safeFailGeneration (Ola 1, 1:1).** En el `catch (err)` del avance (lineas 675-686 del original), reemplazar el bloque interno:
  ```ts
  try {
    await failGeneration(gen.user_id, nextGenId, reserved ? cost : 0, `chain_advance: ${message}`);
  } catch (failErr) {
    console.error('[chain:fail_generation]', { itemId: next.id, error: message, failError: (failErr as Error)?.message });
  }
  ```
  por:
  ```ts
  await safeFailGeneration({ userId: gen.user_id, generationId: nextGenId, refund: reserved ? cost : 0, reason: `chain_advance: ${message}`, logLabel: '[chain:fail_generation]' });
  ```
  Mantener intacto el `update` de `campaign_items` a `status: 'failed'` que sigue. NO tocar el path `!reserved` (marca la generacion `'failed'` + item `'failed'` conservando referencias para resume): ese no es `reserveOrDeleteGeneration` (que borraria), su semantica difiere.
- [ ] **Step 3: Rewire orchestrator.** En `orchestrator.ts`: borrar `advanceSequenceChain`; quitar imports que queden sin uso (a esta altura `enqueueBatch` aun usa `reserveCredits`/`enqueueJob`/`failGeneration`/`createAdminClient`/`loadPricing`/`seedanceCostPerItem`, asi que conservar los que siga usando); agregar al barrel `export { advanceSequenceChain } from './chain-advance';`.
- [ ] **Step 4: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck OK; build "Compiled successfully"; suite verde (incl. `sequence-chain.test`, `continuation-prompt.test`). `pnpm build` cubre `route.ts` (importa `advanceSequenceChain` via barrel).
- [ ] **Step 5: Commit.** `git add lib/campaigns/chain-advance.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer advanceSequenceChain a chain-advance"`. Expected: commit creado.

**Smoke manual (lo corre el usuario):** Encadenado Atlas — generar una secuencia multi-escena con `SEEDANCE_PROVIDER=atlas` y verificar que el clip 2+ se encola tras finalizar el clip 1 (la cadena avanza) y que un fallo de creditos deja el item `'failed'` reanudable. Subagent NO llama a APIs reales.

---

### Task S8.7: Extraer helpers puros computeChainRoles + buildItemGenerationParams a batch-params.ts (y cablear enqueueBatch)

**Files:**
- Create: `lib/campaigns/batch-params.ts`
- Create: `lib/campaigns/batch-params.test.ts`
- Modify: `lib/campaigns/orchestrator.ts` (dentro de `enqueueBatch`: reemplaza el bloque 742-800 por `computeChainRoles` y el ternario 930-982 por `buildItemGenerationParams`)

**Interfaces:**
- Consumes: `isLocationMode`, `isStoryboardVideoMode` de `./sequence-chain`; `itemCharacterIds`, `type ItemRow`, `type ChainParams` de `./context-types`.
- Produces:
  - `export type ChainRole = { skip: boolean; isFirst: boolean; returnLastFrame: boolean; orphanResume: boolean };`
  - `export function computeChainRoles(input: { allItems: ItemRow[]; selected: ItemRow[]; chaining: boolean }): Map<string, ChainRole>;` (rol por `item.id` de cada seleccionado; reproduce la logica de seqGroups/seqPending/seqHeadStatus 742-762 + el closure `chainRole` 764-800)
  - `export function buildItemGenerationParams(input: { mode: 'r2v'; aspectRatio: string; resolution: '480p' | '720p' | '1080p'; duration: number; generateAudio: boolean; seed?: number; castR2VRefs: string[]; castR2VAudios: string[] } | { mode: 'storyboardI2V'; aspectRatio: string; resolution: '480p' | '720p' | '1080p'; duration: number; generateAudio: boolean; seed?: number; panelPath: string } | { mode: 'normal'; operation: string; aspectRatio: string; resolution: '480p' | '720p' | '1080p'; duration: number; generateAudio: boolean; seed?: number; refImages: string[]; refVideos: string[]; refAudios: string[]; chain?: ChainParams; returnLastFrame?: boolean }): Record<string, unknown>;` (reproduce el ternario triple 930-982; el caso `normal` con `chain` presente agrega `returnLastFrame` + `chain`)

**Steps:**
- [ ] **Step 1: Test de caracterizacion (red).** Crear `lib/campaigns/batch-params.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { computeChainRoles, buildItemGenerationParams } from './batch-params';
  import type { ItemRow } from './context-types';

  function item(p: Partial<ItemRow>): ItemRow {
    return {
      id: 'i', campaign_id: 'c', format_id: null, template_id: null, model_slug: 'bytedance/seedance-2.0/reference-to-video',
      duration_s: 8, aspect_ratio: '9:16', scene: null, audio: true, character_id: null, character_ids: null,
      reference_ids: null, scene_prompt: 's', status: 'planned', sequence_id: null, scene_index: null,
      location_id: null, storyboard_image_id: null, character_state_hint: null, ...p,
    };
  }

  describe('computeChainRoles', () => {
    it('storyboard-video gana: no encadena', () => {
      const it0 = item({ id: 'sb', storyboard_image_id: 'panel' });
      const r = computeChainRoles({ allItems: [it0], selected: [it0], chaining: true }).get('sb')!;
      expect(r).toEqual({ skip: false, isFirst: false, returnLastFrame: false, orphanResume: false });
    });
    it('modo-locacion no encadena aun con chaining', () => {
      const it0 = item({ id: 'loc', location_id: 'L', sequence_id: 'S', scene_index: 1 });
      const r = computeChainRoles({ allItems: [it0], selected: [it0], chaining: true }).get('loc')!;
      expect(r.skip).toBe(false);
    });
    it('secuencia multi-escena: cabecera isFirst, no-cabecera skip', () => {
      const a = item({ id: 'a', sequence_id: 'S', scene_index: 0 });
      const b = item({ id: 'b', sequence_id: 'S', scene_index: 1 });
      const roles = computeChainRoles({ allItems: [a, b], selected: [a, b], chaining: true });
      expect(roles.get('a')).toEqual({ skip: false, isFirst: true, returnLastFrame: true, orphanResume: false });
      expect(roles.get('b')!.skip).toBe(true);
      expect(roles.get('b')!.orphanResume).toBe(false); // cabecera pendiente arrastra la cadena
    });
    it('no-cabecera huerfana cuando la cabecera ya paso (no pendiente, no in-flight)', () => {
      const a = item({ id: 'a', sequence_id: 'S', scene_index: 0, status: 'done' });
      const b = item({ id: 'b', sequence_id: 'S', scene_index: 1 });
      const roles = computeChainRoles({ allItems: [a, b], selected: [b], chaining: true });
      expect(roles.get('b')).toEqual({ skip: true, isFirst: false, returnLastFrame: false, orphanResume: true });
    });
    it('chaining=false: secuencia normal (no skip)', () => {
      const a = item({ id: 'a', sequence_id: 'S', scene_index: 0 });
      const b = item({ id: 'b', sequence_id: 'S', scene_index: 1 });
      const roles = computeChainRoles({ allItems: [a, b], selected: [a, b], chaining: false });
      expect(roles.get('a')!.skip).toBe(false);
      expect(roles.get('b')!.skip).toBe(false);
    });
  });

  describe('buildItemGenerationParams', () => {
    it('normal no-cabecera: sin chain', () => {
      const p = buildItemGenerationParams({ mode: 'normal', operation: 'reference2video', aspectRatio: '9:16', resolution: '480p', duration: 8, generateAudio: true, refImages: ['x'], refVideos: [], refAudios: [] });
      expect(p.operation).toBe('reference2video');
      expect(p.referenceImagePaths).toEqual(['x']);
      expect('chain' in p).toBe(false);
      expect('seed' in p).toBe(false);
    });
    it('normal cabecera: returnLastFrame + chain', () => {
      const chain = { campaignId: 'c', sequenceId: 'S', sceneIndex: 0, productImagePaths: ['p'], characterImagePaths: [], resolution: '720p', language: 'es' } as const;
      const p = buildItemGenerationParams({ mode: 'normal', operation: 'reference2video', aspectRatio: '9:16', resolution: '720p', duration: 8, generateAudio: true, refImages: [], refVideos: [], refAudios: [], chain, returnLastFrame: true });
      expect(p.returnLastFrame).toBe(true);
      expect(p.chain).toEqual(chain);
    });
    it('r2v storyboard: operation reference2video + audios', () => {
      const p = buildItemGenerationParams({ mode: 'r2v', aspectRatio: '9:16', resolution: '480p', duration: 8, generateAudio: true, castR2VRefs: ['c1', 'panel'], castR2VAudios: ['m'] });
      expect(p.operation).toBe('reference2video');
      expect(p.referenceImagePaths).toEqual(['c1', 'panel']);
      expect(p.referenceAudioPaths).toEqual(['m']);
    });
    it('storyboard i2v: operation image2video + referenceStoragePath', () => {
      const p = buildItemGenerationParams({ mode: 'storyboardI2V', aspectRatio: '9:16', resolution: '480p', duration: 8, generateAudio: true, panelPath: 'panel' });
      expect(p.operation).toBe('image2video');
      expect(p.referenceStoragePath).toBe('panel');
    });
    it('seed presente cuando se pasa', () => {
      const p = buildItemGenerationParams({ mode: 'storyboardI2V', aspectRatio: '9:16', resolution: '480p', duration: 8, generateAudio: true, panelPath: 'panel', seed: 42 });
      expect(p.seed).toBe(42);
    });
  });
  ```
  Correr `pnpm test lib/campaigns/batch-params.test.ts`. Expected: FALLA con "Failed to resolve import './batch-params'".
- [ ] **Step 2: Crear el modulo.** Crear `lib/campaigns/batch-params.ts` (sin `server-only`) con los imports de Interfaces. Implementar:
  - `computeChainRoles`: portar 742-762 (construir `seqGroups`/`seqPending`/`seqHeadStatus` sobre `allItems`/`selected` cuando `chaining`) y, por cada item de `selected`, calcular el rol con la misma logica del closure `chainRole` (764-800: early-return de `isStoryboardVideoMode`/`isLocationMode`; `idxs.length <= 1` => normal; `min`/`max`; `headPending`/`headInFlight`/`orphanResume`). Devolver `Map<itemId, ChainRole>`.
  - `buildItemGenerationParams`: `switch (input.mode)` con los 3 objetos exactos de 931-982, incluyendo `...(seed !== undefined ? { seed } : {})` y, en `normal`, `...(chain ? { returnLastFrame, chain } : {})`.
- [ ] **Step 3: Test verde.** Correr `pnpm test lib/campaigns/batch-params.test.ts`. Expected: `10 passed`.
- [ ] **Step 4: Cablear enqueueBatch (interno, identico).** En `orchestrator.ts` dentro de `enqueueBatch`: importar `computeChainRoles`/`buildItemGenerationParams` de `./batch-params`. Reemplazar el bloque 742-800 (seqGroups/seqPending/seqHeadStatus + `function chainRole`) por `const roles = computeChainRoles({ allItems: params.items, selected, chaining });` y en el loop `const role = roles.get(item.id)!;` en vez de `const role = chainRole(item);`. Reemplazar el ternario triple del `params:` del insert (930-982) por una llamada a `buildItemGenerationParams({ ... })` que arme el `mode` segun `useR2V`/`storyboardMode` y, para `normal`, pase `chain` (el objeto `satisfies ChainParams` ya existente) y `returnLastFrame` solo cuando `role.isFirst`. El resto del cuerpo del insert (user_id, prompt, status, etc.) no cambia.
- [ ] **Step 5: Verificacion.** Correr `pnpm typecheck && pnpm build && pnpm test lib/campaigns`. Expected: typecheck OK; build OK; **suite COMPLETA de campaigns verde** (es la red del HOT PATH: `campaigns.test`, `storyboard-video.test`, `sequence-chain.test` deben seguir verdes — confirma que el rol y los params no cambiaron de comportamiento).
- [ ] **Step 6: Commit.** `git add lib/campaigns/batch-params.ts lib/campaigns/batch-params.test.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): computeChainRoles y buildItemGenerationParams puros + tests"`. Expected: commit creado.

---

### Task S8.8: Extraer enqueueBatch a batch-enqueue.ts y dejar orchestrator como barrel

**Files:**
- Create: `lib/campaigns/batch-enqueue.ts`
- Modify: `lib/campaigns/orchestrator.ts` (mueve `enqueueBatch` 691-1041; queda como barrel puro)

**Interfaces:**
- Consumes (Ola 1): `safeFailGeneration` de `@/lib/generation/credit-lifecycle` (reemplaza el `try { failGeneration } catch { console.error }` de 1026-1035, 1:1).
- Consumes (resto): `createClient` de `@/lib/supabase/server`; `createAdminClient` de `@/lib/supabase/admin`; `loadPricing` de `@/lib/credits/pricing`; `reserveCredits` de `@/lib/credits/operations`; `enqueueJob` de `@/lib/jobs/queue`; `compile`, `onlyCharacterRefs` de `@/lib/prompt-director`; `seedanceCostPerItem` de `./estimate`; `selectBatchItems` de `./batch-selection`; `isLocationMode`, `isStoryboardVideoMode`, `toImage2VideoSlug` de `./sequence-chain`; `beatNamesCast`, `buildCastR2VRefs`, `STORYBOARD_EDIT_HANDLES` de `./storyboard-video`; `loadCampaignContext`, `loadTemplateVideoPaths`, `resolvePaths`, `resolveLocations` de `./context-loader`; `directorContextFor` de `./director-context`; `chainSupported` de `./continuation-prompt`; `computeChainRoles`, `buildItemGenerationParams` de `./batch-params`; `itemCharacterIds`, `type ItemRow`, `type FormatRow`, `type BatchResult`, `type ChainParams` de `./context-types`.
- Produces:
  - `export async function enqueueBatch(params: { userId: string; workspaceId: string; campaign: { id: string; brand_kit_id: string | null; product_brief: Record<string, unknown> | null; language?: string | null; include_packaging?: boolean | null; music_ref_id?: string | null }; items: ItemRow[]; formats: Map<string, FormatRow>; mode: 'sample' | 'full' }): Promise<BatchResult>;` (de 689-1041)

**Steps:**
- [ ] **Step 1: Crear el modulo.** Crear `lib/campaigns/batch-enqueue.ts` con `import 'server-only';` + el `const STAGGER_SECONDS = 20;` (linea 25) y los imports de Interfaces. Mover **verbatim** `enqueueBatch` (689-1041) **ya en su forma cableada de S8.7** (con `computeChainRoles`/`buildItemGenerationParams`).
- [ ] **Step 2: Consumir safeFailGeneration (Ola 1, 1:1).** En el `catch (err)` del loop (1024-1035), reemplazar:
  ```ts
  try {
    await failGeneration(userId, generationId, reserved ? cost : 0, `batch_enqueue: ${message}`);
  } catch (failErr) {
    console.error('[campaign_batch:fail_generation]', { generationId, itemId: item.id, error: message, failError: (failErr as Error)?.message });
  }
  ```
  por:
  ```ts
  await safeFailGeneration({ userId, generationId, refund: reserved ? cost : 0, reason: `batch_enqueue: ${message}`, logLabel: '[campaign_batch:fail_generation]' });
  ```
  NO tocar el path `!reserved` (borra la generacion con `admin.delete` + `break`): difiere de `reserveOrDeleteGeneration` por el `break` del bucle y por el `result.skipped.push`.
- [ ] **Step 3: Convertir orchestrator en barrel.** Reescribir `lib/campaigns/orchestrator.ts` a SOLO re-exports (mantener `import 'server-only';` y el comentario de cabecera del orquestador):
  ```ts
  import 'server-only';

  export { itemCharacterIds } from './context-types';
  export type { ItemRow, FormatRow, CampaignContext, BatchResult, ChainParams } from './context-types';
  export { directorContextFor } from './director-context';
  export { buildContinuationPrompt, chainSupported } from './continuation-prompt';
  export {
    resolvePaths,
    resolveUsages,
    resolveLocations,
    resolveCharacterMasterPaths,
    resolveCharacterMasterPathsAdmin,
    loadTemplateVideoPaths,
    loadCampaignContext,
  } from './context-loader';
  export { storeChainFrame } from './chain-frame';
  export { advanceSequenceChain } from './chain-advance';
  export { computeChainRoles, buildItemGenerationParams } from './batch-params';
  export { enqueueBatch } from './batch-enqueue';
  ```
  Confirmar que NO quedan definiciones ni imports de runtime sin usar en el archivo (debe quedar < 25 lineas).
- [ ] **Step 4: Verificacion (critica, todo el grafo).** Correr `pnpm typecheck && pnpm build && pnpm test`. Expected: typecheck OK; build "Compiled successfully" (valida que `route.ts`, `campaigns.ts` y `storyboard.ts` resuelven todo via el barrel — y el gotcha 'use server' de los 2 ultimos); **suite COMPLETA verde** (`vitest run`, 0 failed).
- [ ] **Step 5: Verificar superficie del barrel sin cambios.** Correr `pnpm exec tsc --noEmit` ya cubierto; ademas correr en bash `git grep -n "from '@/lib/campaigns/orchestrator'" -- app server-actions` para confirmar que los 3 callers no cambiaron. Expected: 3 lineas (`route.ts`, `campaigns.ts`, `storyboard.ts`), ninguna modificada en este task.
- [ ] **Step 6: Commit.** `git add lib/campaigns/batch-enqueue.ts lib/campaigns/orchestrator.ts && git commit -m "refactor(campaigns): extraer enqueueBatch y dejar orchestrator como barrel"`. Expected: commit creado.

**Smoke manual (lo corre el usuario):** Campaign Studio — aprobar un lote `sample` de un formato con secuencia multi-escena y un item de storyboard; verificar que (a) se encolan los clips correctos (cabecera de secuencia, beats de storyboard R2V/I2V), (b) el escalonamiento por `idx * 20s` se mantiene, (c) sin creditos el lote corta con `insufficient_credits`. Subagent NO llama a APIs reales.

---

### Task S8.9: Cierre — verificacion final y limpieza

**Files:**
- Modify: ninguno de codigo (solo verificacion; eventuales ajustes menores de imports muertos detectados por lint)

**Interfaces:**
- Consumes: n/a. Produces: n/a.

**Steps:**
- [ ] **Step 1: Lint.** Correr `pnpm lint`. Expected: sin errores; en particular sin `no-unused-vars` en `orchestrator.ts` (barrel) ni en los modulos nuevos. Si lint marca un import muerto residual, eliminarlo (unico cambio permitido en este task).
- [ ] **Step 2: Conteo de lineas (objetivo < 250/modulo).** Correr en bash `wc -l lib/campaigns/{orchestrator,context-types,director-context,continuation-prompt,context-loader,chain-frame,chain-advance,batch-params,batch-enqueue}.ts`. Expected: `orchestrator.ts` < 25; cada modulo nuevo < 250 (el mayor, `batch-enqueue.ts`, ~210; `context-loader.ts` ~150; `chain-advance.ts` ~165).
- [ ] **Step 3: Verificacion global.** Correr `pnpm typecheck && pnpm build && pnpm test`. Expected: typecheck OK; build "Compiled successfully"; `vitest run` con 0 failed (incluye `context-types.test`, `batch-params.test`, `director-context.test`, `continuation-prompt.test`, `sequence-chain.test`, `storyboard-video.test`, `campaigns.test`).
- [ ] **Step 4: Commit (si hubo limpieza de lint).** `git add -A && git commit -m "refactor(campaigns): limpieza de imports tras split del orchestrator"`. Expected: commit creado, o "nothing to commit" si Step 1 no requirio cambios.

**Pendiente coordinado con Ola 3 (no se hace aqui):** `regenerateChainClip` sigue inline en `server-actions/campaigns.ts:1100-1257`. S8 deja disponibles via barrel todos sus building blocks (`buildContinuationPrompt`, `resolveCharacterMasterPaths`, `itemCharacterIds`, `type ChainParams`, `buildItemGenerationParams`) para que Ola 3 — duena de `campaigns.ts` — lo extraiga a `lib/campaigns/` sin re-derivar logica. NO editar `campaigns.ts` en S8 (cross-wave).
### Unidad S9: app/api/jobs/process/route.ts (273 lineas) + handlers -> separar transporte de orquestacion

**Objetivo.** Hoy el `POST` del worker mezcla tres responsabilidades: transporte HTTP (verificar firma QStash, parsear body, cargar la fila), la maquina de estados del job (guards terminal/cancel/timeout, dispatch, ramas continue/fail/finalize) y el acoplamiento con campañas (interceptacion de `advance_chain` + encadenado en finalize). Ademas, los 4 handlers de provider (`veo`, `kling`, `seedance`, `elevenlabs`) repiten verbatim el bloque `ProviderError -> code`. Este refactor es PURO movimiento, comportamiento IDENTICO: extraemos `mapProviderError()` a `lib/jobs/handlers/shared.ts` (unica funcion pura, con test de caracterizacion), movemos el encadenado a `lib/jobs/chain.ts`, movemos la maquina de estados a `lib/jobs/worker.ts` (`processJob` que devuelve un `WorkerOutcome` plano), y dejamos `route.ts` en ~50 lineas que solo hacen transporte: verify -> parse -> load -> `processJob` -> mapear `WorkerOutcome` a `NextResponse`. NO se tocan `queue.ts`, `receiver.ts`, `dispatch.ts`, `finalize.ts` ni `video-frame.ts` (ya bien dimensionados). Se respetan `MAX_POLLS` y `timeout_at` (decisiones intencionales, NO bugs) y el polling re-encolado SIN webhooks.

**FLAG (follow-up, NO se resuelve en esta unidad).** (1) La rama `continue` no protege contra entregas duplicadas concurrentes de QStash (el `WHERE status IN ('queued','processing')` con `count` mitiga el down-grade de terminales pero no una doble-submit simultanea antes de que ninguna escriba). (2) `app/api/jobs/cleanup` hace verify de firma opcional. Ambos quedan documentados como follow-up; este split NO los cambia.

**File Structure.**
- `lib/jobs/handlers/shared.ts` (NUEVO) — `mapProviderError(err): JobResult`. Funcion pura compartida por los 4 handlers; mapea `ProviderError.code` -> `JobResult['code']` y cualquier otro `Error` a `code:'unknown'`.
- `lib/jobs/handlers/shared.test.ts` (NUEVO) — test de caracterizacion de `mapProviderError`.
- `lib/jobs/handlers/veo.ts` (MODIFICAR) — reemplaza el `catch` inline por `return mapProviderError(err)`.
- `lib/jobs/handlers/kling.ts` (MODIFICAR) — idem.
- `lib/jobs/handlers/seedance.ts` (MODIFICAR) — idem.
- `lib/jobs/handlers/elevenlabs.ts` (MODIFICAR) — idem.
- `lib/jobs/chain.ts` (NUEVO) — `handleAdvanceChain()` (interceptacion del job `advance_chain`) y `enqueueChainAdvance()` (storeChainFrame + enqueue `advance_chain` tras finalize). Aisla el acoplamiento worker generico <-> campañas.
- `lib/jobs/worker.ts` (NUEVO) — `processJob(generation, action, frame): Promise<WorkerOutcome>`. La maquina de estados completa, devolviendo objeto plano sin saber de HTTP.
- `app/api/jobs/process/route.ts` (MODIFICAR, 273 -> ~50 lineas) — solo transporte: verify firma -> parse body -> load gen -> `processJob` -> mapear `WorkerOutcome` a `NextResponse`.

Notas de invariantes para todos los tasks: ningun archivo de esta unidad lleva la directiva `'use server'` (son `import 'server-only'`, route handler, y modulos lib), asi que el gotcha de "solo funciones async exportables" NO aplica; aun asi `route.ts` es una ruta Next y `server-only` es una frontera que SOLO `pnpm build` valida de punta a punta, por eso cada task corre `pnpm build` y NO se confia en `pnpm typecheck`/`pnpm lint` para dar el refactor por bueno.

---

### Task S9.1: Extraer `mapProviderError` a `lib/jobs/handlers/shared.ts` (con test de caracterizacion)

**Files:**
- Create: `lib/jobs/handlers/shared.ts`
- Create (Test): `lib/jobs/handlers/shared.test.ts`

**Interfaces:**
- Consumes: `ProviderError` desde `@/lib/providers/types` (clase con `readonly code: 'rate_limit'|'auth'|'safety'|'invalid_input'|'server'|'timeout'|'unknown'`); `JobResult` (type) desde `./types`.
- Produces:
  ```ts
  export function mapProviderError(err: unknown): JobResult;
  ```
  (devuelve siempre `{ kind: 'fail'; message: string; code: 'safety'|'rate_limit'|'timeout'|'unknown' }`)

**Steps:**

- [ ] **Step 1: Escribir el test de caracterizacion (debe FALLAR: el modulo no existe aun).**
  Crea `lib/jobs/handlers/shared.test.ts` con el comportamiento ACTUAL copiado de los 4 catch (`veo.ts:76-92`, `kling.ts:81-97`, `seedance.ts:122-138`, `elevenlabs.ts:55-71`):
  ```ts
  import { describe, it, expect } from 'vitest';
  import { ProviderError } from '@/lib/providers/types';
  import { mapProviderError } from './shared';

  describe('mapProviderError', () => {
    it('mapea ProviderError safety -> code safety', () => {
      const r = mapProviderError(new ProviderError('rechazado', 'safety'));
      expect(r).toEqual({ kind: 'fail', message: 'rechazado', code: 'safety' });
    });
    it('mapea ProviderError rate_limit -> code rate_limit', () => {
      const r = mapProviderError(new ProviderError('saturado', 'rate_limit'));
      expect(r).toEqual({ kind: 'fail', message: 'saturado', code: 'rate_limit' });
    });
    it('mapea ProviderError timeout -> code timeout', () => {
      const r = mapProviderError(new ProviderError('tarde', 'timeout'));
      expect(r).toEqual({ kind: 'fail', message: 'tarde', code: 'timeout' });
    });
    it('colapsa auth/invalid_input/server -> code unknown (preserva message)', () => {
      for (const c of ['auth', 'invalid_input', 'server'] as const) {
        const r = mapProviderError(new ProviderError(`e-${c}`, c));
        expect(r).toEqual({ kind: 'fail', message: `e-${c}`, code: 'unknown' });
      }
    });
    it('mapea un Error generico -> code unknown con su message', () => {
      const r = mapProviderError(new Error('boom'));
      expect(r).toEqual({ kind: 'fail', message: 'boom', code: 'unknown' });
    });
  });
  ```
  Corre: `pnpm test lib/jobs/handlers/shared.test.ts`
  Expected: FALLA con error de resolucion de modulo (`Failed to resolve import "./shared"` / `Cannot find module`).

- [ ] **Step 2: Crear `lib/jobs/handlers/shared.ts` con la funcion pura.**
  ```ts
  import 'server-only';
  import { ProviderError } from '@/lib/providers/types';
  import type { JobResult } from './types';

  // Mapea un error capturado de un adapter a un JobResult kind:'fail'. ProviderError
  // lleva un code semantico amplio; el worker solo distingue safety/rate_limit/timeout
  // para el mensaje al usuario, el resto colapsa a 'unknown'. Cualquier error no-Provider
  // se trata como 'unknown' preservando su message.
  export function mapProviderError(err: unknown): JobResult {
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
  ```

- [ ] **Step 3: Verificar que el test PASA.**
  Corre: `pnpm test lib/jobs/handlers/shared.test.ts`
  Expected: 5 tests passed.

- [ ] **Step 4: Typecheck + build (frontera server-only la valida el build).**
  Corre: `pnpm typecheck && pnpm build`
  Expected: typecheck sin errores; `Compiled successfully`. (Recordatorio: typecheck/lint NO ven roturas de frontera server/route; el build SI.)

- [ ] **Step 5: Commit.**
  Corre: `git add lib/jobs/handlers/shared.ts lib/jobs/handlers/shared.test.ts && git commit -m "refactor(worker): extraer mapProviderError a handlers/shared con test"`
  Expected: commit creado (sin trailer Co-Authored-By).

---

### Task S9.2: Reescribir los 4 handlers para usar `mapProviderError`

**Files:**
- Modify: `lib/jobs/handlers/veo.ts` (catch en lineas 76-92)
- Modify: `lib/jobs/handlers/kling.ts` (catch en lineas 81-97)
- Modify: `lib/jobs/handlers/seedance.ts` (catch en lineas 122-138)
- Modify: `lib/jobs/handlers/elevenlabs.ts` (catch en lineas 55-71)

**Interfaces:**
- Consumes: `mapProviderError` desde `./shared` (creado en S9.1).
- Produces: sin cambios de interfaz publica; cada `handler.handle` sigue devolviendo `Promise<JobResult>`.

**Steps:**

- [ ] **Step 1: veo.ts — reemplazar el catch y eliminar el import muerto.**
  En `lib/jobs/handlers/veo.ts`, sustituye el bloque `} catch (err) { if (err instanceof ProviderError) { ... } return { kind: 'fail', message: (err as Error).message, code: 'unknown' }; }` (lineas 76-92) por:
  ```ts
    } catch (err) {
      return mapProviderError(err);
    }
  ```
  En el import de la linea 3 (`import { ProviderError } from '@/lib/providers/types';`) elimina esa linea (ya no se usa) y agrega `import { mapProviderError } from './shared';`.

- [ ] **Step 2: kling.ts — mismo reemplazo.**
  En `lib/jobs/handlers/kling.ts` sustituye el catch (lineas 81-97) por `} catch (err) { return mapProviderError(err); }`, elimina `import { ProviderError } from '@/lib/providers/types';` (linea 3) y agrega `import { mapProviderError } from './shared';`.

- [ ] **Step 3: seedance.ts — mismo reemplazo.**
  En `lib/jobs/handlers/seedance.ts` sustituye el catch (lineas 122-138) por `} catch (err) { return mapProviderError(err); }`, elimina `import { ProviderError } from '@/lib/providers/types';` (linea 11) y agrega `import { mapProviderError } from './shared';`.

- [ ] **Step 4: elevenlabs.ts — mismo reemplazo.**
  En `lib/jobs/handlers/elevenlabs.ts` sustituye el catch (lineas 55-71) por `} catch (err) { return mapProviderError(err); }`, elimina `import { ProviderError } from '@/lib/providers/types';` (linea 3) y agrega `import { mapProviderError } from './shared';`.

- [ ] **Step 5: Typecheck + build.**
  Corre: `pnpm typecheck && pnpm build`
  Expected: sin errores (en particular ningun `'ProviderError' is declared but never used`); `Compiled successfully`.

- [ ] **Step 6: Suite completa verde.**
  Corre: `pnpm test`
  Expected: toda la suite pasa (incluye `shared.test.ts` y los tests existentes de providers; ningun handler tiene test propio, la cobertura del catch la da `shared.test.ts`).

- [ ] **Step 7: Commit.**
  Corre: `git add lib/jobs/handlers/veo.ts lib/jobs/handlers/kling.ts lib/jobs/handlers/seedance.ts lib/jobs/handlers/elevenlabs.ts && git commit -m "refactor(worker): handlers usan mapProviderError compartido"`
  Expected: commit creado.

---

### Task S9.3: Crear `lib/jobs/chain.ts` (encadenado de secuencias fuera del worker generico)

**Files:**
- Create: `lib/jobs/chain.ts`

**Interfaces:**
- Consumes: `advanceSequenceChain`, `storeChainFrame` desde `@/lib/campaigns/orchestrator`; `enqueueJob` desde `@/lib/jobs/queue`; `GenerationRow` (type) desde `./handlers/types`.
  - Firmas consumidas (verificadas en el codigo real): `advanceSequenceChain(gen: { id; user_id; workspace_id; model_id; params }, frame: { path?: string; url?: string }): Promise<void>`; `storeChainFrame(workspaceId: string, sequenceId: string, sceneIndex: number, frameUrl: string): Promise<string | null>`; `enqueueJob(input: { generationId; action; delaySeconds?; lastFramePath?; lastFrameUrl? }): Promise<{ messageId: string }>`.
- Produces:
  ```ts
  export async function handleAdvanceChain(
    generation: GenerationRow,
    frame: { path?: string; url?: string },
  ): Promise<void>;
  export async function enqueueChainAdvance(
    generation: GenerationRow,
    lastFrameUrl: string,
  ): Promise<void>;
  ```

**Steps:**

- [ ] **Step 1: Crear `lib/jobs/chain.ts` moviendo las dos piezas de encadenado del route.**
  `handleAdvanceChain` traslada el cuerpo de la interceptacion `route.ts:84-93` (sin el `return NextResponse`); `enqueueChainAdvance` traslada el bloque de finalize `route.ts:222-245` (el `if (generation.params?.chain && result.lastFrameUrl) { try { ... } catch }`), recibiendo `lastFrameUrl` ya validado por el caller. Ambos best-effort (tragan su error, igual que hoy).
  ```ts
  import 'server-only';
  import { advanceSequenceChain, storeChainFrame } from '@/lib/campaigns/orchestrator';
  import { enqueueJob } from '@/lib/jobs/queue';
  import type { GenerationRow } from './handlers/types';

  // Job 'advance_chain' (specs/v2/09): corre en su PROPIA invocacion con presupuesto
  // fresco. La gen ya esta 'done' (terminal) cuando esto se ejecuta. Best-effort: un
  // fallo no propaga, el worker ack igual (la escena queda 'planned', regenerable).
  export async function handleAdvanceChain(
    generation: GenerationRow,
    frame: { path?: string; url?: string },
  ): Promise<void> {
    try {
      if (generation.params?.chain && (frame.path || frame.url)) {
        await advanceSequenceChain(generation, { path: frame.path, url: frame.url });
      }
    } catch (err) {
      console.error('[worker] avance de cadena fallo', { generationId: generation.id, err });
    }
  }

  // Tras finalize de un clip encadenado: descargar el ultimo fotograma con la URL
  // FRESCA del proveedor, subirlo a references y encolar el avance con el PATH interno
  // (#10: la URL efimera de Atlas nunca viaja en el job). Best-effort: un fallo al
  // encolar no debe tirar el clip ya servido.
  export async function enqueueChainAdvance(
    generation: GenerationRow,
    lastFrameUrl: string,
  ): Promise<void> {
    try {
      const chain = generation.params.chain as { sequenceId: string; sceneIndex: number };
      const lastFramePath = await storeChainFrame(
        generation.workspace_id,
        chain.sequenceId,
        chain.sceneIndex,
        lastFrameUrl,
      );
      if (lastFramePath) {
        await enqueueJob({
          generationId: generation.id,
          action: 'advance_chain',
          lastFramePath,
          delaySeconds: 0,
        });
      }
    } catch (err) {
      console.error('[worker] no se pudo encolar el avance de cadena', { generationId: generation.id, err });
    }
  }
  ```
  Nota: en este task `route.ts` AUN conserva su copia inline (se borra en S9.5); `chain.ts` queda compilado pero todavia sin importadores. Es codigo nuevo no referenciado, valido para compilar/pasar la suite. No hay test unitario nuevo: ambas funciones hacen IO (DB/fetch/enqueue), su verificacion es typecheck+build+suite.

- [ ] **Step 2: Typecheck + build.**
  Corre: `pnpm typecheck && pnpm build`
  Expected: sin errores; `Compiled successfully`. (server-only + import de orchestrator/queue validados por el build.)

- [ ] **Step 3: Suite completa verde.**
  Corre: `pnpm test`
  Expected: toda la suite pasa (sin cambios de comportamiento todavia).

- [ ] **Step 4: Commit.**
  Corre: `git add lib/jobs/chain.ts && git commit -m "refactor(worker): extraer encadenado de secuencias a lib/jobs/chain"`
  Expected: commit creado.

---

### Task S9.4: Crear `lib/jobs/worker.ts` con `processJob` (maquina de estados)

**Files:**
- Create: `lib/jobs/worker.ts`

**Interfaces:**
- Consumes: `createAdminClient` desde `@/lib/supabase/admin`; `dispatchJob`, `dispatchCancel` desde `@/lib/jobs/dispatch`; `enqueueJob` desde `@/lib/jobs/queue`; `confirmCredits`, `failGeneration` desde `@/lib/credits/operations`; `handleAdvanceChain`, `enqueueChainAdvance` desde `./chain` (S9.3); `GenerationRow`, `JobAction` (type) desde `./handlers/types`.
  - **De Ola 1 — `lib/jobs/finalize.ts`:** `finalizeGeneration(params: { gen: FinalizeGenerationRow; outputBuffer: Buffer; mimeType: string; processingMs: number; metadata?: Record<string, unknown>; revalidatePaths?: string[] }): Promise<{ outputPath: string; thumbnailPath: string | null }>`. `FinalizeGenerationRow = Pick<GenerationRow,'id'|'user_id'|'workspace_id'|'type'|'credits_estimated'>`; pasar el `GenerationRow` completo es asignable al `Pick`. El valor de retorno se ignora (igual que hoy). Se pasa `revalidatePaths` EXPLICITO con las 3 rutas que el route revalidaba inline, para preservar comportamiento sin depender del default de finalize.
- Produces:
  ```ts
  export type WorkerAction = 'submit' | 'poll' | 'advance_chain';
  export type WorkerOutcome =
    | { kind: 'ack'; ack: string }
    | { kind: 'error'; error: string; status: number };
  export async function processJob(
    generation: GenerationRow,
    action: WorkerAction,
    frame: { path?: string; url?: string },
  ): Promise<WorkerOutcome>;
  ```

**Steps:**

- [ ] **Step 1: Crear `lib/jobs/worker.ts` trasladando la maquina de estados del route.**
  Mapeo exacto de bloques movidos desde `route.ts`: interceptacion `advance_chain` (84-93) -> delega en `handleAdvanceChain`; guard terminal (95-98); guard cancel/timeout (100-132); dispatch (134-135); rama continue (137-172, incluido el `WHERE status IN ('queued','processing')` con `count` y el ack `continue_lost_race`); rama fail (174-205, incluido el `campaign_items.warnings`); rama finalize (207-246) -> usa `enqueueChainAdvance`; catch finalize-fail (247-271, incluido `confirmCredits` idempotente y el UPDATE `WHERE status IN ('queued','processing')`). El unico cambio de forma: en vez de `NextResponse.json(...)` se devuelve `WorkerOutcome` plano. El `creditos via RPC atomico` (failGeneration/confirmCredits) y el `download->Storage->URL interna` (dentro de finalize) NO cambian.
  ```ts
  import 'server-only';
  import { createAdminClient } from '@/lib/supabase/admin';
  import { dispatchJob, dispatchCancel } from '@/lib/jobs/dispatch';
  import { enqueueJob } from '@/lib/jobs/queue';
  import { confirmCredits, failGeneration } from '@/lib/credits/operations';
  import { finalizeGeneration } from '@/lib/jobs/finalize';
  import { handleAdvanceChain, enqueueChainAdvance } from './chain';
  import type { GenerationRow, JobAction } from './handlers/types';

  const TERMINAL_STATUSES = new Set(['done', 'failed', 'canceled']);
  // Mismas rutas que el route revalidaba inline en finalize (route.ts:79-81).
  const REVALIDATE_PATHS = ['/app/library', '/app/create/video', '/app/create/audio'];

  export type WorkerAction = 'submit' | 'poll' | 'advance_chain';

  // Resultado plano de la maquina de estados, sin saber de HTTP. El route lo
  // traduce a NextResponse: 'ack' -> 200 { ok:true, ack }, 'error' -> status { ok:false, error }.
  export type WorkerOutcome =
    | { kind: 'ack'; ack: string }
    | { kind: 'error'; error: string; status: number };

  export async function processJob(
    generation: GenerationRow,
    action: WorkerAction,
    frame: { path?: string; url?: string },
  ): Promise<WorkerOutcome> {
    const generationId = generation.id;

    // 3.5. Avance de cadena: job dedicado. La gen ya esta 'done', se intercepta
    // ANTES del guard terminal (corre en su propia invocacion con presupuesto fresco).
    if (action === 'advance_chain') {
      await handleAdvanceChain(generation, frame);
      return { kind: 'ack', ack: 'chain_advanced' };
    }

    // 4. Guard: status terminal -> ack
    if (TERMINAL_STATUSES.has(generation.status)) {
      return { kind: 'ack', ack: 'terminal' };
    }

    const admin = createAdminClient();

    // 5. Guard: cancel_requested o timeout
    const timedOut =
      generation.timeout_at !== null && new Date(generation.timeout_at) < new Date();
    if (generation.cancel_requested || timedOut) {
      try {
        await dispatchCancel(generation);
      } catch (err) {
        console.error('[worker] cancel adapter fallo', { generationId, err });
      }
      const reason = generation.cancel_requested ? 'canceled by user' : 'timeout';
      try {
        await failGeneration(
          generation.user_id,
          generation.id,
          generation.credits_estimated,
          reason,
        );
        if (generation.cancel_requested) {
          await admin
            .from('generations')
            .update({ status: 'canceled' })
            .eq('id', generation.id)
            .eq('status', 'failed'); // solo flippa si fail_generation lo dejo asi
        }
      } catch (err) {
        console.error('[worker] fail_generation fallo', { generationId, err });
      }
      return { kind: 'ack', ack: reason };
    }

    // 6. Dispatch al handler del provider (action ya narrowed a 'submit' | 'poll')
    const dispatchAction: JobAction = action;
    const result = await dispatchJob(generation, dispatchAction);

    // 7. continue: re-encolar para el proximo poll
    if (result.kind === 'continue') {
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
      const { count } = await admin
        .from('generations')
        .update(update, { count: 'exact' })
        .eq('id', generation.id)
        .in('status', ['queued', 'processing']);
      if (count === 0) {
        return { kind: 'ack', ack: 'continue_lost_race' };
      }
      await enqueueJob({
        generationId: generation.id,
        action: 'poll',
        delaySeconds: result.delaySeconds,
      });
      return { kind: 'ack', ack: 'continue' };
    }

    // fail
    if (result.kind === 'fail') {
      try {
        await failGeneration(
          generation.user_id,
          generation.id,
          generation.credits_estimated,
          result.message,
        );
      } catch (err) {
        console.error('[worker] fail_generation fallo', { generationId, err });
      }
      try {
        const reason =
          result.code === 'safety'
            ? 'El proveedor rechazo esta escena por moderacion. Ajusta la descripcion y vuelve a generarla.'
            : result.code === 'timeout'
              ? 'La generacion tardo demasiado y se cancelo. Reintenta cuando quieras.'
              : result.code === 'rate_limit'
                ? 'El proveedor esta saturado ahora mismo. Reintenta en un momento.'
                : `No se pudo generar: ${result.message}`;
        await admin.from('campaign_items').update({ warnings: [reason] }).eq('generation_id', generation.id);
      } catch (err) {
        console.error('[worker] no se pudo anotar el motivo del fallo en el item', { generationId, err });
      }
      return { kind: 'ack', ack: 'failed' };
    }

    // result.kind === 'finalize' — handler entrego el buffer
    const startedAt = generation.provider_payload?._started_at as number | undefined;
    const processingMs = startedAt ? Date.now() - startedAt : 0;
    try {
      await finalizeGeneration({
        gen: generation,
        outputBuffer: result.outputBuffer,
        mimeType: result.mimeType,
        processingMs,
        metadata: result.metadata,
        revalidatePaths: REVALIDATE_PATHS,
      });
      if (generation.params?.chain && result.lastFrameUrl) {
        await enqueueChainAdvance(generation, result.lastFrameUrl);
      }
      return { kind: 'ack', ack: 'finalized' };
    } catch (err) {
      console.error('[worker] finalize fallo', { generationId, err });
      // No refundear: el provider ya cobro su cuota. Pero confirmar el cargo
      // (mueve la reserva de pending a spent). confirm_credits es idempotente.
      try {
        await confirmCredits(generation.user_id, generation.credits_estimated, generation.id);
      } catch (confErr) {
        console.error('[worker] confirm_credits en finalize-fail fallo', { generationId, confErr });
      }
      // WHERE status IN ('queued','processing'): un duplicado de QStash que ya
      // dejo 'done' NO se degrada a 'failed'.
      await admin
        .from('generations')
        .update({
          status: 'failed',
          error_message: `finalize failed: ${(err as Error)?.message ?? 'unknown'}`,
          completed_at: new Date().toISOString(),
        })
        .eq('id', generation.id)
        .in('status', ['queued', 'processing']);
      return { kind: 'error', error: 'finalize failed', status: 500 };
    }
  }
  ```
  Detalle de tipado: tras el `return` temprano de `action === 'advance_chain'`, el control-flow de TS estrecha `action` a `'submit' | 'poll'`, que es exactamente `JobAction`; por eso `const dispatchAction: JobAction = action;` compila sin cast. Este modulo es IO puro (admin/dispatch/enqueue/finalize) -> sin test unitario nuevo; verificacion = typecheck + build + suite. `route.ts` aun NO usa `processJob` en este task (lo cablea S9.5); `worker.ts` queda compilado sin importadores.

- [ ] **Step 2: Typecheck + build.**
  Corre: `pnpm typecheck && pnpm build`
  Expected: sin errores. En particular el build valida que `finalizeGeneration` acepta `revalidatePaths` (firma de Ola 1) y que el narrowing de `action` no rompe `dispatchJob`. `Compiled successfully`. (Recordatorio: typecheck/lint NO sustituyen al build para fronteras server-only/route.)

- [ ] **Step 3: Suite completa verde.**
  Corre: `pnpm test`
  Expected: toda la suite pasa.

- [ ] **Step 4: Commit.**
  Corre: `git add lib/jobs/worker.ts && git commit -m "refactor(worker): extraer processJob (maquina de estados) a lib/jobs/worker"`
  Expected: commit creado.

---

### Task S9.5: Adelgazar `route.ts` a solo transporte y borrar el codigo viejo

**Files:**
- Modify: `app/api/jobs/process/route.ts` (273 -> ~50 lineas; se elimina todo el bloque 79-272 y se reescribe el cuerpo del `POST`)

**Interfaces:**
- Consumes: `verifyQStashSignature` desde `@/lib/jobs/receiver`; `createAdminClient` desde `@/lib/supabase/admin`; `processJob` (y types `WorkerAction`/`WorkerOutcome` implicitos) desde `@/lib/jobs/worker` (S9.4); `GenerationRow` (type) desde `@/lib/jobs/handlers/types`; `'@/lib/jobs/handlers/register'` (side-effect import, se mantiene).
- Produces: la ruta `POST` sigue devolviendo los mismos cuerpos/status que hoy (mapeo `WorkerOutcome -> NextResponse`), mas los responses de transporte (401 firma, 400 body, 200 `ack:'not_found'`).

**Steps:**

- [ ] **Step 1: Reescribir `app/api/jobs/process/route.ts` completo.**
  Quedan: verificacion de firma (idem 30-51), parse del body (idem 53-60), carga de la gen con service_role (idem 63-77, ahora con el `select` en una const), y la traduccion `WorkerOutcome -> NextResponse`. Se BORRAN: el `import` de `dispatchJob/dispatchCancel/enqueueJob/confirmCredits/failGeneration/finalizeGeneration/advanceSequenceChain/storeChainFrame` (ya viven en worker.ts/chain.ts) y el `TERMINAL_STATUSES`. Se mantienen `runtime/maxDuration/dynamic` y el `import '@/lib/jobs/handlers/register'`.
  ```ts
  import { NextResponse } from 'next/server';
  import { z } from 'zod';
  import { verifyQStashSignature } from '@/lib/jobs/receiver';
  import { createAdminClient } from '@/lib/supabase/admin';
  import { processJob } from '@/lib/jobs/worker';
  import type { GenerationRow } from '@/lib/jobs/handlers/types';
  import '@/lib/jobs/handlers/register'; // side-effect: registra handlers

  export const runtime = 'nodejs';
  export const maxDuration = 60;
  export const dynamic = 'force-dynamic';

  const BodySchema = z.object({
    generationId: z.string().uuid(),
    action: z.enum(['submit', 'poll', 'advance_chain']),
    // Solo para 'advance_chain': PATH interno (references) del fotograma a heredar.
    lastFramePath: z.string().optional(),
    // Compat: la URL cruda solo en jobs encolados antes del deploy.
    lastFrameUrl: z.string().url().optional(),
  });

  const GENERATION_SELECT =
    'id, user_id, workspace_id, type, provider, model_id, prompt, params, reference_ids, status, provider_task_id, provider_payload, poll_attempts, timeout_at, cancel_requested, credits_estimated';

  export async function POST(req: Request) {
    // 1. Verificar firma ANTES de leer el body como JSON
    const rawBody = await req.text();
    const signature = req.headers.get('upstash-signature');
    if (!signature) {
      return NextResponse.json({ error: 'missing signature' }, { status: 401 });
    }
    try {
      // QStash firma contra la URL publica de publishJSON. req.url detras de proxy
      // resuelve a localhost/internal; usamos NEXT_PUBLIC_APP_URL para matchear.
      const verifyUrl = process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/api/jobs/process`
        : req.url;
      await verifyQStashSignature({ signature, body: rawBody, url: verifyUrl });
    } catch (err) {
      console.error('[worker] firma invalida', err);
      return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
    }

    // 2. Parsear body
    let parsed;
    try {
      parsed = BodySchema.parse(JSON.parse(rawBody));
    } catch (err) {
      console.error('[worker] body invalido', err);
      return NextResponse.json({ error: 'invalid body' }, { status: 400 });
    }

    // 3. Cargar generation con service_role
    const admin = createAdminClient();
    const { data: gen, error: loadErr } = await admin
      .from('generations')
      .select(GENERATION_SELECT)
      .eq('id', parsed.generationId)
      .single();
    if (loadErr || !gen) {
      // Row borrada (cleanup, etc.) -> ack y exit. No error para QStash.
      console.warn('[worker] gen no encontrada', { generationId: parsed.generationId });
      return NextResponse.json({ ok: true, ack: 'not_found' });
    }

    // 4. Orquestacion: la maquina de estados vive en lib/jobs/worker.
    const outcome = await processJob(gen as unknown as GenerationRow, parsed.action, {
      path: parsed.lastFramePath,
      url: parsed.lastFrameUrl,
    });

    if (outcome.kind === 'error') {
      return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });
    }
    return NextResponse.json({ ok: true, ack: outcome.ack });
  }
  ```
  Verifica que el archivo quedo en ~85 lineas o menos (antes 273) y que no quedan referencias a `dispatchJob`/`finalizeGeneration`/`advanceSequenceChain` en el archivo.
  Corre: `pnpm exec eslint app/api/jobs/process/route.ts`
  Expected: sin errores ni imports sin usar.

- [ ] **Step 2: Typecheck + build (CRITICO para una ruta Next + frontera server-only).**
  Corre: `pnpm typecheck && pnpm build`
  Expected: sin errores; `Compiled successfully`; la ruta `/api/jobs/process` aparece en el output de rutas. (Recordatorio del gotcha de proyecto: typecheck/lint NO detectan roturas de frontera de servidor; SOLO el build las ve. Aunque este archivo no es `'use server'`, es route handler y arrastra server-only, asi que el build es el unico veredicto valido.)

- [ ] **Step 3: Suite completa verde.**
  Corre: `pnpm test`
  Expected: toda la suite pasa, sin cambios respecto al baseline (refactor de comportamiento identico).

- [ ] **Step 4: Commit.**
  Corre: `git add app/api/jobs/process/route.ts && git commit -m "refactor(worker): route.ts solo transporte, orquestacion en processJob"`
  Expected: commit creado.

- [ ] **Step 5: Smoke manual (lo corre el USUARIO; el subagent NO llama APIs reales).**
  Como esta unidad es backend (sin UI), la verificacion end-to-end exige proveedores reales + QStash, fuera del alcance de la suite. Nota de smoke para el usuario, con dev server + tunel (`NEXT_PUBLIC_APP_URL` -> ngrok) ya configurado:
  1. **TTS asincrono (camino base submit->poll->finalize):** abrir `/app/create/audio`, generar una voz corta; confirmar en `/app/library` que pasa de `processing` a `done` con audio reproducible. Esto ejercita `processJob` ramas continue + finalize y el revalidate de `/app/library`.
  2. **Fallo de proveedor (rama fail + warning de campaña):** lanzar una escena de campaña con un prompt que el proveedor rechace por moderacion; confirmar que el item queda `failed` con el `warning` "El proveedor rechazo esta escena por moderacion...". Ejercita la rama fail + `campaign_items.warnings`.
  3. **Encadenado (advance_chain + enqueueChainAdvance):** generar una secuencia encadenada de >=2 escenas en una campaña; confirmar que al terminar la escena 1 se encola y completa la escena 2 (la 2 pasa de `planned`/`sample` a `done`). Ejercita `enqueueChainAdvance` (finalize) + `handleAdvanceChain` (job `advance_chain`).
  Expected: los 3 flujos terminan en `done` (o `failed` con warning en el caso 2) igual que antes del refactor; los logs muestran los mismos `ack` (`finalized`, `failed`, `chain_advanced`).

---

**Resumen de invariantes preservados (checklist final tras S9.5).**
- Polling re-encolado SIN webhooks: intacto (rama continue -> `enqueueJob action:'poll'`).
- URLs de proveedor nunca al cliente: intacto (finalize descarga -> Storage; `enqueueChainAdvance` sube el fotograma a references antes de encolar el PATH).
- Creditos via RPC atomico: intacto (`failGeneration`, `confirmCredits`, y `completeGeneration` dentro de finalize). Ningun UPDATE directo a `credit_balances`/`credit_transactions`.
- `MAX_POLLS` y `timeout_at`: intactos (viven en los handlers y en el guard cancel/timeout, no se tocaron).
- Service role solo server-side: `createAdminClient` solo en `route.ts` (load) y `worker.ts` (server-only).
- FLAGs (rama continue sin proteccion contra entregas duplicadas concurrentes; cleanup con verify de firma opcional) quedan como follow-up documentado, NO incluidos en este split.
