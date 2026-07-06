# Ingesta de prompt maestro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un usuario pega un prompt maestro monolítico y una capa Gemini lo reparte en los slots estructurados (ficha, estilo, guías, Cast) + un guion por clip, todo pre-llenado editable, sin mutilarse por topes.

**Architecture:** Capa de ingesta (`lib/campaigns/ingest.ts`, Gemini Flash, patrón `brief.ts`) que corre **antes** de crear la campaña y devuelve un `IngestResult`. El wizard pre-llena sus campos; al crear, los overrides de ficha + guías se mergean en `createCampaignStudioAction`, y el guion entra al matcher existente (con topes subidos). Las transiciones sobreviven como beats de entrada/salida por clip.

**Tech Stack:** Next.js 15/16 App Router, Supabase, Gemini 2.5 Flash (fetch directo), zod, vitest, pnpm.

## Global Constraints

- Gestor de paquetes: **pnpm** (`pnpm typecheck`, `pnpm build`, `pnpm vitest run`).
- Commits: **sin** trailer `Co-Authored-By`. Conventional Commits en español, imperativo.
- TypeScript: **prohibido `any`** — usar `unknown` + narrowing o tipos explícitos.
- Tests: **nunca** llaman a APIs reales (Gemini/fal/QStash). Fixtures y funciones puras.
- Migraciones: aplicar vía MCP (`mcp__plugin_supabase_supabase__apply_migration`, project_id `dzqhngfwlgxkmxohlwun`) **ANTES** de pushear código que lea la columna nueva.
- UI: dark minimalista, **sin emojis** en código/UI, componentes shadcn primero, acento `#009fff`.
- Service role solo server-side; `product_brief` es la única fuente de verdad del producto (no re-describir en scenePrompt).
- `'use server'` no exporta objetos: los esquemas zod y tipos van en `lib/schemas/**`, no en server-actions.

---

### Task 1: Migración `campaign_items.transition_hint`

**Files:**
- Create: `supabase/migrations/058_transition_hint.sql`

**Interfaces:**
- Produces: columna `campaign_items.transition_hint text` (nullable) — la escribe la Task 5.

- [ ] **Step 1: Crear la migración**

```sql
-- 058_transition_hint.sql
-- Pista de transición por clip (ingesta de prompt maestro, spec v2/15): el beat/
-- encuadre sobre el que cae el corte al siguiente clip. Solo metadato de edición;
-- el contenido del beat vive en scene_prompt. Nullable: los items sin transición
-- (clips sueltos, plan por mix) lo dejan null.
alter table campaign_items
  add column if not exists transition_hint text;
```

- [ ] **Step 2: Aplicar vía MCP**

Usar `mcp__plugin_supabase_supabase__apply_migration` con `project_id: dzqhngfwlgxkmxohlwun`, `name: 058_transition_hint`, y el SQL de arriba. Esperado: `success: true`.

- [ ] **Step 3: Verificar la columna**

Con `mcp__plugin_supabase_supabase__execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'campaign_items' and column_name = 'transition_hint';
```
Esperado: una fila `transition_hint | text | YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/058_transition_hint.sql
git commit -m "feat(campaigns): columna transition_hint para pistas de corte por clip"
```

---

### Task 2: Contrato zod `lib/schemas/ingest.ts`

**Files:**
- Create: `lib/schemas/ingest.ts`
- Test: `lib/schemas/ingest.test.ts`

**Interfaces:**
- Produces:
  - `IngestInputSchema` (zod) → `{ masterPrompt: string }`, `masterPrompt` trim, 1..24000.
  - `IngestRawSchema` (zod laxo) para la salida cruda de Gemini.
  - `type IngestResult` (forma final, tras computar `castHints`).
  - `type IngestBriefOverrides = { productFacts?: {...}; productVisualDetails?: string }`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/schemas/ingest.test.ts
import { describe, it, expect } from 'vitest';
import { IngestInputSchema, IngestRawSchema } from './ingest';

describe('IngestInputSchema', () => {
  it('acepta un prompt largo (>6000) hasta 24000', () => {
    const big = 'a'.repeat(20000);
    const parsed = IngestInputSchema.safeParse({ masterPrompt: big });
    expect(parsed.success).toBe(true);
  });
  it('rechaza vacío', () => {
    expect(IngestInputSchema.safeParse({ masterPrompt: '   ' }).success).toBe(false);
  });
  it('recorta a 24000 por el trim + max', () => {
    const parsed = IngestInputSchema.safeParse({ masterPrompt: 'a'.repeat(24001) });
    expect(parsed.success).toBe(false);
  });
});

