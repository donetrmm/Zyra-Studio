# Estudio creativo de activos (chat) — Diseño

**Fecha:** 2026-07-09
**Estado:** Aprobado (pendiente de plan de implementación)
**Ámbito:** productos, locaciones y personajes (cast) — la creación y edición de sus imágenes.

## Resumen

Se reemplaza la creación/edición de imágenes de activos —hoy repartida entre un wizard modal (`CreationWizard`), refinadores inline (`MasterImageRefiner`) y botones de ángulo por editor— por un **estudio de chat a página completa**: el usuario itera libremente con un modelo a elección, sube referencias, y de una **galería de la sesión** selecciona qué imágenes cargar al activo (etiquetando su rol). Las restricciones de consistencia dejan de ser forzadas y pasan a ser un **toggle opcional**. La generación deja de ser inline y pasa a ser **asíncrona** (QStash + Realtime) por un único camino. La sesión **conserva el contexto** de la iteración previa.

La feature respeta las decisiones inmutables del repo: créditos solo vía funciones SQL atómicas, un único chokepoint de generación reutilizado, URLs de proveedor nunca al cliente, providers solo server-side, RLS por `workspace_id`.

## Motivación

El flujo actual fuerza consistencia ("keep the product/face identical") en cada edición y ofrece controles estructurados (maestra, ángulos 3/4-90°) pero rígidos y sin iteración conversacional real (el `MasterImageRefiner` es one-shot con un solo "deshacer"; el historial del wizard es efímero en estado React). El usuario quiere **libertad de autoría estilo chat**: iterar sin límites, comparar variantes, subir referencias y curar el resultado, manteniendo la posibilidad de forzar fidelidad cuando la necesita.

La tensión que esto resuelve con cuidado: el pipeline de video usa estas imágenes como **anclas de identidad** (la maestra ancla al personaje; los ángulos deben mostrar a la misma persona; los ángulos de producto deben coincidir con el frente). Por eso la libertad se combina con **roles al adjuntar** (el pipeline sigue recibiendo activos tipados por rol) y un **guard opcional** (para producir variantes fieles cuando se quiere).

## Decisiones tomadas (con el usuario)

1. **Autoría libre + roles al adjuntar.** El chat es la superficie principal. Al cargar una foto al activo se elige su rol. Las guards de consistencia son opcionales (toggle), no forzadas.
2. **Ambos proveedores desde v1:** Nano Banana (ya integrado) y GPT Image, con selector de modelo. **Un solo modelo por proveedor hace generación Y edición** — en el Vercel AI Gateway NO hay un "modelo de edición" separado; editar = ese mismo modelo con una imagen de entrada (Nano por content-part, gpt-image por `prompt.images`). El selector elige el modelo; que el turno sea generación o edición lo decide el CONTEXTO (si hay imagen de trabajo/referencias), no elegir otro modelo. **Todo por el gateway, sin key directa de OpenAI.**
3. **Los 3 activos desde v1** (producto, locación, personaje), incluidos **outfits y estados** de personaje.
4. **Persistencia ligera de sesión:** las generaciones (que ya se persisten como filas) se agrupan por `studio_session_id`; la galería sobrevive a recargas; "nueva sesión limpia" = grupo nuevo.
5. **Página dedicada a pantalla completa.** Se retiran los refinadores inline y el wizard modal; los ángulos/quick-actions renacen como presets.
6. **Todo asíncrono (un solo camino):** toda generación del estudio pasa por QStash + Realtime, Nano incluida.
7. **La sesión conserva el contexto** de lo anterior (imagen de trabajo + cadena conversacional).

## Hallazgos técnicos (investigación, con fuentes en el hilo de brainstorming)

