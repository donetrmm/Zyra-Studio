# Estudio Fase 5 — Presets + retiro del wizard/refiners + integración del wizard de campaña

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps usan checkbox (`- [ ]`).

**Goal:** Cerrar el estudio creativo: llevar los prompts hoy hardcodeados (ángulos, quitar fondo, luz, de noche…) a **presets del compositor** (integrados + los guardados del usuario), **retirar** el `CreationWizard` modal, el `MasterImageRefiner` inline y los botones de ángulo de los editores, y **reconectar** el paso "crear producto con IA" del wizard de campaña a la biblioteca de productos.

**Architecture:** Los presets son atajos del compositor del estudio que prellenan el prompt y activan "mantener idéntico"; el guard real ya vive server-side (`assembleStudioPrompt`). Retirar los refinadores/wizard empuja la edición de imágenes de activo al estudio (que ya hace todo desde Fase 2-4b). El borrado de código muerto va al final, cuando ningún editor referencia ya esas piezas.

**Tech Stack:** Next.js 15 App Router, React client components, tabla `presets` existente (genérica), server actions y RSC existentes, vitest para lógica pura. **Sin migración** (se reusa la tabla `presets`).

## Global Constraints

Verbatim; aplican a TODAS las tareas:

- **Sin `any`** (usar `unknown` + narrowing o tipo explícito).
- Sin emojis en código/UI; dark mode; **tokens semánticos** (`text-muted-foreground`, `border-border`, `bg-background`, `text-foreground`…), no `zinc-*` crudos ni colores fijos.
- **URLs de proveedor nunca al cliente** (no aplica directamente aquí: los presets solo manejan texto de prompt).
- **RLS/ownership**: la tabla `presets` tiene RLS (`user_id = auth.uid() or is_public or is_admin`); el RSC filtra por `user_id` + `type='image'`.
- **Créditos solo vía funciones SQL atómicas** (los presets no generan; solo prellenan el compositor, que ya reserva créditos al enviar).
- Componentes shadcn primero. Server Components por default; `'use client'` solo con state/effects.
- **Sin APIs reales en tests** (vitest puro). Los smokes los corre el usuario.
- **pnpm** para todo (`pnpm typecheck`/`build`/`lint`/`test`).
- Commits en español, imperativos, **SIN `Co-Authored-By`**.
- **Cada task deja el build verde** (typecheck/lint/test/build). El borrado de piezas huérfanas va SOLO en la Task 7, después de que las Tasks 3-6 quiten todos sus usos.

## Decisiones (del spec §Presets/§Retiro y confirmadas con el usuario)

- **Presets = integrados + guardados.** Integrados: catálogo estático por tipo de activo (los prompts retirados). Guardados: filas `presets` del usuario (`type='image'`), cargadas por el RSC y ofrecidas en el compositor. Aplicar un preset = `setPrompt(preset.prompt)` + `setKeepIdentical(preset.keepIdentical)`.
- **Wizard de campaña → enlace a la biblioteca.** El link "Créala con IA" se reemplaza por un enlace a `/app/brand/kits` (donde el producto se crea con el estudio); se retira el `CreationWizard` embebido. El usuario acepta que salir del wizard puede requerir re-entrar.
- **Se retiran:** `CreationWizard`, `MasterImageRefiner`, botones de ángulo (producto) y "Crear con IA" (cast). **NO se retiran** (fuera de alcance del spec): los bakes de Estado/Outfit/Cuerpo completo del cast, el mapa de escala de locación, ni el retoque de biblioteca — sus funciones de `generate.ts` se conservan.

## File Structure

