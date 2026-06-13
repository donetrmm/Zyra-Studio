# Creación asistida por IA — Plan 1: Motor + Cast (personaje)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un wizard guiado lanzable desde el Cast que, con Gemini Flash (aclaración), FLUX (genera el personaje ficticio) y Nano Banana (edita), crea un personaje completo en una sola sesión — describir → aclarar → generar → editar por versiones → guardar.

**Architecture:** Wizard client-side con estado efímero (Enfoque A del spec). Reusa el pipeline de generación existente — `submitGenerationAction` (síncrono para imágenes), `addGenerationAsReferenceAction`, `createCharacterAction` (que auto-deriva la `description` desde la imagen), `describeCharacterImage`. Pieza nueva de servidor: un módulo Gemini de aclaración + una server action. Nada nuevo en la base de datos.

**Tech Stack:** Next.js 15 (App Router), React client components, Supabase, Gemini 2.5 Flash (REST), zod, vitest. pnpm.

**Spec fuente:** `specs/v2/08-creacion-asistida-ia.md`.

**Alcance / descomposición:** El spec cubre Cast (personaje) **y** Brand Kit (producto). Ambos comparten el motor del wizard, pero la rama de producto tiene lógica propia no trivial (subir foto → brief editable → mejorar una imagen *subida* —no generada— donde la primera mejora usa la foto como *reference* y las siguientes como *parent*). Para que cada plan entregue software funcional por sí solo, se parte en dos:
> - **Plan 1 (este):** motor del wizard + Cast (personaje) end-to-end.
> - **Plan 2 (siguiente):** rama de producto en el Brand Kit (`analyzeProductImageAction`, paso de brief editable, helper `editUploaded`, acciones de mejora).
>
> El wizard de Plan 1 acepta un prop `kind` y se construye para `character`; Plan 2 lo extiende aditivamente con la rama `product`.

---

## File Structure (Plan 1)

- `lib/schemas/creation.ts` *(crear)* — tipos + zod del contrato de aclaración (`ClarifyInput`, `ClarifyResult`).
- `lib/creation/clarify.ts` *(crear)* — Gemini Flash: aclaración del modo `character`. server-only.
- `server-actions/creation.ts` *(crear)* — `clarifyCreationAction` (Plan 2 añade aquí `analyzeProductImageAction`).
- `components/creation/generate.ts` *(crear)* — helpers cliente: `generateCharacter`, `editImage` (envuelven las actions de generación y devuelven `{ generationId, refId, previewUrl }`).
- `components/creation/CreationWizard.tsx` *(crear)* — wizard (modal); prop `kind`, construido para `character`.
- `components/cast/CastPage.tsx` *(modificar)* — botón "Crear con IA" abre el wizard modo `character`.
- Tests: `lib/creation/clarify.test.ts`, `lib/schemas/creation.test.ts`.

(Plan 2 modificará `components/brand-kits/BrandKitsPage.tsx` y extenderá el wizard con la rama `product`.)

**Convenciones del repo a respetar:** sin emojis en código/UI; dark mode, acento `#009fff`; Server Components por default, `'use client'` solo con state; commits Conventional en español **sin** `Co-Authored-By`; tests **nunca** llaman APIs reales (mock de `fetch` con `vi.stubGlobal`); usar `pnpm`.

---

## Task 1: Schemas zod del contrato de aclaración