- **Generación GPT Image por el gateway: sin key nueva.** `openai/gpt-image-2`, `openai/gpt-image-1`, `openai/gpt-image-1-mini` están servidos por el Vercel AI Gateway con el mismo `AI_GATEWAY_API_KEY`. `gpt-image-1.5` **no** está en el gateway aún.
- **GPT Image usa otra llamada del AI SDK que Nano.** GPT Image: `generateImage(...)` → `result.images[].base64`. Nano (hoy): `generateText(model:'google/gemini-3-pro-image')` → `result.files`. Son **dos ramas** en el adapter. El base64 de GPT Image encaja limpio con "el worker descarga y sube a Supabase" (nunca una URL de proveedor).
- **Edición GPT Image por el gateway: probable pero SIN confirmar end-to-end.** Docs recientes dicen que sí (hasta 4 refs vía `prompt.images`), pero un hilo de Vercel de mediados de 2026 indicaba que el gateway aún no ruteaba el endpoint de edición de gpt-image. → **Compuerta:** smoke test de edición `openai/gpt-image-2` con `prompt.images` contra el gateway con key real antes de habilitar ese modo. **Decisión del usuario (firme): TODO por el Vercel AI Gateway, NO se agrega `OPENAI_API_KEY` directo.** Si el smoke muestra que el gateway NO rutea la edición de gpt-image, entonces **gpt-image queda como generación-only y la edición se ofrece solo con Nano** (que sí edita por gateway) — no hay fallback a la API directa de OpenAI.
- **Latencia:** `gpt-image-2` en calidad usable tarda ~145-280s (mediana ~195s); `gpt-image-1`/`mini` y calidades bajas ~10-30s. Por eso el camino es asíncrono.

> **Dependencia resuelta (verificada 2026-07-09):** el worker hoy está en `maxDuration = 60` (`app/api/jobs/process/route.ts`), NO 300s — no hay `vercel.json`/`vercel.ts` ni override en `next.config.ts`. Un job de imagen se resuelve en **una sola invocación** del worker (llama al proveedor bloqueante, sube, completa), sin re-encolado por polling — el proveedor de imagen no se puede sondear en trozos como el video, la llamada bloquea hasta terminar. Con 60s, `gpt-image-2` media/alta (~150-280s) no completa. **Decisión del usuario:** subir el `maxDuration` del worker a **300** (los defaults actuales de Vercel lo permiten; confirmar en el deploy de la org). Cada job de imagen = un hop que bloquea hasta ~280s < 300s. `gpt-image-2` en "alta" (~280s) queda cerca del techo → best-effort (ver Errores); default interactivo = **media**. Se añade un guard de idempotencia (claim atómico `queued→processing`) por los reintentos de QStash, y `timeout_at` + el job de cleanup rescatan generaciones que queden `processing` si una invocación muere.
- **Refs de entrada:** hasta 4 imágenes por el gateway. Tamaños soportados: 1024², 1536×1024, 1024×1536 (gpt-image-1/mini); gpt-image-2 añade 1792×1024 y 1024×1792.

## Arquitectura

### Reutilizar el pipeline de generación

Cada turno del chat es una **fila `generations`** normal. No se construye un subsistema de generación paralelo. Se reutiliza:
- El estimador y las funciones SQL atómicas de créditos (`reserve_credits`/`confirm_credits`/`refund_credits`).
- El almacenamiento en Supabase Storage y el job diario de cleanup.
- Los adapters de proveedor server-side.

Encima, una capa fina de **sesión**.

### Camino asíncrono único

Toda generación del estudio se **encola** (QStash) en vez de correr inline:

1. `submitStudioTurnAction` valida (zod + ownership por workspace), reserva créditos, inserta la fila `generations` con `status: 'queued'` y `studio_session_id`, y encola un job. Devuelve de inmediato el id de la generación.
2. El chat y la galería muestran una tarjeta **"generando…"** (optimista, por el id devuelto).
3. El worker `/api/jobs/process` procesa el job de imagen: resuelve el adapter por `provider`, llama al modelo (bloqueante, dentro del cap de 300s), sube el output a Storage, y **completa** la generación (confirma créditos) o **falla** (reembolsa).
4. **Realtime** entrega el update de la fila `generations`; la tarjeta pasa a la imagen final o a "falló".

Esto es obra nueva real: hoy la imagen es inline en `submitGenerationAction`; el worker solo procesa video/audio. Se añade un **tipo de job de imagen**. El resto de la app (creador general, etc.) puede seguir usando el camino inline; solo el estudio usa el asíncrono.

> Nota Realtime: la publicación de `generations` ya viaja por Realtime con lista de columnas explícita (migración 050, por el cap de 1MB de records). El estudio consume el mismo canal filtrando por `studio_session_id`.

### Modelo de datos

