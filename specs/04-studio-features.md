# Fase 4 — Studio Features

> **Día 6 · ~10 horas · ~14% del proyecto**
>
> Las features que diferencian a Zyra de un wrapper genérico: brand kit, cast de personajes, prompt assistant, storyboard, auto-variaciones, smart crop, comparador A/B y el pipeline voz+video. Todas se montan sobre la cola y los adapters de fase 3, así que esta fase es mayormente UI + composición.

## Pre-requisitos

- Fases 1–3 completas. Generación de imagen, video y audio funcionando end-to-end.

## Objetivo

Al cerrar la fase, el usuario puede:
1. Crear y gestionar **brand kits** (colores, fuentes, logo, tono). Toggle "Usar brand kit" en cualquier generación los inyecta.
2. Crear **personajes** del cast con 3-5 referencias; al usarlos en una generación, sus referencias se inyectan truncadas al máx del modelo destino.
3. Usar el **prompt assistant** (Gemini Flash) que reescribe su prompt en la estructura óptima del modelo elegido.
4. Construir un **storyboard** de 4-8 frames y opcionalmente animarlo.
5. Disparar **auto-variaciones** (3 alternativas con 1 clic) tras cualquier generación.
6. Generar **smart crop multi-formato** de una imagen (1:1, 9:16, 16:9, 4:5) usando edición conversacional de Nano Banana.
7. **Comparar A/B** generaciones lado a lado.
8. Encadenar el pipeline **voz+video con lip-sync** desde la UI.

## Tareas en orden

### 1. Brand kits (1.5h)

- `/app/brand-kits/page.tsx`: grid de kits del workspace, botón "Nuevo brand kit".
- Editor `/app/brand-kits/[id]/page.tsx`:
  - Nombre.
  - Paleta: lista de `{ name, hex }` con color pickers (Radix).
  - Fuentes: input de texto (Google Fonts).
  - Logo: upload directo a `brand-assets/`.
  - Tono y guidelines: textareas.
  - Referencias de estilo: picker de `media_references`.
- En cada UI de generación (image/video/audio): toggle "Usar brand kit" → dropdown si hay >1 kit.
- Función `applyBrandKit(prompt, params, kit, type)`:
  - Image/video: kit.colors se mencionan en prompt, kit.reference_image_ids se concatenan a refs (respetando truncado del modelo).
  - Audio: kit.tone_description se inyecta como prefijo en el prompt.
- El `brand_kit_id` se guarda en `generations.brand_kit_id` (trazabilidad).

### 2. Cast de personajes (1h)

- `/app/characters/page.tsx`: grid + botón "Nuevo personaje".
- Editor `/app/characters/[id]/page.tsx`:
  - Nombre, descripción.
  - Picker múltiple de `media_references` (3-5 refs).
- En cada UI de generación: selector de personaje. Al elegir uno:
  - Sus `reference_image_ids` se inyectan al inicio de `params.reference_ids`.
  - Truncado automático según modelo destino (tabla en sección 11.3 del spec).
  - El `character_ids` se guarda en `generations.character_ids`.

### 3. Prompt assistant (1h)

`lib/prompt-assistant/enhance.ts`:
- `enhancePrompt(rawPrompt, targetModel, type)`: llamada a Gemini Flash (`gemini-2.5-flash`) con un meta-prompt que pide reescribir según la estructura óptima del modelo destino.
- Meta-prompts por modelo:
  - Veo: "Reescribe siguiendo: Subject + Action + Style + Camera + Composition + Focus + Ambiance".
  - FLUX: "Reescribe especificando lente, iluminación, ángulo y composición".
  - Nano Banana: "Reescribe como narrativa descriptiva; si hay texto en imagen, ponlo entre comillas al inicio".
  - ElevenLabs v3: "Sugiere puntos donde agregar tags expresivos inline como [whispers], [excited], [pause]".
- Devuelve `{ enhanced: string, diff: array }`.

UI: botón "Mejorar prompt" junto al `PromptInput` → abre dialog con preview lado a lado (original vs sugerencia) + botón "Aceptar".

### 4. Storyboard (2h)

`/app/storyboard/page.tsx`:
- UI: lista vertical/horizontal de cards de frames (4-8 slots, drag para reordenar con `dnd-kit`).
- Cada frame: textarea con descripción + selector de personajes opcional.
- Header del storyboard: nombre, brand kit toggle, modelo target (Nano Banana Pro default).
- Footer: costo total estimado = `N × tarifa` + botón "Generar storyboard" con confirmación.

Al hacer click en generar:
- Cliente genera un `batch_id` (uuid).
- Por cada frame: `submitGeneration` con `batch_id`, `batch_kind='storyboard'`, `params.frame_index=N`.
- Se encolan en paralelo (los Nano Banana son sync, completan rápido).
- UI muestra progreso por frame (cards van llenándose vía Realtime).

