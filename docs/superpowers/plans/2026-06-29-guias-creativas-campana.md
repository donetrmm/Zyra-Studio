# Guías creativas por campaña — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir guías creativas estructuradas opt-in por campaña (`showFullProduct`, `hookProductHero`, `safeCrop`) que solo afectan a las campañas que las prenden, sin filtrarse a otros videos.

**Architecture:** Columna `creative_guidelines` jsonb en `campaigns`. El compilador (video + panel) emite cláusulas deterministas gateadas por flag = backbone que arregla campañas existentes al regenerar. El matcher LLM recibe las guías como capa de autoría (gateada por timing). UI explícita en la página de campaña, default todo apagado.

**Tech Stack:** Next.js 15, TypeScript strict, zod, Supabase (jsonb), vitest, shadcn/ui.

## Global Constraints

- Sin emojis en código ni UI.
- Sin `any`: usar `unknown` + narrowing o tipo explícito.
- Gestor de paquetes: `pnpm` (`pnpm vitest`, `pnpm typecheck`, `pnpm lint`, `pnpm build`).
- Commits SIN trailer `Co-Authored-By`.
- `'use server'` solo exporta funciones async (validar con `pnpm build`, no solo typecheck).
- Tests sin APIs reales (no llamar a Gemini/Seedance/etc.). El matcher se testea por su helper de prompt PURO, no llamando al LLM.
- Archivos nuevos UTF-8 SIN BOM.
- Cláusulas de prompt: ASCII, cada una empieza con espacio (concatenable), gateada por flag.
- La migración se aplica vía MCP Supabase **antes** de pushear el código que lee la columna (orden migración→deploy: prod no auto-aplica).
- No cambiar nombres de tablas/columnas/RLS sin actualizar el spec en paralelo.

---

## File Structure

- `supabase/migrations/049_campaign_creative_guidelines.sql` — crea la columna.
- `lib/campaigns/guidelines.ts` — `CreativeGuidelinesSchema`, tipo, helper puro de cláusulas.
- `lib/campaigns/guidelines.test.ts` — tests del schema y del helper.
- `lib/prompt-director/types.ts` — `DirectorContext.guidelines?`, `CompileRequest.isOpeningBeat?`.
- `lib/prompt-director/compilers/seedance.ts` — emite cláusulas (video).
- `lib/prompt-director/compilers/flux.ts`, `lib/prompt-director/compilers/nano-banana.ts` — emiten cláusulas (panel).
- `lib/prompt-director/prompt-director.test.ts` — tests de cláusulas en el prompt compilado.
- `lib/campaigns/orchestrator.ts` — `CampaignContext.guidelines`, lectura en `loadCampaignContext`, mapeo en `directorContextFor`, `isOpeningBeat` en el `compile` del video.
- `lib/campaigns/director-context.test.ts` — flujo de guías + `isOpeningBeat`.
- `server-actions/storyboard.ts` — `isOpeningBeat` en el `compile` del panel.
- `server-actions/campaigns.ts` — `setCreativeGuidelinesAction`; `guidelines` a `matchIdeas` en `generatePlanAction`.
- `components/campaigns/CreativeGuidelinesEditor.tsx` — editor cliente.
- `components/campaigns/CampaignStudioView.tsx` — monta el editor; tipo `StudioCampaign` gana `guidelines`.
- `app/app/campaigns/[id]/page.tsx` — pasa `creative_guidelines` a la vista.
- `lib/prompt-director/format-matcher.ts` — helper puro del system prompt + param `guidelines`.
- `lib/prompt-director/format-matcher.test.ts` — el helper incluye las líneas de guía cuando aplican.

---

## Task 1: Data foundation (migración + schema + helper de cláusulas)

**Files:**
- Create: `supabase/migrations/049_campaign_creative_guidelines.sql`
- Create: `lib/campaigns/guidelines.ts`
- Test: `lib/campaigns/guidelines.test.ts`

**Interfaces:**
- Produces: `CreativeGuidelinesSchema` (zod), `type CreativeGuidelines`, `creativeGuidelineClauses(guidelines: CreativeGuidelines | undefined, opts?: { isOpeningBeat?: boolean }): string`.