**Tabla nueva `studio_sessions`** (RLS por `workspace_id`, patrón del repo):

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid fk | RLS `is_workspace_member` |
| `asset_type` | text | `product` \| `location` \| `character` |
| `asset_id` | uuid | id del producto/locación/personaje |
| `default_provider` | text | proveedor por defecto de la sesión |
| `default_model_id` | text | modelo/variant por defecto |
| `title` | text | autogenerado (p. ej. del primer prompt), editable |
| `created_at` | timestamptz | |
| `archived_at` | timestamptz null | "nueva sesión" no borra la anterior |

**`generations` gana `studio_session_id uuid null` (FK a `studio_sessions`).** Un turno del chat = una generación etiquetada. La galería = `generations where studio_session_id = X order by created_at`. La cadena conversacional sigue usando `parent_generation_id` (ya existe).

**`model_pricing`:** filas nuevas para `openai/gpt-image-2` (por calidad), `openai/gpt-image-1`, `openai/gpt-image-1-mini`; ramas nuevas en `lib/credits/estimator.ts` (costo por token/imagen de OpenAI vs por MP de FLUX / por resolución de Nano).

### Proveedores

- **`ImageProvider`** (`lib/router/model-selector.ts`) gana el literal `'gpt-image'`. Los schemas de generación (`lib/schemas/generations.ts`) aceptan el nuevo `provider`.
- **Adapter nuevo `lib/providers/gpt-image.ts`:** usa `generateImage` del AI SDK, lee `result.images[].base64`, soporta generación (solo prompt) y edición (`prompt.images = [base, ...refs]`, hasta 4). Devuelve `GenerationResult` estándar (`lib/providers/types.ts`).
- **Adapter Nano existente reutilizado**, pero invocado desde el worker (job) en vez de inline. Mantiene su cadena conversacional multi-turn (`thought_signature`).
- **Dispatch:** el worker de imagen resuelve `nano-banana` | `flux` | `gpt-image` (hoy el if/else de `submitGenerationAction` es binario; se factoriza a un dispatch que el worker también usa).

## La experiencia (UX)

### Superficie

Página a pantalla completa, ruta tipo `/app/studio/[assetType]/[assetId]` (con `?session=<id>` opcional). Entrada desde el editor de cada activo con un botón **"Abrir estudio"**. Dos columnas: **izquierda el chat**, **derecha la galería de la sesión**.

El editor del activo (producto/locación/personaje) conserva la ficha + la lista de imágenes adjuntas por rol; pierde los refinadores inline y los botones de ángulo.

### Compositor (bajo el chat)

- **Selector de modelo** (default de sesión, override por turno): Nano Pro (default), Nano Flash, gpt-image-2, gpt-image-1, gpt-image-1-mini.
- **Calidad** (solo gpt-image-2): baja / media / alta (afecta costo y latencia). Se guarda en `params`.
- **Adjuntar referencias:** subir, tomar de las imágenes que el activo ya tiene, o de la biblioteca. Máx efectivo por turno acotado por el proveedor (GPT Image hasta 4).
- **Toggle "mantener idéntico"** (off por defecto): encendido anexa las cláusulas de identidad existentes (`KEEP_PRODUCT` / rostro / arquitectura).
- **Campo de prompt** + presets (ver abajo).

### La sesión conserva el contexto

La sesión tiene una **"imagen de trabajo"** = la última generación, o una que el usuario elija de la galería como base ("usar como base" ramifica desde ahí). Cada envío:

- **Con imagen de trabajo → turno de edición:** base + prompt + refs subidas. Nano usa su cadena conversacional (`parent_generation_id` + `thought_signature`); GPT Image pasa `prompt.images = [base, ...refs]`. Así "ahora de 3/4" se refiere a lo anterior.
- **Sin imagen de trabajo → texto-a-imagen** (sesión limpia o "empezar de cero").

**Cambiar de proveedor a mitad de sesión** está permitido: se conserva la imagen de trabajo como imagen de entrada, pero la firma conversacional acumulada de Nano se resetea (es específica de Nano). No se rompe nada; se maneja con gracia.

### Galería y "cargar al activo"

Panel derecho: grilla de lo generado en la sesión (reciente primero). Cada tarjeta: **usar como base**, descargar, **adjuntar al activo**.

**Adjuntar** abre un selector de **rol** según el tipo de activo:

- **Producto:** Imagen de producto · Empaque
- **Locación:** Maestra · Referencia · Mapa de escala
- **Personaje:** Maestra · Ángulo · Cuerpo completo · **Outfit** (elegir/crear etiqueta) · **Estado** (elegir/crear etiqueta)

