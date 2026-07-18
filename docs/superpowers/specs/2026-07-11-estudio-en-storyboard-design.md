# Estudio creativo dentro de storyboards (reemplazo del refinar)

**Fecha:** 2026-07-11
**Estado:** aprobado (diseño); pendiente de plan de implementación
**Rama prevista:** continúa en `feat/estudio-creativo-activos`

## Objetivo

Reemplazar el "refinar" conversacional de los paneles de storyboard —edición
iterativa inline que rinde poco— por el **estudio creativo** ya existente (chat a
página completa, multi-proveedor, presets, galería, sesiones persistentes). El
usuario abre un panel en el estudio, lo edita con toda la potencia del chat, y un
botón "Usar como panel" ancla el resultado al beat.

La **generación del panel base se queda en el tablero** (usa el contexto del beat:
scene_prompt, producto/personaje/locación, continuidad encadenada). Solo la
**edición/iteración** se muda al estudio. Se elimina `refinePanelAction` y su UI.

## Contexto técnico (estado actual, rama `feat/estudio-creativo-activos`)

### El refinar a reemplazar
`server-actions/storyboard.ts` — todo async vía QStash:
- `generatePanelAction(itemId)` — panel base. Compila el prompt de escena y genera
  con Nano Banana; inserta en `generations` con `params.storyboard`, encola. **Se
  conserva.**
- `refinePanelAction(itemId, instruction, opts?)` — el refinado conversacional
  (encadena por `thought_signature` del padre, `MAX_REFINE_TURNS=10`, variantes 1-3,
  `strongEdit`, toggles `productRefInChat/characterRefInChat/locationRefInChat`).
  **Se elimina.**
- `uploadPanelAction(itemId, formData)` — sube panel manual como `media_references`
  (source `'upload'`), setea `storyboard_image_id`, `storyboard_generation_id=null`.
  **Se conserva.**
- `restorePanelVersionAction(itemId, generationId)` — re-enlaza el beat a una versión
  anterior (busca la `media_references` con `source_generation_id=generationId`).
  **Se conserva.**

El vínculo panel↔beat lo hace el post-step del worker `promoteStoryboardPanel`
(`lib/jobs/storyboard-finalize.ts`) → `promoteOutputToReference`
(`lib/supabase/storage.ts:212`) + `UPDATE campaign_items SET storyboard_image_id,
storyboard_generation_id` (migración `042_storyboard.sql`). Idempotente + guard de
frescura (`isStalePromote`).

La página `app/app/campaigns/[id]/refine/[itemId]/page.tsx` edita el **guion** del
beat (scene_prompt/formato/refs), NO la imagen — no se toca.

### El estudio creativo
- Tabla `studio_sessions` (`061_studio_sessions.sql`): `asset_type text CHECK (in
  'product','location','character')`, `asset_id uuid` **sin FK**, `default_provider`,
  `default_model_id`, `title`, `archived_at`. RLS solo por
  `is_workspace_member(workspace_id)`. `generations.studio_session_id` enlaza cada
  turno.
- `submitStudioTurnAction` (`server-actions/studio.ts`) + `runImageTurn`
  (`lib/jobs/handlers/image-turn.ts`) son **agnósticos al tipo de activo**: solo pasan
  `assetType` a `params` para el guard "mantener idéntico". La imagen de trabajo sale
  de `parent_generation_id` vía `resolveBaseImage` (`lib/jobs/handlers/base-image.ts`).
- `loadStudioAsset` (`lib/studio/asset-images.ts`) arma el `StudioAssetImages` y solo
  resuelve los 3 tipos de activo. `imageIdsFromAssetImages` da las refs disponibles.
- Ruta `app/app/studio/[assetType]/[assetId]/page.tsx` (valida el tipo contra los 3,
  si no → `notFound`). `StudioClient` mantiene `workingId` (último turno `done`) y
  envía turnos con `parentGenerationId: workingId`.
- No existe integración estudio↔campaña hoy (los nombres `CampaignStudio*` /
  `lib/campaigns/studio-item.ts` son el tablero de campaña, otra cosa).