- **Crear** `lib/studio/presets.ts` (+ test) — catálogo integrado por tipo + parser puro de un preset guardado (`params` jsonb → `StudioPreset`).
- **Modificar** `components/studio/Composer.tsx` — selector de presets (integrados + guardados) que prellena prompt + guard; recibe `assetType` y `userPresets`.
- **Modificar** `components/studio/types.ts` — `StudioClientProps` gana `userPresets`.
- **Modificar** `components/studio/StudioClient.tsx` — pasa `assetType`/`userPresets` al `Composer`.
- **Modificar** `app/app/studio/[assetType]/[assetId]/page.tsx` — carga los presets de imagen del usuario y los pasa.
- **Modificar** `components/products/ProductEditor.tsx` — quita `MasterImageRefiner` + botones de ángulo.
- **Modificar** `components/locations/LocationsPage.tsx` — quita `MasterImageRefiner`.
- **Modificar** `components/cast/CastPage.tsx` — quita `MasterImageRefiner` + "Crear con IA" (`CreationWizard`).
- **Modificar** `components/campaigns/CampaignStudioWizard.tsx` — reemplaza el `CreationWizard` por enlace a `/app/brand/kits`.
- **Borrar** `components/creation/CreationWizard.tsx`, `components/shared/MasterImageRefiner.tsx`, funciones huérfanas de `components/creation/generate.ts` (+ sus tests en `generate.test.ts`) y las actions huérfanas de `server-actions/creation.ts`.

---

### Task 1: Catálogo de presets + parser (puro) + tests

**Files:**
- Create: `lib/studio/presets.ts`
- Test: `lib/studio/presets.test.ts`

**Interfaces (produce; lo consumen Tasks 2 y 3-5 no lo tocan):**
- `type StudioPreset = { id: string; label: string; prompt: string; keepIdentical: boolean }`
- `const BUILTIN_PRESETS: Record<StudioAssetType, StudioPreset[]>`
- `function parseUserPreset(row: { id: string; name: string; params: unknown }): StudioPreset | null`

- [ ] **Step 1: Test que falla** — `lib/studio/presets.test.ts`:

```ts
// parseUserPreset extrae un preset usable de una fila `presets` (params jsonb,
// unknown): necesita un prompt string no vacío; keepIdentical opcional (los
// presets guardados hoy no lo persisten → default false). Un bug acá mete un
// preset roto (prompt vacío/no-string) al compositor. Se cubre cada rama.
import { describe, it, expect } from 'vitest';
import { BUILTIN_PRESETS, parseUserPreset } from '@/lib/studio/presets';

describe('BUILTIN_PRESETS', () => {
  it('cada tipo trae presets con label y prompt no vacíos', () => {
    for (const type of ['product', 'location', 'character'] as const) {
      expect(BUILTIN_PRESETS[type].length).toBeGreaterThan(0);
      for (const p of BUILTIN_PRESETS[type]) {
        expect(p.label.trim().length).toBeGreaterThan(0);
        expect(p.prompt.trim().length).toBeGreaterThan(0);
        expect(typeof p.keepIdentical).toBe('boolean');
      }
    }
  });
});

describe('parseUserPreset', () => {
  it('params con prompt string → preset (label = name, keepIdentical default false)', () => {
    const p = parseUserPreset({ id: 'u1', name: 'Mi preset', params: { prompt: '  haz X  ' } });
    expect(p).toEqual({ id: 'u1', label: 'Mi preset', prompt: 'haz X', keepIdentical: false });
  });

  it('respeta keepIdentical boolean de params', () => {
    const p = parseUserPreset({ id: 'u2', name: 'N', params: { prompt: 'X', keepIdentical: true } });
    expect(p?.keepIdentical).toBe(true);
  });

  it('keepIdentical no-boolean → false', () => {
    const p = parseUserPreset({ id: 'u3', name: 'N', params: { prompt: 'X', keepIdentical: 'sí' } });
    expect(p?.keepIdentical).toBe(false);
  });

  it('params sin prompt → null', () => {
    expect(parseUserPreset({ id: 'u4', name: 'N', params: { model: 'nano' } })).toBeNull();
  });

  it('prompt no-string → null', () => {
    expect(parseUserPreset({ id: 'u5', name: 'N', params: { prompt: 42 } })).toBeNull();
  });

  it('prompt vacío/espacios → null', () => {
    expect(parseUserPreset({ id: 'u6', name: 'N', params: { prompt: '   ' } })).toBeNull();
  });

  it('params no-objeto (null / string) → null', () => {
    expect(parseUserPreset({ id: 'u7', name: 'N', params: null })).toBeNull();
    expect(parseUserPreset({ id: 'u8', name: 'N', params: 'x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Correr y ver fallar** — `pnpm test presets`. Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementación** — `lib/studio/presets.ts`:

```ts
import type { StudioAssetType } from '@/components/studio/types';

