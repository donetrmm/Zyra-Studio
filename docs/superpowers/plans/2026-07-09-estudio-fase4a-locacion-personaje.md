# Estudio creativo — Fase 4a: generalizar el estudio a locación y personaje (roles base) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el estudio de chat (hoy solo producto) funcione end-to-end para **locación** y **personaje** con sus roles base: generar/iterar imágenes y adjuntarlas al activo por rol (Locación: Maestra · Referencia · Mapa de escala; Personaje: Maestra · Ángulo · Cuerpo completo).

**Architecture:** El estudio ya es asíncrono y agnóstico de tipo en su núcleo (chat, compositor, galería, worker, sesiones — todo por `assetType`). Esta fase generaliza las tres piezas que aún son específicas de producto: (1) la cláusula de guard "mantener idéntico" (falta locación/personaje), (2) la carga de datos de la página RSC (hoy solo tabla `products`), y (3) el diálogo de adjuntar por rol (hoy producto/empaque). Adjuntar a locación/personaje es un **upsert de la entidad completa** (`updateLocationAction`/`updateCharacterAction` reemplazan todo el registro), no un update de solo-imágenes como producto — por eso la página carga el registro completo y el diálogo lo fusiona.

**Tech Stack:** Next.js 15 (RSC + `'use client'`), Supabase, shadcn, sonner, zod, vitest.

**Fuera de alcance (Fase 4b):** outfits y estados de personaje (tablas `character_outfits`/`character_states` + UI de etiquetas elegir/crear). Fase 5: presets + retiro de `CreationWizard`/`MasterImageRefiner` + enlace del wizard de campaña.

## Global Constraints

Cada task los incluye implícitamente. Valores exactos:

- **`pnpm`** (nunca npm). `pnpm typecheck`, `pnpm build`, `pnpm lint`, `pnpm test`.
- **Sin `any`** — `unknown` + narrowing o tipo explícito.
- **Sin emojis** en código/UI.
- **Dark mode**, **tokens semánticos del tema** (NO `zinc-*` crudo): `bg-card`, `bg-muted`, `border-border`, `text-foreground`, `text-muted-foreground`, `text-brand`/`border-brand` (acento `#009fff` = token `--brand`). (Los componentes del estudio ya están alineados a estos tokens — mantenerlo.)
- **Server Components por default**; `'use client'` solo con state/effects. Las mutaciones van por server actions ya existentes.
- **Créditos solo vía funciones SQL atómicas** (ya ocurre dentro de `submitStudioTurnAction`/worker — no se replica).
- **URLs de proveedor nunca al cliente**: display por thumbnails públicos; adjuntar por `generationId` server-side; previews de referencias firmadas server-side (RSC).
- **Admin/service-role solo server-side.** RLS por `workspace_id` + ownership explícito (las acciones de upsert ya validan ownership de imágenes).
- **SIN migración** — todas las tablas/columnas existen (locations 041/047, characters 021/059, media_references). No se crea ni modifica ninguna migración.
- **Commits en español, imperativos, SIN `Co-Authored-By`.**

**Modelo de datos (verificado, para referencia de todas las tasks):**
- `locations`: `master_image_id uuid`, `reference_image_ids uuid[]`, `scale_map_image_id uuid`, `scale_map_notes text`, `name`, `description`. Escritura: `updateLocationAction(id, input)` con `UpsertLocationSchema` (`name` requerido; `masterImageId`/`scaleMapImageId`/`scaleMapNotes`/`description` opcionales; `referenceImageIds` array).
- `characters`: `master_image_id uuid` (requerido en el schema), `angle_image_ids uuid[]` (máx 2), `full_body_image_id uuid`, `name`, `description`, `voice_clone_id`. Escritura: `updateCharacterAction(id, input)` con `UpsertCharacterSchema` (`name`, `masterImageId` requeridos; `angleImageIds` máx 2; `voiceCloneId`/`fullBodyImageId` nullish). Nota: el action recalcula `reference_image_ids = [master, ...angles]` internamente — el diálogo NO lo manda.
- `products`: `product_image_ids uuid[]`, `packaging_image_ids uuid[]`. Escritura: `setProductImagesAction(id, { productImageIds, packagingImageIds })` (solo imágenes, no toca el resto).

---

### Task 1: Cláusulas de guard para locación y personaje

`assembleStudioPrompt` (Fase 1/2) ya anexa `PRODUCT_IDENTITY_CLAUSE` cuando `keepIdentical` y `assetType==='product'`. Falta la cláusula de identidad para locación y personaje (basadas en las que ya usa `components/creation/generate.ts`).

