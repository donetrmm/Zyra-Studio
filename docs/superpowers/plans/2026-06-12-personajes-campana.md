# Personajes en campañas estudio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pool de hasta 3 personajes por campaña (con principal explícito), asignación por mención en las ideas, personajes inventados en el prompt, contador de referencias N/9, y tres fixes: referencias heredadas visibles en el refinado, referencias extra del refinado que hoy se pierden, y preview del prompt final compilado.

**Architecture:** Enfoque A del spec (`docs/superpowers/specs/2026-06-12-personajes-campana-design.md`): arrays nuevos `character_ids` en `campaigns` y `campaign_items`, manteniendo `character_id` como personaje principal sincronizado. `DirectorContext.character` se vuelve `characters` (array ≤3) y gana `extraImagePaths`. El matcher devuelve `characterIds` e `inventedCharacters` por idea. Capas puras primero (matcher, planner, compiler — TDD), luego orquestador/actions, luego UI.

**Tech Stack:** Next.js 15 App Router, Supabase (migración SQL nueva), zod, vitest, shadcn. **Usar pnpm siempre.** Tests sin APIs reales (fetch mockeado con `vi.stubGlobal`).

**Reglas del repo que aplican:** commits SIN `Co-Authored-By` (`.cursor/rules/90-commits.mdc`), conventional commits en español, no `any`, server actions validan con zod + ownership, nunca modificar una migración aplicada.

---

## Archivos afectados (mapa)

| Archivo | Cambio |
|---|---|
| `supabase/migrations/031_campaign_characters.sql` | Crear: arrays + backfill |
| `docs/zyra-studio-spec.md` | Documentar columnas nuevas |
| `lib/prompt-director/types.ts` | `characters[]`, `extraImagePaths` |
| `lib/prompt-director/compilers/seedance.ts` | Multi-personaje, presupuesto, tope 9 img, extras |
| `lib/prompt-director/format-director.ts` | `character` deja de bloquear |
| `lib/prompt-director/validators.ts` | Warning con `characters[]` |
| `lib/prompt-director/format-matcher.ts` | `characterIds` + `inventedCharacters` |
| `lib/prompt-director/prompt-director.test.ts` | Fixture + tests nuevos |
| `lib/prompt-director/format-matcher.test.ts` | Tests nuevos |
| `lib/campaigns/planner.ts` | `characterIds[]`, inventados, pool |
| `lib/campaigns/campaigns.test.ts` | Tests nuevos |
| `lib/campaigns/orchestrator.ts` | `character_ids`, ángulos, `reference_ids` |
| `lib/schemas/campaigns.ts` | `characterIds` en schemas |
| `server-actions/campaigns.ts` | Pool, sync, preview action |
| `server-actions/refine.ts` | Sync de `character_ids` al aceptar |
| `components/shared/ReferenceBudget.tsx` | Crear: contador N/9 |
| `components/campaigns/CampaignStudioWizard.tsx` | Selector de personajes |
| `app/app/campaigns/new/page.tsx` | Cargar personajes con previews |
| `components/campaigns/CampaignStudioView.tsx` | Nombres múltiples + preview prompt |
| `app/app/campaigns/[id]/page.tsx` | `characterNames[]` |
| `components/refine/RefineView.tsx` | Referencias heredadas + copy de toma |
| `app/app/campaigns/[id]/refine/[itemId]/page.tsx` | Cargar heredadas |

---

### Task 0: Rama de trabajo

- [ ] **Step 1: Crear rama desde development**

```bash
git checkout development
git checkout -b feat/personajes-campanas
```

---

### Task 1: Migración 031 + docs

**Files:**
- Create: `supabase/migrations/031_campaign_characters.sql`
- Modify: `docs/zyra-studio-spec.md` (sección de schema de campañas)

- [ ] **Step 1: Escribir la migración**

```sql
-- 031_campaign_characters.sql
-- Pool de personajes por campaña y multi-personaje por creativo (máx 3).
-- character_id se conserva como PRINCIPAL (= primer elemento del array),
-- sincronizado por las server actions: replace_character, rotateCharacters
-- y la edición del detalle siguen operando sobre él.

alter table campaigns
  add column if not exists character_ids uuid[] not null default '{}';

alter table campaign_items
  add column if not exists character_ids uuid[] not null default '{}';

update campaign_items
  set character_ids = array[character_id]
  where character_id is not null and character_ids = '{}';

comment on column campaigns.character_ids is
  'Pool de personajes de la campaña (máx 3 — validado en server action). Orden significativo: el primero es el principal.';
comment on column campaign_items.character_ids is
  'Personajes del creativo (máx 3). Orden = orden de referencias en el prompt. character_id = principal sincronizado.';
```

- [ ] **Step 2: Aplicar la migración**

Aplicar con el MCP de Supabase (`apply_migration`, name: `031_campaign_characters`) o el flujo habitual del repo. Verificar con `list_tables` (o el dashboard) que ambas columnas existen.

- [ ] **Step 3: Documentar en el spec del producto**

En `docs/zyra-studio-spec.md`, localizar la definición de `campaigns` y `campaign_items` (buscar `character_id`) y agregar las dos columnas `character_ids uuid[]` con la misma nota del comment (regla del repo: nombres de columnas nuevos van al spec en paralelo).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/031_campaign_characters.sql docs/zyra-studio-spec.md
git commit -m "db: agrega character_ids a campaigns y campaign_items"
```

---

### Task 2: Matcher — characterIds e inventedCharacters

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts`
- Test: `lib/prompt-director/format-matcher.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

Agregar al final del `describe('matchIdeas', ...)` en `format-matcher.test.ts`:

```ts
  it('devuelve characterIds saneados contra el pool', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'María hace un unboxing', formatId: 'f1', customFormat: null,
        characterIds: ['c1', 'c-falso', 'c2'],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({
      ideasText: 'María hace un unboxing', formats: FORMATS,
      characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
    });
    expect(res.matches[0].characterIds).toEqual(['c1', 'c2']);
  });

  it('characterIds vacío y sin crash cuando el modelo no manda el campo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{ ideaText: 'un unboxing', formatId: 'f1', customFormat: null }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'un unboxing', formats: FORMATS });
    expect(res.matches[0].characterIds).toEqual([]);
    expect(res.matches[0].inventedCharacters).toEqual([]);
  });

  it('inventedCharacters se parsea y los malformados se descartan sin tirar el match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => geminiOk({
      matches: [{
        ideaText: 'Lucía presenta', formatId: 'f2', customFormat: null,
        inventedCharacters: [
          { name: 'Lucía', description: 'a presenter with short auburn hair and a denim jacket' },
          { bogus: true },
        ],
      }],
    })));
    process.env.GEMINI_API_KEY = 'test';
    const res = await matchIdeas({ ideasText: 'Lucía presenta', formats: FORMATS, characters: [] });
    expect(res.matches[0].inventedCharacters).toEqual([
      { name: 'Lucía', description: 'a presenter with short auburn hair and a denim jacket' },
    ]);
  });
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm test lib/prompt-director/format-matcher.test.ts`
Expected: FAIL (`characterIds` undefined / propiedad inexistente en el input).

- [ ] **Step 3: Implementar en format-matcher.ts**

3a. Tipo y schema. Junto a `MatcherFormat`:

```ts
export type MatcherCharacter = { id: string; name: string };
```

En `MatchSchema`, después de `scenePrompt`:

```ts
  // Personajes del pool mencionados en la idea (ids exactos; se sanean abajo).
  characterIds: z.array(z.string()).max(3).catch([]).default([]),
  // Nombres mencionados que NO están en el pool: apariencia inventada que el
  // planner inyecta en el scene_prompt (sin imagen de referencia).
  inventedCharacters: z
    .array(z.object({
      name: z.string().trim().min(1).max(60),
      description: z.string().trim().min(1).max(300),
    }))
    .max(3)
    .catch([])
    .default([]),
