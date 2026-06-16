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
- **Anclaje bidireccional vía R2V + `last_image` (objetivo, modo A confirmado).** Se mantiene R2V
  (`reference_images = [producto, fotograma previo]`) para conservar el re-anclaje del producto —la
  razón por la que el spec 09 descartó i2v— y **se añade** `last_image` = fotograma inicial del clip
  siguiente. Esto requiere que el adapter envíe `last_image` también en la rama `reference2video`
  (hoy solo lo hace en `image2video`).
  > **Fallback documentado (a validar con smoke):** no está confirmado que AtlasCloud acepte
  > `last_image` junto a `reference_images` en una llamada R2V. Si el smoke revela que lo ignora o
  > rechaza, se cae a **i2v** (`image` = fotograma previo, `last_image` = fotograma siguiente),
  > aceptando el riesgo de drift del producto en ese clip (menor: ambos extremos ya muestran el
  > producto). El smoke con API real lo corre el usuario.
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

## Contrato del proveedor (AtlasCloud)

- R2V hoy: `reference_images` / `reference_videos` / `reference_audios`, `return_last_frame`.
- **Cambio:** R2V pasa a aceptar también `last_image` (fotograma final), igual que I2V.
- Respuesta poll sin cambios: `{ data: { status, outputs: [videoUrl, lastFrameUrl?], error } }`.

## Cambios por área

### 1. Extracción de frame — `lib/jobs/finalize.ts` (o módulo nuevo)
- Generalizar `makeVideoThumbnail` o añadir `extractFrameFull(buffer, atSeconds = 0): Promise<Buffer>`
  que extraiga un fotograma **sin** `scale`/`-q:v 4` (calidad de conditioning, no de miniatura).
- El thumbnail existente queda intacto; esta función es para anclaje.

### 2. Adapter `lib/providers/seedance.ts`
- En la rama `reference2video` de `submitAtlas`: añadir
  `if (params.endImageUrl) body.last_image = params.endImageUrl;` (hoy solo en `image2video`,
  `seedance.ts:288`).
- `SeedanceSubmitParams.endImageUrl` ya existe; verificar que se propaga desde el handler.

### 3. Server action `server-actions/campaigns.ts` — `generateItemAction`
- En la rama "RE-GENERAR CON CONTINUIDAD" (`:955`), aceptar un parámetro de **modo** (`'only-this'`
  | `'this-and-forward'`).
- **Modo A (`only-this`)**, solo si existe clip siguiente en la secuencia:
  1. Localizar el item i+1 (`sequence_id`, `scene_index + 1`) y su generación completada.
  2. Descargar su `output_url` (video) → `extractFrameFull(buffer, 0)` → subir a references → path interno.
  3. Insertar la nueva generación del clip i con `operation: 'reference2video'`,
     `referenceImagePaths` heredados, `endImageReferencePath` = el frame extraído, prompt vía
     `buildContinuationPrompt`.
  4. Marcar el item con warning informativo de anclaje.
- **Modo B (`this-and-forward`)**: regenerar el clip i (FRESH o continuación según índice) y, en su
  finalize, encadenar los posteriores reutilizando `advanceSequenceChain` — los items i+1…N pasan a
  `planned`/`queued` en cadena. Reusar la maquinaria del spec 09; **no** duplicar lógica de avance.
- **Último clip o clip sin siguiente**: el modo A no aplica → comportamiento actual (solo init).

### 4. Worker `app/api/jobs/process` + handler
- Propagar `endImageReferencePath` → `endImageUrl` (URL interna firmada) al adapter, igual que se
  hace hoy con las `referenceImagePaths`.

### 5. UI — `components/campaigns/` (recuadro de secuencia / Producción)
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
- `seedance.test.ts`: R2V manda `last_image` cuando hay `endImageUrl`; ausencia → no se envía.
- Extracción de frame: testear con buffer mock que el comando ffmpeg se arma sin `scale`/`-q:v`
  (o cubrir la construcción de args en función pura).
- Server action: lógica de selección de item siguiente y armado de params por modo (con admin
  client mockeado / módulo puro). **Sin** llamar a Atlas.
- Smoke con API real (lo corre el usuario): validar que R2V + `last_image` produce anclaje al frame
  final; si no, activar fallback i2v.

## Fuera de alcance

- Detección automática de "mala junta" (no fiable; queda como validación visual + warning).
- Re-anclaje bidireccional encadenado (regenerar i anclando además i+1 a i+2…): es la cascada del
  modo B; no se mezcla con el modo A.
- Concatenar los N clips en un MP4 (igual que spec 09, decisión aparte).
