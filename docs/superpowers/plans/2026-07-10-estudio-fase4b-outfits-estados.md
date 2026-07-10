# Estudio Fase 4b — Outfits y Estados de personaje (sub-roles con etiqueta) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir al adjuntar del estudio (solo personaje) dos sub-roles con etiqueta —**Outfit** y **Estado**— que crean una entrada nueva (etiqueta nueva) o reemplazan la imagen de una existente, cableados a `character_outfits`/`character_states`.

**Architecture:** A diferencia de los roles base del personaje (Maestra/Ángulo/Cuerpo completo = campos del registro `characters`, ya en Fase 4a vía `attachStudioImageAction`), outfits y estados viven en **tablas propias** con etiqueta. El adjuntar es de dos pasos: elegir el sub-rol abre una vista con la lista de existentes (clic = reemplaza su imagen) y un campo de etiqueta nueva (crea). El `AttachDialog` orquesta las server actions **ya existentes** (`create*`/`update*Image`/`list*`), que validan ownership de personaje e imagen server-side. Se extrae un resolver puro (`planLabeledAttach`) para la decisión crear-vs-reemplazar + validación de etiqueta, con test.

**Tech Stack:** Next.js 15 (App Router), React client component, server actions existentes, vitest para la lógica pura. Sin migración, sin adapter, sin backend nuevo.

## Global Constraints

Copiar verbatim; aplican a TODAS las tareas:

- Sin emojis en código ni UI. Dark mode; **tokens semánticos** (`text-muted-foreground`, `border-border`, `bg-background`, `text-primary`…), no `zinc-*` crudos.
- **Sin `any`** en TypeScript: `unknown` + narrowing o tipo explícito.
- **URLs de proveedor nunca al cliente:** adjuntar solo manda `generationId` → `addGenerationAsReferenceAction` devuelve el `ref.id` interno; nunca una URL de proveedor.
- **Ownership por workspace + RLS:** ya lo hacen las actions de outfit/estado (validan que el personaje y la imagen sean del workspace). No re-implementar; reusar.
- **Créditos solo vía funciones SQL atómicas** (no aplica aquí: adjuntar no genera; `addGenerationAsReference` copia una generación ya pagada a `media_references`).
- Componentes shadcn primero. Server Components por default; `'use client'` solo con state/effects (el `AttachDialog` ya es cliente).
- **Sin APIs reales en tests** (vitest puro). Los smokes de browser los corre el usuario.
- **pnpm** (`pnpm typecheck`/`build`/`lint`/`test`).
- Commits en español, imperativos, **SIN `Co-Authored-By`**.
- **SIN migración**: `character_outfits`/`character_states` y sus actions ya existen y están desplegadas.

## File Structure

- **Crear** `lib/studio/labeled-attach.ts` — resolver puro: valida la selección (existente vs etiqueta nueva) y decide crear-vs-reemplazar. Único responsable de la validación de etiqueta del lado cliente (espeja el cap 40 del schema).
- **Crear** `lib/studio/labeled-attach.test.ts` — tests del resolver (todas las ramas).
- **Modificar** `components/studio/AttachDialog.tsx` — vista de dos pasos: la grilla de roles gana los botones Outfit/Estado (solo personaje); un sub-componente `LabeledAttachView` (genérico sobre outfit|state) lista existentes + campo de etiqueta nueva y orquesta el adjuntar.

Nada más cambia: el page RSC del estudio, `StudioClient`, `attachStudioImageAction`, `attach-merge.ts` y las server actions de outfit/estado quedan **intactos**. Las listas de outfits/estados se cargan lazy desde el diálogo (client → server action), sin threading por el page.

## Decisiones de diseño (para el reviewer)

- **Camino separado, no `attachStudioImageAction`.** Ese action es read-modify-write del registro `characters` (roles base). Outfits/estados son tablas propias con create-vs-update por etiqueta → no encajan; el diálogo llama directo `create*`/`update*Image` (mismo patrón que `CastPage`).
- **Genérico outfit|state.** Las tablas/actions son espejos; la UI también, vía un `LABELED_ROLE_CONFIG` por rol. Evita duplicar la vista.
- **Sin gate por maestra.** `CastPage` muestra las secciones de outfit/estado solo si el personaje tiene maestra, pero eso es del editor; las actions `create*` NO exigen maestra y el diálogo no conoce ese campo. No se gatea (documentado); si el producto lo quiere, es follow-up.
- **Etiqueta nueva siempre crea** (no deduplica contra labels existentes): espeja `createCharacterOutfitAction`, que inserta sin deduplicar. "Elegir existente" es la vía de reemplazo.
- **Referencia huérfana en error:** si `create*`/`update*` falla tras `addGenerationAsReference`, la ref queda suelta — **comportamiento preexistente e idéntico al de los roles base** (Minor diferido de Fase 4a). No se resuelve aquí; se mantiene consistente.

