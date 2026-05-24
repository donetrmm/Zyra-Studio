# Fase 2 — Generación de Imagen

> **Día 3 · ~10 horas · ~14% del proyecto**
>
> Primera experiencia generativa funcional: el usuario crea una imagen con Nano Banana Pro o FLUX 2 Pro, ve el costo en vivo, paga créditos y recibe la imagen en su biblioteca. Incluye compras simbólicas porque el bono de 500 créditos se agota rápido en imagen 4K.

## Pre-requisitos

- Fase 1 completa: auth + workspace + créditos + admin funcionando.
- API keys reales en `.env.local`: `GEMINI_API_KEY`, `BFL_API_KEY`.

## Objetivo

Al cerrar la fase, un usuario puede:
1. Ir a `/app/create/image`, escribir un prompt, ver el costo estimado en créditos en tiempo real.
2. Subir referencias (drag-drop, hasta 8) directo a Supabase Storage (sin pasar por Vercel).
3. Generar con el router automático (Nano Banana 2K por default) o forzar un modelo.
4. Ver el resultado, descargarlo, marcarlo como referencia o moverlo a una colección.
5. Comprar packs de créditos desde `/app/billing` (estado `pending`); el admin aprueba/rechaza desde `/admin/purchases`.

## Tareas en orden

### 1. Adapter Nano Banana (1.5h)

`lib/providers/nano-banana.ts`:
- `generate(params)`: llamada síncrona a `POST /v1beta/models/{model_id}:generateContent` con el body de la sección 4 del doc `03-nano-banana-pro.md`.
- Soporta `gemini-3-pro-image-preview` y `gemini-3.1-flash-image-preview`.
- Acepta `params.references[]` como array de buffers/URLs (los lee desde Supabase Storage primero).
- Toggle `useGrounding` agrega `tools: [{google_search: {}}]`.
- Devuelve buffer de la imagen.
- Maneja errores: rate limit (429) con un retry, safety block con mensaje claro.

### 2. Adapter FLUX (1.5h)

`lib/providers/flux.ts`:
- `submit(params)`: POST a `/v1/flux-2-pro-preview` con `width`, `height`, `prompt`, `safety_tolerance` y **refs como campos numerados `input_image`, `input_image_2`, …, `input_image_8`** (uno por ref, base64 raw). El nombre `image_prompt[]` de FLUX 1.1 ya NO aplica; este endpoint lo ignora silenciosamente y la generación cae a text-to-image.
- `buildPrompt(params, refCount)` compone el prompt antes de enviarlo:
  1. Si hay refs y el usuario no las nombró (`image`/`imagen`/`referencia`/…), prepende `"Use image 1 as the main reference…"` (o `"Use image 1, image 2…"`). Sin esto, FLUX 2 trata las refs como contexto opcional.
  2. Si `photoreal` está activo, prepende directiva de fotografía cinemática.
- `poll(pollingUrl)`: GET al `polling_url` devuelto (NO hardcodear), espera `status: 'Ready'`.
- Loop interno cada 0.5s con timeout de 30s.
- Descarga la imagen del `result.sample` URL inmediatamente (vence en 10 min).
- Devuelve `{ buffer, mimeType }`.

> Nota: FLUX va síncrono porque es rápido (3-10s). Si excede 60s vendría por la cola en fase 3, pero para imágenes simples no aplica.

### 3. Router automático de imagen

`lib/router/model-selector.ts` con `selectImageModel(params)`. Jerarquía determinista de decisión:

**Hard constraints** (el otro modelo no soporta el feature):
1. `conversational` → Nano Pro
2. `useGrounding` → Nano Pro (solo Nano tiene tools)
3. `hasTextInImage` → Nano Pro
4. `refs > 11` → Nano Flash (único que llega a 14)
5. `refs > 8` → Nano Pro (FLUX tope 8)
6. `resolution === '4k'` → Nano Pro

**Strong signal**:
7. `photoreal` toggle → FLUX

**Intent explícito** (chip opcional en UI, ver sección 7):
8. `intent='photo'` → FLUX
9. `intent='illustration'` o `'design'` → Nano Pro
10. `intent='draft'` → Nano Flash 1K

**Fallback**:
11. Sin intent + `resolution === '1k'` → Nano Flash
12. Default → Nano Pro 2K

Cada decisión devuelve un `reason: ImageRouterReason` con label en español (`ROUTER_REASON_LABEL`) que la UI muestra bajo el ModelPicker.