```

Nota: el `.catch([])` del array exterior descarta TODO el array si un elemento es malformado. Para descartar solo el elemento malo (test 3), parsear laxo: usar `z.array(z.unknown()).catch([]).default([])` y filtrar elemento a elemento en un `.transform`:

```ts
const InventedCharacterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
});
// dentro de MatchSchema:
  inventedCharacters: z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((arr) =>
      arr.flatMap((item) => {
        const parsed = InventedCharacterSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
```

3b. Firma de `matchIdeas` y `requestMatch` — agregar `characters?: MatcherCharacter[]` al input de ambas y pasarlo en el retry.

3c. En `SYSTEM`, después del bloque de `scenePrompt`:

```
- characterIds: si la idea nombra personajes del Cast listado abajo, devuelve sus
  ids exactos (máximo 3). Si no nombra a nadie, [].
- inventedCharacters: si la idea nombra a una persona que NO está en el Cast,
  inventa su apariencia: {"name":"...","description":"apariencia concreta en
  INGLÉS, 1-2 frases, sin mencionar edad"}. No inventes personajes que la idea
  no menciona. Si no aplica, [].
```

Y en el JSON de ejemplo final del SYSTEM agregar ambos campos:
`"characterIds":[],"inventedCharacters":[]`.

3d. En `requestMatch`, incluir el Cast en el contenido del usuario:

```ts
  const cast = (input.characters ?? [])
    .map((c) => `- id=${c.id} ${c.name}`)
    .join('\n') || '(ninguno)';
```

y en `parts`: `` `Catálogo:\n${catalog}\n\nCast de la campaña:\n${cast}\n\nIdeas del usuario:\n${input.ideasText.slice(0, 2000)}` ``.

3e. Saneo final (donde ya se sanea `formatId`):

```ts
  const knownCharacters = new Set((input.characters ?? []).map((c) => c.id));
  return {
    matches: matches.map((m) => ({
      ...m,
      formatId: m.formatId && known.has(m.formatId) ? m.formatId : null,
      characterIds: m.characterIds.filter((id) => knownCharacters.has(id)).slice(0, 3),
    })),
  };
```

- [ ] **Step 4: Verificar que pasan todos**

Run: `pnpm test lib/prompt-director/format-matcher.test.ts`
Expected: PASS (los tests viejos también: los defaults no rompen nada).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(campaigns): matcher devuelve characterIds e inventedCharacters por idea"
```

---

### Task 3: Planner — pool, asignación por mención e inventados

**Files:**
- Modify: `lib/campaigns/planner.ts`
- Test: `lib/campaigns/campaigns.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

En `campaigns.test.ts`, dentro de `describe('buildDirectedPlan', ...)` (los fixtures existentes `plannerInput`/ideas usan la forma vieja — actualizarlos en el Step 3; los tests nuevos):

```ts
  it('asigna los personajes mencionados por el matcher al creativo', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 1, scenePrompt: 'She presents the can',
          characterIds: ['c2', 'c1'], invented: [],
        }],
        characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
      }),
    );
    expect(items[0].characterIds).toEqual(['c2', 'c1']);
  });

  it('sin mención rota un personaje del pool', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 2, scenePrompt: null, characterIds: [], invented: [],
        }],
        characters: [{ id: 'c1', name: 'María' }, { id: 'c2', name: 'Juan' }],
      }),
    );
    expect(items.map((i) => i.characterIds.length)).toEqual([1, 1]);
    expect(items[0].characterIds).not.toEqual(items[1].characterIds);
  });

  it('inventados van al scene_prompt y el formato con personaje ya no se bloquea sin pool', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 1, scenePrompt: 'Lucia tries the product',
          characterIds: [],
          invented: [{ name: 'Lucía', description: 'a presenter with short auburn hair' }],
        }],
        characters: [],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].characterIds).toEqual([]);
    expect(items[0].scenePrompt).toContain('Lucía is a presenter with short auburn hair');
  });

  it('formato con personaje, sin pool y sin inventados usa el presentador genérico', () => {
    const items = buildDirectedPlan(
      directedInput({
        ideas: [{
          format: fmt('voz-cercana', ['product', 'character']),
          count: 1, scenePrompt: null, characterIds: [], invented: [],
        }],
        characters: [],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0].scenePrompt).toContain(DEFAULT_PRESENTER);
  });
```

Helpers de fixture (junto a los existentes; adaptarlos a los que ya haya en el archivo):

```ts
const fmt = (slug: string, refs: string[]): PlannerFormat => ({
  id: `id-${slug}`, slug, name: slug, requiredRefs: refs,
  defaultDurationS: 8, defaultAudio: true,
});
const directedInput = (over: Partial<DirectedPlanInput>): DirectedPlanInput => ({
  ideas: [], productName: 'Lumen', goal: 'mixed', scenes: [],
  characters: [], available: { product: true, packaging: false },
  dateStart: new Date('2026-06-01'), dateEnd: new Date('2026-06-30'),
  draftModelSlug: 'bytedance/seedance-2.0/fast/reference-to-video',
  ...over,
});
```

Importar `DEFAULT_PRESENTER` y `DirectedPlanInput` desde el planner.

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm test lib/campaigns/campaigns.test.ts`
Expected: FAIL (campos inexistentes: `characterIds`, `invented`, `DEFAULT_PRESENTER`).

- [ ] **Step 3: Implementar en planner.ts**

3a. Tipos:

```ts
// PlanItemDraft: reemplazar `characterId: string | null` por:
  characterIds: string[];   // orden = orden de referencias; [0] es el principal

// DirectedIdea: agregar
  characterIds: string[];
  invented: Array<{ name: string; description: string }>;

// PlannerInput / DirectedPlanInput: available pierde character:
  available: { product: boolean; packaging: boolean };
```

3b. Constante exportada (descripción estable del presentador genérico):

```ts
// Presentador inventado cuando el formato pide personaje y la campaña no
// asignó ninguno (spec 2026-06-12): solo texto, sin imagen — coherencia
// razonable, no identidad garantizada.
export const DEFAULT_PRESENTER =
  'a presenter with shoulder-length dark hair, neutral casual wardrobe and a warm confident delivery';
```

3c. `formatFitsRefs`: eliminar la rama `character` (producto y empaque siguen bloqueando).

3d. En `buildDirectedPlan`, dentro del loop de items, reemplazar el cálculo de `character` y `scenePrompt`:

```ts
      const fromIdea = idea.characterIds
        .filter((id) => input.characters.some((c) => c.id === id))
        .slice(0, 3);
      const rotated =
        needsCharacter && input.characters.length
          ? [input.characters[(gIdx + i) % input.characters.length].id]
          : [];
      const characterIds = fromIdea.length ? fromIdea : rotated;

      let scenePrompt = idea.scenePrompt ?? seed({ product: input.productName, scene: scene.fragment });
      const inventedLines = idea.invented.map((p) => `${p.name} is ${p.description}.`);
      if (needsCharacter && characterIds.length === 0 && inventedLines.length === 0) {
        inventedLines.push(`The presenter is ${DEFAULT_PRESENTER}.`);
      }
      if (inventedLines.length) {
        scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} ${inventedLines.join(' ')}`;
      }
