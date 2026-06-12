# División de guion en secuencia de clips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el matcher detecte un guion multi-escena, lo proponga como una secuencia de N clips cortos (un anuncio en N escenas) y que el plan de campaña los muestre agrupados y en orden, con opción de colapsarlos a un solo clip.

**Architecture:** Enfoque A del spec — columnas aditivas en `campaign_items` (`sequence_id`, `scene_index`, `sequence_label`), sin tabla nueva. El matcher gana un campo `scenes[]`; el planner lo expande a N `PlanItemDraft` que comparten `sequenceId`; la server action persiste los campos y ofrece `mergeSequenceAction`; la UI agrupa por `sequence_id`. Generación, créditos y realtime sin cambios (cada escena = un clip independiente).

**Tech Stack:** Next.js 15 (App Router), Supabase (Postgres + RLS + Realtime), zod, Vitest, TypeScript. Provider de video: Seedance 2.0 vía ModelArk.

**Spec:** `docs/superpowers/specs/2026-06-12-division-clips-secuencia-design.md`

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/035_campaign_sequences.sql` | Nuevo: columnas `sequence_id`/`scene_index`/`sequence_label` + índice |
| `lib/prompt-director/format-matcher.ts` | `scenes[]` + `sequenceLabel` en `MatchSchema`; instrucción al modelo |
| `lib/prompt-director/format-matcher.test.ts` | Tests del parseo de secuencias |
| `lib/campaigns/planner.ts` | Expansión de secuencia en `buildDirectedPlan`; scheduling por unidad |
| `lib/campaigns/campaigns.test.ts` | Tests del planner y de `mergeSequenceAction` |
| `lib/schemas/campaigns.ts` | `MergeSequenceSchema` |
| `server-actions/campaigns.ts` | Mapear campos nuevos en el insert; `mergeSequenceAction` |
| `lib/campaigns/plan-grouping.ts` | Nuevo: helper puro `groupPlanItems` (agrupar por secuencia) |
| `lib/campaigns/plan-grouping.test.ts` | Nuevo: tests del agrupado |
| `components/campaigns/CampaignStudioView.tsx` | Render de la secuencia + botón "Unir en 1 clip" |

---

## Task 1: Migración 035 (columnas de secuencia)

**Files:**
- Create: `supabase/migrations/035_campaign_sequences.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 035_campaign_sequences.sql
-- Un guion largo puede partirse en una SECUENCIA: N escenas (clips) de un mismo
-- anuncio, en orden. Columnas aditivas; null = creativo independiente (hoy).

alter table campaign_items
  add column if not exists sequence_id    uuid,
  add column if not exists scene_index    integer,
  add column if not exists sequence_label text;

create index if not exists idx_campaign_items_sequence
  on campaign_items(campaign_id, sequence_id, scene_index);

comment on column campaign_items.sequence_id is
  'Agrupa las escenas de un mismo anuncio (secuencia); null = creativo independiente';
comment on column campaign_items.scene_index is
  'Orden 0..N-1 de la escena dentro de la secuencia';
comment on column campaign_items.sequence_label is
  'Titulo del anuncio mostrado en la cabecera de la secuencia';
```

- [ ] **Step 2: Verificar que el SQL es válido localmente (lint visual)**

No hay test automatizado de SQL en el repo. Confirmar a ojo: las 3 columnas son nullable, `if not exists` en columnas e índice, sin tocar RLS ni la publicación realtime (heredadas). NO aplicar a remoto desde aquí (lo aplica el usuario / pipeline).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/035_campaign_sequences.sql
git commit -m "db: agrega sequence_id/scene_index/sequence_label a campaign_items"
```

---