**Files:**
- Create: `lib/schemas/creation.ts`
- Test: `lib/schemas/creation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/schemas/creation.test.ts
import { describe, it, expect } from 'vitest';
import { ClarifyInputSchema, ClarifyResultSchema } from './creation';

describe('ClarifyInputSchema', () => {
  it('acepta una entrada válida', () => {
    const r = ClarifyInputSchema.safeParse({ text: 'una creadora de cocina', hasReference: false });
    expect(r.success).toBe(true);
  });
  it('rechaza texto vacío', () => {
    expect(ClarifyInputSchema.safeParse({ text: '   ', hasReference: false }).success).toBe(false);
  });
});

describe('ClarifyResultSchema', () => {
  it('saneo laxo: descarta preguntas malformadas y recorta a 3', () => {
    const parsed = ClarifyResultSchema.parse({
      questions: [
        { id: 'a', question: '¿Vestuario?', suggestions: ['casual', 'formal'] },
        { question: 'sin id' },           // malformada → se descarta
        { id: 'b', question: '¿Tono?', suggestions: [] },
        { id: 'c', question: '¿Luz?', suggestions: [] },
        { id: 'd', question: '¿Fondo?', suggestions: [] },
      ],
      enrichedPrompt: 'a kitchen content creator',
    });
    expect(parsed.questions.length).toBe(3);
    expect(parsed.questions[0].id).toBe('a');
    expect(parsed.enrichedPrompt).toBe('a kitchen content creator');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/schemas/creation.test.ts`
Expected: FAIL — `Cannot find module './creation'`.

- [ ] **Step 3: Write the schema**

```ts
// lib/schemas/creation.ts
import { z } from 'zod';

export type CreationKind = 'character' | 'product';

// Entrada de la aclaración (solo modo character; product no pasa por aquí).
export const ClarifyInputSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  hasReference: z.boolean().default(false),
});
export type ClarifyInput = z.infer<typeof ClarifyInputSchema>;

// Una pregunta de aclaración con chips sugeridos.
const QuestionSchema = z.object({
  id: z.string().min(1).max(40),
  question: z.string().trim().min(1).max(200),
  suggestions: z.array(z.string().trim().min(1).max(60)).max(6).catch([]).default([]),
});

// Salida estructurada de Gemini Flash. Saneo laxo: el LLM es estocástico, así
// que una pregunta malformada se descarta sin tirar el resultado; máx 3.
export const ClarifyResultSchema = z.object({
  questions: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr
        .flatMap((q) => {
          const parsed = QuestionSchema.safeParse(q);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 3),
    ),
  enrichedPrompt: z.string().trim().min(1).max(1500),
});
export type ClarifyResult = z.infer<typeof ClarifyResultSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/schemas/creation.test.ts`
Expected: PASS (2 describes, 3 its).

- [ ] **Step 5: Commit**

```bash
git add lib/schemas/creation.ts lib/schemas/creation.test.ts
git commit -m "feat(creation): schema del contrato de aclaracion (character)"
```

---

## Task 2: Módulo Gemini de aclaración (`clarify.ts`)

**Files:**
- Create: `lib/creation/clarify.ts`
- Test: `lib/creation/clarify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/creation/clarify.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { clarifyCharacter } from './clarify';

function geminiOk(payload: unknown) {
  return {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
  } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('clarifyCharacter', () => {
  it('devuelve preguntas y enrichedPrompt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      questions: [{ id: 'wardrobe', question: '¿Vestuario?', suggestions: ['linen', 'denim'] }],
      enrichedPrompt: 'a kitchen content creator with curly dark hair, relaxed delivery',
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await clarifyCharacter({ text: 'una creadora de cocina', hasReference: false });
    expect(res.questions).toHaveLength(1);
    expect(res.questions[0].id).toBe('wardrobe');
    expect(res.enrichedPrompt).toContain('kitchen content creator');
  });

  it('limpia marcadores de edad del enrichedPrompt (red de seguridad)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      questions: [],
      enrichedPrompt: 'a young woman with short hair',
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await clarifyCharacter({ text: 'mujer de pelo corto', hasReference: false });
    expect(res.enrichedPrompt).not.toMatch(/young/i);
    expect(res.enrichedPrompt).toContain('woman with short hair');
  });

  it('reintenta una vez ante un 429 y luego propaga', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate' } as Response));
    vi.stubGlobal('fetch', fetchMock);
    process.env.GEMINI_API_KEY = 'test';
    await expect(
      clarifyCharacter({ text: 'algo', hasReference: false, retryDelayMs: 0 }),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/creation/clarify.test.ts`