```

y en el `items.push`: `characterIds,` y `scenePrompt,` (quitar `characterId`).

3e. En `buildPlan` (plan sugerido), mismo patrón sin menciones:

```ts
      const characterIds =
        needsCharacter && input.characters.length
          ? [input.characters[(fIdx + i) % input.characters.length].id]
          : [];
      let scenePrompt = seed({ product: input.productName, scene: scene.fragment });
      if (needsCharacter && characterIds.length === 0) {
        scenePrompt = `${scenePrompt.trim().replace(/\.?$/, '.')} The presenter is ${DEFAULT_PRESENTER}.`;
      }
```

3f. Actualizar los fixtures existentes del archivo de tests: `available` pierde `character` y los `DirectedIdea` existentes ganan `characterIds: [], invented: []`. El test existente que espera `items` vacío cuando falta el personaje (busca `available: { product: true, packaging: false, character: false }` con formato que pide character) cambia de expectativa: ahora SÍ produce items, con `DEFAULT_PRESENTER` en el scenePrompt.

- [ ] **Step 4: Verificar que pasa todo el archivo**

Run: `pnpm test lib/campaigns/campaigns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/campaigns/planner.ts lib/campaigns/campaigns.test.ts
git commit -m "feat(campaigns): planner multi-personaje con pool, menciones e inventados"
```

---

### Task 4: Director — characters[], extras, presupuesto y tope de 9 imágenes

**Files:**
- Modify: `lib/prompt-director/types.ts`, `lib/prompt-director/compilers/seedance.ts`, `lib/prompt-director/format-director.ts`, `lib/prompt-director/validators.ts`
- Test: `lib/prompt-director/prompt-director.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

En `prompt-director.test.ts`: el fixture `fullContext()` cambia `character: {...}` por `characters: [{...}]` (mismo contenido). Tests nuevos en `describe('compile seedance', ...)`:

```ts
  it('dos personajes: master + 1 ángulo cada uno, con nombre en la línea @', () => {
    const ctx = fullContext();
    ctx.characters = [
      { name: 'Maya', description: 'curly dark hair', masterImagePath: 'm1.png', angleImagePaths: ['m1a.png', 'm1b.png'] },
      { name: 'Leo', description: 'short beard, denim shirt', masterImagePath: 'm2.png', angleImagePaths: ['m2a.png'] },
    ];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'They toast with the can' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const charRefs = res.compiled.references.filter((r) => r.role === 'character');
    // Maya: master + 1 ángulo; Leo: master + 1 ángulo (presupuesto de 2 personajes)
    expect(charRefs.map((r) => r.storagePath)).toEqual(['m1.png', 'm1a.png', 'm2.png', 'm2a.png']);
    expect(res.compiled.prompt).toContain('is Maya');
    expect(res.compiled.prompt).toContain('is Leo');
  });

  it('tres personajes: solo master cada uno', () => {
    const ctx = fullContext();
    ctx.characters = [
      { name: 'A', description: 'd', masterImagePath: 'a.png', angleImagePaths: ['a1.png'] },
      { name: 'B', description: 'd', masterImagePath: 'b.png', angleImagePaths: ['b1.png'] },
      { name: 'C', description: 'd', masterImagePath: 'c.png', angleImagePaths: ['c1.png'] },
    ];
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'The three react to the product' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const charRefs = res.compiled.references.filter((r) => r.role === 'character');
    expect(charRefs.map((r) => r.storagePath)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('extraImagePaths entran como environment al final y el tope de 9 imágenes recorta con warning', () => {
    const ctx = fullContext();
    ctx.product!.imagePaths = ['p1.png', 'p2.png', 'p3.png'];
    ctx.product!.packagingImagePaths = ['k1.png', 'k2.png'];
    ctx.format = { ...ctx.format!, requiredRefs: ['product', 'character', 'packaging'] };
    ctx.characters = [{ name: 'Maya', description: 'd', masterImagePath: 'm.png', angleImagePaths: ['ma1.png', 'ma2.png'] }];
    ctx.extraImagePaths = ['x1.png', 'x2.png'];
    // 3 producto + 2 empaque + 3 personaje = 8 → solo cabe 1 extra
    const res = compile(
      { modelSlug: 'bytedance/seedance-2.0/reference-to-video', scenePrompt: 'She opens the can' },
      ctx,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const images = res.compiled.references.filter((r) => r.kind === 'image');
    expect(images).toHaveLength(9);
    expect(images[8].role).toBe('environment');
    expect(images[8].storagePath).toBe('x1.png');
    expect(res.compiled.warnings.some((w) => w.includes('tope de 9'))).toBe(true);
  });

  it('formato que pide personaje sin Cast ya NO bloquea (se inventa en el prompt)', () => {
    const res = compile(
      {
        modelSlug: 'bytedance/seedance-2.0/reference-to-video',
        scenePrompt: 'The presenter is a person with auburn hair. She presents the can',
      },
      { format: vozCercana, product: fullContext().product },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // pero avisa que la identidad no está anclada
    expect(res.compiled.warnings.some((w) => w.includes('identidad'))).toBe(true);
  });
```

- [ ] **Step 2: Verificar que fallan**

Run: `pnpm test lib/prompt-director/prompt-director.test.ts`
Expected: FAIL (`characters` no existe en `DirectorContext`, bloqueo del validador, etc.).

- [ ] **Step 3: Implementar**

3a. `types.ts` — en `DirectorContext`, reemplazar `character?: CharacterInventory;` por:

```ts
  // Personajes del creativo, máx 3. Orden = orden de referencias (el primero
  // es el principal). Presupuesto de ángulos: 1→2, 2→1, 3→0 (tope 9 imágenes).
  characters?: CharacterInventory[];
  // Referencias extra del refinado (campaign_items.reference_ids resueltos):
  // rol environment, al final de la prioridad.
  extraImagePaths?: string[];
```

3b. `compilers/seedance.ts` — `buildReferences`:

- Tope de imágenes al inicio: `const MAX_IMAGES = 9;` y en `pushImage`, antes de incrementar:

```ts
  let droppedImages = 0;
  const pushImage = (storagePath: string, role: CompiledReference['role'], line: (n: number) => string, scope?: string) => {
    if (imageN >= 9) {
      droppedImages += 1;
      return;
    }
    imageN += 1;
    references.push({ storagePath, kind: 'image', role, scope });
    lines.push(line(imageN));
  };
```

- Reemplazar el bloque `if (ctx.character?.masterImagePath) {...}` por:

```ts
  // Personajes: presupuesto de ángulos según cuántos van en escena
  // (1 → master+2, 2 → master+1, 3 → solo master), para caber en 9 imágenes.
  const characters = (ctx.characters ?? []).slice(0, 3);
  const anglesPer = characters.length >= 3 ? 0 : characters.length === 2 ? 1 : 2;
  for (const character of characters) {
    if (!character.masterImagePath) continue;
    pushImage(
      character.masterImagePath,
      'character',
      (n) =>
        `@Image${n} is ${character.name} — keep the exact appearance: same face, same hair, same build. Only the face, hair and build come from this reference; wardrobe and expression follow the scene description.`,
      'rostro, peinado y complexión; no la ropa ni el fondo',
    );
    for (const path of character.angleImagePaths?.slice(0, anglesPer) ?? []) {
      pushImage(path, 'character', (n) => `@Image${n} shows ${character.name} from another angle, for consistency.`);
    }
  }

  // Referencias extra del refinado: entorno/estilo, última prioridad.
  for (const path of ctx.extraImagePaths ?? []) {
    pushImage(path, 'environment', (n) => `@Image${n} is an additional scene reference — match its environment, mood and look.`);
  }
```