export type StudioPreset = {
  id: string; // 'builtin:...' para integrados; el uuid de la fila para guardados
  label: string;
  prompt: string;
  keepIdentical: boolean;
};

// Presets integrados por tipo de activo: los prompts que vivían en los botones
// de ángulo / quick-action de los editores (retirados en Fase 5). Al aplicarlos
// prellenan el prompt y activan "mantener idéntico" (el guard real lo agrega
// assembleStudioPrompt server-side, según el assetType de la sesión).
export const BUILTIN_PRESETS: Record<StudioAssetType, StudioPreset[]> = {
  product: [
    { id: 'builtin:product-3q', label: 'Vista 3/4', keepIdentical: true, prompt: 'Rotate the camera to show the exact same product from a three-quarter angle (turned about 45 degrees), so its front and one side are both visible at once. Do not alter or invent any label text.' },
    { id: 'builtin:product-90', label: 'Vista 90°', keepIdentical: true, prompt: 'Rotate the camera to show the exact same product from a direct side profile view (turned 90 degrees), so only its side is visible. Do not alter or invent any label text.' },
    { id: 'builtin:product-nobg', label: 'Quitar fondo', keepIdentical: true, prompt: 'Place the exact same product on a clean plain white background, removing the current background.' },
    { id: 'builtin:product-relight', label: 'Mejorar luz', keepIdentical: true, prompt: 'Relight the scene with even, soft, professional product lighting, neutral white balance and true-to-life colors with no warm yellow cast.' },
  ],
  location: [
    { id: 'builtin:loc-night', label: 'De noche', keepIdentical: true, prompt: 'Turn the scene to night time: dark sky, ambient and practical lights on, believable night lighting.' },
    { id: 'builtin:loc-warm', label: 'Luz más cálida', keepIdentical: true, prompt: 'Make the lighting warmer and softer, golden-hour feel, still believable for the place.' },
    { id: 'builtin:loc-clear', label: 'Despejar', keepIdentical: true, prompt: 'Remove any people, clutter and distracting loose objects, leaving the space clean and ready for a scene.' },
  ],
  character: [
    { id: 'builtin:char-3q', label: 'Vista 3/4', keepIdentical: true, prompt: 'Show the exact same person from a three-quarter view (about 45 degrees). Identical face, hairstyle, build, skin and clothing; only the camera angle changes.' },
    { id: 'builtin:char-90', label: 'Vista 90°', keepIdentical: true, prompt: 'Show the exact same person from a direct side profile view (90 degrees). Identical face, hairstyle, build, skin and clothing; only the camera angle changes.' },
  ],
};