**Files:**
- Modify: `lib/studio/prompt-assembly.ts`
- Modify: `lib/studio/prompt-assembly.test.ts`

**Interfaces:**
- Consumes: `assembleStudioPrompt(rawPrompt, { keepIdentical?, assetType? })` (existente).
- Produces: `LOCATION_IDENTITY_CLAUSE`, `CHARACTER_IDENTITY_CLAUSE`; `IDENTITY_CLAUSE_BY_TYPE` mapea `product|location|character`.

- [ ] **Step 1: Test (falla primero)**

Añadir a `lib/studio/prompt-assembly.test.ts`:

```ts
import {
  assembleStudioPrompt,
  PRODUCT_IDENTITY_CLAUSE,
  LOCATION_IDENTITY_CLAUSE,
  CHARACTER_IDENTITY_CLAUSE,
} from './prompt-assembly';

describe('assembleStudioPrompt: locación y personaje', () => {
  it('guard on en locación anexa la cláusula de arquitectura', () => {
    const out = assembleStudioPrompt('de noche', { keepIdentical: true, assetType: 'location' });
    expect(out.startsWith('de noche')).toBe(true);
    expect(out.endsWith(LOCATION_IDENTITY_CLAUSE)).toBe(true);
  });
  it('guard on en personaje anexa la cláusula de identidad de persona', () => {
    const out = assembleStudioPrompt('cámbiale el peinado', { keepIdentical: true, assetType: 'character' });
    expect(out.endsWith(CHARACTER_IDENTITY_CLAUSE)).toBe(true);
  });
  it('guard off = prompt crudo para cualquier tipo', () => {
    expect(assembleStudioPrompt('x', { keepIdentical: false, assetType: 'location' })).toBe('x');
    expect(assembleStudioPrompt('x', { keepIdentical: false, assetType: 'character' })).toBe('x');
  });
  it('las 3 cláusulas son distintas entre sí', () => {
    expect(new Set([PRODUCT_IDENTITY_CLAUSE, LOCATION_IDENTITY_CLAUSE, CHARACTER_IDENTITY_CLAUSE]).size).toBe(3);
  });
});
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `pnpm test lib/studio/prompt-assembly.test.ts`
Expected: FAIL (`LOCATION_IDENTITY_CLAUSE`/`CHARACTER_IDENTITY_CLAUSE` no existen).

- [ ] **Step 3: Implementar las cláusulas**

En `lib/studio/prompt-assembly.ts`, tras `PRODUCT_IDENTITY_CLAUSE`, añadir (texto basado en `refineLocationMaster`/`refineCharacterMaster` de `components/creation/generate.ts`):

```ts
// Cláusula de identidad de LOCACIÓN (misma intención que refineLocationMaster):
// preserva arquitectura, disposición y encuadre; el cambio solo toca luz/hora/
// elementos. Sin personas salvo que la instrucción lo pida.
export const LOCATION_IDENTITY_CLAUSE =
  'Keep the exact same place — same architecture, layout, surfaces and camera framing. ' +
  'Do not add or remove structural elements, and keep it empty of people unless the change explicitly says otherwise.';

// Cláusula de identidad de PERSONAJE (misma intención que refineCharacterMaster):
// preserva cara, complexión, piel y build; la instrucción manda sobre lo demás.
export const CHARACTER_IDENTITY_CLAUSE =
  'Keep the exact same person identity — same face, complexion, build, skin and hairstyle. ' +
  'Only change what the instruction asks; the result must still read as the same person.';
