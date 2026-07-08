# Migración Gemini/Nano Banana a Vercel AI Gateway — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todas las llamadas a Gemini texto (11 módulos) y Nano Banana pasan por Vercel AI Gateway (AI SDK v6, `AI_GATEWAY_API_KEY`); Veo queda nativo.

**Architecture:** Un helper compartido `lib/providers/gateway.ts` (`gatewayText()` sobre `generateText`) reemplaza el fetch nativo de los 11 módulos de texto conservando prompts, schemas zod, fallbacks y caps intactos. Nano Banana migra su transporte a `generateText` con model string `google/...` conservando su lógica pura (chat multi-turn, fallback single-turn, clasificación de errores). Los slugs internos en DB/schemas/UI no cambian; el mapeo a slug de gateway vive solo en la capa de transporte.

**Tech Stack:** Next.js 16, TypeScript estricto (sin `any`), `ai@^6` (nueva), zod 4, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-08-migracion-ai-gateway-design.md`

## Global Constraints

- Rama de trabajo: `feat/ai-gateway-providers` (ya existe, basada en `feat/ingesta-prompt-maestro`).
- pnpm siempre (`pnpm add`, `pnpm test`, `pnpm build`). Nunca npm.
- Tests SIN llamadas de red reales (regla del repo). El transporte se mockea con `vi.mock('@/lib/providers/gateway', ...)` en los módulos y `vi.mock('ai', ...)` en el helper.
- Prohibido `any`; usar `unknown` + narrowing.
- Los prompts/system, schemas zod de negocio, fallbacks y caps (`maxOutputTokens`, `temperature`) de cada módulo NO se tocan — copiar los valores exactos que aparecen en cada task.
- `thinkingConfig: { thinkingBudget: 0 }` se conserva en TODAS las llamadas de texto (los thinking tokens consumen `maxOutputTokens`; sin esto los caps chicos devuelven vacío).
- Commits: Conventional Commits en español, imperativo, ≤70 chars, SIN `Co-Authored-By` (regla `.cursor/rules/90-commits.mdc`).
- Verificación final con `pnpm build` (no solo typecheck: gotcha de `'use server'` que solo revienta en build).
- Los smoke tests con API real los corre el usuario, nunca el implementador.
- `GEMINI_API_KEY` NO se elimina: queda para Veo (`lib/providers/veo.ts`), que no se toca.

---

### Task 1: Dependencia `ai`, env y helper `gatewayText()`

**Files:**
- Modify: `package.json` (vía `pnpm add ai`)
- Modify: `.env.example`
- Create: `lib/providers/gateway.ts`
- Test: `lib/providers/gateway.test.ts`

**Interfaces:**
- Consumes: `ProviderError` de `lib/providers/types.ts` (constructor `(message: string, code: 'auth'|'rate_limit'|'safety'|'server'|'invalid_input'|'unknown', retryable: boolean)` — verificar el orden exacto en el archivo antes de usar).
- Produces (lo que TODOS los tasks 2-5 consumen):
  - `gatewayText(input: GatewayTextInput): Promise<GatewayTextResult>`
  - `type GatewayPart = { text: string } | { inline_data: { mime_type: string; data: string } }` (mismo shape nativo que ya usan los módulos — diff mínimo)
  - `type GatewayContent = { role?: 'user' | 'model'; parts: GatewayPart[] }`
  - `type GatewayTextInput = { model: string; label: string; system?: string; contents: GatewayContent[]; temperature: number; maxOutputTokens: number; json: boolean; thinkingBudget?: number }`
  - `type GatewayTextResult = { text: string; finishReason: string }` — `finishReason` normalizado del AI SDK: `'stop' | 'length' | 'content-filter' | 'error' | 'other' | 'unknown'`
  - `toGatewayModel(slug: string): string` (agrega prefijo `google/`)

- [ ] **Step 1: Instalar la dependencia y actualizar .env.example**

```bash
pnpm add ai
```

En `.env.example`, reemplazar el bloque de proveedores IA:

```bash
# Proveedores IA
# AI Gateway (Vercel): Gemini texto + Nano Banana. Crear la key en
# https://vercel.com/<team>/<project>/settings → AI Gateway → API Keys.
AI_GATEWAY_API_KEY=
# GEMINI_API_KEY queda SOLO para Veo (video): el gateway no ofrece video
# async re-encolable por QStash (ver spec 2026-07-08-migracion-ai-gateway).
GEMINI_API_KEY=
```

(El resto del bloque — KLING, BFL, ELEVENLABS, etc. — no se toca.)

- [ ] **Step 2: Escribir los tests del helper (fallando)**

Crear `lib/providers/gateway.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from './types';

const generateTextMock = vi.fn();
vi.mock('ai', () => {
  class APICallError extends Error {
    statusCode: number | undefined;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
    static isInstance(err: unknown): err is APICallError {
      return err instanceof APICallError;
    }
  }
  return { generateText: generateTextMock, APICallError };
});

// Import dinámico DESPUÉS del mock para que el módulo vea el 'ai' mockeado.
const { gatewayText, toGatewayModel, stripFences } = await import('./gateway');
const { APICallError } = await import('ai');

function ok(text: string, finishReason = 'stop') {
  return { text, finishReason };
}