// Extrae un StudioPreset de una fila `presets` (params jsonb = unknown). Guarda:
// necesita un prompt string no vacío; keepIdentical opcional (los presets
// guardados hoy no lo persisten → default false). Devuelve null si no sirve.
export function parseUserPreset(row: { id: string; name: string; params: unknown }): StudioPreset | null {
  const params = row.params;
  if (!params || typeof params !== 'object') return null;
  const record = params as Record<string, unknown>;
  const prompt = record.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const keep = record.keepIdentical;
  return {
    id: row.id,
    label: row.name,
    prompt: prompt.trim(),
    keepIdentical: typeof keep === 'boolean' ? keep : false,
  };
}
```

- [ ] **Step 4: Correr y ver pasar** — `pnpm test presets`. Expected: PASS.
- [ ] **Step 5: Commit** — `git add lib/studio/presets.ts lib/studio/presets.test.ts && git commit -m "feat(estudio): catalogo de presets integrados + parser de presets guardados"`

---

### Task 2: Presets en el compositor (integrados + guardados) + carga en el RSC

**Files:**
- Modify: `components/studio/types.ts` (StudioClientProps gana `userPresets`)
- Modify: `app/app/studio/[assetType]/[assetId]/page.tsx` (carga presets del usuario)
- Modify: `components/studio/StudioClient.tsx` (pasa `assetType`/`userPresets` al Composer)
- Modify: `components/studio/Composer.tsx` (selector de presets)

**Interfaces:**
- Consume de Task 1: `BUILTIN_PRESETS`, `parseUserPreset`, `type StudioPreset` desde `@/lib/studio/presets`.

- [ ] **Step 1: `components/studio/types.ts`** — importar el tipo y añadir el prop:

En los imports, junto a `import type { PricingRow } ...`, añadir:
```ts
import type { StudioPreset } from '@/lib/studio/presets';
```
En `StudioClientProps`, tras `availableReferences: StudioRefOption[];`, añadir:
```ts
  // Presets de imagen guardados del usuario (tabla presets, type='image'). Los
  // integrados (BUILTIN_PRESETS) los resuelve el Composer por assetType.
  userPresets: StudioPreset[];
```

- [ ] **Step 2: `app/app/studio/[assetType]/[assetId]/page.tsx`** — cargar y pasar.

Tras el bloque que arma `pricing = await loadPricing();`, añadir la carga (usa `supabase`, `user`, `type` ya en scope; `parseUserPreset` importado):
```ts
  // Presets de imagen del usuario (se ofrecen en el compositor). RLS por user_id;
  // se filtran los que no traen un prompt usable.
  const { data: presetRows } = await supabase
    .from('presets')
    .select('id, name, params')
    .eq('user_id', user.id)
    .eq('type', 'image')
    .order('created_at', { ascending: false });
  const userPresets = (presetRows ?? [])
    .map((r) => parseUserPreset({ id: r.id as string, name: r.name as string, params: r.params }))
    .filter((p): p is StudioPreset => p !== null);
```
Añadir el import arriba:
```ts
import { parseUserPreset, type StudioPreset } from '@/lib/studio/presets';
```
En el `<StudioClient ... />`, añadir el prop `userPresets={userPresets}`.

- [ ] **Step 3: `components/studio/StudioClient.tsx`** — pasar al Composer.

En el `<Composer ... />` (donde hoy pasa `pricing`/`balance`/`availableReferences`/`hasWorkingImage`/`disabled`/`onSubmit`), añadir:
```tsx
            assetType={props.assetType}
            userPresets={props.userPresets}
```

- [ ] **Step 4: `components/studio/Composer.tsx`** — selector de presets.

Añadir a los imports de `@/components/ui/select` los sub-componentes de grupo (verificar que `components/ui/select.tsx` los exporte; en shadcn estándar sí):
```ts
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```
Añadir imports:
```ts
import { BUILTIN_PRESETS, type StudioPreset } from '@/lib/studio/presets';
import type { StudioAssetType } from './types';
```
Ampliar los props del componente con:
```ts
  assetType: StudioAssetType;
  userPresets: StudioPreset[];
```
Dentro del componente, tras `const fileRef = useRef...`, calcular las listas y el handler:
```tsx
  const builtinPresets = BUILTIN_PRESETS[props.assetType];
  const applyPreset = (id: string) => {
    const preset =
      builtinPresets.find((p) => p.id === id) ?? props.userPresets.find((p) => p.id === id);
    if (!preset) return;
    setPrompt(preset.prompt);
    if (preset.keepIdentical) setKeepIdentical(true);
  };
  const hasPresets = builtinPresets.length > 0 || props.userPresets.length > 0;