- Tras construir todo, antes del check de 12:

```ts
  if (droppedImages > 0) {
    warnings.push(
      `referencias: ${droppedImages} imágenes recortadas por el tope de 9 del modelo (prioridad: producto > empaque > personaje > extra)`,
    );
  }
```

(El check de 12 archivos totales se queda como red de seguridad.)

3c. `compilers/seedance.ts` — `compileSeedance`, reemplazar el bloque `if (ctx.character) {...}` por:

```ts
  for (const character of ctx.characters ?? []) {
    const { text, ageWordsRemoved } = describeCharacter(character);
    sections.push(text);
    if (ageWordsRemoved.length) {
      warnings.push(`edad: se removieron marcadores de la descripción de ${character.name} (${ageWordsRemoved.join(', ')})`);
    }
  }
```

3d. `format-director.ts` — en `resolveRequiredRefs`, eliminar la rama `character` y dejar nota:

```ts
    // character ya no bloquea: sin Cast el planner inyecta un personaje
    // inventado en el scene_prompt (spec 2026-06-12); el validador avisa
    // con el warning de identidad.
```

3e. `validators.ts` — regla 4:

```ts
  const hasCast = (ctx.characters ?? []).some((c) => c.masterImagePath);
  if (mentionsPerson && !hasCast) {
```

- [ ] **Step 4: Verificar que pasa todo, incluidos los tests viejos actualizados**

Run: `pnpm test lib/prompt-director/prompt-director.test.ts`
Expected: PASS. Ajustar los tests existentes que usaban `ctx.character!` (fixture y test del tope de 12) a la forma `ctx.characters![0]`.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/types.ts lib/prompt-director/compilers/seedance.ts lib/prompt-director/format-director.ts lib/prompt-director/validators.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(campaigns): compiler Seedance multi-personaje con presupuesto y tope de 9 imagenes"
```

---

### Task 5: Schemas y orquestador

**Files:**
- Modify: `lib/schemas/campaigns.ts`, `lib/campaigns/orchestrator.ts`

- [ ] **Step 1: Schemas**

En `lib/schemas/campaigns.ts`:

- `CreateCampaignStudioSchema`, después de `language`:

```ts
    // Pool de personajes de la campaña (máx 3). El primero es el principal.
    characterIds: z.array(z.string().uuid()).max(3).default([]),
```

- `CampaignItemSchema`, junto a `characterId`:

```ts
  // Multi-personaje (máx 3, orden = referencias del prompt). characterId se
  // mantiene como principal sincronizado (= characterIds[0]).
  characterIds: z.array(z.string().uuid()).max(3).optional(),
```

- `AddCampaignItemSchema`: agregar la misma línea `characterIds`.

- [ ] **Step 2: Orquestador**

En `lib/campaigns/orchestrator.ts`:

2a. `ItemRow` gana:

```ts
  character_ids: string[] | null;
  reference_ids: string[] | null;
```

2b. Helper (exportado para reuso en la action de preview):

```ts
// Personajes efectivos del item: array nuevo con fallback al principal legacy.
export function itemCharacterIds(item: Pick<ItemRow, 'character_id' | 'character_ids'>): string[] {
  if (item.character_ids?.length) return item.character_ids.slice(0, 3);
  return item.character_id ? [item.character_id] : [];
}
```

2c. `CampaignContext.characters` gana ángulos:

```ts
  characters: Map<string, { name: string; description: string; masterImagePath: string; angleImagePaths: string[] }>;
```

2d. `loadCampaignContext`: el select de characters agrega `angle_image_ids`; `imageIds` incluye también los ángulos; al armar el map:

```ts
      const angleIds = ((c.angle_image_ids as string[]) ?? []).slice(0, 2);
      // (en el primer loop) imageIds.push(...angleIds);
      // (en el segundo loop)
      const angleImagePaths = angleIds
        .map((id) => paths.get(id))
        .filter((p): p is string => !!p);
      // y agregarlo al characters.set(...)
```

2e. `directorContextFor` — nueva firma con extras y multi-personaje:

```ts
function directorContextFor(
  item: ItemRow,
  format: FormatRow | null,
  ctx: CampaignContext,
  templateVideoPath?: string,
  extraImagePaths?: string[],
): DirectorContext {
  const characters = itemCharacterIds(item)
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      name: c.name,
      description: c.description,
      masterImagePath: c.masterImagePath,
      angleImagePaths: c.angleImagePaths,
    }));
  return {
    // ...igual que hoy...
    characters: characters.length ? characters : undefined,
    extraImagePaths: extraImagePaths?.length ? extraImagePaths : undefined,
    // ...
  };
}
```

2f. `enqueueBatch`:

```ts
  const characterIds = [...new Set(selected.flatMap((i) => itemCharacterIds(i)))];
  // ...
  // Referencias extra del refinado (reference_ids): resolverlas una vez para el lote.
  const extraRefIds = [...new Set(selected.flatMap((i) => i.reference_ids ?? []))];
  const extraPaths = await resolvePaths(supabase, workspaceId, extraRefIds);
```

y en el loop, al compilar:

```ts
      directorContextFor(
        item,
        format,
        ctx,
        item.template_id ? templateVideos.get(item.template_id) : undefined,
        (item.reference_ids ?? []).map((id) => extraPaths.get(id)).filter((p): p is string => !!p),
      ),
```

2g. En `server-actions/campaigns.ts`, el select de `approveBatchAction` (línea ~726) agrega `character_ids, reference_ids`.

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck`
Expected: PASS (los errores que salgan en `server-actions/campaigns.ts` por `PlanItemDraft.characterIds` se arreglan en la Task 6 — si bloquean el typecheck, hacer Task 6 Step 1 junto con esta y commitear juntas, son el mismo concern).

- [ ] **Step 4: Commit**

```bash
git add lib/schemas/campaigns.ts lib/campaigns/orchestrator.ts server-actions/campaigns.ts
git commit -m "feat(campaigns): orquestador multi-personaje con angulos y referencias extra del refinado"
```

---

### Task 6: Server actions — pool, sync y preview del prompt

**Files:**
- Modify: `server-actions/campaigns.ts`, `server-actions/refine.ts`

- [ ] **Step 1: createCampaignStudioAction guarda el pool**

Después de validar las imágenes de producto y antes del insert de la campaña:

```ts
  // Pool de personajes (máx 3 por schema): ownership + que tengan imagen.
  let characterIds: string[] = [];
  if (parsed.data.characterIds.length) {
    const { data: chars } = await supabase
      .from('characters')
      .select('id, workspace_id, master_image_id, reference_image_ids')
      .in('id', parsed.data.characterIds);
    const valid = new Set(
      (chars ?? [])
        .filter((c) => c.workspace_id === workspace.id)
        .filter((c) => c.master_image_id || ((c.reference_image_ids as string[]) ?? []).length > 0)
        .map((c) => c.id as string),
    );
    if (parsed.data.characterIds.some((id) => !valid.has(id))) {
      return { ok: false, error: 'validation_error', message: 'Personaje no encontrado o sin imagen' };
    }
    characterIds = parsed.data.characterIds; // orden del wizard = principal primero
  }
```

y en el insert de `campaigns`: `character_ids: characterIds,`.

- [ ] **Step 2: generatePlanAction usa el pool y las menciones**

2a. El select de la campaña agrega `character_ids, language`.

2b. Reemplazar el bloque que carga TODOS los characters del workspace por el pool:

