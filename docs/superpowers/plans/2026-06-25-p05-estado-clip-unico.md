# P05 — Estado del personaje en ideas de un solo clip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una idea de un solo clip declare el estado físico del personaje (mojado/sudado/…) — inferido por el matcher en paridad con secuencias — y que el usuario pueda fijarlo/limpiarlo a mano por item antes de generar.

**Architecture:** Dos componentes que comparten todo el downstream existente (orchestrator `directorContextFor`, compiler Seedance, columna `campaign_items.character_state_hint`). (A) IDEA: el matcher emite `characterStateHint` a nivel idea para el clip único; el planner lo propaga. (B) Override: un selector en el `EditItemDialog` existente escribe `character_state_hint` vía la action existente. Sin migración, sin tocar orchestrator ni compilers.

**Tech Stack:** TypeScript, Zod, Vitest, React (Next.js App Router), pnpm.

## Global Constraints

- **pnpm**: `pnpm typecheck`, `pnpm vitest run <archivo>`.
- **No `any`**: tipos explícitos (`unknown` + narrowing si hace falta).
- **No emojis** en código ni UI.
- **Tests sin APIs reales** (`feedback_no_real_api_in_tests`): el matcher se prueba con respuesta del modelo mockeada (como ya hace `format-matcher.test.ts`); el render del selector y el bake/render real los valida el smoke del usuario.
- **Match EXACTO de estado, sin fuzzy**: el orchestrator ya resuelve `character_state_hint` por label exacto y cae al master neutro si no matchea (NO se cambia).
- **Sin migración**: la columna `campaign_items.character_state_hint` ya existe (migración 045, aplicada).
- **Determinismo del OFICIO intacto**: la inferencia es capa IDEA (el matcher sugiere); la resolución determinista no cambia. El override es input explícito del usuario.
- **Commits sin trailer `Co-Authored-By`.**
- **Modelo single-state-per-item**: un label por item; el selector usa los estados del personaje **principal** del item.

---

### Task 1: Matcher — `characterStateHint` a nivel idea (capa IDEA)

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (campo en `MatchSchema` ~`:165` + bullet en el SYSTEM ~`:375-376`)
- Test: `lib/prompt-director/format-matcher.test.ts`

**Interfaces:**
- Consumes: nada nuevo. El matcher ya recibe los estados del Cast en el pool (`MatcherCharacter.states`, `:25`; serializado en `:439` como `(estados: …)`).
- Produces: el resultado del match (un objeto `z.infer<typeof MatchSchema>`, accesible como `m` en `server-actions/campaigns.ts`) gana el campo de nivel idea `characterStateHint: string | null`. La rama de secuencia (`scenes[].characterStateHint`) NO se toca.

- [ ] **Step 1: Escribir el test del parseo (RED)**

Abre `lib/prompt-director/format-matcher.test.ts`. El harness mockea la respuesta del modelo con el helper `geminiOk({ matches: [...] })` (búscalo, p. ej. en el test de retry ~`:159`) y llama `matchIdeas({ ideasText: '...', formats: FORMATS })` (FORMATS es el fixture compartido; ver `:27`, `:272`). **Usa ESE mismo harness.** Añade:

```ts
it('clip único: parsea characterStateHint a nivel idea', async () => {
  // Mockear con geminiOk como los tests vecinos; la respuesta del modelo trae
  // una idea de UN CLIP (scenes: []) con el hint a nivel idea:
  //   geminiOk({ matches: [{ formatId: <id de FORMATS>, scenePrompt: 'Marco shows the product, sweating',
  //              characterStateHint: 'sudado', scenes: [], count: 1, ...el resto como vecinos }] })
  const res = await matchIdeas({ ideasText: 'Marco sudado mostrando el producto', formats: FORMATS });
  expect(res.matches[0].characterStateHint).toBe('sudado');
});

it('clip único: characterStateHint ausente → null', async () => {
  // mismo geminiOk pero SIN characterStateHint en la respuesta
  const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
  expect(res.matches[0].characterStateHint).toBeNull();
});
```