```
En la fila de controles (el `<div className="flex flex-wrap items-center gap-2">` con los Select de modelo/variant/aspect), añadir ANTES del `<label className="ml-auto ...">` (el toggle "Mantener idéntico") el selector de presets. `value=""` fijo = actúa como menú de acción (Radix mantiene el placeholder; al elegir aplica y no persiste selección):
```tsx
        {hasPresets ? (
          <Select value="" onValueChange={applyPreset}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Presets" />
            </SelectTrigger>
            <SelectContent>
              {builtinPresets.length > 0 ? (
                <SelectGroup>
                  <SelectLabel className="text-xs">Sugeridos</SelectLabel>
                  {builtinPresets.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
              {props.userPresets.length > 0 ? (
                <SelectGroup>
                  <SelectLabel className="text-xs">Guardados</SelectLabel>
                  {props.userPresets.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
        ) : null}
```

- [ ] **Step 5: Verificar** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Todo verde (incluye los tests de Task 1). Traza: en el estudio de un producto, el selector "Presets" muestra "Sugeridos" (Vista 3/4, 90°, Quitar fondo, Mejorar luz) y, si el usuario tiene presets de imagen guardados, "Guardados"; elegir uno prellena el prompt y enciende "Mantener idéntico". Locación/personaje muestran sus propios integrados. Si no hay presets, el selector no aparece.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(estudio): selector de presets en el compositor (integrados por tipo + guardados del usuario)"`

---

### Task 3: Retirar MasterImageRefiner y botones de ángulo del editor de producto

**Files:** Modify `components/products/ProductEditor.tsx`

Quitar del editor de producto (referencias de línea aproximadas del mapeo; el implementador localiza los bloques exactos):
- El uso de `<MasterImageRefiner ... refine={refineProductImage} ... />` por-vista (bloque ~218-227) y su botón toggle "Retocar esta vista con IA" (~204-217), junto con el estado/handler que solo servían para eso (`adoptRefinedView` ~122-130 si queda huérfano; verificar que no lo use otra cosa).
- Los botones de ángulo "3/4" y "90°" (~233-256) y su handler `generateAngleView` (~103-118).
- El import de `MasterImageRefiner` (línea 12) y los imports de `refineProductImage` / `generateProductAngle` desde `@/components/creation/generate` (verificar que no queden otros usos de esos símbolos en el archivo).

Conservar TODO lo demás del editor (ficha, uploaders de imágenes de producto/empaque, `setProductImagesAction`, etc.). El editor sigue funcionando; la edición IA de las vistas ahora se hace en el estudio ("Abrir estudio" ya existe en la tarjeta de producto).

- [ ] **Step 1:** Quitar los bloques anteriores y sus imports huérfanos.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm build`. Verde. `MasterImageRefiner`, `refineProductImage`, `generateProductAngle` quedan sin usar desde este archivo (se borran en Task 7 cuando ya nadie los use).
- [ ] **Step 3: Commit** — `git commit -m "refactor(estudio): retira el retoque inline y los botones de angulo del editor de producto"`

---

### Task 4: Retirar MasterImageRefiner del editor de locación

**Files:** Modify `components/locations/LocationsPage.tsx`

- Quitar el bloque `{masterImages.length > 0 && (<MasterImageRefiner ... refine={refineLocationMaster} quickActions={[...]} />)}` (~360-372).
- Quitar el import de `MasterImageRefiner` (línea 20) y de `refineLocationMaster` (del import de `@/components/creation/generate` en la línea 19 — conservar los otros símbolos que ese import trae y sí se usan: `generateScaleMap`, `generateScaleMapFromMaster`, `isGenError`).

Conservar el resto (uploader de maestra, generación de locación con IA, mapa de escala, referencias). La edición iterativa de la maestra pasa al estudio ("Abrir estudio" ya está en la tarjeta).

- [ ] **Step 1:** Quitar el bloque + los imports huérfanos.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm build`. Verde.
- [ ] **Step 3: Commit** — `git commit -m "refactor(estudio): retira el retoque inline de la maestra del editor de locacion"`

---

### Task 5: Retirar MasterImageRefiner y "Crear con IA" del editor de cast

**Files:** Modify `components/cast/CastPage.tsx`

- Quitar el botón "Crear con IA" (~77-83) y el estado `aiOpen` (~64) y el bloque JSX `{aiOpen && (<CreationWizard kind="character" ... />)}` (~106-121) con su `onSave`.
- Quitar el bloque `{masterImages.length > 0 && (<MasterImageRefiner ... refine={refineCharacterMaster} />)}` (~610-617).
- Quitar los imports de `CreationWizard` (línea 26) y `MasterImageRefiner` (línea 22); del import de `@/components/creation/generate` quitar `refineCharacterMaster` (conservar los que sí se usan: `generateCharacterState`, `refineCharacterState`, `generateFullBody`, `generateOutfit`, `isGenError`).

Conservar TODO lo demás del `CharacterEditor` (maestra, ángulos manuales, voz, cuerpo completo, Estados, Vestuarios). La creación de personaje con IA y la edición iterativa de la maestra pasan al estudio ("Abrir estudio" ya está en la tarjeta de personaje). El botón "Nuevo personaje" (form manual) se conserva.

- [ ] **Step 1:** Quitar botón/estado/bloques + imports huérfanos.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm build`. Verde.
- [ ] **Step 3: Commit** — `git commit -m "refactor(estudio): retira Crear con IA y el retoque inline del editor de cast"`

---

### Task 6: Reconectar el paso "crear producto con IA" del wizard de campaña

**Files:** Modify `components/campaigns/CampaignStudioWizard.tsx`

- Reemplazar el link "¿No tienes una foto del producto? Créala con IA" (~447-454, que hoy hace `setAiOpen(true)`) por un enlace a la biblioteca de productos: un `<Link href="/app/brand/kits">` (o `<a>`) con texto tipo "¿No tienes el producto? Créalo en tu biblioteca de productos" — mismo estilo (tokens semánticos, `text-xs text-muted-foreground hover:text-foreground`). Importar `Link` de `next/link` si no está.
- Quitar el estado `aiOpen` y el bloque JSX `{aiOpen && (<CreationWizard kind="product" productFlow="create" ... />)}` (~1021-1050) con su `onSave` (la creación de Brand Kit inline). Quitar el import de `CreationWizard` (línea 34).
- Conservar TODO lo demás del wizard (modos upload/kit, multi-select de productos ~505-537, `createBrandKitAction`/`setBrandKitImagesAction` si se usan en otro punto — verificar; si sólo los usaba el `onSave` borrado, quitar también esos imports si quedan huérfanos).

- [ ] **Step 1:** Reemplazar el link + quitar el bloque wizard + imports huérfanos.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm build`. Verde. `CreationWizard` queda sin usar en toda la app (se borra en Task 7).
- [ ] **Step 3: Commit** — `git commit -m "refactor(estudio): el paso de producto del wizard de campana enlaza a la biblioteca en vez del mini-creador"`

---

### Task 7: Borrar el código muerto (wizard, refiner, funciones y actions huérfanas)

**Files:** Borrar/modificar según verificación.

Precondición: tras Tasks 3-6, `CreationWizard`, `MasterImageRefiner` y varias funciones de `generate.ts`/`creation.ts` no tienen ya ningún importador. Esta task lo verifica y borra.

- [ ] **Step 1: Verificar huérfanos** — para cada símbolo, confirmar CERO referencias fuera de su propia definición/tests:
```bash
# Deben devolver solo la definición (y quizás tests que también se borran):
git grep -n "CreationWizard"
git grep -n "MasterImageRefiner"
git grep -n "refineProductImage\|refineLocationMaster\|refineCharacterMaster"
git grep -n "generateProductAngle\|PRODUCT_ANGLE_PROMPT\|ProductAngleView"
git grep -n "generateCharacter\b\|generateAngle\b\|ANGLE_PROMPT\|editImage\b"
git grep -n "generateProductConcept\|buildProductPrompt\|generatePackaging\|ProductShot"
git grep -n "clarifyCreationAction\|analyzeKitFromImageAction"
```
Si algún símbolo aún tiene un uso real (fuera de definición/tests), NO borrarlo: reportarlo (indica que una task previa dejó un uso; el controlador decide).

- [ ] **Step 2: Borrar componentes** — `components/creation/CreationWizard.tsx` y `components/shared/MasterImageRefiner.tsx`.

- [ ] **Step 3: Podar `components/creation/generate.ts`** — borrar SOLO las funciones/constantes/tipos huérfanos confirmados en Step 1: `generateCharacter`, `editImage`, `generateAngle` + `ANGLE_PROMPT`, `generateProductAngle` + `PRODUCT_ANGLE_PROMPT` + `ProductAngleView`, `refineProductImage`, `refineCharacterMaster`, `refineLocationMaster`, `generateProductConcept` + `buildProductPrompt` + `PRODUCT_SHOT_BLOCKS` + `ProductShot`, `generatePackaging`.
  **Conservar** (siguen en uso): `fixAsReference`, `editUploaded`, `retouchUploaded`, `generateCharacterState`, `generateFullBody`, `generateOutfit`, `refineCharacterState`, `generateScaleMap` (+ `buildScaleMapPrompt`), `generateScaleMapFromMaster`, `isGenError`, tipos `GeneratedImage`/`GenError`. Si al podar queda algún import de cabecera sin usar (p. ej. `buildCharacterMasterPrompt` si solo lo usaba `generateCharacter`), quitarlo.

- [ ] **Step 4: Podar tests** — en `components/creation/generate.test.ts`, borrar los tests de `buildProductPrompt` (y de cualquier otra función borrada). Si el archivo queda vacío de tests significativos, borrarlo entero.

- [ ] **Step 5: Podar `server-actions/creation.ts`** — borrar `clarifyCreationAction` y `analyzeKitFromImageAction` (huérfanos: solo los usaba `CreationWizard`). Si sus helpers en `lib/creation/*` (clarify/analyze-kit) quedan sin importador (verificar con `git grep`), borrarlos también. **Conservar** `getReferencePathsAction` (lo usan cast/locación/producto). `compareReferencesAction` es dead code PREEXISTENTE no relacionado con Fase 5 — NO tocarlo aquí (fuera de alcance; reportar como nota).

- [ ] **Step 6: Verificar** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Todo verde. Confirmar que `git grep` de los símbolos borrados no devuelve nada.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "chore(estudio): borra el wizard, el refiner inline y las funciones de generacion huerfanas"`

---

## Self-Review

**1. Spec coverage:** §Presets (integrados por tipo + guardados del usuario como inserts) → Tasks 1-2. §Retiro (CreationWizard, MasterImageRefiner, botones de ángulo; lógica útil → presets) → Tasks 3-5 (usos) + 7 (borrado); los prompts hardcodeados renacen como `BUILTIN_PRESETS`. §Integración wizard de campaña (enlaza a biblioteca) → Task 6. Cubierto.

**2. Placeholder scan:** Tasks 1-2 traen código completo. Tasks 3-7 son retiros/borrados con anclas precisas + verificación por `git grep`; no hay "TBD" — cada símbolo a borrar está enumerado y su conservación/borrado se decide por verificación explícita.

**3. Type consistency:** `StudioPreset` definido en Task 1, consumido en `types.ts`/`page.tsx`/`Composer.tsx` (Task 2) con la misma firma. `parseUserPreset` devuelve `StudioPreset | null`, filtrado con type-guard en el RSC. `BUILTIN_PRESETS[assetType]` indexa por `StudioAssetType` (ya existe).

**4. Orden/seguridad del retiro:** las Tasks 3-6 quitan TODOS los usos antes de que la Task 7 borre las piezas; cada task 3-6 deja build verde con las piezas aún presentes (sin usar). La Task 7 borra solo lo verificado huérfano por `git grep`, conservando explícitamente lo que cast/locación/biblioteca siguen usando (`editUploaded`, bakes de estado/outfit, mapa de escala, `getReferencePathsAction`). Riesgo controlado.
