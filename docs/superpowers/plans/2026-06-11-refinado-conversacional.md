# Refinado conversacional de creativos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar specs/v2/07-refinado-conversacional.md — conversación guiada en 4 etapas que produce un creativo de campaña completo, con format matcher compartido con el wizard y diccionario de tomas.

**Architecture:** Server actions stateless por turno (Gemini Flash con salida JSON validada por zod, patrón de `lib/campaigns/brief.ts`); la lógica pura vive en `lib/refine/` y `lib/prompt-director/format-matcher.ts` para testearse sin red; el estado de conversación vive en el cliente y solo se persiste/cobra al aceptar.

**Tech Stack:** Next.js 15 server actions, Gemini 2.5 Flash (fetch directo, sin SDK), zod, Supabase (migración aditiva), vitest con `vi.stubGlobal('fetch', …)`.

**Reglas del repo que aplican:** créditos solo vía funciones SQL atómicas (`charge_credits`/`refund_charge` ya existen desde 009); migraciones nuevas, nunca editar aplicadas; tests jamás llaman APIs reales; mensajes de error en códigos, UI en español; rama de trabajo: `feat/refinado-conversacional`.

---

## Task 1: Migración 030 + catálogo de tomas

**Files:**
- Create: `supabase/migrations/030_refine.sql`
- Create: `lib/shots/catalog.ts`
- Test: `lib/shots/catalog.test.ts`

- [ ] **Step 1: Escribir la migración**

```sql
-- 030_refine.sql
-- Refinado conversacional (specs/v2/07): la toma elegida y las referencias
-- del creativo quedan estructuradas en campaign_items (las plantillas vivas
-- y los compilers las consumen sin parsear el prompt). Pricing de la sesión
-- como operación interna (mismo mecanismo que prompt-enhance, 009).

alter table campaign_items
  add column if not exists shot text,
  add column if not exists reference_ids uuid[] not null default '{}';

insert into model_pricing (provider, model_id, variant, credits_cost, unit_size, unit_label) values
  ('internal', 'refine-session', 'default', 8, null, null)
on conflict (provider, model_id, variant) do nothing;
```

- [ ] **Step 2: Escribir el test del catálogo (falla: el módulo no existe)**

```ts
// lib/shots/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { SHOTS, shotBySlug } from './catalog';

const SYSTEM_FORMAT_SLUGS = [
  'voz-cercana', 'a-pie-de-calle', 'manos-a-la-obra', 'el-descubrimiento',
  'antes-y-despues', 'susurro', 'el-icono', 'gran-pantalla', 'mundo-imposible',
];

describe('catálogo de tomas', () => {
  it('tiene slugs únicos en kebab-case', () => {
    const slugs = SHOTS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('cada toma referencia solo formatos del sistema', () => {
    for (const shot of SHOTS) {
      for (const f of shot.formats) expect(SYSTEM_FORMAT_SLUGS).toContain(f);
    }
  });

  it('la imagen sigue la convención /shots/<slug>.jpg', () => {
    for (const shot of SHOTS) expect(shot.image).toBe(`/shots/${shot.slug}.jpg`);
  });

  it('shotBySlug resuelve y devuelve undefined para desconocidos', () => {
    expect(shotBySlug('close-up')?.name).toBeTruthy();
    expect(shotBySlug('no-existe')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `pnpm test lib/shots/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog'`

- [ ] **Step 4: Implementar el catálogo**

```ts
// lib/shots/catalog.ts
// Diccionario de tomas (specs/v2/07): catálogo estático consultado por la
// etapa "Toma" del refinado. Las imágenes se generan UNA vez con
// scripts/generate-shot-images.ts (API real, la corre el usuario) y quedan
// versionadas en public/shots/.

export type Shot = {
  slug: string;
  name: string;
  description: string;   // qué es, una línea
  whenToUse: string;     // cuándo conviene, una línea
  motion: boolean;       // toma con movimiento de cámara
  formats: string[];     // slugs de formatos del sistema afines
  image: string;         // /shots/<slug>.jpg
};

const shot = (s: Omit<Shot, 'image'>): Shot => ({ ...s, image: `/shots/${s.slug}.jpg` });

export const SHOTS: Shot[] = [
  shot({ slug: 'close-up', name: 'Primer plano', motion: false,
    description: 'El rostro o el producto llenan el cuadro.',
    whenToUse: 'Emoción de la persona o detalle clave del producto.',
    formats: ['voz-cercana', 'susurro', 'antes-y-despues'] }),
  shot({ slug: 'macro', name: 'Macro', motion: false,
    description: 'Detalle extremo: textura, gota, sello, costura.',
    whenToUse: 'Sensorialidad y calidad de materiales.',
    formats: ['susurro', 'el-descubrimiento', 'el-icono'] }),
  shot({ slug: 'plano-medio', name: 'Plano medio', motion: false,
    description: 'Persona de la cintura hacia arriba, producto en mano.',
    whenToUse: 'Testimonios y demostraciones con contexto.',
    formats: ['voz-cercana', 'a-pie-de-calle', 'manos-a-la-obra'] }),
  shot({ slug: 'selfie-handheld', name: 'Selfie en mano', motion: true,
    description: 'Cámara sostenida por la propia persona, leve temblor natural.',
    whenToUse: 'UGC creíble: cercanía e imperfección intencional.',
    formats: ['voz-cercana'] }),
  shot({ slug: 'cenital', name: 'Cenital', motion: false,
    description: 'Cámara perpendicular desde arriba.',
    whenToUse: 'Tutoriales con manos, flat-lays, preparaciones.',
    formats: ['manos-a-la-obra', 'el-descubrimiento'] }),
  shot({ slug: 'over-the-shoulder', name: 'Sobre el hombro', motion: false,
    description: 'Se mira la acción por encima del hombro de la persona.',
    whenToUse: 'Demostraciones en primera persona y unboxings.',
    formats: ['manos-a-la-obra', 'el-descubrimiento'] }),
  shot({ slug: 'contrapicado', name: 'Contrapicado', motion: false,
    description: 'Cámara baja mirando hacia arriba: el sujeto se agranda.',
    whenToUse: 'Producto héroe con presencia monumental.',
    formats: ['el-icono', 'gran-pantalla', 'mundo-imposible'] }),
  shot({ slug: 'plano-general', name: 'Plano general', motion: false,
    description: 'El entorno completo establece dónde ocurre la escena.',
    whenToUse: 'Apertura de narrativas y mundos imposibles.',
    formats: ['gran-pantalla', 'mundo-imposible', 'a-pie-de-calle'] }),
  shot({ slug: 'detalle-tactil', name: 'Detalle táctil', motion: false,
    description: 'Manos interactuando con el producto en primer plano.',
    whenToUse: 'Destapar, verter, aplicar: el gesto vende.',
    formats: ['susurro', 'el-descubrimiento', 'manos-a-la-obra'] }),
  shot({ slug: 'dolly-in', name: 'Dolly in', motion: true,
    description: 'La cámara avanza suavemente hacia el sujeto.',
    whenToUse: 'Crear intención y foco creciente en el producto.',
    formats: ['el-icono', 'gran-pantalla'] }),
  shot({ slug: 'orbita', name: 'Órbita', motion: true,
    description: 'La cámara gira alrededor del producto.',
    whenToUse: 'Mostrar el producto en 360 sin manos.',
    formats: ['el-icono'] }),
  shot({ slug: 'tracking', name: 'Seguimiento', motion: true,
    description: 'La cámara acompaña al sujeto en movimiento.',
    whenToUse: 'Energía documental: caminar y hablar.',
    formats: ['a-pie-de-calle', 'gran-pantalla'] }),
  shot({ slug: 'pull-back', name: 'Retroceso revelación', motion: true,
    description: 'La cámara se aleja y revela el contexto completo.',
    whenToUse: 'Cierres con revelación o escala imposible.',
    formats: ['mundo-imposible', 'gran-pantalla'] }),
  shot({ slug: 'speed-ramp', name: 'Speed ramp', motion: true,
    description: 'Aceleración y frenado del tiempo dentro de la toma.',
    whenToUse: 'Producto kinético: splash, caída, montaje rítmico.',
    formats: ['el-icono'] }),
];

export function shotBySlug(slug: string): Shot | undefined {
  return SHOTS.find((s) => s.slug === slug);
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm test lib/shots/catalog.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/030_refine.sql lib/shots/
git commit -m "feat(refine): migracion 030 y catalogo de tomas"
```

