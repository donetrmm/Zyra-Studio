# P15 — Mapa esquemático de escala/geografía (diseño)

**Fecha:** 2026-06-26
**Estado:** aprobado, pendiente de plan de implementación
**Fuente del principio:** `docs/Generación de videos con IA/hallazgos-higgsfield-completo.md:638-660`
(destilado de Higgsfield/`realistic-video-IA.md`; se extrae el porqué, no se clona la herramienta — ver memoria `feedback_competidores_principios`).

## 1. Problema

El modelo de video alucina **escala y posición** de objetos: un mismo objeto cambia de
tamaño o "salta" de lugar entre tomas (caso documentado: un muñeco inflable bailarín que
cambiaba de tamaño y de posición respecto al humano). Hoy la escala/posición solo se
expresa como **texto** en el `scenePrompt`, que es justo lo que falla — el lenguaje no
fija proporciones con precisión.

La locación (migración 041) tampoco lo resuelve: su imagen master es una **foto del
entorno** citada como rol `environment` ("keep the same place, architecture, background,
lighting and overall look"), que ancla el *look* del lugar, no las **relaciones de escala
y posición** de objetos dentro de la toma.

## 2. Solución

Un **mapa esquemático top-down** (planta) del set, opcional, asociado a la **locación**.
Codifica de forma inequívoca tamaño y posición relativos (dónde está cada elemento, su
altura proporcional al humano). Se cita al modelo como una referencia `@imageN` con una
directiva **distinta** a la de ambiente, y se **re-ancla en cada clip** de la secuencia
(igual que la hoja maestra del Cast), de modo que la escala/posición no derive entre tomas.

Es un **nuevo tipo de referencia espacial** del prompt-director que reusa la maquinaria
existente; NO es un editor de diagramas nuevo.

### Decisiones de producto (tomadas en brainstorming)

- **Creación:** ambos caminos — el usuario **sube** la imagen (vía fiable para
  proporciones) **o** la **genera con IA** (FLUX desde una descripción de la disposición;
  mejor esfuerzo, la IA no es exacta en proporciones, por eso también se permite subir).
- **Asociación:** a la **locación** (reusa la tabla `locations`, un mapa opcional por
  locación). Lean, sin tabla nueva. Limitación aceptada en v1: el mapa es por lugar, no
  por escena.

## 3. Modelo de datos (migración 047, aditiva)

```sql
-- 047_location_scale_map.sql
alter table locations
  add column if not exists scale_map_image_id uuid,   -- media_references.id (imagen del esquema)
  add column if not exists scale_map_notes text;       -- proporciones en texto, citadas por el compiler

comment on column locations.scale_map_image_id is
  'P15: esquema top-down (planta) que fija escala/posicion de objetos; se cita como rol scale_map y se re-ancla por clip.';
comment on column locations.scale_map_notes is
  'P15: proporciones en texto libre ("la mascota mide 2x el humano, a la izquierda de la puerta"); el compiler las anexa a la directiva del esquema.';
```

- Nullable: una locación puede no tener mapa (lo común). Sin FK dura a `media_references`
  (espejo de `master_image_id`, que tampoco la tiene); la ownership se valida en el server
  action y la RLS de `media_references` es la red.
- RLS de `locations` ya cubre las nuevas columnas (policy `locations_member`).
- Migración aditiva, NUNCA modificar una aplicada. No se toca ninguna policy existente.

## 4. Prompt-director (OFICIO determinista)

### 4.1 Nuevo rol de referencia

`lib/prompt-director/types.ts` — agregar a `ReferenceRole`:

```ts
| 'scale_map'      // esquema top-down: fija escala/posicion de objetos
```

### 4.2 Contexto

`DirectorContext.location` (en `types.ts`) gana un campo opcional:

```ts
location?: {
  name?: string;
  description?: string;
  imagePaths: string[];
  scaleMap?: { path: string; notes?: string };  // P15
};
```

El orchestrator (`lib/campaigns/orchestrator.ts`, función que arma `ctx.location` ~líneas
178-189) resuelve `scale_map_image_id` → path firmable y adjunta `scale_map_notes` como
`notes`. Si no hay imagen, `scaleMap` queda `undefined` (no se cita nada).

### 4.3 Cita en el compiler

`lib/prompt-director/compilers/seedance.ts buildReferences`: tras la cita de
locación-`environment` (~línea 245) y **antes** de los extras, si `ctx.location?.scaleMap`:

```ts
if (ctx.location?.scaleMap) {
  const { path, notes } = ctx.location.scaleMap;
  pushImage(
    path,
    'scale_map',
    (n) =>
      `@image${n} is a TOP-DOWN SCALE SCHEMATIC of the set, not a scene to render: ` +
      `it fixes the relative SIZE and POSITION of the elements` +
      (notes ? ` — ${notes}` : '') +
      `. Keep these proportions and placement consistent across shots; do not resize or ` +
      `relocate objects, and do not copy its flat diagram look into the video.`,
  );
}
```

- **Prioridad ante el tope de 9 imágenes:** producto > empaque > personaje > locación >
  **scale_map** > extras. El `scale_map` se empuja después de la locación y antes de los
  extras (que ya se empujan al final). Actualizar el texto del warning de recorte
  (`droppedImages`) para incluir `scale_map` en la lista de prioridad.
- **Re-ancla por clip gratis:** el orchestrator construye `ctx.location` para CADA item de
  la secuencia con esa `location_id`; el esquema viaja en todos.

### 4.4 Alcance del compiler

Solo **Seedance** en v1 (mismo precedente que P05, cuya cita condicional es Seedance-only).
Veo/Kling (`video-prose`) diferido. Documentar el diferido en el plan.

## 5. UI — editor de Locaciones

`components/locations/LocationsPage.tsx`, dentro de `LocationEditor`: nueva sección
"Mapa de escala (opcional)" tras los ángulos de referencia:

- **Subir:** `ReferenceImagesUploader` (max 1) → `scaleMapImage` (estado `RefImage[]`).
- **Generar con IA:** botón que llama un helper nuevo `generateScaleMap(description)` en
  `components/creation/generate.ts` (FLUX text2image, prompt de planta/diagrama etiquetado).
  Espeja `generateProductConcept`: `submitGenerationAction({ provider:'flux',
  model:'flux-2-pro-preview', variant:'default', prompt, aspectRatio:'1:1', megapixels:2,
  photoreal:false, references:[] })` → `fixAsReference`. Muestra el costo en créditos como
  los otros botones generativos.
  - Prompt (en `generate.ts`): *"Top-down schematic floor-plan diagram of {description}.
    Flat simple line drawing seen directly from above, labeled, showing the relative
    positions and proportional sizes of the elements, plain background, no perspective, no
    photorealism, no shadows."*
- **Notas de proporciones:** `<textarea>` opcional → `scaleMapNotes`.
- **Miniatura:** reusa `ZoomableImage` (ampliable al clic), como las demás miniaturas.
- **Persistencia:** `updateLocationAction` / `createLocationAction` se extienden para
  aceptar `scaleMapImageId?: string | null` y `scaleMapNotes?: string | null`. El server
  action valida ownership de la imagen (espejo de `master_image_id`) vía zod + chequeo de
  `media_references.workspace_id`.

El server component `app/app/brand/locations/page.tsx` resuelve la URL firmada del
`scale_map_image_id` (suma su id al set de `allImageIds` que ya firma) para la miniatura.

## 6. Créditos

- **Subir:** gratis.
- **Generar con IA:** cuesta créditos vía el flujo FLUX normal (`submitGenerationAction` →
  `reserve/confirm/refund` atómicos), idéntico a generar la locación master o un concepto
  de producto. Sin lógica de créditos nueva.

## 7. Arquitectura inmutable (cumplimiento)

- **>60s → QStash:** no se introduce ningún job nuevo de larga duración. La generación del
  esquema sigue exactamente el mismo camino que `generateProductConcept` y la locación
  master: imagen FLUX vía `submitGenerationAction`, síncrona (<60s) como las demás
  generaciones de imagen. La regla inmutable (lo que tarda >60s pasa por QStash) se respeta
  porque no se agrega ningún camino síncrono para trabajos largos.
- **URLs de proveedor nunca al cliente:** el output se baja a Storage (bucket references) y
  solo se devuelven paths internos / URLs firmadas `*.supabase.co`.
- **Créditos vía SQL atómico:** sí (flujo FLUX existente). Nunca se tocan
  `credit_balances`/`credit_transactions` directo.
- **RLS última línea:** server action valida zod + ownership; RLS workspace-scoped es la red.
- **Service role solo server-side:** sin cambios; nada nuevo llega al bundle cliente.
- **Sin servicios nuevos, sin deps pesadas, sin `any`, sin emojis, dark mode + acento
  `#009fff`** espejando Cast/Locaciones.

## 8. Recortes de alcance (YAGNI)

- Solo a nivel **locación** (no por escena/campaña).
- Solo compiler **Seedance** (Veo/Kling diferido).
- **Sin** auto-derivación de proporciones con Gemini Flash (las notas son manuales).
- **Sin** editor de diagramas / placement visual.
- **Sin** estados de producto ni mapas múltiples por locación (una imagen).

## 9. Plan de pruebas (sin APIs reales)

1. **Compiler** (`seedance` / `prompt-director.test.ts`): dado `ctx.location.scaleMap`,
   `buildReferences` incluye una referencia con `role: 'scale_map'`, la línea cita la
   directiva top-down (incluye las notas si vienen), y la ordena tras la locación y antes
   de los extras. Caso tope-9 saturado: como el orden de empuje ES la prioridad, los
   extras (empujados después) se recortan antes que el `scale_map`, y el `scale_map` se
   recorta antes que… nada lo precede salvo locación/personaje/producto (que se conservan).
   Verificar que con 9 imágenes ya ocupadas por producto+personajes+locación, un `scale_map`
   se descarta y emite warning; y que un extra se descarta antes que el `scale_map` cuando
   compiten. Caso sin `scaleMap`: no aparece ninguna referencia `scale_map`.
2. **generate.ts** (`generate.test.ts`): `generateScaleMap(description)` arma el payload
   FLUX correcto (provider/model/variant/aspectRatio/megapixels/photoreal=false, sin
   references) — patrón de los tests deterministas existentes (no llama a red).
3. **Server action** (`locations.test.ts` o schema test): el schema de update/create
   acepta `scaleMapImageId`/`scaleMapNotes` y rechaza tipos inválidos. (El esquema zod vive
   en `lib/schemas/` si el módulo es `'use server'` — ver `feedback`/gotcha
   `project_use_server_no_object_export`.)

## 10. Archivos afectados (mapa)

- `supabase/migrations/047_location_scale_map.sql` (crear)
- `lib/prompt-director/types.ts` (rol + contexto)
- `lib/prompt-director/compilers/seedance.ts` (cita + warning)
- `lib/campaigns/orchestrator.ts` (resolver scaleMap en `ctx.location`)
- `components/creation/generate.ts` (`generateScaleMap`)
- `components/locations/LocationsPage.tsx` (sección UI)
- `server-actions/locations.ts` (extender create/update; validar ownership)
- `lib/schemas/locations.ts` (schemas zod, fuera del módulo `'use server'`)
- `app/app/brand/locations/page.tsx` (firmar preview del scale map)
- Tests: `lib/prompt-director/prompt-director.test.ts`, `components/creation/generate.test.ts`,
  `server-actions/locations.test.ts` (o schema test)