- [ ] **Step 1: Escribir el test de schema y helper**

```ts
// lib/campaigns/guidelines.test.ts
import { describe, it, expect } from 'vitest';
import { CreativeGuidelinesSchema, creativeGuidelineClauses } from './guidelines';

describe('CreativeGuidelinesSchema', () => {
  it('acepta flags válidos y tolera ausencia (todo apagado)', () => {
    expect(CreativeGuidelinesSchema.parse({}).showFullProduct).toBeUndefined();
    expect(CreativeGuidelinesSchema.parse({ showFullProduct: true, safeCrop: '4:5' }).safeCrop).toBe('4:5');
    expect(CreativeGuidelinesSchema.parse({ safeCrop: null }).safeCrop).toBeNull();
  });
  it('rechaza safeCrop inválido', () => {
    expect(CreativeGuidelinesSchema.safeParse({ safeCrop: '16:9' }).success).toBe(false);
  });
});

describe('creativeGuidelineClauses', () => {
  it('sin guías o vacío: cadena vacía', () => {
    expect(creativeGuidelineClauses(undefined)).toBe('');
    expect(creativeGuidelineClauses({})).toBe('');
  });
  it('showFullProduct emite su cláusula', () => {
    const out = creativeGuidelineClauses({ showFullProduct: true });
    expect(out).toContain('frame it complete and unobstructed');
    expect(out.startsWith(' ')).toBe(true);
  });
  it('hookProductHero solo dispara en el beat de apertura', () => {
    expect(creativeGuidelineClauses({ hookProductHero: true }, { isOpeningBeat: false })).toBe('');
    expect(creativeGuidelineClauses({ hookProductHero: true }, { isOpeningBeat: true })).toContain('opening hook');
  });
  it('safeCrop 4:5 emite la cláusula de encuadre seguro', () => {
    expect(creativeGuidelineClauses({ safeCrop: '4:5' })).toContain('central 4:5 area');
  });
  it('es ASCII puro', () => {
    const out = creativeGuidelineClauses({ showFullProduct: true, hookProductHero: true, safeCrop: '4:5' }, { isOpeningBeat: true });
    expect(/^[\x00-\x7F]*$/.test(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test (falla: módulo inexistente)**

Run: `pnpm vitest run lib/campaigns/guidelines.test.ts`
Expected: FAIL ("Cannot find module './guidelines'").

- [ ] **Step 3: Implementar `guidelines.ts`**

```ts
// lib/campaigns/guidelines.ts
// Guías creativas estructuradas por campaña (spec 2026-06-29). Opt-in: ausente o
// apagado = comportamiento actual. NO depende de product_brief (vive en su propia
// columna creative_guidelines).
import { z } from 'zod';

export const CreativeGuidelinesSchema = z.object({
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
});
export type CreativeGuidelines = z.infer<typeof CreativeGuidelinesSchema>;

// Cláusulas deterministas para el prompt (video y panel). ASCII, cada una empieza
// con espacio (concatenable). Gateadas por flag: una guía apagada no emite nada.
// `isOpeningBeat` habilita el hook-hero SOLO en el beat de apertura del creativo.
export function creativeGuidelineClauses(
  guidelines: CreativeGuidelines | undefined,
  opts: { isOpeningBeat?: boolean } = {},
): string {
  if (!guidelines) return '';
  let out = '';
  if (guidelines.showFullProduct) {
    out +=
      ' When the product is on screen, frame it complete and unobstructed; avoid crops that cut off the product, unless the beat is a deliberate detail shot.';
  }
  if (guidelines.hookProductHero && opts.isOpeningBeat) {
    out +=
      ' This is the opening hook: present the full product as the clear hero of the frame, shown large and complete from the first beat.';
  }
  if (guidelines.safeCrop === '4:5') {
    out +=
      ' Crop-safe framing: keep all key elements (the product and any faces) within the central 4:5 area of the vertical frame; place nothing essential in the extreme top or bottom, so the shot can be cropped to 4:5 without losing key content.';
  }
  return out;
}
```

- [ ] **Step 4: Crear la migración**

```sql
-- supabase/migrations/049_campaign_creative_guidelines.sql
-- Guias creativas por campana (spec 2026-06-29). Structured, opt-in. jsonb con
-- showFullProduct / hookProductHero / safeCrop. Default '{}' = todo apagado =
-- comportamiento actual. RLS hereda las policies de campaigns (sin cambios).
alter table public.campaigns
  add column if not exists creative_guidelines jsonb not null default '{}'::jsonb;
