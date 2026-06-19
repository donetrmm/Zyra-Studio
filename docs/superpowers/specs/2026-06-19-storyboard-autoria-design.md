# Storyboard — Autoría (Sub-proyecto A) — diseño

- **Fecha:** 2026-06-19
- **Estado:** diseño aprobado, pendiente de plan de implementación
- **Sub-proyecto:** A (Autoría del storyboard). El B (generar el video desde el storyboard) va en un spec aparte, encima de éste.

## Contexto

Hoy las campañas generan video dividiendo el ad en clips (Seedance), con encadenado o modo-locación (ver `2026-06-19-locaciones-base-design.md`). El usuario quiere **otra forma de generar**: diseñar primero un **storyboard** (un keyframe por beat del ad) generándolo con FLUX y refinándolo con Nano Banana, para luego generar el video con esos paneles como referencia.

Decisiones del brainstorming:
1. Los paneles guían el video como **referencia** (reference2video), no como extremos fijos. (Aplica a B.)
2. La generación de video es **adaptativa por duración**: ≤~15s → un solo clip guiado por el storyboard; más largo → segmentos, cada uno guiado por su panel. (Aplica a B.)
3. **La IA propone un panel por beat, el usuario refina.** Los beats ya los produce el planner (`campaign_items` con `scene_index`).
4. El refinado de cada panel es **edición iterativa por instrucción** (Nano Banana multi-turn por debajo, preserva composición, repetible).

Las piezas de proveedor ya existen: el compiler FLUX (`lib/prompt-director/compilers/flux.ts`) genera imágenes desde cero; el compiler Nano Banana (`lib/prompt-director/compilers/nano-banana.ts`) hace edición referenciada con modo conversational/previousTurn; los handlers de generación (`lib/jobs/handlers/`) ya soportan ambos. Lo nuevo es la **orquestación que liga paneles a beats** y la **UI del storyboard**. (El "refinado" existente, `lib/refine/`, es conversacional sobre el TEXTO de la escena, NO edición de imágenes — no reutilizable aquí.)

## Objetivo de A

Que una campaña pueda tener un **storyboard**: un panel-imagen por beat, generado por FLUX y refinable por instrucciones (Nano Banana), guardado ligado al beat y mostrado como un grid en orden. A entrega el storyboard como artefacto; B lo consume para el video.

### No-objetivos (van en B)

- Generar el video usando los paneles como referencia, adaptativo por duración.

## Modelo de datos

Migración nueva: `supabase/migrations/042_storyboard.sql`.

```sql
-- 042_storyboard.sql
-- Storyboard: un panel-imagen por beat (campaign_item). El panel vigente apunta a
-- una media_reference (asi sirve de referencia para el video en el sub-proyecto B
-- y de base para la siguiente edicion Nano Banana). El historial vive en generations.

alter table campaign_items
  add column if not exists storyboard_image_id      uuid references media_references(id) on delete set null,
  add column if not exists storyboard_generation_id uuid references generations(id)       on delete set null;

comment on column campaign_items.storyboard_image_id is
  'media_reference del panel VIGENTE de este beat (null = sin panel). Se usa como referencia del video en modo storyboard.';
comment on column campaign_items.storyboard_generation_id is
  'Ultima generacion (FLUX o edicion Nano Banana) del panel, para encadenar la edicion iterativa.';
```

- Una imagen vigente por beat — mismo patrón aditivo que `location_id` (041). Sin tabla nueva.
- El historial de paneles son filas `generations` (type `image`); las columnas apuntan al panel vigente.
- `on delete set null`: borrar la media_reference o la generación no rompe el beat.

## Generación de paneles (FLUX por beat)

Server action `generateStoryboardAction(campaignId)` (en el dominio de campañas):

- Carga los beats del campaign (`campaign_items`) y el contexto de campaña (`loadCampaignContext`: producto, personajes, escena) — reutiliza lo del orquestador de video.
- Para cada beat **sin panel** (`storyboard_image_id is null`), compila con el **compiler FLUX existente** (`compile(req, ctx)` con `modelSlug` FLUX, `scenePrompt = scene_prompt`, aspectRatio de la campaña, contexto de producto/personaje/escena), inserta una generación `type:'image'` con `params.storyboard = { campaignItemId }` (marcador para el finalize glue), reserva créditos, y encola por QStash **escalonado** (`STAGGER_SECONDS`, como `enqueueBatch`).
- Idempotente: un beat que ya tiene panel o una generación en vuelo no se re-encola.
- Reusa el handler FLUX; lo nuevo es la orquestación que liga la generación al beat vía `params.storyboard`.

## Refinado de panel (Nano Banana iterativo)

Server action `refinePanelAction(itemId, instruction)`:

- Valida ownership del beat y que tenga `storyboard_image_id` (si no, error "genera el panel primero").
- Compila con el **compiler Nano Banana existente**: `scenePrompt = instruction`, la imagen vigente (`storyboard_image_id` → reference) como base, modo conversational/previousTurn usando `storyboard_generation_id` previo para preservar composición.
- Inserta una generación `type:'image'` provider nano-banana con `params.storyboard = { campaignItemId }`, reserva créditos, encola.
- El nuevo output reemplaza el panel vigente (vía el finalize glue). Repetible: cada edición opera sobre el resultado anterior.
- El compiler ya advierte "más de un cambio por iteración"; se respeta.