> Decisión: NO usamos heurísticas regex sobre el prompt (`'foto de…'` → FLUX automático). Se probó y se descartó: invisible al usuario, falla con prompts ambiguos (`"foto de un poster"`). Explícito > mágico cuando se trata del modelo que se va a cobrar.

### 4. Estimador de costos (1h)

`lib/credits/estimator.ts`:
- `estimateCredits({ provider, model, variant, params })` consulta `model_pricing` (server-side, cacheado en RSC).
- Aplica `unit_size`: si `unit_size` no null, `ceil(units / unit_size) * credits_cost`. Para FLUX: `units = megapixels`.
- Aplica multiplicadores (hardcoded en código por ahora):
  - Nano Banana conversacional: ×1.5
  - Grounding: ×1.2
  - FLUX por ref adicional: +15 cada una
- Devuelve número de créditos final.

### 5. Server action `submitGeneration` (1.5h)

`server-actions/generations.ts`:
- Valida con zod schema por provider.
- Llama `estimateCredits` server-side (re-valida vs. cliente).
- Llama `reserve_credits(user_id, amount, generation_id_placeholder)` — si false, retorna error 402 ("Créditos insuficientes").
- Inserta fila en `generations` con `status='queued'`, `timeout_at = now() + interval '5 minutes'`.
- Como Nano Banana y FLUX van síncronos en esta fase: ejecuta el adapter directamente en la server action, sube el output a `outputs/`, genera thumbnail con `sharp` (resize a 512px, jpeg q80) a `thumbnails/`, llama `confirm_credits`, actualiza la fila con `output_url`, `thumbnail_url`, `status='done'`, `credits_charged`, `processing_ms`.
- Si falla: `refund_credits` + `status='failed'` + `error_message`.

> Esta es una simplificación intencional: en fase 3 movemos esto al worker QStash. Para imagen síncrona dentro de 60s, el server action basta.

### 6. Upload directo de referencias (1h)

- Server action `getUploadSignedUrl(filename)`: valida el path, llama `supabase.storage.from('references').createSignedUploadUrl(path)`. Path = `{workspace_id}/{user_id}/{uuid}-{filename}`.
- Componente `components/generation/ReferencesPanel.tsx`: dropzone + lista.
  - Al soltar archivo: pide signed URL → `fetch(signedUrl, { method: 'PUT', body: file })` → inserta fila en `media_references` vía server action `createMediaReference(path, type)`.
  - Muestra thumbnail (las imágenes se procesan con `sharp` en cliente NO; solo se sirven directo).
- Límite: 10 MB por archivo cliente-side (mostrar error si excede).

### 7. UI de generación imagen

`/app/create/image/page.tsx` con layout 2 columnas (sección 12 del spec). El page lee `searchParams.prompt`, `searchParams.aspect`, `searchParams.model` (para "Reusar prompt" desde library) y los pasa como iniciales al `ImageGenerator` con `key` que fuerza remount al cambiar.

**Izquierda (controles) — `ControlsPanel.tsx` en 4 pasos numerados:**

1. **Modelo**: cards Auto · Nano Pro · Nano Flash · FLUX. En auto, debajo aparece:
   - `IntentPicker`: chips opcionales **Fotografía / Ilustración / Diseño / Borrador** (cada uno guía al router; click sobre el activo lo deselecciona).
   - `AutoInfoCard`: `Auto → <modelo> · <razón>` en vivo (ej. `Auto → FLUX 2 Pro · estilo fotografía`).
2. **Prompt**: textarea auto-resize, contador 8K chars. Botón **Mejorar** (Sparkles) cobra 5 cr, llama a Gemini 2.5 Flash con system instruction en español que prohíbe inferir género/edad/etnia no especificados; devuelve sugerencia en card morada con **Usar** / **Descartar**. Si grounding está apagado y el prompt matchea keywords de datos actuales (`clima`/`hoy`/`mapa`/`precio`/…), aparece chip contextual sugiriendo activar Google.
3. **Referencias**: dropzone para upload directo a Storage + colapsable **"Tus referencias"** que lista los últimos 30 `media_references` del workspace (incluye los creados desde library con badge `gen`). Click sobre una miniatura la agrega al state local.
4. **Formato y parámetros**:
   - Aspect ratio (chips: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3).
   - Nano Banana: resolución 1K/2K/4K + toggles **Texto en imagen** (prepende directiva al prompt), **Edición conversacional** (solo Nano Pro), **Buscar datos reales en Google** (label nuevo, antes "Grounding"; muestra +20% cr solo cuando activo).
   - FLUX: megapixels 1/2/4 + toggle **Photoreal** (prepende directiva fotográfica al prompt).