## Task 2: Matcher — campo `scenes[]` y `sequenceLabel`

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (`MatchSchema`, `SYSTEM`, retorno)
- Test: `lib/prompt-director/format-matcher.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Añadir dentro de `describe('matchIdeas', ...)` en `lib/prompt-director/format-matcher.test.ts`:

```ts
  it('parsea una secuencia con scenes[] ordenadas y sequenceLabel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'anuncio cuadro familiar de 15s con 4 actos', formatId: 'f1', customFormat: null,
        sequenceLabel: 'Cuadro familiar',
        scenes: [
          { scenePrompt: '0-3s: Brenda looks at camera, LED wall of photos behind her', durationS: 4, sceneSummary: 'Gancho: Brenda y el muro de fotos' },
          { scenePrompt: 'Brenda walks around a floating family photo in a dark museum room', durationS: 6, sceneSummary: 'Museo de recuerdos' },
          { scenePrompt: 'The family photo becomes a premium framed print in a warm living room', durationS: 5, sceneSummary: 'Revelacion del cuadro' },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'anuncio cuadro familiar', formats: FORMATS });
    const m = res.matches[0];
    expect(m.sequenceLabel).toBe('Cuadro familiar');
    expect(m.scenes).toHaveLength(3);
    expect(m.scenes[0].durationS).toBe(4);
    expect(m.scenes[1].scenePrompt).toContain('museum');
  });

  it('descarta una escena malformada sin tirar la secuencia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'secuencia', formatId: 'f1', customFormat: null, sequenceLabel: 'X',
        scenes: [
          { scenePrompt: 'Scene one is fully valid and concrete', durationS: 5 },
          { durationS: 5 }, // sin scenePrompt: malformada
          { scenePrompt: 'Scene three is also valid', durationS: 6 },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'secuencia', formats: FORMATS });
    expect(res.matches[0].scenes).toHaveLength(2);
    expect(res.matches[0].scenes[1].scenePrompt).toContain('three');
  });

  it('idea normal trae scenes vacio (no es secuencia)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null, scenePrompt: 'Hands open the box slowly' }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].scenes).toEqual([]);
    expect(res.matches[0].sequenceLabel).toBeNull();
  });
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: FAIL — `m.scenes` es `undefined` (el campo no existe aún).

- [ ] **Step 3: Añadir `SceneSchema` y los campos al `MatchSchema`**

En `lib/prompt-director/format-matcher.ts`, justo antes de `const MatchSchema = z.object({`:

```ts
// Una escena de una secuencia: misma forma que un scenePrompt suelto, recortado
// con el mismo clamp. Sin scenePrompt valido, la escena es descartable.
const SceneSchema = z.object({
  scenePrompt: z
    .unknown()
    .transform((v) => {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (!t) return null;
      return t.length > SCENE_PROMPT_MAX ? clampToWord(t, SCENE_PROMPT_MAX) : t;
    }),
  durationS: z.number().int().min(4).max(15).nullable().catch(null).default(null),
  sceneSummary: z.string().trim().min(1).max(300).nullable().catch(null).default(null),
});
export type MatchedScene = { scenePrompt: string; durationS: number | null; sceneSummary: string | null };
```

Dentro de `MatchSchema` (tras el campo `scenePrompt` existente) añadir:

```ts
  // Secuencia: cuando la idea es un anuncio multi-escena ya guionizado, el
  // modelo la parte en N escenas cortas. Vacio = idea normal (un solo clip).
  // Una escena sin scenePrompt valido se descarta; max 8 escenas.
  scenes: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr.slice(0, 8).flatMap((item) => {
        const parsed = SceneSchema.safeParse(item);
        if (!parsed.success || parsed.data.scenePrompt === null) return [];
        return [{
          scenePrompt: parsed.data.scenePrompt,
          durationS: parsed.data.durationS,
          sceneSummary: parsed.data.sceneSummary,
        } satisfies MatchedScene];
      }),
    ),
  sequenceLabel: z.string().trim().min(1).max(120).nullable().catch(null).default(null),
```

- [ ] **Step 4: Instruir al modelo en `SYSTEM`**

En la constante `SYSTEM`, después del bloque de `scenePrompt` y antes de `sceneSummary`, insertar:

```
- scenes: si UNA idea es un anuncio multi-escena YA guionizado (con actos o
  marcadores de tiempo explicitos, o que claramente NO cabe coherente en un solo
  clip de <=15s), pártela en escenas cortas: array de objetos
  {"scenePrompt":"accion concreta en INGLES de esta escena, 4-8s, AUTO-CONTENIDA
  (re-describe escenario y personaje, el modelo no recuerda entre clips)",
  "durationS":entero 4-15,"sceneSummary":"resumen __SUMMARY_LANG__, 1 frase"}.
  Maximo 8 escenas. Si NO es multi-escena, scenes = [] y usa scenePrompt normal.
- sequenceLabel: titulo corto del anuncio cuando devuelves scenes (ej. "Cuadro
  familiar"); null si scenes = [].
```