```ts
  // Pool de la campaña (spec 2026-06-12): el plan solo usa los personajes
  // asignados; pool vacío = formatos con presentador usan personaje inventado.
  const poolIds = ((campaign.character_ids as string[]) ?? []).slice(0, 3);
  let characters: Array<{ id: string; name: string }> = [];
  if (poolIds.length) {
    const { data: characterRows } = await supabase
      .from('characters')
      .select('id, name, master_image_id, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .in('id', poolIds);
    const byId = new Map(
      (characterRows ?? [])
        .filter((c) => c.master_image_id || ((c.reference_image_ids as string[]) ?? []).length > 0)
        .map((c) => [c.id as string, { id: c.id as string, name: c.name as string }]),
    );
    // Personajes borrados del Cast desde la creación: se filtran en silencio.
    characters = poolIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }
```

`available` queda `{ product: ..., packaging: ... }` (sin `character`).

2c. `matchIdeas` recibe el pool: `characters: characters.map((c) => ({ id: c.id, name: c.name }))`.

2d. Al armar `directed`, descripciones de inventados estables por nombre y propagación:

```ts
      // Un inventado por nombre: la PRIMERA descripción gana y se reusa en
      // todos los creativos que lo mencionen (coherencia razonable).
      const inventedByName = new Map<string, { name: string; description: string }>();
      for (const m of matched.matches) {
        for (const p of m.inventedCharacters) {
          const key = p.name.toLowerCase();
          if (!inventedByName.has(key)) inventedByName.set(key, p);
        }
      }
```

y cada `directed.push({...})` gana:

```ts
            characterIds: m.characterIds,
            invented: m.inventedCharacters.map((p) => inventedByName.get(p.name.toLowerCase())!),
```

(aplica a las tres ramas: formato existente, slug reusado y formato custom creado).

2e. El insert de `campaign_items` sincroniza:

```ts
      character_id: i.characterIds[0] ?? null,
      character_ids: i.characterIds,
```

2f. El retorno gana los inventados para el toast del wizard:

```ts
    // en el tipo Result del action:
    inventedNames?: string[];
    // al final:
    ...(inventedNamesList.length ? { inventedNames: inventedNamesList } : {}),
```

donde `const inventedNamesList = [...inventedByName.values()].map((p) => p.name);` (declarar `inventedByName` fuera del `if (parsed.data.userIdeas)` con `new Map()` para que exista — vacío — en el camino mix).

- [ ] **Step 3: Sync en updates, add, series y refinado**

3a. `updateCampaignItemAction`: el select del item agrega `character_ids`; `touchesProduction` incluye `parsed.data.characterIds !== undefined`; y el patch:

```ts
  if (parsed.data.characterIds !== undefined) {
    patch.character_ids = parsed.data.characterIds;
    patch.character_id = parsed.data.characterIds[0] ?? null;
  } else if (parsed.data.characterId !== undefined) {
    // Editar el principal conserva al resto del elenco del item.
    const rest = ((item as { character_ids?: string[] }).character_ids ?? []).slice(1);
    patch.character_id = parsed.data.characterId;
    patch.character_ids = parsed.data.characterId ? [parsed.data.characterId, ...rest].slice(0, 3) : rest;
  }
```

3b. `addCampaignItemAction` insert:

```ts
      character_id: parsed.data.characterIds?.[0] ?? parsed.data.characterId ?? null,
      character_ids: parsed.data.characterIds ?? (parsed.data.characterId ? [parsed.data.characterId] : []),
```

3c. `generateSeriesAction`: en el insert de items de la serie (busca `character_id: i.characterId` cerca de la línea 1108), agregar `character_ids: i.characterId ? [i.characterId] : [],`.

3d. `server-actions/refine.ts`, `acceptRefinedItemAction` (payload de la línea ~229): al actualizar un item existente conservar el resto del elenco — cargar `character_ids` del item (el action ya carga el item para validar) y:

```ts
    character_id: parsed.data.draft.characterId,
    character_ids: parsed.data.draft.characterId
      ? [parsed.data.draft.characterId, ...((existingItem?.character_ids as string[] | undefined) ?? []).filter((id) => id !== parsed.data.draft.characterId).slice(0, 2)]
      : [],
```

(en el insert de item nuevo, `existingItem` es null y queda `[characterId]`).

- [ ] **Step 4: previewItemPromptAction (compilación en seco)**

Nueva action al final de `server-actions/campaigns.ts`:

```ts
// Preview del prompt final (spec 2026-06-12 §8): compila el item por el mismo
// camino del orquestador SIN encolar ni cobrar. Solo lectura.
export async function previewItemPromptAction(itemId: string): Promise<
  Result<{
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  }>
> {
  if (!z.string().uuid().safeParse(itemId).success) {
    return { ok: false, error: 'validation_error' };
  }
  const { workspace } = await requireWorkspace();
  const supabase = await createClient();

  const { data: item } = await supabase
    .from('campaign_items')
    .select('id, campaign_id, format_id, template_id, model_slug, duration_s, aspect_ratio, scene, audio, character_id, character_ids, reference_ids, scene_prompt, status, campaigns!inner(workspace_id, brand_kit_id, product_brief, language)')
    .eq('id', itemId)
    .single();
  const camp = (item as { campaigns?: { workspace_id?: string; brand_kit_id?: string | null; product_brief?: Record<string, unknown> | null; language?: string | null } } | null)?.campaigns;
  if (!item || camp?.workspace_id !== workspace.id) return { ok: false, error: 'not_found' };

  let format: ReturnType<typeof fromFormatRow> | undefined;
  if (item.format_id) {
    const { data: f } = await supabase
      .from('formats')
      .select('slug, name, register, camera_style, pacing, required_refs, default_duration_s, default_audio')
      .eq('id', item.format_id)
      .single();
    if (f) {
      format = fromFormatRow({
        slug: f.slug as string, name: f.name as string,
        register: f.register as string | null, camera_style: f.camera_style as string | null,
        pacing: f.pacing as string | null, required_refs: (f.required_refs as string[]) ?? [],
        default_duration_s: f.default_duration_s as number, default_audio: f.default_audio as boolean,
      });
    }
  }

  const charIds = itemCharacterIds({
    character_id: item.character_id as string | null,
    character_ids: (item.character_ids as string[] | null) ?? null,
  });
  const ctx = await loadCampaignContext(
    workspace.id,
    {
      brand_kit_id: (camp.brand_kit_id as string | null) ?? null,
      product_brief: (camp.product_brief as Record<string, unknown> | null) ?? null,
      language: (camp.language as string | null) ?? null,
    },
    charIds,
  );

  const extraIds = ((item.reference_ids as string[] | null) ?? []);
  let extraImagePaths: string[] = [];
  if (extraIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, workspace_id')
      .in('id', extraIds);
    extraImagePaths = (refs ?? [])
      .filter((r) => r.workspace_id === workspace.id && r.storage_url)
      .map((r) => r.storage_url as string);
  }

  const characters = charIds
    .map((id) => ctx.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c);

  const result = compile(
    {
      modelSlug: item.model_slug as string,
      scenePrompt: item.scene_prompt as string,
      durationS: (item.duration_s as number | null) ?? undefined,
      aspectRatio: (item.aspect_ratio as string | null) ?? undefined,
      generateAudio: item.audio as boolean,
    },
    {
      format,
      product: {
        name: ctx.productName,
        visualDetails: ctx.visualDetails,
        palette: ctx.palette,
        imagePaths: ctx.productImagePaths,
        packagingImagePaths: format?.requiredRefs.includes('packaging') ? ctx.packagingImagePaths : undefined,
      },
      characters: characters.length ? characters : undefined,
      scene: item.scene ? { fragment: item.scene as string } : undefined,
      extraImagePaths: extraImagePaths.length ? extraImagePaths : undefined,
      language: ctx.language,
    },
  );

  if (!result.ok) {
    return { ok: true, data: { prompt: null, references: [], warnings: result.warnings, errors: result.errors } };
  }
  return {
    ok: true,
    data: {
      prompt: result.compiled.prompt,
      references: result.compiled.references.map((r) => ({ kind: r.kind, role: r.role, path: r.storagePath })),
      warnings: result.compiled.warnings,
      errors: [],
    },
  };
}
```