### Costura
El único punto fuertemente cableado a los 3 activos es `asset_type` (enum Zod, CHECK
de DB, `ownsAsset`, `loadStudioAsset`, camino de "adjuntar"). El resto del estudio ya
es generalizable (`asset_id` sin FK, RLS por workspace, worker agnóstico).

## Decisiones tomadas (con el usuario, 2026-07-11)

1. **Modelo UX:** el panel se abre en el **estudio completo** (`/app/studio/panel/
   [itemId]`); "Usar como panel" ancla el resultado al beat. (Enfoque elegido sobre
   estudio embebido o chat ligero in-place.)
2. **Panel base:** la generación del panel base **se queda en el tablero** (contexto
   del beat). Solo la edición se muda al estudio.
3. **Seeding no forzado:** al abrir el panel se precargan, como conveniencia, las
   **referencias limpias del beat** (producto/personaje/locación) y el **scene_prompt**
   editable. Edición libre intacta: el usuario decide usarlos o no. (Las refs limpias
   sirven para re-anclar si el panel derivó.)
4. **Sesión persistente por panel:** reabrir el panel continúa su chat/galería; se
   lista/renombra/archiva como cualquier sesión del estudio.
5. **Implementación:** Enfoque 1 — agregar `panel` como cuarto `assetType` (no un
   refactor de "sujeto" abstracto, no una sesión paralela).

## Arquitectura

### 1. Modelo de datos, sesión y ownership

- **Zod:** `StudioAssetTypeSchema` → `['product','location','character','panel']`
  (afecta `CreateStudioSessionSchema`, `SubmitStudioTurnSchema.assetType`). El union
  `StudioAssetImages` (`components/studio/types`) gana una variante `panel`.
- **Migración nueva (idempotente):** recrear el CHECK de `studio_sessions.asset_type`
  para incluir `'panel'`. `asset_id` ya es `uuid` sin FK; el índice
  `(workspace_id, asset_type, asset_id)` ya cubre el caso. Sin cambios en
  `generations` (el CHECK de provider ya acepta nano/gpt-image/flux). Se aplica vía
  MCP antes de desplegar código que lea el tipo nuevo (regla de orden migración→push).
- **`asset_id` = `campaign_item.id`** (el beat).
- **Ownership:** `ownsAsset('panel', itemId)` valida que el `campaign_item` pertenezca
  al workspace (join `campaign_items → campaigns.workspace_id`), en vez de mapear a
  `products/locations/characters`.
- **RLS:** sin cambios (policies de `studio_sessions` ya son solo workspace-member; el
  ownership del panel se valida en la action).
- **Créditos:** sin cambios (editar el panel = turnos normales del estudio, reserva/
  estima/cobra por turno; el refinar viejo también cobraba).

### 2. Carga del panel (loader + seeding)

`loadPanel(supabase, workspaceId, itemId)` arma el `StudioAssetImages` variante
`panel`, espejando `loadStudioAsset`:
- **Imagen de trabajo (base):** el panel actual. Se inicializa el `workingId` del
  `StudioClient` con `campaign_items.storyboard_generation_id` → el primer turno edita
  el panel vía `resolveBaseImage` (baja su output). El compositor arranca en modo
  edición, no texto-a-imagen.
- **Referencias disponibles:** las refs **limpias** del beat (producto/personaje/
  locación), reusando la misma resolución que usa el generador de panel (imágenes del
  producto, master del cast, imágenes de la locación). Quedan en el selector para
  citar.
- **scene_prompt:** precargado en el compositor como pista editable.
- `imageIdsFromAssetImages` gana la rama `panel` (devuelve las refs limpias del beat).

**Caso borde — panel subido a mano** (`storyboard_image_id` sin
`storyboard_generation_id`): `resolveBaseImage` no aplica (consulta `generations`).
`loadPanel` siembra la base desde la `media_reference` del panel (se ofrece como
referencia base del primer turno) en lugar de `parentGenerationId`. Camino explícito.