> El campo se llama `characterStateHint` (mismo nombre que el de escena). Si los tests vecinos comparten un mock de `fetch`/`geminiOk` en un `beforeEach`, reutilízalo (no inventes un harness nuevo).

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts`
Expected: FAIL — el match no tiene `characterStateHint` a nivel idea (es `undefined`), el primer caso falla.

- [ ] **Step 3: Añadir el campo a `MatchSchema`**

En `lib/prompt-director/format-matcher.ts`, dentro de `MatchSchema` (junto a los campos de nivel idea como `sequenceLabel`, `:165`), añade — MISMO patrón que `SceneSchema:112`:

```ts
  // P05 clip único: label EXACTO de un estado físico del personaje listado, o
  // null. Nivel idea (para ideas de un solo clip); las escenas de secuencia
  // usan su propio characterStateHint dentro de scenes[].
  characterStateHint: z.string().trim().nullable().catch(null).default(null),
```

- [ ] **Step 4: Añadir la directiva al SYSTEM**

En el bloque del SYSTEM que describe los campos de nivel idea (lista con `- characterIds:`, `- inventedCharacters:`, `- blocker:`, ~`:375-385`), añade un bullet (espeja la instrucción per-escena de `:365-368`):

```
- characterStateHint: para una idea de UN SOLO CLIP (scenes = []), si la acción
  describe a un personaje del Cast en uno de sus ESTADOS FÍSICOS listados entre
  paréntesis junto a su nombre (estados: sudado, mojado…), pon ese label EXACTO;
  si no aplica, no hay estados listados, o la idea es multi-escena, null.
```

- [ ] **Step 5: Correr el test (GREEN) + typecheck**

Run: `pnpm vitest run lib/prompt-director/format-matcher.test.ts` y `pnpm typecheck`
Expected: PASS los dos casos nuevos + los existentes; typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(matcher): characterStateHint a nivel idea para clip unico (P05)"
```

---

### Task 2: Planner — propagar el hint al clip único

**Files:**
- Modify: `lib/campaigns/planner.ts` (`DirectedIdea` `:279-299` + rama normal de `buildDirectedPlan` `:463`)
- Modify: `server-actions/campaigns.ts` (3 sitios `directed.push`: `:542`, `:561`, `:590`)
- Test: `lib/campaigns/campaigns.test.ts`

**Interfaces:**
- Consumes: el campo `characterStateHint` del resultado del match (Task 1; `m.characterStateHint: string | null`).
- Produces: `DirectedIdea` gana `characterStateHint: string | null`; los `PlanItemDraft` de la rama normal de `buildDirectedPlan` llevan ese hint. `buildPlan` (planner genérico) NO se toca.

- [ ] **Step 1: Escribir el test (RED)**

Usa `lib/campaigns/planner-beatrole.test.ts` como MODELO (beatRole es el análogo exacto: campo inferido por el matcher que el planner traslada). En `lib/campaigns/campaigns.test.ts`, el helper `directedInput(over)` (`:85`) arma el `DirectedPlanInput` (default `ideas: []`); los tests pasan `ideas: [...]` inline y llaman `buildDirectedPlan(directedInput({ ideas: [...] }))`. Añade (la idea normal NO lleva `scenes`):

```ts
it('buildDirectedPlan rama normal: traslada characterStateHint al item', () => {
  const idea = {
    // Construir como las ideas normales vecinas (mira un test sin `scenes`):
    // format: <un PlannerFormat de los fixtures>, count: 1,
    // scenePrompt: 'Marco shows the product, sweating', durationS: null,
    // sceneSummary: null, characterIds: [], invented: [], scenes: [], sequenceLabel: null,
    characterStateHint: 'sudado',
  };
  const items = buildDirectedPlan(directedInput({ ideas: [idea] }));
  expect(items[0].characterStateHint).toBe('sudado');
});

it('buildDirectedPlan rama normal: characterStateHint null cuando la idea no lo trae', () => {
  const idea = { /* ...igual pero */ characterStateHint: null };
  const items = buildDirectedPlan(directedInput({ ideas: [idea] }));
  expect(items[0].characterStateHint).toBeNull();
});
```