Imports nuevos en el archivo: `fromFormatRow` desde `@/lib/prompt-director`, `itemCharacterIds` y `loadCampaignContext` desde `@/lib/campaigns/orchestrator` (compile ya está importado).

Nota: `templateVideoPath` se omite a propósito en el preview (cargarlo requiere otra query; el preview indica composición y referencias de imagen, suficiente para el objetivo). Dejar comentario en el código.

- [ ] **Step 5: Verificar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS completo.

- [ ] **Step 6: Commit**

```bash
git add server-actions/campaigns.ts server-actions/refine.ts
git commit -m "feat(campaigns): pool de personajes, sync de character_ids y preview del prompt compilado"
```

---

### Task 7: Componente ReferenceBudget

**Files:**
- Create: `components/shared/ReferenceBudget.tsx`

- [ ] **Step 1: Implementar el componente**

```tsx
'use client';

// Conjunto de referencias por video + contador contra el tope del modelo
// (9 imágenes en Seedance vía fal). Reusado por el wizard de campaña y el
// panel del refinado. El presupuesto de ángulos por personaje replica el del
// compiler (lib/prompt-director/compilers/seedance.ts): 1→2, 2→1, 3→0.

export const MAX_REFERENCE_IMAGES = 9;

export type BudgetCharacter = {
  id: string;
  name: string;
  previewUrl: string | null;
  angleCount: number;
};

export function referenceSlots(input: {
  productCount: number;
  packagingCount?: number;
  characters: BudgetCharacter[];
}): number {
  const product = Math.min(input.productCount, 3);
  const packaging = Math.min(input.packagingCount ?? 0, 2);
  const n = input.characters.length;
  const anglesPer = n >= 3 ? 0 : n === 2 ? 1 : 2;
  const chars = input.characters.reduce(
    (acc, c) => acc + 1 + Math.min(c.angleCount, anglesPer),
    0,
  );
  return Math.min(product + packaging + chars, MAX_REFERENCE_IMAGES);
}

export function ReferenceBudget({
  productPreviews,
  productCount,
  packagingCount = 0,
  characters,
  extraCount = 0,
}: {
  // Previews de producto (hasta 3 se muestran); productCount puede ser mayor.
  productPreviews: Array<string | null>;
  productCount: number;
  packagingCount?: number;
  characters: BudgetCharacter[];
  // Referencias extra adjuntas (refinado): informativas, fuera del cómputo base.
  extraCount?: number;
}) {
  const slots = referenceSlots({ productCount, packagingCount, characters });
  const thumbs: Array<{ key: string; url: string | null; label: string }> = [
    ...productPreviews.slice(0, 3).map((url, i) => ({ key: `p${i}`, url, label: 'Producto' })),
    ...characters.map((c) => ({ key: c.id, url: c.previewUrl, label: c.name })),
  ];

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Referencias por video
        </span>
        <span aria-live="polite" className="text-[11.5px] tabular-nums text-muted-foreground">
          {slots}/{MAX_REFERENCE_IMAGES} imágenes
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {thumbs.map((t) =>
          t.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={t.key} src={t.url} alt={t.label} title={t.label} className="size-9 rounded-md border border-border object-cover" />
          ) : (
            <div key={t.key} title={t.label} className="grid size-9 place-items-center rounded-md border border-border bg-muted/30 text-[9px] text-muted-foreground/60">
              {t.label.slice(0, 2)}
            </div>
          ),
        )}
        {packagingCount > 0 && (
          <span className="text-[11px] text-muted-foreground/60">+{Math.min(packagingCount, 2)} empaque</span>
        )}
        {extraCount > 0 && (
          <span className="text-[11px] text-muted-foreground/60">+{extraCount} extra</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/shared/ReferenceBudget.tsx
git commit -m "feat(campaigns): componente ReferenceBudget con contador N/9"
```

---

### Task 8: Wizard — selector de personajes con principal y contador

**Files:**
- Modify: `app/app/campaigns/new/page.tsx`, `components/campaigns/CampaignStudioWizard.tsx`

- [ ] **Step 1: Server page carga personajes con previews**

`app/app/campaigns/new/page.tsx` — reemplazar el count de characters por la carga completa (patrón de `app/app/brand/cast/page.tsx`):

```ts
import { signedReferenceUrl } from '@/lib/supabase/storage';

// dentro del componente, junto a la query de kits:
    supabase
      .from('characters')
      .select('id, name, master_image_id, angle_image_ids, reference_image_ids')
      .eq('workspace_id', workspace.id)
      .order('created_at', { ascending: false }),
```

y después:

```ts
  const usable = (characterRows ?? [])
    .map((c) => ({
      id: c.id as string,
      name: c.name as string,
      masterId: (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null,
      angleCount: ((c.angle_image_ids as string[]) ?? []).length,
    }))
    .filter((c) => c.masterId);

  const previews: Record<string, string> = {};
  const masterIds = usable.map((c) => c.masterId as string);
  if (masterIds.length) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url')
      .in('id', masterIds);
    await Promise.all(
      (refs ?? []).map(async (r) => {
        if (!r.storage_url) return;
        try {
          previews[r.id as string] = await signedReferenceUrl(r.storage_url as string);
        } catch { /* sin preview */ }
      }),
    );
  }

  const characters = usable.map((c) => ({
    id: c.id,
    name: c.name,
    previewUrl: c.masterId ? (previews[c.masterId] ?? null) : null,
    angleCount: c.angleCount,
  }));
```

Pasar `characters={characters}` al wizard (sustituye `hasCharacters`).

- [ ] **Step 2: Wizard — sección Personajes + contador + submit**

En `CampaignStudioWizard.tsx`:

2a. Props: `characters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }>` (eliminar `hasCharacters`; derivar `characters.length === 0`).

2b. Estado: `const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);` — el orden ES el principal: `selectedCharacterIds[0]`.

```ts
  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id],
    );
  }
  function makePrincipal(id: string) {
    setSelectedCharacterIds((prev) => (prev.includes(id) ? [id, ...prev.filter((x) => x !== id)] : prev));
  }
```

2c. Nueva sección entre "Tu producto" y "Nombre" (o entre URL e ideas — mantener el flujo visual del archivo):