---

## Task 2: Script de generación de imágenes del diccionario

**Files:**
- Create: `scripts/generate-shot-images.mjs`

Nota: lo corre el usuario con API real (`FLUX` vía el adapter existente). Los tests NUNCA lo ejecutan. Las imágenes que produce se versionan en `public/shots/`.

- [ ] **Step 1: Escribir el script**

```js
// scripts/generate-shot-images.mjs
// Genera las imágenes del diccionario de tomas UNA vez con FLUX.
// Uso: node --env-file=.env.local scripts/generate-shot-images.mjs [slug]
// Sin argumento genera las faltantes; con slug regenera esa toma.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const { generate } = await import('../lib/providers/flux.ts');
const { SHOTS } = await import('../lib/shots/catalog.ts');

const OUT = join(process.cwd(), 'public', 'shots');
await mkdir(OUT, { recursive: true });

// Mismo sujeto neutro en todas para que la VARIABLE sea la toma.
const SUBJECT = 'a matte ceramic skincare jar on a warm neutral studio set';
const PROMPTS = {
  'close-up': `tight close-up of ${SUBJECT}, shallow depth of field`,
  'macro': `extreme macro of the jar lid texture, ${SUBJECT}`,
  'plano-medio': `medium shot, person holding ${SUBJECT} at chest height, face visible`,
  'selfie-handheld': `handheld selfie angle, person showing ${SUBJECT} to camera, slight motion blur`,
  'cenital': `top-down overhead shot, hands arranging ${SUBJECT} on a table`,
  'over-the-shoulder': `over-the-shoulder shot, hands opening ${SUBJECT}`,
  'contrapicado': `dramatic low-angle shot of ${SUBJECT}, monumental presence`,
  'plano-general': `wide establishing shot, ${SUBJECT} on a table in a sunlit room`,
  'detalle-tactil': `close-up of fingertips touching the open jar, ${SUBJECT}`,
  'dolly-in': `cinematic frame mid dolly-in towards ${SUBJECT}, motion trail hint`,
  'orbita': `frame from an orbiting camera path around ${SUBJECT}`,
  'tracking': `tracking shot frame, person walking with ${SUBJECT}, urban background`,
  'pull-back': `frame mid pull-back revealing the full room around ${SUBJECT}`,
  'speed-ramp': `high-energy frame, ${SUBJECT} splashing into water, frozen droplets`,
};

const only = process.argv[2];
for (const shot of SHOTS) {
  if (only && shot.slug !== only) continue;
  const file = join(OUT, `${shot.slug}.jpg`);
  if (!only) {
    try { await access(file); console.log(`ya existe: ${shot.slug}`); continue; } catch {}
  }
  const prompt = PROMPTS[shot.slug];
  if (!prompt) { console.error(`sin prompt para ${shot.slug}`); continue; }
  console.log(`generando ${shot.slug}…`);
  const result = await generate({ prompt, width: 768, height: 512, photoreal: true });
  await writeFile(file, result.buffer);
  console.log(`ok → public/shots/${shot.slug}.jpg`);
}
```

- [ ] **Step 2: Verificar que compila sin ejecutarlo**

