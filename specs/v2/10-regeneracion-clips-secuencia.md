# Fase I — Regeneración de clips de una secuencia (dos modos)

> Cuando un clip de una secuencia ya generada no convence, el usuario debe poder rehacerlo **sin
> romper la continuidad con sus vecinos** y **sin perder los clips que sí le gustaron**. Diseño
> validado en conversación 2026-06-16. Extiende [09-encadenado-secuencias.md](./09-encadenado-secuencias.md).

## Problema

El encadenado (spec 09) es **unidireccional**: cada clip hereda del anterior. Hoy regenerar un clip
del medio (`generateItemAction`, rama "RE-GENERAR CON CONTINUIDAD", `server-actions/campaigns.ts:955`)
reutiliza `referenceImagePaths = [producto, fotograma del clip previo]` con el prompt actual. Eso
ata el clip regenerado **hacia atrás** (con el clip anterior) pero **no hacia adelante**:

- El clip regenerado termina en una composición distinta a la del clip viejo.
- El clip siguiente **no se toca** y conserva su fotograma inicial heredado del clip viejo → **se
  rompe la junta `i → i+1`** de forma silenciosa.

La cascada hacia adelante (regenerar i y todos los posteriores) resolvería la junta, pero
**destruye los clips siguientes que el usuario ya aceptó**. Hace falta ofrecer ambos comportamientos
y dejar que el usuario elija según el caso.

## Decisiones fijadas (no rediseñar sin confirmar)

- **Dos modos de regeneración**, elegibles desde la UI:
  - **Modo A — "Solo este" (anclaje bidireccional):** rehace únicamente el clip i, anclándolo al
    **fotograma final del clip i-1** (init) y al **fotograma inicial del clip i+1** (final). Los
    clips i-1 e i+1 **no se tocan**.
  - **Modo B — "Este y los siguientes" (cascada):** rehace el clip i y **re-encadena** todos los
    posteriores reutilizando `advanceSequenceChain` (spec 09). Cuesta créditos por cada clip
    regenerado.
- **Menú inteligente según posición** del clip: solo se ofrecen los modos que aplican.
  - Clip **del medio** (`0 < i < último`): A + B.
  - **Último clip** (`i == último`): solo regeneración normal (no hay siguiente al cual anclar;
    hereda del anterior como hoy). No se ofrece B (no hay nada después).
  - **Primer clip** (`i == 0`): regeneración normal (re-siembra desde el producto, como hoy) + B si
    hay posteriores. El modo A para el clip 0 ancla su **final** al inicio del clip 1 y mantiene el
    producto como init (no hay clip previo).