```

Y ampliar el mapa:

```ts
const IDENTITY_CLAUSE_BY_TYPE: Record<string, string> = {
  product: PRODUCT_IDENTITY_CLAUSE,
  location: LOCATION_IDENTITY_CLAUSE,
  character: CHARACTER_IDENTITY_CLAUSE,
};
```

- [ ] **Step 4: Correr hasta verde**

Run: `pnpm test lib/studio/prompt-assembly.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/studio/prompt-assembly.ts lib/studio/prompt-assembly.test.ts
git commit -m "feat(estudio): guard mantener idéntico para locación y personaje"
```

---

### Task 2: Generalizar la carga de datos (tipos + página RSC + threading del cliente)

Hoy `page.tsx` hace `notFound()` para no-producto y carga solo la tabla `products`. Esta task carga locación/personaje, arma las props por tipo, y hace que `StudioClient`/`SessionHeader` usen `assetType` (submit/create/back). El diálogo de adjuntar se widena de tipo pero su lógica para locación/personaje llega en Task 3 — en esta task el botón "Adjuntar" de la galería solo se muestra para producto.

**Files:**
- Modify: `components/studio/types.ts`
- Modify: `app/app/studio/[assetType]/[assetId]/page.tsx`
- Modify: `components/studio/StudioClient.tsx`
- Modify: `components/studio/SessionHeader.tsx`
- Modify: `components/studio/AttachDialog.tsx` (solo el tipo del prop; comportamiento product intacto)

**Interfaces:**
- Consumes: `updateLocationAction`/`updateCharacterAction` (no en esta task, en la 3); `signedReferenceUrl`; server actions de estudio (ya aceptan location/character).
- Produces:
  - `StudioAssetImages` (unión discriminada por `assetType`) en `components/studio/types.ts`; `StudioClientProps.assetType: 'product'|'location'|'character'` y `StudioClientProps.assetImages: StudioAssetImages` (reemplaza `productImages`).
  - `page.tsx` que resuelve product/location/character.
  - `StudioClient` que pasa `props.assetType` a `createStudioSessionAction`/`submitStudioTurnAction` y monta `AttachDialog` con la unión.

- [ ] **Step 1: Unión discriminada de imágenes por activo**

En `components/studio/types.ts`, reemplazar `StudioProductImages` por la unión (y actualizar `StudioClientProps`):

```ts
// Imágenes del activo por rol. Para producto es solo arrays de imágenes; para
// locación/personaje se carga la ENTIDAD COMPLETA porque updateLocation/Character
// hacen upsert de todo el registro (adjuntar = fusionar la nueva imagen en el rol
// y reescribir el resto sin pisarlo).
export type StudioAssetImages =
  | { assetType: 'product'; productImageIds: string[]; packagingImageIds: string[] }
  | {
      assetType: 'location';
      name: string;
      description: string | null;
      masterImageId: string | null;
      referenceImageIds: string[];
      scaleMapImageId: string | null;
      scaleMapNotes: string | null;
    }
  | {
      assetType: 'character';
      name: string;
      description: string | null;
      masterImageId: string | null;
      angleImageIds: string[];
      fullBodyImageId: string | null;
      voiceCloneId: string | null;
    };

export type StudioAssetType = 'product' | 'location' | 'character';
```

En `StudioClientProps` de ese mismo archivo: cambiar `assetType: 'product'` → `assetType: StudioAssetType`, y reemplazar `productImages: StudioProductImages` → `assetImages: StudioAssetImages`. (Eliminar el type `StudioProductImages` si ya no se referencia; si algún import lo usa, actualizarlo.)

- [ ] **Step 2: Página RSC carga los tres tipos**

Reescribir `app/app/studio/[assetType]/[assetId]/page.tsx` para resolver el activo por tipo. Reemplazar el bloque `if (assetType !== 'product') notFound();` + la carga de `products` por una resolución por tipo que produce `assetName`, `assetImages` y la lista de `imageIds` para `availableReferences`. Estructura completa (mantiene sesión/redirect/balance/pricing como están):

```tsx
import { notFound, redirect } from 'next/navigation';
import { requireWorkspace } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { loadPricing } from '@/lib/credits/pricing';
import { signedReferenceUrl } from '@/lib/supabase/storage';
import {
  listStudioSessionsAction,
  listStudioSessionGenerationsAction,
} from '@/server-actions/studio';
import { StudioClient } from '@/components/studio/StudioClient';
import type {
  StudioTurn,
  StudioRefOption,
  StudioSessionOption,
  StudioAssetImages,
  StudioAssetType,
} from '@/components/studio/types';

export const dynamic = 'force-dynamic';