Tras completar: botón "Animar storyboard" → calcula nuevo costo (N × Kling Std 5s típico) → confirma → genera N videos cortos, cada uno con `parent_generation_id = frame_id` y nuevo `batch_id` con `batch_kind='storyboard'`.

### 5. Auto-variaciones (0.5h)

En el preview de cualquier imagen completada: botón "3 variantes".
- Modal con previews de los 3 prompts derivados ("misma escena, golden hour", "vertical 9:16 para reels", "estilo cinematográfico").
- Costo total = 3 × tarifa.
- Genera 3 con `batch_id` compartido + `batch_kind='variations'` + `parent_generation_id = original_id` + `params.seed = original.seed` cuando aplique.

### 6. Smart crop multi-formato (1h)

En el preview de cualquier imagen completada: botón "Smart crop".
- Modal con checkboxes de formatos (1:1, 9:16, 16:9, 4:5).
- Costo = N seleccionados × tarifa Nano Banana 2K.
- Por cada formato: `submitGeneration` con `provider='nano-banana'`, `params={conversational: true, source_image_url: original.output_url, target_aspect: '9:16'}`, `batch_id` compartido, `batch_kind='smart_crop'`, `parent_generation_id`.
- Prompt automático: "Reframe esta imagen al aspect ratio X manteniendo el sujeto principal y la composición visual; expande el fondo si es necesario".

### 7. Comparador A/B (0.5h)

- En la biblioteca y en cualquier grid de resultados: checkbox de selección múltiple.
- Botón "Comparar" (visible si hay 2-4 seleccionados).
- Página/modal con split screen sincronizado: para imagen, swipe slider; para video, controles sincronizados (play/pause/seek aplica a todos a la vez).
- Útil para visualizar resultados del comparador entre auto-variaciones o batches.

### 8. Vista de batches en biblioteca (0.5h)

- En `/app/library`: si un `generation` tiene `batch_id`, se agrupa visualmente con sus hermanos (border común, label "Storyboard de 6 frames" / "3 variantes" / etc.).
- Click en el batch → grid con todos los hermanos + opciones (descargar todos como ZIP, eliminar batch entero).

### 9. Árbol de iteraciones (0.5h)

- En el modal de detalle de cualquier generación: panel lateral "Historial".
- Renderiza el árbol usando `parent_generation_id` recursivo (query con CTE recursiva o resolución cliente-side).
- Visualización tipo git branch con react-flow simple o solo cards anidadas.

### 10. Smoke test (0.5h)

- Crear brand kit con paleta + logo → generar imagen con toggle activo → la imagen incorpora el logo.
- Crear personaje con 4 refs → generar video Veo (truncado a 3) → personaje reconocible.
- Storyboard de 6 frames → genera todas → animar → 6 videos cortos consistentes.
- Auto-variaciones de una imagen → 3 alternativas distintas pero relacionadas.
- Smart crop con 4 formatos → 4 versiones de la misma imagen sin cropping ciego.

## Criterios de aceptación

- [ ] Brand kit aplicado: `generations.brand_kit_id` se llena correctamente.
- [ ] Personaje aplicado: `generations.character_ids` se llena, refs truncadas según destino (verificable: pasar 5 refs a Veo solo manda 3 al provider).
- [ ] Prompt assistant: el botón "Aceptar" reemplaza el textarea con la versión mejorada; "Cancelar" la descarta.
- [ ] Storyboard: las N filas comparten `batch_id` y `batch_kind='storyboard'`; los videos animados tienen `parent_generation_id` correcto.
- [ ] Auto-variaciones: dispara 3 generaciones con un solo click, batch agrupado en library.
- [ ] Smart crop: cada formato es una fila separada con su `params.target_aspect`.
- [ ] Comparador A/B funciona con 2, 3 y 4 selecciones.

## Lo que NO entra en esta fase

- Timeline editor (fase 5).
- Plantillas comunitarias / presets públicos (fase 5).
- Dubbing automático (fase 5).
- Seed data extra para demo (fase 5).
- Refinamiento UI/animaciones (fase 5).

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Prompt assistant con Gemini Flash agrega latencia molesta | Cachear sugerencias por hash(prompt+model); mostrar skeleton mientras espera, no bloquear el botón generar |
| Storyboard de 8 frames consume 8 mensajes QStash de golpe | Mostrar en UI cuántos mensajes consume; advertir si quedan <100 mensajes diarios |
| Smart crop con edición conversacional puede no reframear bien si la imagen es muy compleja | Aceptar como limitación de la demo; permitir regenerar individualmente |
| Cast de personajes con 5 refs en Veo solo manda 3 → personaje inconsistente | UI muestra "Solo se usarán 3 de tus 5 refs en Veo" como warning antes de generar |
| Árbol de iteraciones con DAG grande (10+ niveles) puede crashear UI | Limitar profundidad visual a 5 niveles + botón "Ver más" |