> Arma `idea` copiando una idea normal (sin `scenes`) de los tests vecinos y añádele `characterStateHint`. Como el campo es OPCIONAL en `DirectedIdea` (Step 3), las fixtures vecinas que lo omiten siguen compilando — NO las toques.

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/campaigns/campaigns.test.ts`
Expected: FAIL — `DirectedIdea` no acepta `characterStateHint` (error de tipo) o el item sale `null`.

- [ ] **Step 3: Añadir el campo a `DirectedIdea`**

En `lib/campaigns/planner.ts`, en el tipo `DirectedIdea` (`:279-299`), añade tras `sceneSummary` (`:288`) — **OPCIONAL a propósito**: así las fixtures de `campaigns.test.ts` que construyen `DirectedIdea` inline sin este campo siguen compilando (evita un ripple de ~17 fixtures); la rama normal ya lee `?? null`:

```ts
  // P05 clip único: estado físico inferido por el matcher a nivel idea (label
  // EXACTO de un estado horneado del personaje), o null/ausente. Las escenas de
  // secuencia usan su propio characterStateHint dentro de scenes[].
  characterStateHint?: string | null;
```

> Con el campo opcional, los 3 `directed.push` (Step 5) NO están forzados por el typecheck a setearlo — por eso el Step 5 los enumera explícitamente; el reviewer debe confirmar que los TRES quedaron actualizados (omitir uno = pérdida silenciosa de la inferencia para ese camino, degradando a master neutro).

- [ ] **Step 4: Leer el hint en la rama normal de `buildDirectedPlan`**

En `lib/campaigns/planner.ts:463`, sustituye:

```ts
        // Idea normal (un solo clip): sin state hint; solo las escenas de
        // secuencia (buildDirectedPlan rama sequence) lo declaran.
        characterStateHint: null,
```

por:

```ts
        // Idea normal (un solo clip): el matcher pudo inferir un estado a nivel
        // idea (P05); los N creativos de count>1 comparten el mismo estado.
        characterStateHint: idea.characterStateHint ?? null,
```

> NO toques `buildPlan` (`:549`): el planner genérico no parte de texto de idea, así que su `characterStateHint: null` es correcto.

- [ ] **Step 5: Propagar `characterStateHint` del match a `DirectedIdea`**

En `server-actions/campaigns.ts`, en los TRES `directed.push({ ... })` (`:542`, `:561`, `:590`), añade junto a `scenes: m.scenes,`:

```ts
              characterStateHint: m.characterStateHint ?? null,
```

(Los tres construyen un `DirectedIdea`; los tres necesitan el campo o el typecheck falla.)

- [ ] **Step 6: Correr tests (GREEN) + typecheck**

Run: `pnpm vitest run lib/campaigns/campaigns.test.ts` y `pnpm typecheck`
Expected: PASS los nuevos + existentes; typecheck limpio (los 3 `directed.push` satisfacen `DirectedIdea`).

- [ ] **Step 7: Commit**

```bash
git add lib/campaigns/planner.ts server-actions/campaigns.ts lib/campaigns/campaigns.test.ts
git commit -m "feat(planner): propaga characterStateHint a la idea de clip unico (P05)"
```

---

### Task 3: Override — schema + action escriben `character_state_hint`

**Files:**
- Modify: `lib/schemas/campaigns.ts` (`UpdateCampaignItemSchema` `:190-192`)
- Modify: `server-actions/campaigns.ts` (`updateCampaignItemAction` `:784-831`)
- Test: `lib/schemas/campaigns.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `UpdateCampaignItemSchema` acepta `characterStateHint?: string | null`; `updateCampaignItemAction` escribe `campaign_items.character_state_hint` cuando el campo viene en el input (y trata el cambio como edición de producción).

- [ ] **Step 1: Escribir el test del schema (RED)**

En `lib/schemas/campaigns.test.ts`, añade (mira cómo el archivo importa `UpdateCampaignItemSchema` y construye inputs):

```ts
describe('UpdateCampaignItemSchema — characterStateHint (P05)', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  it('acepta un label de estado', () => {
    const r = UpdateCampaignItemSchema.safeParse({ itemId: id, characterStateHint: 'sudado' });
    expect(r.success).toBe(true);
  });
  it('acepta null (limpiar a neutral)', () => {
    const r = UpdateCampaignItemSchema.safeParse({ itemId: id, characterStateHint: null });
    expect(r.success).toBe(true);
  });
  it('rechaza un valor no string|null', () => {
    const r = UpdateCampaignItemSchema.safeParse({ itemId: id, characterStateHint: 123 });
    expect(r.success).toBe(false);
  });
});
```

