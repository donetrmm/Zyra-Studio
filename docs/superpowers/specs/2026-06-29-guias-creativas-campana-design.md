# Diseño: guías creativas por campaña

Fecha: 2026-06-29
Estado: aprobado (pendiente de plan de implementación)

## Problema

Feedback de revisión del video de "Anuncio #11" pidió correcciones de
encuadre/distribución que NO aplican a todos los anuncios:

1. Mostrar el producto completo la mayor parte del tiempo.
2. En el hook, ver el producto al 100% (héroe).
3. Cuidar que la toma se pueda recortar a 4:5.

Estas son **guías creativas específicas de un tipo de anuncio** (product-hero),
no constantes universales. Meterlas como directivas globales del compilador o del
planner haría que **todos** los videos las hereden — incluyendo lifestyle,
testimoniales o formatos donde no aplican. El objetivo es un mecanismo donde cada
guía sea un **opt-in por campaña, scoped y predecible**: apagada, no hace nada.

### Qué NO entra aquí (correcciones de otro alcance)

- **Acento mexicano** (el audio sonaba peninsular): es una **constante de marca**,
  ya global en `DIALOGUE_LANGUAGE.es`. Se refuerza por separado, no es guía por
  campaña.
- **Grosor del cuadro (9 mm)**: es un **hecho del producto**; vive en
  `product_brief` (o en la referencia del producto), por campaña ya. Aparte.

## Contexto de arquitectura (cómo se autora hoy el encuadre)

- **El planner es determinista y puro** (`lib/campaigns/planner.ts`): ensambla
  items con semillas, no "decide" creatividad.
- El **encuadre** se autora en dos lugares:
  - **Matcher LLM** (`lib/prompt-director/format-matcher.ts → matchIdeas`) cuando
    el usuario da ideas: traduce la idea a `scenePrompt`.
  - **Semillas** (`CONCEPT_SEEDS` en `planner.ts`) cuando no hay idea: plantillas
    que ya dictan encuadre ("label facing the camera", "takes the center").
- Los compiladores (`compilers/seedance.ts` para video; `flux.ts`/`nano-banana.ts`
  para paneles de storyboard) ensamblan el prompt final de forma determinista.
- `product_brief` (jsonb en `campaigns`) ya fluye:
  `loadCampaignContext` → `CampaignContext` → `directorContextFor` →
  `DirectorContext`/`ProductInventory` → compiladores.

## Decisión

Guías **estructuradas** (no texto libre), por campaña, con dos capas de aplicación:

- **Compilador = backbone determinista.** Cubre TODOS los caminos (ideas,
  semillas; panel y video) con cláusulas gateadas por flag.
- **Matcher = capa inteligente.** Evita que se autore mal el encuadre desde el
  principio (idea-driven).

Texto libre se descartó: no es determinista, no se puede aplicar en el compilador,
y reintroduce la imprevisibilidad que el opt-in busca evitar.

## Modelo de datos — con migración

`creative_guidelines` jsonb en `campaigns`:

```sql
alter table campaigns
  add column creative_guidelines jsonb not null default '{}'::jsonb;
```

- Se aplica vía MCP **antes** de pushear el código que la lee (regla de orden
  migración→deploy: prod no auto-aplica; leer columna inexistente = 500).
- **Columna nueva, no se reusa `product_brief`:** (a) las guías son dirección
  creativa, no hechos del producto; (b) `product_brief` puede ser `null` (guard
  `.not('product_brief','is',null)`), y una guía no debe depender de que exista
  un brief.
- Sin cambios de RLS (hereda las policies de `campaigns`).

Zod `CreativeGuidelinesSchema` (nuevo `lib/campaigns/guidelines.ts`):

```ts
export const CreativeGuidelinesSchema = z.object({
  showFullProduct: z.boolean().optional(),
  hookProductHero: z.boolean().optional(),
  safeCrop: z.union([z.literal('4:5'), z.null()]).optional(),
});
export type CreativeGuidelines = z.infer<typeof CreativeGuidelinesSchema>;
```

Todo opcional; ausente = apagado. `safeCrop` admite `'4:5'` o `null` (sin recorte).

## Semántica e inyección por flag

Todas las cláusulas: **ASCII**, empiezan con espacio (concatenables), gateadas por
el flag (apagado = no se emite nada).

### `showFullProduct`

- **Matcher (primario):** línea condicional en el prompt de `matchIdeas`:
  "prioriza encuadres que revelen el producto completo; evita close-ups extremos
  que lo recorten, salvo una toma de detalle deliberada."
- **Compilador (refuerzo suave):**
  ` When the product is on screen, frame it complete and unobstructed; avoid crops that cut off the product, unless the beat is a deliberate detail shot.`

El peso real va en el matcher (autoría); la cláusula del compilador es suave y
condicional para no romper beats de detalle deliberados, y para cubrir el camino
de semillas (sin idea).

### `hookProductHero`