Expected: FAIL — `Cannot find module './clarify'`.

- [ ] **Step 3: Write the module**

Sigue el patrón de `lib/campaigns/brief.ts` y `lib/prompt-director/format-matcher.ts` (fetch directo, `responseMimeType: 'application/json'`, `thinkingConfig.thinkingBudget: 0`, un reintento ante `retryable`).

```ts
// lib/creation/clarify.ts
import 'server-only';
import { z } from 'zod';
import { ProviderError } from '@/lib/providers/types';
import { stripAgeWords } from '@/lib/prompt-director/inventory';
import { ClarifyResultSchema, type ClarifyInput, type ClarifyResult } from '@/lib/schemas/creation';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

// Aclaración del modo character: persona FICTICIA, age-blind, sin claims.
const SYSTEM = `Eres director de casting de una plataforma de anuncios con IA. El usuario describe un personaje ficticio para generarlo como imagen. Devuelve SOLO un JSON con esta forma exacta:
{"questions":[{"id":"kebab","question":"pregunta corta en ESPAÑOL","suggestions":["chip1","chip2"]}],
 "enrichedPrompt":"apariencia completa del personaje en INGLÉS, 1-2 frases"}
Reglas:
- questions: incluye 0-3 SOLO si falta algo crítico para generar (vestuario, peinado, tono/actitud, contexto). Si el texto ya basta, questions=[]. Las suggestions son 2-4 chips cortos accionables.
- enrichedPrompt: apariencia física, peinado/cabello, vestuario y manera de actuar, en INGLÉS. Persona FICTICIA. NUNCA menciones edad ni rangos (nada de young/old/teen/elderly/niño/anciano). No inventes nombres, marcas ni claims. No describas fondo.
JSON válido, sin markdown.`;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(z.object({
      content: z.object({ parts: z.array(z.object({ text: z.string() })).optional() }).optional(),
    }))
    .min(1),
});

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export async function clarifyCharacter(
  input: ClarifyInput & { retryDelayMs?: number },
): Promise<ClarifyResult> {
  try {
    return await requestClarify(input);
  } catch (err) {
    if (err instanceof ProviderError && err.retryable) {
      await new Promise((r) => setTimeout(r, input.retryDelayMs ?? 2000));
      return requestClarify(input);
    }
    throw err;
  }
}

async function requestClarify(input: ClarifyInput): Promise<ClarifyResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ProviderError('GEMINI_API_KEY no configurada', 'auth', false);

  const userText = `Personaje pedido: ${input.text.slice(0, 1000)}${
    input.hasReference ? '\n(El usuario adjuntó una imagen de referencia de estilo/apariencia.)' : ''
  }`;

  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 600,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (res.status === 429) throw new ProviderError('Rate limit Gemini', 'rate_limit', true);
  if (res.status === 401 || res.status === 403) throw new ProviderError('Auth inválida con Gemini API', 'auth', false);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(`Gemini clarify ${res.status}: ${text.slice(0, 200)}`, 'server', res.status >= 500);
  }

  const envelope = GeminiResponseSchema.safeParse(await res.json());
  if (!envelope.success) throw new ProviderError('Respuesta inesperada de Gemini en clarify', 'unknown', true);
  const raw = (envelope.data.candidates[0].content?.parts ?? []).map((p) => p.text).join('');
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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/creation/clarify.test.ts`
Expected: PASS (3 its). Nota: en el test del 429 hay un reintento → `setTimeout` con `retryDelayMs: 0`.

- [ ] **Step 5: Commit**

```bash
git add lib/creation/clarify.ts lib/creation/clarify.test.ts
git commit -m "feat(creation): aclaracion de personaje con Gemini Flash (age-blind)"
```