const ASSET_TYPES: StudioAssetType[] = ['product', 'location', 'character'];

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetType: string; assetId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const { assetType, assetId } = await params;
  const { session: sessionParam } = await searchParams;

  if (!ASSET_TYPES.includes(assetType as StudioAssetType)) notFound();
  const type = assetType as StudioAssetType;

  const { user, workspace } = await requireWorkspace();
  const supabase = await createClient();

  // Resuelve el activo + arma assetImages (entidad completa para loc/char) +
  // la lista de ids de imágenes que ya tiene (para ofrecerlas como referencia).
  let assetName = '';
  let assetImages: StudioAssetImages;
  let imageIds: string[] = [];

  if (type === 'product') {
    const { data: product } = await supabase
      .from('products')
      .select('id, name, product_image_ids, packaging_image_ids')
      .eq('id', assetId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!product) notFound();
    assetName = (product.name as string | null) ?? 'Producto';
    const productImageIds = (product.product_image_ids as string[] | null) ?? [];
    const packagingImageIds = (product.packaging_image_ids as string[] | null) ?? [];
    assetImages = { assetType: 'product', productImageIds, packagingImageIds };
    imageIds = [...productImageIds, ...packagingImageIds];
  } else if (type === 'location') {
    const { data: loc } = await supabase
      .from('locations')
      .select('id, name, description, master_image_id, reference_image_ids, scale_map_image_id, scale_map_notes')
      .eq('id', assetId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!loc) notFound();
    assetName = (loc.name as string | null) ?? 'Locación';
    const masterImageId = (loc.master_image_id as string | null) ?? null;
    const referenceImageIds = (loc.reference_image_ids as string[] | null) ?? [];
    const scaleMapImageId = (loc.scale_map_image_id as string | null) ?? null;
    assetImages = {
      assetType: 'location',
      name: assetName,
      description: (loc.description as string | null) ?? null,
      masterImageId,
      referenceImageIds,
      scaleMapImageId,
      scaleMapNotes: (loc.scale_map_notes as string | null) ?? null,
    };
    imageIds = [masterImageId, ...referenceImageIds, scaleMapImageId].filter((x): x is string => !!x);
  } else {
    const { data: ch } = await supabase
      .from('characters')
      .select('id, name, description, master_image_id, angle_image_ids, full_body_image_id, voice_clone_id')
      .eq('id', assetId)
      .eq('workspace_id', workspace.id)
      .maybeSingle();
    if (!ch) notFound();
    assetName = (ch.name as string | null) ?? 'Personaje';
    const masterImageId = (ch.master_image_id as string | null) ?? null;
    const angleImageIds = (ch.angle_image_ids as string[] | null) ?? [];
    const fullBodyImageId = (ch.full_body_image_id as string | null) ?? null;
    assetImages = {
      assetType: 'character',
      name: assetName,
      description: (ch.description as string | null) ?? null,
      masterImageId,
      angleImageIds,
      fullBodyImageId,
      voiceCloneId: (ch.voice_clone_id as string | null) ?? null,
    };
    imageIds = [masterImageId, ...angleImageIds, fullBodyImageId].filter((x): x is string => !!x);
  }

  const sessionsRes = await listStudioSessionsAction(type, assetId);
  const sessions: StudioSessionOption[] = sessionsRes.ok
    ? sessionsRes.data.map((s) => ({ id: s.id, createdAt: s.created_at }))
    : [];

  let activeSessionId: string | null = null;
  if (sessionParam && sessions.some((s) => s.id === sessionParam)) {
    activeSessionId = sessionParam;
  } else if (sessions.length > 0) {
    redirect(`/app/studio/${type}/${assetId}?session=${sessions[0].id}`);
  }

  let initialItems: StudioTurn[] = [];
  if (activeSessionId) {
    const gensRes = await listStudioSessionGenerationsAction(activeSessionId);
    if (gensRes.ok) {
      initialItems = gensRes.data.map((g) => ({
        id: g.id,
        prompt: g.prompt,
        status: g.status,
        provider: g.provider,
        modelId: g.model_id,
        thumbPath: g.thumbnail_url,
        createdAt: g.created_at,
        errorMessage: null,
      }));
    }
  }

  let availableReferences: StudioRefOption[] = [];
  if (imageIds.length > 0) {
    const { data: refs } = await supabase
      .from('media_references')
      .select('id, storage_url, name')
      .in('id', imageIds)
      .eq('workspace_id', workspace.id)
      .eq('type', 'image');
    availableReferences = await Promise.all(
      (refs ?? []).map(async (r) => ({
        id: r.id as string,
        previewUrl: r.storage_url ? await signedReferenceUrl(r.storage_url as string) : null,
        filename: (r.name as string | null) ?? 'imagen',
      })),
    );
  }

  const balanceRow = await supabase
    .from('credit_balances')
    .select('balance')
    .eq('user_id', user.id)
    .maybeSingle();
  const initialBalance = (balanceRow.data?.balance as number | null) ?? 0;

  const pricing = await loadPricing();

  return (
    <StudioClient
      key={activeSessionId ?? 'new'}
      workspaceId={workspace.id}
      userId={user.id}
      assetType={type}
      assetId={assetId}
      assetName={assetName}
      initialBalance={initialBalance}
      pricing={pricing}
      sessions={sessions}
      activeSessionId={activeSessionId}
      initialItems={initialItems}
      availableReferences={availableReferences}
      assetImages={assetImages}
    />
  );
}
```

- [ ] **Step 3: `StudioClient` usa `props.assetType` y la nueva prop `assetImages`**

En `components/studio/StudioClient.tsx`:

1. Cambiar el import de tipos: `StudioProductImages` → `StudioAssetImages`.
2. El estado: `const [assetImages, setAssetImages] = useState<StudioAssetImages>(props.assetImages);` (reemplaza `productImages`).
3. En `handleSubmit`, ambas llamadas usan `props.assetType` en vez del literal `'product'`:
   - `createStudioSessionAction({ assetType: props.assetType, assetId: props.assetId, provider: input.provider, modelId: input.model })`
   - `submitStudioTurnAction({ ..., assetType: props.assetType, ... })`
   - y el `router.replace` usa la ruta por tipo: `router.replace(\`/app/studio/${props.assetType}/${props.assetId}?session=${sessionId}\`)`.
4. `SessionHeader` recibe `assetType={props.assetType}` (y ya no pasa `assetId` como ruta hardcodeada de producto — ver Step 4).
5. El `AttachDialog` se monta con la unión: `assetImages={assetImages}` `assetType={props.assetType}` `onAttached={(next, newRef) => { setAssetImages(next); setAvailableReferences((cur) => cur.some((r) => r.id === newRef.id) ? cur : [...cur, newRef]); }}`. (El tipo de `onAttached` se generaliza en Task 3; aquí `next` es `StudioAssetImages`.)
6. En `renderActions` de `<GalleryPanel>`, **gatear el botón "Adjuntar" a producto en esta task** (Task 3 lo abre a loc/char): envolver el `<Button ...>Adjuntar</Button>` en `{props.assetType === 'product' && ( ... )}`. El botón "Usar como base" queda para todos.

- [ ] **Step 4: `SessionHeader` back link por tipo**

En `components/studio/SessionHeader.tsx`:
1. Prop nuevo: `assetType: 'product' | 'location' | 'character'` (reemplaza el uso de `assetId` para la ruta de "Nueva sesión" si aplica — la creación de sesión sigue usando `assetId`, pero el back link y la navegación usan el tipo).
2. `newSession()` y `goToSession()` usan la ruta por tipo: `/app/studio/${props.assetType}/${props.assetId}?session=${id}`. Añadir `assetType` a los props que ya recibe (`assetId` sigue).
3. El link "Volver" apunta según tipo:

```tsx
const BACK_HREF: Record<'product' | 'location' | 'character', string> = {
  product: '/app/brand/kits',
  location: '/app/brand/locations',
  character: '/app/brand/cast',
};
```

y `<Link href={BACK_HREF[props.assetType]} ...>`. `createStudioSessionAction` en `newSession()` usa `assetType: props.assetType`.

- [ ] **Step 5: `AttachDialog` — solo widenar el tipo del prop (comportamiento producto intacto)**

En `components/studio/AttachDialog.tsx`, cambiar la firma del prop para aceptar la unión sin romper la lógica de producto. En esta task el diálogo SIGUE manejando solo producto; Task 3 añade los roles de locación/personaje. Cambio mínimo:
1. Importar `StudioAssetImages`, `StudioRefOption` de `./types`.
2. Prop: `productImages: StudioProductImages` → `assetImages: StudioAssetImages`; añadir `assetType: 'product' | 'location' | 'character'`.
3. Al inicio del componente, mientras Task 3 no esté: si `props.assetImages.assetType !== 'product'` el diálogo no se abrirá desde la galería (el botón está gateado en Step 3), pero por robustez de tipos, dentro de `attach()` usar un narrowing `if (props.assetImages.assetType !== 'product') return;` antes de construir `next`, y construir `next` desde `props.assetImages` narrowing a product. `onAttached` firma: `(next: StudioAssetImages, newRef: StudioRefOption) => void`.

(El objetivo de este step es que compile con la unión; la generalización real de roles es Task 3. No dupliques la lógica de loc/char aquí.)

- [ ] **Step 6: Verificar typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: sin errores. Rutas `/app/studio/location/[id]` y `/app/studio/character/[id]` renderizan el shell + chat; el botón "Adjuntar" solo aparece en producto.

- [ ] **Step 7: Commit**

```bash
git add components/studio/types.ts app/app/studio components/studio/StudioClient.tsx components/studio/SessionHeader.tsx components/studio/AttachDialog.tsx
git commit -m "feat(estudio): la página y el cliente cargan locación y personaje por assetType"
```

---

### Task 3: Adjuntar por rol para locación y personaje (upsert de entidad completa)

Generaliza `AttachDialog` para renderizar los roles según `assetType` y persistir con la acción correcta: producto (`setProductImagesAction`, solo imágenes) sin cambio; locación (`updateLocationAction`, entidad completa) roles Maestra/Referencia/Mapa de escala; personaje (`updateCharacterAction`, entidad completa) roles Maestra/Ángulo/Cuerpo completo.

**Files:**
- Modify: `components/studio/AttachDialog.tsx`
- Modify: `components/studio/StudioClient.tsx` (abrir el botón "Adjuntar" a todos los tipos)

**Interfaces:**
- Consumes: `addGenerationAsReferenceAction` (`server-actions/media-references`); `setProductImagesAction` (`server-actions/products`); `updateLocationAction`, `updateCharacterAction` (`server-actions/locations`, `server-actions/cast`); `StudioAssetImages`, `StudioRefOption` (Task 2).
- Produces: estudio de locación y personaje (roles base) usable end-to-end.

- [ ] **Step 1: Config de roles por tipo + persistencia**

Reescribir `components/studio/AttachDialog.tsx`. La lógica: (1) promover la generación a `media_reference` (`addGenerationAsReferenceAction`), (2) fusionar el nuevo `ref.data.id` en el rol elegido sobre `props.assetImages`, (3) persistir con la acción del tipo, (4) devolver el siguiente `StudioAssetImages` + el `StudioRefOption` nuevo.

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Box, Package, Image as ImageIcon, Map, User, PersonStanding, Shirt } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { addGenerationAsReferenceAction } from '@/server-actions/media-references';
import { setProductImagesAction } from '@/server-actions/products';
import { updateLocationAction } from '@/server-actions/locations';
import { updateCharacterAction } from '@/server-actions/cast';
import type { StudioAssetImages, StudioRefOption, StudioAssetType } from './types';