describe('IngestRawSchema (laxo)', () => {
  it('un campo malformado no tira el objeto: cae a su default', () => {
    const parsed = IngestRawSchema.safeParse({
      productFacts: { heightCm: 'no-numero', medium: 'canvas' },
      visualStyle: 'inventado',
      guidelines: { safeCrop: '4:5', showFullProduct: 'si' },
      narrative: 'Clip 1: ...',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.productFacts.heightCm).toBeNull();
      expect(parsed.data.productFacts.medium).toBe('canvas');
      expect(parsed.data.visualStyle).toBeNull();
      expect(parsed.data.guidelines.safeCrop).toBe('4:5');
      expect(parsed.data.guidelines.showFullProduct).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/schemas/ingest.test.ts`
Expected: FAIL con "Cannot find module './ingest'".

- [ ] **Step 3: Implementar el schema**

```ts
// lib/schemas/ingest.ts
import { z } from 'zod';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

// Input: solo el prompt maestro crudo. Cap holgado (Gemini 2.5 Flash tiene
// contexto de sobra); el tope solo atrapa pegados patológicos.
export const IngestInputSchema = z.object({
  masterPrompt: z.string().trim().min(1).max(24000),
});
export type IngestInput = z.infer<typeof IngestInputSchema>;

// Salida CRUDA de Gemini: laxo, cada campo con catch/default para que un valor
// malformado no tire el objeto (la salida del LLM es estocástica).
export const IngestRawSchema = z.object({
  productFacts: z
    .object({
      heightCm: z.number().positive().max(2000).nullable().catch(null).default(null),
      widthCm: z.number().positive().max(2000).nullable().catch(null).default(null),
      weightKg: z.number().positive().max(1000).nullable().catch(null).default(null),
      thicknessMm: z.number().positive().max(500).nullable().catch(null).default(null),
      medium: z.string().trim().max(120).nullable().catch(null).default(null),
    })
    .catch({ heightCm: null, widthCm: null, weightKg: null, thicknessMm: null, medium: null })
    .default({ heightCm: null, widthCm: null, weightKg: null, thicknessMm: null, medium: null }),
  productVisualDetails: z.string().trim().max(800).nullable().catch(null).default(null),
  visualStyle: z
    .enum(['ultra_realista', 'casero', 'fantasia', 'animado'])
    .nullable()
    .catch(null)
    .default(null),
  guidelines: z
    .object({
      safeCrop: z.union([z.literal('4:5'), z.null()]).catch(null).default(null),
      showFullProduct: z.boolean().catch(false).default(false),
      hookProductHero: z.boolean().catch(false).default(false),
    })
    .catch({ safeCrop: null, showFullProduct: false, hookProductHero: false })
    .default({ safeCrop: null, showFullProduct: false, hookProductHero: false }),
  castMentions: z.array(z.string().trim().min(1).max(60)).catch([]).default([]),
  locationHints: z.array(z.string().trim().min(1).max(200)).catch([]).default([]),
  narrative: z.string().trim().catch('').default(''),
  warnings: z.array(z.string().trim().min(1).max(300)).catch([]).default([]),
});
export type IngestRaw = z.infer<typeof IngestRawSchema>;

// Overrides de ficha que la ingesta propone y el wizard pasa a la creación.
export type IngestBriefOverrides = {
  productFacts?: {
    heightCm?: number;
    widthCm?: number;
    weightKg?: number;
    thicknessMm?: number;
    medium?: string;
  };
  productVisualDetails?: string;
};

// Resultado final que consume el wizard (castHints computado desde castMentions).
export type IngestResult = {
  productFacts: NonNullable<IngestBriefOverrides['productFacts']>;
  productVisualDetails: string | null;
  visualStyle: VisualStyle | null;
  guidelines: { safeCrop: '4:5' | null; showFullProduct: boolean; hookProductHero: boolean };
  castHints: Array<{ name: string; inCast: boolean; note: string }>;
  locationHints: string[];
  narrative: string;
  warnings: string[];
};
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/schemas/ingest.test.ts`
Expected: PASS (3 + 1 tests verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/ingest.ts lib/schemas/ingest.test.ts
git commit -m "feat(ingest): contrato zod de la ingesta de prompt maestro"
```

---

### Task 3: Módulo de ingesta `lib/campaigns/ingest.ts`

**Files:**
- Create: `lib/campaigns/ingest.ts`
- Test: `lib/campaigns/ingest.test.ts`

**Interfaces:**
- Consumes: `IngestRawSchema`, `IngestResult`, `IngestBriefOverrides` (Task 2); `ProductBrief` (`lib/campaigns/brief.ts`); `ProviderError` (`lib/providers/types`).
- Produces:
  - `parseIngestResult(raw: string, opts: { castNames: string[] }): IngestResult`
  - `mergeVisualDetails(detected: string, fromPrompt: string): string`
  - `mergeBriefOverrides(brief: ProductBrief, overrides: IngestBriefOverrides | undefined): ProductBrief`
  - `fallbackIngestResult(masterPrompt: string): IngestResult`
  - `async ingestMasterPrompt(input: { masterPrompt: string; castNames: string[] }): Promise<IngestResult>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/campaigns/ingest.test.ts
import { describe, it, expect } from 'vitest';
import {
  parseIngestResult,
  mergeVisualDetails,
  mergeBriefOverrides,
  fallbackIngestResult,
} from './ingest';
import type { ProductBrief } from './brief';

const baseBrief: ProductBrief = {
  productName: 'Canvas print',
  category: 'home',
  variants: [],
  palette: [],
  visualDetails: 'A printed canvas.',
  demographic: '',
  market: 'global',
};

describe('parseIngestResult', () => {
  it('reparte medidas a productFacts y NO al narrative; marca inCast', () => {
    const raw = JSON.stringify({
      productFacts: { heightCm: 150, widthCm: 100, weightKg: 3.7, medium: 'matte canvas' },
      productVisualDetails: 'Frameless matte canvas, 2:3 vertical.',
      visualStyle: 'casero',
      guidelines: { safeCrop: '4:5', showFullProduct: true, hookProductHero: true },
      castMentions: ['Marta', 'Desconocida'],
      locationHints: ['bedroom', 'garden'],
      narrative: 'Clip 1: she lifts the canvas.',
      warnings: ['9 clips detectados'],
    });
    const r = parseIngestResult(raw, { castNames: ['Marta'] });
    expect(r.productFacts.heightCm).toBe(150);
    expect(r.narrative).not.toContain('150');
    expect(r.visualStyle).toBe('casero');
    expect(r.guidelines.safeCrop).toBe('4:5');
    const marta = r.castHints.find((c) => c.name === 'Marta');
    const otra = r.castHints.find((c) => c.name === 'Desconocida');
    expect(marta?.inCast).toBe(true);
    expect(otra?.inCast).toBe(false);
  });

  it('tolera fences markdown y campos faltantes', () => {
    const r = parseIngestResult('```json\n{"narrative":"Clip 1: ..."}\n```', { castNames: [] });
    expect(r.narrative).toBe('Clip 1: ...');
    expect(r.visualStyle).toBeNull();
    expect(r.productFacts.heightCm).toBeUndefined();
  });

  it('JSON basura → fallback con warning, narrative vacío', () => {
    const r = parseIngestResult('no soy json', { castNames: [] });
    expect(r.narrative).toBe('');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('mergeVisualDetails', () => {
  it('la descripción del usuario va primero y se concatena con la detectada', () => {
    const out = mergeVisualDetails('Detected auto.', 'User fine detail.');
    expect(out.startsWith('User fine detail.')).toBe(true);
    expect(out).toContain('Detected auto.');
  });
  it('no duplica cuando una contiene a la otra', () => {
    expect(mergeVisualDetails('User fine detail.', 'User fine detail.')).toBe('User fine detail.');
  });
  it('capa a 800', () => {
    expect(mergeVisualDetails('a'.repeat(500), 'b'.repeat(500)).length).toBe(800);
  });
});

describe('mergeBriefOverrides', () => {
  it('mergea medidas y aumenta visualDetails, sin tocar lo no provisto', () => {
    const out = mergeBriefOverrides(baseBrief, {
      productFacts: { heightCm: 150, medium: 'matte canvas' },
      productVisualDetails: 'Frameless matte canvas.',
    });
    expect(out.heightCm).toBe(150);
    expect(out.medium).toBe('matte canvas');
    expect(out.visualDetails.startsWith('Frameless matte canvas.')).toBe(true);
    expect(out.productName).toBe('Canvas print');
  });
  it('sin overrides devuelve el brief tal cual', () => {
    expect(mergeBriefOverrides(baseBrief, undefined)).toEqual(baseBrief);
  });
});

describe('fallbackIngestResult', () => {
  it('narrative = prompt saneado y trae un warning', () => {
    const r = fallbackIngestResult('Mi prompt maestro');
    expect(r.narrative).toBe('Mi prompt maestro');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/ingest.test.ts`
Expected: FAIL con "Cannot find module './ingest'".

- [ ] **Step 3: Implementar el módulo**

```ts
// lib/campaigns/ingest.ts
import 'server-only';
import { IngestRawSchema, type IngestBriefOverrides, type IngestResult } from '@/lib/schemas/ingest';
import type { ProductBrief } from './brief';
import { ProviderError } from '@/lib/providers/types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';
const VISUAL_DETAILS_MAX = 800;

export const INGEST_SYSTEM = `Eres un asistente que convierte un PROMPT MAESTRO de un comercial (escrito como para un solo render tipo Veo/Sora) en los elementos estructurados de una plataforma composicional. NO reescribes el mundo: REPARTES lo que ya está escrito.

Devuelve SOLO un JSON con esta forma exacta:
{
  "productFacts": {"heightCm": number|null, "widthCm": number|null, "weightKg": number|null, "thicknessMm": number|null, "medium": "string|null"},
  "productVisualDetails": "string|null",
  "visualStyle": "ultra_realista|casero|fantasia|animado|null",
  "guidelines": {"safeCrop": "4:5"|null, "showFullProduct": boolean, "hookProductHero": boolean},
  "castMentions": ["nombres propios de personas que actúan o hablan"],
  "locationHints": ["locaciones/escenarios distintos descritos"],
  "narrative": "el guion por clip, LIMPIO",
  "warnings": ["avisos legibles para el usuario"]
}

Reglas:
- productFacts: SOLO medidas/peso/material que el prompt DIGA explícitamente. NO inventes. null si no aparece.
- productVisualDetails: la descripción visual fina del producto (material, acabado, proporción, contenido impreso), en INGLÉS, densa, 2-3 frases máximo. Es lo que el usuario escribió; no inventes atributos.
- visualStyle: 'casero' si la estética es UGC / grabado con celular / handheld / nativo del feed; 'ultra_realista' si pide realismo fotográfico de producción; 'animado' o 'fantasia' si aplica claramente; null si no hay señal clara.
- guidelines: safeCrop='4:5' si menciona área/zona segura 4:5 o encuadre 9:16 con el contenido clave al centro; showFullProduct si insiste en mostrar el producto completo; hookProductHero si el primer beat es el producto como héroe.
- castMentions: nombres propios de personas que actúan o hablan (no figurantes de fondo, no personajes inventados que no actúan).
- locationHints: locaciones/escenarios distintos descritos.
- narrative: el guion CLIP POR CLIP, en el MISMO idioma del prompt, UNA escena por clip, conservando acciones, diálogo y orden. QUITA de aquí las medidas/material del producto y la estética global (YA van en sus campos) para no duplicar ni contradecir. NO escribas texto en pantalla ni emojis.
- warnings: cuenta los clips y avisa si son muchos (>12); avisa si nombra personas que quizá no estén en el Cast; avisa si las transiciones requieren montaje posterior.

Cast disponible del workspace (para resolver menciones; NO lo repitas en la salida): __CAST__.
Devuelve SOLO el JSON válido, sin markdown.`;

const GeminiResponseSchema = {
  parse(json: unknown): string {
    const j = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const parts = j.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? '').join('');
  },
};

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

// La descripción del usuario MANDA (va primero); se concatena la detectada sin
// duplicar, capado a 800 (límite del schema del brief).
export function mergeVisualDetails(detected: string, fromPrompt: string): string {
  const d = detected.trim();
  const p = fromPrompt.trim();
  if (!d) return p.slice(0, VISUAL_DETAILS_MAX);
  if (!p) return d.slice(0, VISUAL_DETAILS_MAX);
  if (d.includes(p) || p.includes(d)) {
    return (p.length >= d.length ? p : d).slice(0, VISUAL_DETAILS_MAX);
  }
  return `${p} ${d}`.slice(0, VISUAL_DETAILS_MAX);
}

export function mergeBriefOverrides(
  brief: ProductBrief,
  overrides: IngestBriefOverrides | undefined,
): ProductBrief {
  if (!overrides) return brief;
  const f = overrides.productFacts;
  return {
    ...brief,
    ...(f?.heightCm != null ? { heightCm: f.heightCm } : {}),
    ...(f?.widthCm != null ? { widthCm: f.widthCm } : {}),
    ...(f?.weightKg != null ? { weightKg: f.weightKg } : {}),
    ...(f?.thicknessMm != null ? { thicknessMm: f.thicknessMm } : {}),
    ...(f?.medium ? { medium: f.medium } : {}),
    ...(overrides.productVisualDetails
      ? { visualDetails: mergeVisualDetails(brief.visualDetails, overrides.productVisualDetails) }
      : {}),
  };
}

// Salida cruda de Gemini → IngestResult (computa castHints). JSON inválido → fallback.
export function parseIngestResult(raw: string, opts: { castNames: string[] }): IngestResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return fallbackIngestResult('');
  }
  const parsed = IngestRawSchema.safeParse(json);
  if (!parsed.success) return fallbackIngestResult('');
  const d = parsed.data;
  const known = new Set(opts.castNames.map(norm));
  const productFacts: IngestResult['productFacts'] = {
    ...(d.productFacts.heightCm != null ? { heightCm: d.productFacts.heightCm } : {}),
    ...(d.productFacts.widthCm != null ? { widthCm: d.productFacts.widthCm } : {}),
    ...(d.productFacts.weightKg != null ? { weightKg: d.productFacts.weightKg } : {}),
    ...(d.productFacts.thicknessMm != null ? { thicknessMm: d.productFacts.thicknessMm } : {}),
    ...(d.productFacts.medium ? { medium: d.productFacts.medium } : {}),
  };
  return {
    productFacts,
    productVisualDetails: d.productVisualDetails,
    visualStyle: d.visualStyle,
    guidelines: d.guidelines,
    castHints: [...new Set(d.castMentions)].map((name) => {
      const inCast = known.has(norm(name));
      return {
        name,
        inCast,
        note: inCast ? '' : 'No está en tu Cast: su identidad cambiará entre clips.',
      };
    }),
    locationHints: [...new Set(d.locationHints)],
    narrative: d.narrative,
    warnings: d.warnings,
  };
}

export function fallbackIngestResult(masterPrompt: string): IngestResult {
  return {
    productFacts: {},
    productVisualDetails: null,
    visualStyle: null,
    guidelines: { safeCrop: null, showFullProduct: false, hookProductHero: false },
    castHints: [],
    locationHints: [],
    narrative: masterPrompt.trim(),
    warnings: ['No pude analizar el prompt automáticamente; revisa y edita los campos a mano.'],
  };
}

export async function ingestMasterPrompt(input: {
  masterPrompt: string;
  castNames: string[];
}): Promise<IngestResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const system = INGEST_SYSTEM.replace(
    '__CAST__',
    input.castNames.length ? input.castNames.join(', ') : '(ninguno)',
  );

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: input.masterPrompt.slice(0, 24000) }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini ingest ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }
  const raw = GeminiResponseSchema.parse(await res.json());
  return parseIngestResult(raw, { castNames: input.castNames });
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/campaigns/ingest.test.ts`
Expected: PASS (todos verdes).

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/ingest.ts lib/campaigns/ingest.test.ts
git commit -m "feat(ingest): módulo Gemini de ingesta + merge de ficha"
```

---

### Task 4: Subir topes aguas abajo (matcher + schema de ideas)

**Files:**
- Modify: `lib/schemas/campaigns.ts:123`
- Modify: `lib/prompt-director/format-matcher.ts:161,537,551,588`
- Test: `lib/prompt-director/format-matcher-caps.test.ts`

**Interfaces:**
- Produces: el matcher ya no recorta a 8 escenas ni rechaza ideas >6000; sube a 16 escenas y 24000 chars.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/prompt-director/format-matcher-caps.test.ts
import { describe, it, expect } from 'vitest';
import { GeneratePlanSchema } from '@/lib/schemas/campaigns';

describe('GeneratePlanSchema.userIdeas — tope subido', () => {
  it('acepta ideas de más de 6000 chars (hasta 24000)', () => {
    const parsed = GeneratePlanSchema.safeParse({
      campaignId: '00000000-0000-0000-0000-000000000000',
      userIdeas: 'x'.repeat(9000),
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/prompt-director/format-matcher-caps.test.ts`
Expected: FAIL (hoy `.max(6000)` rechaza 9000).

- [ ] **Step 3: Subir los topes**

En `lib/schemas/campaigns.ts:123`:
```ts
  userIdeas: z.string().trim().max(24000).optional(),
```

En `lib/prompt-director/format-matcher.ts`, cuatro cambios:

Línea ~161 (dentro del `.transform` de `scenes`): `arr.slice(0, 8)` → `arr.slice(0, 16)`.

Línea ~537 (armado del `parts`): `input.ideasText.slice(0, 6000)` → `input.ideasText.slice(0, 24000)`.

Línea ~551 (`generationConfig`): `maxOutputTokens: 4000,` → `maxOutputTokens: 8192,`.

Línea ~588 (`requestMatch`, saneo de matches): `.slice(0, 8)` → `.slice(0, 16)`.

- [ ] **Step 4: Correr el test para verlo pasar + no romper los existentes**

Run: `pnpm vitest run lib/prompt-director/format-matcher-caps.test.ts lib/prompt-director/seedance-references.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/campaigns.ts lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher-caps.test.ts
git commit -m "feat(matcher): subir topes de ideas y escenas para guiones largos"
```

---

### Task 5: Beats de transición por clip

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (SceneSchema, MatchedScene, SYSTEM, ejemplo JSON)
- Modify: `lib/campaigns/planner.ts` (DirectedIdea.scenes, PlanItemDraft, buildDirectedPlan, buildPlan)
- Modify: `server-actions/campaigns.ts` (insert de `transition_hint`)
- Test: `lib/campaigns/planner-transition.test.ts`

**Interfaces:**
- Consumes: columna `transition_hint` (Task 1).
- Produces: `PlanItemDraft.transitionHint: string | null`; el matcher devuelve `MatchedScene.transitionHint`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/campaigns/planner-transition.test.ts
import { describe, it, expect } from 'vitest';
import { buildDirectedPlan, type DirectedIdea } from './planner';

const format = {
  id: 'f1', slug: 'gran-pantalla', name: 'Gran pantalla',
  requiredRefs: [], defaultDurationS: 8, defaultAudio: true,
};

function idea(over: Partial<DirectedIdea> = {}): DirectedIdea {
  return {
    format, count: 1, scenePrompt: null, durationS: null, sceneSummary: null,
    characterIds: [], invented: [], sequenceLabel: 'Anuncio',
    scenes: [
      { scenePrompt: 'Clip 1: opens wide.', durationS: 5, sceneSummary: null, beatRole: 'beat', characterStateHint: null, transitionHint: 'corta sobre el giro hacia el jardín' },
      { scenePrompt: 'Clip 2: garden.', durationS: 5, sceneSummary: null, beatRole: 'beat', characterStateHint: null, transitionHint: null },
    ],
    ...over,
  };
}

describe('buildDirectedPlan — transitionHint', () => {
  it('propaga transitionHint de cada escena al item', () => {
    const items = buildDirectedPlan({
      ideas: [idea()], productName: 'Canvas', goal: 'mixed', scenes: [],
      characters: [], available: { product: true, packaging: false },
      dateStart: new Date('2026-07-01'), dateEnd: new Date('2026-07-10'),
      draftModelSlug: 'seedance-1-0-lite-t2v-250428', language: 'es', aspectRatio: '9:16',
    });
    expect(items[0].transitionHint).toBe('corta sobre el giro hacia el jardín');
    expect(items[1].transitionHint).toBeNull();
  });
});
```

> Nota: usa el `draftModelSlug` real del repo si difiere (revisa `DRAFT_MODEL` en `server-actions/campaigns.ts`); el valor solo se copia al item, el test no lo valida.

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/planner-transition.test.ts`
Expected: FAIL (type error: `transitionHint` no existe en `scenes[]` ni en `PlanItemDraft`).

- [ ] **Step 3: Añadir `transitionHint` a los tipos y al planner**

En `lib/campaigns/planner.ts`:

1. `PlanItemDraft` (tras `characterStateHint: string | null;`), agregar:
```ts
  // Pista de corte hacia el siguiente clip (ingesta de prompt maestro). null en
  // clips sueltos o plan por mix.
  transitionHint: string | null;
```

2. `DirectedIdea.scenes` — al tipo de cada escena agregar `transitionHint: string | null;`:
```ts
  scenes: Array<{ scenePrompt: string; durationS: number | null; sceneSummary: string | null; beatRole: 'reveal' | 'action' | 'beat'; characterStateHint: string | null; transitionHint: string | null }>;
```

3. En `buildDirectedPlan`, rama secuencia (el `return idea.scenes.slice(...).map((sc, sceneIndex) => ({ ... }))`), agregar al objeto: `transitionHint: sc.transitionHint ?? null,`.

4. En `buildDirectedPlan`, rama normal (el `items.push({ ... })`), agregar: `transitionHint: null,`.

5. En `buildPlan`, el `items.push({ ... })`, agregar: `transitionHint: null,`.

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/campaigns/planner-transition.test.ts`
Expected: PASS.

- [ ] **Step 5: Cablear el matcher (SceneSchema + SYSTEM) y el insert**

En `lib/prompt-director/format-matcher.ts`:

1. `SceneSchema` — agregar campo (tras `characterStateHint`):
```ts
  // Pista de corte hacia el siguiente clip cuando el guion pide transición
  // motivada: el gesto/encuadre sobre el que cae el corte. null si no aplica.
  transitionHint: z.string().trim().min(1).max(200).nullable().catch(null).default(null),
```

2. `type MatchedScene` — agregar `transitionHint: string | null;`.

3. El `.transform` de `scenes` (el objeto `satisfies MatchedScene`) — agregar `transitionHint: parsed.data.transitionHint,`.

4. En el SYSTEM, dentro de la definición del objeto de `scenes` (después de `characterStateHint`), agregar:
```
  "transitionHint":"si el guion pide una transición MOTIVADA al siguiente clip (match-cut, whip-pan, corte sobre un gesto), nombra en UNA frase corta el beat/encuadre de CIERRE sobre el que cae el corte (ej. 'corta sobre el canvas ya montado'); la escena SIGUIENTE debe ABRIR de forma coherente con ese cierre. null si no hay transición motivada"
```

5. En el ejemplo JSON del final del SYSTEM, dentro del objeto de match, no hace falta tocar (el ejemplo usa `"scenes":[]`).

En `server-actions/campaigns.ts`, el `insert` de `campaign_items` (dentro de `generatePlanAction`), agregar a cada fila:
```ts
      transition_hint: i.transitionHint ?? null,
```

- [ ] **Step 6: Verificar typecheck + tests**

Run: `pnpm typecheck && pnpm vitest run lib/campaigns/planner-transition.test.ts lib/campaigns/storyboard-video.test.ts`
Expected: sin errores de tipo; PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/campaigns/planner.ts server-actions/campaigns.ts lib/campaigns/planner-transition.test.ts
git commit -m "feat(matcher): beats de transición por clip anclados en transition_hint"
```

---

### Task 6: Merge de overrides en `createCampaignStudioAction`

**Files:**
- Modify: `lib/schemas/campaigns.ts` (CreateCampaignStudioSchema)
- Modify: `server-actions/campaigns.ts` (createCampaignStudioAction, insert)

**Interfaces:**
- Consumes: `mergeBriefOverrides` (Task 3), `IngestBriefOverrides` (Task 2), `CreativeGuidelinesSchema` (`lib/campaigns/guidelines`).
- Produces: `createCampaignStudioAction` acepta `briefOverrides?` + `guidelines?`.

- [ ] **Step 1: Extender el schema**

En `lib/schemas/campaigns.ts`, dentro del objeto de `CreateCampaignStudioSchema` (antes de los `.refine(...)`), agregar:
```ts
  // Overrides de ficha propuestos por la ingesta de prompt maestro (spec v2/15):
  // medidas del usuario + descripción fina. Se mergean con el brief auto-detectado.
  briefOverrides: z
    .object({
      productFacts: z
        .object({
          heightCm: z.number().positive().max(2000).optional(),
          widthCm: z.number().positive().max(2000).optional(),
          weightKg: z.number().positive().max(1000).optional(),
          thicknessMm: z.number().positive().max(500).optional(),
          medium: z.string().trim().max(120).optional(),
        })
        .optional(),
      productVisualDetails: z.string().trim().max(800).optional(),
    })
    .optional(),
  // Guías creativas inferidas por la ingesta (safe 4:5, producto completo, hook).
  guidelines: CreativeGuidelinesSchema.optional(),
```

Añadir el import al inicio de `lib/schemas/campaigns.ts` si no existe:
```ts
import { CreativeGuidelinesSchema } from '@/lib/campaigns/guidelines';
```
> Verifica que `guidelines.ts` no importe de `campaigns.ts` (evitar ciclo). Hoy `guidelines.ts` solo importa `zod`, así que es seguro.

- [ ] **Step 2: Aplicar el merge y persistir las guías**

En `server-actions/campaigns.ts`, `createCampaignStudioAction`:

Import (junto a los otros de `lib/campaigns`):
```ts
import { mergeBriefOverrides } from '@/lib/campaigns/ingest';
```

En el `.insert({ ... })` de `campaigns`, cambiar:
```ts
      product_brief: brief,
```
por:
```ts
      product_brief: mergeBriefOverrides(brief, parsed.data.briefOverrides),
      ...(parsed.data.guidelines ? { creative_guidelines: parsed.data.guidelines } : {}),
```

- [ ] **Step 3: Verificar typecheck + build**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/campaigns.ts server-actions/campaigns.ts
git commit -m "feat(campaigns): mergear overrides de ficha y guías de la ingesta al crear"
```

---

### Task 7: Server action `ingestMasterPromptAction`

**Files:**
- Modify: `server-actions/campaigns.ts`

**Interfaces:**
- Consumes: `ingestMasterPrompt`, `fallbackIngestResult` (Task 3), `IngestInputSchema` (Task 2).
- Produces: `ingestMasterPromptAction(input: unknown): Promise<Result<IngestResult>>`.

- [ ] **Step 1: Implementar la action**

En `server-actions/campaigns.ts`, imports:
```ts
import { ingestMasterPrompt, fallbackIngestResult } from '@/lib/campaigns/ingest';
import { IngestInputSchema } from '@/lib/schemas/ingest';
import type { IngestResult } from '@/lib/schemas/ingest';
```

Nueva action (junto a `generatePlanAction`):
```ts
// Ingesta de prompt maestro (spec v2/15): reparte un prompt monolítico en los
// slots estructurados. Corre ANTES de crear la campaña; no persiste nada.
export async function ingestMasterPromptAction(input: unknown): Promise<Result<IngestResult>> {
  const parsed = IngestInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('characters')
    .select('name')
    .eq('workspace_id', workspace.id);
  const castNames = (rows ?? []).map((r) => r.name as string);
  try {
    const data = await ingestMasterPrompt({ masterPrompt: parsed.data.masterPrompt, castNames });
    return { ok: true, data };
  } catch (err) {
    // Falla blanda: no bloquea el wizard (queda en logs; el usuario edita a mano).
    console.error('[ingestMasterPromptAction] ingesta falló; fallback manual', err);
    return { ok: true, data: fallbackIngestResult(parsed.data.masterPrompt) };
  }
}
```

- [ ] **Step 2: Verificar typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: sin errores; la ruta compila (control `'use server'` no exporta objetos — `IngestResult` es solo `type`, ok).

- [ ] **Step 3: Commit**

```bash
git add server-actions/campaigns.ts
git commit -m "feat(ingest): server action ingestMasterPromptAction con falla blanda"
```

---

### Task 8: UI del wizard — pegar prompt maestro

**Files:**
- Modify: `components/campaigns/CampaignStudioWizard.tsx`

**Interfaces:**
- Consumes: `ingestMasterPromptAction` (Task 7), `IngestBriefOverrides` (Task 2), `CreativeGuidelines` (`lib/campaigns/guidelines`).

- [ ] **Step 1: Imports y estado**

En `CampaignStudioWizard.tsx`:

Cambiar el import de acciones:
```ts
import { createCampaignStudioAction, generatePlanAction, ingestMasterPromptAction } from '@/server-actions/campaigns';
```
Añadir imports de tipos:
```ts
import type { IngestBriefOverrides } from '@/lib/schemas/ingest';
import type { CreativeGuidelines } from '@/lib/campaigns/guidelines';
```

Añadir estado (junto a los otros `useState`, cerca de `const [ideas, setIdeas]`):
```ts
  const [masterPrompt, setMasterPrompt] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [briefOverrides, setBriefOverrides] = useState<IngestBriefOverrides | null>(null);
  const [guidelines, setGuidelines] = useState<CreativeGuidelines | null>(null);
  const [ingestNotes, setIngestNotes] = useState<string[]>([]);
  const [styleSuggestion, setStyleSuggestion] = useState<VisualStyle | null>(null);
```

Etiquetas legibles del estilo (arriba del componente, junto a `GOALS`):
```ts
const STYLE_LABELS: Record<string, string> = {
  ultra_realista: 'Ultra realista',
  casero: 'Casero (UGC/celular)',
  fantasia: 'Fantasía',
  animado: 'Animado',
};
```

- [ ] **Step 2: Handler de ingesta**

Junto a `handleMusicSelected`:
```ts
  async function handleIngest() {
    if (!masterPrompt.trim()) return;
    setIngesting(true);
    try {
      const res = await ingestMasterPromptAction({ masterPrompt: masterPrompt.trim() });
      if (!res.ok) {
        toast.error(res.message ?? 'No se pudo analizar el prompt');
        return;
      }
      const r = res.data;
      if (r.narrative) setIdeas(r.narrative);
      setBriefOverrides(
        Object.keys(r.productFacts).length || r.productVisualDetails
          ? {
              ...(Object.keys(r.productFacts).length ? { productFacts: r.productFacts } : {}),
              ...(r.productVisualDetails ? { productVisualDetails: r.productVisualDetails } : {}),
            }
          : null,
      );
      setGuidelines(
        r.guidelines.safeCrop || r.guidelines.showFullProduct || r.guidelines.hookProductHero
          ? r.guidelines
          : null,
      );
      setStyleSuggestion(r.visualStyle);
      setIngestNotes([
        ...r.warnings,
        ...r.castHints.filter((c) => !c.inCast).map((c) => `${c.name}: ${c.note}`),
        ...(r.locationHints.length
          ? [`Carga estas locaciones como base para consistencia: ${r.locationHints.join(', ')}.`]
          : []),
      ]);
      toast.success('Prompt analizado: revisa el reparto y ajusta lo que quieras.');
    } finally {
      setIngesting(false);
    }
  }
```

- [ ] **Step 3: Pasar los overrides al crear**

En `runCreate`, en el objeto de `createCampaignStudioAction({ ... })`, agregar (junto a `visualStyle`):
```ts
      ...(briefOverrides ? { briefOverrides } : {}),
      ...(guidelines ? { guidelines } : {}),
```

- [ ] **Step 4: Sección de UI (antes de la sección "Describe lo que imaginas")**

Insertar esta `<section>` justo antes de `<section className="space-y-1.5">` que contiene el `<Label htmlFor="campaign-ideas">`:
```tsx
        <section className="space-y-1.5">
          <Label htmlFor="master-prompt" className="text-xs font-medium text-foreground/80">
            ¿Tienes un prompt maestro? <span className="font-normal text-muted-foreground/50">(opcional)</span>
          </Label>
          <p className="text-2xs text-muted-foreground">
            Pega un guion completo (estética, medidas, locaciones, clips) y lo repartimos en la
            ficha, el estilo y las guías; el guion por clip llena el campo de abajo. Revisa todo
            antes de generar.
          </p>
          <textarea
            id="master-prompt"
            value={masterPrompt}
            onChange={(e) => setMasterPrompt(e.target.value)}
            placeholder="Comercial UGC 30s... Estructura de 9 clips... Canvas 150x100cm..."
            maxLength={24000}
            rows={4}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-2sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!masterPrompt.trim() || ingesting}
            onClick={() => void handleIngest()}
          >
            {ingesting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            Analizar prompt
          </Button>
          {(briefOverrides || guidelines || styleSuggestion || ingestNotes.length > 0) && (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-card/50 p-3 text-2xs">
              {briefOverrides?.productFacts && (
                <p className="text-muted-foreground">
                  Ficha (de tu prompt):{' '}
                  {[
                    briefOverrides.productFacts.heightCm && `alto ${briefOverrides.productFacts.heightCm}cm`,
                    briefOverrides.productFacts.widthCm && `ancho ${briefOverrides.productFacts.widthCm}cm`,
                    briefOverrides.productFacts.weightKg && `${briefOverrides.productFacts.weightKg}kg`,
                    briefOverrides.productFacts.medium,
                  ].filter(Boolean).join(' · ')}
                </p>
              )}
              {styleSuggestion && styleSuggestion !== visualStyle && (
                <button
                  type="button"
                  onClick={() => setVisualStyle(styleSuggestion)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-1 text-primary transition-colors hover:bg-primary/10"
                >
                  Sugerido: {STYLE_LABELS[styleSuggestion] ?? styleSuggestion} · aplicar
                </button>
              )}
              {guidelines?.safeCrop === '4:5' && (
                <p className="text-muted-foreground">Guía aplicada: encuadre seguro 4:5.</p>
              )}
              {ingestNotes.map((note, i) => (
                <p key={i} className="text-amber-400/80">
                  {note}
                </p>
              ))}
            </div>
          )}
        </section>
```

- [ ] **Step 5: Subir el `maxLength` del textarea de ideas**

En el `<textarea id="campaign-ideas">`, cambiar `maxLength={6000}` → `maxLength={24000}` (para que el narrative repartido no se corte en la UI).

- [ ] **Step 6: Verificar typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: sin errores; `/app/campaigns/new` (o donde viva el wizard) compila.

- [ ] **Step 7: Commit**

```bash
git add components/campaigns/CampaignStudioWizard.tsx
git commit -m "feat(ui): pegar prompt maestro en el wizard con reparto editable"
```

---

### Task 9: Verificación final

**Files:** (ninguno nuevo)

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm build && pnpm vitest run`
Expected: typecheck limpio, build ok, todos los tests verdes.

- [ ] **Step 2: Smoke manual (usuario, API real)**

Pegar el prompt maestro real de Proliénzo en el wizard → "Analizar prompt". Verificar:
- El campo de ideas se llena con el guion por clip (sin medidas ni estética global dentro).
- El panel muestra la ficha detectada (150cm/100cm/3.7kg/matte canvas), la sugerencia `casero` (chip, no aplicada), la guía 4:5, y avisos de clips/Cast/locaciones.
- Al generar: el plan sale con ~9 clips (no 8); las medidas viven en la ficha del producto; los clips con transición traen `transition_hint`.

> Este smoke lo corre el usuario (regla del repo: los tests automáticos no llaman a Gemini).

- [ ] **Step 3: Push**

```bash
git push origin development
```

---

## Self-Review

**Spec coverage:**
- §Ingesta router + contrato → Tasks 2, 3, 7 ✓
- §Reparto (ficha/estilo/guías/cast/locaciones/narrative) → Tasks 3 (parse), 6 (merge ficha+guías), 8 (UI) ✓
- §Físicas por la ficha sin tocar PRODUCTO INTOCABLE → Task 3 `mergeBriefOverrides` + Task 6; el matcher no se toca en re-descripción ✓
- §Transiciones = beats entrada/salida + transition_hint → Tasks 1, 5 ✓
- §Fixes de topes (chars/escenas/output) → Task 4 ✓
- §Estilo SUGERIDO no aplicado → Task 8 chip ✓
- §Pre-llenado editable + revisión + avisos → Task 8 ✓
- §Falla blanda → Task 7 ✓
- §Migración antes del push → Task 1 (MCP) + Task 9 orden ✓

**Placeholder scan:** el único stub (`factsToOverride` en Task 3) está marcado explícitamente para borrar con una nota; no quedan TODOs.

**Type consistency:** `IngestResult`, `IngestBriefOverrides`, `mergeBriefOverrides`, `parseIngestResult`, `transitionHint`, `transition_hint` usados con el mismo nombre entre tasks (2↔3↔6↔7↔8 y 1↔5). `visualStyle` en `IngestResult` es `VisualStyle | null` (enum sin `custom`), consistente con el chip de Task 8.