```

- [ ] **Step 5: Correr el test (pasa)**

Run: `pnpm vitest run lib/campaigns/guidelines.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/campaigns/guidelines.ts lib/campaigns/guidelines.test.ts supabase/migrations/049_campaign_creative_guidelines.sql
git commit -m "feat(campaigns): schema + helper de guias creativas + migracion 049"
```

> Nota de despliegue (NO es paso de código): aplicar `049` vía MCP Supabase antes de pushear el código de la Task 3 (que lee la columna). Sin la columna, `loadCampaignContext` no falla en tests (recibe el campaign por parámetro), pero en prod un select de la columna inexistente da 500.

---

## Task 2: Compilador emite las cláusulas (video + panel)

**Files:**
- Modify: `lib/prompt-director/types.ts` (añadir campos)
- Modify: `lib/prompt-director/compilers/seedance.ts`
- Modify: `lib/prompt-director/compilers/flux.ts`
- Modify: `lib/prompt-director/compilers/nano-banana.ts`
- Test: `lib/prompt-director/prompt-director.test.ts`

**Interfaces:**
- Consumes: `creativeGuidelineClauses` (Task 1), `CreativeGuidelines` (Task 1).
- Produces: `DirectorContext.guidelines?: CreativeGuidelines`, `CompileRequest.isOpeningBeat?: boolean`. Los compiladores anexan las cláusulas al prompt.

- [ ] **Step 1: Escribir el test de compilación**

En `lib/prompt-director/prompt-director.test.ts`, añadir un bloque. Reusa el helper de compilación existente del archivo (mira cómo otros tests construyen `CompileRequest` + `DirectorContext` y llaman `compile`). Asegura que el `DirectorContext` incluya un `product` (para que la escena tenga sentido) y setea `guidelines` + `isOpeningBeat`.

```ts
describe('guías creativas en el prompt compilado', () => {
  it('showFullProduct y safeCrop on → sus cláusulas presentes', () => {
    const res = compile(
      { modelSlug: SEEDANCE_SLUG, scenePrompt: 'The presenter shows the product and speaks one line.', generateAudio: true },
      { ...baseDirCtx, guidelines: { showFullProduct: true, safeCrop: '4:5' } },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compiled.prompt).toContain('frame it complete and unobstructed');
    expect(res.compiled.prompt).toContain('central 4:5 area');
  });
  it('hookProductHero solo en el beat de apertura', () => {
    const off = compile(
      { modelSlug: SEEDANCE_SLUG, scenePrompt: 'The presenter speaks.', generateAudio: true, isOpeningBeat: false },
      { ...baseDirCtx, guidelines: { hookProductHero: true } },
    );
    const on = compile(
      { modelSlug: SEEDANCE_SLUG, scenePrompt: 'The presenter speaks.', generateAudio: true, isOpeningBeat: true },
      { ...baseDirCtx, guidelines: { hookProductHero: true } },
    );
    expect(off.ok && !off.compiled.prompt.includes('opening hook')).toBe(true);
    expect(on.ok && on.compiled.prompt.includes('opening hook')).toBe(true);
  });
  it('sin guías: ninguna cláusula', () => {
    const res = compile(
      { modelSlug: SEEDANCE_SLUG, scenePrompt: 'The presenter speaks.', generateAudio: true },
      baseDirCtx,
    );
    expect(res.ok && !res.compiled.prompt.includes('Crop-safe framing')).toBe(true);
  });
});
```

> Reemplaza `SEEDANCE_SLUG` y `baseDirCtx` por las constantes/builders que ya usa el archivo de test (búscalos al inicio del describe principal). Si no hay un `baseDirCtx` reutilizable, constrúyelo con un `product` mínimo como en los otros tests.

- [ ] **Step 2: Correr el test (falla: campos y cláusulas inexistentes)**

Run: `pnpm vitest run lib/prompt-director/prompt-director.test.ts -t "guías creativas"`
Expected: FAIL (TS: `guidelines`/`isOpeningBeat` no existen; o cláusulas ausentes).

- [ ] **Step 3: Añadir los campos a los tipos**

En `lib/prompt-director/types.ts`:
- En `DirectorContext` (acaba en `language?: 'es' | 'en';`), añadir:
```ts
  // Guías creativas opt-in de la campaña (spec 2026-06-29). Gatean cláusulas
  // deterministas de encuadre. Ausente = ninguna.
  guidelines?: import('@/lib/campaigns/guidelines').CreativeGuidelines;