Barra **Generar** sticky abajo con costo (`−X cr`), ETA, modelo activo y hint contextual; deshabilitado si `cost > balance` o prompt vacío.

**Derecha (preview) — `PreviewArea.tsx`:**

- **Empty**: chips con prompts de ejemplo.
- **Generando**: shimmer + spinner orbitando + tips rotativos cada 2.4s + barra de progreso vs ETA.
- **Resultado**: imagen grande, badge modelo+aspect abajo, botón flotante Maximize2 arriba. Doble-click sobre la imagen, click en Maximize o en "Ver en grande" → **Lightbox** (fixed overlay, max 92vh/92vw, cierra con click en backdrop / X / ESC).
- Acciones bajo la imagen: **Ver en grande** · **Usar como ref.** · **Biblioteca** · **Descargar** (blob fetch + anchor temporal con `download="zyra-{id}.{ext}"`, NO `<a href download target="_blank">` que abría nueva tab por cross-origin).
- Strip de la sesión actual abajo (24 ítems max).
- En modo conversacional: se reemplaza por `ChatThread`.

### 8. Biblioteca `/app/library`

Layout 3 zonas: header + main scroll + detail aside lateral (340px slide desde la derecha al seleccionar).

**Header**: título "Biblioteca", contadores (X imágenes · Y sesiones · Z refs · workspace), CTA "Crear imagen", tabs segmentadas, search + sort.

**Tabs**: **Sesiones · Cuadrícula · Referencias**. Favoritos/Papelera del mockup original se omitieron por no haber feature en DB.