describe('toGatewayModel', () => {
  it('prefija el slug interno con google/', () => {
    expect(toGatewayModel('gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
  });
});

describe('stripFences', () => {
  it('quita fences ```json', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('deja el texto sin fences intacto', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('gatewayText', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
  });

  it('lanza auth si falta AI_GATEWAY_API_KEY', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'auth', retryable: false });
  });

  it('traduce contents nativos a messages del AI SDK y pasa thinkingBudget 0', async () => {
    generateTextMock.mockResolvedValue(ok('respuesta'));
    await gatewayText({
      model: 'gemini-2.5-flash', label: 'test', json: false, system: 'SYS',
      contents: [{
        role: 'user',
        parts: [{ text: 'hola' }, { inline_data: { mime_type: 'image/png', data: 'AAAA' } }],
      }],
      temperature: 0.4, maxOutputTokens: 1200,
    });
    const args = generateTextMock.mock.calls[0][0];
    expect(args.model).toBe('google/gemini-2.5-flash');
    expect(args.system).toBe('SYS');
    expect(args.temperature).toBe(0.4);
    expect(args.maxOutputTokens).toBe(1200);
    expect(args.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'hola' },
        { type: 'file', mediaType: 'image/png', data: 'AAAA' },
      ],
    }]);
    expect(args.providerOptions.google).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    expect(args.providerOptions.vertex).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
  });

  it('mapea role model a assistant', async () => {
    generateTextMock.mockResolvedValue(ok('x'));
    await gatewayText({
      model: 'gemini-2.5-flash', label: 'test', json: true,
      contents: [
        { role: 'user', parts: [{ text: 'pregunta' }] },
        { role: 'model', parts: [{ text: 'respuesta previa' }] },
        { role: 'user', parts: [{ text: 'siguiente' }] },
      ],
      temperature: 0.4, maxOutputTokens: 1200,
    });
    const roles = generateTextMock.mock.calls[0][0].messages.map(
      (m: { role: string }) => m.role,
    );
    expect(roles).toEqual(['user', 'assistant', 'user']);
  });

  it('con json:true limpia fences del texto', async () => {
    generateTextMock.mockResolvedValue(ok('```json\n{"a":1}\n```'));
    const result = await gatewayText({
      model: 'gemini-2.5-flash', label: 'test', json: true,
      contents: [{ role: 'user', parts: [{ text: 'x' }] }],
      temperature: 0.2, maxOutputTokens: 100,
    });
    expect(result.text).toBe('{"a":1}');
    expect(result.finishReason).toBe('stop');
  });

  it('429 -> ProviderError rate_limit retryable (sin reintento interno)', async () => {
    generateTextMock.mockRejectedValue(new APICallError('too many', 429));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'rate_limit', retryable: true });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('401/403 -> auth no retryable', async () => {
    generateTextMock.mockRejectedValue(new APICallError('forbidden', 403));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'auth', retryable: false });
  });

  it('5xx -> server retryable con el label en el mensaje', async () => {
    generateTextMock.mockRejectedValue(new APICallError('boom', 503));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'matcher', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'server', retryable: true, message: expect.stringContaining('matcher') });
  });

  it('error no-API -> unknown no retryable', async () => {
    generateTextMock.mockRejectedValue(new Error('red caída'));
    await expect(
      gatewayText({
        model: 'gemini-2.5-flash', label: 'test', json: true,
        contents: [{ role: 'user', parts: [{ text: 'x' }] }],
        temperature: 0.2, maxOutputTokens: 100,
      }),
    ).rejects.toMatchObject({ code: 'unknown', retryable: false });
  });
});
```

Nota: si el `vi.mock` con top-level `await import` da problemas de hoisting en este setup de vitest, usar el patrón `vi.hoisted()` para `generateTextMock`.

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `pnpm test lib/providers/gateway.test.ts`
Expected: FAIL — `Cannot find module './gateway'` (o equivalente).

- [ ] **Step 4: Implementar `lib/providers/gateway.ts`**

```ts
import 'server-only';
import { APICallError, generateText, type ModelMessage } from 'ai';
import { ProviderError } from './types';

// Partes en el shape nativo de Gemini que los módulos ya construyen. Mantener
// este shape hace que la migración de cada módulo sea solo cambiar el fetch.
export type GatewayPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type GatewayContent = {
  role?: 'user' | 'model';
  parts: GatewayPart[];
};

export type GatewayTextInput = {
  /** Slug interno del modelo (ej. 'gemini-2.5-flash'); NO el slug de gateway. */
  model: string;
  /** Etiqueta del módulo para mensajes de error (ej. 'ingest', 'matcher'). */
  label: string;
  system?: string;
  contents: GatewayContent[];
  temperature: number;
  maxOutputTokens: number;
  /** true = salida JSON: se limpian fences markdown si el modelo los agrega. */
  json: boolean;
  thinkingBudget?: number;
};

export type GatewayTextResult = {
  text: string;
  /** finishReason normalizado del AI SDK ('stop'|'length'|'content-filter'|...). */
  finishReason: string;
};

export function toGatewayModel(slug: string): string {
  return `google/${slug}`;
}

// El gateway no garantiza responseMimeType:'application/json' como la API
// nativa; el fence-strip central protege a los módulos que hacen JSON.parse
// directo. Idempotente con el extractJson local de ingest/matcher/clarify.
export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function toMessages(contents: GatewayContent[]): ModelMessage[] {
  return contents.map((c) => ({
    role: c.role === 'model' ? ('assistant' as const) : ('user' as const),
    content: c.parts.map((p) =>
      'text' in p
        ? { type: 'text' as const, text: p.text }
        : {
            type: 'file' as const,
            mediaType: p.inline_data.mime_type,
            data: p.inline_data.data,
          },
    ),
  })) as ModelMessage[];
}

function translateError(err: unknown, label: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ?? 0;
    if (status === 429) return new ProviderError('Rate limit Gemini', 'rate_limit', true);
    if (status === 401 || status === 403) {
      return new ProviderError('Auth inválida con AI Gateway', 'auth', false);
    }
    return new ProviderError(
      `Gemini ${label} ${status}: ${err.message.slice(0, 200)}`,
      'server',
      status >= 500,
    );
  }
  return new ProviderError(
    `Gemini ${label}: ${err instanceof Error ? err.message : 'error desconocido'}`,
    'unknown',
    false,
  );
}