```
> Si el archivo evita imports de tipo inline, añade un `import type { CreativeGuidelines } from '@/lib/campaigns/guidelines';` arriba y usa `guidelines?: CreativeGuidelines;`. Evita ciclos: `guidelines.ts` no importa de `types.ts`.
- En `CompileRequest` (tras `seed?: number;`), añadir:
```ts
  // El beat es la apertura del creativo (scene_index 0 o clip único). Habilita
  // la guía hookProductHero. Default undefined/false.
  isOpeningBeat?: boolean;
```

- [ ] **Step 4: Emitir las cláusulas en seedance (video)**

En `lib/prompt-director/compilers/seedance.ts`, importar el helper:
```ts
import { creativeGuidelineClauses } from '@/lib/campaigns/guidelines';
```
Tras el push de la sección de formato (la sección F, `sections.push(direction)`), añadir:
```ts
  // Guías creativas opt-in de la campaña: encuadre producto-completo / hook-hero /
  // recorte seguro. Gateadas por flag; el hook-hero solo en el beat de apertura.
  const guidelineClauses = creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: req.isOpeningBeat });
  if (guidelineClauses) sections.push(guidelineClauses.trim());
```
> `req` es el `CompileRequest` y `ctx` el `DirectorContext` dentro de la función de compilación; usa los nombres reales de los parámetros de ese archivo.

- [ ] **Step 5: Emitir las cláusulas en los compiladores de panel (flux + nano-banana)**

En `lib/prompt-director/compilers/flux.ts` y `lib/prompt-director/compilers/nano-banana.ts`, importar `creativeGuidelineClauses` y anexar su salida al prompt del panel **siguiendo el patrón con que ese archivo añade cláusulas obligatorias** (busca cómo concatena las directivas finales — p. ej. la cláusula de "no texto" o el negativo). El panel es el fotograma de apertura, así que las tres guías aplican. Pasar `{ isOpeningBeat: req.isOpeningBeat }`.

- [ ] **Step 6: Correr typecheck + el test (pasa)**

Run: `pnpm typecheck && pnpm vitest run lib/prompt-director/prompt-director.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/compilers/seedance.ts lib/prompt-director/compilers/flux.ts lib/prompt-director/compilers/nano-banana.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(prompt-director): emitir clausulas de guias creativas en video y panel"
```

---

## Task 3: Orchestrator + panel threading (lectura DB + isOpeningBeat)

**Files:**
- Modify: `lib/campaigns/orchestrator.ts`
- Modify: `server-actions/storyboard.ts`
- Test: `lib/campaigns/director-context.test.ts`

**Interfaces:**
- Consumes: `CreativeGuidelinesSchema` (Task 1), `DirectorContext.guidelines`/`CompileRequest.isOpeningBeat` (Task 2).
- Produces: `CampaignContext.guidelines?: CreativeGuidelines`; `directorContextFor` mapea `ctx.guidelines → DirectorContext.guidelines`; ambos sitios de `compile` (video y panel) setean `isOpeningBeat`.

- [ ] **Step 1: Test del flujo en director-context**

En `lib/campaigns/director-context.test.ts`, añadir un caso: dada una `CampaignContext` con `guidelines: { showFullProduct: true }`, `directorContextFor(...)` devuelve un `DirectorContext` cuyo `guidelines.showFullProduct === true`. Sigue cómo el archivo construye el `CampaignContext` y llama `directorContextFor` en los tests existentes.

```ts
it('directorContextFor propaga las guías creativas de la campaña', () => {
  const ctx = { ...baseCtx, guidelines: { showFullProduct: true, safeCrop: '4:5' as const } };
  const dir = directorContextFor(baseItem, baseFormat, ctx);
  expect(dir.guidelines?.showFullProduct).toBe(true);
  expect(dir.guidelines?.safeCrop).toBe('4:5');
});
```
> `baseCtx`/`baseItem`/`baseFormat` = los builders que ya use el archivo.

- [ ] **Step 2: Correr el test (falla)**

Run: `pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: FAIL (`guidelines` no se propaga).

