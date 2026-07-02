# Perfiles de Estilo Visual — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El estilo visual (ultra realista / fantasía / animado / custom) deja de ser una regex implícita y prompts con vocabulario de render, y se vuelve un perfil declarado por el usuario que condiciona TODAS las etapas: generación de activos (locación, hoja maestra), planner Gemini, panel de storyboard, refinado y video — incluyendo coherencia física (objetos apoyados/colgados, nunca flotando).

**Architecture:** Un módulo puro `lib/prompt-director/style-profiles.ts` define cada perfil como bloques de prompt por etapa + un flag de física. Fase 0 cablea `ultra_realista` como default (arregla el vocabulario de render actual y añade física, sin schema). Fase 1 añade la columna `campaigns.visual_style`, el selector en wizard y editores de activos, y los presets restantes. El threading sigue el patrón exacto de `creative_guidelines` (columna → `loadCampaignContext` → `CampaignContext` → `directorContextFor` → `DirectorContext` → compilers).

**Tech Stack:** Next.js 16 (App Router), Supabase (Postgres + migraciones SQL), Zod 4, Vitest, pnpm.

## Contexto (diagnóstico que motiva el plan)

1. **Vocabulario de render**: los prompts actuales piden "photorealistic", "cinematic", "set" (`components/locations/LocationsPage.tsx:153`, `components/cast/CastPage.tsx:156`, `lib/providers/flux.ts:49`) — términos que en datos de entrenamiento etiquetan renders CG, no fotos. Producen el look "de IA".
2. **Herencia por ancla**: el panel debe igualar la imagen maestra de la locación (`lib/prompt-director/compilers/flux.ts:44-48`); si la maestra parece render, todos los paneles heredan el look. Por eso el perfil aplica DESDE la generación del activo.
3. **Física ausente**: ninguna etapa instruye que los objetos estén apoyados/colgados/sostenidos (el "cuadro volando"). El realismo actual (`humanRealismDirective`) solo cubre personas en paneles frescos.

## Global Constraints