- **Sesiones**: generaciones agrupadas por `parent_generation_id` (hilos conversacionales aparecen como 1 sesión con N variaciones `v1, v2…`; el resto como sesión de 1). Bucketing temporal: Hoy / Ayer / Esta semana / Mes / Mes Año. Card: prompt clamp-2, meta (bullet morado con modelo, aspect, créditos totales, # variaciones, fecha), grid responsiva 1-4 cols.
- **Cuadrícula**: misma data sin agrupar, grid 2-6 cols con bucketing por fecha.
- **Referencias**: grid 3-8 cols, badge `gen` para refs originadas desde una generación.

**Tile**: aspect ratio respetado. Hover muestra gradiente + 2 botones (Descargar blob, Usar como ref via server action).

**Detail aside**: imagen grande con signed URL (loading state), botones **Reusar prompt** (Link a `/app/create/image?prompt=…&aspect=…&model=…`) · **Descargar** · **Usar como ref.**, campos copiables (prompt, modelo, aspect, estado, créditos, fecha, ID). Cierra con ESC o X. Remount con `key={id}` al cambiar selección para evitar warning de React 19 sobre setState en useEffect.

### 9. Mejora de prompt con créditos

`lib/providers/prompt-enhancer.ts` + `server-actions/prompt-enhancer.ts`:

- Migration `009_prompt_enhance.sql` agrega:
  - Pricing row `internal/prompt-enhance/default = 5 cr` (≈16% de la generación más barata).
  - SQL functions `charge_credits(user, amount, reason, metadata)` y `refund_charge(...)` para cargos directos sin `generation_id` (necesario porque las RPCs `reserve_credits` lo requieren). Mismo patrón de seguridad que las existentes: `security definer`, `set search_path`, revocadas de `anon`/`authenticated`, solo `service_role` las invoca.
- Server action `enhancePromptAction({ prompt, hint })`:
  1. Carga costo desde `model_pricing` (fallback 5 si migration no aplicada).
  2. `chargeCredits` atómico — si insuficiente retorna error sin llamar a Gemini.
  3. Llama `enhancePrompt` (Gemini 2.5 Flash con `thinkingConfig.thinkingBudget=0` para no comerse el `maxOutputTokens` razonando; system instruction en español que prohíbe inferir atributos no especificados; remueve comillas accidentales del output).
  4. Si Gemini falla, `refundCharge` automático.
- UI: botón Sparkles en el textarea del prompt → loading → sugerencia en card morada con **Usar** (reemplaza prompt) / **Descartar**. Editar el textarea descarta la sugerencia.

### 10. Compras simbólicas (1.5h)

- `/app/billing/page.tsx`:
  - Card del balance + botón "Historial" que abre lista de `credit_transactions`.
  - 4 cards de packs (Starter $99 / 2000, Creator $399 / 10K, Pro $1499 / 50K, Studio $4999 / 200K).
  - Click en "Comprar" → server action `createPurchase(pack_id)` que inserta en `credit_purchases` con los valores del catálogo (la CHECK constraint protege).
  - Estado pendiente visible: lista de "Compras en revisión".
- `/admin/purchases/page.tsx`:
  - Tabla de pending con botones "Aprobar" → llama `approve_purchase(id)` / "Rechazar" → dialog que pide motivo → llama `reject_purchase(id, motivo)`.
  - Tabs: Pendientes / Aprobadas / Rechazadas.

## Criterios de aceptación

- [ ] Generar una imagen con Nano Banana Pro 2K en <30s end-to-end (desde click hasta ver la imagen).
- [ ] El balance baja en el topbar en vivo (Realtime), sin recargar.
- [ ] Generar con FLUX 2 Pro 1MP con 1 ref → la imagen resultante respeta visiblemente la ref (regresión: hace dos commits los refs se ignoraban silenciosamente por usar el campo `image_prompt` de FLUX 1.1).
- [ ] Si el usuario intenta generar sin créditos suficientes, el botón está deshabilitado Y la server action retorna 402 si se intenta forzar.
- [ ] Subir una imagen de 5 MB como referencia funciona sin tocar el límite 4.5 MB de Vercel (verificable en network tab: el PUT va a `*.supabase.co`).
- [ ] Comprar un pack como user → la fila aparece en `/admin/purchases` → aprobar → el balance del user sube en vivo + recibe notificación.
- [ ] Una generación fallida (forzar un prompt que dispare safety) devuelve los créditos al balance.
- [ ] En modo Auto, seleccionar el chip "Fotografía" cambia el modelo activo a FLUX 2 Pro (el `AutoInfoCard` debajo del picker lo refleja).
- [ ] "Mejorar prompt" cobra 5 cr, muestra sugerencia en español sin asumir género del sujeto, y si Gemini falla los 5 cr se refundean.
- [ ] "Usar como ref" sobre una generación en library la hace aparecer en el picker "Tus referencias" del create page tras navegar.
- [ ] "Reusar prompt" desde el detail aside abre create con prompt, aspect ratio y modelo pre-seleccionados.
- [ ] Doble-click sobre la imagen del preview abre lightbox; cierra con ESC.
- [ ] Iteración conversacional sobre una generación cuyo `thought_signature` no quedó guardado degrada al modo fallback (imagen previa como ref normal) sin error 400 de Gemini.

## Lo que NO entra en esta fase

- Video, audio, voice cloning (fase 3).
- Brand kit, cast de personajes, presets (fase 4).
- Cola QStash (fase 3 — esta fase usa server actions síncronas porque image gen cabe en 60s).
- Storyboard, auto-variaciones, smart crop (fase 4).
- Timeline editor, dubbing (fase 5).
- **Prompt negativo**: estuvo en UI y DB inicialmente; se removió de toda la cadena (commit `9bba541`). La columna `generations.negative_prompt` sigue en DB nullable pero ningún caller la escribe; no vale una migration destructiva. Si en el futuro se quiere reintroducir, FLUX y Gemini no exponen campo nativo — habría que volver a concatenar `"Avoid: …"` al prompt.
- **Favoritos / Papelera** en library: el mockup original los incluía como tabs pero no hay columna/feature en DB. Empty states placeholder agregarían más confusión que valor.
- **Multi-selección con barra flotante** en library: requiere acciones bulk (delete, mover a proyecto) que no existen. Pospuesto.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Nano Banana Pro 4K se acerca al límite de 60s | Default a 2K; warning en UI antes de generar 4K |
| FLUX URLs expiran en 10 min y el server action toma mucho | Descarga inmediata; si el server action tarda >50s, abortar y refund |
| Sharp falla al generar thumbnail en runtime Node de Vercel | Usar `sharp@0.33+` que tiene binarios precompilados para serverless |
| El usuario sube un PDF o video como "referencia" | zod valida `mime-type` en la server action; rechazar todo lo que no sea imagen |