### 3. Entrada y salida

- **Entrada:** botón **"Abrir en estudio"** por panel en `StoryboardView` →
  `/app/studio/panel/[itemId]`. La ruta existente deja de hacer `notFound` para
  `panel` y usa `loadPanel`.
- **Salida — "Usar como panel":** `usePanelFromStudioAction(itemId, generationId)`
  (el turno elegido de la galería) reusa el patrón del storyboard:
  `promoteOutputToReference(output → media_references, source_generation_id =
  generationId)` + `UPDATE campaign_items SET storyboard_image_id = ref.id,
  storyboard_generation_id = generationId`. Atómico (las dos columnas juntas).
  Es una action **inline** (no worker): el turno ya está generado, así que solo copia
  una imagen (outputs→references) y actualiza el beat — mismo peso que
  `addGenerationAsReferenceAction`/`restorePanelVersionAction`, bien bajo el límite de
  la request. No hay riesgo de post-step pesado inline.
- **Versiones:** como cada resultado promovido queda en `media_references` con
  `source_generation_id`, el historial de versiones sigue funcionando
  (`restorePanelVersionAction` re-enlaza cualquier versión). "Usar como panel" crea una
  versión nueva, no destruye las previas.

### 4. Retiro del refinar

- **Se elimina:** `refinePanelAction` + la caja de instrucción inline y su lógica en
  `StoryboardView` (`instructions[beatId]`, `handleRefine`, overlay "Refinando…"),
  junto con lo que solo servía al refinar: variantes 1-3, `strongEdit`, toggles de
  refs, `MAX_REFINE_TURNS`, y `compilePanelEdit`/`compileRefinePrompt` si quedan sin
  otro consumidor (se verifica al implementar con grep).
- **Se conserva:** `generatePanelAction`, `uploadPanelAction`,
  `restorePanelVersionAction`, `setStoryboardLocationAction`, `setBeatAudioAction`. En
  lugar del refinar, el panel muestra "Abrir en estudio".

### 5. Edge cases (filosofía "el usuario decide")

- **Aspecto:** la sesión del panel arranca con el aspecto del beat
  (`campaign_items.aspect_ratio`) por defecto, para que "Usar como panel" quede
  consistente con el pipeline de video. El usuario puede cambiarlo; si diverge del
  beat, aviso suave (no bloqueo).
- **Zona segura (modo estricto 4:5→9:16):** editar en el estudio produce el panel tal
  cual sale; NO se re-corre el expand automático. Comportamiento esperado de edición
  libre; se documenta para que no sorprenda.
- **Texto en el panel:** no se fuerza; solo pista suave de que el video no debe llevar
  texto quemado.

## Testing

Regla del repo: unidades sin APIs reales; los smokes con API real los corre el usuario.

- **Unidades puras:** proyección de `loadPanel` (beat + refs resueltas →
  `StudioAssetImages` panel), rama `ownsAsset('panel')`, mapeo de
  `usePanelFromStudioAction` (promote + update de columnas), variante `panel` de
  `imageIdsFromAssetImages`.
- `pnpm typecheck` + `pnpm build` (gotcha `'use server'`) + `pnpm vitest`.
- **Smokes del usuario:** abrir panel → turno de edición (resuelve por Realtime) →
  "Usar como panel" → el panel se actualiza y el historial de versiones sigue intacto;
  editar un panel subido a mano (base desde la referencia); cambiar de proveedor
  (nano/gpt-image/flux).

## Fuera de alcance

- Mover la generación del panel base al estudio (se queda en el tablero).
- La página `/refine/[itemId]` (edita el guion, no la imagen) — no se toca.
- Estudio embebido en el tablero (drawer) — se descartó a favor de la página completa.
- Refactor del "sujeto" de sesión a una abstracción genérica (YAGNI; se agrega `panel`
  como assetType directo).
- Cambios en el sistema de créditos, en el pipeline de video desde storyboard, o en la
  resolución de referencias del generador de panel (se reusa tal cual).
