# Física de interacción, staging proporcional e integración — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El planner y los compilers conocen tamaño Y peso del producto para montar escenas proporcionales (piezas grandes donde reposan naturalmente, cámara atrás, esfuerzo visible al cargar) y el personaje se integra a la locación con luz/sombras coherentes (sin efecto photoshop).

**Architecture:** Planner-first: `stagingPlannerBlock` (ES) entra al SYSTEM del matcher y del asistente de refinado; `describeProductWeight` (EN) y una regla de encuadre en `describeProductScale` complementan en compilers; `SCENE_INTEGRATION_CLAUSE` en flux+seedance para generación fresca. `weightKg` vive en `campaigns.product_brief` (jsonb, cero migraciones) y viaja por el riel existente de `heightCm`.

**Tech Stack:** Next.js 16, Supabase (jsonb existente), Zod 4, Vitest, pnpm.

Spec: `docs/superpowers/specs/2026-07-02-fisica-proporciones-staging-design.md` (fuente de decisiones de producto).

## Global Constraints

- **pnpm siempre** (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`) — nunca npm.
- **Sin emojis** en código/UI. Comentarios y UI en español; cláusulas para modelos de imagen/video en inglés; bloques para SYSTEM de Gemini (matcher/refine) en español.
- **No `any`** — `unknown` + narrowing o tipo explícito.
- **Tests nunca llaman APIs reales.**
- **Ningún bloque de prompt nuevo usa términos de `lib/prompt-director/antislop.ts`.**
- **Cero migraciones**: `weightKg` va dentro del jsonb `product_brief`.
- **Staging = preferencia con excepción** (decisión del usuario): default no-en-manos con colocación natural POR TIPO de objeto (sin lista cerrada de soportes); cargar/entregar se permite si la idea lo pide explícito.
- **La cláusula de integración va SOLO en generación fresca** (compileFlux/compileSeedance) — NUNCA en ramas de edición (panel encadenado, refinado): disciplina anti-drift documentada en `lib/campaigns/storyboard.ts`.
- **Comportamiento idéntico al actual cuando no hay tamaño ni peso** (todo opt-in por dato; los tests lo verifican).
- **Commits**: Conventional Commits en español, imperativo, ≤70 chars, **SIN `Co-Authored-By`**. Un commit por task.
- Rama de trabajo: `feat/fisica-staging-peso` (ya creada; spec commiteado en 42579b1).

---

### Task 1: Inventory — peso, staging natural y encuadre proporcional

**Files:**
- Modify: `lib/prompt-director/types.ts` (~línea 57, tras `thicknessMm`)
- Modify: `lib/prompt-director/inventory.ts` (función `describeProductScale` ~144-192; nuevas `describeProductWeight` y `stagingPlannerBlock` al final)
- Test: `lib/prompt-director/inventory.test.ts` (append)

**Interfaces:**
- Consumes: `ADULT_REF_CM` (constante existente en inventory.ts — reutilizar, NO redefinir), `ProductInventory`.
- Produces:
  - `ProductInventory.weightKg?: number`
  - `describeProductWeight(product?: ProductInventory): string` — `''` si no hay peso o `< 2`; empieza con espacio.
  - `export type PlannerProductFacts = { name?: string; category?: string; medium?: string; heightCm?: number; widthCm?: number; weightKg?: number }`
  - `stagingPlannerBlock(product?: PlannerProductFacts): string` — ES, empieza con `\n` o es `''`.
  - `describeProductScale` gana cláusula de staging/encuadre para ratio ≥ 0.45.

- [ ] **Step 1: Tests que fallan**

Append a `lib/prompt-director/inventory.test.ts` (ajustar el import del encabezado para incluir `describeProductWeight` y `stagingPlannerBlock`):

```typescript
describe('describeProductWeight', () => {
  it('sin producto, sin peso o ligero (<2kg): vacío', () => {
    expect(describeProductWeight()).toBe('');
    expect(describeProductWeight({ name: 'x', imagePaths: [] })).toBe('');
    expect(describeProductWeight({ name: 'x', imagePaths: [], weightKg: 1 })).toBe('');
  });

  it('bandas: medio (2-10), pesado (10-30), muy pesado (>=30)', () => {
    expect(describeProductWeight({ name: 'x', imagePaths: [], weightKg: 5 })).toContain('two-handed grip');
    expect(describeProductWeight({ name: 'x', imagePaths: [], weightKg: 25 })).toContain('visible effort');
    expect(describeProductWeight({ name: 'x', imagePaths: [], weightKg: 40 })).toContain('two people');
    expect(describeProductWeight({ name: 'x', imagePaths: [], weightKg: 25 })!.startsWith(' ')).toBe(true);
  });
});

describe('describeProductScale — staging de piezas grandes', () => {
  it('pieza grande (>=0.45 de un adulto): colocación natural + cámara atrás, nunca encoger', () => {
    const s = describeProductScale({ name: 'Canvas', imagePaths: [], heightCm: 150 });
    expect(s).toContain('naturally rests');
    expect(s).toContain('pulling the camera back');
    expect(s).toContain('Never shrink the piece');
  });

  it('pieza chica: sin cláusula de staging (comportamiento actual)', () => {
    const s = describeProductScale({ name: 'Taza', imagePaths: [], heightCm: 12 });
    expect(s).not.toContain('naturally rests');
    expect(s).not.toContain('pulling the camera back');
  });
});

describe('stagingPlannerBlock', () => {
  it('sin producto o sin datos físicos: vacío', () => {
    expect(stagingPlannerBlock()).toBe('');
    expect(stagingPlannerBlock({ name: 'x' })).toBe('');
    expect(stagingPlannerBlock({ name: 'Taza', heightCm: 12 })).toBe('');
  });

  it('pieza grande: staging natural por tipo, con excepción de carga explícita', () => {
    const s = stagingPlannerBlock({ name: 'Canvas', medium: 'canvas', heightCm: 150 });
    expect(s).toContain('STAGING PROPORCIONAL');
    expect(s).toContain('NO lo pongas en las manos');
    expect(s).toContain('reposa de forma natural');
    expect(s).toContain('Excepción');
    expect(s.startsWith('\n')).toBe(true);
  });

  it('peso: bandas de esfuerzo; ligero no emite', () => {
    expect(stagingPlannerBlock({ name: 'x', weightKg: 5 })).toContain('PESO DEL PRODUCTO');
    expect(stagingPlannerBlock({ name: 'x', weightKg: 25 })).toContain('esfuerzo visible');
    expect(stagingPlannerBlock({ name: 'x', weightKg: 40 })).toContain('dos personas');
    expect(stagingPlannerBlock({ name: 'x', weightKg: 1 })).toBe('');
  });

  it('tamaño y peso a la vez: ambos bloques', () => {
    const s = stagingPlannerBlock({ name: 'Canvas', heightCm: 150, weightKg: 12 });
    expect(s).toContain('STAGING PROPORCIONAL');
    expect(s).toContain('PESO DEL PRODUCTO');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test -- lib/prompt-director/inventory.test.ts`
Expected: FAIL — `describeProductWeight is not a function` (o import roto).

- [ ] **Step 3: Implementar**

En `lib/prompt-director/types.ts`, dentro de `ProductInventory` tras `thicknessMm?: number;`:

```typescript
  // Peso físico declarado en kg (opcional, jsonb product_brief). Ancla la
  // INTERACCIÓN (cómo se carga/mueve, con qué esfuerzo) — complemento del
  // tamaño, que ancla la PROPORCIÓN. Ausente = sin ancla (cero cambio).
  weightKg?: number;
```

En `lib/prompt-director/inventory.ts`:

(a) En `describeProductScale`, añadir tras el cálculo de `carry` (antes de `const dims`):

```typescript
  // Staging/encuadre para piezas grandes (spec 2026-07-02): la preferencia es
  // NO cargarla — colocada como ese TIPO de objeto reposa naturalmente (sin
  // lista cerrada: el modelo decide por lo que ES el producto) y con la cámara
  // suficientemente atrás para que quepa completa a escala real. Reconcilia el
  // safe crop: "grande" se logra alejando cámara, nunca rompiendo proporción.
  // La excepción (cargar/entregar explícito) la cubre `carry`.
  const staging =
    ratio >= 0.45
      ? ' Unless the scene explicitly shows a person carrying it or handing it over, show the piece supported or placed the way this kind of object naturally rests in a real space, with any people beside it; frame the shot wide enough — pulling the camera back if needed — so the whole piece fits in frame at true scale next to the people. Never shrink the piece to make it fit the frame.'
      : '';
```

y en el `return` final, concatenar `${staging}` inmediatamente después de `${carry}`.

(b) Al final del archivo, añadir:

```typescript
// Peso físico → interacción (spec 2026-07-02). EN, para compilers de imagen y
// video (donde "lo mueve como si no pesara" más se nota). '' sin dato o <2kg;
// empieza con espacio (concatenable, mismo contrato que describeProductScale).
export function describeProductWeight(product?: ProductInventory): string {
  const kg = product?.weightKg;
  if (!kg || kg < 2) return '';
  const interaction =
    kg < 10
      ? 'When a person lifts, carries or hands it over, they use a firm two-handed grip and their posture shows its clear heft; it is never tossed or waved around like a light prop.'
      : kg < 30
        ? 'Lifting or moving it takes visible effort — two hands, braced posture, slow deliberate movement; a person never swings it or handles it casually.'
        : 'It is too heavy for one person to carry casually: moving it means dragging it, tilting it carefully, or two people lifting together; a single person never lifts it with ease.';
  return ` The product weighs about ${kg} kg. ${interaction}`;
}

// Datos físicos mínimos del producto para los SYSTEM prompts de AUTORÍA de
// escenas (matcher y asistente de refinado) — en español, porque esos SYSTEM
// son en español. Independiente de ProductInventory: el planner no maneja
// paths de imágenes.
export type PlannerProductFacts = {
  name?: string;
  category?: string;
  medium?: string;
  heightCm?: number;
  widthCm?: number;
  weightKg?: number;
};

// Bloque de staging proporcional + peso para el planner (spec 2026-07-02).
// Preferencia con excepción (decisión del usuario): default no-en-manos con
// colocación natural POR TIPO (ejemplos ilustrativos, no lista cerrada);
// cargar/entregar se permite si la idea lo pide explícito. '' sin datos.
export function stagingPlannerBlock(product?: PlannerProductFacts): string {
  if (!product) return '';
  const parts: string[] = [];
  const size = product.heightCm ?? product.widthCm;
  const ratio = size && size > 0 ? size / ADULT_REF_CM : 0;
  if (size && ratio >= 0.45) {
    const dims =
      product.heightCm && product.widthCm
        ? `${product.heightCm}x${product.widthCm} cm`
        : `${size} cm`;
    const tipo = [product.medium, product.category].filter(Boolean).join(' / ');
    parts.push(
      `\nSTAGING PROPORCIONAL: el producto${tipo ? ` (${tipo})` : ''} mide ~${dims} — una pieza GRANDE respecto a una persona. Por defecto NO lo pongas en las manos de nadie: colócalo donde ese tipo de objeto vive o reposa de forma natural en la escena — decide según qué es el producto (un cuadro cuelga de la pared o va sobre un soporte; una lámpara de pie va al suelo; un mueble se asienta en el piso; una tabla se recarga) — con las personas AL LADO, y describe un plano suficientemente abierto para que la pieza completa se vea proporcional junto a ellas y quepa entera en el encuadre. Excepción: si la idea pide explícitamente cargarlo, moverlo o entregarlo, se permite — descríbelo a dos brazos y con la pieza cubriendo gran parte del cuerpo, nunca como objeto pequeño de mano.`,
    );
  }
  const kg = product.weightKg;
  if (kg && kg >= 2) {
    const esfuerzo =
      kg < 10
        ? 'con agarre firme a dos manos y el peso evidente en la postura'
        : kg < 30
          ? 'con esfuerzo visible: dos manos, postura firme, movimiento lento y cuidadoso'
          : 'sin cargarlo de forma casual: se arrastra, se inclina con cuidado o lo mueven DOS personas';
    parts.push(
      `\nPESO DEL PRODUCTO: pesa ~${kg} kg. Cuando un personaje lo mueva, cargue o entregue, descríbelo ${esfuerzo}; nunca lo maneja como si no pesara.`,
    );
  }
  return parts.join('');
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `pnpm test -- lib/prompt-director/inventory.test.ts`
Expected: PASS (los previos del archivo también — `describeProductScale` conserva su contrato para piezas chicas).

- [ ] **Step 5: Typecheck y commit**

```bash
pnpm typecheck
git add lib/prompt-director/types.ts lib/prompt-director/inventory.ts lib/prompt-director/inventory.test.ts
git commit -m "feat(prompt-director): peso, staging natural y encuadre proporcional"
```

---

### Task 2: `weightKg` — del editor al DirectorContext

**Files:**
- Modify: `server-actions/campaigns.ts` (`SetProductDimensionsSchema` ~157-163 y `setProductDimensionsAction` ~165-210)
- Modify: `components/campaigns/ProductSizeEditor.tsx`
- Modify: `app/app/campaigns/[id]/page.tsx` (donde se renderiza `<ProductSizeEditor` — localizar por contenido)
- Modify: `lib/campaigns/orchestrator.ts` (tipo del brief ~235-243, `CampaignContext`, retorno de `loadCampaignContext`, `directorContextFor`)
- Test: `lib/campaigns/director-context.test.ts` (append)

**Interfaces:**
- Consumes: `ProductInventory.weightKg` (Task 1).
- Produces: `CampaignContext.productWeightKg?: number`; `directorContextFor` emite `product.weightKg`; `product_brief.weightKg` editable en UI.

- [ ] **Step 1: Test que falla (director-context)**

En `lib/campaigns/director-context.test.ts`, añadir un caso reutilizando los fixtures reales del archivo (mismo patrón que el caso de `visualStyle` añadido en el plan anterior — usar los nombres de fixture que el archivo ya tenga, p. ej. `item`/`ctxWith()`):

```typescript
  it('propaga el peso del producto al DirectorContext', () => {
    const dir = directorContextFor(item, null, ctxWith({ productWeightKg: 25 }));
    expect(dir.product?.weightKg).toBe(25);
    expect(directorContextFor(item, null, ctxWith({})).product?.weightKg).toBeUndefined();
  });
```

Run: `pnpm test -- lib/campaigns/director-context.test.ts` → Expected: FAIL (propiedad inexistente / undefined vs 25).

- [ ] **Step 2: Orchestrator**

En `lib/campaigns/orchestrator.ts`:
1. Tipo `CampaignContext`: tras `productThicknessMm?: number;` añadir:

```typescript
  // Peso físico del producto en kg (de product_brief). Opcional; ancla la
  // interacción (esfuerzo al cargar/mover). Ausente = sin ancla.
  productWeightKg?: number;
```

2. En `loadCampaignContext`, el cast del brief (~235-243) gana `weightKg?: number;` y el objeto de retorno gana `productWeightKg: brief.weightKg,` junto a `productThicknessMm`.
3. En `directorContextFor`, dentro de `product: { ... }`, tras `thicknessMm: ctx.productThicknessMm,` añadir `weightKg: ctx.productWeightKg,`.

Run: `pnpm test -- lib/campaigns/director-context.test.ts` → Expected: PASS.

- [ ] **Step 3: Schema + action**

En `server-actions/campaigns.ts`, `SetProductDimensionsSchema` gana:

```typescript
  weightKg: z.number().positive().max(1000).nullable().optional(),
```

y en `setProductDimensionsAction`, tras el bloque de `thicknessMm`:

```typescript
  if (parsed.data.weightKg !== undefined) {
    if (parsed.data.weightKg === null) delete next.weightKg;
    else next.weightKg = parsed.data.weightKg;
  }
```

- [ ] **Step 4: Editor + page**

En `components/campaigns/ProductSizeEditor.tsx`:
1. Prop nueva `initialWeightKg?: number;` y estado `const [weight, setWeight] = useState(initialWeightKg?.toString() ?? '');`
2. En `save()`: `const kg = parse(weight);` + `if (weight.trim() && kg === null) { toast.error('Peso inválido'); return; }` + `weightKg: kg,` en el payload de `setProductDimensionsAction`.
3. Input nuevo junto a "Ancho (cm)" (mismo patrón de label):

```tsx
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Peso (kg)
          <Input
            type="number"
            inputMode="numeric"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-24"
            placeholder="ej. 4"
          />
        </label>
```

4. Actualizar el copy del párrafo descriptivo para mencionar el peso: reemplazar "Tipo de soporte, grosor y tamaño real del producto" por "Tipo de soporte, grosor, tamaño y peso reales del producto" y añadir al final del párrafo: "El peso ancla cómo los personajes lo cargan o mueven.".

En `app/app/campaigns/[id]/page.tsx`, donde se renderiza `<ProductSizeEditor` (localizar por contenido), añadir la prop `initialWeightKg` leyendo `weightKg` del mismo objeto brief del que salen `initialHeightCm`/`initialThicknessMm` (mismo patrón de cast).

- [ ] **Step 5: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add server-actions/campaigns.ts components/campaigns/ProductSizeEditor.tsx app/app/campaigns/[id]/page.tsx lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts
git commit -m "feat(campaigns): weightKg del producto viaja del editor al DirectorContext"
```

---

### Task 3: Planner y refinado reciben el producto físico

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (`buildMatcherSystemPrompt`, tipos de input de `matchIdeas`/`requestMatch`)
- Modify: `server-actions/campaigns.ts` (`generatePlanAction`: cast del brief ~497-500 y llamada a `matchIdeas` ~626-650)
- Modify: `server-actions/refine.ts` (`buildSystemPrompt` + call site)
- Test: `lib/prompt-director/format-matcher.test.ts` (append al describe `buildMatcherSystemPrompt`)

**Interfaces:**
- Consumes: `stagingPlannerBlock`, `type PlannerProductFacts` de `./inventory` (Task 1).
- Produces: `buildMatcherSystemPrompt(opts: { ...; product?: PlannerProductFacts })`; `matchIdeas`/`requestMatch` aceptan y propagan `product?`; el SYSTEM del refinado incluye el mismo bloque.

- [ ] **Step 1: Tests que fallan**

En `lib/prompt-director/format-matcher.test.ts`, dentro del describe `buildMatcherSystemPrompt`:

```typescript
  it('producto físico grande: bloque de staging proporcional', () => {
    const s = buildMatcherSystemPrompt({ product: { name: 'Canvas', medium: 'canvas', heightCm: 150 } });
    expect(s).toContain('STAGING PROPORCIONAL');
    expect(s).toContain('NO lo pongas en las manos');
  });

  it('con peso: bloque de peso; sin datos físicos: ninguno', () => {
    expect(buildMatcherSystemPrompt({ product: { name: 'x', weightKg: 25 } })).toContain('PESO DEL PRODUCTO');
    expect(buildMatcherSystemPrompt({ product: { name: 'x' } })).not.toContain('STAGING PROPORCIONAL');
    expect(buildMatcherSystemPrompt({})).not.toContain('PESO DEL PRODUCTO');
  });
```

Run: `pnpm test -- lib/prompt-director/format-matcher.test.ts` → Expected: FAIL (tipo/objeto no soportado).

- [ ] **Step 2: format-matcher**

1. Ampliar el import de `./inventory`... no existe aún — añadir: `import { stagingPlannerBlock, type PlannerProductFacts } from './inventory';`
2. `buildMatcherSystemPrompt`: `opts` gana `product?: PlannerProductFacts;` y, después de la línea `system += plannerStyleBlocks(...)`, añadir:

```typescript
  // Producto físico (spec 2026-07-02): staging proporcional + peso. Los
  // scenePrompt nacen con la pieza montada donde reposa naturalmente y con la
  // interacción acorde a su peso — el compiler solo refuerza, no corrige.
  system += stagingPlannerBlock(opts.product);
```

3. Tipos de input de `matchIdeas` y `requestMatch`: añadir `product?: PlannerProductFacts;` y en `requestMatch` pasarlo a `buildMatcherSystemPrompt` junto a `visualStyle`/`visualStyleCustom`.

Run: `pnpm test -- lib/prompt-director/format-matcher.test.ts` → Expected: PASS.

- [ ] **Step 3: generatePlanAction**

En `server-actions/campaigns.ts`, `generatePlanAction`:
1. El cast del brief (~497) pasa de `{ productName?: string; category?: string; }` a:

```typescript
  const brief = (campaign.product_brief ?? {}) as {
    productName?: string;
    category?: string;
    medium?: string;
    heightCm?: number;
    widthCm?: number;
    weightKg?: number;
  };
```

2. En la llamada a `matchIdeas`, tras el spread de `visualStyleCustom`:

```typescript
        product: {
          name: brief.productName,
          category: brief.category,
          medium: brief.medium,
          heightCm: brief.heightCm,
          widthCm: brief.widthCm,
          weightKg: brief.weightKg,
        },
```

(sin gate: `stagingPlannerBlock` ya devuelve `''` cuando no hay datos físicos).

- [ ] **Step 4: refine.ts (paridad)**

En `server-actions/refine.ts`:
1. Import: ampliar a `import { stagingPlannerBlock, type PlannerProductFacts } from '@/lib/prompt-director/inventory';`
2. `buildSystemPrompt` args gana `product?: PlannerProductFacts;` y en el template, junto al `plannerStyleBlocks` existente (misma línea, inmediatamente después):

```
${plannerStyleBlocks(args.visualStyle, args.visualStyleCustom)}${stagingPlannerBlock(args.product)}
```

3. En `refineItemTurnAction`, el cast del brief (~177) pasa a `{ productName?: string; category?: string; medium?: string; heightCm?: number; widthCm?: number; weightKg?: number }` y el call site de `buildSystemPrompt` gana:

```typescript
        product: {
          name: brief.productName,
          category: brief.category,
          medium: brief.medium,
          heightCm: brief.heightCm,
          widthCm: brief.widthCm,
          weightKg: brief.weightKg,
        },
```

- [ ] **Step 5: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts server-actions/campaigns.ts server-actions/refine.ts
git commit -m "feat(planner): staging proporcional y peso en matcher y refinado"
```

---

### Task 4: Compilers — peso en panel/video + integración personaje↔locación

**Files:**
- Modify: `lib/prompt-director/spatial.ts` (constante nueva)
- Modify: `lib/prompt-director/compilers/flux.ts` (tras el bloque de locación ~44-48)
- Modify: `lib/prompt-director/compilers/seedance.ts` (tras el push de `lines` de referencias; y peso junto a `describeProduct` ~417)
- Modify: `server-actions/storyboard.ts` (ramas fresca y encadenada ~292-293)
- Modify: `lib/campaigns/storyboard.ts` (`compileRefinePrompt` sandwich ~175; import)
- Test: `lib/prompt-director/prompt-director.test.ts` (append)

**Interfaces:**
- Consumes: `describeProductWeight` de `../inventory` / `@/lib/prompt-director/inventory` (Task 1).
- Produces: `export const SCENE_INTEGRATION_CLAUSE: string` en `lib/prompt-director/spatial.ts`.

- [ ] **Step 1: Tests que fallan**

En `lib/prompt-director/prompt-director.test.ts` (usar el patrón de invocación de `compile()` y el modelSlug de seedance que ya usan los tests existentes del archivo):

```typescript
describe('integración personaje-locación y peso (spec 2026-07-02)', () => {
  const ana = { name: 'Ana', description: 'curly hair, warm smile', masterImagePath: 'refs/ana.png' };

  it('panel: con personaje + locación entra la cláusula de integración', () => {
    const r = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'she smiles by the window', aspectRatio: '9:16' },
      { characters: [ana], location: { description: 'cozy dim bedroom with a warm lamp', imagePaths: [] } },
    );
    expect(r.ok && r.compiled.prompt).toContain('cast soft contact shadows');
    expect(r.ok && r.compiled.prompt).toContain('cut out or pasted');
  });

  it('panel: sin locación NO entra la integración', () => {
    const r = compile(
      { modelSlug: 'flux-2-pro-preview', scenePrompt: 'she smiles', aspectRatio: '9:16' },
      { characters: [ana] },
    );
    expect(r.ok && r.compiled.prompt).not.toContain('cast soft contact shadows');
  });

  it('video: peso del producto ancla la interacción', () => {
    const r = compile(
      { modelSlug: 'bytedance/seedance-2.0/fast/reference-to-video', scenePrompt: 'he moves the piece to the wall', durationS: 5 },
      { product: { name: 'Canvas', imagePaths: [], weightKg: 25 } },
    );
    expect(r.ok && r.compiled.prompt).toContain('visible effort');
  });

  it('video: con personaje + locación entra la integración', () => {
    const r = compile(
      { modelSlug: 'bytedance/seedance-2.0/fast/reference-to-video', scenePrompt: 'she walks in', durationS: 5 },
      { characters: [ana], location: { description: 'sunlit garden patio', imagePaths: [] } },
    );
    expect(r.ok && r.compiled.prompt).toContain('cast soft contact shadows');
  });
});
```

(Si el modelSlug de seedance difiere en los tests existentes, usar ese.)

Run: `pnpm test -- lib/prompt-director/prompt-director.test.ts` → Expected: FAIL.

- [ ] **Step 2: Constante en spatial.ts**

Al final de `lib/prompt-director/spatial.ts`:

```typescript
// Integración personaje-locación (spec 2026-07-02): la hoja maestra del Cast
// viene de estudio (luz pareja, fondo liso); sin esta cláusula el modelo
// "pega" a la persona sobre el fondo con luz y sombras incoherentes (efecto
// photoshop). Redactada NEUTRAL al estilo: la coherencia de luz aplica igual
// en animado/fantasía. SOLO generación fresca — nunca ramas de edición.
export const SCENE_INTEGRATION_CLAUSE =
  "Integrate the people naturally into the location: they are lit by the scene's existing light sources — same direction, color temperature and softness — they cast soft contact shadows on the surfaces they touch, and they match the scene's perspective, depth of field and overall color grade; no one looks cut out or pasted onto the background.";
```

- [ ] **Step 3: compileFlux**

En `lib/prompt-director/compilers/flux.ts`:
1. Import: `import { SCENE_INTEGRATION_CLAUSE } from '../spatial';`
2. Tras el bloque de locación (después del `if` que pushea `'The setting must match the provided location reference image...'`), añadir:

```typescript
  // Integración personaje-locación: solo cuando hay ambos (la cláusula habla
  // de "the people" y "the scene"; sin locación o sin personas sobra).
  if (
    (ctx.characters?.length ?? 0) > 0 &&
    ((ctx.location?.imagePaths?.length ?? 0) > 0 || ctx.location?.description?.trim())
  ) {
    sections.push(SCENE_INTEGRATION_CLAUSE);
  }
```

- [ ] **Step 4: compileSeedance**

En `lib/prompt-director/compilers/seedance.ts`:
1. Imports: añadir `SCENE_INTEGRATION_CLAUSE` desde `../spatial` y `describeProductWeight` al import existente de `../inventory`.
2. Tras `if (lines.length) sections.push(lines.join(' '));` (las referencias), añadir:

```typescript
  // Integración personaje-locación (spec 2026-07-02) — espejo del panel.
  if (
    (ctx.characters?.length ?? 0) > 0 &&
    ((ctx.location?.imagePaths?.length ?? 0) > 0 || ctx.location?.description?.trim())
  ) {
    sections.push(SCENE_INTEGRATION_CLAUSE);
  }
```

3. Junto al `sections.push(describeProduct(ctx.product, ...))` (~417), añadir inmediatamente después:

```typescript
    const weight = describeProductWeight(ctx.product);
    if (weight) sections.push(weight.trim());
```

- [ ] **Step 5: Peso en el ensamblado del storyboard**

1. `server-actions/storyboard.ts`: ampliar el import de `@/lib/prompt-director/inventory` con `describeProductWeight`, e insertar `${describeProductWeight(dirCtx.product)}` inmediatamente después de CADA `${describeProductScale(dirCtx.product)}` (rama encadenada ~292 y rama fresca ~293).
2. `lib/campaigns/storyboard.ts`: ampliar el import de inventory con `describeProductWeight`, e insertar `${describeProductWeight(ctx.product)}` después de `${describeProductScale(ctx.product)}` en la rama sandwich de `compileRefinePrompt` (~175). La rama `strong` NO se toca.

- [ ] **Step 6: Correr y verificar**

Run: `pnpm test -- lib/prompt-director/prompt-director.test.ts` → PASS.
Run: `pnpm test` (suite completa) → PASS; si algún test existente asserta el string completo del sandwich o del panel, actualizar su expectativa (cambio deliberado; documentarlo en el report).

- [ ] **Step 7: Commit**

```bash
pnpm typecheck
git add lib/prompt-director/spatial.ts lib/prompt-director/compilers/flux.ts lib/prompt-director/compilers/seedance.ts server-actions/storyboard.ts lib/campaigns/storyboard.ts lib/prompt-director/prompt-director.test.ts
git commit -m "feat(compilers): peso en interacción e integración personaje-locación"
```

---

### Task 5: Checkpoint final

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: todo verde (lint: 0 errores; los 9 warnings pre-existentes no cuentan).

- [ ] **Step 2: Review final de rama + cierre**

Review final de rama completa (controller: paquete `merge-base development..HEAD` + reviewer en el modelo más capaz), fix de hallazgos Important si los hay, y merge+push a `development` (sin gate de migración: este plan no toca schema). Smoke manual del usuario: campaña con canvas 150cm + `weightKg` 12 → plan → panel → video.

---

## Self-review (ejecutada al escribir el plan)

- **Cobertura del spec:** dato weightKg (Task 2), stagingPlannerBlock matcher+refine (Task 3), describeProductWeight + encuadre en describeProductScale (Tasks 1+4), integración flux+seedance solo-fresco (Task 4), opt-in por dato verificado por tests de vacío (Tasks 1-3). Fuera de alcance respetado (sin migraciones, sin Veo/Kling, sin auto-detección).
- **Placeholders:** ninguno; el único punto flexible (nombres de fixtures en director-context.test.ts y modelSlug de seedance en tests) lleva instrucción de resolución explícita.
- **Consistencia de tipos:** `PlannerProductFacts` definido en Task 1, consumido con ese nombre en Task 3; `describeProductWeight(product?: ProductInventory)` consistente en Tasks 1 y 4; `productWeightKg` (CampaignContext) vs `weightKg` (ProductInventory/brief) mapeados explícitamente en Task 2.