export async function gatewayText(input: GatewayTextInput): Promise<GatewayTextResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const thinkingBudget = input.thinkingBudget ?? 0;
  try {
    const result = await generateText({
      model: toGatewayModel(input.model),
      ...(input.system ? { system: input.system } : {}),
      messages: toMessages(input.contents),
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      // thinkingConfig viaja por passthrough del gateway. Se manda bajo ambos
      // namespaces (google = AI Studio, vertex = Vertex) porque el routing del
      // gateway decide el provider; cada uno lee solo su clave.
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget } },
        vertex: { thinkingConfig: { thinkingBudget } },
      },
    });
    const text = input.json ? stripFences(result.text) : result.text;
    return { text, finishReason: result.finishReason };
  } catch (err) {
    throw translateError(err, input.label);
  }
}
```

Verificar contra `lib/providers/types.ts` que el constructor de `ProviderError` y los codes (`'rate_limit'`, `'auth'`, `'server'`, `'safety'`, `'unknown'`) coinciden con lo que usan los módulos actuales (son los mismos strings que hoy lanzan los 11 módulos).

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `pnpm test lib/providers/gateway.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example lib/providers/gateway.ts lib/providers/gateway.test.ts
git commit -m "feat(providers): agrega transporte gatewayText via Vercel AI Gateway"
```

---

### Task 2: Migrar los módulos solo-texto: ingest, refine, clarify

**Files:**
- Modify: `lib/campaigns/ingest.ts` (función `ingestMasterPrompt`, líneas ~152-192)
- Modify: `lib/refine/gemini.ts` (función `requestRefineTurn`, líneas ~21-65)
- Modify: `lib/creation/clarify.ts` (función `requestClarify`, líneas ~47-95)
- Test: `lib/refine/gemini.test.ts`, `lib/creation/clarify.test.ts` (migrar mocks de fetch a mock del gateway; `lib/campaigns/ingest.test.ts` no toca red — no cambia)

**Interfaces:**
- Consumes: `gatewayText`, tipos de Task 1.
- Produces: las firmas públicas NO cambian: `ingestMasterPrompt(input): Promise<IngestResult>`, `requestRefineTurn(input): Promise<TurnReply>`, `clarifyCharacter(input): Promise<ClarifyResult>`.

En los tres archivos, eliminar: `const ENDPOINT = ...`, el `GeminiResponseSchema` local (solo el envelope de candidates — NO los schemas de negocio), y el check de `GEMINI_API_KEY`.

- [ ] **Step 1: Migrar los mocks de los tests (fallando)**

En `lib/refine/gemini.test.ts` y `lib/creation/clarify.test.ts`: quitar `vi.stubGlobal('fetch', ...)` y el helper `geminiOk`, y mockear el gateway. Patrón (aplicar en ambos):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/types';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({
  gatewayText: gatewayTextMock,
}));
```

Donde el test respondía `geminiOk(payload)`, ahora: `gatewayTextMock.mockResolvedValue({ text: JSON.stringify(payload), finishReason: 'stop' })` (el payload es el JSON de NEGOCIO directo, ya sin envelope de candidates).

Casos de transporte que se conservan con la misma intención:
- `'marca rate limit como reintentable'` (refine): `gatewayTextMock.mockRejectedValue(new ProviderError('Rate limit Gemini', 'rate_limit', true))` → expect `{ code: 'rate_limit', retryable: true }`.
- `'clasifica 403 como error de auth'` (refine): reject con `new ProviderError('Auth inválida con AI Gateway', 'auth', false)` → expect `{ code: 'auth' }`.
- `'reintenta una vez ante un 429 y luego propaga'` (clarify): dos rejects consecutivos con ProviderError rate_limit → `expect(gatewayTextMock).toHaveBeenCalledTimes(2)`.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `pnpm test lib/refine lib/creation/clarify.test.ts`
Expected: FAIL — los módulos siguen llamando `fetch` (que ya no está stubbeado) o los mocks del gateway no se invocan.

- [ ] **Step 3: Migrar `lib/campaigns/ingest.ts`**

Reemplazar el cuerpo de red de `ingestMasterPrompt` (desde `const res = await fetch(...)` hasta `const raw = ...`) por:

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'ingest',
    system,
    contents: [
      { role: 'user', parts: [{ text: input.masterPrompt.slice(0, MASTER_PROMPT_MAX) }] },
    ],
    temperature: 0.2,
    // El narrative devuelve el guion casi íntegro: con prompts cerca del cap
    // (60k chars ≈ 17k tokens) 8192 truncaba el JSON y todo caía al fallback.
    maxOutputTokens: 32768,
    json: true,
  });
  return parseIngestResult(raw, { castNames: input.castNames, masterPrompt: input.masterPrompt });
```

Import: `import { gatewayText } from '@/lib/providers/gateway';`. Conservar `const MODEL = 'gemini-2.5-flash';`. Eliminar `GeminiResponseSchema` y el import de zod si queda sin uso.

- [ ] **Step 4: Migrar `lib/refine/gemini.ts`**

Reemplazar el cuerpo de red de `requestRefineTurn` por:

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'refine',
    system: input.system,
    contents: input.history.map((t) => ({
      role: t.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: t.text }],
    })),
    temperature: 0.4,
    maxOutputTokens: 1200,
    json: true,
  });
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en refine', 'unknown', false);
  }
  const parsed = TurnReplySchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`Turno no cumple el contrato: ${parsed.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return parsed.data;
```

- [ ] **Step 5: Migrar `lib/creation/clarify.ts`**

Reemplazar el cuerpo de red de `requestClarify` (el wrapper `clarifyCharacter` con su retry NO se toca) por:

```ts
  const userText = `Personaje pedido: ${input.text.slice(0, 2000)}${
    input.hasReference ? '\n(El usuario adjuntó una imagen de referencia de estilo/apariencia.)' : ''
  }`;

  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'clarify',
    system: SYSTEM,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    temperature: 0.3,
    // 1200: el enrichedPrompt conserva íntegro el texto del usuario (hasta
    // 2000 chars) más las preguntas; 600 lo truncaba y rompía el JSON.
    maxOutputTokens: 1200,
    json: true,
  });
  let json: unknown;
  try { json = JSON.parse(extractJson(raw)); } catch {
    throw new ProviderError(`Gemini devolvió JSON inválido en clarify: ${raw.slice(0, 180)}`, 'unknown', true);
  }
  const parsed = ClarifyResultSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError('Clarify no cumple el schema', 'unknown', true);

  // Red de seguridad: el Prompt Director es age-blind; limpia cualquier marcador
  // que se haya colado en el enrichedPrompt.
  const { text } = stripAgeWords(parsed.data.enrichedPrompt);
  const clean = text.trim();
  if (!clean) throw new ProviderError('enrichedPrompt vacío tras limpiar edad', 'unknown', true);
  return { questions: parsed.data.questions, enrichedPrompt: clean };
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `pnpm test lib/refine lib/creation lib/campaigns/ingest.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/ingest.ts lib/refine/gemini.ts lib/refine/gemini.test.ts lib/creation/clarify.ts lib/creation/clarify.test.ts
git commit -m "refactor(providers): ingest, refine y clarify pasan por AI Gateway"
```