- **Anclaje bidireccional vía R2V multi-referencia + prompt (NO i2v, NO `last_image`).** El ejemplo
  oficial de AtlasCloud confirma que la rama `reference-to-video` **no acepta `last_image`** (es campo
  exclusivo de i2v) y que el encadenamiento se expresa pasando **varias `reference_images`** citadas
  en el prompt como `@image1`, `@image2`, … **con orden temporal** (el ejemplo: "the robot stands up,
  boards the vehicle, drives away"). Modo A entonces:
  - `reference_images = [producto, fotograma final del clip i-1, fotograma inicial del clip i+1]`.
  - Prompt: `@image1` = producto (mantener idéntico) · `@image2` = "continúa desde este fotograma"
    (inicio) · `@image3` = "la escena termina exactamente en esta composición" (cierre).
  - Con K productos, los índices se desplazan: `[prod_1…prod_K, frame_prev, frame_next]`.
  > **Por qué NO i2v (decisión del usuario 2026-06-16):** i2v solo lleva `image`/`last_image` y
  > **pierde** `reference_images` → el producto/personaje deriva (el bug que el spec 09 ya documentó).
  > Mantener R2V es innegociable para conservar consistencia. No hay fallback a i2v.
  > **Trade-off aceptado:** el anclaje del cuadro de cierre por prompt es una **guía fuerte, no un
  > conditioning determinista**: orienta el final pero no garantiza un fotograma idéntico al inicio
  > del clip i+1. Si el smoke (lo corre el usuario) muestra aterrizaje pobre, la mejora es de
  > **prompt/peso de referencia**, nunca cambiar de operación.
- **El fotograma inicial del clip siguiente se EXTRAE a resolución completa.** El thumbnail existente
  (`lib/jobs/finalize.ts:45-46`, `scale=512`, `-q:v 4`) es demasiado bajo para condicionar video. Se
  extrae el frame 0 del **video ya guardado** del clip i+1 (bucket `outputs`) con ffmpeg, sin
  downscale, y se sube a references para obtener una URL interna.
- **Las URLs del proveedor nunca llegan al cliente** (inmutable): el frame de anclaje vive en
  Supabase Storage y se pasa como URL interna.
- **El "aviso" es un warning informativo, no detección automática.** No hay forma fiable de detectar
  que el modelo "no aterrizó" en el frame siguiente. El clip regenerado en modo A se marca con un
  warning UI ("Anclado al inicio del clip siguiente — revisa la transición") y el reintento queda a
  un clic. La validación final es visual, del usuario.

## Contrato del proveedor (AtlasCloud, confirmado por ejemplo oficial 2026-06-16)

- R2V (`bytedance/seedance-2.0/reference-to-video`) acepta: `model`, `prompt`, `reference_images`
  (array de URLs/Base64/`asset://`), `reference_videos`, `reference_audios`, `duration` (4-15 o -1),
  `resolution`, `ratio`, `bitrate_mode`, `generate_audio`, `seed`, `watermark`, `return_last_frame`.
- **R2V NO acepta `last_image`** (campo exclusivo de i2v). El encadenamiento se expresa con varias
  `reference_images` citadas en el prompt (`@image1`, `@image2`, …); el orden del array = el orden de
  `@imageN`. El modelo respeta orden temporal descrito en el prompt.
- Respuesta poll sin cambios: `{ data: { status, outputs: [videoUrl, lastFrameUrl?], error } }`.

## Cambios por área

### 1. Extracción de frame — `lib/jobs/finalize.ts` (o módulo nuevo)
- Generalizar `makeVideoThumbnail` o añadir `extractFrameFull(buffer, atSeconds = 0): Promise<Buffer>`
  que extraiga un fotograma **sin** `scale`/`-q:v 4` (calidad de conditioning, no de miniatura).
- El thumbnail existente queda intacto; esta función es para anclaje.

### 2. Adapter `lib/providers/seedance.ts`
- **Sin cambios de contrato.** La rama `reference2video` ya envía `reference_images` como array; el
  modo A solo añade un tercer elemento (el fotograma de cierre). No se envía `last_image` en R2V.
- Verificar que `imageUrls` (→ `reference_images`) admite 3 entradas sin límite artificial en el
  handler/adapter.

### 3. Prompt — `buildContinuationPrompt` (`server-actions/campaigns.ts` o `lib/campaigns/`)
- Hoy arma `@image1…@imageK` (productos) + `@image{K+1}` (fotograma previo, "continúa desde él").
- **Extender** con una variante que añada `@image{K+2}` = fotograma de cierre, citado como "la escena
  debe terminar exactamente en esta composición / este es el último cuadro". Mantener la instrucción
  de producto idéntico.

### 4. Server action `server-actions/campaigns.ts` — `generateItemAction`
- En la rama "RE-GENERAR CON CONTINUIDAD" (`:955`), aceptar un parámetro de **modo** (`'only-this'`
  | `'this-and-forward'`).
- **Modo A (`only-this`)**, solo si existe clip siguiente en la secuencia:
  1. Localizar el item i+1 (`sequence_id`, `scene_index + 1`) y su generación completada.
  2. Descargar su `output_url` (video) → `extractFrameFull(buffer, 0)` → subir a references → path interno.
  3. Insertar la nueva generación del clip i con `operation: 'reference2video'` y
     `referenceImagePaths = [...productos, fotograma_previo, fotograma_cierre]`, prompt vía la
     variante de cierre de `buildContinuationPrompt`.
  4. Marcar el item con warning informativo de anclaje.
- **Modo B (`this-and-forward`)**: regenerar el clip i (FRESH o continuación según índice) y, en su
  finalize, encadenar los posteriores reutilizando `advanceSequenceChain` — los items i+1…N pasan a
  `planned`/`queued` en cadena. Reusar la maquinaria del spec 09; **no** duplicar lógica de avance.
- **Último clip o clip sin siguiente**: el modo A no aplica → comportamiento actual (solo init,
  `referenceImagePaths = [productos, fotograma_previo]`).

### 5. Worker `app/api/jobs/process` + handler
- Sin propagación especial: el fotograma de cierre viaja como un elemento más de `referenceImagePaths`
  → `imageUrls` → `reference_images` (URLs internas firmadas, igual que hoy).

### 6. UI — `components/campaigns/` (recuadro de secuencia / Producción)
- El control de regeneración de un clip de secuencia pasa de botón único a **menú** cuyas opciones
  se calculan según la posición (módulo puro de secuencia, reutilizar `sequence-chain.ts`):
  - medio → "Regenerar solo este" + "Regenerar este y los siguientes"
  - último → "Regenerar"
  - primero → "Regenerar" + "Regenerar este y los siguientes" (si hay posteriores)
- Mostrar el warning de anclaje en la card del clip regenerado en modo A.

## Casos borde

- **Clip siguiente aún no generado / sin `output_url`**: modo A no puede extraer frame → deshabilitar
  "solo este" con anclaje o caer a comportamiento actual (solo init) con aviso. No crashear.
- **Modo A en el último clip**: la opción no se ofrece; si llega igual, degrada a regeneración normal.
- **Extracción de frame falla (ffmpeg)**: caer a regeneración solo-init con warning, no crash
  (mismo patrón que el thumbnail en `finalize.ts:84-88`).
- **Idempotencia QStash**: la inserción de la nueva generación y el avance de cadena deben tolerar
  reintentos (encolar siguiente solo si `status='planned'`, como spec 09).
- **Créditos**: modo A reserva 1 generación; modo B reserva N. Reusar `reserveCredits` por
  generación (nunca tocar balances directo).

## Testing (sin API real)

- `sequence-chain.test.ts`: extender — qué modos aplican por posición (primero/medio/último,
  secuencia de 1 y de 2).
- `buildContinuationPrompt`: la variante de cierre cita `@image{K+2}` como último cuadro y mantiene
  la instrucción de producto idéntico; sin cierre se comporta como hoy.
- `seedance.test.ts`: R2V envía `reference_images` con 3 entradas cuando hay fotograma de cierre; el
  body **no** incluye `last_image`.
- Extracción de frame: testear con buffer mock que el comando ffmpeg se arma sin `scale`/`-q:v`
  (o cubrir la construcción de args en función pura).
- Server action: lógica de selección de item siguiente y armado de `referenceImagePaths` por modo
  (con admin client mockeado / módulo puro). **Sin** llamar a Atlas.
- Smoke con API real (lo corre el usuario): validar que R2V con `[producto, prev, next]` + prompt de
  cierre produce un final que empalma con el clip i+1. Si el aterrizaje es pobre → ajustar prompt o
  peso de referencia; **nunca** cambiar a i2v.

## Fuera de alcance

- Detección automática de "mala junta" (no fiable; queda como validación visual + warning).
- Re-anclaje bidireccional encadenado (regenerar i anclando además i+1 a i+2…): es la cascada del
  modo B; no se mezcla con el modo A.
- Concatenar los N clips en un MP4 (igual que spec 09, decisión aparte).