- [ ] **Step 3: `CampaignContext.guidelines` + lectura en `loadCampaignContext`**

En `lib/campaigns/orchestrator.ts`:
- Importar arriba: `import { CreativeGuidelinesSchema, type CreativeGuidelines } from './guidelines';`
- En `type CampaignContext` (~L100), añadir: `guidelines?: CreativeGuidelines;`
- En `loadCampaignContext`: el parámetro `campaign` (~L210-216) debe incluir la columna nueva. Añadir a su tipo `creative_guidelines: Record<string, unknown> | null;` y parsear con tolerancia:
```ts
  const guidelinesParsed = CreativeGuidelinesSchema.safeParse(campaign.creative_guidelines ?? {});
  const guidelines = guidelinesParsed.success ? guidelinesParsed.data : {};
```
y setear `guidelines` en el objeto `CampaignContext` que retorna.
> El SELECT real que llena `campaign` está en el caller (`runCampaignBatch`/la action que llama `loadCampaignContext`): añade `creative_guidelines` a la lista de columnas de ESE select. Busca el `.select(...)` que trae `product_brief` para la campaña y añade `creative_guidelines`.

- [ ] **Step 4: `directorContextFor` mapea las guías**

En `directorContextFor` (~L329), donde arma el objeto `DirectorContext` de retorno, añadir `guidelines: ctx.guidelines,`.

- [ ] **Step 5: `isOpeningBeat` en el compile del VIDEO**

En `orchestrator.ts` el `compile(...)` del video (~L850-859), añadir al `CompileRequest`:
```ts
        isOpeningBeat: (item.scene_index ?? 0) === 0,
```
(clip único `scene_index = null → ?? 0 → 0 → true`; en secuencia, solo el beat 0).

- [ ] **Step 6: `isOpeningBeat` en el compile del PANEL**

En `server-actions/storyboard.ts`, localizar el `compile(...)` que arma el prompt del panel (la rama fresca/encadenada usa el `compiled`). Añadir `isOpeningBeat: (item.scene_index ?? 0) === 0` a su `CompileRequest`. El `dirCtx` del panel ya pasa por `directorContextFor`/`loadCampaignContext`, así que `guidelines` fluye solo tras Steps 3-4.
> Verifica que el panel construye su `DirectorContext` vía `directorContextFor` o `loadCampaignContext`; si usa otro camino, propaga `guidelines` igual ahí.

- [ ] **Step 7: Correr typecheck + tests**

Run: `pnpm typecheck && pnpm vitest run lib/campaigns/director-context.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/campaigns/orchestrator.ts server-actions/storyboard.ts lib/campaigns/director-context.test.ts
git commit -m "feat(campaigns): leer creative_guidelines y propagar guias + isOpeningBeat al compilador"
```

---

## Task 4: Server action + UI (editor en la página de campaña)

**Files:**
- Modify: `server-actions/campaigns.ts` (`setCreativeGuidelinesAction`)
- Create: `components/campaigns/CreativeGuidelinesEditor.tsx`
- Modify: `components/campaigns/CampaignStudioView.tsx`
- Modify: `app/app/campaigns/[id]/page.tsx`

**Interfaces:**
- Consumes: `CreativeGuidelinesSchema` (Task 1).
- Produces: `setCreativeGuidelinesAction({ id, showFullProduct?, hookProductHero?, safeCrop? })`.

- [ ] **Step 1: `setCreativeGuidelinesAction`**

