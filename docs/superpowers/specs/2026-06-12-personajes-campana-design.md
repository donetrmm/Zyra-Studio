# Personajes en campañas estudio — diseño

Fecha: 2026-06-12 · Estado: aprobado en conversación, pendiente de plan de implementación

## Objetivo

Al crear una campaña estudio, el usuario asigna explícitamente qué personajes del Cast
forman parte de ella (hasta 3), designa un personaje principal, y ve el conjunto de
referencias por video con un contador contra el máximo del modelo. Las ideas que
mencionan personajes asignados por nombre los referencian correctamente en sus
creativos; los nombres no asignados (o la ausencia total de personajes) producen
personajes inventados solo en el prompt. Adicionalmente, el panel del refinado deja de
ocultar las referencias heredadas y el detalle del creativo gana un preview del prompt
final compilado.

## Contexto y presupuesto de referencias

El límite real por video en Seedance vía fal es **9 imágenes** + 3 videos + 3 audios
(12 archivos en total, `lib/schemas/campaigns.ts` `SubmitSeedanceSchema`). Hoy un video
usa: producto 3 + empaque 2 + personaje 3 (master + 2 ángulos) = 8.

Regla de recorte automático con multi-personaje (la aplica el compiler):

| Personajes en el video | Imágenes por personaje | Total imágenes (peor caso) |
|---|---|---|
| 1 | master + 2 ángulos (como hoy) | 8/9 |
| 2 | master + 1 ángulo c/u | 9/9 |
| 3 | solo master c/u | 8/9 |

Advertencia conocida (docs/modelos/06-seedance-2.md §Límites): con 3+ sujetos la
atención del modelo se reparte. El tope de 3 se mantiene por decisión del usuario,
pero la UI advierte al seleccionar el tercero.

## Decisiones tomadas

1. **Pool a nivel campaña + multi-personaje por video (máx 3).**
2. **Asignación por mención**: si las ideas nombran personajes del pool, el matcher
   los asigna a ese creativo. Sin mención, rotación de 1 personaje dentro del pool.
3. **Personajes inventados solo en el prompt**: nombres fuera del pool (o pool vacío
   en formato que pide personaje) generan una descripción de apariencia que se inyecta
   en el `scene_prompt`, reusando el mismo texto en toda la campaña. No se crea nada
   en el Cast y no llevan imagen de referencia.
4. **Personaje principal explícito**: el primero seleccionado queda como principal
   (badge "Principal"), reasignable con un toque. Es el que usan las funciones de un
   solo personaje (`replace_character`, rotación de series) y va primero en el orden
   de referencias.
5. **Modelo de datos — enfoque A**: arrays nuevos + columna legacy sincronizada.
   Los formatos con presentador **dejan de bloquearse** cuando no hay Cast: se inventa.

## Diseño

### 1. Datos (migración nueva, sin tocar migraciones aplicadas)

- `campaigns.character_ids uuid[] not null default '{}'` — pool de la campaña, orden
  significativo: el primero es el principal. Máx 3, validado en server action (no en DB).
- `campaign_items.character_ids uuid[] not null default '{}'` — personajes del creativo,
  orden = orden de referencias en el prompt. Backfill desde `character_id`.
- `campaign_items.character_id` se mantiene como **personaje principal** (= primer
  elemento del array), sincronizado en cada escritura. `replace_character`,
  `rotateCharacters` y la edición del detalle siguen operando sobre él sin cambios.

### 2. Schemas y server actions

- `CreateCampaignStudioSchema`: `characterIds: z.array(z.string().uuid()).max(3).default([])`.
  La action valida ownership (todos los ids del workspace) y persiste en `campaigns`.
- `CampaignItemSchema` / `AddCampaignItemSchema` / `UpdateCampaignItemSchema`: aceptan
  `characterIds` (máx 3); `characterId` se conserva por compat. Al escribir, la action
  sincroniza `character_id = characterIds[0] ?? characterId ?? null`.
- `generatePlanAction`: el pool del planner es `campaigns.character_ids` (resueltos a
  nombre + validación de imagen como hoy). Pool vacío ⇒ no se usa ningún personaje del
  Cast aunque exista: se inventa. El plan deja de filtrar formatos por
  `available.character`.

### 3. Matcher (Gemini)

- El prompt del matcher recibe el pool: `- id=<uuid> name=<nombre>: <descripción>`.
- Cada match devuelve además:
  - `characterIds`: ids del pool mencionados en la idea (saneo: subset del pool, máx 3,
    ids desconocidos se descartan como se hace con `formatId`).
  - `inventedCharacters`: `[{ name, description }]` para nombres mencionados que no
    están en el pool — descripción de apariencia en inglés, 1-2 frases, concreta
    (sin marcadores de edad, igual que `describeCharacter`).
- Normalización tolerante a variantes del modelo, siguiendo el patrón existente de
  `normalizeCustomFormat`.

### 4. Planner

- `DirectedIdea` gana `characterIds: string[]` e `invented: Array<{name, description}>`.
- Reglas de asignación por item:
  - Idea con menciones del pool → esos personajes, en ese orden (cap 3).
  - Sin mención y el formato requiere personaje → rota 1 personaje dentro del pool.
  - Nombre inventado o pool vacío con formato que pide personaje → se añade al
    `scene_prompt` la descripción inventada. El texto es **estable por campaña**:
    el mismo nombre inventado reusa la misma descripción en todos los items
    (coherencia razonable sin imagen).