---

## Task 3: Server action de aclaración (`creation.ts`)

**Files:**
- Create: `server-actions/creation.ts`

No tiene test unitario propio (usa `requireWorkspace()` + Supabase; la lógica testeable vive en `clarify.ts`, ya cubierta). Se valida con typecheck.

- [ ] **Step 1: Write the action**

`clarifyCreationAction` con fallback best-effort: si Gemini falla, devuelve `questions: []` + el texto crudo saneado age-blind, para que el wizard genere igual sin bloquearse.

```ts
// server-actions/creation.ts
'use server';

import 'server-only';
import { requireWorkspace } from '@/lib/auth/dal';
import { clarifyCharacter } from '@/lib/creation/clarify';
import { stripAgeWords } from '@/lib/prompt-director/inventory';
import { ClarifyInputSchema, type ClarifyResult } from '@/lib/schemas/creation';

type Result<T> = { ok: true; data: T } | { ok: false; error: string; message?: string };

export async function clarifyCreationAction(input: unknown): Promise<Result<ClarifyResult>> {
  const parsed = ClarifyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  await requireWorkspace();
  try {
    return { ok: true, data: await clarifyCharacter(parsed.data) };
  } catch {
    // Falla blanda: generar best-effort con el texto crudo (saneado age-blind).
    const { text } = stripAgeWords(parsed.data.text);
    return { ok: true, data: { questions: [], enrichedPrompt: text.trim() || parsed.data.text } };
  }
}
```

> Plan 2 añade en este archivo `analyzeProductImageAction(mediaReferenceId)`: valida ownership
> (patrón `describeFromMaster` de `cast.ts`), `downloadReferenceBuffer` + `analyzeProductBrief`,
> devuelve el `ProductBrief`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add server-actions/creation.ts
git commit -m "feat(creation): action de aclaracion de personaje"
```

---

## Task 4: Helpers cliente de generación (`generate.ts`)

**Files:**
- Create: `components/creation/generate.ts`

Encapsula el patrón "generar (síncrono) → fijar como referencia" para reusarlo en personaje y edición. Devuelve la `media_reference` y su preview. No tiene test unitario (envuelve server actions); se valida con typecheck y el smoke manual.

- [ ] **Step 1: Write the helpers**

```ts
// components/creation/generate.ts
import { submitGenerationAction } from '@/server-actions/generations';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';

export type GeneratedImage = { generationId: string; refId: string; previewUrl: string };
export type GenError = { error: string; message?: string };

// Scaffold de retrato neutro (mismo criterio que buildMasterPrompt de CastPage):
// el Prompt Director espera frontal, luz pareja, persona ficticia.
function buildMasterPrompt(appearance: string): string {
  return (
    `Frontal head-and-shoulders portrait of a fictional person: ${appearance}. ` +
    'Neutral relaxed expression, looking straight at the camera, soft even studio lighting, ' +
    'plain light gray seamless background, sharp focus on the face, natural skin texture, ' +
    'no text, no watermark.'
  );
}

// Convierte una generación 'done' en media_reference (preview + id para guardar).
async function fixAsReference(generationId: string): Promise<GeneratedImage | GenError> {
  const ref = await addGenerationAsReferenceAction({ generationId });
  if (!ref.ok) return { error: ref.error, message: ref.message };
  return { generationId, refId: ref.data.id, previewUrl: ref.data.previewUrl };
}

// Genera el personaje desde su apariencia (FLUX, síncrono para imágenes).
// `reference` opcional = inspiración de estilo (image-ref).
export async function generateCharacter(
  appearance: string,
  reference?: { id: string; storagePath: string },
): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'flux' as const,
    model: 'flux-2-pro-preview' as const,
    variant: 'default' as const,
    prompt: buildMasterPrompt(appearance),
    aspectRatio: '3:4' as const,
    megapixels: 2 as const,
    photoreal: true,
    references: reference ? [reference] : [],
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