type RoleDef = { key: string; label: string; icon: React.ComponentType<{ className?: string }> };

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

// Fusiona el nuevo ref en el rol y devuelve el siguiente StudioAssetImages, o un
// error legible (p. ej. tope de ángulos). Pura sobre el estado en memoria; la
// persistencia (server action) la hace attach() con este resultado.
function mergeRole(
  images: StudioAssetImages,
  roleKey: string,
  refId: string,
): { next: StudioAssetImages } | { error: string } {
  if (images.assetType === 'product') {
    if (roleKey === 'product') {
      return { next: { ...images, productImageIds: [...new Set([...images.productImageIds, refId])] } };
    }
    return { next: { ...images, packagingImageIds: [...new Set([...images.packagingImageIds, refId])] } };
  }
  if (images.assetType === 'location') {
    if (roleKey === 'master') return { next: { ...images, masterImageId: refId } };
    if (roleKey === 'scale_map') return { next: { ...images, scaleMapImageId: refId } };
    return { next: { ...images, referenceImageIds: [...new Set([...images.referenceImageIds, refId])] } };
  }
  // character
  if (roleKey === 'master') return { next: { ...images, masterImageId: refId } };
  if (roleKey === 'full_body') return { next: { ...images, fullBodyImageId: refId } };
  // angle: el schema del personaje limita a 2 ángulos.
  if (images.angleImageIds.length >= 2 && !images.angleImageIds.includes(refId)) {
    return { error: 'El personaje ya tiene 2 ángulos (máximo). Quita uno desde el editor.' };
  }
  return { next: { ...images, angleImageIds: [...new Set([...images.angleImageIds, refId])] } };
}