- Plan sugerido (sin ideas): rota el pool; pool vacío usa una descripción genérica
  fija (constante en código) para los formatos con presentador.
- `formatFitsRefs` deja de exigir `character` (producto y empaque siguen igual).

### 5. Compiler Seedance y orquestador

- `DirectorContext.character` → `DirectorContext.characters` (array ≤ 3, orden del
  item). El singular se elimina y se actualizan los consumidores (compilers, inventory,
  tests); no hay datos persistidos con la forma vieja porque el contexto se construye
  al vuelo.
- `buildReferences` aplica el presupuesto de la tabla y nombra al personaje en cada
  línea: `@ImageN is <Nombre> — keep the exact appearance…`, para atar referencia y
  persona cuando hay varios.
- `describeCharacter` se emite por cada personaje del item.
- El orquestador (`loadCampaignContext`) carga master + `angle_image_ids` de cada
  personaje de `character_ids` (hoy solo carga el master del singular); el compiler
  recorta según presupuesto.

### 6. Wizard (UI)

- Nueva sección "Personajes" entre producto e ideas: grid de cards del Cast
  (thumbnail de hoja maestra con URL firmada como en `app/app/brand/cast/page.tsx`,
  nombre). Selección hasta 3; al llegar al tope el resto se deshabilita. El primero
  seleccionado muestra badge "Principal"; un control en cada card seleccionada permite
  reasignar el principal. Al seleccionar el tercero, aviso: la atención del modelo se
  reparte con 3+ sujetos.
- Texto corto explicando el funcionamiento: los personajes asignados pueden nombrarse
  en las ideas; nombres no asignados se inventan sin imagen de referencia.
- Componente nuevo reusable `ReferenceBudget` (nombre tentativo): strip con thumbnails
  del conjunto de referencias por video (hasta 3 de producto + masters elegidos) y
  contador "N/9 imágenes por video", recalculado con la regla de recorte. `aria-live`
  en el contador.
- Si el Cast está vacío, la nota actual ("el plan omite formatos con presentador")
  cambia a "los formatos con presentador usarán personajes inventados" + link a crear.

### 7. Refinado: referencias heredadas (fix del hallazgo 1)

- El panel "Tu creativo" muestra el conjunto real: referencias heredadas (producto del
  Brand Kit, empaque, personajes del item) vía `ReferenceBudget`, más las extra
  subidas en el chat (`reference_ids`), con el mismo contador N/9.
- "Toma: — pendiente —" pasa a "Toma: la decide el director según el formato" cuando
  es null (el planner no asigna shot; solo el refinado lo fija). Sin cambio funcional.
- La página del refinado carga las referencias heredadas en el server (campaña →
  brand kit + personajes del item) y las pasa a `RefineView`.

### 7b. Referencias extra del refinado llegan al modelo (bug encontrado al planificar)

`campaign_items.reference_ids` se escribe al aceptar el refinado pero **nadie lo lee**:
el orquestador no lo incluye en su select ni en el DirectorContext, así que esas
imágenes nunca llegan a la generación. Fix: el orquestador resuelve
`item.reference_ids` a storage paths y los pasa como `extraImagePaths` del contexto;
el compiler los emite como `@ImageN` con rol `environment`, al final de la prioridad
(producto > empaque > personaje > extra). El compiler además pasa a aplicar el tope
real de **9 imágenes** (hoy solo aplica el de 12 archivos), recortando desde el final
con warning.

### 8. Preview del prompt final (fix del hallazgo 2)

- En el detalle del creativo (CampaignDetailPage), acción "Ver prompt final": server
  action de solo lectura que compila en seco (mismo camino del orquestador:
  `loadCampaignContext` + `compileSeedance`) sin encolar ni cobrar, y devuelve el
  prompt CRAFT + la lista de referencias con su rol. Se muestra en un dialog
  de solo lectura con las advertencias del compiler.

### 9. Feedback al usuario

- El toast del plan lista los inventados: "Lucía no está en la campaña: se inventó su
  apariencia" (la action devuelve los nombres inventados).

### 10. Manejo de errores

- Ids de personaje fuera del workspace → `validation_error` en la action.
- Matcher caído: igual que hoy (fallback a mix con aviso); la asignación por mención
  simplemente no ocurre y aplica la rotación del pool.
- Personaje del pool borrado del Cast entre crear y re-planificar: se filtra
  silenciosamente del pool al generar el plan (mismo criterio del filtro actual de
  personajes sin imagen).

### 11. Tests (sin APIs reales)

- Planner: asignación por mención, rotación restringida al pool, invención con
  descripción estable, formatos con presentador ya no se bloquean sin Cast.
- Matcher: saneo de `characterIds` (ids inventados fuera), parsing de
  `inventedCharacters`, tolerancia a variantes.
- Compiler: presupuesto 1/2/3 personajes, orden y nombres en las líneas `@`,
  tope de 9 imágenes nunca excedido.
- Schemas: máx 3, sincronización characterId/characterIds en actions.

## Fuera de alcance (pendientes explícitos)

- Editar multi-personaje desde el detalle de campaña (la edición sigue operando sobre
  el principal).
- Variantes `replace_character` y series `rotateCharacters` con multi-personaje.
- Spec del producto (`docs/zyra-studio-spec.md` / `specs/v2/`): actualizar la sección
  de campañas con el pool de personajes al implementar (regla: nombres de columnas
  nuevos van al spec en paralelo).
