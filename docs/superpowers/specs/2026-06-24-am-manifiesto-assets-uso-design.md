# AM — Manifiesto de assets con descripción de uso (anotar + consumir)

**Fecha:** 2026-06-24
**Cluster:** Pre-producción de assets (sub-proyecto 2 de 3; sucede a P01, precede a P05)
**Esfuerzo:** M
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Idea destilada de la skill `brand-research` de goose-skills (gooseworks-ai/goose-skills), adaptada al stack (principio: extraer el porqué, descartar el artefacto). La skill cataloga cada asset con un **nombre + descripción de uso** para que el agente lo elija/use **por propósito** en vez de adivinar por filename. No se adopta ninguna skill del repo; solo el principio.

## Problema

Hoy el compiler cita las imágenes de producto de forma **idéntica y sin propósito** (`lib/prompt-director/compilers/seedance.ts:174-182`: cada una "@image{n} is the product…"). `ProductInventory.imagePaths` es solo `string[]` — el modelo no sabe qué muestra cada referencia ni que son **varias vistas del MISMO objeto**. Con P01 ya generando una vista 3/4, el modelo puede tratar las múltiples referencias como productos distintos, perdiendo el valor de la hoja multi-vista.

## Diseño

Anotar cada imagen de producto con su uso y **consumir esa anotación en el prompt**. Solo imágenes de producto en v1.

### Decisión de tipo (baja-ripple)

En vez de cambiar `ProductInventory.imagePaths` de `string[]` a objetos (ripple por orchestrator/compiler/validador/inventory), se añade un mapa opcional:

```ts
// lib/prompt-director/types.ts — ProductInventory
imageUsages?: Record<string, string>; // storage path -> descripción de uso
```

`imagePaths` queda `string[]`; el compiler busca el uso en `imageUsages` cuando existe. El validador de P01 (`imagePaths.length`) e `inventory.ts` no se tocan.

### 1. Storage — migración `044`

```sql
alter table media_references add column usage_description text;
comment on column media_references.usage_description is
  'AM: para qué sirve este asset (p. ej. "three-quarter view", "logo close-up"). El compiler lo cita junto a la referencia.';
```

Columna **dedicada** (no se reusa `notes`, que es genérico): semántica limpia.

### 2. Set — `setReferenceUsageAction(refId, usage)`

Nueva server action en `server-actions/media-references.ts`: valida ownership de la `media_reference` (workspace), escribe `usage_description` (o lo limpia con string vacío → null). Schema zod (`refId` uuid, `usage` string trim, máx ~120). La usan dos caminos:

- **Auto (extiende P01):** cuando el botón "Generar vista 3/4" crea la referencia (`generateProductAngle` devuelve el `refId`), el handler llama `setReferenceUsageAction(refId, 'three-quarter view')`. Gratis, conecta con P01.
- **Manual:** un campo de texto compacto por imagen de producto en el `BrandKitEditor` ("¿qué muestra esta vista?") → al cambiar, persiste vía `setReferenceUsageAction`. Carga el valor inicial desde la `media_reference`.

### 3. Resolve — orchestrator

El orchestrator resuelve `usage_description` por imagen de producto y puebla `ProductInventory.imageUsages` (path→uso). Resolver **dedicado** (un select `id, usage_description` sobre las ids del producto), sin tocar `resolvePaths` (que es compartido por cast/locación). Se mapea id→path (ya resuelto) + id→usage para producir path→usage.

### 4. Consume — compiler (el value-driver)

En `lib/prompt-director/compilers/seedance.ts`, la cita de cada imagen de producto incluye su uso cuando existe:

```
@image{n} is the product, shown here as a three-quarter view — keep its design, colors, logo and proportions consistent; ...
```

(el `, shown here as <uso>` solo si `imageUsages[path]` existe; si no, la cita actual sin cambio).

Y un **hint base** cuando hay 2+ imágenes de producto, una sola vez:

```
@image1 to @imageN show the SAME single product from different views; reconcile them into one consistent object — do not treat them as different products.
```

Esto cobra el valor de P01: el modelo entiende que el 3/4 es el mismo objeto.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/044_media_reference_usage.sql` | NUEVO — columna `usage_description` |
| `server-actions/media-references.ts` | `setReferenceUsageAction` (+ schema) |
| `components/brand-kits/BrandKitsPage.tsx` | input de uso por imagen de producto; auto-set en el botón 3/4 (P01) |
| `lib/prompt-director/types.ts` | `ProductInventory.imageUsages?: Record<string,string>` |
| `lib/campaigns/orchestrator.ts` | resolver `usage_description` → `imageUsages` al construir `ProductInventory` |
| `lib/prompt-director/compilers/seedance.ts` | cita por uso + hint multi-vista |
| tests | `prompt-director.test.ts` (cita con/sin uso + hint con 2+), validación del schema de la action |

## Tests

- **Compiler (`prompt-director.test.ts`):** con `imageUsages` poblado, la cita incluye el uso; sin él, la cita queda como hoy; con 2+ imágenes de producto aparece el hint "same single product"; con 1 imagen, no.
- **Schema de la action:** `setReferenceUsageAction` rechaza `refId` no-uuid y `usage` demasiado largo; acepta vacío (limpia). La lógica DB-bound (ownership) se valida en smoke.
- **Orchestrator:** unit test del resolver puro que mapea id→path + id→usage a path→usage (si se extrae como función pura); lo DB-bound al smoke.
- Sin APIs reales (`feedback_no_real_api_in_tests`); la UI por smoke.

## Decisiones de modelado (aprobadas)

- **Columna dedicada `usage_description`** (migración 044), no reusar `notes`.
- **Mapa `imageUsages`** (path→uso) en `ProductInventory`, no cambiar `imagePaths`.
- **Solo imágenes de producto** en v1. Cast/empaque/audio = extensión futura.
- **Sin AI-suggest** (visión que describa el asset): manual + auto-P01 por ahora.

## Decisiones inmutables — verificación

- **>60s / QStash:** sin cambio; la anotación es metadato, la generación reusa el flujo existente.
- **URLs de proveedor al cliente:** no se toca el output ni Storage; solo se anota una `media_reference` interna.
- **Créditos vía SQL atómicas:** no se toca; anotar no genera ni cobra.
- **RLS / service role:** `setReferenceUsageAction` valida ownership con zod + verificación de workspace antes de tocar la fila; la columna nueva hereda las policies de `media_references`.
- **Migración aditiva** (`add column`, nullable), nunca modificar una aplicada.
- **Sin emojis; dark mode; estilo existente** en el input nuevo.

## Fuera de alcance

- **Selección por propósito en el matcher** (el LLM elige qué asset citar) — sería un AM mayor; aquí solo etiquetamos lo que el compiler ya cita.
- Anotar cast / empaque / audio.
- AI-suggest de la descripción.
- **P05** (variantes de estado) — sub-proyecto 3 del cluster.

## Verificación posterior

- `pnpm typecheck` limpio; suite verde (tests nuevos del compiler + del schema).
- Migración 044 aplicada en el proyecto Supabase (`list_migrations`).
- Smoke del usuario: en un Brand Kit con 2 vistas de producto (una subida + el 3/4 de P01), describir la subida ("frontal en blanco"), confirmar que el 3/4 quedó auto-anotado, generar una campaña, y verificar en el prompt compilado que cada `@image` lleva su uso y aparece el hint "same single product".
