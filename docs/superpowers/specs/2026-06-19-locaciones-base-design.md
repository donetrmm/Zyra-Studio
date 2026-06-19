# Locaciones (Base) — activo reutilizable + generación sin encadenar

- **Fecha:** 2026-06-19
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Sub-proyecto:** A (Base). El B (detección/sugerencia por IA) va en un spec aparte, encima de éste.

## Contexto y problema

En el encadenado de secuencias (specs/v2/09), cada clip N+1 se genera (reference-to-video) condicionado al **último fotograma del clip N**. Medido sobre la campaña real "Aniversario pareja 2" (3 clips, ver `scripts/measure-chain-luma.mjs`), el síntoma reportado NO es brillo ni exposición: es **degradación acumulativa de la calidad del sujeto (generation loss)**. Al re-generar desde el frame anterior una y otra vez, el modelo añade textura/contraste/saturación a las caras (pecas, moteado) que se **compone** clip a clip, peor en la última escena. El re-anclaje de producto/personaje (ya existente) preserva identidad pero NO frena esa acumulación, porque el fotograma-puente arrastra el deterioro.

La causa raíz es **la cadena misma**: heredar el frame degradado. La solución que ataca la raíz es **no encadenar** y darle continuidad/consistencia por **referencias compartidas** re-ancladas en cada clip, agregando un activo nuevo que aporte el "dónde": la **Locación**.

## Objetivo de A

1. **Locación** como activo reutilizable (biblioteca, CRUD, RLS), espejo del Cast.
2. Asignar una locación a una secuencia.
3. **Modo implícito**: una secuencia con locación se genera **sin encadenar**; cada escena se genera independiente re-anclando `[producto, personajes, locación]`. Cero herencia de frame → cero degradación acumulada; consistencia del lugar por la imagen de locación re-anclada en cada clip.

A entrega, por sí solo, el fix de la degradación: asignar una locación a la secuencia problemática la regenera sin cadena.

### No-objetivos (van en B)

- Que la IA (planner/format-matcher) **detecte** secuencias mismo-lugar y **active** el modo automáticamente.
- Que la IA **sugiera o genere** la imagen de locación.

## Decisiones (tomadas en brainstorming)

1. Locación = **biblioteca reutilizable**, no campo por campaña (como el Cast).
2. Modo **por secuencia**: "toma continua (encadenada)" vs "tomas en un lugar (locación, sin encadenar)".
3. Activación **implícita**: secuencia con `location_id` → modo-locación (sin encadenar). Sin `location_id` → comportamiento actual. Sin selector de modo separado (evita estados contradictorios).
4. La consistencia de **personas** entre tomas independientes la da el **Cast** (hojas maestras re-ancladas por escena), NO la locación. Límite conocido: una persona recurrente que no esté en el Cast puede variar entre tomas.

## Modelo de datos

Migración nueva: `supabase/migrations/041_locations.sql`.

```sql
-- 041_locations.sql
-- Locaciones: activo reutilizable (espejo del Cast) = el "donde" de una secuencia.
-- Una secuencia con locacion se genera SIN encadenar; la locacion se re-ancla
-- como referencia environment en cada clip.

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  master_image_id uuid,                                         -- media_references.id (imagen del lugar)
  reference_image_ids uuid[] not null default array[]::uuid[],  -- angulos/detalles del lugar
  created_at timestamptz default now()
);
create index if not exists idx_locations_workspace on locations(workspace_id);

alter table campaign_items
  add column if not exists location_id uuid references locations(id) on delete set null;
create index if not exists idx_campaign_items_location on campaign_items(location_id);
```

- Las imágenes viven en `media_references` (bucket `references`), igual que las del Cast.
- `campaign_items.location_id` nullable. **Todas las escenas de una secuencia comparten el mismo `location_id`** (las secuencias viven denormalizadas en `campaign_items`, no hay tabla de secuencias — patrón ya usado por `sequence_label`). `null` = comportamiento actual.
- **RLS**: espejo exacto de `characters` (workspace-scoped). Las policies de INSERT deben llevar `with check` además de `using` (nota CLAUDE.md). Copiar de las policies de `characters` (021/022).
- `on delete set null` en `location_id`: borrar una locación no rompe campañas; la secuencia vuelve al comportamiento normal.