- **pnpm siempre** (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`) — nunca npm.
- **Sin emojis en código ni UI.** Comentarios y UI en español; prompts a modelos en inglés (salvo el SYSTEM del matcher, que es en español).
- **No `any` en TypeScript** — `unknown` + narrowing o tipo explícito.
- **Tests nunca llaman APIs reales** (Gemini/BFL/fal). Solo funciones puras y MSW.
- **Ningún bloque de prompt nuevo puede usar términos de `lib/prompt-director/antislop.ts`** (`8k`, `ultra detailed`, `masterpiece`, `stunning`, `award-winning`, etc.). Nota: `ultra realistic` NO está baneado.
- **Migración ya aplicada es inmutable**; enums como `text` + `check constraint`, nunca tipo enum nativo (`.cursor/rules/10-database.mdc`).
- **Cambio de columnas ⇒ actualizar `docs/zyra-studio-spec.md` en paralelo** (regla CLAUDE.md).
- **Orden de deploy**: la migración 051 se aplica vía Supabase MCP ANTES de pushear código que lea la columna (si no, 500 en prod).
- **Commits**: Conventional Commits en español, imperativo, ≤70 chars, **sin `Co-Authored-By`** (`.cursor/rules/90-commits.mdc`). Solo commitear al final de cada task.
- **NO tocar el texto de `humanRealismDirective`** (`lib/campaigns/storyboard.ts:63`) ni usarla en ramas encadenadas — tiene un bug documentado de drift de identidad. Las cláusulas nuevas de las ramas de EDICIÓN son solo de anclaje físico, nunca de re-render.
- **NO tocar el system prompt `SYSTEM` del matcher directamente** — solo añadir bloques vía `buildMatcherSystemPrompt`.
- Rama de trabajo: `feat/perfiles-estilo-visual` desde `development`.

---

## Task 0: Rama de trabajo

**Files:** ninguno.

- [ ] **Step 1: Crear la rama**

```bash
git checkout development
git pull
git checkout -b feat/perfiles-estilo-visual
```

Expected: `Switched to a new branch 'feat/perfiles-estilo-visual'`.

---

# FASE 0 — perfil realista corregido + física (sin schema)

## Task 1: Módulo `style-profiles.ts` (tipos, perfil ultra_realista, cláusulas de física)

**Files:**
- Create: `lib/prompt-director/style-profiles.ts`
- Create: `lib/prompt-director/style-profiles.test.ts`
- Modify: `lib/prompt-director/types.ts` (añadir `style?` a `DirectorContext`, ~línea 111)

**Interfaces:**
- Consumes: `stripSlop` de `./antislop` (solo en el test).
- Produces (Fase 0):
  - `type VisualStyle = 'ultra_realista' | 'fantasia' | 'animado' | 'custom'`
  - `type StyleProfile = { slug: VisualStyle; assetLocation: string; assetCharacter: string; panel: string; video: string; planner: string; groundedPhysics: boolean }`
  - `getStyleProfile(style?: string | null): StyleProfile` — cualquier valor desconocido/null → ultra_realista. (Fase 1 le añade segundo parámetro `customText`.)
  - `const WORLD_COHERENCE_CLAUSE: string` (empieza con espacio, EN)
  - `const PLANNER_PHYSICS_BLOCK: string` (empieza con `\n`, ES)
  - `DirectorContext.style?: { slug: VisualStyle; custom?: string }`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/prompt-director/style-profiles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getStyleProfile,
  WORLD_COHERENCE_CLAUSE,
  PLANNER_PHYSICS_BLOCK,
} from './style-profiles';
import { stripSlop } from './antislop';

describe('getStyleProfile', () => {
  it('null, undefined o valor desconocido caen a ultra_realista', () => {
    expect(getStyleProfile().slug).toBe('ultra_realista');
    expect(getStyleProfile(null).slug).toBe('ultra_realista');
    expect(getStyleProfile('lo-que-sea').slug).toBe('ultra_realista');
  });

  it('ultra_realista habla de fotografía real, no de render', () => {
    const p = getStyleProfile('ultra_realista');
    expect(p.assetLocation).toMatch(/real photograph/);
    expect(p.assetCharacter).toMatch(/photograph/);
    // El vocabulario viejo que producía look de IA queda vetado en los bloques de activos.
    expect(p.assetLocation).not.toMatch(/photorealistic|cinematic/i);
    expect(p.assetCharacter).not.toMatch(/photorealistic|cinematic/i);
    expect(p.groundedPhysics).toBe(true);
    // El look de video conserva el contrato actual del compiler de Seedance.
    expect(p.video).toBe('ultra realistic, filmic color grading');
  });

  it('ningún bloque usa términos de la lista antislop', () => {
    const p = getStyleProfile('ultra_realista');
    for (const block of [p.assetLocation, p.assetCharacter, p.panel, p.video, WORLD_COHERENCE_CLAUSE]) {
      expect(stripSlop(block).removed).toEqual([]);
    }
  });

  it('las cláusulas de física anclan objetos: colgar/apoyar, nunca flotar', () => {
    expect(WORLD_COHERENCE_CLAUSE).toMatch(/hangs from|rests on/);
    expect(WORLD_COHERENCE_CLAUSE).toMatch(/never floats/);
    expect(WORLD_COHERENCE_CLAUSE.startsWith(' ')).toBe(true);
    expect(PLANNER_PHYSICS_BLOCK).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
    expect(PLANNER_PHYSICS_BLOCK).toContain('nunca flota');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- lib/prompt-director/style-profiles.test.ts`
Expected: FAIL — `Cannot find module './style-profiles'` (o equivalente).

- [ ] **Step 3: Implementar el módulo**

Crear `lib/prompt-director/style-profiles.ts`:

```typescript
// Perfiles de estilo visual (plan 2026-07-02): el estilo deja de ser una regex
// implícita (STYLIZED_RE) y prompts con vocabulario de render, y se vuelve un
// preset declarado. Cada perfil define los bloques de prompt por etapa:
// generación de activos (locación / hoja maestra), panel fresco del storyboard,
// look de video y bloque del planner. Fase 0 cablea ultra_realista como default
// (el comportamiento actual, corregido); Fase 1 añade el selector por campaña.
//
// Por qué "photograph" y no "photorealistic": en datos de entrenamiento
// "photorealistic"/"cinematic" etiquetan renders CG que imitan fotos — pedirlos
// empuja al look de IA. El lenguaje de captura (cámara, lente, sombras de
// contacto, desgaste) es el que etiqueta fotos reales.
//
// OJO: ningún bloque puede usar términos de la lista antislop (antislop.ts);
// el test lo verifica con stripSlop.

export type VisualStyle = 'ultra_realista' | 'fantasia' | 'animado' | 'custom';

export type StyleProfile = {
  slug: VisualStyle;
  // Bloque de estética/captura para la imagen MAESTRA de una locación.
  assetLocation: string;
  // Ídem para la hoja maestra de personaje.
  assetCharacter: string;
  // Cláusula de estilo del panel FRESCO del storyboard (empieza con espacio).
  panel: string;
  // Look base del encabezado del video (compileSeedance).
  video: string;
  // Bloque en español para el SYSTEM del matcher/planner ('' = nada extra).
  planner: string;
  // false = el estilo permite doblar la física (fantasía): apaga las cláusulas
  // de coherencia física en panel, edición y planner.
  groundedPhysics: boolean;
};

// Física del mundo para prompts de IMAGEN (panel fresco, panel encadenado,
// refinado sandwich). Empieza con espacio (concatenable). Es de ANCLAJE, no de
// re-render: compatible con las ramas de edición donde el re-render está vetado.
export const WORLD_COHERENCE_CLAUSE =
  ' Physical coherence: every object rests on, hangs from or is held by something plausible — a framed picture hangs on a wall or stands on a shelf or easel, it never floats. Objects in contact cast soft grounded shadows, and all light comes from believable, consistent sources.';

// Bloque en español para el SYSTEM del matcher: los scenePrompt nacen con los
// objetos anclados, en vez de corregirlo después en el panel.
export const PLANNER_PHYSICS_BLOCK =
  '\nFÍSICA Y COHERENCIA DEL MUNDO: en cada scenePrompt los objetos están físicamente anclados — apoyados, colgados o sostenidos por algo plausible (un cuadro cuelga de la pared o descansa en una repisa o caballete; nunca flota). La escena obedece la gravedad y la luz viene de fuentes creíbles. Solo rompe la física si la idea o el formato lo piden explícitamente, y en ese caso decláralo en el scenePrompt.';

const ULTRA_REALISTA: StyleProfile = {
  slug: 'ultra_realista',
  assetLocation:
    'The image is a real photograph of the place, captured on location with a full-frame camera and a 35mm lens: believable ambient light with soft contact shadows, true-to-life colors and dynamic range, honest materials showing subtle everyday wear, and natural lived-in detail kept plausible. Documentary framing with slight natural imperfection — a real place, not a staged showroom and not a computer-generated render.',
  assetCharacter:
    'The image is a real unretouched photograph of the person, taken with a full-frame camera and an 85mm portrait lens: natural skin with visible pores and fine texture, true-to-life eyes and hair, and lifelike light on the face — a photographed human being, not a computer-generated render.',
  panel:
    ' Render the whole scene as a real photograph: believable ambient light with soft contact shadows, true-to-life colors, and honest materials with natural texture and subtle wear — a captured moment, not a computer-generated render.',
  // Contrato actual del compiler de Seedance (no cambiar en Fase 0).
  video: 'ultra realistic, filmic color grading',
  planner: '',
  groundedPhysics: true,
};

// Fase 0: solo existe el perfil realista; cualquier valor desconocido cae al
// default. Fase 1 añade fantasia/animado/custom (con segundo parámetro customText).
export function getStyleProfile(style?: string | null): StyleProfile {
  void style;
  return ULTRA_REALISTA;
}
```

Nota: `void style;` es temporal de Fase 0 (el switch de Fase 1 lo elimina); si eslint no protesta por parámetros sin usar, se puede omitir la línea.

- [ ] **Step 4: Añadir `style` a `DirectorContext`**

En `lib/prompt-director/types.ts`, dentro de `export type DirectorContext = {` (después del campo `guidelines`, ~línea 111), añadir:

```typescript
  // Perfil de estilo visual de la campaña (plan 2026-07-02). Ausente =
  // ultra_realista (default). custom solo viaja cuando slug === 'custom'.
  style?: { slug: import('./style-profiles').VisualStyle; custom?: string };
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm test -- lib/prompt-director/style-profiles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck y commit**

```bash
pnpm typecheck
git add lib/prompt-director/style-profiles.ts lib/prompt-director/style-profiles.test.ts lib/prompt-director/types.ts
git commit -m "feat(prompt-director): perfiles de estilo visual con física de mundo"
```

---

## Task 2: Prompts de generación de activos desde el perfil

**Files:**
- Create: `lib/prompt-director/asset-prompts.ts`
- Create: `lib/prompt-director/asset-prompts.test.ts`
- Modify: `components/locations/LocationsPage.tsx` (borrar `buildLocationPrompt` local, líneas 148-160; importar el nuevo)
- Modify: `components/cast/CastPage.tsx` (borrar `buildMasterPrompt` local, líneas 152-163; importar `buildCharacterMasterPrompt`)

**Interfaces:**
- Consumes: `getStyleProfile`, `type VisualStyle` de `./style-profiles` (Task 1).
- Produces:
  - `buildLocationPrompt(description: string, style?: VisualStyle): string`
  - `buildCharacterMasterPrompt(description: string, style?: VisualStyle): string`
  - (Fase 1 les añade tercer parámetro `customText?: string`.)

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/prompt-director/asset-prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildLocationPrompt, buildCharacterMasterPrompt } from './asset-prompts';

describe('buildLocationPrompt', () => {
  it('describe una fotografía real, sin vocabulario de render', () => {
    const p = buildLocationPrompt('cuarto low key con lámpara cálida');
    expect(p).toContain('cuarto low key con lámpara cálida');
    expect(p).toMatch(/real photograph/);
    // "photorealistic", "cinematic" y "set" eran el vocabulario que producía
    // el look de IA (plató limpio + color grading de película).
    expect(p).not.toMatch(/photorealistic|cinematic/i);
    expect(p).not.toMatch(/\bset\b/);
  });

  it('mantiene el contrato de escenario: primer plano libre, sin personas, sin texto', () => {
    const p = buildLocationPrompt('un jardín trasero');
    expect(p).toMatch(/Establishing shot of a location/);
    expect(p).toMatch(/open foreground space/);
    expect(p).toMatch(/Empty of people/);
    expect(p).toMatch(/no text, no watermark/);
  });
});

describe('buildCharacterMasterPrompt', () => {
  it('retrato frontal neutro con lenguaje de captura fotográfica', () => {
    const p = buildCharacterMasterPrompt('mujer de treintas, cabello rizado oscuro');
    expect(p).toContain('mujer de treintas');
    expect(p).toMatch(/head-and-shoulders portrait/);
    expect(p).toMatch(/unretouched photograph/);
    expect(p).toMatch(/no text, no watermark/i);
    // Los criterios de hoja de referencia se conservan (identidad estable).
    expect(p).toMatch(/Neutral relaxed expression/);
    expect(p).toMatch(/seamless background/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test -- lib/prompt-director/asset-prompts.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `asset-prompts.ts`**

```typescript
// Prompts de generación de ACTIVOS: imagen maestra de locación y hoja maestra
// de personaje. Antes vivían hardcodeados en los componentes cliente
// (LocationsPage/CastPage) con vocabulario de render ("photorealistic",
// "cinematic", "set") que producía el look de IA. El bloque de estética ahora
// sale del perfil de estilo — y como los paneles se ANCLAN a estas imágenes
// ("must match the provided location reference"), arreglarlo aquí corrige
// también lo que se hereda río abajo.

import { getStyleProfile, type VisualStyle } from './style-profiles';

// La locación es el ESCENARIO de una escena: un lugar listo para que ocurra
// algo, con espacio libre en primer plano para colocar sujetos y producto.
// Sin personas ni texto. FLUX sirve aquí: se crea desde texto, sin una
// referencia que preservar.
export function buildLocationPrompt(description: string, style?: VisualStyle): string {
  const profile = getStyleProfile(style);
  return (
    `Establishing shot of a location, ready for a scene to take place in it: ${description}. ` +
    'Eye-level camera, wide framing that leaves clear open foreground space where people and a ' +
    'product can be placed and act; the environment frames the action without crowding the center. ' +
    `${profile.assetLocation} Empty of people, no text, no watermark.`
  );
}

// Hoja maestra (doc V2 §4.4): retrato frontal neutro de una persona ficticia —
// los criterios de calidad de referencia que el Prompt Director espera (luz
// pareja, fondo liso, identidad estable). El perfil aporta el bloque de captura.
export function buildCharacterMasterPrompt(description: string, style?: VisualStyle): string {
  const profile = getStyleProfile(style);
  return (
    `Frontal head-and-shoulders portrait of a fictional person: ${description}. ` +
    'Neutral relaxed expression, looking straight at the camera, soft even studio lighting, ' +
    `plain light gray seamless background, sharp focus on the face. ${profile.assetCharacter} ` +
    'No text, no watermark.'
  );
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test -- lib/prompt-director/asset-prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Recablear `LocationsPage.tsx`**

En `components/locations/LocationsPage.tsx`:
1. Borrar la función local `buildLocationPrompt` y su comentario (líneas 148-160).
2. Añadir el import: `import { buildLocationPrompt } from '@/lib/prompt-director/asset-prompts';`
3. El call site (`prompt: buildLocationPrompt(description.trim())`, ~línea 239) no cambia.

- [ ] **Step 6: Recablear `CastPage.tsx`**

En `components/cast/CastPage.tsx`:
1. Borrar la función local `buildMasterPrompt` y su comentario (líneas 152-163).
2. Añadir el import: `import { buildCharacterMasterPrompt } from '@/lib/prompt-director/asset-prompts';`
3. En `handleGenerateMaster` (~línea 302), reemplazar la llamada `buildMasterPrompt(description.trim())` por `buildCharacterMasterPrompt(description.trim())`.

- [ ] **Step 7: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add lib/prompt-director/asset-prompts.ts lib/prompt-director/asset-prompts.test.ts components/locations/LocationsPage.tsx components/cast/CastPage.tsx
git commit -m "refactor(activos): prompts de locación y hoja maestra desde el perfil de estilo"
```

---

## Task 3: `PHOTOREAL_DIRECTIVE` con lenguaje de fotografía

**Files:**
- Modify: `lib/providers/flux.ts:49-50`

**Interfaces:** ninguna nueva (constante interna del provider; se aplica cuando `params.photoreal === true`).

Nota: leer `.cursor/rules/30-providers.mdc` antes de editar (regla CLAUDE.md). El cambio es solo el contenido de la constante — no tocar `buildPrompt` ni `REF_MENTION_RE`.

- [ ] **Step 1: Reemplazar la constante**

En `lib/providers/flux.ts`, reemplazar:

```typescript
const PHOTOREAL_DIRECTIVE =
  'Photoreal cinematic photography, sharp focus, natural lighting, fine micro-details, professional camera, accurate skin tones.';
```

por:

```typescript
// Lenguaje de CAPTURA, no de render: "photoreal/cinematic" etiquetan renders CG
// en los datos de entrenamiento y producían el look de IA (plan 2026-07-02).
const PHOTOREAL_DIRECTIVE =
  'A real photograph captured with a full-frame camera: believable ambient light with soft contact shadows, true-to-life colors, natural skin with visible texture, honest materials, sharp focus.';
```

- [ ] **Step 2: Verificar que nada asserta el string viejo**

Run: `pnpm test`
Expected: PASS. Si algún test asserta el texto anterior de la directiva, actualizar la expectativa al texto nuevo (es un cambio de contenido deliberado).

- [ ] **Step 3: Commit**

```bash
git add lib/providers/flux.ts
git commit -m "fix(providers): directiva photoreal con lenguaje de fotografía, no de render"
```

---

## Task 4: Estilo de escena + física en paneles y refinado

**Files:**
- Modify: `lib/campaigns/storyboard.ts` (nuevas funciones `sceneStyleDirective` y `physicsClause`; inyección en `compileRefinePrompt`)
- Modify: `lib/campaigns/storyboard.test.ts` (tests nuevos)
- Modify: `server-actions/storyboard.ts:289-291` (inyección en panel fresco y encadenado)

**Interfaces:**
- Consumes: `getStyleProfile`, `WORLD_COHERENCE_CLAUSE` de `@/lib/prompt-director/style-profiles`; `isStylized` (mismo archivo).
- Produces:
  - `sceneStyleDirective(ctx: DirectorContext, scenePrompt: string): string` — estilo/realismo del ENTORNO para el panel FRESCO (aplica también sin personajes) + física. `''` si el creativo es estilizado. Empieza con espacio.
  - `physicsClause(): string` — SOLO la cláusula de física, para ramas de EDICIÓN (encadenado + refinado sandwich). (Fase 1 le añade parámetro `ctx`.)

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `lib/campaigns/storyboard.test.ts` (ajustar imports del encabezado para incluir `sceneStyleDirective` y `physicsClause` desde `./storyboard`):

```typescript
describe('sceneStyleDirective', () => {
  it('aplica también sin personajes: el entorno delata el render igual que las caras', () => {
    const d = sceneStyleDirective(
      { product: { name: 'Canvas', imagePaths: [] } },
      'the framed canvas on a wooden dresser, warm lamp light',
    );
    expect(d).toMatch(/real photograph/);
    expect(d).toMatch(/never floats/);
    expect(d.startsWith(' ')).toBe(true);
  });

  it('se omite en creativos estilizados (registro o scenePrompt)', () => {
    expect(sceneStyleDirective({}, 'a cartoon version of the room')).toBe('');
    expect(
      sceneStyleDirective({ format: { register: '3d render, stylized' } as never, product: undefined }, 'x'),
    ).toBe('');
  });
});

describe('physicsClause', () => {
  it('emite solo el ancla física (apto para ramas de edición: sin re-render)', () => {
    const c = physicsClause();
    expect(c).toMatch(/hangs on a wall/);
    expect(c).not.toMatch(/real photograph/);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `pnpm test -- lib/campaigns/storyboard.test.ts`
Expected: FAIL — `sceneStyleDirective is not a function` (o import roto).

- [ ] **Step 3: Implementar las funciones**

En `lib/campaigns/storyboard.ts`, añadir el import al inicio:

```typescript
import { getStyleProfile, WORLD_COHERENCE_CLAUSE } from '@/lib/prompt-director/style-profiles';
```

y después de `humanRealismDirective` (tras la línea 64), añadir:

```typescript
// Estilo/realismo del ENTORNO para el panel FRESCO + coherencia física. A
// diferencia de humanRealismDirective (solo personas, con guarda de identidad),
// aplica también a paneles SIN personajes: los materiales, la luz y el desorden
// del entorno delatan el look de render igual que la piel. Igual de subordinada
// a la fidelidad: pide calidad fotográfica del render, nunca re-imaginar
// producto/escena. Se omite en creativos estilizados (isStylized). SOLO panel
// fresco — en ramas de edición el re-render está vetado (ver humanRealismDirective).
export function sceneStyleDirective(ctx: DirectorContext, scenePrompt: string): string {
  if (isStylized(ctx.format?.register ?? '', scenePrompt)) return '';
  const profile = getStyleProfile(ctx.style?.slug);
  return `${profile.panel}${profile.groundedPhysics ? WORLD_COHERENCE_CLAUSE : ''}`;
}

// Física SOLA, para las ramas de EDICIÓN (panel encadenado y refinado sandwich):
// ahí las cláusulas de re-render causan drift (bug documentado arriba), pero
// anclar objetos es compatible con preservar — restringe DÓNDE queda lo que la
// edición mueve, no CÓMO se re-renderiza lo que no toca. Fase 1 la gatea por
// perfil de campaña (fantasía la apaga).
export function physicsClause(): string {
  return getStyleProfile().groundedPhysics ? WORLD_COHERENCE_CLAUSE : '';
}
```

- [ ] **Step 4: Inyectar en `compileRefinePrompt` (solo modo sandwich)**

En `lib/campaigns/storyboard.ts:132` (rama sandwich, NO en la rama `strong` — esa es prompt mínimo por diseño), insertar `${physicsClause()}` inmediatamente después de `${describeProductScale(ctx.product)}`:

```typescript
  return `${lead} Apply this edit faithfully, even when it changes the product's or a character's appearance (size, thickness, frame, finish, printed content, wardrobe): the requested edit ALWAYS takes precedence over the consistency clauses below, which apply only to whatever the edit does not touch. Keep the rest of the scene consistent with the previous shot (same location, lighting and color palette); adjust composition and framing only as needed for the change to look natural.${chainedProductFidelity(ctx)}${chainedCharacterFidelity(ctx)}${describeProductScale(ctx.product)}${physicsClause()}${creativeGuidelineClauses(ctx.guidelines, { isOpeningBeat: opts?.isOpeningBeat })}${opts?.extraClauses ?? ''} FINAL INSTRUCTION — this is the edit to apply, and it overrides any clause above that conflicts with it: ${lead}`;
```

- [ ] **Step 5: Correr los tests**

Run: `pnpm test -- lib/campaigns/storyboard.test.ts`
Expected: PASS. Si algún test existente asserta el string completo del refinado sandwich, actualizar su expectativa incluyendo la cláusula física (cambio deliberado).

- [ ] **Step 6: Inyectar en el ensamblado del panel (server action)**

En `server-actions/storyboard.ts`:
1. Ampliar el import de `@/lib/campaigns/storyboard` para incluir `sceneStyleDirective` y `physicsClause`.
2. En la línea 291 (rama de panel FRESCO), insertar `${sceneStyleDirective(dirCtx, item.scene_prompt)}` después de `${humanRealismDirective(dirCtx, item.scene_prompt)}`:

```typescript
    : `${compiled.compiled.prompt}${humanRealismDirective(dirCtx, item.scene_prompt)}${sceneStyleDirective(dirCtx, item.scene_prompt)}${describeProductScale(dirCtx.product)}${noText}`;
```

3. En la línea 290 (rama ENCADENADA), insertar `${physicsClause()}` justo antes de `${noText}` (al final de la plantilla, después de `${characterRefPointer}`).

- [ ] **Step 7: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add lib/campaigns/storyboard.ts lib/campaigns/storyboard.test.ts server-actions/storyboard.ts
git commit -m "feat(storyboard): realismo de entorno y coherencia física en paneles y refinado"
```

---

## Task 5: Bloque de física en el SYSTEM del matcher/planner

**Files:**
- Modify: `lib/prompt-director/format-matcher.ts` (función `buildMatcherSystemPrompt`, líneas 420-437)
- Modify: `lib/prompt-director/format-matcher.test.ts` (describe `buildMatcherSystemPrompt`, ~línea 637)

**Interfaces:**
- Consumes: `PLANNER_PHYSICS_BLOCK` de `./style-profiles`.
- Produces: `buildMatcherSystemPrompt` ahora SIEMPRE incluye el bloque de física (Fase 1 lo gatea por perfil).

- [ ] **Step 1: Escribir el test que falla**

En `lib/prompt-director/format-matcher.test.ts`, dentro del `describe('buildMatcherSystemPrompt', ...)` existente, añadir:

```typescript
  it('incluye el bloque de física del mundo (los scenePrompt nacen anclados)', () => {
    const s = buildMatcherSystemPrompt({});
    expect(s).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
    expect(s).toContain('nunca flota');
  });
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `pnpm test -- lib/prompt-director/format-matcher.test.ts`
Expected: FAIL en el test nuevo.

- [ ] **Step 3: Implementar**

En `lib/prompt-director/format-matcher.ts`:
1. Añadir import: `import { PLANNER_PHYSICS_BLOCK } from './style-profiles';`
2. En `buildMatcherSystemPrompt`, antes del `return system;` (línea 436), añadir:

```typescript
  // Física/coherencia del mundo (plan 2026-07-02): el "cuadro volando" se
  // corrige en el ORIGEN — el planner escribe scenePrompts con objetos anclados.
  // Fase 1 lo gatea por perfil de campaña (fantasía lo relaja).
  system += PLANNER_PHYSICS_BLOCK;
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `pnpm test -- lib/prompt-director/format-matcher.test.ts`
Expected: PASS (todos, incluidos los previos del describe).

- [ ] **Step 5: Commit**

```bash
git add lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts
git commit -m "feat(planner): bloque de física del mundo en el system del matcher"
```

---

## Task 6: Checkpoint de Fase 0 (verificación completa)

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: todo verde. `pnpm build` es obligatorio (gotcha conocido: errores que typecheck/lint no ven).

- [ ] **Step 2: Reportar al usuario el smoke manual pendiente (API real — la corre él)**

Fase 0 ya es desplegable por sí sola. Smoke sugerido al usuario:
1. Regenerar la imagen maestra de la locación "cuarto low key" con el botón "Generar con IA" (el prompt nuevo sale de `asset-prompts.ts`).
2. Regenerar un panel de esa locación y comparar contra el anterior (look de render, objetos anclados).

No commitear nada aquí; es un checkpoint.

---

# FASE 1 — perfil elegido por el usuario

## Task 7: Migración `visual_style` + spec

**Files:**
- Create: `supabase/migrations/051_campaign_visual_style.sql`
- Modify: `docs/zyra-studio-spec.md` (definición de la tabla `campaigns`, ~línea 164)

**Interfaces:**
- Produces: columnas `campaigns.visual_style` (text, default `'ultra_realista'`, check) y `campaigns.visual_style_custom` (text, nullable).

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/051_campaign_visual_style.sql`:

```sql
-- Perfil de estilo visual por campaña (plan 2026-07-02). Define el look de
-- todas las etapas de generación (planner, panel, refinado, video).
-- text + check constraint, nunca enum nativo (regla 10-database).
-- Default ultra_realista = comportamiento actual.
alter table campaigns
  add column if not exists visual_style text not null default 'ultra_realista'
    constraint campaigns_visual_style_check
    check (visual_style in ('ultra_realista', 'fantasia', 'animado', 'custom')),
  add column if not exists visual_style_custom text;

comment on column campaigns.visual_style is
  'Perfil de estilo visual: ultra_realista | fantasia | animado | custom';
comment on column campaigns.visual_style_custom is
  'Descripción libre del estilo cuando visual_style = custom';
```

- [ ] **Step 2: Actualizar el spec en paralelo**

En `docs/zyra-studio-spec.md`, en la definición de la tabla `campaigns` (buscar `aspect_ratio text not null default '9:16',` ~línea 164), añadir debajo:

```sql
  visual_style text not null default 'ultra_realista', -- ultra_realista | fantasia | animado | custom (051)
  visual_style_custom text, -- descripción libre cuando visual_style = custom (051)
```

- [ ] **Step 3: Aplicar la migración vía Supabase MCP**

Usar la tool `apply_migration` del MCP de Supabase con el contenido del archivo (nombre `051_campaign_visual_style`), en el proyecto activo del repo. **Esto debe ocurrir ANTES de que el código que lee la columna llegue a prod** (regla de orden migración→push del proyecto).

Verificar: `execute_sql` → `select column_name from information_schema.columns where table_name = 'campaigns' and column_name like 'visual%';` devuelve las 2 columnas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/051_campaign_visual_style.sql docs/zyra-studio-spec.md
git commit -m "db: agrega visual_style y visual_style_custom a campaigns"
```

---

## Task 8: Presets `fantasia`/`animado`/`custom` + `isStylized` con perfil

**Files:**
- Modify: `lib/prompt-director/style-profiles.ts`
- Modify: `lib/prompt-director/style-profiles.test.ts`
- Modify: `lib/prompt-director/asset-prompts.ts` (tercer parámetro `customText`)
- Modify: `lib/prompt-director/asset-prompts.test.ts`
- Modify: `lib/campaigns/storyboard.ts` (`isStylized`, `humanRealismDirective`, `sceneStyleDirective`, `physicsClause` — perfil-aware)
- Modify: `lib/campaigns/storyboard.test.ts`
- Modify: `server-actions/storyboard.ts` (call sites de `physicsClause()` → `physicsClause(dirCtx)`)

**Interfaces:**
- Produces:
  - `getStyleProfile(style?: string | null, customText?: string | null): StyleProfile` — nuevo segundo parámetro; `custom` sin texto cae a ultra_realista.
  - `isStylized(register: string, scenePrompt: string, style?: { slug: VisualStyle; custom?: string }): boolean` — tercer parámetro opcional (backward-compatible): `animado`/`fantasia` → `true` siempre; `custom` → regex también sobre el texto custom; `ultra_realista`/ausente → regex actual.
  - `physicsClause(ctx: DirectorContext): string` — ahora recibe ctx y gatea por perfil.
  - `buildLocationPrompt(description, style?, customText?)` / `buildCharacterMasterPrompt(description, style?, customText?)`.

- [ ] **Step 1: Tests que fallan (style-profiles)**

Añadir a `lib/prompt-director/style-profiles.test.ts`:

```typescript
describe('presets Fase 1', () => {
  it('fantasia: física libre y look de fantasía', () => {
    const p = getStyleProfile('fantasia');
    expect(p.slug).toBe('fantasia');
    expect(p.groundedPhysics).toBe(false);
    expect(p.panel).toMatch(/fantasy/);
    expect(p.planner).toContain('FANTASÍA');
  });

  it('animado: look de animación 3D con física creíble', () => {
    const p = getStyleProfile('animado');
    expect(p.slug).toBe('animado');
    expect(p.groundedPhysics).toBe(true);
    expect(p.panel).toMatch(/3D animated film/);
    expect(p.video).toMatch(/3D animation/);
  });

  it('custom: los bloques nacen del texto del usuario; sin texto cae a realista', () => {
    const p = getStyleProfile('custom', 'acuarela suave, colores pastel');
    expect(p.slug).toBe('custom');
    expect(p.panel).toContain('acuarela suave, colores pastel');
    expect(p.planner).toContain('acuarela suave');
    expect(p.groundedPhysics).toBe(true);
    expect(getStyleProfile('custom').slug).toBe('ultra_realista');
    expect(getStyleProfile('custom', '   ').slug).toBe('ultra_realista');
  });

  it('ningún preset nuevo usa términos antislop', () => {
    for (const slug of ['fantasia', 'animado'] as const) {
      const p = getStyleProfile(slug);
      for (const block of [p.assetLocation, p.assetCharacter, p.panel, p.video]) {
        expect(stripSlop(block).removed).toEqual([]);
      }
    }
  });
});
```

Run: `pnpm test -- lib/prompt-director/style-profiles.test.ts` → Expected: FAIL.

- [ ] **Step 2: Implementar los presets**

En `lib/prompt-director/style-profiles.ts`, después de `ULTRA_REALISTA` añadir:

```typescript
const FANTASIA: StyleProfile = {
  slug: 'fantasia',
  assetLocation:
    'The image is a scene from a rich fantasy world: painterly light, evocative atmosphere, imaginative architecture and materials that follow the internal logic of that world.',
  assetCharacter:
    'The image is a character portrait from a rich fantasy world: painterly light, evocative atmosphere, imaginative wardrobe consistent with that world.',
  panel:
    ' Render the scene as part of a rich fantasy world: painterly light, evocative atmosphere, imaginative but internally consistent — keep the same fantasy look across shots.',
  video: 'a rich fantasy look with painterly light, filmic color grading',
  planner:
    '\nESTILO DE LA CAMPAÑA: FANTASÍA. Las escenas pueden doblar la física y la lógica del mundo real cuando sirva a la idea; cuando lo hagan, descríbelo explícito en el scenePrompt.',
  groundedPhysics: false,
};

const ANIMADO: StyleProfile = {
  slug: 'animado',
  assetLocation:
    'The image is a frame from a polished 3D animated film: clean stylized shapes, soft global illumination, expressive color, appealing simplified detail.',
  assetCharacter:
    'The image is a character design frame from a polished 3D animated film: appealing stylized proportions, expressive face, clean shapes, soft even lighting.',
  panel:
    ' Render the scene as a frame from a polished 3D animated film: clean stylized shapes, soft global illumination, expressive color — keep the same animation style across shots.',
  video: 'a polished 3D animation look, expressive color',
  planner:
    '\nESTILO DE LA CAMPAÑA: ANIMADO (película de animación 3D). Escribe las escenas pensadas para ese look; la física sigue siendo creíble salvo un gag deliberado.',
  groundedPhysics: true,
};

// El estilo custom nace del texto del usuario: cada bloque lo cita tal cual.
// La física queda anclada (si el usuario quiere física libre, que elija fantasía
// o lo pida explícito en sus ideas — el planner lo respeta).
function customProfile(text: string): StyleProfile {
  const t = text.trim().replace(/\.+$/, '');
  return {
    slug: 'custom',
    assetLocation: `Visual style of the image: ${t}.`,
    assetCharacter: `Visual style of the image: ${t}.`,
    panel: ` Visual style of the whole scene, consistent across shots: ${t}.`,
    video: t,
    planner: `\nESTILO DE LA CAMPAÑA (definido por el usuario): ${t}. Escribe cada scenePrompt coherente con ese estilo.`,
    groundedPhysics: true,
  };
}
```

y reemplazar `getStyleProfile` por:

```typescript
export function getStyleProfile(style?: string | null, customText?: string | null): StyleProfile {
  switch (style) {
    case 'fantasia':
      return FANTASIA;
    case 'animado':
      return ANIMADO;
    case 'custom':
      return customText?.trim() ? customProfile(customText) : ULTRA_REALISTA;
    default:
      return ULTRA_REALISTA;
  }
}
```

Run: `pnpm test -- lib/prompt-director/style-profiles.test.ts` → Expected: PASS.

- [ ] **Step 3: `asset-prompts` con customText (test primero)**

Añadir a `lib/prompt-director/asset-prompts.test.ts`:

```typescript
describe('asset prompts con perfil', () => {
  it('animado genera locación con look de animación, sin bloque fotográfico', () => {
    const p = buildLocationPrompt('una cocina soleada', 'animado');
    expect(p).toMatch(/3D animated film/);
    expect(p).not.toMatch(/real photograph/);
  });

  it('custom inyecta el texto del usuario', () => {
    const p = buildCharacterMasterPrompt('un chef', 'custom', 'estilo cómic europeo, línea clara');
    expect(p).toContain('estilo cómic europeo');
  });
});
```

Run → FAIL. Implementar: en `lib/prompt-director/asset-prompts.ts`, ampliar ambas firmas a `(description: string, style?: VisualStyle, customText?: string)` y pasar `getStyleProfile(style, customText)`. Run → PASS.

- [ ] **Step 4: `isStylized` y directivas perfil-aware (test primero)**

Añadir a `lib/campaigns/storyboard.test.ts`:

```typescript
describe('perfil de estilo en las directivas del panel', () => {
  const withChar = {
    characters: [{ name: 'Ana', description: 'x', masterImagePath: 'p' }],
  } as never;

  it('perfil animado apaga el realismo humano aunque el texto no lo diga', () => {
    const ctx = { ...(withChar as object), style: { slug: 'animado' as const } } as never;
    expect(humanRealismDirective(ctx, 'she smiles at the camera')).toBe('');
  });

  it('perfil animado: el panel lleva el bloque de animación + física', () => {
    const d = sceneStyleDirective({ style: { slug: 'animado' } }, 'the mug on the table');
    expect(d).toMatch(/3D animated film/);
    expect(d).toMatch(/never floats/);
  });

  it('perfil fantasía: estilo sin cláusula de física', () => {
    const d = sceneStyleDirective({ style: { slug: 'fantasia' } }, 'the mug floats in the air');
    expect(d).toMatch(/fantasy world/);
    expect(d).not.toMatch(/never floats/);
    expect(physicsClause({ style: { slug: 'fantasia' } })).toBe('');
  });

  it('sin perfil (campañas viejas): comportamiento actual intacto', () => {
    expect(isStylized('', 'a normal scene')).toBe(false);
    expect(physicsClause({})).toMatch(/never floats/);
  });
});
```

Run → FAIL. Implementar en `lib/campaigns/storyboard.ts`:

```typescript
// ¿El creativo pide un look estilizado (no foto-real)? Perfil declarado manda
// (animado/fantasia SIEMPRE estilizados; custom añade su texto a la regex);
// sin perfil, la regex sobre registro + scene_prompt (compatibilidad).
export function isStylized(
  register: string,
  scenePrompt: string,
  style?: { slug: VisualStyle; custom?: string },
): boolean {
  if (style?.slug === 'animado' || style?.slug === 'fantasia') return true;
  const customText = style?.slug === 'custom' ? (style.custom ?? '') : '';
  return STYLIZED_RE.test(`${register} ${scenePrompt} ${customText}`);
}
```

(con `import type { VisualStyle } from '@/lib/prompt-director/style-profiles';`). En `humanRealismDirective` (línea 62), pasar el perfil: `if (isStylized(ctx.format?.register ?? '', scenePrompt, ctx.style)) return '';`. Reemplazar `sceneStyleDirective` y `physicsClause` por:

```typescript
export function sceneStyleDirective(ctx: DirectorContext, scenePrompt: string): string {
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  // Con perfil realista (o ausente), un beat individual estilizado por texto
  // apaga la directiva (regex de compatibilidad); con perfil declarado
  // no-realista, el perfil manda y emite su propio bloque.
  if (profile.slug === 'ultra_realista' && isStylized(ctx.format?.register ?? '', scenePrompt, ctx.style)) {
    return '';
  }
  return `${profile.panel}${profile.groundedPhysics ? WORLD_COHERENCE_CLAUSE : ''}`;
}

export function physicsClause(ctx: DirectorContext): string {
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  return profile.groundedPhysics ? WORLD_COHERENCE_CLAUSE : '';
}
```

Actualizar los call sites de `physicsClause()` → con argumento: en `compileRefinePrompt` (`physicsClause(ctx)`) y en `server-actions/storyboard.ts` rama encadenada (`physicsClause(dirCtx)`). El test de Task 4 `physicsClause()` cambia a `physicsClause({})`.

Run: `pnpm test -- lib/campaigns/storyboard.test.ts` → PASS.

- [ ] **Step 5: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add lib/prompt-director/style-profiles.ts lib/prompt-director/style-profiles.test.ts lib/prompt-director/asset-prompts.ts lib/prompt-director/asset-prompts.test.ts lib/campaigns/storyboard.ts lib/campaigns/storyboard.test.ts server-actions/storyboard.ts
git commit -m "feat(prompt-director): presets fantasía, animado y custom"
```

---

## Task 9: Schema zod + creación de campaña

**Files:**
- Modify: `lib/schemas/campaigns.ts` (`CreateCampaignStudioSchema`, líneas 68-98)
- Modify: `lib/schemas/campaigns.test.ts`
- Modify: `server-actions/campaigns.ts` (`createCampaignStudioAction`, insert ~línea 438-455)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `CreateCampaignStudioSchema` acepta `visualStyle` (enum, default `'ultra_realista'`) y `visualStyleCustom` (string 3-400, requerido si custom). El insert persiste `visual_style` y `visual_style_custom`.

- [ ] **Step 1: Tests que fallan**

Añadir a `lib/schemas/campaigns.test.ts` (usar el mismo `base` que los tests de `musicRefId`):

```typescript
describe('CreateCampaignStudioSchema — visualStyle', () => {
  it('default ultra_realista', () => {
    const r = CreateCampaignStudioSchema.safeParse(base);
    expect(r.success && r.data.visualStyle).toBe('ultra_realista');
  });
  it('acepta los 4 valores y rechaza otros', () => {
    expect(CreateCampaignStudioSchema.safeParse({ ...base, visualStyle: 'animado' }).success).toBe(true);
    expect(CreateCampaignStudioSchema.safeParse({ ...base, visualStyle: 'vaporwave' }).success).toBe(false);
  });
  it('custom exige descripción', () => {
    expect(CreateCampaignStudioSchema.safeParse({ ...base, visualStyle: 'custom' }).success).toBe(false);
    expect(
      CreateCampaignStudioSchema.safeParse({ ...base, visualStyle: 'custom', visualStyleCustom: 'acuarela suave' }).success,
    ).toBe(true);
  });
});
```

Run: `pnpm test -- lib/schemas/campaigns.test.ts` → FAIL.

- [ ] **Step 2: Implementar el schema**

En `CreateCampaignStudioSchema`, después de `aspectRatio` (línea 90), añadir:

```typescript
    // Perfil de estilo visual de la campaña (051): define el look de todas las
    // etapas (planner, panel, refinado, video). custom exige descripción.
    visualStyle: z.enum(['ultra_realista', 'fantasia', 'animado', 'custom']).default('ultra_realista'),
    visualStyleCustom: z.string().trim().min(3).max(400).optional(),
```

y encadenar tras el `.refine` existente (línea 96-98):

```typescript
  .refine((d) => d.visualStyle !== 'custom' || Boolean(d.visualStyleCustom?.trim()), {
    message: 'Describe el estilo personalizado',
  });
```

Run → PASS.

- [ ] **Step 3: Persistir en el insert**

En `server-actions/campaigns.ts`, dentro del `.insert({...})` de `createCampaignStudioAction` (~línea 440, junto a `aspect_ratio`), añadir:

```typescript
      visual_style: parsed.data.visualStyle,
      visual_style_custom:
        parsed.data.visualStyle === 'custom' ? (parsed.data.visualStyleCustom ?? null) : null,
```

- [ ] **Step 4: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add lib/schemas/campaigns.ts lib/schemas/campaigns.test.ts server-actions/campaigns.ts
git commit -m "feat(campaigns): visualStyle en schema y creación de campaña"
```

---

## Task 10: Threading `visual_style` → `CampaignContext` → `DirectorContext`

**Files:**
- Modify: `lib/campaigns/orchestrator.ts` (tipo `CampaignContext` ~línea 101; `loadCampaignContext` ~217/329; `directorContextFor` ~369; el otro tipo con `creative_guidelines` ~línea 732)
- Modify: `server-actions/storyboard.ts` (tipo `CampaignRow` línea 83-91; select línea 109)
- Modify: `server-actions/campaigns.ts` (selects y objetos campaign en líneas ~1404, ~1445, ~1473, ~1518, ~2429, ~2432, ~2464)
- Modify: `lib/campaigns/director-context.test.ts`

**Regla de oro de esta task:** correr `grep -n "creative_guidelines" lib/campaigns/orchestrator.ts server-actions/campaigns.ts server-actions/storyboard.ts` y espejear CADA aparición (select, tipo, objeto) con `visual_style` + `visual_style_custom`. `creative_guidelines` es el patrón exacto que este campo debe seguir; no debe quedar ningún sitio donde viaje una y no la otra. (La única excepción: `app/app/campaigns/[id]/page.tsx` y el editor de guías — el estilo no se edita post-creación en esta fase.)

**Interfaces:**
- Produces:
  - `CampaignContext.visualStyle?: VisualStyle` y `CampaignContext.visualStyleCustom?: string`
  - `loadCampaignContext` acepta `visual_style?: string | null; visual_style_custom?: string | null` en el parámetro `campaign` y los normaliza vía `getStyleProfile(...)`
  - `directorContextFor` emite `style: { slug, custom? }` en el `DirectorContext`

- [ ] **Step 1: Test que falla (director-context)**

En `lib/campaigns/director-context.test.ts`, añadir un caso reutilizando los fixtures existentes del archivo (hay tests que ya llaman `directorContextFor` con un `ItemRow` y un `CampaignContext` de prueba — copiar el fixture del caso más simple):

```typescript
  it('propaga el perfil de estilo de la campaña al DirectorContext', () => {
    const dir = directorContextFor(baseItem, null, {
      ...baseCtx,
      visualStyle: 'animado',
    });
    expect(dir.style).toEqual({ slug: 'animado' });

    const dirCustom = directorContextFor(baseItem, null, {
      ...baseCtx,
      visualStyle: 'custom',
      visualStyleCustom: 'acuarela suave',
    });
    expect(dirCustom.style).toEqual({ slug: 'custom', custom: 'acuarela suave' });

    // Campañas viejas sin columna: sin style (los helpers caen a ultra_realista).
    expect(directorContextFor(baseItem, null, baseCtx).style).toBeUndefined();
  });
```

(`baseItem`/`baseCtx` = los nombres reales de los fixtures del archivo; si se llaman distinto, usar esos.)

Run: `pnpm test -- lib/campaigns/director-context.test.ts` → FAIL.

- [ ] **Step 2: Implementar en `orchestrator.ts`**

1. Import: `import { getStyleProfile, type VisualStyle } from '@/lib/prompt-director/style-profiles';`
2. En `CampaignContext` (tras `guidelines`, línea 124):

```typescript
  // Perfil de estilo visual (051). Ausente = campañas previas a la columna.
  visualStyle?: VisualStyle;
  visualStyleCustom?: string;
```

3. En el tipo del parámetro `campaign` de `loadCampaignContext` (tras `creative_guidelines`, línea 230):

```typescript
    // Perfil de estilo visual (051). Callers viejos pueden no seleccionarla.
    visual_style?: string | null;
    visual_style_custom?: string | null;
```

4. En el objeto de retorno de `loadCampaignContext` (tras `guidelines`, línea 343):

```typescript
    ...(campaign.visual_style
      ? {
          // Normaliza valores desconocidos de la BD al slug del perfil (defensivo).
          visualStyle: getStyleProfile(campaign.visual_style, campaign.visual_style_custom).slug,
          ...(campaign.visual_style_custom ? { visualStyleCustom: campaign.visual_style_custom } : {}),
        }
      : {}),
```

5. En el retorno de `directorContextFor` (tras `guidelines`, línea 393):

```typescript
    ...(ctx.visualStyle
      ? { style: { slug: ctx.visualStyle, ...(ctx.visualStyleCustom ? { custom: ctx.visualStyleCustom } : {}) } }
      : {}),
```

6. Espejear el otro tipo con `creative_guidelines` (~línea 732) añadiendo los mismos dos campos opcionales.

- [ ] **Step 3: Espejear los selects/objetos en server actions**

Con el grep de la regla de oro, en cada sitio:
- `server-actions/storyboard.ts:90` (tipo `CampaignRow`): añadir `visual_style: string | null; visual_style_custom: string | null;`
- `server-actions/storyboard.ts:109` (select): añadir `, visual_style, visual_style_custom`
- `server-actions/campaigns.ts` líneas ~1404 y ~1473 (selects): añadir `, visual_style, visual_style_custom`
- `server-actions/campaigns.ts` líneas ~1445 y ~1518 (objetos campaign hacia `loadCampaignContext`): añadir

```typescript
      visual_style: (campaign.visual_style as string | null) ?? null,
      visual_style_custom: (campaign.visual_style_custom as string | null) ?? null,
```

- `server-actions/campaigns.ts:2429` (select con `campaigns!inner(...)`): añadir las 2 columnas dentro del paréntesis; en ~2432 ampliar el tipo inline del narrowing con `visual_style?: string | null; visual_style_custom?: string | null;`; en ~2464 añadir los mismos 2 campos al objeto.

- [ ] **Step 4: Verificar y commitear**

Run: `pnpm test -- lib/campaigns/director-context.test.ts` → PASS.

```bash
pnpm typecheck
pnpm test
git add lib/campaigns/orchestrator.ts lib/campaigns/director-context.test.ts server-actions/storyboard.ts server-actions/campaigns.ts
git commit -m "feat(campaigns): visual_style viaja al DirectorContext"
```

---

## Task 11: El pipeline consume el perfil (video + planner)

**Files:**
- Modify: `lib/prompt-director/compilers/seedance.ts` (bloque del `look`, líneas 368-380)
- Modify: `lib/prompt-director/prompt-director.test.ts` (tests del look)
- Modify: `lib/prompt-director/format-matcher.ts` (`buildMatcherSystemPrompt` + tipo de input de `matchIdeas`/`requestMatch`)
- Modify: `lib/prompt-director/format-matcher.test.ts`
- Modify: `server-actions/campaigns.ts` (`generatePlanAction`: select línea 492 + llamada a `matchIdeas` línea ~626-639)

**Interfaces:**
- Consumes: `DirectorContext.style` (Task 10), `getStyleProfile`, `PLANNER_PHYSICS_BLOCK`.
- Produces:
  - `compileSeedance`: el `look` del encabezado sale del perfil.
  - `buildMatcherSystemPrompt(opts: { language?; guidelines?; visualStyle?: VisualStyle; visualStyleCustom?: string })` — añade `profile.planner` y gatea `PLANNER_PHYSICS_BLOCK` por `groundedPhysics` (reemplaza el append incondicional de Task 5).
  - `matchIdeas`/`requestMatch` aceptan y propagan `visualStyle`/`visualStyleCustom`.

- [ ] **Step 1: Tests que fallan (seedance look)**

En `lib/prompt-director/prompt-director.test.ts`, añadir al describe de Seedance existente (buscar los tests que asserten el encabezado del video):

```typescript
  it('perfil animado cambia el look base del video', () => {
    const r = compile(
      { modelSlug: 'seedance-1-pro', scenePrompt: 'the mug spins on the table', durationS: 5 },
      { style: { slug: 'animado' } },
    );
    expect(r.ok && r.compiled.prompt).toContain('3D animation look');
    expect(r.ok && r.compiled.prompt).not.toContain('ultra realistic');
  });

  it('sin perfil, el look realista actual se conserva', () => {
    const r = compile(
      { modelSlug: 'seedance-1-pro', scenePrompt: 'the mug spins on the table', durationS: 5 },
      {},
    );
    expect(r.ok && r.compiled.prompt).toContain('ultra realistic, filmic color grading');
  });
```

(Ajustar `modelSlug` al slug que usen los tests seedance existentes del archivo.)

Run → FAIL.

- [ ] **Step 2: Implementar el look en `seedance.ts`**

Añadir import `import { getStyleProfile } from '../style-profiles';` y reemplazar las líneas 374-377 (regex `stylized` + `look`):

```typescript
  const profile = getStyleProfile(ctx.style?.slug, ctx.style?.custom);
  const stylizedRegister = /\b(surreal|imposible|impossible|stylized|estilizad|abstract|abstracto|surrealist|hyperreal|dreamlike|onírico|animat)\w*/i.test(
    ctx.format?.register ?? '',
  );
  // Perfil declarado no-realista → su look manda. Perfil realista (o ausente)
  // con formato estilizado (el-icono, mundo-imposible) → se degrada a solo
  // filmic (comportamiento actual).
  const look =
    profile.slug !== 'ultra_realista'
      ? profile.video
      : stylizedRegister
        ? 'filmic color grading'
        : profile.video;
```

(la variable `stylized` original se renombra a `stylizedRegister`; verificar si se usa más abajo en el archivo y renombrar esas referencias.)

Run → PASS.

- [ ] **Step 3: Tests que fallan (matcher por perfil)**

En `lib/prompt-director/format-matcher.test.ts`, añadir al describe de `buildMatcherSystemPrompt`:

```typescript
  it('fantasía: bloque de estilo presente y física del mundo ausente', () => {
    const s = buildMatcherSystemPrompt({ visualStyle: 'fantasia' });
    expect(s).toContain('FANTASÍA');
    expect(s).not.toContain('FÍSICA Y COHERENCIA DEL MUNDO');
  });

  it('custom: el texto del usuario entra al system', () => {
    const s = buildMatcherSystemPrompt({ visualStyle: 'custom', visualStyleCustom: 'acuarela suave' });
    expect(s).toContain('acuarela suave');
    expect(s).toContain('FÍSICA Y COHERENCIA DEL MUNDO');
  });
```

Run → FAIL.

- [ ] **Step 4: Implementar en `format-matcher.ts`**

1. Ampliar el import de style-profiles: `import { getStyleProfile, PLANNER_PHYSICS_BLOCK, type VisualStyle } from './style-profiles';`
2. En `buildMatcherSystemPrompt`, ampliar el tipo de `opts` con `visualStyle?: VisualStyle; visualStyleCustom?: string;` y reemplazar el `system += PLANNER_PHYSICS_BLOCK;` de Task 5 por:

```typescript
  // Perfil de estilo de la campaña: bloque de autoría + física gateada por perfil.
  const profile = getStyleProfile(opts.visualStyle, opts.visualStyleCustom);
  system += profile.planner;
  if (profile.groundedPhysics) system += PLANNER_PHYSICS_BLOCK;
```

3. Ampliar los tipos de input de `matchIdeas` y `requestMatch` con los mismos 2 campos opcionales, y en `requestMatch` pasar ambos a `buildMatcherSystemPrompt` (línea 483):

```typescript
  const system = buildMatcherSystemPrompt({
    language: input.language,
    guidelines: input.guidelines,
    visualStyle: input.visualStyle,
    visualStyleCustom: input.visualStyleCustom,
  });
```

Run → PASS (los tests de Task 5 siguen pasando: sin perfil, `groundedPhysics` default es true).

- [ ] **Step 5: Pasarlo desde `generatePlanAction`**

En `server-actions/campaigns.ts`:
1. Select línea 492: añadir `, visual_style, visual_style_custom`.
2. En la llamada a `matchIdeas` (línea ~626-639), tras `...(guidelines ? { guidelines } : {})`:

```typescript
        ...(campaign.visual_style
          ? { visualStyle: campaign.visual_style as import('@/lib/prompt-director/style-profiles').VisualStyle }
          : {}),
        ...(campaign.visual_style_custom ? { visualStyleCustom: campaign.visual_style_custom as string } : {}),
```

(o importar `type VisualStyle` arriba y castear con él, según el estilo de imports del archivo).

- [ ] **Step 6: Verificar y commitear**

```bash
pnpm typecheck
pnpm test
git add lib/prompt-director/compilers/seedance.ts lib/prompt-director/prompt-director.test.ts lib/prompt-director/format-matcher.ts lib/prompt-director/format-matcher.test.ts server-actions/campaigns.ts
git commit -m "feat(prompt-director): el pipeline consume el perfil de estilo"
```

---

## Task 12: UI — selector en wizard y editores de activos

**Files:**
- Create: `components/shared/VisualStyleSelector.tsx`
- Modify: `components/campaigns/CampaignStudioWizard.tsx` (estado ~línea 105, sección tras "Formato de video" ~línea 527, payload ~línea 190, guard `canSubmit` ~línea 161)
- Modify: `components/locations/LocationsPage.tsx` (`LocationEditor`: estado + selector en el bloque "generar con IA" + `photoreal` condicional)
- Modify: `components/cast/CastPage.tsx` (`CharacterEditor`: ídem)

**Interfaces:**
- Consumes: `type VisualStyle` de `@/lib/prompt-director/style-profiles`; `buildLocationPrompt`/`buildCharacterMasterPrompt` con `(description, style, customText)`.
- Produces: `VisualStyleSelector` (client component) con props `{ value, customText, onValueChange, onCustomTextChange, compact? }`.

- [ ] **Step 1: Crear el componente compartido**

`components/shared/VisualStyleSelector.tsx`:

```tsx
'use client';

import { Input } from '@/components/ui/input';
import type { VisualStyle } from '@/lib/prompt-director/style-profiles';

export const VISUAL_STYLE_OPTIONS: Array<{ value: VisualStyle; label: string; hint: string }> = [
  { value: 'ultra_realista', label: 'Ultra realista', hint: 'Fotografia real, fisica creible' },
  { value: 'fantasia', label: 'Fantasia', hint: 'Mundos imaginarios, fisica libre' },
  { value: 'animado', label: 'Animado', hint: 'Look de animacion 3D' },
  { value: 'custom', label: 'Personalizado', hint: 'Describe tu propio estilo' },
];

// Selector de perfil de estilo visual (plan 2026-07-02). Mismo patron visual
// que el selector de formato de video del wizard. compact = grid 2x2 para las
// columnas angostas de los editores de activos.
export function VisualStyleSelector({
  value,
  customText,
  onValueChange,
  onCustomTextChange,
  compact = false,
}: {
  value: VisualStyle;
  customText: string;
  onValueChange: (v: VisualStyle) => void;
  onCustomTextChange: (t: string) => void;
  compact?: boolean;
}) {
  return (
    <div>
      <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex gap-2'}>
        {VISUAL_STYLE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            onClick={() => onValueChange(o.value)}
            className={`${compact ? '' : 'flex-1 '}rounded-lg border px-3 py-2 text-2sm transition-colors ${
              value === o.value
                ? 'border-primary/60 bg-primary/10 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {value === 'custom' && (
        <Input
          value={customText}
          onChange={(e) => onCustomTextChange(e.target.value)}
          placeholder="ej. acuarela suave, colores pastel, trazos visibles"
          maxLength={400}
          className="mt-2"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrar en el wizard**

En `components/campaigns/CampaignStudioWizard.tsx`:
1. Imports: `import { VisualStyleSelector } from '@/components/shared/VisualStyleSelector';` y `import type { VisualStyle } from '@/lib/prompt-director/style-profiles';`
2. Estado (junto a `aspectRatio`, ~línea 105):

```tsx
  // Perfil de estilo visual de la campaña (051): define el look de todo el plan.
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('ultra_realista');
  const [visualStyleCustom, setVisualStyleCustom] = useState('');
```

3. Guard (línea 161): `const canSubmit = name.trim().length > 0 && productReady && !submitting && !musicBusy && (visualStyle !== 'custom' || visualStyleCustom.trim().length >= 3);`
4. Sección nueva inmediatamente después de la sección "Formato de video" (tras la línea 527):

```tsx
        <section>
          <span className="text-xs font-medium text-foreground/80">Estilo visual</span>
          <div className="mt-1.5">
            <VisualStyleSelector
              value={visualStyle}
              customText={visualStyleCustom}
              onValueChange={setVisualStyle}
              onCustomTextChange={setVisualStyleCustom}
            />
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">
            Define el look de todos los creativos: escenas, paneles y video. Ultra realista
            incluye fisica creible (objetos apoyados o colgados, nunca flotando).
          </p>
        </section>
```

5. Payload en `runCreate` (tras `aspectRatio,` línea 190):

```tsx
      visualStyle,
      ...(visualStyle === 'custom' && visualStyleCustom.trim()
        ? { visualStyleCustom: visualStyleCustom.trim() }
        : {}),
```

- [ ] **Step 3: Integrar en `LocationEditor`**

En `components/locations/LocationsPage.tsx` (función `LocationEditor`):
1. Imports: `VisualStyleSelector` y `type VisualStyle`.
2. Estado (junto a `generating`, ~línea 186):

```tsx
  const [visualStyle, setVisualStyle] = useState<VisualStyle>('ultra_realista');
  const [visualStyleCustom, setVisualStyleCustom] = useState('');
```

3. En `handleGenerateMaster` (~línea 235-244): pasar el estilo al prompt y condicionar `photoreal` (la directiva fotorreal del provider pelearía contra un estilo animado):

```tsx
        prompt: buildLocationPrompt(
          description.trim(),
          visualStyle,
          visualStyle === 'custom' ? visualStyleCustom.trim() : undefined,
        ),
        // ...
        photoreal: visualStyle === 'ultra_realista',
```

4. En el JSX, dentro del bloque del botón "generar locación con IA" (~línea 337), encima del botón:

```tsx
          <div className="mb-2">
            <VisualStyleSelector
              compact
              value={visualStyle}
              customText={visualStyleCustom}
              onValueChange={setVisualStyle}
              onCustomTextChange={setVisualStyleCustom}
            />
          </div>
```

5. Deshabilitar generar si custom sin texto: ampliar `canGenerate` con `&& (visualStyle !== 'custom' || visualStyleCustom.trim().length >= 3)`.

- [ ] **Step 4: Integrar en `CharacterEditor`**

En `components/cast/CastPage.tsx`, mismos 5 cambios (estado junto a `generating`, selector compact encima del botón "Generar con IA" ~línea 409, `buildCharacterMasterPrompt(description.trim(), visualStyle, ...)`, `photoreal: visualStyle === 'ultra_realista'`, guard en `canGenerate`).

- [ ] **Step 5: Verificar y commitear**

```bash
pnpm typecheck
pnpm lint
pnpm test
git add components/shared/VisualStyleSelector.tsx components/campaigns/CampaignStudioWizard.tsx components/locations/LocationsPage.tsx components/cast/CastPage.tsx
git commit -m "feat(ui): selector de estilo visual en wizard y editores de activos"
```

---

## Task 13: Verificación final y cierre

**Files:** ninguno nuevo.

- [ ] **Step 1: Suite completa + build**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: todo verde. `pnpm build` es obligatorio antes de dar por cerrado (gotcha `'use server'`).

- [ ] **Step 2: Checklist de entrega (reportar al usuario, NO ejecutar sin que lo pida)**

1. **Migración 051 ya aplicada vía MCP** (Task 7) — confirmar antes de cualquier push.
2. Smoke manual del usuario (API real): regenerar maestra del "cuarto low key" (ultra realista), crear una campaña de prueba con estilo `animado` y verificar plan → panel → video coherentes.
3. Merge de `feat/perfiles-estilo-visual` → `development` según flujo del repo (el usuario decide cuándo).
4. Pendientes explícitos fuera de alcance (decisión YAGNI, documentar en el reporte final):
   - El estilo NO es editable post-creación de campaña (no hay UI en `CampaignDetailPage`); cambiar el estilo de una campaña existente requiere SQL manual o campaña nueva.
   - Las locaciones/personajes no persisten con qué estilo se generaron (la imagen es la verdad).
   - `humanRealismDirective` conserva su texto original (solo cambió su gate `isStylized`).

---

## Self-review (ejecutada al escribir el plan)

- **Cobertura**: Fase 0 = vocabulario (Tasks 2-3), física en imagen (Task 4), física en planner (Task 5). Fase 1 = columna (7), presets (8), schema+insert (9), threading (10), consumo video/planner (11), UI en wizard + activos (12). El requisito del usuario "al crear tus activos... y campaña en general" queda cubierto por 12 (activos: selector por generación; campaña: persistido).
- **Tipos consistentes**: `VisualStyle` y `StyleProfile` definidos en Task 1 y consumidos con esos nombres en 2, 8-12. `getStyleProfile` cambia de aridad 1 (Fase 0) a 2 (Task 8) — los callers de Fase 0 (`asset-prompts`, `sceneStyleDirective`, `physicsClause`) se actualizan en Task 8 explícitamente. `physicsClause()` → `physicsClause(ctx)` también en Task 8 con sus dos call sites listados.
- **Sin placeholders**: cada bloque de prompt, test y edit tiene el contenido literal. Los dos puntos con incertidumbre real (nombres de fixtures en `director-context.test.ts`, línea exacta del tipo ~732 en orchestrator) llevan instrucción de resolución (usar los del archivo / grep espejo de `creative_guidelines`).