> El uuid usa el nibble de versión `4` y variante `8` (RFC 4122), requerido por `z.string().uuid()`.

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/schemas/campaigns.test.ts`
Expected: FAIL — el primer/segundo caso fallan (el campo no existe; `.partial()` no lo conoce) o el tercero pasa por la razón equivocada.

- [ ] **Step 3: Extender `UpdateCampaignItemSchema`**

En `lib/schemas/campaigns.ts:190-192`:

```ts
export const UpdateCampaignItemSchema = CampaignItemSchema.partial().extend({
  itemId: z.string().uuid(),
  // P05 clip único: fijar/limpiar el estado del item a mano. null = neutral.
  characterStateHint: z.string().trim().nullable().optional(),
});
```

- [ ] **Step 4: Correr el test (GREEN)**

Run: `pnpm vitest run lib/schemas/campaigns.test.ts`
Expected: PASS los tres casos.

- [ ] **Step 5: Escribir el hint en `updateCampaignItemAction`**

En `server-actions/campaigns.ts`:

(a) En el cálculo de `touchesProduction` (`:784-790`), añade la línea (cambiar el estado cambia la generación → es edición de producción):

```ts
    parsed.data.characterId !== undefined ||
    parsed.data.characterIds !== undefined ||
    parsed.data.characterStateHint !== undefined;
```

(b) Junto a los otros `patch.*` (antes de `if (touchesProduction) patch.status = 'planned';`, ~`:830`):

```ts
  if (parsed.data.characterStateHint !== undefined) {
    patch.character_state_hint = parsed.data.characterStateHint; // null limpia a neutral
  }
```

- [ ] **Step 6: typecheck + tests**

Run: `pnpm typecheck` y `pnpm vitest run lib/schemas/campaigns.test.ts`
Expected: typecheck limpio; tests verdes.

- [ ] **Step 7: Commit**

```bash
git add lib/schemas/campaigns.ts server-actions/campaigns.ts lib/schemas/campaigns.test.ts
git commit -m "feat(campaigns): updateCampaignItem escribe character_state_hint (P05)"
```

---

### Task 4: Plumbing de datos para la UI (StudioItem + estados por personaje)

**Files:**
- Modify: `lib/campaigns/studio-item.ts` (`StudioItem` `:7-30` + `toStudioItem` `:36-70`)
- Modify: `app/app/campaigns/[id]/page.tsx` (`itemRows` select `:47`; carga de estados + `characterOptions` `:81-84`)
- Modify: `server-actions/campaigns.ts` (selects que alimentan `toStudioItem`: `:1739` y `:2331`)
- Modify: `components/campaigns/CampaignStudioView.tsx` (tipo `StudioCharacterOption` `:74`)
- Test: `lib/campaigns/studio-item.test.ts` (NUEVO)

**Interfaces:**
- Consumes: la columna `campaign_items.character_state_hint` (ya existe).
- Produces: `StudioItem.characterStateHint: string | null` (poblado por `toStudioItem`); `StudioCharacterOption` gana `states: string[]` (labels de estados horneados del personaje). Task 5 los consume.

- [ ] **Step 1: Escribir el test de `toStudioItem` (RED)**

Crea `lib/campaigns/studio-item.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toStudioItem } from './studio-item';

const maps = () => ({
  fn: new Map<string, string>([['f1', 'Reseña']]),
  fd: new Map<string, string>([['f1', 'desc']]),
  cn: new Map<string, string>([['c1', 'Marco']]),
});