## Glue de finalize (promover output → media_reference)

Cuando una generación con `params.storyboard` termina (worker `app/api/jobs/process`, en el bloque finalize, junto al de cadena):

- Se **promueve** el output a una `media_reference` (helper nuevo `promoteOutputToReference(workspaceId, outputPath)`: descarga el output, `uploadReference`, inserta fila en `media_references` type `image`), y se setean en el `campaign_item`: `storyboard_image_id = <nueva media_reference>` y `storyboard_generation_id = <id de la generación>`.
- Así el panel es a la vez visible y **usable como referencia** (lo necesita B y la siguiente edición).
- Best-effort: si la promoción falla, el panel queda como la generación (output_url visible) y se loguea; reintentable. No tira la campaña.
- Las URLs del proveedor nunca llegan al cliente (invariante): se promueve a Storage interno, como con el fotograma de cadena.

## UI — vista de Storyboard

En el detalle de la campaña (`app/app/campaigns/[id]/`), una vista/pestaña **Storyboard**:

- Botón **"Generar storyboard"** → `generateStoryboardAction(campaignId)`.
- Grid de beats en orden (`scene_index`), cada uno con: el panel (o placeholder con estado pendiente/generando/listo/falló), un botón **Regenerar** y un input de instrucción (**"cambia X / agrega Y"**) que llama `refinePanelAction(itemId, instruction)`.
- **Realtime** para el estado de cada generación (mismo patrón que el resto de generaciones; ver memoria de Realtime+RLS con `setAuth` explícito).
- Sistema visual: dark, shadcn, sin emojis. Server Components por default; `'use client'` solo en la parte interactiva (input/acciones/realtime).

## Casos borde

- Beat sin panel aún → Regenerar/instrucción deshabilitados; "Generar storyboard" lo crea.
- Generación falla → el beat muestra `failed`, reintentable (regenerar / nueva instrucción).
- Beat agregado tras generar → sale sin panel; "Generar storyboard" solo crea los faltantes (idempotente). Borrar un beat no afecta a los demás.
- Provider FLUX/Nano Banana error → se refleja como `failed`, sin tirar la campaña.
- Créditos: cada panel/edición es una generación con `credits_estimated`; reserva/confirma/refund SIEMPRE vía las funciones SQL atómicas (`reserve_credits`/`confirm_credits`/`refund_credits`) — nunca UPDATE directo.
- Sin créditos → la generación queda `failed` con mensaje, el beat reanudable.

## Testing

Unit puros (sin APIs reales, ver memoria de tests):
1. Compilación FLUX de un beat: el prompt y las referencias (producto/personaje/escena) salen correctos para un `campaign_item` dado.
2. Selección de beats: `generateStoryboardAction` solo encola beats sin panel ni generación en vuelo (idempotencia).
3. Estado del panel: transiciones pending→generating→ready/failed derivadas del estado de la generación.
4. `refinePanelAction`: usa el `storyboard_image_id` vigente como base y encadena `storyboard_generation_id` previo; rechaza si no hay panel.
5. Glue de finalize (lógica pura de decisión): una generación con `params.storyboard` dispara la promoción + set de columnas; sin el marcador, no.

Smoke con generación real (FLUX + Nano Banana) lo corre el usuario.

## Archivos afectados (resumen)

- `supabase/migrations/042_storyboard.sql` (nuevo)
- `lib/campaigns/storyboard.ts` (nuevo): orquestación de generación/refinado de paneles (selección de beats, compilación, inserción de generaciones) — análogo a `orchestrator.ts` pero para imágenes.
- `server-actions/storyboard.ts` (nuevo): `generateStoryboardAction(campaignId)`, `refinePanelAction(itemId, instruction)`. Validación zod + ownership por workspace.
- `app/api/jobs/process/route.ts` (finalize glue: promover output → media_reference + set columnas cuando `params.storyboard`).
- `lib/supabase/storage.ts` (helper `promoteOutputToReference(workspaceId, outputPath): Promise<string>` que devuelve el id de la nueva media_reference).
- `app/app/campaigns/[id]/storyboard/` + `components/campaigns/StoryboardView.tsx` (UI).
- `lib/schemas/` (zod para las acciones).
- Tests: `lib/campaigns/*.test.ts`.

## Riesgos / decisiones abiertas

- **Costo/latencia**: N paneles FLUX + ediciones = N+ generaciones por campaña. El escalonamiento y el límite de Vercel Hobby ya se manejan como en el video; las imágenes son más rápidas que el video, así que el riesgo es menor.
- **Continuidad multi-turn de Nano Banana**: depende de que el provider preserve composición vía `previousTurn`/conversational. Se valida en el smoke; si el encadenado de turnos no está disponible para una generación dada, la edición cae a "editar sobre la imagen vigente" sin sesión (degradación aceptable).
- **Aspecto del panel vs video**: el panel se genera en el aspect ratio de la campaña para que sirva de referencia coherente al video (B).

## Dependencia con B

B (video desde storyboard) se construye encima de A: A produce `storyboard_image_id` por beat (una media_reference); B alimenta esos paneles como referencias del video (reference2video), adaptativo por duración. A no implementa nada de la generación de video.