Determinista, pero requiere **plomería nueva**: hoy ni `DirectorContext` ni
`CompileRequest` cargan `sceneIndex` ni señal de apertura. Se agrega
`isOpeningBeat?: boolean` a `CompileRequest`, que el llamador setea cuando el beat
es la apertura del creativo: `scene_index === 0` en secuencias, o un clip único
(`sequence_id`/`scene_index` nulos). El llamador (server action de panel y
orquestador de video) ya conoce `scene_index`.

- **Compilador, SOLO si `req.isOpeningBeat`:**
  ` This is the opening hook: present the full product as the clear hero of the frame, shown large and complete from the first beat.`
- **Matcher:** refuerza que el primer beat sea producto-héroe.

### `safeCrop: '4:5'`

Composición pura → solo compilador (video + panel). No requiere autoría del matcher.

- **Compilador (seedance) + panel (flux/nano-banana):**
  ` Crop-safe framing: keep all key elements (the product and any faces) within the central 4:5 area of the vertical frame; place nothing essential in the extreme top or bottom, so the shot can be cropped to 4:5 without losing key content.`
- Sigue saliendo el `aspectRatio` de la campaña (9:16); esto solo gobierna la
  composición para que sea recortable.

## Plomería de tipos

`CreativeGuidelines` opcional fluye por:

1. `CampaignContext` (`lib/campaigns/orchestrator.ts`): nuevo campo `guidelines?`.
2. `loadCampaignContext`: lee `creative_guidelines` de la fila de campaña.
3. `DirectorContext` (compiladores): nuevo campo `guidelines?: CreativeGuidelines`,
   poblado por `directorContextFor`. Además `CompileRequest` gana
   `isOpeningBeat?: boolean` (para `hookProductHero`), seteado por el llamador que
   conoce `scene_index`.
4. `matchIdeas` (`format-matcher.ts`): recibe `guidelines` vía la server action
   del plan (`generatePlanAction` en `server-actions/campaigns.ts`), que ya carga
   la campaña. Ver "Timing".

## Timing: cuándo aplica cada capa

El matcher corre al **generar el plan** (creación de campaña). El editor de guías
vive en la **página de campaña** (post-creación). Consecuencia:

- **Compilador = mecanismo primario y suficiente para el caso real.** Aplica al
  **regenerar** panel/video, que es cuando las guías ya están prendidas. Arregla
  campañas existentes como "Anuncio #11" sin re-planear.
- **Matcher = mejora, gateada por timing.** Solo influye si las guías existen al
  momento de generar el plan: es decir, en una **re-generación del plan**, o si en
  el futuro se exponen las guías en el wizard de creación (follow-up, fuera de v1).
  En la primera creación de una campaña nueva con el editor solo en la página, el
  matcher aún no las ve.

El plan de implementación secuencia el compilador + UI primero (valor real) y el
matcher después, como tarea independiente.

## UI de captura

`CreativeGuidelinesEditor` (cliente), junto al `ProductSizeEditor` en la página de
campaña (`CampaignStudioView`):

- Switch "Mostrar el producto completo" → `showFullProduct`.
- Switch "Hook con el producto al 100%" → `hookProductHero`.
- Select "Recorte seguro" (Ninguno / 4:5) → `safeCrop`.
- Guarda con `setCreativeGuidelinesAction({ id, showFullProduct?, hookProductHero?, safeCrop? })`:
  zod + ownership por workspace + read-modify-write del jsonb. Default todo apagado.

## Tests (sin red)

- **Schema:** acepta flags, rechaza `safeCrop` inválido, tolera ausencia (todo
  apagado, cero cambio).
- **Compilador:** cada flag on → su cláusula presente en el prompt; off → ausente;
  `hookProductHero` dispara SOLO en `sceneIndex === 0` (no en otros beats).
- **Matcher:** NO se llama al LLM. Se extrae el armado del prompt de `matchIdeas`
  a un helper puro y se asserta que, con la guía on, su texto queda incluido; off,
  ausente.
- **`setCreativeGuidelinesAction`:** validación y ownership (zod rechaza payload
  inválido; sin ownership no actualiza).

## Fuera de alcance

- Inferencia por IA de las guías (las prende el usuario, explícito).
- Flags nuevos más allá de los tres.
- Locale por campaña para el acento (sigue global).
- Grosor del producto (sigue en `product_brief`).

## Riesgos / notas

- `showFullProduct` en el compilador podría chocar con un beat de detalle
  deliberado → cláusula suave y condicional; el peso va en el matcher.
- Campañas existentes quedan en `'{}'` = todo apagado = comportamiento idéntico.
  "Anuncio #11" requiere prender los flags + regenerar (panel y/o video).
- `safeCrop` es una pista de composición; el modelo puede no respetarla al 100%.
- Las cláusulas llegan tanto al panel como al video (ambos compilan), así que el
  feedback (que era sobre el video) queda cubierto en las dos etapas.