Y en la línea de ejemplo del JSON final del `SYSTEM`, añadir las claves nuevas al objeto de match: `"scenes":[],"sequenceLabel":null`.

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: PASS (incluidos los 3 nuevos).

- [ ] **Step 6: Typecheck y commit**

```bash
pnpm typecheck
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(campaigns): el matcher propone secuencias de escenas (scenes[])"
```

---

## Task 3: Planner — expandir la secuencia a N items

**Files:**
- Modify: `lib/campaigns/planner.ts` (`DirectedIdea`, `PlanItemDraft`, `buildDirectedPlan`)
- Test: `lib/campaigns/campaigns.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/campaigns/campaigns.test.ts`, añadir un bloque para `buildDirectedPlan` con secuencia (importar `buildDirectedPlan` desde `'@/lib/campaigns/planner'` si no está ya):

```ts
  it('una idea-secuencia produce N items con mismo sequenceId, sceneIndex 0..N-1 y misma fecha', () => {
    const format = { id: 'f1', slug: 'gran-pantalla', name: 'Gran Pantalla', requiredRefs: ['product'], defaultDurationS: 8, defaultAudio: true };
    const items = buildDirectedPlan({
      ideas: [{
        format, count: 1, scenePrompt: null, durationS: null, sceneSummary: null,
        characterIds: [], invented: [],
        scenes: [
          { scenePrompt: 'Scene one with the product', durationS: 4, sceneSummary: 'uno' },
          { scenePrompt: 'Scene two with the product', durationS: 6, sceneSummary: 'dos' },
          { scenePrompt: 'Scene three with the product', durationS: 5, sceneSummary: 'tres' },
        ],
        sequenceLabel: 'Mi anuncio',
      }],
      productName: 'Producto', goal: 'mixed', scenes: [], characters: [],
      available: { product: true, packaging: true },
      dateStart: new Date('2026-07-01'), dateEnd: new Date('2026-07-30'),
      draftModelSlug: 'bytedance/seedance-2.0/fast/text-to-video',
      language: 'es', aspectRatio: '9:16',
    });
    expect(items).toHaveLength(3);
    const seqIds = new Set(items.map((i) => i.sequenceId));
    expect(seqIds.size).toBe(1);
    expect([...seqIds][0]).not.toBeNull();
    expect(items.map((i) => i.sceneIndex)).toEqual([0, 1, 2]);
    expect(items.map((i) => i.sequenceLabel)).toEqual(['Mi anuncio', 'Mi anuncio', 'Mi anuncio']);
    expect(new Set(items.map((i) => i.scheduledDate)).size).toBe(1); // misma fecha
    expect(items.map((i) => i.durationS)).toEqual([4, 6, 5]);
    expect(items.map((i) => i.scenePrompt)).toEqual([
      'Scene one with the product', 'Scene two with the product', 'Scene three with the product',
    ]);
  });

  it('una idea normal (sin scenes) sigue siendo un item con sequenceId null', () => {
    const format = { id: 'f2', slug: 'voz-cercana', name: 'Voz Cercana', requiredRefs: ['product'], defaultDurationS: 9, defaultAudio: true };
    const items = buildDirectedPlan({
      ideas: [{ format, count: 1, scenePrompt: 'She lifts the product to camera', durationS: null, sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null }],
      productName: 'Producto', goal: 'mixed', scenes: [], characters: [],
      available: { product: true, packaging: true },
      dateStart: new Date('2026-07-01'), dateEnd: new Date('2026-07-30'),
      draftModelSlug: 'bytedance/seedance-2.0/fast/text-to-video',
      language: 'es', aspectRatio: '9:16',
    });
    expect(items).toHaveLength(1);
    expect(items[0].sequenceId).toBeNull();
    expect(items[0].sceneIndex).toBeNull();
  });
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm vitest run lib/campaigns/campaigns.test.ts`
Expected: FAIL — `DirectedIdea` no acepta `scenes`/`sequenceLabel`; `PlanItemDraft` no tiene `sequenceId`.

- [ ] **Step 3: Extender los tipos**

En `lib/campaigns/planner.ts`, en `PlanItemDraft` (tras `scheduledDate`):

```ts
  // Secuencia: null en creativos normales. Cuando != null, las escenas de un
  // mismo anuncio comparten sequenceId y se ordenan por sceneIndex.
  sequenceId: string | null;
  sceneIndex: number | null;
  sequenceLabel: string | null;
```

En `DirectedIdea` (tras `invented`):