---

### Task 3: Migrar format-matcher

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (función `requestMatch`, líneas ~519-647; el wrapper `matchIdeas` con retry NO se toca)
- Test: `lib/prompt-director/format-matcher.test.ts` (migrar mocks; revisar también `format-matcher-caps.test.ts` por si stubbea fetch)

**Interfaces:**
- Consumes: `gatewayText` de Task 1.
- Produces: firma pública sin cambios: `matchIdeas(input): Promise<MatcherResult>`.

- [ ] **Step 1: Migrar los mocks del test (fallando)**

Mismo patrón de Task 2 Step 1 (`vi.mock('@/lib/providers/gateway')`). Casos a portar con la misma intención:
- `'reintenta una vez ante rate limit y falla si persiste'` y `'se recupera si el reintento tras 429 responde bien'`: rejects/resolves consecutivos del mock; asserts sobre `toHaveBeenCalledTimes`.
- `'no reintenta errores no recuperables (auth)'`: reject con ProviderError auth no-retryable → 1 sola llamada.
- `'rechaza la respuesta si ningún match es válido (con reintento)'`: `mockResolvedValue({ text: JSON.stringify({ matches: [<inválidos>] }), finishReason: 'stop' })` → 2 llamadas y throw.
- `'las imágenes adjuntas viajan como inline_data con su rol declarado en el texto'`: ahora se asserta sobre el argumento del mock: `gatewayTextMock.mock.calls[0][0].contents[0].parts` debe contener `{ inline_data: { mime_type: 'image/png', data: 'AAAA' } }` (el shape nativo se conserva en `GatewayPart` — las aserciones existentes portan casi tal cual).
- `'pasa los labels de estado del personaje en el pool del prompt'`: assert sobre `contents[0].parts[0].text` o `system` según dónde viaje hoy.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test lib/prompt-director/format-matcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrar `requestMatch`**

La construcción de `parts` (texto + `...images.map(img => ({ inline_data: ... }))`) se conserva EXACTA. Reemplazar solo el bloque fetch + status-checks + envelope zod por:

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'matcher',
    system,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    // Timelines con diálogo por idea abultan el JSON. Con guiones cerca del
    // cap (MASTER_PROMPT_MAX) un anuncio de 7+ escenas auto-contenidas más
    // el eco de ideaText superaba 8192 y el JSON llegaba truncado SIEMPRE
    // (el retry no ayuda: el tamaño requerido no baja) → plan al mix.
    maxOutputTokens: 32768,
    json: true,
  });
```

`parts` debe tiparse como `GatewayPart[]` (hoy es `Array<{ text: string } | { inline_data: ... }>` — mismo shape). TODO lo demás (desde `let json: unknown; try { json = JSON.parse(extractJson(raw)) }...` hasta el saneo de `formatId`/`characterIds`) se conserva sin cambios, incluidos los `ProviderError(..., 'unknown', true)` retryable de generación.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test lib/prompt-director`
Expected: PASS (incluye `format-matcher-caps.test.ts` y `prompt-director.test.ts` sin regresiones).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "refactor(matcher): el matcher pasa por AI Gateway"
```

---

### Task 4: Migrar los módulos de imagen única: brief, analyze-kit, describe-character, light-profile

**Files:**
- Modify: `lib/campaigns/brief.ts` (función `analyzeProductBrief`; `fetchProductPageText` NO se toca — es fetch a la página del producto, no a Gemini)
- Modify: `lib/creation/analyze-kit.ts` (función `analyzeKitImage`)
- Modify: `lib/cast/describe-character.ts` (función `describeCharacterImage`)
- Modify: `lib/locations/light-profile.ts` (función `deriveLightProfileFromImage`)
- Test: `lib/creation/analyze-kit.test.ts` (migrar mock); Create: `lib/cast/describe-character.test.ts`, `lib/locations/light-profile.test.ts` (no existen; `brief.test.ts` no toca red — no cambia)

**Interfaces:**
- Consumes: `gatewayText` de Task 1.
- Produces: firmas públicas sin cambios (`Promise<ProductBrief>`, `Promise<KitFields>`, `Promise<string>` ×2).

- [ ] **Step 1: Tests (fallando)**

`analyze-kit.test.ts`: migrar el mock igual que Task 2 Step 1 (payload de negocio directo en `text`).

Crear `lib/cast/describe-character.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/types';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({ gatewayText: gatewayTextMock }));

const { describeCharacterImage } = await import('./describe-character');