---

### Task 1: Resolver puro `planLabeledAttach` + tests

**Files:**
- Create: `lib/studio/labeled-attach.ts`
- Test: `lib/studio/labeled-attach.test.ts`

**Interfaces:**
- Produces (lo consume Task 2):
  - `type LabeledRole = 'outfit' | 'state'`
  - `type LabeledSelection = { type: 'new'; label: string } | { type: 'existing'; id: string }`
  - `type LabeledAttachPlan = { kind: 'create'; label: string } | { kind: 'update'; id: string } | { error: string }`
  - `function planLabeledAttach(selection: LabeledSelection): LabeledAttachPlan`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/studio/labeled-attach.test.ts`:

```ts
// lib/studio/labeled-attach.test.ts
//
// planLabeledAttach decide, a partir de la selección del diálogo (elegir un
// outfit/estado existente vs. teclear una etiqueta nueva), si el adjuntar es un
// "crear" (etiqueta nueva) o un "reemplazar" (id existente), y valida la
// etiqueta antes de tocar la BD. Un bug acá = crear una fila sin etiqueta o
// reemplazar la imagen equivocada. Se cubre cada rama.
import { describe, it, expect } from 'vitest';
import { planLabeledAttach } from '@/lib/studio/labeled-attach';

describe('planLabeledAttach — existente (reemplazar)', () => {
  it('con id → update', () => {
    const plan = planLabeledAttach({ type: 'existing', id: 'outfit-1' });
    expect(plan).toEqual({ kind: 'update', id: 'outfit-1' });
  });

  it('sin id (cadena vacía) → error, no update', () => {
    const plan = planLabeledAttach({ type: 'existing', id: '' });
    expect('error' in plan).toBe(true);
    if (!('error' in plan)) throw new Error('esperaba error');
    expect(plan.error.length).toBeGreaterThan(0);
  });
});