## Biblioteca y UI

Locaciones es una **pestaña nueva bajo "Marca"** (`/app/brand/locations`), junto a Brand Kits, Cast, Voces y Referencias — NO un ítem nuevo de sidebar.

- `app/app/brand/layout.tsx`: agregar `{ label: 'Locaciones', href: '/app/brand/locations' }` a `SectionTabs`.
- `app/app/brand/locations/page.tsx` (+ `loading.tsx`): lista de locaciones del workspace.
- `components/locations/LocationsPage.tsx` (+ tarjetas/form): **espeja** `components/cast/CastPage.tsx` — lista, crear/editar (nombre + imagen del lugar + descripción + imágenes de ángulo opcionales), borrar. Reusa los componentes de subida/selección de imágenes que ya usa el Cast.
- `server-actions/locations.ts`: `createLocation`, `updateLocation`, `deleteLocation`, `listLocations`. Validación zod + ownership por workspace (patrón `.cursor/rules/20-server-actions.mdc`).
- `lib/schemas/locations.ts`: schema zod (name requerido, description opcional, image ids).

## Asignación a la secuencia

En el armado/edición de campaña, donde hoy se asignan personajes a una secuencia, se agrega un **selector de Locación** (opcional, una por secuencia), poblado desde `listLocations`.

- Al asignar/cambiar, una server action escribe `location_id` en **todos** los `campaign_items` de esa secuencia (`update ... where campaign_id = ? and sequence_id = ?`).
- Quitar la locación → `location_id = null` en esos items → la secuencia vuelve a modo encadenado/normal.

## Comportamiento de generación (el corazón)

En `lib/campaigns/orchestrator.ts`:

- **Detección de modo**: una secuencia está en **modo-locación** si sus `campaign_items` traen `location_id` no nulo. Se evalúa por `sequence_id` igual que hoy se evalúa el encadenado.
- **`chainRole(item)`**: si el item está en modo-locación, devuelve el rol **no-encadenado** sin importar el backend: `{ skip:false, isFirst:false, returnLastFrame:false, orphanResume:false }`. Es decir, **todas** las escenas se encolan en el lote (no se saltan), escalonadas, como creativos independientes. Se reusa el camino no-encadenado que ya existe (el que corre hoy cuando `chainSupported()` es false en ModelArk).
- **Inserción de la generación** (modo-locación): sin `returnLastFrame`, sin objeto `chain`, sin `advanceSequenceChain`. Cada escena es una generación R2V normal.
- **Re-anclaje por escena**: cada escena compila con `[producto, personajes, locación]`. Producto y personajes ya se re-anclan por escena en el camino normal; lo nuevo es inyectar la **locación**.

Nota: el encadenado real (Atlas, `return_last_frame`) y el modo-locación son **mutuamente excluyentes** por secuencia. `location_id` presente gana: no se encadena.

### Resolución de la locación

`loadCampaignContext` (o un helper análogo a `resolveCharacterMasterPaths`) resuelve, para los `location_id` de los items seleccionados, `{ description, imagePaths }` (master + ángulos → storage paths vía `media_references`, validando workspace). Se pasa a `directorContextFor` por escena.

## Prompt-director

`lib/prompt-director`:

- **Reusa el rol `environment`** (ya existe en `types.ts`). Se agrega a `DirectorContext` un campo dedicado:
  ```ts
  location?: { name?: string; description?: string; imagePaths: string[] };
  ```
  Distinto de `extraImagePaths` (que sigue siendo para las referencias del refinado). Mantenerlos separados deja la locación explícita y testeable, y le da prioridad sobre los extras del refinado.