// Edita una imagen previa con Nano Banana multi-turn (un cambio por iteración).
// `parentGenerationId` = la versión actual; el server reconstruye el turn previo.
export async function editImage(
  parentGenerationId: string,
  instruction: string,
  opts?: { noBackground?: boolean },
): Promise<GeneratedImage | GenError> {
  const res = await submitGenerationAction({
    provider: 'nano-banana' as const,
    model: 'gemini-3-pro-image-preview' as const,
    variant: '2k' as const,
    prompt: instruction,
    conversational: true,
    parentGenerationId,
    references: [],
    noBackground: opts?.noBackground ?? false,
  });
  if (!res.ok) return { error: res.error, message: res.message };
  return fixAsReference(res.data.generationId);
}

export function isGenError(x: GeneratedImage | GenError): x is GenError {
  return 'error' in x;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: sin errores. Confirmar que `submitGenerationAction` acepta exactamente estos campos (ver `lib/schemas/generations.ts`: `FluxInputSchema`, `NanoBananaInputSchema`).

> **Nota sobre `reference.storagePath`:** `submitGenerationAction` requiere `{ id, storagePath }` por referencia (`ReferenceItem`). El uploader `ReferenceImagesUploader` (tipo `RefImage`) expone `id` y `previewUrl`, no `storagePath`. En Task 5/6, al subir la referencia, captura también su `storagePath` desde la respuesta del flujo de subida (`createReferenceUploadUrl` devuelve `path`) o consulta `media_references.storage_url`. Si en el wizard no se quiere resolver el path, omite la referencia (genera solo desde texto) — degradación aceptable para v1.

- [ ] **Step 3: Commit**

```bash
git add components/creation/generate.ts
git commit -m "feat(creation): helpers cliente de generacion y edicion de imagen"
```

---

## Task 5: Wizard compartido (`CreationWizard.tsx`)

**Files:**
- Create: `components/creation/CreationWizard.tsx`

Modal client-side con estado efímero. Cuatro pasos; ramas por `kind`. Estilo: dark, acento del proyecto, componentes shadcn/clases existentes (mira `CharacterEditor` en `CastPage.tsx` como referencia de estilo). Sin emojis.

- [ ] **Step 1: Write the component**

```tsx
// components/creation/CreationWizard.tsx
'use client';

import { useState } from 'react';
import { Loader2, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { clarifyCreationAction } from '@/server-actions/creation';
import { generateCharacter, editImage, isGenError, type GeneratedImage } from './generate';
import type { CreationKind, ClarifyResult } from '@/lib/schemas/creation';

type Props = {
  kind: CreationKind;  // Plan 1 implementa 'character'; 'product' lo añade Plan 2.
  // El padre persiste el resultado (crea el personaje con la imagen elegida).
  onSave: (refId: string) => Promise<void>;
  onClose: () => void;
};

type Step = 'intent' | 'clarify' | 'preview';

export function CreationWizard({ kind, onSave, onClose }: Props) {
  const [step, setStep] = useState<Step>('intent');
  const [text, setText] = useState('');
  const [clarify, setClarify] = useState<ClarifyResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<GeneratedImage[]>([]);
  const [current, setCurrent] = useState(0);
  const [editPrompt, setEditPrompt] = useState('');
  const [busy, setBusy] = useState(false);

  const composedAppearance = () => {
    const extra = Object.values(answers).filter(Boolean).join(', ');
    const base = clarify?.enrichedPrompt ?? text.trim();
    return extra ? `${base}, ${extra}` : base;
  };

  async function handleIntentNext() {
    if (text.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await clarifyCreationAction({ text: text.trim(), hasReference: false });
      if (!res.ok) { toast.error(res.message || 'No se pudo procesar'); return; }
      setClarify(res.data);
      if (res.data.questions.length === 0) await runGenerate(res.data.enrichedPrompt);
      else setStep('clarify');
    } finally { setBusy(false); }
  }

  async function runGenerate(appearance: string) {
    setBusy(true);
    try {
      const out = await generateCharacter(appearance);
      if (isGenError(out)) {
        toast.error(out.message || 'No se pudo generar');
        return;
      }
      setVersions([out]);
      setCurrent(0);
      setStep('preview');
    } finally { setBusy(false); }
  }

  async function handleEdit() {
    if (editPrompt.trim().length < 3 || versions.length === 0) return;
    setBusy(true);
    try {
      const parent = versions[current].generationId;
      const out = await editImage(parent, editPrompt.trim());
      if (isGenError(out)) { toast.error(out.message || 'No se pudo editar'); return; }
      const next = [...versions, out];
      setVersions(next);
      setCurrent(next.length - 1);
      setEditPrompt('');
    } finally { setBusy(false); }
  }

  async function handleSave() {
    if (versions.length === 0) return;
    setBusy(true);
    try {
      await onSave(versions[current].refId);
      toast.success('Guardado');
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3.5">
          <h2 className="text-[15px] font-medium text-foreground">
            Crear {kind === 'character' ? 'personaje' : 'producto'} con IA
          </h2>
          <button type="button" onClick={onClose} className="text-[13px] text-muted-foreground hover:text-foreground">Cerrar</button>
        </div>

        <div className="space-y-4 p-5">
          {step === 'intent' && (
            <>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Describe lo que quieres
              </label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={kind === 'character'
                  ? 'una creadora de cocina, pelo rizado, entrega cercana…'
                  : 'mi lata de refresco sobre fondo limpio…'}
                className="w-full rounded-md border border-border bg-background p-3 text-[13px] text-foreground outline-none focus:border-primary/40"
              />
              <div className="flex gap-2">
                <button type="button" onClick={handleIntentNext} disabled={busy || text.trim().length < 3}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  Continuar
                </button>
              </div>
            </>
          )}

          {step === 'clarify' && clarify && (
            <>
              <p className="text-[13px] text-muted-foreground">Aclaremos un par de cosas:</p>
              {clarify.questions.map((q) => (
                <div key={q.id}>
                  <label className="text-[12.5px] text-foreground">{q.question}</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {q.suggestions.map((s) => (
                      <button key={s} type="button"
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: s }))}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] ${answers[q.id] === s ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                  <input value={answers[q.id] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder="o escribe…" maxLength={120}
                    className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] outline-none focus:border-primary/40" />
                </div>
              ))}
              <button type="button" onClick={() => runGenerate(composedAppearance())} disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                Generar
              </button>
            </>
          )}

          {step === 'preview' && versions.length > 0 && (
            <>
              <div className="relative grid place-items-center rounded-lg border border-border bg-muted/20 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={versions[current].previewUrl} alt="preview" className="max-h-80 rounded object-contain" />
                {versions.length > 1 && (
                  <div className="mt-2 flex items-center gap-3 text-[12px] text-muted-foreground">
                    <button type="button" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}><ChevronLeft className="size-4" /></button>
                    v{current + 1} / {versions.length}
                    <button type="button" onClick={() => setCurrent((c) => Math.min(versions.length - 1, c + 1))} disabled={current === versions.length - 1}><ChevronRight className="size-4" /></button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Editar (un cambio por vez)</label>
                <div className="mt-1.5 flex gap-2">
                  <input value={editPrompt} onChange={(e) => setEditPrompt(e.target.value)} placeholder="ej. pelo más corto"
                    className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary/40" />
                  <button type="button" onClick={handleEdit} disabled={busy || editPrompt.trim().length < 3}
                    className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-[12.5px] font-medium text-foreground hover:bg-primary/15 disabled:opacity-50">
                    {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : 'Aplicar'}
                  </button>
                </div>
              </div>
              <button type="button" onClick={handleSave} disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Guardar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm eslint components/creation/CreationWizard.tsx`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/creation/CreationWizard.tsx
git commit -m "feat(creation): wizard guiado compartido (character end-to-end)"
```

---

## Task 6: Integración Cast

**Files:**
- Modify: `components/cast/CastPage.tsx`

- [ ] **Step 1: Cast — botón "Crear con IA"**

En `CastPage` (componente raíz, no el editor), agrega estado para abrir el wizard en modo `character`. Al guardar, crea el personaje con la imagen elegida como master; `createCharacterAction` ya deriva la `description` desde la imagen (auto-relleno de la nota 2026-06-13), así que basta pasar `masterImageId` sin descripción.

```tsx
// CastPage.tsx — imports
import { CreationWizard } from '@/components/creation/CreationWizard';
// dentro de CastPage(): estado
const [aiOpen, setAiOpen] = useState(false);
```

Botón junto a "Nuevo personaje":

```tsx
<button type="button" onClick={() => setAiOpen(true)}
  className="inline-flex shrink-0 items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-primary/15">
  <Sparkles className="size-4" aria-hidden /> Crear con IA
</button>
```

Wizard montado:

```tsx
{aiOpen && (
  <CreationWizard
    kind="character"
    onSave={async (refId) => {
      const res = await createCharacterAction({ name: 'Nuevo personaje', masterImageId: refId, angleImageIds: [] });
      if (!res.ok) { toast.error(res.message || 'No se pudo crear'); return; }
      router.refresh();
    }}
    onClose={() => setAiOpen(false)}
  />
)}
```

(Nota: el nombre por defecto "Nuevo personaje" se edita después desde el editor existente. Si se prefiere pedir el nombre en el wizard, añadir un campo `name` al paso `preview` y pasarlo a `onSave` — opcional.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm eslint components/cast/CastPage.tsx`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add components/cast/CastPage.tsx
git commit -m "feat(creation): integra el wizard de IA en el Cast"
```

---

## Criterio de cierre (Plan 1)

- [ ] `pnpm typecheck` y `pnpm vitest run` verdes.
- [ ] Desde el Cast: "Crear con IA" → describir → (aclarar) → generar (FLUX) → editar (Nano Banana) → Guardar crea un personaje con `master_image_id` y `description` derivada de la imagen final.
- [ ] Smoke manual (usuario, con créditos reales): un personaje end-to-end.
- [ ] Revisión: el flujo nunca permite un rostro real identificable (scaffold pide *fictional person*; `stripAgeWords` aplicado).

## Notas de alcance / decisiones

- **Descomposición:** este es el **Plan 1** (motor + Cast). El **Plan 2** implementa la rama de
  producto en el Brand Kit: `analyzeProductImageAction`, un paso de brief editable en el wizard,
  un helper `editUploaded(refId, storagePath, instruction)` (primera mejora de una foto *subida*
  usa la imagen como *reference*, no como *parent*), las acciones rápidas (quitar fondo / mejorar
  luz / generar ángulo) y la integración en `BrandKitsPage`. Escribir Plan 2 tras cerrar Plan 1.
- **Referencia de estilo en personaje:** Plan 1 genera desde texto. Pasar una imagen subida como
  image-ref de FLUX requiere su `storagePath` (el uploader expone `id`/`previewUrl`; el path sale
  de `createReferenceUploadUrl` al subir, o de `media_references.storage_url`). Es un *fast-follow*
  aditivo sobre `generateCharacter(appearance, reference?)`, que ya acepta el parámetro.
- **Créditos:** cada `generateCharacter`/`editImage` pasa por `submitGenerationAction`, que
  reserva/confirma créditos atómicamente. La aclaración (Gemini Flash) no cobra créditos. El costo
  es el límite natural de iteraciones.
- **Sin migraciones:** las imágenes generadas ya quedan como `media_references`. El estado del
  wizard es efímero en cliente.