describe('describeCharacterImage', () => {
  beforeEach(() => gatewayTextMock.mockReset());

  it('manda la imagen como inline_data y devuelve la descripción limpia', async () => {
    gatewayTextMock.mockResolvedValue({
      text: JSON.stringify({ description: 'retrato de estudio, luz suave' }),
      finishReason: 'stop',
    });
    const result = await describeCharacterImage({
      imageBuffer: Buffer.from('img'), mimeType: 'image/png',
    });
    expect(result).toBe('retrato de estudio, luz suave');
    const { contents } = gatewayTextMock.mock.calls[0][0];
    expect(contents[0].parts[0]).toEqual({
      inline_data: { mime_type: 'image/png', data: Buffer.from('img').toString('base64') },
    });
  });

  it('propaga ProviderError del transporte', async () => {
    gatewayTextMock.mockRejectedValue(new ProviderError('Rate limit Gemini', 'rate_limit', true));
    await expect(
      describeCharacterImage({ imageBuffer: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'rate_limit' });
  });
});
```

Crear `lib/locations/light-profile.test.ts` con la misma estructura (mock del gateway, payload `{ profile: '...' }`, assert del `inline_data` y del `.trim()` del profile devuelto).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test lib/cast lib/locations lib/creation/analyze-kit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrar los cuatro módulos**

Patrón idéntico en los cuatro — se conserva la construcción de `parts` (tipada `GatewayPart[]`) y todo el post-proceso; solo se reemplaza fetch + status-checks + envelope. Los cuatro reemplazos:

`brief.ts` (conserva el armado de `parts` con `extraContext`):

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'brief',
    system: BRIEF_SYSTEM,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    maxOutputTokens: 1000,
    json: true,
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en brief', 'unknown', false);
  }
  const brief = ProductBriefSchema.safeParse(json);
  if (!brief.success) {
    throw new ProviderError(`Brief no cumple el schema: ${brief.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return brief.data;
```

`analyze-kit.ts`:

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'kit',
    system: SYSTEM,
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: input.mimeType, data: input.imageBuffer.toString('base64') } },
        { text: 'Analiza el producto y devuelve el JSON.' },
      ],
    }],
    temperature: 0.2,
    maxOutputTokens: 500,
    json: true,
  });
  let json: unknown;
  try { json = JSON.parse(extractJson(raw)); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en analyze-kit', 'unknown', false);
  }
  const parsed = KitFieldsSchema.safeParse(json);
  if (!parsed.success) throw new ProviderError('analyze-kit no cumple el schema', 'unknown', false);
  return parsed.data;
```

`describe-character.ts` (conserva `stripAgeWords`):

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'cast',
    system: SYSTEM,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    maxOutputTokens: 400,
    json: true,
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido al describir personaje', 'unknown', false);
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) {
    throw new ProviderError('La descripción no cumple el schema', 'unknown', false);
  }

  // Red de seguridad: aunque el prompt prohíbe la edad, el Prompt Director es
  // age-blind y aquí se limpia cualquier marcador que se haya colado.
  const { text } = stripAgeWords(reply.data.description);
  const clean = text.trim();
  if (!clean) {
    throw new ProviderError('La descripción quedó vacía tras limpiar marcadores de edad', 'unknown', false);
  }
  return clean;
```

`light-profile.ts`:

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'locación',
    system: SYSTEM,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    maxOutputTokens: 400,
    json: true,
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido al perfilar la locación', 'unknown', false);
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) {
    throw new ProviderError('El perfil de luz no cumple el schema', 'unknown', false);
  }
  return reply.data.profile.trim();
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test lib/cast lib/locations lib/creation lib/campaigns`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/brief.ts lib/creation/analyze-kit.ts lib/creation/analyze-kit.test.ts lib/cast/describe-character.ts lib/cast/describe-character.test.ts lib/locations/light-profile.ts lib/locations/light-profile.test.ts
git commit -m "refactor(providers): brief, kit, cast y locación pasan por AI Gateway"
```

---

### Task 5: Migrar reference-analysis, storyboard-expand-check y prompt-enhancer

**Files:**
- Modify: `lib/campaigns/reference-analysis.ts` (función `analyzeProductImages`)
- Modify: `lib/campaigns/storyboard-expand-check.ts` (función `stripsHaveText`)
- Modify: `lib/providers/prompt-enhancer.ts` (función `enhancePrompt`)
- Test: Create `lib/providers/prompt-enhancer.test.ts` (no existe); `reference-analysis.test.ts` y `storyboard-expand-check.test.ts` no tocan red — no cambian

**Interfaces:**
- Consumes: `gatewayText` de Task 1.
- Produces: firmas públicas sin cambios. OJO: `storyboard-expand-check` es fail-open (nunca lanza; cualquier error → `false`) y `prompt-enhancer` es el único `json: false` con ramas por `finishReason`.

- [ ] **Step 1: Test de prompt-enhancer (fallando)**

Crear `lib/providers/prompt-enhancer.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayTextMock = vi.fn();
vi.mock('@/lib/providers/gateway', () => ({ gatewayText: gatewayTextMock }));

const { enhancePrompt } = await import('./prompt-enhancer');

describe('enhancePrompt', () => {
  beforeEach(() => gatewayTextMock.mockReset());

  it('devuelve el texto mejorado sin comillas accidentales', async () => {
    gatewayTextMock.mockResolvedValue({ text: '"un atardecer cálido"', finishReason: 'stop' });
    expect(await enhancePrompt({ prompt: 'atardecer' })).toBe('un atardecer cálido');
    expect(gatewayTextMock.mock.calls[0][0].json).toBe(false);
    expect(gatewayTextMock.mock.calls[0][0].temperature).toBe(0.7);
  });

  it('salida vacía con finishReason length -> server retryable', async () => {
    gatewayTextMock.mockResolvedValue({ text: '', finishReason: 'length' });
    await expect(enhancePrompt({ prompt: 'x' })).rejects.toMatchObject({
      code: 'server', retryable: true,
    });
  });

  it('salida vacía con finishReason content-filter -> safety', async () => {
    gatewayTextMock.mockResolvedValue({ text: '', finishReason: 'content-filter' });
    await expect(enhancePrompt({ prompt: 'x' })).rejects.toMatchObject({ code: 'safety' });
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm test lib/providers/prompt-enhancer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migrar `prompt-enhancer.ts`**

Reemplazar desde `const body = {...}` hasta el final de la función por:

```ts
  const { text, finishReason } = await gatewayText({
    model: MODEL,
    label: 'enhance',
    system: SYSTEM_INSTRUCTIONS[input.type ?? 'image'] ?? SYSTEM_INSTRUCTIONS.image,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    temperature: 0.7,
    // 800 tokens da margen suficiente para 1-3 oraciones (~80 palabras).
    // thinkingBudget 0 (default del gateway helper): los thinking tokens se
    // cuentan dentro de maxOutputTokens y se comerían todo el budget.
    maxOutputTokens: 800,
    json: false,
  });

  const enhanced = text
    .trim()
    // Quitar comillas accidentales que el modelo a veces agrega.
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  if (!enhanced) {
    // finishReason normalizado del AI SDK: 'length' ≈ MAX_TOKENS,
    // 'content-filter' ≈ SAFETY/PROHIBITED_CONTENT del API nativo.
    if (finishReason === 'length') {
      throw new ProviderError(
        'Gemini se quedó sin tokens al mejorar. Intenta de nuevo.',
        'server',
        true,
      );
    }
    if (finishReason === 'content-filter') {
      throw new ProviderError(
        'Gemini rechazó la mejora por políticas de seguridad.',
        'safety',
        false,
      );
    }
    throw new ProviderError(`Gemini no devolvió texto (${finishReason}).`, 'unknown', false);
  }
  return enhanced;
```

Eliminar `ResponseSchema` local (el manejo de `promptFeedback.blockReason` queda cubierto por `finishReason === 'content-filter'`).

- [ ] **Step 4: Migrar `reference-analysis.ts`**

Conservar el armado interleaved de `parts` (`Imagen ${i+1}:` + `inline_data`) y el early-return de lista vacía. Reemplazar el bloque de red por:

```ts
  const { text: raw } = await gatewayText({
    model: MODEL,
    label: 'análisis',
    system: SYSTEM,
    contents: [{ role: 'user', parts }],
    temperature: 0.2,
    maxOutputTokens: 600,
    json: true,
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ProviderError('Gemini devolvió JSON inválido al analizar referencias', 'unknown', false);
  }
  return parseAnalysisReply(
    json,
    images.map((i) => i.path),
  );
```

- [ ] **Step 5: Migrar `storyboard-expand-check.ts`**

Conservar el contrato fail-open (nunca lanza). Reemplazar el interior del `try` de `stripsHaveText` por:

```ts
    const { text } = await gatewayText({
      model: CHECK_MODEL,
      label: 'expand-check',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            ...strips.map((s) => ({
              inline_data: { mime_type: 'image/jpeg', data: s.toString('base64') },
            })),
          ],
        },
      ],
      temperature: 0,
      maxOutputTokens: 60,
      json: true,
    });
    const verdict = parseTextCheck(text);
    if (verdict === null) {
      console.error('[storyboard-expand-check] veredicto no parseable');
      return false;
    }
    return verdict;
```

`parseTextCheck` cambia de firma: antes recibía el envelope JSON completo de Gemini; ahora recibe el texto ya extraído:

```ts
export function parseTextCheck(text: string | null | undefined): boolean | null {
  if (!text) return null;
  try {
    const parsed = CheckSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.hasText : null;
  } catch {
    return null;
  }
}
```

Actualizar `storyboard-expand-check.test.ts` a la nueva firma: los casos `'veredicto true'`/`'veredicto false'` pasan `JSON.stringify({ hasText: ... })` directo; `'respuesta sin candidates -> null'` se convierte en `'texto vacío -> null'` (`parseTextCheck('')` y `parseTextCheck(undefined)`). El catch externo de `stripsHaveText` sigue capturando cualquier `ProviderError` del gateway (incluida la falta de `AI_GATEWAY_API_KEY`) → `false`; el check propio de `GEMINI_API_KEY` en este módulo se elimina.

- [ ] **Step 6: Correr y verificar que pasan**

Run: `pnpm test lib/providers lib/campaigns`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/reference-analysis.ts lib/campaigns/storyboard-expand-check.ts lib/campaigns/storyboard-expand-check.test.ts lib/providers/prompt-enhancer.ts lib/providers/prompt-enhancer.test.ts
git commit -m "refactor(providers): referencias, expand-check y enhancer por AI Gateway"
```

---

### Task 6: Migrar Nano Banana

**Files:**
- Modify: `lib/providers/nano-banana.ts`
- Test: `lib/providers/nano-banana.test.ts`

**Interfaces:**
- Consumes: `toGatewayModel` de Task 1; `generateText`/`APICallError` de `ai` directamente (necesita `providerOptions` de imagen y `providerMetadata`, fuera del contrato de `gatewayText`).
- Produces: firma pública sin cambios: `generate(params: NanoBananaParams, _opts?): Promise<GenerationResult>`; exports `NANO_MODEL_SLUG`, `NANO_VARIANT`, `nanoVariantToResolution` sin cambios. `buildBody` se reemplaza por `buildRequest` (nuevo export puro para tests): `buildRequest(params: NanoBananaParams): { messages: ModelMessage[]; providerOptions: { google: Record<string, unknown> } }`.

Decisiones de diseño fijadas por el spec:
- La lógica de `buildBody` (chat multi-turn solo con `thoughtSignature`; degradación single-turn; descarte de refs en chat; `chatReferences`; directivas de prompt) se PRESERVA en `buildRequest` — solo cambia el shape de salida.
- El turno previo del modelo viaja como mensaje `assistant` con file part y `providerOptions: { google: { thoughtSignature } }` a nivel de parte. Si el gateway no lo acepta/propaga, Gemini rechaza y el fallback single-turn existente cubre (mismo contrato de hoy).
- `generationConfig` de imagen viaja como `providerOptions.google = { responseModalities: ['IMAGE'], imageConfig: { aspectRatio?, imageSize? } }` (mismos nombres que el REST nativo). Si el smoke del usuario muestra que aspect/resolución se ignoran, la contingencia es el shape `responseFormat: [{ type: 'image', aspectRatio }]` del provider google del AI SDK.
- `useGrounding` (`tools: [{ google_search: {} }]`): NO tiene equivalente verificado vía gateway. Se migra como `providerOptions.google.tools = [{ google_search: {} }]` (passthrough best-effort) y se FLAGEA en el PR como riesgo a validar en smoke — no resolver en silencio (regla del repo).

- [ ] **Step 1: Adaptar los tests puros (fallando)**

En `nano-banana.test.ts`, portar los tests de `buildBody` a `buildRequest` conservando la intención de cada caso:
- armado de contents → ahora `messages`: single-turn = 1 mensaje user; chat = `[user(prompt previo), assistant(file part con thoughtSignature en providerOptions.google), user(parts nuevos)]`.
- descarte de refs en chat / inclusión de `chatReferences` / fallback sin sig → asserts sobre los file parts del último mensaje user (helper `flattenData` adaptado a `content[].data`).
- `interpretResponse` se reemplaza por `interpretResult(result: { files: Array<{ uint8Array: Uint8Array; mediaType: string }>; finishReason: string; providerMetadata?: Record<string, Record<string, unknown>> })` — casos: imagen presente → `GenerationResult`; `files` vacío + `finishReason 'content-filter'` → ProviderError safety; vacío + `'length'` → ProviderError server retryable; vacío + otro → unknown con el finishReason en el mensaje; `thoughtSignature` presente en `providerMetadata.google.thoughtSignature` → viaja al resultado.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test lib/providers/nano-banana.test.ts`
Expected: FAIL.

- [ ] **Step 3: Reescribir el transporte de `nano-banana.ts`**

Estructura objetivo (la lógica de negocio se copia de las funciones actuales; aquí el esqueleto de transporte):

```ts
import 'server-only';
import { APICallError, generateText, type ModelMessage } from 'ai';
import {
  type GenerationResult,
  NANO_BANANA_MAX_REFS,
  type NanoBananaParams,
  ProviderError,
} from './types';
import { toGatewayModel } from './gateway';

// ... NANO_MODEL_SLUG, NANO_VARIANT, nanoVariantToResolution, directivas y
// buildPrompt SIN CAMBIOS ...

type NanoRequest = {
  messages: ModelMessage[];
  providerOptions: { google: Record<string, unknown> };
};

type NanoFilePart = {
  type: 'file';
  mediaType: string;
  data: Buffer;
  providerOptions?: { google: { thoughtSignature: string } };
};
type NanoTextPart = { type: 'text'; text: string };
type NanoPart = NanoFilePart | NanoTextPart;

export function buildRequest(params: NanoBananaParams): NanoRequest {
  const maxRefs = NANO_BANANA_MAX_REFS[params.model];

  // Chat multi-turn solo es válido si tenemos la firma del razonamiento del
  // turn anterior. Sin ella, Gemini 3 rechaza el request. Cuando falta,
  // degradamos a single-turn con la imagen previa adjunta como ref normal.
  const wantsChat = !!params.previousTurn?.thoughtSignature;

  // En chat real las refs externas se ignoran (Gemini las trataría como
  // "edita esta ref" y descartaría la imagen del turn anterior). En el
  // fallback sí van — la previa cuenta como una ref más.
  const refSlots = wantsChat
    ? 0
    : params.previousTurn
      ? Math.max(0, maxRefs - 1)
      : maxRefs;
  const refs = (params.references ?? []).slice(0, refSlots);

  const promptText =
    params.previousTurn && !wantsChat
      ? `Edit the previous image (attached) based on: ${buildPrompt(params)}`
      : buildPrompt(params);

  const newUserParts: NanoPart[] = [{ type: 'text', text: promptText }];
  for (const ref of refs) {
    newUserParts.push({ type: 'file', mediaType: ref.mimeType, data: ref.buffer });
  }
  // En chat real se permite re-anclar referencias elegidas (el producto) en el
  // turno actual. Fuera de chat no aplica: ahí ya van por `references`.
  if (wantsChat) {
    for (const ref of params.chatReferences ?? []) {
      newUserParts.push({ type: 'file', mediaType: ref.mimeType, data: ref.buffer });
    }
  }
  if (params.previousTurn && !wantsChat) {
    newUserParts.push({
      type: 'file',
      mediaType: params.previousTurn.mimeType,
      data: params.previousTurn.imageBuffer,
    });
  }

  const messages: ModelMessage[] = [];
  if (wantsChat && params.previousTurn) {
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: params.previousTurn.prompt }],
    });
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'file',
          mediaType: params.previousTurn.mimeType,
          data: params.previousTurn.imageBuffer,
          providerOptions: {
            google: { thoughtSignature: params.previousTurn.thoughtSignature as string },
          },
        },
      ],
    } as ModelMessage);
    messages.push({ role: 'user', content: newUserParts } as ModelMessage);
  } else {
    messages.push({ role: 'user', content: newUserParts } as ModelMessage);
  }

  const imageConfig: { aspectRatio?: string; imageSize?: string } = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  if (params.resolution) imageConfig.imageSize = params.resolution;

  return {
    messages,
    providerOptions: {
      google: {
        responseModalities: ['IMAGE'],
        ...(params.aspectRatio || params.resolution ? { imageConfig } : {}),
        ...(params.useGrounding ? { tools: [{ google_search: {} }] } : {}),
      },
    },
  };
}

export function interpretResult(result: {
  files: Array<{ uint8Array: Uint8Array; mediaType: string }>;
  finishReason: string;
  providerMetadata?: Record<string, Record<string, unknown>>;
}): GenerationResult {
  const image = result.files.find((f) => f.mediaType.startsWith('image/'));
  if (image) {
    const sig = result.providerMetadata?.google?.thoughtSignature;
    return {
      buffer: Buffer.from(image.uint8Array),
      mimeType: image.mediaType,
      thoughtSignature: typeof sig === 'string' ? sig : undefined,
    };
  }
  if (result.finishReason === 'content-filter') {
    throw new ProviderError(
      'El proveedor rechazó el contenido por políticas de seguridad (content-filter).',
      'safety',
      false,
    );
  }
  if (result.finishReason === 'length') {
    throw new ProviderError(
      'Gemini agotó el presupuesto de tokens antes de emitir la imagen. Reintenta o simplifica el prompt.',
      'server',
      true,
    );
  }
  throw new ProviderError(
    `La respuesta no incluyó imagen (finishReason: ${result.finishReason}). Reintenta o ajusta el prompt.`,
    'unknown',
    false,
  );
}

// ¿El fallo es Gemini rechazando el thought_signature replayado? Vía gateway el
// 404 NOT_FOUND del provider llega como APICallError con statusCode 404 (o el
// texto NOT_FOUND en el mensaje).
export function isChatSignatureRejection(status: number | undefined, message: string): boolean {
  return status === 404 || message.includes('NOT_FOUND');
}

async function callOnce(params: NanoBananaParams) {
  const req = buildRequest(params);
  return generateText({
    model: toGatewayModel(params.model),
    messages: req.messages,
    providerOptions: req.providerOptions,
  });
}

export async function generate(
  params: NanoBananaParams,
  _opts?: { noChatFallback?: boolean },
): Promise<GenerationResult> {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new ProviderError('AI_GATEWAY_API_KEY no configurada', 'auth', false);
  }
  const RETRY_DELAYS = [2000, 5000, 10000];
  let attempt = 0;
  for (;;) {
    try {
      const result = await callOnce(params);
      const generation = interpretResult(result);
      // ... post-proceso noBackground con sharp: SIN CAMBIOS, copiar del actual ...
      return generation;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if (APICallError.isInstance(err)) {
        const status = err.statusCode;
        if (status === 429 && attempt < RETRY_DELAYS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          attempt += 1;
          continue;
        }
        if (status === 429) {
          throw new ProviderError('Rate limit del proveedor. Intenta de nuevo en unos segundos.', 'rate_limit', true);
        }
        if (status === 401 || status === 403) {
          throw new ProviderError('Auth inválida con AI Gateway', 'auth', false);
        }
        // Fallback de chat conversacional: si el provider rechaza el
        // thought_signature replayado, reintentar UNA vez en single-turn.
        if (
          !_opts?.noChatFallback &&
          params.previousTurn?.thoughtSignature &&
          isChatSignatureRejection(status, err.message)
        ) {
          return generate(
            { ...params, previousTurn: { ...params.previousTurn, thoughtSignature: undefined } },
            { noChatFallback: true },
          );
        }
        if (status === 400) {
          throw new ProviderError(err.message.slice(0, 300), 'invalid_input', false);
        }
        if (status !== undefined && status >= 500) {
          throw new ProviderError(err.message.slice(0, 300), 'server', true);
        }
        throw new ProviderError(err.message.slice(0, 300), 'unknown', false);
      }
      throw new ProviderError(
        err instanceof Error ? err.message : 'error desconocido',
        'unknown',
        false,
      );
    }
  }
}
```

El post-proceso `noBackground` (sharp, umbral 250, alfa 0) se copia VERBATIM del archivo actual (líneas 413-429 pre-migración) al punto marcado en `generate()`. `buildBody` se elimina (sustituido por `buildRequest` de arriba, misma lógica). Los `PartSchema`/`ResponseSchema`/`ErrorSchema` zod del envelope nativo y `decodeImagePart` se eliminan; `SAFETY_FINISH_REASONS` se elimina (lo cubre `content-filter` normalizado).

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test lib/providers lib/jobs`
Expected: PASS — incluye `lib/jobs/handlers/nano-banana.test.ts` y `lib/jobs/storyboard-finalize.test.ts` (consumidores del adapter; si mockean `@/lib/providers/nano-banana` no les afecta el transporte; si asertan sobre `thoughtSignature`/`GenerationResult`, el shape no cambió).

- [ ] **Step 5: Commit**

```bash
git add lib/providers/nano-banana.ts lib/providers/nano-banana.test.ts
git commit -m "refactor(nano-banana): transporte via AI Gateway conservando chat multi-turn"
```

---

### Task 7: Docs, verificación integral y checklist de smokes

**Files:**
- Modify: `docs/modelos/` (los `.md` de Gemini y Nano Banana — localizar con `ls docs/modelos/`)
- Modify: `docs/zyra-studio-spec.md` (sección de providers)
- Modify: `lib/providers/veo.ts` (solo un comentario en el header)

**Interfaces:** N/A (docs + verificación).

- [ ] **Step 1: Anotar Veo y actualizar docs**

En `lib/providers/veo.ts`, sobre `const BASE_URL`, agregar:

```ts
// Veo es el ÚNICO consumidor de GEMINI_API_KEY: queda en la API nativa porque
// AI Gateway solo ofrece video bloqueante sin operation name (incompatible con
// el polling re-encolado por QStash). Ver docs/superpowers/specs/2026-07-08-
// migracion-ai-gateway-design.md.
```

En `docs/modelos/` (archivos de Gemini/Nano Banana): añadir al inicio una nota de que el transporte es Vercel AI Gateway (`AI_GATEWAY_API_KEY`, model strings `google/...` vía AI SDK) y que los detalles de request nativo aplican solo a Veo. En `docs/zyra-studio-spec.md`, actualizar la sección de providers con el mismo cambio (regla: spec en paralelo con el código).

- [ ] **Step 2: Verificar slugs contra el catálogo del gateway**

```bash
curl -s https://ai-gateway.vercel.sh/v1/models | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const ids=JSON.parse(d).data.map(m=>m.id).filter(id=>id.startsWith('google/gemini'));console.log(ids.join('\n'))})"
```

Expected: la lista incluye `google/gemini-2.5-flash` y `google/gemini-3-pro-image-preview`. Si el slug de imagen difiere (p.ej. solo existe `google/gemini-3.1-flash-image-preview`), NO cambiar los slugs internos: ajustar solo el mapeo en `toGatewayModel` con un `MODEL_MAP` explícito para ese caso y flagearlo en el PR.

- [ ] **Step 3: Suite completa + build**

```bash
pnpm test
pnpm build
```

Expected: test suite completa en verde; build sin errores. Si `pnpm lint` es parte del pre-commit, ya corrió en cada commit.

- [ ] **Step 4: Commit**

```bash
git add docs/ lib/providers/veo.ts
git commit -m "docs: transporte AI Gateway en docs de modelos y spec; anota Veo"
```

- [ ] **Step 5: Checklist de smokes con API real (LOS CORRE EL USUARIO)**

Entregar al usuario esta lista al terminar (requiere `AI_GATEWAY_API_KEY` en `.env.local` y AI Gateway habilitado en el proyecto de Vercel):

1. Ingesta de un prompt maestro largo + matcher (valida JSON con caps 32768 sin truncado).
2. Panel Nano Banana nuevo con aspect ratio 4:5 y resolución 2K (valida `imageConfig` passthrough).
3. Refinado encadenado de un panel (valida chat multi-turn / `thoughtSignature` vía gateway; si degrada a single-turn, el adapter lo tolera pero hay que reportarlo).
4. Una generación con grounding activo si el flujo lo usa (valida `google_search` passthrough).
5. Un video Veo corto (regresión: no debe verse afectado).
6. Revisar el dashboard AI Gateway (Observability) para confirmar que las llamadas aparecen con sus tokens.