- **Imagen** de la locación → referencia `environment`, ubicada **después** de producto/personaje y **antes** de los `extraImagePaths`, dentro del tope de 9 imágenes.
- **v1 usa SOLO la imagen master** de la locación (`master_image_id`) — 1 imagen por clip. Los `reference_image_ids` (ángulos) se almacenan pero NO se inyectan en generación todavía (iteración posterior). Así el presupuesto típico es producto(≤3) + personajes(≤3) + locación(1) = ≤7, holgado bajo 9.
- **Descripción** de la locación → contexto de escena (setting), reforzando el "dónde" en el texto (compiler Seedance / `scene.fragment`).
- **Presupuesto de 9 imágenes**: si los `extraImagePaths` del refinado lo empujan sobre 9, se recorta **con warning**, prioridad `producto > personaje > locación > extras`. Misma mecánica de recorte+warning que hoy aplica a environment (ver test `extraImagePaths entran como environment ... recorta con warning`).

## Casos borde

- **Locación borrada** → `location_id` queda `null` (set null) → la secuencia vuelve a comportamiento normal; sin crash.
- **Locación sin imagen** (solo descripción) → solo entra el texto al prompt; sin referencia environment.
- **Secuencias existentes** (sin `location_id`) → intactas, comportamiento actual. Cambio puramente aditivo.
- **ModelArk y Atlas**: funciona en ambos (es R2V con refs; no depende de `return_last_frame`). En ModelArk una secuencia multi-escena ya caía a modo paralelo; el modo-locación es ese mismo camino + la referencia environment.
- **Consistencia de personas**: la dan las hojas maestras del Cast re-ancladas por escena. Persona recurrente fuera del Cast → puede variar entre tomas. Límite conocido y documentado (lo cubre el Cast / B).
- **Tope de refs**: producto(≤3) + personajes(≤3 master) + locación(1 master) = ≤7; los `extraImagePaths` del refinado pueden empujar sobre 9 → recorte con warning, locación por debajo de producto/personaje en prioridad.

## Testing

Tests unitarios **puros** (sin APIs reales, ver memoria de tests):

1. **Selección de modo**: con `location_id` presente, `chainRole` devuelve no-encadenado (no skip de escenas, `returnLastFrame:false`, sin `chain`), incluso con `SEEDANCE_PROVIDER=atlas`. Sin `location_id`, comportamiento de encadenado intacto.
2. **Ensamblado de referencias** (prompt-director): la imagen de la locación entra como `environment`, en el orden correcto (tras producto/personaje, antes de extras), y se recorta a 9 con warning.
3. **Descripción**: la descripción de la locación llega al contexto/setting del prompt.
4. **Server actions / schema**: validación zod y ownership por workspace (mock del cliente, sin red).

## Archivos afectados (resumen)

- `supabase/migrations/041_locations.sql` (nuevo)
- `lib/schemas/locations.ts` (nuevo)
- `server-actions/locations.ts` (nuevo)
- `app/app/brand/locations/page.tsx`, `loading.tsx` (nuevos)
- `components/locations/LocationsPage.tsx` (+ form/tarjetas, nuevos; espejo de `components/cast/`)
- `app/app/brand/layout.tsx` (agregar pestaña)
- `lib/campaigns/orchestrator.ts` (detección de modo-locación, `chainRole`, resolución de locación, `directorContextFor`)
- `lib/prompt-director/types.ts` (campo `location` en `DirectorContext`)
- `lib/prompt-director/index.ts` y `compilers/seedance.ts` (emitir environment + setting de la locación)
- Server action de asignar locación a una secuencia (en el dominio de campañas)
- Tests: `lib/campaigns/*.test.ts`, `lib/prompt-director/*.test.ts`

## Riesgos / decisiones abiertas

- **Eficacia**: el modo-locación elimina la herencia (causa de la degradación), pero la consistencia del *lugar* depende de que el modelo respete la referencia `environment`. Es un soft-anchor; se valida con A/B visual (lo corre el usuario) tras implementar. Aun en el peor caso (el modelo ignora la locación), NO empeora vs hoy y elimina la degradación acumulada.
- **UX de asignación**: el selector de locación se coloca en el MISMO punto del builder donde hoy se asignan personajes a la secuencia; se concreta contra ese componente en el plan de implementación (no es una decisión abierta de diseño, sino de ubicación exacta en el componente existente).

## Dependencia con B

B (detección/sugerencia por IA) se construye encima de A: A define el activo, la columna `location_id`, y el comportamiento de generación; B solo añade la inteligencia que detecta secuencias mismo-lugar y rellena/sugiere `location_id` automáticamente.