describe('toStudioItem — characterStateHint (P05)', () => {
  it('mapea character_state_hint de la fila', () => {
    const { fn, fd, cn } = maps();
    const item = toStudioItem(
      { id: 'i1', format_id: 'f1', scene_prompt: 'x', status: 'planned', character_state_hint: 'sudado' },
      fn, fd, cn,
    );
    expect(item.characterStateHint).toBe('sudado');
  });
  it('null cuando la columna falta o es null', () => {
    const { fn, fd, cn } = maps();
    const item = toStudioItem(
      { id: 'i2', format_id: 'f1', scene_prompt: 'x', status: 'planned' },
      fn, fd, cn,
    );
    expect(item.characterStateHint).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test (RED)**

Run: `pnpm vitest run lib/campaigns/studio-item.test.ts`
Expected: FAIL — `StudioItem` no tiene `characterStateHint`.

- [ ] **Step 3: Añadir el campo a `StudioItem` y `toStudioItem`**

En `lib/campaigns/studio-item.ts`, en el tipo `StudioItem` (tras `locationId`, `:29`):

```ts
  // P05: estado físico fijado para este item (label de un estado horneado del
  // personaje), o null = master neutro. Lo fija el matcher (inferencia) o el
  // usuario (override en el editor).
  characterStateHint: string | null;
```

y en `toStudioItem` (tras `locationId`, `:68`):

```ts
    characterStateHint: (row.character_state_hint as string | null) ?? null,
```

- [ ] **Step 4: Correr el test (GREEN)**

Run: `pnpm vitest run lib/campaigns/studio-item.test.ts`
Expected: PASS los dos casos.

- [ ] **Step 5: Incluir la columna en los 3 selects que alimentan `toStudioItem`**

Añade `, character_state_hint` a la lista de columnas en:
- `app/app/campaigns/[id]/page.tsx:47` (loader — CRÍTICO: aquí viven los items con estado inferido).
- `server-actions/campaigns.ts:1739` (retorno de `addCampaignItem`/serie).
- ~~`server-actions/campaigns.ts:2331` (retorno de merge de secuencia).~~ **CORRECCIÓN (post-impl):** este sitio NO aplica — el merge devuelve la fila del RPC `merge_sequence` (migración 036), no un `.select()` de cliente. El RPC omite `character_state_hint` en su INSERT (predata la columna 045), así que fusionar una secuencia descarta el estado. Es un **bug PRE-EXISTENTE** (no de esta feature) y se **DIFIRIÓ** (decisión del usuario, 2026-06-25): arreglarlo requiere una migración nueva, contradiciendo el "sin migración" del spec. Documentado en `project_operational_followups`.

(Para los dos sitios que sí aplican, agrega el token al final de la cadena del `.select('… , character_state_hint')`. Sin la columna en `:47`, el estado inferido nunca llegaría al editor.)

- [ ] **Step 6: `StudioCharacterOption` gana `states`**

En `components/campaigns/CampaignStudioView.tsx:74`:

```ts
export type StudioCharacterOption = { id: string; name: string; states: string[] };
```

- [ ] **Step 7: Cargar los estados por personaje en el loader**

En `app/app/campaigns/[id]/page.tsx`, junto a las queries del `Promise.all` (`:44-62`), añade una query de estados:

```ts
        supabase
          .from('character_states')
          .select('character_id, label')
          .eq('workspace_id', workspace.id),
```

(añade su `{ data: stateRows }` al destructuring del array). Luego agrupa por personaje y mapea `states` en `characterOptions` (`:81-84`):

```ts
    const statesByCharacter = new Map<string, string[]>();
    for (const s of stateRows ?? []) {
      const cid = s.character_id as string;
      const arr = statesByCharacter.get(cid) ?? [];
      arr.push(s.label as string);
      statesByCharacter.set(cid, arr);
    }
    const characterOptions = (characterRows ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      states: statesByCharacter.get(c.id as string) ?? [],
    }));
```

> `character_states` está protegida por RLS member-scoped (migración 045); el filtro `workspace_id` espeja el de `characterRows`.

- [ ] **Step 8: typecheck + tests**

Run: `pnpm typecheck` y `pnpm vitest run lib/campaigns/studio-item.test.ts`
Expected: typecheck limpio (todos los consumidores de `StudioCharacterOption` siguen compilando — el único cambio es un campo nuevo requerido que el loader ya provee); tests verdes.

> Si el typecheck se queja de otro sitio que construye `StudioCharacterOption` sin `states`, repórtalo como DONE_WITH_CONCERNS (puede haber otra fuente además del loader). El loader del page es la única fuente conocida.

- [ ] **Step 9: Commit**

```bash
git add lib/campaigns/studio-item.ts "app/app/campaigns/[id]/page.tsx" server-actions/campaigns.ts components/campaigns/CampaignStudioView.tsx lib/campaigns/studio-item.test.ts
git commit -m "feat(campaigns): StudioItem.characterStateHint + estados por personaje (P05)"
```

---

### Task 5: Override — selector "Estado" en `EditItemDialog`

**Files:**
- Modify: `components/campaigns/CampaignStudioView.tsx` (`EditItemDialog` `:1752-1908`)

**Interfaces:**
- Consumes: `StudioItem.characterStateHint` y `StudioCharacterOption.states` (Task 4); `updateCampaignItemAction` con `characterStateHint` (Task 3).
- Produces: nada (UI; validado por smoke). Sin unit test.

> Sin unit test (es UI; el matcher/planner/action ya están cubiertos). Verifica con `pnpm typecheck` y que los tests de componentes existentes no regresan.

- [ ] **Step 1: Estado local del estado en el dialog**

En `EditItemDialog` (junto a los otros `useState`, `:1763-1769`):

```ts
  const [characterStateHint, setCharacterStateHint] = useState<string | null>(item.characterStateHint);
```

- [ ] **Step 2: Enviar el hint en `handleSave`**

En la llamada a `updateCampaignItemAction` (`:1774-1783`), añade (solo si cambió, como hace `scenePrompt`):

```ts
      ...(characterStateHint !== item.characterStateHint ? { characterStateHint } : {}),
```

y en el `onSaved({ ... })` (`:1789-1807`), añade:

```ts
      characterStateHint,
```

- [ ] **Step 3: Renderizar el selector "Estado"**

Calcula los estados del personaje principal seleccionado en el dialog (el `characterId` ya existente) e insértalo tras el bloque del `<select>` "Personaje" (cierre en `:1860`, dentro del mismo `grid`):

```tsx
          {(() => {
            const states = characterOptions.find((c) => c.id === characterId)?.states ?? [];
            if (states.length === 0) return null;
            return (
              <div>
                <label htmlFor="edit-state" className="block text-[12.5px] font-medium text-foreground/80">
                  Estado del personaje
                </label>
                <select
                  id="edit-state"
                  value={characterStateHint ?? ''}
                  onChange={(e) => setCharacterStateHint(e.target.value || null)}
                  className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <option value="">Ninguno (neutral)</option>
                  {states.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            );
          })()}
```

> El selector deriva del `characterId` seleccionado en el dialog: si el usuario cambia el personaje principal, las opciones de estado se recalculan. Un hint que quede stale tras cambiar de personaje degrada limpio en generación (el orchestrator cae al master neutro por match exacto).

- [ ] **Step 4: typecheck + tests de componentes**

Run: `pnpm typecheck` y `pnpm vitest run components/` (o la suite de componentes si existe; si no hay tests de este componente, basta typecheck)
Expected: typecheck limpio; sin regresión.

- [ ] **Step 5: Commit**

```bash
git add components/campaigns/CampaignStudioView.tsx
git commit -m "feat(campaigns): selector de estado del personaje en el editor de item (P05)"
```

---

## Verificación final (tras las 5 tareas)

- [ ] `pnpm typecheck` limpio.
- [ ] `pnpm vitest run lib/prompt-director/format-matcher.test.ts lib/campaigns/campaigns.test.ts lib/schemas/campaigns.test.ts lib/campaigns/studio-item.test.ts` — verde, sin regresión en el camino de secuencia ni en `updateCampaignItemAction`.
- [ ] Smoke del usuario:
  1. Hornear un estado (p. ej. "sudado") para un personaje en el Cast.
  2. Idea de **un solo clip** que describa a ese personaje sudado → confirmar que el item compilado usa la variante (no el master) y que el compiler cita el estado.
  3. En el editor del item, cambiar "Estado del personaje" a "Ninguno" → regenerar → vuelve al master neutro; elegir otro estado → sustituye.

## Notas para el implementador

- El downstream (orchestrator `directorContextFor`, compiler Seedance, columna) NO se toca: ya resuelve `character_state_hint` por item, agnóstico de secuencia.
- `buildPlan` (planner genérico, `planner.ts:549`) se queda en `null`: no hay texto de idea que inferir.
- Precedencia override > inferencia: trivial. El matcher rellena en plan-time; el usuario edita después; misma columna → last-write-wins.
- Veo/Kling ignoran el estado (cita Seedance-only): limitación existente de P05, no se amplía aquí.
- Modo storyboard y multi-estado por item: fuera de alcance (ver spec).