En `server-actions/campaigns.ts`, junto a `setProductDimensionsAction`, añadir una action que **espeja su patrón** (zod + `requireWorkspace` + ownership + read-modify-write del jsonb). Schema local:
```ts
const SetCreativeGuidelinesSchema = z.object({
  id: z.string().uuid(),
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
});
```
La action lee `creative_guidelines` (default `{}`), mergea los campos provistos (undefined = no tocar; `safeCrop: null` = quitar recorte) y hace `update({ creative_guidelines })` con guard de ownership por workspace. Devuelve `Result`. NO exportar objetos desde el módulo `'use server'` (solo la función async).

- [ ] **Step 2: Componente `CreativeGuidelinesEditor`**

Crear `components/campaigns/CreativeGuidelinesEditor.tsx` espejando `ProductSizeEditor` (tarjeta con borde, icono lucide, título, descripción). Controles:
- `Switch` "Mostrar el producto completo" → `showFullProduct`.
- `Switch` "Hook con el producto al 100%" → `hookProductHero`.
- `Select` "Recorte seguro": opciones "Ninguno" (`null`) y "4:5" (`'4:5'`) → `safeCrop`.
- Botón "Guardar guías" → `setCreativeGuidelinesAction`, toast de éxito/error. Sin emojis.

```tsx
'use client';
import { useState, useTransition } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { setCreativeGuidelinesAction } from '@/server-actions/campaigns';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function CreativeGuidelinesEditor({
  campaignId,
  initial,
}: {
  campaignId: string;
  initial?: { showFullProduct?: boolean; hookProductHero?: boolean; safeCrop?: '4:5' | null };
}) {
  const [showFullProduct, setShowFullProduct] = useState(initial?.showFullProduct ?? false);
  const [hookProductHero, setHookProductHero] = useState(initial?.hookProductHero ?? false);
  const [safeCrop, setSafeCrop] = useState<'4:5' | null>(initial?.safeCrop ?? null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const res = await setCreativeGuidelinesAction({ id: campaignId, showFullProduct, hookProductHero, safeCrop });
      if (res.ok) toast.success('Guías guardadas');
      else toast.error('No se pudieron guardar las guías');
    });
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-[#009fff]" aria-hidden />
        <h3 className="text-sm font-medium text-zinc-100">Guías creativas</h3>
        <span className="text-xs text-zinc-500">opcional</span>
      </div>
      <p className="mt-1 max-w-prose text-xs leading-relaxed text-zinc-400">
        Reglas de encuadre que aplican solo a esta campaña al generar y regenerar paneles y video.
        Apagadas, no cambian nada.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={showFullProduct} onCheckedChange={setShowFullProduct} />
          Mostrar el producto completo
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={hookProductHero} onCheckedChange={setHookProductHero} />
          Hook con el producto al 100%
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <Switch checked={safeCrop === '4:5'} onCheckedChange={(c) => setSafeCrop(c ? '4:5' : null)} />
          Encuadre recortable a 4:5
        </label>
      </div>
      <div className="mt-3">
        <Button type="button" variant="secondary" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Guardando...' : 'Guardar guías'}
        </Button>
      </div>
    </div>
  );
}
```
> Se usó un `Switch` para `safeCrop` (4:5 sí/no) en vez de un `Select` — más simple y v1 solo tiene un valor. Si luego hay más ratios, migrar a `Select`.

- [ ] **Step 3: Montar en `CampaignStudioView` + tipo**

En `components/campaigns/CampaignStudioView.tsx`:
- Importar `CreativeGuidelinesEditor`.
- En el tipo `StudioCampaign` (donde están `productHeightCm?`/`productWidthCm?`), añadir `guidelines?: { showFullProduct?: boolean; hookProductHero?: boolean; safeCrop?: '4:5' | null };`
- Montar junto al `ProductSizeEditor` (~L422):
```tsx
        <div className="mt-3">
          <CreativeGuidelinesEditor campaignId={campaign.id} initial={campaign.guidelines} />
        </div>
```

- [ ] **Step 4: Pasar el dato en `page.tsx`**