```tsx
        <section>
          <Label className="text-[12.5px] font-medium text-foreground/80">
            Personajes <span className="font-normal text-muted-foreground/50">(hasta 3)</span>
          </Label>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground/60">
            Los personajes asignados pueden aparecer en los videos; nómbralos en tus ideas
            para dirigirlos (&ldquo;María hace un unboxing&rdquo;). Nombres que no asignes
            se inventan sin imagen de referencia.
          </p>
          {characters.length === 0 ? (
            <div className="mt-1.5 flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
              <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" aria-hidden />
              <div className="flex-1 text-[12px] leading-relaxed text-muted-foreground">
                <p>
                  Sin personajes en tu Cast, los formatos con presentador usarán un
                  personaje inventado (la cara cambiará entre videos).
                </p>
                <Link href="/app/brand/cast" className="mt-1 inline-block text-primary underline-offset-2 hover:underline">
                  Crear un personaje primero
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {characters.map((c) => {
                  const idx = selectedCharacterIds.indexOf(c.id);
                  const selected = idx >= 0;
                  const full = selectedCharacterIds.length >= 3 && !selected;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCharacter(c.id)}
                      disabled={full}
                      aria-pressed={selected}
                      className={`relative rounded-xl border p-2 text-left transition-colors ${
                        selected ? 'border-primary/60 bg-primary/5' : 'border-border bg-card/50 hover:border-muted-foreground/30'
                      } ${full ? 'opacity-40' : ''}`}
                    >
                      {c.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.previewUrl} alt={c.name} className="aspect-square w-full rounded-lg object-cover" />
                      ) : (
                        <div className="grid aspect-square w-full place-items-center rounded-lg bg-muted/30">
                          <UserRound className="size-5 text-muted-foreground/40" aria-hidden />
                        </div>
                      )}
                      <p className="mt-1.5 truncate text-[12px] text-foreground/90">{c.name}</p>
                      {idx === 0 && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9.5px] font-medium text-primary-foreground">
                          Principal
                        </span>
                      )}
                      {idx > 0 && (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => { e.stopPropagation(); makePrincipal(c.id); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); makePrincipal(c.id); } }}
                          className="absolute right-1.5 top-1.5 rounded-full border border-border bg-background/80 px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:text-foreground"
                        >
                          Hacer principal
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedCharacterIds.length >= 3 && (
                <p className="mt-1.5 text-[11.5px] text-amber-400/80">
                  Con 3 personajes la atención del modelo se reparte y el parecido puede
                  degradarse; considera 1-2 por video.
                </p>
              )}
              <ReferenceBudget
                productPreviews={mode === 'upload' ? productImages.map((i) => i.previewUrl) : []}
                productCount={mode === 'upload' ? productImages.length : selectedKit?.productImages ?? 0}
                packagingCount={mode === 'kit' ? selectedKit?.packagingImages ?? 0 : 0}
                characters={selectedCharacterIds.map((id) => {
                  const c = characters.find((x) => x.id === id)!;
                  return { id: c.id, name: c.name, previewUrl: c.previewUrl, angleCount: c.angleCount };
                })}
              />
            </>
          )}
        </section>
```

Imports: `ReferenceBudget` desde `@/components/shared/ReferenceBudget`. La sección `{!hasCharacters && (...)}` actual (línea 315) se elimina (su contenido quedó arriba).

2d. `runCreate` pasa el pool:

```ts
      ...(selectedCharacterIds.length ? { characterIds: selectedCharacterIds } : {}),
```

2e. Toast de inventados después de `generatePlanAction` (en la rama de éxito):

```ts
    if (planned.data.inventedNames?.length) {
      toast.info(
        `${planned.data.inventedNames.join(', ')} no está(n) en la campaña: se inventó su apariencia (sin imagen de referencia).`,
        { duration: 9000 },
      );
    }
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Luego prueba manual: `pnpm dev`, crear campaña con 0, 1 y 3 personajes; verificar contador, badge Principal, warning del tercero.

- [ ] **Step 4: Commit**

```bash
git add app/app/campaigns/new/page.tsx components/campaigns/CampaignStudioWizard.tsx
git commit -m "feat(campaigns): wizard con seleccion de personajes, principal y contador de referencias"
```

---

### Task 9: Detalle de campaña — nombres múltiples y preview del prompt

**Files:**
- Modify: `app/app/campaigns/[id]/page.tsx`, `components/campaigns/CampaignStudioView.tsx`

- [ ] **Step 1: Page — characterNames[]**

En `app/app/campaigns/[id]/page.tsx`: el select de items agrega `character_ids`; el mapeo cambia `characterName` por:

```ts
      characterNames: (((r.character_ids as string[] | null) ?? (r.character_id ? [r.character_id as string] : []))
        .map((id) => characterNames.get(id))
        .filter((n): n is string => !!n)),
```

- [ ] **Step 2: StudioItem + PlanTable**

En `CampaignStudioView.tsx`: `StudioItem.characterName: string | null` → `characterNames: string[]`. En `PlanTable` (línea ~348):

```tsx
                {item.characterNames.length > 0 && (
                  <span className="ml-1.5 text-[11px] text-muted-foreground/60">
                    · {item.characterNames.join(' + ')}
                  </span>
                )}
```

Revisar otros usos de `characterName` en el archivo (EditItemDialog, ProductionView, VariantDialog) y ajustarlos: donde se muestre un solo nombre usar `item.characterNames[0] ?? null`.

- [ ] **Step 3: Preview del prompt**

3a. En `CampaignStudioView` (componente raíz), estado y dialog:

```tsx
  const [promptPreview, setPromptPreview] = useState<{
    itemId: string;
    loading: boolean;
    prompt: string | null;
    references: Array<{ kind: string; role: string; path: string }>;
    warnings: string[];
    errors: string[];
  } | null>(null);

  async function handlePreviewPrompt(itemId: string) {
    setPromptPreview({ itemId, loading: true, prompt: null, references: [], warnings: [], errors: [] });
    const res = await previewItemPromptAction(itemId);
    if (!res.ok) {
      setPromptPreview(null);
      toast.error('No se pudo compilar el prompt');
      return;
    }
    setPromptPreview({ itemId, loading: false, ...res.data });
  }
```

Importar `previewItemPromptAction` junto a las demás actions.

3b. Botón en `PlanTable` (pasar `onPreview: (id: string) => void` como prop; visible para TODOS los rows, no solo editables), junto a los botones existentes:

```tsx
                <button
                  type="button"
                  onClick={() => onPreview(item.id)}
                  aria-label="Ver prompt final"
                  className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Eye className="size-3.5" aria-hidden />
                </button>
