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

## Generación de paneles (FLUX por beat, SÍNCRONA)

En este repo las imágenes (FLUX/Nano Banana) se generan **síncrono dentro del server action** — NO hay handler de imagen en QStash (solo video/audio). Regla de CLAUDE.md: solo lo que tarda >60s pasa por QStash; una imagen es rápida. Por eso el panel se genera **por-beat**, no en batch async.

Server action `generatePanelAction(itemId)` (`server-actions/storyboard.ts`):

- Valida ownership del beat; carga el contexto de campaña (`loadCampaignContext`: producto, personajes, escena).
- Compila con el **compiler FLUX existente** (`compile(req, ctx)` con `modelSlug` FLUX, `scenePrompt = scene_prompt`, aspectRatio de la campaña, contexto de producto/personaje/escena) → prompt + dimensiones + referencias.
- Inserta una fila `generations` (type `image`, provider flux, `params.storyboard = { campaignItemId }`), **reserva créditos**, llama **`generateFlux(...)` SÍNCRONO**, y al terminar: guarda el output en Storage, lo **promueve a `media_reference`** (ver "Promoción"), setea `storyboard_image_id`/`storyboard_generation_id` en el beat, y **confirma créditos**. En error: refund + generación `failed`. Mismo patrón que la generación de imagen suelta (`server-actions/generations.ts`).
- La UI ("Generar storyboard") llama `generatePanelAction` **solo para los beats sin panel** (`storyboard_image_id is null`), iterando por beat (N requests con progreso). Cada panel cabe holgado en los 60s de Vercel.

## Refinado de panel (Nano Banana iterativo)

Server action `refinePanelAction(itemId, instruction)`:

- Valida ownership del beat y que tenga `storyboard_image_id` (si no, error "genera el panel primero").
- Compila con el **compiler Nano Banana existente**: `scenePrompt = instruction`, la imagen vigente (`storyboard_image_id` → reference) como base, modo conversational/`previousTurn` usando la generación previa (`storyboard_generation_id`) para preservar composición — mismo flujo que ya hace `server-actions/generations.ts` para la edición conversacional de imágenes (carga la imagen previa + `thoughtSignature`).
- Inserta una fila `generations` (type `image`, provider nano-banana, `params.storyboard = { campaignItemId }`), reserva créditos, llama **`generateNanoBanana(...)` SÍNCRONO**, y al terminar promueve el output + setea las columnas + confirma créditos (igual que `generatePanelAction`).
- El nuevo output reemplaza el panel vigente. Repetible: cada edición opera sobre el resultado anterior.
- El compiler ya advierte "más de un cambio por iteración"; se respeta.

## Promoción del panel (output → media_reference, INLINE)

Como la generación es síncrona, la **propia acción** (no el worker) promueve el output al terminar:

- Helper nuevo `promoteOutputToReference(workspaceId, outputPath): Promise<string>`: el output ya quedó en Storage; lo sube/copia a `references` (`uploadReference`) e inserta una fila en `media_references` type `image`, devolviendo su id.
- La acción setea en el `campaign_item`: `storyboard_image_id = <nueva media_reference>` y `storyboard_generation_id = <id de la generación>`.
- Así el panel sirve de referencia (lo necesita B) y de base para la siguiente edición.
- Best-effort: si la promoción falla, el panel queda como la generación (output_url visible) y se loguea; reintentable. No tira la campaña.
- Las URLs del proveedor nunca llegan al cliente (invariante): el output ya se guardó en Storage interno por la acción, como la imagen suelta.
- **NO hay cambios en el worker QStash** — las imágenes no pasan por ahí.

## UI — vista de Storyboard

En el detalle de la campaña (`app/app/campaigns/[id]/`), una vista/pestaña **Storyboard**:

- Botón **"Generar storyboard"** → en el cliente, itera los beats sin panel y llama `generatePanelAction(itemId)` por cada uno (secuencial o con poca concurrencia), mostrando estado por panel (generando/listo/falló) según resuelve cada request síncrono.
- Grid de beats en orden (`scene_index`), cada uno con: el panel (o placeholder con su estado), un botón **Regenerar** (`generatePanelAction`) y un input de instrucción (**"cambia X / agrega Y"**) que llama `refinePanelAction(itemId, instruction)`.
- Como las acciones son **síncronas**, el estado lo da la promesa de cada request (loading → resultado); **no hace falta Realtime** para los paneles.
- Sistema visual: dark, shadcn, sin emojis. Server Components por default; `'use client'` solo en la parte interactiva (input/acciones/estado).

## Casos borde

- Beat sin panel aún → Regenerar/instrucción deshabilitados; "Generar storyboard" lo crea.
- Generación falla → el beat muestra `failed`, reintentable (regenerar / nueva instrucción).
- Beat agregado tras generar → sale sin panel; "Generar storyboard" solo crea los faltantes (idempotente). Borrar un beat no afecta a los demás.
- Provider FLUX/Nano Banana error → se refleja como `failed`, sin tirar la campaña.
- Créditos: cada panel/edición es una generación con `credits_estimated`; reserva/confirma/refund SIEMPRE vía las funciones SQL atómicas (`reserve_credits`/`confirm_credits`/`refund_credits`) — nunca UPDATE directo.
- Sin créditos → la generación queda `failed` con mensaje, el beat reanudable.

## Testing

Unit puros (sin APIs reales, ver memoria de tests) — la lógica testeable vive en `lib/campaigns/storyboard.ts`:
1. Compilación FLUX de un beat: el prompt y las referencias (producto/personaje/escena) salen correctos para un `campaign_item` dado + contexto.
2. Selección de beats sin panel: el helper que la UI usa para "Generar storyboard" devuelve solo los beats con `storyboard_image_id == null`.
3. Compilación Nano Banana del refinado: con una instrucción, produce el prompt de edición correcto y marca "más de un cambio" como warning.
4. Guard de `refinePanelAction`: rechaza si el beat no tiene `storyboard_image_id`.

Las acciones síncronas (que llaman al proveedor real y tocan Storage/DB) NO se testean con APIs reales; su smoke (FLUX + Nano Banana) lo corre el usuario.

## Archivos afectados (resumen)

- `supabase/migrations/042_storyboard.sql` (nuevo)
- `lib/campaigns/storyboard.ts` (nuevo): lógica pura de la autoría (selección de beats sin panel, compilación FLUX/Nano Banana del panel desde un `campaign_item` + contexto) — separa lo testeable de la acción.
- `server-actions/storyboard.ts` (nuevo): `generatePanelAction(itemId)`, `refinePanelAction(itemId, instruction)` — síncronas, validación zod + ownership; reservan/confirman créditos; promueven el output inline. Reutilizan el patrón de `server-actions/generations.ts`.
- `lib/supabase/storage.ts` (helper `promoteOutputToReference(workspaceId, outputPath): Promise<string>` que devuelve el id de la nueva media_reference).
- (Sin cambios en `app/api/jobs/process/route.ts` — las imágenes no pasan por QStash.)
- `app/app/campaigns/[id]/storyboard/` + `components/campaigns/StoryboardView.tsx` (UI).
- `lib/schemas/` (zod para las acciones).
- Tests: `lib/campaigns/*.test.ts`.

## Riesgos / decisiones abiertas

- **Costo/latencia**: N paneles FLUX + ediciones = N+ generaciones por campaña. El escalonamiento y el límite de Vercel Hobby ya se manejan como en el video; las imágenes son más rápidas que el video, así que el riesgo es menor.
- **Continuidad multi-turn de Nano Banana**: depende de que el provider preserve composición vía `previousTurn`/conversational. Se valida en el smoke; si el encadenado de turnos no está disponible para una generación dada, la edición cae a "editar sobre la imagen vigente" sin sesión (degradación aceptable).
- **Aspecto del panel vs video**: el panel se genera en el aspect ratio de la campaña para que sirva de referencia coherente al video (B).

## Dependencia con B

B (video desde storyboard) se construye encima de A: A produce `storyboard_image_id` por beat (una media_reference); B alimenta esos paneles como referencias del video (reference2video), adaptativo por duración. A no implementa nada de la generación de video.
