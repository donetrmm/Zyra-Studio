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
- `submit(params)`: POST a `/v1/flux-2-pro-preview` con `width`, `height`, `prompt`, `image_prompt[]`.
- `poll(pollingUrl)`: GET al `polling_url` devuelto (NO hardcodear), espera `status: 'Ready'`.
- Loop interno de polling cada 0.5s con timeout de 30s.
- Descarga la imagen del `result.sample` URL inmediatamente (vence en 10 min).
- Devuelve buffer.

> Nota: FLUX podría ir síncrono porque es rápido (3-10s). Si excede 60s vendría por la cola en fase 3, pero para imágenes simples no aplica.

### 3. Router automático de imagen (0.5h)

`lib/router/model-selector.ts` con `selectImageModel(params)` exactamente como en sección 7 del spec.

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

### 7. UI de generación imagen (3h)

`/app/create/image/page.tsx` con layout 2 columnas (sección 12 del spec):

**Izquierda (controles):**
- `ModelSelector`: cards con Nano Banana Pro (default), Nano Banana Flash (speed), FLUX 2 Pro (photoreal). Botón "Auto" llama al router.
- `PromptInput` (textarea con auto-resize, contador de chars).
- Negative prompt collapsible.
- Params dinámicos:
  - Nano Banana: aspect ratio (chips), resolución (1K/2K/4K), toggles "Texto en imagen", "Edición conversacional", "Grounding".
  - FLUX: aspect ratio, megapixels (1/2/4), toggle "Photoreal".
- `ReferencesPanel` (del paso 6).
- `CostPreview`: número grande con créditos, actualiza en vivo con cada cambio de params (debounce 200ms).
- `GenerateButton` grande, deshabilitado si `cost > balance`.

**Derecha (preview):**
- Mientras procesa: skeleton con tiempo estimado (Nano Banana ~10s, FLUX ~8s).
- Al completar: imagen grande + botones (Descargar, Usar como referencia, Mover a colección).
- Historial de la sesión actual abajo (grid 3 cols).

### 8. Biblioteca básica `/app/library` (1h)

- Grid de `generations` del workspace con filtros por tipo, modelo, fecha.
- Tab "Generaciones" / "Referencias".
- `GenerationCard` con thumbnail, prompt corto, badges (modelo, créditos).
- Click → modal con detalle (prompt completo, params, botones de acción).

### 9. Compras simbólicas (1.5h)

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
- [ ] Generar con FLUX 2 Pro 1MP funciona y aparece con thumbnail en la biblioteca.
- [ ] Si el usuario intenta generar sin créditos suficientes, el botón está deshabilitado Y la server action retorna 402 si se intenta forzar.
- [ ] Subir una imagen de 5 MB como referencia funciona sin tocar el límite 4.5 MB de Vercel (verificable en network tab: el PUT va a `*.supabase.co`).
- [ ] Comprar un pack como user → la fila aparece en `/admin/purchases` → aprobar → el balance del user sube en vivo + recibe notificación.
- [ ] Una generación fallida (forzar un prompt que dispare safety) devuelve los créditos al balance.

## Lo que NO entra en esta fase

- Video, audio, voice cloning (fase 3).
- Brand kit, cast de personajes, presets (fase 4).
- Cola QStash (fase 3 — esta fase usa server actions síncronas porque image gen cabe en 60s).
- Storyboard, auto-variaciones, smart crop (fase 4).
- Timeline editor, dubbing (fase 5).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Nano Banana Pro 4K se acerca al límite de 60s | Default a 2K; warning en UI antes de generar 4K |
| FLUX URLs expiran en 10 min y el server action toma mucho | Descarga inmediata; si el server action tarda >50s, abortar y refund |
| Sharp falla al generar thumbnail en runtime Node de Vercel | Usar `sharp@0.33+` que tiene binarios precompilados para serverless |
| El usuario sube un PDF o video como "referencia" | zod valida `mime-type` en la server action; rechazar todo lo que no sea imagen |