```

(import `Eye` de lucide-react; mover el botón FUERA del bloque `{editable(...) && ...}`.)

3c. Dialog (componente en el mismo archivo, al estilo de `DistillDialog`):

```tsx
function PromptPreviewDialog({
  preview,
  onClose,
}: {
  preview: { loading: boolean; prompt: string | null; references: Array<{ kind: string; role: string; path: string }>; warnings: string[]; errors: string[] };
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prompt final (preview)</DialogTitle>
          <DialogDescription>
            Así se compila este creativo al generar: referencias @ con propósito, contexto,
            acción y dirección del formato. El texto del plan es solo la acción.
          </DialogDescription>
        </DialogHeader>
        {preview.loading ? (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Compilando…
          </div>
        ) : preview.errors.length > 0 ? (
          <div className="space-y-1 text-[12.5px] text-red-300/90">
            {preview.errors.map((e) => <p key={e}>{e}</p>)}
          </div>
        ) : (
          <div className="space-y-3">
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/20 p-3 text-[12px] leading-relaxed text-foreground/90">
              {preview.prompt}
            </pre>
            {preview.references.length > 0 && (
              <div className="text-[11.5px] text-muted-foreground">
                <p className="font-medium text-foreground/70">Referencias ({preview.references.length})</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.references.map((r, i) => (
                    <li key={`${r.path}-${i}`}>
                      {r.kind === 'image' ? `@Image — ${r.role}` : r.kind === 'video' ? '@Video — ' + r.role : '@Audio — ' + r.role}
                      <span className="ml-1 text-muted-foreground/50">{r.path.split('/').pop()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <div className="text-[11.5px] text-amber-300/80">
                {preview.warnings.map((w) => <p key={w}>{w}</p>)}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

Renderizarlo junto a `EditItemDialog`: `{promptPreview && <PromptPreviewDialog preview={promptPreview} onClose={() => setPromptPreview(null)} />}` y pasar `onPreview={handlePreviewPrompt}` a `PlanTable`. Si el archivo ya importa `Dialog`/`DialogContent`/etc., reusar; si no, agregar imports de `@/components/ui/dialog`.

- [ ] **Step 4: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Manual: abrir una campaña, "Ver prompt final" en un item planificado → dialog con CRAFT completo y referencias.

- [ ] **Step 5: Commit**

```bash
git add "app/app/campaigns/[id]/page.tsx" components/campaigns/CampaignStudioView.tsx
git commit -m "feat(campaigns): nombres multiples por item y preview del prompt compilado"
```

---

### Task 10: Refinado — referencias heredadas y copy de la toma

**Files:**
- Modify: `app/app/campaigns/[id]/refine/[itemId]/page.tsx`, `components/refine/RefineView.tsx`

- [ ] **Step 1: Page carga las heredadas**

En `refine/[itemId]/page.tsx`, después de cargar campaign e item:

```ts
import { signedReferenceUrl } from '@/lib/supabase/storage';

  // Referencias heredadas (spec 2026-06-12 §7): lo que el video YA llevará
  // al generar — producto del Brand Kit, empaque y personajes del item.
  const { data: fullCampaign } = await supabase
    .from('campaigns')
    .select('brand_kit_id')
    .eq('id', id)
    .single();

  let productPreviews: Array<string | null> = [];
  let productCount = 0;
  let packagingCount = 0;
  if (fullCampaign?.brand_kit_id) {
    const { data: kit } = await supabase
      .from('brand_kits')
      .select('product_image_ids, packaging_image_ids, reference_image_ids')
      .eq('id', fullCampaign.brand_kit_id)
      .single();
    const productIds = ((kit?.product_image_ids as string[]) ?? []).length
      ? ((kit?.product_image_ids as string[]) ?? [])
      : ((kit?.reference_image_ids as string[]) ?? []);
    productCount = productIds.length;
    packagingCount = ((kit?.packaging_image_ids as string[]) ?? []).length;
    const top = productIds.slice(0, 3);
    if (top.length) {
      const { data: refs } = await supabase
        .from('media_references')
        .select('id, storage_url')
        .in('id', top);
      const byId = new Map((refs ?? []).map((r) => [r.id as string, r.storage_url as string | null]));
      productPreviews = await Promise.all(
        top.map(async (refId) => {
          const url = byId.get(refId);
          if (!url) return null;
          try { return await signedReferenceUrl(url); } catch { return null; }
        }),
      );
    }
  }

  // Personajes del item (array nuevo con fallback al principal).
  const itemCharIds: string[] = itemId !== 'new' && draft.characterId !== null
    ? [draft.characterId]
    : [];
  // Si el item existe, preferir character_ids completo:
  // (agregar character_ids al select del item de arriba y usarlo aquí)
  let inheritedCharacters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }> = [];
  const charIdsToLoad = itemCharacterIdsFromRow.length ? itemCharacterIdsFromRow : itemCharIds;
  if (charIdsToLoad.length) {
    const { data: chars } = await supabase
      .from('characters')
      .select('id, name, master_image_id, angle_image_ids, reference_image_ids')
      .in('id', charIdsToLoad)
      .eq('workspace_id', workspace.id);
    inheritedCharacters = await Promise.all(
      (chars ?? []).map(async (c) => {
        const masterId = (c.master_image_id as string | null) ?? ((c.reference_image_ids as string[]) ?? [])[0] ?? null;
        let previewUrl: string | null = null;
        if (masterId) {
          const { data: ref } = await supabase
            .from('media_references').select('storage_url').eq('id', masterId).single();
          if (ref?.storage_url) {
            try { previewUrl = await signedReferenceUrl(ref.storage_url as string); } catch { /* sin preview */ }
          }
        }
        return {
          id: c.id as string,
          name: c.name as string,
          previewUrl,
          angleCount: ((c.angle_image_ids as string[]) ?? []).length,
        };
      }),
    );
  }
```

Concretamente: el select del item (línea 35) agrega `character_ids`, y `itemCharacterIdsFromRow` se define en el bloque `if (itemId !== 'new')`:

```ts
    const itemCharacterIdsFromRow = ((item.character_ids as string[] | null) ?? []).length
      ? (item.character_ids as string[])
      : item.character_id ? [item.character_id as string] : [];
```

(con `const itemCharacterIdsFromRow: string[] = []` como default fuera del if). Pasar a la vista:

```tsx
      inherited={{ productPreviews, productCount, packagingCount, characters: inheritedCharacters }}
```

- [ ] **Step 2: RefineView muestra el conjunto real**

2a. Prop nueva:

```ts
  inherited: {
    productPreviews: Array<string | null>;
    productCount: number;
    packagingCount: number;
    characters: Array<{ id: string; name: string; previewUrl: string | null; angleCount: number }>;
  };
```

2b. En el `<dl>` del aside, reemplazar la fila "Referencias" (líneas 254-257):

```tsx
            <div>
              <dt className="text-muted-foreground/80">Referencias</dt>
              <dd>
                <ReferenceBudget
                  productPreviews={inherited.productPreviews}
                  productCount={inherited.productCount}
                  packagingCount={inherited.packagingCount}
                  characters={inherited.characters}
                  extraCount={draft.referenceIds.length}
                />
              </dd>
            </div>
```

(import `ReferenceBudget` de `@/components/shared/ReferenceBudget`.)

2c. Fila "Toma" (línea 252) — copy que no sugiere error:

```tsx
              <dd className="text-foreground/90">
                {shot ? `${shot.name} — ${shot.description}` : 'La decide el director según el formato'}
              </dd>
```

- [ ] **Step 3: Verificar**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS. Manual: abrir el refinado de un item de campaña con Brand Kit → el panel muestra producto + personajes y N/9; ya no dice "Ninguna aún" ni "— pendiente —".

- [ ] **Step 4: Commit**

```bash
git add "app/app/campaigns/[id]/refine/[itemId]/page.tsx" components/refine/RefineView.tsx
git commit -m "fix(refine): muestra referencias heredadas con contador y copy de toma sin falso pendiente"
```

---

### Task 11: Verificación final

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: todo PASS. (Los tests NO llaman APIs reales — regla del repo.)

- [ ] **Step 2: Revisión del flujo completo en dev (manual, sin generar)**

Con `pnpm dev`:
1. Wizard: seleccionar 2 personajes, reasignar principal, ver contador cambiar (8→9), crear campaña con idea que menciona a uno por nombre.
2. Detalle: el item de la mención lleva ese personaje; "Ver prompt final" muestra `@ImageN is <nombre>`.
3. Idea con nombre desconocido: toast de inventado + descripción en el scene_prompt.
4. Refinado de un item: panel con referencias heredadas y N/9.

(El smoke con generación real lo corre el usuario — regla del repo.)

- [ ] **Step 3: Reportar estado y ofrecer merge**

Usar la skill `superpowers:finishing-a-development-branch` (rama `feat/personajes-campanas` → development).

---

## Notas para el ejecutor

- **No usar `any`**: castear filas de Supabase con `as` específicos como hace el código existente.
- Si un test existente falla por el cambio de `available.character` o `PlanItemDraft.characterId`, es esperado: actualizar el fixture según Task 3 Step 3f — NO revertir el cambio de tipo.
- `RefineDraft.characterId` se queda singular a propósito (editar multi-personaje en refinado está fuera de alcance).
- Las migraciones aplicadas (001-030) NUNCA se tocan.
- Commits sin `Co-Authored-By`, en español, imperativo, ≤70 chars.