```ts
  // Si la idea es un anuncio multi-escena, las escenas que el matcher propuso.
  // Vacio = idea normal (un solo clip).
  scenes: Array<{ scenePrompt: string; durationS: number | null; sceneSummary: string | null }>;
  sequenceLabel: string | null;
```

- [ ] **Step 4: Expandir secuencias en `buildDirectedPlan`**

En `lib/campaigns/planner.ts`, dentro de `buildDirectedPlan`, reemplazar el `.map` que construye `groups` para que una idea con `scenes` produzca un bloque-secuencia, y el resto igual. Sustituir el cuerpo del `const groups = viable.map((idea, gIdx) => { ... })` por:

```ts
  const groups: PlanItemDraft[][] = viable.map((idea, gIdx) => {
    // Rama secuencia: N escenas de un mismo anuncio, mismo sequenceId.
    if (idea.scenes.length > 0) {
      const allowed = Math.min(idea.scenes.length, budget);
      budget -= allowed;
      if (allowed === 0) return [];
      const sequenceId = crypto.randomUUID();
      const format = idea.format;
      const scene = input.scenes[gIdx % Math.max(1, input.scenes.length)] ?? {
        name: 'Estudio', fragment: 'a clean minimal studio setting with controlled soft light',
      };
      const fromIdea = idea.characterIds.filter((id) => input.characters.some((c) => c.id === id)).slice(0, 3);
      const inventedLines = idea.invented.map((p) => `${p.name} is ${p.description}.`);
      const needsCharacter = format.requiredRefs.includes('character');
      if (needsCharacter && fromIdea.length === 0 && inventedLines.length === 0) {
        inventedLines.push(`The presenter is ${DEFAULT_PRESENTER}.`);
      }
      return idea.scenes.slice(0, allowed).map((sc, sceneIndex) => {
        let scenePrompt = sc.scenePrompt;
        if (inventedLines.length) {
          scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} ${inventedLines.join(' ')}`;
        }
        return {
          formatId: format.id,
          formatSlug: format.slug,
          modelSlug: input.draftModelSlug,
          durationS: sc.durationS ?? format.defaultDurationS,
          aspectRatio: input.aspectRatio,
          scene: scene.fragment,
          audio: format.defaultAudio,
          characterIds: fromIdea,
          scenePrompt,
          sceneSummary: sc.sceneSummary,
          caption: buildCaption({ productName: input.productName, formatSlug: format.slug, goal: input.goal, index: sceneIndex }),
          scheduledDate: '',
          sequenceId,
          sceneIndex,
          sequenceLabel: idea.sequenceLabel,
        } satisfies PlanItemDraft;
      });
    }

    // Rama normal: idéntica a la actual.
    const count = Math.min(Math.max(1, idea.count), budget);
    budget -= count;
    const format = idea.format;
    const seeds = CONCEPT_SEEDS[format.slug] ?? GENERIC_SEEDS;
    const needsCharacter = format.requiredRefs.includes('character');
    const items: PlanItemDraft[] = [];
    for (let i = 0; i < count; i++) {
      const scene = input.scenes[(gIdx + i) % Math.max(1, input.scenes.length)] ?? {
        name: 'Estudio', fragment: 'a clean minimal studio setting with controlled soft light',
      };
      const fromIdea = idea.characterIds.filter((id) => input.characters.some((c) => c.id === id)).slice(0, 3);
      const rotated = needsCharacter && input.characters.length
        ? [input.characters[(gIdx + i) % input.characters.length].id] : [];
      const characterIds = fromIdea.length ? fromIdea : rotated;
      const seed = seeds[i % seeds.length];
      const usedSeed = idea.scenePrompt === null;
      let scenePrompt = idea.scenePrompt ?? seed({ product: input.productName, scene: scene.fragment });
      const sceneSummary = idea.sceneSummary ?? (usedSeed ? seedSummary(format.slug, i, input.language) : null);
      const inventedLines = idea.invented.map((p) => `${p.name} is ${p.description}.`);
      if (needsCharacter && characterIds.length === 0 && inventedLines.length === 0) {
        inventedLines.push(`The presenter is ${DEFAULT_PRESENTER}.`);
      }
      if (inventedLines.length) {
        scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} ${inventedLines.join(' ')}`;
      }
      items.push({
        formatId: format.id, formatSlug: format.slug, modelSlug: input.draftModelSlug,
        durationS: idea.durationS ?? format.defaultDurationS, aspectRatio: input.aspectRatio,
        scene: scene.fragment, audio: format.defaultAudio, characterIds, scenePrompt, sceneSummary,
        caption: buildCaption({ productName: input.productName, formatSlug: format.slug, goal: input.goal, index: i }),
        scheduledDate: '', sequenceId: null, sceneIndex: null, sequenceLabel: null,
      });
    }
    return items;
  });
```

- [ ] **Step 4b: Setear los campos nuevos en `buildPlan` (camino del mix)**

`buildPlan` (el mix por categoría) también construye `PlanItemDraft`. Al volverse requeridos los 3 campos, su `items.push({ ... })` (~líneas 403-422 de `planner.ts`) debe incluirlos. Añadir al objeto:

```ts
        sequenceId: null,
        sceneIndex: null,
        sequenceLabel: null,
```

(El mix nunca produce secuencias; siempre `null`. `interleaveAndSchedule` los trata como grupos normales, igual que antes.)

- [ ] **Step 5: Programar fechas por UNIDAD (una secuencia = una fecha contigua)**

En `lib/campaigns/planner.ts`, reemplazar `interleaveAndSchedule` por una versión que respete secuencias. Cambiar su cuerpo a:

```ts
function interleaveAndSchedule(
  groups: PlanItemDraft[][],
  dateStart: Date,
  dateEnd: Date,
): PlanItemDraft[] {
  // Unidad de calendario: un grupo-secuencia (sequenceId != null) cuenta como
  // UNA unidad (sus escenas comparten fecha y quedan contiguas); los grupos
  // normales se intercalan item-a-item como antes.
  const sequenceUnits = groups.filter((g) => g[0]?.sequenceId != null);
  const normalGroups = groups.filter((g) => g[0]?.sequenceId == null);

  const interleavedNormals: PlanItemDraft[] = [];
  const maxLen = Math.max(0, ...normalGroups.map((arr) => arr.length));
  for (let i = 0; i < maxLen; i++) {
    for (const arr of normalGroups) if (arr[i]) interleavedNormals.push(arr[i]);
  }

  // Unidades en orden: items normales (cada uno su unidad) + cada secuencia.
  const units: PlanItemDraft[][] = [
    ...interleavedNormals.map((it) => [it]),
    ...sequenceUnits,
  ];
  const rangeMs = Math.max(0, dateEnd.getTime() - dateStart.getTime());
  const step = units.length > 1 ? rangeMs / (units.length - 1) : 0;
  const out: PlanItemDraft[] = [];
  units.forEach((unit, idx) => {
    const date = isoDate(new Date(dateStart.getTime() + step * idx));
    for (const item of unit) {
      item.scheduledDate = date;
      out.push(item);
    }
  });
  return out;
}
```

- [ ] **Step 6: Correr los tests para verlos pasar**

Run: `pnpm vitest run lib/campaigns/campaigns.test.ts`
Expected: PASS. Si fallan otros tests del planner por el cambio de `interleaveAndSchedule`, revisar que los grupos normales conservan el intercalado (mismo comportamiento para `sequenceId == null`).

- [ ] **Step 7: Typecheck y commit**

```bash
pnpm typecheck
git add lib/campaigns/planner.ts lib/campaigns/campaigns.test.ts
git commit -m "feat(campaigns): el planner expande una secuencia a N items ordenados"
```

---

## Task 4: Server action — persistir campos + `mergeSequenceAction`

**Files:**
- Modify: `lib/schemas/campaigns.ts` (`MergeSequenceSchema`)
- Modify: `server-actions/campaigns.ts` (insert + `mergeSequenceAction`; conectar `directed` con `scenes`/`sequenceLabel`)
- Test: `lib/campaigns/campaigns.test.ts`

- [ ] **Step 1: Conectar el matcher con `DirectedIdea` (campos nuevos)**

En `server-actions/campaigns.ts`, en los 3 lugares donde se hace `directed.push({ format, count, durationS, scenePrompt, sceneSummary, characterIds, invented })` (alrededor de las líneas 447, 464, 492), añadir a cada objeto:

```ts
        scenes: m.scenes,
        sequenceLabel: m.sequenceLabel,
```

- [ ] **Step 2: Mapear los campos nuevos en el insert**

En `server-actions/campaigns.ts`, en el `.insert(items.map((i) => ({ ... })))` (~línea 612), añadir al objeto:

```ts
      sequence_id: i.sequenceId,
      scene_index: i.sceneIndex,
      sequence_label: i.sequenceLabel,
```

- [ ] **Step 3: Escribir el test de `mergeSequenceAction` (que falla)**

En `lib/campaigns/campaigns.test.ts`, añadir un test que valide el schema y la lógica de unión. Usar el mismo patrón de mock de Supabase del archivo (revisar helpers existentes en el test). Test mínimo del schema + cálculo de duración:

```ts
import { MergeSequenceSchema } from '@/lib/schemas/campaigns';

it('MergeSequenceSchema exige uuids de secuencia y campaña', () => {
  expect(MergeSequenceSchema.safeParse({ sequenceId: 'no-uuid', campaignId: 'x' }).success).toBe(false);
  const ok = MergeSequenceSchema.safeParse({
    sequenceId: '00000000-0000-0000-0000-000000000001',
    campaignId: '00000000-0000-0000-0000-000000000002',
  });
  expect(ok.success).toBe(true);
});

it('mergeScenePrompts une por saltos de linea y capa la duracion a 15', () => {
  const { joinedPrompt, mergedDuration } = mergeScenes([
    { scene_prompt: 'A', duration_s: 6 },
    { scene_prompt: 'B', duration_s: 6 },
    { scene_prompt: 'C', duration_s: 6 },
  ]);
  expect(joinedPrompt).toBe('A\nB\nC');
  expect(mergedDuration).toBe(15); // 18 -> capado a 15
});
```

- [ ] **Step 4: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/campaigns.test.ts`
Expected: FAIL — `MergeSequenceSchema` y `mergeScenes` no existen.

- [ ] **Step 5: Añadir `MergeSequenceSchema`**

En `lib/schemas/campaigns.ts`, tras `UpdateCampaignItemSchema`:

```ts
export const MergeSequenceSchema = z.object({
  sequenceId: z.string().uuid(),
  campaignId: z.string().uuid(),
});
```

- [ ] **Step 6: Implementar `mergeScenes` (módulo puro) + `mergeSequenceAction`**

`server-actions/campaigns.ts` tiene `'use server'`: solo puede exportar funciones async. Por eso el helper puro `mergeScenes` vive en un módulo aparte. Create `lib/campaigns/merge.ts`:

```ts
// Une las escenas de una secuencia en un solo clip: concatena prompts y capa la
// duracion total a 15s (tope de un clip Seedance). Puro: testeable sin DB.
export function mergeScenes(
  rows: Array<{ scene_prompt: string; duration_s: number | null }>,
): { joinedPrompt: string; mergedDuration: number } {
  const joinedPrompt = rows.map((r) => r.scene_prompt).join('\n');
  const sum = rows.reduce((acc, r) => acc + (r.duration_s ?? 0), 0);
  return { joinedPrompt, mergedDuration: Math.min(Math.max(4, sum || 4), 15) };
}
```

En `server-actions/campaigns.ts`, importar `mergeScenes` desde `'@/lib/campaigns/merge'` y añadir la acción:

```ts
export async function mergeSequenceAction(input: unknown): Promise<Result<{ merged: true }>> {
  const parsed = MergeSequenceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation_error', message: parsed.error.message };
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Ownership + estado: todas las escenas deben ser de la campaña del workspace
  // y estar en 'planned' (sin generar).
  const { data: rows } = await supabase
    .from('campaign_items')
    .select('id, status, scene_prompt, duration_s, format_id, model_slug, aspect_ratio, scene, audio, character_id, character_ids, caption, scheduled_date, sequence_label, campaigns!inner(workspace_id)')
    .eq('campaign_id', parsed.data.campaignId)
    .eq('sequence_id', parsed.data.sequenceId)
    .order('scene_index', { ascending: true });

  if (!rows || rows.length === 0) return { ok: false, error: 'not_found' };
  const ws = (rows[0] as { campaigns?: { workspace_id?: string } }).campaigns?.workspace_id;
  if (ws !== workspace.id) return { ok: false, error: 'not_found' };
  if (rows.some((r) => r.status !== 'planned')) {
    return { ok: false, error: 'validation_error', message: 'No se puede unir: alguna escena ya se generó' };
  }

  const first = rows[0] as Record<string, unknown>;
  const { joinedPrompt, mergedDuration } = mergeScenes(
    rows.map((r) => ({ scene_prompt: r.scene_prompt as string, duration_s: r.duration_s as number | null })),
  );

  const { error: delErr } = await supabase
    .from('campaign_items').delete()
    .eq('campaign_id', parsed.data.campaignId).eq('sequence_id', parsed.data.sequenceId);
  if (delErr) return { ok: false, error: 'internal_error', message: delErr.message };

  const { error: insErr } = await supabase.from('campaign_items').insert({
    campaign_id: parsed.data.campaignId,
    format_id: first.format_id, model_slug: first.model_slug, duration_s: mergedDuration,
    aspect_ratio: first.aspect_ratio, scene: first.scene, audio: first.audio,
    character_id: first.character_id, character_ids: first.character_ids,
    scene_prompt: joinedPrompt, scene_summary: null, caption: first.caption,
    scheduled_date: first.scheduled_date, status: 'planned',
    sequence_id: null, scene_index: null, sequence_label: null,
  });
  if (insErr) return { ok: false, error: 'internal_error', message: insErr.message };

  revalidatePath(`/app/campaigns/${parsed.data.campaignId}`);
  return { ok: true, data: { merged: true } };
}
```

Importar `MergeSequenceSchema` en el bloque de imports de `server-actions/campaigns.ts`.

En el test del Step 3, importar `mergeScenes` desde `'@/lib/campaigns/merge'`.

- [ ] **Step 7: Correr los tests para verlos pasar**

Run: `pnpm vitest run lib/campaigns/campaigns.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck y commit**

```bash
pnpm typecheck
git add lib/schemas/campaigns.ts server-actions/campaigns.ts lib/campaigns/campaigns.test.ts
git commit -m "feat(campaigns): persiste la secuencia y agrega mergeSequenceAction"
```

---

## Task 5: Helper de agrupado + UI de la secuencia

**Files:**
- Create: `lib/campaigns/plan-grouping.ts`
- Create: `lib/campaigns/plan-grouping.test.ts`
- Modify: `components/campaigns/CampaignStudioView.tsx` (render del tab 'plan', ~línea 370)

- [ ] **Step 1: Escribir el test del helper (que falla)**

Create `lib/campaigns/plan-grouping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupPlanItems } from './plan-grouping';

type I = Parameters<typeof groupPlanItems>[0][number];
const item = (over: Partial<I>): I => ({
  id: 'x', sequenceId: null, sceneIndex: null, sequenceLabel: null, ...over,
}) as I;

describe('groupPlanItems', () => {
  it('agrupa por sequenceId, ordena por sceneIndex y conserva singles', () => {
    const groups = groupPlanItems([
      item({ id: 'a' }),
      item({ id: 's2', sequenceId: 'seq1', sceneIndex: 1, sequenceLabel: 'Anuncio' }),
      item({ id: 's1', sequenceId: 'seq1', sceneIndex: 0, sequenceLabel: 'Anuncio' }),
      item({ id: 'b' }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ kind: 'single', item: expect.objectContaining({ id: 'a' }) });
    const seq = groups.find((g) => g.kind === 'sequence');
    expect(seq).toBeDefined();
    if (seq?.kind === 'sequence') {
      expect(seq.label).toBe('Anuncio');
      expect(seq.scenes.map((s) => s.id)).toEqual(['s1', 's2']); // ordenadas
    }
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm vitest run lib/campaigns/plan-grouping.test.ts`
Expected: FAIL — módulo `./plan-grouping` no existe.

- [ ] **Step 3: Implementar el helper**

Create `lib/campaigns/plan-grouping.ts`:

```ts
// Agrupa los items del plan para la UI: las escenas de una misma secuencia se
// colapsan en un grupo ordenado por sceneIndex; los creativos normales quedan
// como 'single'. Mantiene el orden de primera aparición de cada secuencia.

export type PlanItemLike = {
  id: string;
  sequenceId: string | null;
  sceneIndex: number | null;
  sequenceLabel: string | null;
};

export type PlanGroup<T extends PlanItemLike> =
  | { kind: 'single'; item: T }
  | { kind: 'sequence'; sequenceId: string; label: string | null; scenes: T[] };

export function groupPlanItems<T extends PlanItemLike>(items: T[]): Array<PlanGroup<T>> {
  const out: Array<PlanGroup<T>> = [];
  const seqIndex = new Map<string, number>(); // sequenceId -> índice en out

  for (const item of items) {
    if (item.sequenceId == null) {
      out.push({ kind: 'single', item });
      continue;
    }
    const at = seqIndex.get(item.sequenceId);
    if (at === undefined) {
      seqIndex.set(item.sequenceId, out.length);
      out.push({ kind: 'sequence', sequenceId: item.sequenceId, label: item.sequenceLabel, scenes: [item] });
    } else {
      (out[at] as Extract<PlanGroup<T>, { kind: 'sequence' }>).scenes.push(item);
    }
  }

  for (const g of out) {
    if (g.kind === 'sequence') {
      g.scenes.sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0));
    }
  }
  return out;
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm vitest run lib/campaigns/plan-grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Integrar en `CampaignStudioView` (tab 'plan')**

En `components/campaigns/CampaignStudioView.tsx`:

1. Importar el helper y la acción:

```ts
import { groupPlanItems } from '@/lib/campaigns/plan-grouping';
import { mergeSequenceAction } from '@/server-actions/campaigns';
```

2. Asegurar que el tipo local del item (estado `items`) incluye `sequenceId`, `sceneIndex`, `sequenceLabel` (mapearlos donde se construyen los items desde las filas de `campaign_items`: `sequence_id` → `sequenceId`, etc.). Buscar el mapeo fila→item (donde se leen `scene_prompt`/`scene_summary`) y añadir los 3 campos.

3. En el render del tab 'plan' (~línea 370, `{items.map((item) => (...))}`), envolver con el agrupado:

```tsx
{groupPlanItems(items).map((group) =>
  group.kind === 'single' ? (
    <PlanItemCard key={group.item.id} item={group.item} /* props existentes del item */ />
  ) : (
    <div key={group.sequenceId} className="rounded-lg border border-zinc-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm text-zinc-300">
          {group.label ?? 'Secuencia'} · {group.scenes.length} escenas
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">sugerida por IA</span>
        </div>
        <button
          type="button"
          className="text-xs text-zinc-400 hover:text-zinc-200"
          onClick={() => handleMergeSequence(group.sequenceId)}
        >
          Unir en 1 clip
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {group.scenes.map((scene, i) => (
          <div key={scene.id} className="flex items-start gap-2">
            <span className="mt-1 text-xs text-zinc-500">{i + 1}</span>
            <div className="flex-1">
              <PlanItemCard item={scene} /* props existentes del item */ />
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
)}
```

Nota: `PlanItemCard` es el JSX que hoy ya renderiza cada item dentro del `.map` de la línea 370 — extraerlo a un componente/inline reutilizable o repetir el markup existente para `single` y para cada `scene`. Mantener todas las props/handlers actuales del item (editar, agendar, generar, winner, borrar).

4. Añadir el handler:

```ts
const handleMergeSequence = async (sequenceId: string) => {
  const res = await mergeSequenceAction({ sequenceId, campaignId: campaign.id });
  if (res.ok) {
    // La revalidación del server action refresca; o actualizar estado local
    // quitando las escenas de la secuencia. Seguir el patrón de los otros
    // handlers (p.ej. delete) para el update optimista.
    setItems((prev) => prev.filter((i) => i.sequenceId !== sequenceId));
  }
};
```

- [ ] **Step 6: Typecheck, lint y correr toda la suite**

Run:
```bash
pnpm typecheck
pnpm eslint lib/campaigns/plan-grouping.ts components/campaigns/CampaignStudioView.tsx
pnpm vitest run
```
Expected: typecheck limpio, lint limpio, todos los tests verdes.

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/plan-grouping.ts lib/campaigns/plan-grouping.test.ts components/campaigns/CampaignStudioView.tsx
git commit -m "feat(campaigns): UI de secuencia en el plan con union a 1 clip"
```

---

## Verificación final (manual, lo corre el usuario)

1. Aplicar la migración 035 al proyecto Supabase.
2. En el wizard de campaña, pegar un guion de 15s con actos y diálogo → el plan debe mostrar una **secuencia** (N escenas en orden, etiquetada), no un creativo genérico.
3. "Unir en 1 clip" → la secuencia se colapsa a un solo item con el timeline unido.
4. Generar una escena → su status llega por realtime como cualquier item.
5. Una idea corta normal sigue produciendo un creativo suelto (sin secuencia).

> Smoke con API real (Gemini) lo corre el usuario; los tests del repo no llaman APIs reales.