describe('planLabeledAttach — nueva (crear)', () => {
  it('etiqueta válida → create con la etiqueta trimmeada', () => {
    const plan = planLabeledAttach({ type: 'new', label: '  Look casual  ' });
    expect(plan).toEqual({ kind: 'create', label: 'Look casual' });
  });

  it('etiqueta vacía o solo espacios → error, no create', () => {
    const plan = planLabeledAttach({ type: 'new', label: '   ' });
    expect('error' in plan).toBe(true);
    if (!('error' in plan)) throw new Error('esperaba error');
    expect(plan.error.length).toBeGreaterThan(0);
  });

  it('etiqueta de más de 40 caracteres → error (espeja el cap del schema)', () => {
    const plan = planLabeledAttach({ type: 'new', label: 'x'.repeat(41) });
    expect('error' in plan).toBe(true);
    if (!('error' in plan)) throw new Error('esperaba error');
    expect(plan.error.length).toBeGreaterThan(0);
  });

  it('etiqueta de exactamente 40 caracteres → create (límite inclusivo)', () => {
    const label = 'x'.repeat(40);
    const plan = planLabeledAttach({ type: 'new', label });
    expect(plan).toEqual({ kind: 'create', label });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm test labeled-attach`
Expected: FAIL — `planLabeledAttach` no existe (módulo no encontrado).

- [ ] **Step 3: Implementación mínima**

Crear `lib/studio/labeled-attach.ts`:

```ts
// Sub-roles de personaje con etiqueta (outfit/estado). A diferencia de los roles
// base (campos del registro `characters`), viven en tablas propias
// (character_outfits/character_states) y el adjuntar es "crear con etiqueta
// nueva" o "reemplazar la imagen de uno existente". Este módulo es la resolución
// PURA (validación de etiqueta + decisión create-vs-update) para mantener el
// componente delgado y cubrir las ramas con test (regla 80-tests). No lee ni
// escribe nada: el diálogo llama las server actions con el plan resuelto.

export type LabeledRole = 'outfit' | 'state';

export type LabeledSelection =
  | { type: 'new'; label: string }
  | { type: 'existing'; id: string };

export type LabeledAttachPlan =
  | { kind: 'create'; label: string }
  | { kind: 'update'; id: string }
  | { error: string };

// Cap de etiqueta = el de CreateCharacterOutfit/StateSchema (`.max(40)`).
const LABEL_MAX = 40;

export function planLabeledAttach(selection: LabeledSelection): LabeledAttachPlan {
  if (selection.type === 'existing') {
    return selection.id
      ? { kind: 'update', id: selection.id }
      : { error: 'Elige un elemento de la lista.' };
  }
  const label = selection.label.trim();
  if (!label) return { error: 'Escribe una etiqueta.' };
  if (label.length > LABEL_MAX) return { error: `La etiqueta es muy larga (máx. ${LABEL_MAX}).` };
  return { kind: 'create', label };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm test labeled-attach`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add lib/studio/labeled-attach.ts lib/studio/labeled-attach.test.ts
git commit -m "feat(estudio): resolver puro de sub-roles con etiqueta (outfit/estado)"
```

---

### Task 2: Sub-flujo Outfit/Estado en `AttachDialog`

**Files:**
- Modify: `components/studio/AttachDialog.tsx`

**Interfaces:**
- Consumes de Task 1: `planLabeledAttach`, `LabeledRole`, `LabeledSelection` desde `@/lib/studio/labeled-attach`.
- Consumes (ya existen): `createCharacterOutfitAction`, `listCharacterOutfitsAction`, `updateCharacterOutfitImageAction` (`@/server-actions/character-outfits`); `createCharacterStateAction`, `listCharacterStatesAction`, `updateCharacterStateImageAction` (`@/server-actions/character-states`); `addGenerationAsReferenceAction` (`@/server-actions/media-references`, ya importado).

**Comportamiento:** el `AttachDialog` no cambia para producto/locación ni para los roles base de personaje. Para personaje, la grilla gana dos botones (Outfit, Estado) que, en vez de adjuntar directo, abren una vista de segundo paso (lista de existentes + etiqueta nueva). El adjuntar por sub-rol: `addGenerationAsReferenceAction` → `planLabeledAttach(selección)` → `create` o `update` de la config del rol → `onAttached` (deja la ref disponible como referencia del compositor) → cerrar. La vista se re-monta por rol (`key`), así cambiar de Outfit a Estado no arrastra estado viejo.

- [ ] **Step 1: Reemplazar el contenido completo de `components/studio/AttachDialog.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Box,
  Droplets,
  Image as ImageIcon,
  Loader2,
  Map,
  Package,
  PersonStanding,
  Shirt,
  User,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { attachStudioImageAction } from '@/server-actions/studio';
import {
  createCharacterOutfitAction,
  listCharacterOutfitsAction,
  updateCharacterOutfitImageAction,
} from '@/server-actions/character-outfits';
import {
  createCharacterStateAction,
  listCharacterStatesAction,
  updateCharacterStateImageAction,
} from '@/server-actions/character-states';
import {
  planLabeledAttach,
  type LabeledRole,
  type LabeledSelection,
} from '@/lib/studio/labeled-attach';
import type { StudioRole } from '@/lib/studio/attach-merge';
import type { StudioRefOption, StudioAssetType } from './types';

type RoleDef = { key: StudioRole; label: string; icon: React.ComponentType<{ className?: string }> };

const ROLES_BY_TYPE: Record<StudioAssetType, RoleDef[]> = {
  product: [
    { key: 'product', label: 'Imagen de producto', icon: Box },
    { key: 'packaging', label: 'Empaque', icon: Package },
  ],
  location: [
    { key: 'master', label: 'Maestra', icon: ImageIcon },
    { key: 'reference', label: 'Referencia', icon: ImageIcon },
    { key: 'scale_map', label: 'Mapa de escala', icon: Map },
  ],
  character: [
    { key: 'master', label: 'Maestra', icon: User },
    { key: 'angle', label: 'Ángulo', icon: ImageIcon },
    { key: 'full_body', label: 'Cuerpo completo', icon: PersonStanding },
  ],
};

// Sub-roles con etiqueta (solo personaje): NO son campos del registro characters
// sino filas de character_outfits/character_states, así que van por su propio
// camino (elegir existente → reemplaza imagen; etiqueta nueva → crea). Genérico
// sobre el rol para no duplicar la vista (las tablas/actions son espejos).
type LabeledItem = { id: string; label: string };

type LabeledActionResult = { ok: true } | { ok: false; message?: string };

type LabeledRoleConfig = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  placeholder: string;
  loadItems: (characterId: string) => Promise<LabeledItem[]>;
  create: (characterId: string, label: string, imageId: string) => Promise<LabeledActionResult>;
  update: (id: string, imageId: string) => Promise<LabeledActionResult>;
};

const LABELED_ROLE_CONFIG: Record<LabeledRole, LabeledRoleConfig> = {
  outfit: {
    label: 'Outfit',
    icon: Shirt,
    placeholder: 'Etiqueta (ej. Look casual)',
    loadItems: async (characterId) => {
      const res = await listCharacterOutfitsAction(characterId);
      return res.ok ? res.data.map((o) => ({ id: o.id, label: o.label })) : [];
    },
    create: (characterId, label, imageId) =>
      createCharacterOutfitAction({ characterId, label, outfitImageId: imageId }),
    update: (id, imageId) => updateCharacterOutfitImageAction({ outfitId: id, outfitImageId: imageId }),
  },
  state: {
    label: 'Estado',
    icon: Droplets,
    placeholder: 'Etiqueta (ej. Mojado)',
    loadItems: async (characterId) => {
      const res = await listCharacterStatesAction(characterId);
      return res.ok ? res.data.map((s) => ({ id: s.id, label: s.label })) : [];
    },
    create: (characterId, label, imageId) =>
      createCharacterStateAction({ characterId, label, stateImageId: imageId }),
    update: (id, imageId) => updateCharacterStateImageAction({ stateId: id, stateImageId: imageId }),
  },
};

const LABELED_ROLE_DEFS: LabeledRole[] = ['outfit', 'state'];

type View = { kind: 'roles' } | { kind: 'labeled'; role: LabeledRole };

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  assetId: string;
  assetType: StudioAssetType;
  onAttached: (newRef: StudioRefOption) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'roles' });
  const roles = ROLES_BY_TYPE[props.assetType];
  const labeledRoles = props.assetType === 'character' ? LABELED_ROLE_DEFS : [];
  const totalButtons = roles.length + labeledRoles.length;

  async function attach(roleKey: StudioRole, roleLabel: string) {
    if (!props.generationId || saving) return;
    setSaving(roleKey);
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(null);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    // Read-modify-write server-side: attachStudioImageAction relee el activo
    // fresco de la BD antes de fusionar (roles base = campos del registro).
    const res = await attachStudioImageAction({
      assetType: props.assetType,
      assetId: props.assetId,
      role: roleKey,
      referenceId: ref.data.id,
    });
    setSaving(null);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    props.onAttached({
      id: ref.data.id,
      previewUrl: ref.data.previewUrl,
      filename: ref.data.filename,
    });
    props.onOpenChange(false);
    toast.success(`Añadida a ${roleLabel}`);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {view.kind === 'roles' || !props.generationId ? (
          <>
            <DialogHeader>
              <DialogTitle>Adjuntar al activo</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">Elige el rol de esta imagen.</p>
            {/* Columnas según el nº total de botones: producto 2, locación 3,
                personaje 5 (3 base + outfit/estado). */}
            <div className={`grid ${totalButtons === 2 ? 'grid-cols-2' : 'grid-cols-3'} gap-3 pt-2`}>
              {roles.map((r) => {
                const Icon = r.icon;
                return (
                  <Button
                    key={r.key}
                    type="button"
                    variant="outline"
                    className="h-24 flex-col gap-2 whitespace-normal text-center text-xs"
                    disabled={saving !== null}
                    onClick={() => attach(r.key, r.label)}
                  >
                    <Icon className="h-6 w-6" />
                    {r.label}
                  </Button>
                );
              })}
              {labeledRoles.map((role) => {
                const cfg = LABELED_ROLE_CONFIG[role];
                const Icon = cfg.icon;
                return (
                  <Button
                    key={role}
                    type="button"
                    variant="outline"
                    className="h-24 flex-col gap-2 whitespace-normal text-center text-xs"
                    disabled={saving !== null}
                    onClick={() => setView({ kind: 'labeled', role })}
                  >
                    <Icon className="h-6 w-6" />
                    {cfg.label}
                  </Button>
                );
              })}
            </div>
          </>
        ) : (
          <LabeledAttachView
            key={view.role}
            role={view.role}
            generationId={props.generationId}
            characterId={props.assetId}
            onAttached={props.onAttached}
            onDone={() => props.onOpenChange(false)}
            onBack={() => setView({ kind: 'roles' })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LabeledAttachView(props: {
  role: LabeledRole;
  generationId: string;
  characterId: string;
  onAttached: (newRef: StudioRefOption) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const config = LABELED_ROLE_CONFIG[props.role];
  const [items, setItems] = useState<LabeledItem[] | null>(null); // null = cargando
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    config.loadItems(props.characterId).then((list) => {
      if (active) setItems(list);
    });
    return () => {
      active = false;
    };
  }, [props.characterId, config]);

  async function run(selection: LabeledSelection) {
    if (saving) return;
    const plan = planLabeledAttach(selection);
    if ('error' in plan) {
      toast.error(plan.error);
      return;
    }
    setSaving(true);
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(false);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    const res =
      plan.kind === 'create'
        ? await config.create(props.characterId, plan.label, ref.data.id)
        : await config.update(plan.id, ref.data.id);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.message ?? 'No se pudo guardar');
      return;
    }
    props.onAttached({ id: ref.data.id, previewUrl: ref.data.previewUrl, filename: ref.data.filename });
    props.onDone();
    toast.success(`${config.label} guardado`);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onBack}
            disabled={saving}
            aria-label="Volver a los roles"
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          Adjuntar como {config.label}
        </DialogTitle>
      </DialogHeader>

      {items === null ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          {items.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                Reemplazar la imagen de uno existente
              </p>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => run({ type: 'existing', id: it.id })}
                      disabled={saving}
                      className="w-full truncate rounded-md border border-border bg-background px-3 py-2 text-left text-sm text-foreground hover:border-primary/40 disabled:opacity-50"
                    >
                      {it.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Crear con una etiqueta nueva</p>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={config.placeholder}
              maxLength={40}
              disabled={saving}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
            />
            <Button
              type="button"
              className="w-full"
              disabled={saving || !label.trim()}
              onClick={() => run({ type: 'new', label })}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Guardando…' : 'Crear y adjuntar'}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Verificar typecheck/build/lint/tests**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: typecheck limpio; lint 0 errores (warnings preexistentes OK); tests verdes (incluye los 6 de Task 1); build compila.

Traza mental esperada:
- Producto/locación: grilla intacta (2 y 3 botones); ningún camino de outfit/estado.
- Personaje: 5 botones. Maestra/Ángulo/Cuerpo → adjuntan como antes (roles base). Outfit/Estado → abren la vista; lista existentes (o vacía) + etiqueta nueva.
- Etiqueta nueva vacía → botón deshabilitado; etiqueta >40 imposible (maxLength) pero el resolver igual la cortaría.
- Cambiar Outfit↔Estado re-monta la vista (key por rol): no arrastra `items`/`label`.
- `onAttached` deja la nueva ref disponible en el compositor; el diálogo cierra.

- [ ] **Step 3: Commit**

```bash
git add components/studio/AttachDialog.tsx
git commit -m "feat(estudio): adjuntar outfit y estado de personaje por etiqueta (crear o reemplazar)"
```

---

## Self-Review

**1. Spec coverage:** El spec (§Adjuntar, línea 123-125) pide para personaje los roles Maestra · Ángulo · Cuerpo completo · **Outfit (elegir/crear etiqueta)** · **Estado (elegir/crear etiqueta)**, cableados a `character_outfits`/`character_states`, exigiendo elegir o crear etiqueta antes de adjuntar. Task 2 implementa exactamente eso; los roles base ya venían de Fase 4a. Cubierto.

**2. Placeholder scan:** Sin TBD/TODO; todo el código está completo (resolver + componente entero + tests).

**3. Type consistency:** `LabeledRole`/`LabeledSelection`/`LabeledAttachPlan` definidos en Task 1 y consumidos con las mismas firmas en Task 2. `LabeledActionResult` (`{ok:true}|{ok:false;message?}`) es estructuralmente asignable desde el `Result<T>` de las server actions (props extra `data`/`error` permitidas). Sin `any`. `StudioRole` (Fase 4a) se mantiene para los roles base; los sub-roles NO son `StudioRole` (van por otro camino), evitando contaminar `ATTACH_ROLES`.

**4. Riesgos:** (a) `useEffect` con `config` en deps — `config` es constante de módulo estable, no re-dispara; el `key={view.role}` re-monta al cambiar de rol. (b) Sin `any` en el puente config→action (asignabilidad estructural verificada). (c) Referencia huérfana en error = preexistente e idéntico a roles base (documentado, no en alcance).