Run: `pnpm typecheck && pnpm lint`
Expected: ambos PASS (el script es .mjs, lint lo ignora o pasa; typecheck no lo incluye)

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-shot-images.mjs
git commit -m "feat(refine): script unico de imagenes del diccionario de tomas"
```

**Para el usuario (no el agente):** correr `node --env-file=.env.local scripts/generate-shot-images.mjs` y commitear `public/shots/*.jpg`. La UI muestra placeholder si falta la imagen.

---

## Task 3: Format matcher (compartido wizard + refinado)

**Files:**
- Create: `lib/prompt-director/format-matcher.ts`
- Test: `lib/prompt-director/format-matcher.test.ts`

- [ ] **Step 1: Escribir el test (falla)**

```ts
// lib/prompt-director/format-matcher.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchIdeas, type MatcherFormat } from './format-matcher';

const FORMATS: MatcherFormat[] = [
  { id: 'f1', slug: 'el-descubrimiento', name: 'El Descubrimiento', description: 'Unboxing / revelación' },
  { id: 'f2', slug: 'voz-cercana', name: 'Voz Cercana', description: 'Testimonio de creador' },
];

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('matchIdeas', () => {
  it('mapea una idea a un formato existente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing del producto', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing del producto', formats: FORMATS });
    expect(res.matches).toHaveLength(1);
    expect(res.matches[0].formatId).toBe('f1');
    expect(res.matches[0].customFormat).toBeNull();
  });

  it('propone formato custom cuando no encaja', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'mi perro usa el producto',
        formatId: null,
        customFormat: {
          slug: 'mascota-protagonista', name: 'Mascota protagonista',
          description: 'El producto en la vida de una mascota',
          register: 'casero y tierno', cameraStyle: 'handheld a ras de suelo',
          pacing: 'pausado', requiredRefs: ['product'],
          defaultDurationS: 8, defaultAudio: true,
        },
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'mi perro usa el producto', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull();
    expect(res.matches[0].customFormat?.slug).toBe('mascota-protagonista');
  });

  it('rechaza JSON que no cumple el schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ matches: [{ bogus: true }] })));
    process.env.GEMINI_API_KEY = 'test';
    await expect(matchIdeas({ ideasText: 'algo', formats: FORMATS })).rejects.toThrow();
  });

  it('descarta formatId que no existe en la lista', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'x', formatId: 'inventado', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'x', formats: FORMATS });
    expect(res.matches[0].formatId).toBeNull(); // saneado a custom pendiente o null
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `pnpm test lib/prompt-director/format-matcher.test.ts`
Expected: FAIL — `Cannot find module './format-matcher'`

- [ ] **Step 3: Implementar el matcher**

```ts
// lib/prompt-director/format-matcher.ts
// Format matcher (specs/v2/07): texto libre del usuario → formato existente
// o propuesta de formato custom. Lo consumen el wizard (sembrar el plan) y
// el refinado (cuando la conversación se sale del catálogo).
// Patrón Gemini: fetch directo + responseMimeType JSON (como lib/campaigns/brief.ts).

import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

export type MatcherFormat = { id: string; slug: string; name: string; description: string | null };

export const CustomFormatSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  register: z.string().max(200),
  cameraStyle: z.string().max(200),
  pacing: z.string().max(120),
  requiredRefs: z.array(z.enum(['product', 'character', 'packaging'])).max(3),
  defaultDurationS: z.number().int().min(4).max(15),
  defaultAudio: z.boolean(),
});
export type CustomFormat = z.infer<typeof CustomFormatSchema>;

const MatchSchema = z.object({
  ideaText: z.string().min(1).max(500),
  formatId: z.string().nullable(),
  customFormat: CustomFormatSchema.nullable(),
});
const MatcherReplySchema = z.object({ matches: z.array(MatchSchema).max(8) });
export type MatcherResult = z.infer<typeof MatcherReplySchema>;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

const SYSTEM = `Eres director creativo de una plataforma de anuncios con IA.
Recibes ideas de campaña en lenguaje natural y un catálogo de formatos.
Por cada idea distinta devuelve un match:
- Si encaja en un formato del catálogo: formatId con su id exacto y customFormat null.
- Si NO encaja: formatId null y customFormat con registro, estilo de cámara y
  ritmo inferidos de la idea. slug en kebab-case, nombres en español.
Nunca inventes atributos del producto. Devuelve SOLO el JSON:
{"matches":[{"ideaText":"...","formatId":"...|null","customFormat":{...}|null}]}`;

export async function matchIdeas(input: {
  ideasText: string;
  formats: MatcherFormat[];
}): Promise<MatcherResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const catalog = input.formats
    .map((f) => `- id=${f.id} slug=${f.slug} "${f.name}": ${f.description ?? ''}`)
    .join('\n');

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{
        role: 'user',
        parts: [{ text: `Catálogo:\n${catalog}\n\nIdeas del usuario:\n${input.ideasText.slice(0, 2000)}` }],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini matcher ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en matcher', 'unknown', false);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en matcher', 'unknown', false);
  }
  const parsed = MatcherReplySchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`Matcher no cumple el schema: ${parsed.error.message.slice(0, 200)}`, 'unknown', false);
  }

  // Saneo: formatId debe existir en el catálogo recibido; si no, null.
  const known = new Set(input.formats.map((f) => f.id));
  return {
    matches: parsed.data.matches.map((m) => ({
      ...m,
      formatId: m.formatId && known.has(m.formatId) ? m.formatId : null,
    })),
  };
}
```

- [ ] **Step 4: Correr y ver verde**

Run: `pnpm test lib/prompt-director/format-matcher.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(refine): format matcher compartido con saneo de ids"
```

---

## Task 4: lib/refine — tipos, máquina de etapas y cliente Gemini

**Files:**
- Create: `lib/refine/types.ts`
- Create: `lib/refine/turn.ts`
- Create: `lib/refine/gemini.ts`
- Test: `lib/refine/turn.test.ts`
- Test: `lib/refine/gemini.test.ts`

- [ ] **Step 1: Tipos del dominio**

```ts
// lib/refine/types.ts
// Contrato del refinado conversacional (specs/v2/07). El borrador (draft)
// vive en el cliente durante la conversación y solo se persiste al aceptar.
import { z } from 'zod';
import { CustomFormatSchema } from '@/lib/prompt-director/format-matcher';

export const STAGES = ['what', 'shot', 'refs', 'review'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  what: 'Qué mostrar',
  shot: 'Toma',
  refs: 'Referencias',
  review: 'Revisión',
};

export const MAX_TURNS = 10;

export const RefineDraftSchema = z.object({
  formatId: z.string().uuid().nullable(),
  customFormat: CustomFormatSchema.nullable(),
  scene: z.string().max(120).nullable(),
  scenePrompt: z.string().max(2000),
  shot: z.string().max(60).nullable(),
  characterId: z.string().uuid().nullable(),
  referenceIds: z.array(z.string().uuid()).max(9),
  durationS: z.number().int().min(4).max(15).nullable(),
  aspectRatio: z.string().max(8).nullable(),
  caption: z.string().max(300).nullable(),
});
export type RefineDraft = z.infer<typeof RefineDraftSchema>;

export const emptyDraft = (formatId: string | null): RefineDraft => ({
  formatId, customFormat: null, scene: null, scenePrompt: '', shot: null,
  characterId: null, referenceIds: [], durationS: null, aspectRatio: null, caption: null,
});

export const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(4000),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

// Lo que Gemini devuelve por turno (validado con zod, nunca confiado).
export const TurnReplySchema = z.object({
  reply: z.string().min(1).max(2000),
  stage: z.enum(STAGES),
  chips: z.array(z.string().max(80)).max(4),
  draftPatch: RefineDraftSchema.partial(),
});
export type TurnReply = z.infer<typeof TurnReplySchema>;
```

- [ ] **Step 2: Test de la lógica pura (falla)**

```ts
// lib/refine/turn.test.ts
import { describe, expect, it } from 'vitest';
import { applyDraftPatch, clampStage, validateDraft } from './turn';
import { emptyDraft, type Stage } from './types';

const FORMAT = {
  slug: 'voz-cercana', name: 'Voz Cercana', register: 'conversacional',
  cameraStyle: 'selfie handheld', pacing: 'natural',
  requiredRefs: ['product', 'character'] as Array<'product' | 'character' | 'packaging'>,
  defaultDurationS: 8, defaultAudio: true,
};

describe('applyDraftPatch', () => {
  it('mezcla solo claves del draft y conserva el resto', () => {
    const d = emptyDraft('11111111-1111-4111-8111-111111111111');
    const out = applyDraftPatch(d, { scenePrompt: 'la persona destapa el frasco', shot: 'close-up' });
    expect(out.scenePrompt).toBe('la persona destapa el frasco');
    expect(out.shot).toBe('close-up');
    expect(out.formatId).toBe(d.formatId);
  });

  it('ignora un shot que no existe en el catálogo', () => {
    const out = applyDraftPatch(emptyDraft(null), { shot: 'toma-inventada' });
    expect(out.shot).toBeNull();
  });
});

describe('clampStage', () => {
  it('nunca retrocede de etapa', () => {
    expect(clampStage('refs' as Stage, 'what' as Stage, 3)).toBe('refs');
  });
  it('fuerza review al llegar al tope de turnos', () => {
    expect(clampStage('what' as Stage, 'shot' as Stage, 10)).toBe('review');
  });
});

describe('validateDraft', () => {
  it('marca error si falta la escena', () => {
    const res = validateDraft(emptyDraft(null), { format: FORMAT, hasCharacter: false });
    expect(res.errors.length).toBeGreaterThan(0);
  });
  it('advierte cuando el formato exige referencias y no hay', () => {
    const d = { ...emptyDraft(null), scenePrompt: 'persona muestra el producto y sonríe' };
    const res = validateDraft(d, { format: FORMAT, hasCharacter: false });
    expect(res.warnings.join(' ')).toMatch(/referencia/i);
  });
});
```

- [ ] **Step 3: Correr y ver el fallo**

Run: `pnpm test lib/refine/turn.test.ts`
Expected: FAIL — `Cannot find module './turn'`

- [ ] **Step 4: Implementar la lógica pura**

```ts
// lib/refine/turn.ts
// Lógica pura del refinado: aplicar parches, clamp de etapas y validación.
// Sin red ni Supabase — testeable en frío. La acción server es un wrapper.
import { shotBySlug } from '@/lib/shots/catalog';
import { validate } from '@/lib/prompt-director/validators';
import type { FormatDirection } from '@/lib/prompt-director/types';
import { MAX_TURNS, STAGES, type RefineDraft, type Stage } from './types';

export function applyDraftPatch(draft: RefineDraft, patch: Partial<RefineDraft>): RefineDraft {
  const next = { ...draft, ...patch };
  // El shot debe existir en el catálogo; si Gemini alucina un slug, se ignora.
  if (patch.shot !== undefined && patch.shot !== null && !shotBySlug(patch.shot)) {
    next.shot = draft.shot;
  }
  return next;
}

// La etapa solo avanza; al tope de turnos se fuerza la revisión.
export function clampStage(current: Stage, proposed: Stage, userTurns: number): Stage {
  if (userTurns >= MAX_TURNS) return 'review';
  return STAGES.indexOf(proposed) >= STAGES.indexOf(current) ? proposed : current;
}

export function validateDraft(
  draft: RefineDraft,
  ctx: { format: FormatDirection | null; hasCharacter: boolean },
): { errors: string[]; warnings: string[] } {
  const base = validate(
    { modelSlug: 'seedance-2.0', scenePrompt: draft.scenePrompt, durationS: draft.durationS ?? undefined },
    { format: ctx.format ?? undefined, scene: draft.scene ? { name: draft.scene, fragment: draft.scenePrompt } : undefined },
  );
  const warnings = [...base.warnings];
  const required = ctx.format?.requiredRefs ?? [];
  if (required.includes('product') && draft.referenceIds.length === 0) {
    warnings.push('Sin referencia del producto, la fidelidad puede variar entre tomas.');
  }
  if (required.includes('character') && !draft.characterId) {
    warnings.push('Este formato lleva presentador: sin persona del Cast, la identidad cambia en cada generación.');
  }
  return { errors: base.errors, warnings };
}
```

- [ ] **Step 5: Correr y ver verde**

Run: `pnpm test lib/refine/turn.test.ts`
Expected: PASS

- [ ] **Step 6: Test del cliente Gemini (falla)**

```ts
// lib/refine/gemini.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestRefineTurn } from './gemini';

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('requestRefineTurn', () => {
  it('devuelve un TurnReply validado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      reply: '¿Qué momento quieres mostrar?', stage: 'what',
      chips: ['El problema', 'Cómo se usa'], draftPatch: {},
    })));
    process.env.GEMINI_API_KEY = 'test';
    const out = await requestRefineTurn({ system: 'sys', history: [{ role: 'user', text: 'hola' }] });
    expect(out.stage).toBe('what');
    expect(out.chips).toHaveLength(2);
  });

  it('lanza si el JSON no cumple el contrato', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({ reply: 'x', stage: 'volando' })));
    process.env.GEMINI_API_KEY = 'test';
    await expect(requestRefineTurn({ system: 's', history: [] })).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Implementar el cliente**

```ts
// lib/refine/gemini.ts
// Turno de conversación contra Gemini Flash. Patrón de lib/campaigns/brief.ts:
// fetch directo, responseMimeType JSON, zod siempre. Una llamada por turno,
// segundos de latencia → server action directa, sin cola.
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { TurnReplySchema, type ChatTurn, type TurnReply } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

export async function requestRefineTurn(input: {
  system: string;
  history: ChatTurn[];
}): Promise<TurnReply> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: input.history.map((t) => ({
        role: t.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: t.text }],
      })),
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini refine ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }
  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en refine', 'unknown', false);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
  let json: unknown;
  try { json = JSON.parse(raw); } catch {
    throw new ProviderError('Gemini devolvió JSON inválido en refine', 'unknown', false);
  }
  const parsed = TurnReplySchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`Turno no cumple el contrato: ${parsed.error.message.slice(0, 200)}`, 'unknown', false);
  }
  return parsed.data;
}
```

- [ ] **Step 8: Correr ambos tests y commit**

Run: `pnpm test lib/refine`
Expected: PASS (turn + gemini)

```bash
git add lib/refine/
git commit -m "feat(refine): tipos, maquina de etapas y cliente Gemini del turno"
```

---

## Task 5: Server actions de refine

**Files:**
- Create: `lib/schemas/refine.ts`
- Create: `server-actions/refine.ts`

Las actions son wrappers delgados: la lógica testeable ya vive en `lib/refine/`. Siguen el patrón de `server-actions/prompt-enhancer.ts` (cargo atómico) y la rule 20 (zod + ownership + códigos de error).

- [ ] **Step 1: Schemas de entrada**

```ts
// lib/schemas/refine.ts
import { z } from 'zod';
import { ChatTurnSchema, RefineDraftSchema } from '@/lib/refine/types';

export const RefineTurnInputSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().uuid().nullable(), // null = creativo nuevo
  history: z.array(ChatTurnSchema).max(21), // ≤10 turnos de usuario + respuestas
  draft: RefineDraftSchema,
  stage: z.enum(['what', 'shot', 'refs', 'review']), // etapa actual del cliente: el clamp evita retroceder
  userMessage: z.string().trim().min(1).max(2000),
});

export const AcceptRefineInputSchema = z.object({
  campaignId: z.string().uuid(),
  itemId: z.string().uuid().nullable(),
  draft: RefineDraftSchema,
  acceptedWarnings: z.array(z.string().max(300)).max(12),
});
```

- [ ] **Step 2: Implementar las actions**

```ts
// server-actions/refine.ts
'use server';

import 'server-only';
import { revalidatePath } from 'next/cache';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { chargeCredits, refundCharge } from '@/lib/credits/operations';
import { loadPricing } from '@/lib/credits/pricing';
import { requestRefineTurn } from '@/lib/refine/gemini';
import { applyDraftPatch, clampStage, validateDraft } from '@/lib/refine/turn';
import { MAX_TURNS, STAGE_LABEL, type RefineDraft, type Stage } from '@/lib/refine/types';
import { SHOTS } from '@/lib/shots/catalog';
import { AcceptRefineInputSchema, RefineTurnInputSchema } from '@/lib/schemas/refine';
import type { FormatDirection } from '@/lib/prompt-director/types';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

const REFINE_FALLBACK_COST = 8;

async function loadRefineCost(): Promise<number> {
  const pricing = await loadPricing();
  const row = pricing.find((p) => p.provider === 'internal' && p.model_id === 'refine-session');
  return row?.credits_cost ?? REFINE_FALLBACK_COST;
}

// Contexto server-side del turno: formato, brief, Cast. El cliente nunca
// dicta el contexto — solo su historial y su borrador.
async function loadContext(campaignId: string, draft: RefineDraft) {
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, workspace_id, product_brief, language, brand_kit_id')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) return null;

  let format: FormatDirection | null = null;
  if (draft.formatId) {
    const { data: f } = await supabase
      .from('formats')
      .select('slug, name, register, camera_style, pacing, required_refs, default_duration_s, default_audio')
      .eq('id', draft.formatId)
      .single();
    if (f) {
      format = {
        slug: f.slug as string, name: f.name as string,
        register: (f.register as string) ?? '', cameraStyle: (f.camera_style as string) ?? '',
        pacing: (f.pacing as string) ?? '',
        requiredRefs: ((f.required_refs as string[]) ?? []) as FormatDirection['requiredRefs'],
        defaultDurationS: (f.default_duration_s as number) ?? 8,
        defaultAudio: (f.default_audio as boolean) ?? true,
      };
    }
  } else if (draft.customFormat) {
    format = {
      slug: draft.customFormat.slug, name: draft.customFormat.name,
      register: draft.customFormat.register, cameraStyle: draft.customFormat.cameraStyle,
      pacing: draft.customFormat.pacing, requiredRefs: draft.customFormat.requiredRefs,
      defaultDurationS: draft.customFormat.defaultDurationS,
      defaultAudio: draft.customFormat.defaultAudio,
    };
  }

  const { data: characters } = await supabase
    .from('characters')
    .select('id, name')
    .eq('workspace_id', workspace.id);

  return { workspace, supabase, campaign, format, characters: characters ?? [] };
}

function buildSystemPrompt(args: {
  format: FormatDirection | null;
  productName: string;
  stage: Stage;
  characters: Array<{ id: string; name: string }>;
}): string {
  const shots = SHOTS.map((s) => `- ${s.slug}: ${s.name} (${s.whenToUse})`).join('\n');
  const cast = args.characters.map((c) => `- id=${c.id} ${c.name}`).join('\n') || '(vacío)';
  return `Eres director creativo senior guiando a un usuario SIN experiencia para
definir un creativo de video publicitario. Producto: "${args.productName}".
Formato: ${args.format ? `${args.format.name} — registro ${args.format.register}, cámara ${args.format.cameraStyle}` : 'aún sin formato'}.
Etapa actual: ${args.stage} (${STAGE_LABEL[args.stage]}). Etapas: what → shot → refs → review.

Reglas duras:
- UNA pregunta por turno, en español, máximo 2 frases. Máximo 2-3 aclaraciones por etapa, luego avanza.
- chips: 2-4 respuestas sugeridas cortas y clicables.
- draftPatch: actualiza el borrador con lo que el usuario ya decidió
  (scenePrompt en inglés cinematográfico, una acción y un movimiento de cámara).
- En etapa shot propone slugs SOLO de este catálogo:\n${shots}
- En etapa refs, characterId solo de este Cast:\n${cast}
- Nunca inventes atributos del producto ni claims.
Devuelve SOLO JSON: {"reply":"...","stage":"what|shot|refs|review","chips":[...],"draftPatch":{...}}`;
}

export async function refineItemTurnAction(input: unknown): Promise<
  Result<{
    reply: string; stage: Stage; chips: string[];
    draft: RefineDraft; validation: { errors: string[]; warnings: string[] };
  }>
> {
  const parsed = RefineTurnInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };

  const ctx = await loadContext(parsed.data.campaignId, parsed.data.draft);
  if (!ctx) return { ok: false, error: 'not_found' };

  const brief = (ctx.campaign.product_brief ?? {}) as { productName?: string };
  const userTurns = parsed.data.history.filter((t) => t.role === 'user').length + 1;
  const currentStage: Stage = userTurns >= MAX_TURNS ? 'review' : parsed.data.stage;

  try {
    const turn = await requestRefineTurn({
      system: buildSystemPrompt({
        format: ctx.format,
        productName: brief.productName ?? 'el producto',
        stage: currentStage,
        characters: ctx.characters,
      }),
      history: [...parsed.data.history, { role: 'user', text: parsed.data.userMessage }],
    });
    const draft = applyDraftPatch(parsed.data.draft, turn.draftPatch);
    const stage = clampStage(currentStage, turn.stage, userTurns);
    const validation = validateDraft(draft, {
      format: ctx.format,
      hasCharacter: Boolean(draft.characterId),
    });
    return { ok: true, data: { reply: turn.reply, stage, chips: turn.chips, draft, validation } };
  } catch (e) {
    return { ok: false, error: 'provider_error', message: (e as Error).message };
  }
}

export async function acceptRefinedItemAction(input: unknown): Promise<Result<{ itemId: string }>> {
  const parsed = AcceptRefineInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };

  const ctx = await loadContext(parsed.data.campaignId, parsed.data.draft);
  if (!ctx) return { ok: false, error: 'not_found' };
  const { workspace, supabase } = ctx;
  const { user } = await requireWorkspace();

  // Re-validación dura server-side: el cliente puede mentir.
  const validation = validateDraft(parsed.data.draft, {
    format: ctx.format,
    hasCharacter: Boolean(parsed.data.draft.characterId),
  });
  if (validation.errors.length > 0) {
    return { ok: false, error: 'validation_error', message: validation.errors[0] };
  }
  if (!parsed.data.draft.scenePrompt.trim()) {
    return { ok: false, error: 'validation_error', message: 'El creativo no tiene escena' };
  }

  // Si el item existe, debe seguir editable.
  if (parsed.data.itemId) {
    const { data: item } = await supabase
      .from('campaign_items')
      .select('id, status, campaign_id')
      .eq('id', parsed.data.itemId)
      .eq('campaign_id', parsed.data.campaignId)
      .single();
    if (!item) return { ok: false, error: 'not_found' };
    if (!['planned', 'skipped', 'failed'].includes(item.status as string)) {
      return { ok: false, error: 'forbidden', message: 'El creativo ya está en producción' };
    }
  }

  // Formato custom: nace aquí, del workspace, visible en /app/formats.
  let formatId = parsed.data.draft.formatId;
  if (!formatId && parsed.data.draft.customFormat) {
    const cf = parsed.data.draft.customFormat;
    const { data: created, error } = await supabase
      .from('formats')
      .insert({
        slug: cf.slug, name: cf.name, description: cf.description,
        register: cf.register, camera_style: cf.cameraStyle, pacing: cf.pacing,
        required_refs: cf.requiredRefs, default_duration_s: cf.defaultDurationS,
        default_audio: cf.defaultAudio, is_system: false, workspace_id: workspace.id,
      })
      .select('id')
      .single();
    if (error && error.code !== '23505') return { ok: false, error: 'internal_error', message: error.message };
    if (created) formatId = created.id as string;
    else {
      const { data: existing } = await supabase
        .from('formats').select('id').eq('slug', cf.slug).eq('workspace_id', workspace.id).single();
      formatId = (existing?.id as string) ?? null;
    }
    if (formatId) revalidatePath('/app/formats');
  }
  if (!formatId) return { ok: false, error: 'validation_error', message: 'El creativo no tiene formato' };

  // Cobro atómico de la sesión: una sola vez, al aceptar.
  const cost = await loadRefineCost();
  const charged = await chargeCredits(user.id, cost, 'refine_session', {
    campaign_id: parsed.data.campaignId,
  });
  if (!charged) return { ok: false, error: 'insufficient_credits' };

  const row = {
    format_id: formatId,
    scene: parsed.data.draft.scene,
    scene_prompt: parsed.data.draft.scenePrompt.trim(),
    shot: parsed.data.draft.shot,
    character_id: parsed.data.draft.characterId,
    reference_ids: parsed.data.draft.referenceIds,
    caption: parsed.data.draft.caption,
    duration_s: parsed.data.draft.durationS ?? ctx.format?.defaultDurationS ?? 8,
    aspect_ratio: parsed.data.draft.aspectRatio ?? '9:16',
    warnings: validation.warnings,
    status: 'planned' as const,
  };

  const persisted = parsed.data.itemId
    ? await supabase.from('campaign_items').update(row).eq('id', parsed.data.itemId).select('id').single()
    : await supabase
        .from('campaign_items')
        .insert({ ...row, campaign_id: parsed.data.campaignId, model_slug: 'seedance-2.0' })
        .select('id')
        .single();

  if (persisted.error || !persisted.data) {
    await refundCharge(user.id, cost, 'refine_session_refund', {
      campaign_id: parsed.data.campaignId,
    }).catch(() => {});
    return { ok: false, error: 'internal_error', message: persisted.error?.message };
  }

  revalidatePath(`/app/campaigns/${parsed.data.campaignId}`);
  return { ok: true, data: { itemId: persisted.data.id as string } };
}
```

- [ ] **Step 3: Verificar que compila y nada se rompió**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck PASS; suite completa PASS (las actions no tienen test directo — su lógica está testeada en lib/refine)

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/refine.ts server-actions/refine.ts
git commit -m "feat(refine): actions de turno y aceptacion con cobro atomico"
```

---

## Task 6: Página de refinado + integración con el plan

**Files:**
- Create: `components/refine/RefineView.tsx`
- Create: `app/app/campaigns/[id]/refine/[itemId]/page.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx` (botón "Refinar"; retirar AddItemDialog)

La ruta usa `[itemId]` con el literal `new` para creativo nuevo (una sola page, sin duplicar loader).

- [ ] **Step 1: Loader server de la página**

```tsx
// app/app/campaigns/[id]/refine/[itemId]/page.tsx
import { redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { RefineView } from '@/components/refine/RefineView';
import { emptyDraft, type RefineDraft } from '@/lib/refine/types';

export const dynamic = 'force-dynamic';

export default async function RefineRoute({
  params,
}: {
  params: Promise<{ id: string; itemId: string }>;
}) {
  const { id, itemId } = await params;
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, product_brief')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .single();
  if (!campaign) redirect('/app/campaigns');

  const { data: formats } = await supabase
    .from('formats')
    .select('id, name')
    .or(`is_system.eq.true,workspace_id.eq.${workspace.id}`);

  let draft: RefineDraft = emptyDraft(null);
  if (itemId !== 'new') {
    const { data: item } = await supabase
      .from('campaign_items')
      .select('id, status, format_id, scene, scene_prompt, shot, character_id, reference_ids, duration_s, aspect_ratio, caption')
      .eq('id', itemId)
      .eq('campaign_id', id)
      .single();
    if (!item || !['planned', 'skipped', 'failed'].includes(item.status as string)) {
      redirect(`/app/campaigns/${id}`);
    }
    draft = {
      formatId: (item.format_id as string | null) ?? null,
      customFormat: null,
      scene: (item.scene as string | null) ?? null,
      scenePrompt: (item.scene_prompt as string) ?? '',
      shot: (item.shot as string | null) ?? null,
      characterId: (item.character_id as string | null) ?? null,
      referenceIds: ((item.reference_ids as string[]) ?? []),
      durationS: (item.duration_s as number | null) ?? null,
      aspectRatio: (item.aspect_ratio as string | null) ?? null,
      caption: (item.caption as string | null) ?? null,
    };
  }

  const brief = (campaign.product_brief ?? {}) as { productName?: string };
  return (
    <RefineView
      campaignId={id}
      campaignName={campaign.name as string}
      productName={brief.productName ?? 'tu producto'}
      itemId={itemId === 'new' ? null : itemId}
      initialDraft={draft}
      formatNames={Object.fromEntries((formats ?? []).map((f) => [f.id as string, f.name as string]))}
    />
  );
}
```

- [ ] **Step 2: El componente RefineView (cliente)**

```tsx
// components/refine/RefineView.tsx
'use client';

// Página del refinado conversacional (specs/v2/07): chat con etapas a la
// izquierda, el creativo armándose en vivo a la derecha. El estado de la
// conversación vive aquí; nada se persiste ni cobra hasta "Aceptar".
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { acceptRefinedItemAction, refineItemTurnAction } from '@/server-actions/refine';
import { STAGES, STAGE_LABEL, type ChatTurn, type RefineDraft, type Stage } from '@/lib/refine/types';
import { SHOTS, shotBySlug } from '@/lib/shots/catalog';
import { insufficientCreditsToast } from '@/components/campaigns/credits-toast';
import {
  ReferenceImagesUploader,
  type RefImage,
} from '@/components/shared/ReferenceImagesUploader';

const GREETING =
  'Cuéntame qué quieres mostrar en este creativo. Puedes describirlo en tus palabras: yo me encargo de convertirlo en una buena dirección.';

export function RefineView({
  campaignId, campaignName, productName, itemId, initialDraft, formatNames,
}: {
  campaignId: string;
  campaignName: string;
  productName: string;
  itemId: string | null;
  initialDraft: RefineDraft;
  formatNames: Record<string, string>;
}) {
  const router = useRouter();
  const [history, setHistory] = useState<ChatTurn[]>([{ role: 'assistant', text: GREETING }]);
  const [draft, setDraft] = useState(initialDraft);
  const [stage, setStage] = useState<Stage>('what');
  const [chips, setChips] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [showDictionary, setShowDictionary] = useState(false);
  const [refImages, setRefImages] = useState<RefImage[]>([]);

  async function sendTurn(text: string) {
    if (!text.trim() || pending) return;
    setPending(true);
    setFailedMessage(null);
    const res = await refineItemTurnAction({
      campaignId, itemId, history, draft, stage, userMessage: text.trim(),
    });
    setPending(false);
    if (!res.ok) {
      // El historial no se pierde: el turno fallido se puede reintentar.
      setFailedMessage(text.trim());
      toast.error('No se pudo procesar el turno. Reintenta.');
      return;
    }
    setHistory((h) => [...h, { role: 'user', text: text.trim() }, { role: 'assistant', text: res.data.reply }]);
    setDraft(res.data.draft);
    setStage(res.data.stage);
    setChips(res.data.chips);
    setWarnings(res.data.validation.warnings);
    setErrors(res.data.validation.errors);
    setMessage('');
  }

  async function handleAccept() {
    setAccepting(true);
    const res = await acceptRefinedItemAction({
      campaignId, itemId, draft, acceptedWarnings: warnings,
    });
    setAccepting(false);
    if (!res.ok) {
      if (res.error === 'insufficient_credits') insufficientCreditsToast();
      else toast.error(res.message ?? 'No se pudo guardar el creativo');
      return;
    }
    toast.success('Creativo guardado en el plan');
    router.push(`/app/campaigns/${campaignId}`);
  }

  const formatLabel = draft.formatId
    ? (formatNames[draft.formatId] ?? 'Formato')
    : draft.customFormat?.name ?? 'Formato por definir';
  const shot = draft.shot ? shotBySlug(draft.shot) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/app/campaigns/${campaignId}`}
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {campaignName}
        </Link>
        <p className="text-[12px] text-muted-foreground">
          Refinar creativo · {formatLabel} · el costo de la sesión se cobra solo al aceptar
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Chat */}
        <section className="flex min-h-[60dvh] flex-col rounded-xl border border-border bg-card/50">
          <nav aria-label="Etapas del refinado" className="flex gap-3 border-b border-border/60 px-4 py-2.5 text-[11.5px]">
            {STAGES.map((s) => (
              <span
                key={s}
                aria-current={s === stage ? 'step' : undefined}
                className={cn(
                  s === stage ? 'font-medium text-primary'
                    : STAGES.indexOf(s) < STAGES.indexOf(stage) ? 'text-foreground/70'
                    : 'text-muted-foreground/50',
                )}
              >
                {STAGE_LABEL[s]}
              </span>
            ))}
          </nav>

          <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {history.map((t, i) => (
              <div key={i} className={cn('max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed', t.role === 'assistant' ? 'bg-muted/40 text-foreground' : 'ml-auto bg-primary/10 text-foreground')}>
                {t.text}
              </div>
            ))}
            {pending && (
              <div className="inline-flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Pensando…
              </div>
            )}
            {failedMessage && (
              <button
                type="button"
                onClick={() => sendTurn(failedMessage)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 px-3 py-2 text-[12.5px] text-amber-300 hover:bg-amber-400/10"
              >
                <RotateCcw className="size-3.5" aria-hidden /> Reintentar el último mensaje
              </button>
            )}
          </div>

          {chips.length > 0 && !pending && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {chips.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => sendTurn(c)}
                  className="rounded-full border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          {stage === 'shot' && (
            <div className="px-4 pb-2">
              <button
                type="button"
                onClick={() => setShowDictionary((v) => !v)}
                className="text-[11.5px] text-primary underline-offset-2 hover:underline"
              >
                {showDictionary ? 'Ocultar diccionario de tomas' : 'Ver todas las tomas'}
              </button>
              {showDictionary && (
                <div className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {SHOTS.map((s) => (
                    <button
                      key={s.slug}
                      type="button"
                      onClick={() => sendTurn(`Quiero la toma ${s.name} (${s.slug})`)}
                      className={cn('rounded-lg border p-2 text-left transition-colors', draft.shot === s.slug ? 'border-primary/60 bg-primary/5' : 'border-border hover:border-muted-foreground/30')}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.image} alt={s.name} loading="lazy" className="mb-1.5 aspect-[3/2] w-full rounded object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      <p className="text-[12px] font-medium text-foreground">{s.name}</p>
                      <p className="text-[10.5px] leading-snug text-muted-foreground">{s.whenToUse}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {stage === 'refs' && (
            <div className="border-t border-border/40 px-4 py-3">
              <ReferenceImagesUploader
                label="Referencias del creativo"
                hint="Producto, empaque o entorno: lo que el modelo debe respetar fiel."
                images={refImages}
                onChange={(imgs) => {
                  setRefImages(imgs);
                  setDraft((d) => ({ ...d, referenceIds: imgs.map((i) => i.id) }));
                }}
                max={6}
              />
            </div>
          )}

          <form
            className="flex gap-2 border-t border-border/60 p-3"
            onSubmit={(e) => { e.preventDefault(); sendTurn(message); }}
          >
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe tu respuesta…"
              aria-label="Tu respuesta"
              className="min-h-11 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={pending || !message.trim()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="size-4" aria-hidden /> Enviar
            </button>
          </form>
        </section>

        {/* Borrador en vivo */}
        <aside className="h-fit rounded-xl border border-border bg-card/30 p-4 text-[12.5px]">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tu creativo</p>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="text-muted-foreground/80">Producto</dt>
              <dd className="text-foreground/90">{productName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Formato</dt>
              <dd className="text-foreground/90">{formatLabel}{draft.customFormat && ' · nuevo, se creará al aceptar'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Escena</dt>
              <dd className="text-foreground/90">{draft.scenePrompt || '— construyéndose —'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Toma</dt>
              <dd className="text-foreground/90">{shot ? `${shot.name} — ${shot.description}` : '— pendiente —'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground/80">Referencias</dt>
              <dd className="text-foreground/90">{draft.referenceIds.length > 0 ? `${draft.referenceIds.length} adjuntas` : 'Ninguna aún'}</dd>
            </div>
            {errors.length > 0 && (
              <div role="status">
                <dt className="text-red-400">Bloqueos</dt>
                {errors.map((e) => <dd key={e} className="text-red-300/90">{e}</dd>)}
              </div>
            )}
            {warnings.length > 0 && (
              <div role="status">
                <dt className="text-amber-400">Puede afectar el resultado</dt>
                {warnings.map((w) => <dd key={w} className="text-amber-200/80">{w}</dd>)}
              </div>
            )}
          </dl>
          <button
            type="button"
            disabled={accepting || errors.length > 0 || !draft.scenePrompt.trim() || stage !== 'review'}
            onClick={handleAccept}
            className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {accepting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            Aceptar y guardar
          </button>
          <Link
            href={`/app/campaigns/${campaignId}`}
            className="mt-2 block text-center text-[12px] text-muted-foreground hover:text-foreground"
          >
            Descartar (no cuesta nada)
          </Link>
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Botón "Refinar" en el plan y retiro de AddItemDialog**

En `components/campaigns/CampaignStudioView.tsx`:

1. En `PlanTable`, junto a los botones de editar/eliminar (`{editable(item.status) && (…)}`), agregar como primer botón del grupo:

```tsx
<Link
  href={`/app/campaigns/${campaignId}/refine/${item.id}`}
  aria-label="Refinar con asistente"
  className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-primary"
>
  <Sparkles className="size-3.5" aria-hidden />
</Link>
```

(`PlanTable` recibe `campaignId` como prop nueva: `<PlanTable campaignId={campaign.id} …>`; importar `Sparkles` de lucide y `Link` de next/link si falta.)

2. El botón "Agregar creativo" deja de abrir `AddItemDialog` y navega:

```tsx
<Link
  href={`/app/campaigns/${campaign.id}/refine/new`}
  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
>
  <Sparkles className="size-3.5" aria-hidden />
  Agregar creativo
</Link>
```

3. Eliminar el estado `adding`, el render `{adding && <AddItemDialog …>}` y la función `AddItemDialog` completa del archivo (y los imports que queden sin uso: `addCampaignItemAction` si ya nadie lo llama en el archivo). La server action `addCampaignItemAction` se conserva (la usa la API del plan), solo la UI se retira.

- [ ] **Step 4: Verificación**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: todo PASS

- [ ] **Step 5: Commit**

```bash
git add components/refine/ "app/app/campaigns/[id]/refine/" components/campaigns/CampaignStudioView.tsx
git commit -m "feat(refine): pagina de refinado conversacional y boton en el plan"
```

---

## Task 7: Wizard "Describe lo que imaginas" + siembra del plan

**Files:**
- Modify: `lib/schemas/campaigns.ts` (GeneratePlanSchema)
- Modify: `server-actions/campaigns.ts` (generatePlanAction)
- Modify: `components/campaigns/CampaignStudioWizard.tsx`

- [ ] **Step 1: Extender GeneratePlanSchema**

En `lib/schemas/campaigns.ts`, dentro de `GeneratePlanSchema`:

```ts
export const GeneratePlanSchema = z.object({
  campaignId: z.string().uuid(),
  // Techo demo (doc V2 §5.5): la arquitectura escala, el plan free no.
  totalItems: z.number().int().min(2).max(30),
  // Ideas en lenguaje natural (specs/v2/07): siembran el mix vía format matcher.
  userIdeas: z.string().trim().max(2000).optional(),
});
```

- [ ] **Step 2: Sembrar el mix en generatePlanAction**

En `server-actions/campaigns.ts`, importar el matcher:

```ts
import { matchIdeas } from '@/lib/prompt-director/format-matcher';
```

La query de formatos del action ya trae `id, slug, name`; agregar `description` al select:

```ts
.select('id, slug, name, description, required_refs, default_duration_s, default_audio')
```

Justo después de construir `const formats: PlannerFormat[] = …` y ANTES del cálculo de `winningSlugs`, insertar:

```ts
  // Ideas del usuario (specs/v2/07): el matcher las mapea a formatos; lo que
  // no encaja nace como formato custom del workspace. Los slugs sembrados
  // entran al mix con el mismo boost que los formatos ganadores.
  const seededSlugs: string[] = [];
  if (parsed.data.userIdeas) {
    try {
      const matched = await matchIdeas({
        ideasText: parsed.data.userIdeas,
        formats: (formatRows ?? []).map((f) => ({
          id: f.id as string,
          slug: f.slug as string,
          name: f.name as string,
          description: (f.description as string | null) ?? null,
        })),
      });
      for (const m of matched.matches) {
        if (m.formatId) {
          const f = formats.find((x) => x.id === m.formatId);
          if (f) seededSlugs.push(f.slug);
        } else if (m.customFormat) {
          const cf = m.customFormat;
          const { data: created } = await supabase
            .from('formats')
            .insert({
              slug: cf.slug, name: cf.name, description: cf.description,
              register: cf.register, camera_style: cf.cameraStyle, pacing: cf.pacing,
              required_refs: cf.requiredRefs, default_duration_s: cf.defaultDurationS,
              default_audio: cf.defaultAudio, is_system: false, workspace_id: workspace.id,
            })
            .select('id, slug')
            .single();
          if (created) {
            formats.push({
              id: created.id as string, slug: created.slug as string, name: cf.name,
              requiredRefs: cf.requiredRefs, defaultDurationS: cf.defaultDurationS,
              defaultAudio: cf.defaultAudio,
            });
            seededSlugs.push(created.slug as string);
          }
        }
      }
      if (seededSlugs.length) revalidatePath('/app/formats');
    } catch {
      // El matcher es mejora, no requisito: si Gemini falla, el plan sale
      // con el mix por categoría de siempre.
    }
  }
```

Y en la llamada a `buildPlan`, cambiar:

```ts
    winningSlugs,
```

por:

```ts
    winningSlugs: [...winningSlugs, ...seededSlugs],
```

- [ ] **Step 3: Textarea en el wizard**

En `components/campaigns/CampaignStudioWizard.tsx`:

1. Estado nuevo junto a los demás `useState`:

```tsx
const [ideas, setIdeas] = useState('');
```

2. Sección nueva entre "URL del producto" y "Objetivo":

```tsx
<section className="space-y-1.5">
  <Label htmlFor="campaign-ideas" className="text-[12.5px] font-medium text-foreground/80">
    Describe lo que imaginas <span className="font-normal text-muted-foreground/50">(opcional)</span>
  </Label>
  <textarea
    id="campaign-ideas"
    value={ideas}
    onChange={(e) => setIdeas(e.target.value)}
    placeholder="Ej. quiero unboxings, algo ASMR, y un video donde mi perro usa el producto"
    maxLength={2000}
    rows={3}
    className="w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
  />
  <p className="text-[11.5px] text-muted-foreground/60">
    Tus ideas guían el mix de formatos; las que no encajen en el catálogo crean un formato nuevo tuyo.
  </p>
</section>
```

3. En `handleCreate`, pasar las ideas al plan:

```tsx
const planned = await generatePlanAction({
  campaignId: created.data.id,
  totalItems,
  ...(ideas.trim() ? { userIdeas: ideas.trim() } : {}),
});
```

- [ ] **Step 4: Verificación completa**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: todo PASS

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/campaigns.ts server-actions/campaigns.ts components/campaigns/CampaignStudioWizard.tsx
git commit -m "feat(campaigns): ideas del usuario siembran el plan via format matcher"
```

---

## Task 8: Cierre

- [ ] **Step 1: Suite completa una vez más**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: todo PASS

- [ ] **Step 2: Actualizar el spec si hubo desviaciones**

Si la implementación divergió del spec (nombres, rutas), actualizar `specs/v2/07-refinado-conversacional.md` en el mismo commit que la desviación — regla del repo: spec y código en paralelo.

- [ ] **Step 3: Recordatorios para el usuario (no commitear nada aquí)**

- Aplicar `supabase/migrations/030_refine.sql` al proyecto.
- Correr `node --env-file=.env.local scripts/generate-shot-images.mjs` y commitear `public/shots/`.
- Smoke manual del flujo refinado con API real de Gemini.
- Merge de `feat/refinado-conversacional` a `development` solo después del smoke.