En `app/app/campaigns/[id]/page.tsx`, donde se arma el objeto `campaign` que recibe `CampaignStudioView` (incluye `productHeightCm`/etc.), añadir `guidelines` leído de `creative_guidelines` de la fila (parsear con `CreativeGuidelinesSchema` o pasar el jsonb tipado). Asegurar que el SELECT de la página trae `creative_guidelines`.

- [ ] **Step 5: Verificar build (server action + cliente)**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: typecheck/lint limpios; build OK (valida el boundary `'use server'`).

- [ ] **Step 6: Commit**

```bash
git add server-actions/campaigns.ts components/campaigns/CreativeGuidelinesEditor.tsx components/campaigns/CampaignStudioView.tsx app/app/campaigns/[id]/page.tsx
git commit -m "feat(campaigns): editor de guias creativas + setCreativeGuidelinesAction"
```

---

## Task 5: Inyección en el matcher (capa de autoría, secundaria)

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts`
- Test: `lib/prompt-director/format-matcher.test.ts`
- Modify: `server-actions/campaigns.ts` (`generatePlanAction` pasa `guidelines`)

**Interfaces:**
- Consumes: `CreativeGuidelines` (Task 1).
- Produces: helper puro exportado que arma el system prompt incluyendo las líneas de guía; `matchIdeas` acepta `guidelines?: CreativeGuidelines`.

- [ ] **Step 1: Test del helper puro**

En `lib/prompt-director/format-matcher.test.ts`, testear el helper que arma el SYSTEM prompt (NO se llama a Gemini). Con `showFullProduct: true` el texto incluye la línea de producto-completo; con `hookProductHero: true`, la del hook; sin guías, ninguna.

```ts
import { buildMatcherSystemPrompt } from './format-matcher';
it('el system prompt incluye las guías cuando aplican', () => {
  const withG = buildMatcherSystemPrompt({ guidelines: { showFullProduct: true, hookProductHero: true } });
  expect(withG).toMatch(/producto completo|full product/i);
  expect(withG).toMatch(/hook/i);
  const without = buildMatcherSystemPrompt({});
  expect(without).not.toMatch(/producto completo/i);
});
```
> Ajusta el nombre/forma del helper a lo que exista; si hoy el system prompt es un string inline dentro de `matchIdeas`, **extráelo** a `export function buildMatcherSystemPrompt(opts): string` y haz que `matchIdeas` lo use.

- [ ] **Step 2: Correr el test (falla)**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: FAIL (helper inexistente o sin guías).

- [ ] **Step 3: Extraer el helper + inyectar las guías**

En `format-matcher.ts`: extraer el armado del SYSTEM prompt a `buildMatcherSystemPrompt(opts: { ...lo que ya recibe..., guidelines?: CreativeGuidelines }): string`. Añadir, condicionalmente, líneas en el idioma del prompt del matcher:
- `showFullProduct`: "Prioriza encuadres que muestren el producto COMPLETO; evita close-ups extremos que lo recorten, salvo una toma de detalle deliberada."
- `hookProductHero`: "El primer beat (hook) debe encuadrar el producto completo como protagonista (héroe), a tamaño grande."
`matchIdeas` gana el param `guidelines?` y lo pasa a `buildMatcherSystemPrompt`. (`safeCrop` NO va al matcher — es composición pura del compilador.)

- [ ] **Step 4: `generatePlanAction` pasa las guías**

En `server-actions/campaigns.ts`, en `generatePlanAction`, cargar `creative_guidelines` de la campaña (parsear con `CreativeGuidelinesSchema`) y pasarlo a `matchIdeas({ ..., guidelines })`. (Timing: solo influye cuando las guías existen al generar el plan — re-generación; documentado en el spec.)

- [ ] **Step 5: Correr typecheck + test (pasa)**

Run: `pnpm typecheck && pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts server-actions/campaigns.ts
git commit -m "feat(matcher): inyectar guias creativas en el system prompt del matcher"
```

---

## Cierre

- [ ] Suite completa verde: `pnpm test`
- [ ] `pnpm typecheck && pnpm lint && pnpm build` limpios.
- [ ] Recordatorio de despliegue: aplicar migración `049` vía MCP **antes** de pushear; luego validar en "Anuncio #11" prendiendo las guías y regenerando panel + video.