Al adjuntar: `addGenerationAsReferenceAction` (copia el output a `media_references`) + escribe en el array/tabla del rol (`setProductImagesAction`, `update{Location,Character}Action`, o las server actions de `character_outfits`/`character_states` para outfits/estados). Los outfits/estados requieren elegir o crear su etiqueta antes de adjuntar.

### Presets (opcionales)

Atajos del compositor, "puede o no poner". Los prompts hoy hardcodeados renacen como **presets integrados**: "vista 3/4", "vista 90°", "quitar fondo", "mejorar luz", y para locación "de noche / luz más cálida / despejar". Aplicar un preset prellena el prompt y activa el guard cuando corresponde (p. ej. un ángulo). Además, los **presets guardados** de imagen del usuario (tabla `presets`) quedan disponibles como inserts. Nada obligatorio.

## Qué se retira y migración

- **Se retira:** el `CreationWizard` modal, el `MasterImageRefiner` inline y los botones de ángulo/quick-action de los editores de producto, cast y locación. Su lógica útil migra a presets.
- **Punto de integración:** el wizard de creación de campaña usa hoy `CreationWizard` para "crear producto con IA". Al retirarlo, ese paso **enlaza al estudio / biblioteca de productos** (ya existe el multi-select de productos de la Fase 2) en vez de mantener un mini-creador aparte.

## Errores y bordes

- **Job fallido:** la tarjeta "generando…" pasa a "falló" y se reembolsan créditos (patrón atómico existente).
- **`gpt-image-2` "alta" cerca del techo de 300s:** best-effort; si el proveedor excede el cap, el job falla limpio (reembolso) y la UI sugiere reintentar en menor calidad. El default interactivo de gpt-image-2 es **media**.
- **Compuerta de edición gpt-image por gateway:** smoke test con key real antes de habilitar la edición gpt-image. **Sin fallback a OpenAI directo (decisión firme: todo por el gateway).** Si el gateway no rutea la edición, gpt-image queda generación-only y la edición se ofrece solo con Nano.
- **Cambio de proveedor a mitad de cadena:** resetea la firma conversacional, conserva la imagen de trabajo.
- **Sesión cuyas generaciones no adjuntadas envejecen:** lo adjuntado persiste como `media_reference`; lo no adjuntado sigue la retención normal de generaciones (por diseño; "sesión limpia" no acumula basura para siempre).

## Testing

- **Lógica pura con test (vitest):** selección de la imagen de trabajo/base, ensamblado del prompt con/sin guard, aplicación de presets, resolución de rol→destino al adjuntar, mapeo proveedor→adapter, ramas del estimador para gpt-image.
- **Server actions, worker y UI:** typecheck + build + review (sin test unitario, convención del repo).
- **Sin APIs reales en tests** (regla del repo). El smoke test de edición gpt-image por gateway y las pruebas end-to-end las corre el usuario con key real.

## Invariantes respetadas

- Créditos solo vía funciones SQL atómicas (reserva al encolar, confirma/reembolsa al completar).
- URLs de proveedor nunca al cliente: el worker descarga/recibe base64 y sube a Supabase Storage; el cliente solo ve URLs `*.supabase.co`.
- Providers y service role solo server-side.
- RLS por `workspace_id` en `studio_sessions`; server actions validan ownership además de RLS.
- Migraciones nuevas se aplican vía MCP **antes** de desplegar código que lea columnas nuevas (orden de despliegue); una migración aplicada no se modifica.

## Secuenciación (para el plan, no para el spec)

El spec describe todo el diseño; el plan lo dividirá en fases con entregables verificables:

1. **Datos + camino asíncrono + adapters:** migración (`studio_sessions`, `studio_session_id`, pricing gpt-image), adapter `gpt-image`, dispatch factorizado, job de imagen en el worker, Nano vía job.
2. **Estudio + chat (un activo, producto):** ruta, layout, compositor, selector de modelo, referencias, toggle de guard, `submitStudioTurnAction`, tarjetas "generando…" + Realtime.
3. **Galería + adjuntar con roles** (producto).
4. **Generalizar a locación y personaje** (incluidos outfits/estados con etiqueta).
5. **Presets + retiro del wizard/refiners + integración del wizard de campaña.**
- **Transversal / compuerta:** smoke test de edición gpt-image por gateway. Sin fallback a key directa: si falla, gpt-image = generación-only, edición solo con Nano.
