# Fase I — Encadenado por fotograma de secuencias

> Continuidad real entre los clips de una **secuencia** (un anuncio multi-escena): cada clip
> arranca del **último fotograma** del anterior, así el producto y el "mundo" se heredan y el
> resultado fluye sin cortes. Diseño validado en conversación 2026-06-15.

## Problema

Hoy las N escenas de una secuencia se generan **en paralelo e independientes**. La referencia de
producto (Brand Kit) ancla el producto en cada clip, pero no la continuidad (luz, encuadre,
composición). Resultado: clips buenos sueltos que no empalman, imposibles de unir con sentido.

## Decisiones fijadas (no rediseñar sin confirmar)

- **Mecanismo: heredar el último fotograma.** Clip 1 = reference-to-video con el producto. Clips
  2…N = **image-to-video** con `image` = último fotograma del clip anterior. El producto persiste
  porque viene DENTRO del fotograma heredado → no hace falta mandar init-frame + referencia juntos
  (no confirmado que Atlas lo soporte).
- **Generación SECUENCIAL.** La secuencia deja de encolarse en lote: el clip i+1 se encola al
  **finalizar** el clip i. Trade-off aceptado: una secuencia de N tarda ~N× en total.
- **Solo aplica a secuencias** (`sequence_id != null`). Los creativos sueltos siguen en paralelo,
  sin cambios.
- **Las URLs del proveedor nunca llegan al cliente** (decisión inmutable): el último fotograma se
  descarga de Atlas y se sube a Supabase Storage; al clip siguiente se le pasa la URL **interna**
  firmada como `image`.
- **Backend Atlas** (confirmado 2026-06-15): el request lleva `return_last_frame: true`; la
  respuesta del poll devuelve el fotograma anexado a `outputs` → `outputs[0]`=video,
  `outputs[1]`=fotograma. Se lee `outputs[1]` con **log defensivo** (si viniera en otro campo, el
  log lo revela y se ajusta el extractor). ModelArk: fuera de alcance de esta fase (su shape de
  last-frame no está confirmado); si el backend es ModelArk, la secuencia cae al comportamiento
  actual (paralelo) — degradación explícita, no silenciosa.

## Contrato del proveedor (AtlasCloud, confirmado por "view code" oficial)

- I2V: `image` (fotograma inicial), `last_image` (final, opcional), `return_last_frame` (bool).
- R2V: `reference_images`/`reference_videos`/`reference_audios`, `return_last_frame` (bool).
- Respuesta poll: `{ data: { status, outputs: [videoUrl, lastFrameUrl?] , error } }`.

## Cambios por área

### 1. Adapter `lib/providers/seedance.ts`
- `SeedanceSubmitParams`: añadir `returnLastFrame?: boolean`.
- `submitAtlas` / `submitModelArk`: si `returnLastFrame`, mandar `return_last_frame: true`.
- `SeedancePollResult`: añadir `lastFrameUrl?: string`.
- `pollAtlas`: cuando `completed`, si `outputs.length > 1` → `lastFrameUrl = outputs[1]`
  (con `console.warn` si se pidió `return_last_frame` y no vino, para diagnóstico).

### 2. Orquestador `lib/campaigns/orchestrator.ts`
- Nuevo módulo puro `lib/campaigns/sequence-chain.ts` (testeable, sin `server-only`):
  - `isSequenceItem(item)`, `nextSceneIndex(items, current)`, `firstSceneOf(items)`.
- `enqueueBatch`: al construir cada generación de una secuencia, marcar en `params`:
  `chain: { sequenceId, sceneIndex, isFirst, isLast }` y `returnLastFrame: !isLast`.
  **Encolar solo el primer clip (sceneIndex 0) de cada secuencia**; los demás quedan `planned`
  con su fila creada pero sin job.
- Para el clip i (i>0): su `params.operation` se fuerza a `image2video`; el `image` (init) se
  rellena en el finalize del clip i-1 (placeholder hasta entonces).

### 3. Worker `app/api/jobs/process` + `lib/jobs/finalize.ts`
- Tras `finalizeGeneration` de un clip con `params.chain` y `lastFrameUrl`:
  1. Descargar el fotograma de `lastFrameUrl`, subirlo a Storage (`media_references` o ruta de
     campaña), obtener path interno.
  2. Buscar el siguiente item de la secuencia (`sequence_id`, `scene_index + 1`).
  3. Setear su `params.image` (init) = path interno, `status='queued'`, y `enqueueJob(submit)`.
- Si un clip de la cadena **falla**: marcar los siguientes de la secuencia `skipped` con motivo
  "cadena interrumpida en escena N" (no dejarlos colgados en `planned`).

### 4. UI (mínima)
- En el recuadro de secuencia (Plan) y en Producción: nota "Se generan en cadena (uno tras otro)
  para mantener continuidad". El resto del flujo no cambia.

## Casos borde

- **Secuencia de 1 escena**: se comporta como clip suelto (no hay cadena).
- **return_last_frame no soportado / fotograma ausente**: el log lo marca; el clip siguiente cae a
  R2V normal (sin init) — degradación, no crash.
- **Timeout/cancel** de un clip intermedio: la cadena se corta; los pendientes → `skipped`.
- **Reintento / duplicado de QStash**: el avance de cadena debe ser idempotente (encolar el
  siguiente solo si su `status` sigue `planned` — `WHERE status='planned'`).

## Testing (sin API real)

- `sequence-chain.test.ts`: pura — orden, primer/último, siguiente índice, secuencia de 1.
- `seedance.test.ts`: `return_last_frame` se manda cuando `returnLastFrame`; `pollAtlas` extrae
  `outputs[1]` como `lastFrameUrl`; ausencia → `undefined` + warn.
- Mock del avance de cadena en finalize (con admin client mockeado) si la arquitectura lo permite;
  si no, cubrir la lógica de "siguiente item" en el módulo puro.

## Fuera de alcance

- Concatenar los N clips en un solo MP4 (eso es edición/ffmpeg — decisión aparte). El encadenado
  hace que la unión en cualquier editor se vea sin cortes; opcional un botón "Descargar secuencia
  en orden".
- ModelArk last-frame (sin contrato confirmado).