// Persiste el StudioAssetImages con la acción del tipo. Devuelve ok/mensaje.
async function persist(
  productId: string,
  images: StudioAssetImages,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (images.assetType === 'product') {
    const res = await setProductImagesAction(productId, {
      productImageIds: images.productImageIds,
      packagingImageIds: images.packagingImageIds,
    });
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? 'No se pudo guardar' };
  }
  if (images.assetType === 'location') {
    const res = await updateLocationAction(productId, {
      name: images.name,
      description: images.description ?? undefined,
      masterImageId: images.masterImageId ?? undefined,
      referenceImageIds: images.referenceImageIds,
      scaleMapImageId: images.scaleMapImageId ?? undefined,
      scaleMapNotes: images.scaleMapNotes ?? undefined,
    });
    return res.ok ? { ok: true } : { ok: false, message: res.message ?? 'No se pudo guardar' };
  }
  // character: updateCharacterAction recalcula reference_image_ids internamente.
  if (!images.masterImageId) {
    return { ok: false, message: 'El personaje necesita una imagen maestra primero.' };
  }
  const res = await updateCharacterAction(productId, {
    name: images.name,
    description: images.description ?? undefined,
    masterImageId: images.masterImageId,
    angleImageIds: images.angleImageIds,
    voiceCloneId: images.voiceCloneId ?? null,
    fullBodyImageId: images.fullBodyImageId ?? null,
  });
  return res.ok ? { ok: true } : { ok: false, message: res.message ?? 'No se pudo guardar' };
}

export function AttachDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string | null;
  assetId: string;
  assetType: StudioAssetType;
  assetImages: StudioAssetImages;
  onAttached: (next: StudioAssetImages, newRef: StudioRefOption) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const roles = ROLES_BY_TYPE[props.assetType];

  async function attach(roleKey: string, roleLabel: string) {
    if (!props.generationId || saving) return;
    setSaving(roleKey);
    const ref = await addGenerationAsReferenceAction({ generationId: props.generationId });
    if (!ref.ok) {
      setSaving(null);
      toast.error('No se pudo preparar la imagen');
      return;
    }
    const merged = mergeRole(props.assetImages, roleKey, ref.data.id);
    if ('error' in merged) {
      setSaving(null);
      toast.error(merged.error);
      return;
    }
    const saved = await persist(props.assetId, merged.next);
    setSaving(null);
    if (!saved.ok) {
      toast.error(saved.message);
      return;
    }
    props.onAttached(merged.next, {
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
        <DialogHeader>
          <DialogTitle>Adjuntar al activo</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Elige el rol de esta imagen.</p>
        <div className="grid grid-cols-3 gap-3 pt-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Nota: `Shirt` en el import queda sin usar en Fase 4a (se usará en 4b para outfits) — NO lo importes todavía; incluye solo los iconos usados (`Box, Package, Image as ImageIcon, Map, User, PersonStanding`). Ajusta el import a exactamente los iconos referenciados para no romper lint de no-unused.

- [ ] **Step 2: `StudioClient` abre "Adjuntar" a todos los tipos y pasa `assetType`/`assetId`**

En `components/studio/StudioClient.tsx`:
1. Quitar el gate `{props.assetType === 'product' && (...)}` alrededor del botón "Adjuntar" en `renderActions` (Task 2 lo puso) → el botón se muestra para todos.
2. El `<AttachDialog>` recibe `assetType={props.assetType}` y `assetId={props.assetId}` (además de `assetImages`/`onAttached` ya presentes). Quitar el prop viejo `productId` si estaba (ahora es `assetId`). Confirmar que `onAttached` firma `(next: StudioAssetImages, newRef) => void` y actualiza `assetImages` + `availableReferences`.

- [ ] **Step 3: Verificar typecheck + build + lint + suite**

Run: `pnpm typecheck && pnpm build && pnpm lint && pnpm test`
Expected: sin errores; suite verde. Trazar: en un personaje, adjuntar como "Maestra" reemplaza la maestra sin borrar ángulos/cuerpo; adjuntar 3er ángulo → toast de tope; en locación, adjuntar "Referencia" agrega sin pisar maestra/mapa.

- [ ] **Step 4: Commit**

```bash
git add components/studio/AttachDialog.tsx components/studio/StudioClient.tsx
git commit -m "feat(estudio): adjuntar por rol a locación y personaje (upsert de entidad completa)"
```

---

### Task 4: Botones "Abrir estudio" en locación y personaje

Hace alcanzables los estudios de locación/personaje desde sus editores (análogo al botón de `ProductsSection`).

**Files:**
- Modify: `components/locations/LocationsPage.tsx`
- Modify: `components/cast/CastPage.tsx`

**Interfaces:**
- Consumes: rutas `/app/studio/location/[id]`, `/app/studio/character/[id]` (Task 2).
- Produces: entrada visible al estudio desde cada card.

- [ ] **Step 1: Botón en la card de locación**

En `components/locations/LocationsPage.tsx`, en la card (junto al botón "Editar" ~línea 116 y "Eliminar" ~123), añadir un `Link` "Abrir estudio" a `/app/studio/location/${l.id}`. Importar `Link` de `next/link` y `Sparkles` de `lucide-react` si no están. Estilo consistente con los botones existentes de la card (revisar sus className reales y calzar; usar tokens semánticos `border-border`/`text-muted-foreground hover:text-foreground`):

```tsx
<Link
  href={`/app/studio/location/${l.id}`}
  className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
>
  <Sparkles className="size-3" aria-hidden /> Estudio
</Link>
```

Colocarlo antes de "Editar". Ajustar el layout de botones si es una fila flex para que quepan tres.

- [ ] **Step 2: Botón en la card de personaje**

En `components/cast/CastPage.tsx`, en la card (junto a "Editar" ~línea 153 y "Eliminar" ~158), añadir el `Link` "Abrir estudio" a `/app/studio/character/${c.id}`, calzando el estilo real del botón "Editar" existente (que ya usa `border-border`/`text-muted-foreground hover:text-foreground`):

```tsx
<Link
  href={`/app/studio/character/${c.id}`}
  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
>
  <Sparkles className="size-3" aria-hidden /> Estudio
</Link>
```

Importar `Link` y `Sparkles` si no están. Colocarlo antes de "Editar".

- [ ] **Step 3: Verificar typecheck + build + lint**

Run: `pnpm typecheck && pnpm build && pnpm lint`
Expected: sin errores. Desde `/app/brand/locations` y `/app/brand/cast`, cada card muestra "Estudio" que abre el estudio del activo.

- [ ] **Step 4: Commit**

```bash
git add components/locations/LocationsPage.tsx components/cast/CastPage.tsx
git commit -m "feat(estudio): botón Abrir estudio en locación y personaje"
```

---

## Notas de ejecución (SDD)

- **Modelos:** Task 1 haiku (puro + tests, código dado). Tasks 2-3 sonnet (integración UI + acciones). Task 4 sonnet (2 call sites UI). Reviews sonnet; review final de rama opus.
- **SIN migración** — si una review pide tocar el schema de BD, es desalineación con el spec → escalar.
- **Backend ya listo:** `submitStudioTurnAction`/`createStudioSessionAction`/`listStudioSessionsAction` ya aceptan `location`/`character`; el worker ya edita en contexto y ensambla el guard por `params.assetType`. Esta fase es frontend + las 2 cláusulas de guard.
- **Diferido a Fase 4b:** roles Outfit y Estado de personaje (tablas `character_outfits`/`character_states`, acciones `createCharacterOutfitAction`/`listCharacterOutfitsAction`/`updateCharacterOutfitImageAction` y sus espejos de estado; UI de etiqueta elegir/crear en el AttachDialog). El icono `Shirt` y una 4ª/5ª columna de roles de personaje entran ahí.

## Self-review del plan

- **Cobertura del alcance (Fase 4a = locación + personaje base):** guard loc/char (T1) ✓; ruta abre loc/char + carga de datos por tipo (T2) ✓; threading assetType en submit/create/back (T2) ✓; adjuntar por rol Locación maestra/ref/mapa + Personaje maestra/ángulo/cuerpo con upsert de entidad completa (T3) ✓; entry buttons (T4) ✓. Outfits/estados explícitamente fuera (Fase 4b).
- **Placeholders:** el único "seam" es el gate temporal del botón Adjuntar en T2 (producto), retirado en T3 Step 2 — intencional y con código completo en ambos lados. Sin TODOs.
- **Consistencia de tipos:** `StudioAssetImages` (unión) definida en T2, consumida por `page.tsx`/`StudioClient`/`AttachDialog` con las mismas firmas; `mergeRole`/`persist` (T3) operan sobre la unión con narrowing por `assetType`; los campos que pasan a `updateLocationAction`/`updateCharacterAction` coinciden con `UpsertLocationSchema`/`UpsertCharacterSchema` (name requerido; character master requerido; angle ≤ 2; character no manda `reference_image_ids` — el action lo deriva).
- **Invariantes:** créditos/URLs de proveedor/admin server-side sin cambio (se reusa el camino de Fase 2); adjuntar valida ownership de imágenes dentro de las acciones de upsert existentes; sin migración; tokens semánticos en la UI nueva.
- **Riesgo anotado:** el upsert de entidad completa depende de que la página cargue TODOS los campos del registro (name/description/voice/otros roles) — si falta uno, el upsert lo pisa a null. La carga en T2 incluye todos los campos que `Upsert*Schema` escribe. Verificar en review que ningún campo persistente del registro queda fuera del `select` de la página (p. ej. si `characters` gana una columna nueva, actualizar).
