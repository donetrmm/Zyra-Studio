# Diseño: ancla de escala del producto en el storyboard

Fecha: 2026-06-29
Estado: aprobado (pendiente de plan de implementación)

## Problema

En el storyboard de una campaña (ej. "Anuncio #11", un cuadro de 150 cm) el
**tamaño del producto sale inconsistente entre paneles**: el mismo cuadro aparece
a veces chico y a veces grande, y su **proporción contra el personaje** no se
mantiene. El objetivo es que el producto se vea (a) consistente de panel a panel y
(b) con una proporción que tenga sentido junto a una persona.

### Causa

Nada en el prompt del panel ancla el tamaño físico del producto ni su proporción
contra el personaje:

- `ProductInventory` (`lib/prompt-director/types.ts`) y `ProductBrief`
  (`lib/campaigns/brief.ts`) **no tienen ningún campo de dimensión física**. Los
  "150 cm" no tienen hogar estructurado.
- `describeProduct` (`lib/prompt-director/inventory.ts`) ancla apariencia, colores
  y proporciones *internas* del producto, pero nunca su **tamaño relativo a una
  persona**.
- El `scale_map` de P15 (rol `scale_map`) existe pero está **atado a la locación**
  y solo lo consume el compilador de Seedance (`compilers/seedance.ts`, ~L249):
  es **video-only**. Los compiladores del panel (`flux.ts`, `nano-banana.ts`) lo
  ignoran.

## Decisión

Anclar la escala por **texto determinista**: traducir el tamaño en cm a una
proporción verbal relativa a un adulto de pie, e inyectarla en el prompt del panel
fresco y en la re-ancla del panel encadenado.

Se eligió texto (no una referencia visual de escala) porque la cadena encadenada
de Nano Banana **descarta las imágenes de referencia** (`refSlots=0` en chat) — una
tarjeta de escala visual solo ayudaría al primer panel y no a la cadena. El texto
es lo único que sobrevive panel a panel, y encaja con el director determinista.

El tamaño es una **propiedad opcional del producto, condicional al tipo**: un cuadro
o un mueble lo tienen; un perfume o un servicio no. Por eso es opcional y, ausente,
no cambia el comportamiento.

## Modelo de datos — sin migración

`product_brief` es una columna **jsonb** en `campaigns` (migración 020), generada
por IA al crear la campaña y editable como objeto arbitrario. Por tanto:

- Extender `ProductBriefSchema` (`lib/campaigns/brief.ts`) con campos **opcionales**:
  - `heightCm?: number` — el tamaño que define la proporción (cuadro: 150).
  - `widthCm?: number` — opcional, enriquece la frase (orientación/aspecto).
  - Validación: `z.number().positive().min(1).max(2000).optional()` (el cap atrapa
    typos tipo "1500").
- **No** requiere migración SQL, ni cambios de RLS, ni tabla nueva.
- La IA del brief **no** infiere dimensiones (un tamaño físico no se deduce de una
  foto sin referencia — sería una instrucción muerta). El dato lo provee el usuario.

El dato vive **por campaña** (en `product_brief`), lo que encaja con que cada
campaña puede presentar un producto de distinto tamaño. No se usa `brand_kits`
(nivel marca, compartido, y ni siquiera guarda el nombre del producto).

## Helper de proporción (núcleo, puro y testeable)

Nuevo `describeProductScale(product: ProductInventory): string` en
`lib/prompt-director/inventory.ts`, junto a `describeProduct`. Devuelve `''` si no
hay dimensiones. Referencia: **adulto de pie = 170 cm** (`ADULT_REF_CM`).

`ratio = (heightCm ?? widthCm) / 170` → frase de proporción:

| ratio | frase ("… a/of a standing adult") |
|---|---|
| < 0.12 | small enough to hold in one hand |
| 0.12–0.25 | about knee-high on |
| 0.25–0.45 | about thigh-to-waist high on |
| 0.45–0.60 | about waist-to-chest high on |
| 0.60–0.80 | reaching the chest-to-shoulders of |
| 0.80–0.95 | nearly shoulder-to-head height of |
| 0.95–1.10 | about as tall as |
| > 1.10 | taller than |

Ejemplo (150 cm → ratio 0.88):

> The product is a physical piece, ≈150 cm tall — nearly shoulder-to-head height
> of a standing adult. Render it at this real-world scale relative to the people,
> and keep that size consistent in every shot; do not shrink or enlarge it between
> shots.

Asume el producto **mostrado vertical** (válido para cuadros en pared/caballete).
La cláusula es de **escala/proporción**, no de identidad, así que no arrastra el
riesgo de re-render que tienen las cláusulas de personaje. Empieza con espacio
(lista para concatenar), como `chainedProductFidelity`/`chainedCharacterFidelity`.

## Puntos de inyección — solo storyboard, sin tocar video

Todo en `lib/campaigns/storyboard.ts` y `server-actions/storyboard.ts`
(`generatePanelAction`), reusando los puntos donde ya viven
`chainedProductFidelity`/`chainedCharacterFidelity`:

- **Panel fresco (escena 1):** añadir `describeProductScale(dirCtx.product)` al
  prompt del panel.
- **Panel encadenado (2+):** añadir la cláusula junto a `chainedProductFidelity`
  (texto, lo único que sobrevive la cadena). La frase "keep that size constant… do
  not shrink/enlarge between shots" es la que ataca la inconsistencia.
- **Refinar (incluido):** misma cláusula en el prompt del refine para que no
  reescale al editar.

**No** se toca `describeProduct` (uso global) ni `compilers/seedance.ts`, así que el
**video queda intacto** (fuera de alcance por ahora).

## Plomería de tipos

`heightCm/widthCm` opcionales fluyen por:

1. `ProductInventory` (`lib/prompt-director/types.ts`).
2. `CampaignContext` (`lib/campaigns/orchestrator.ts`, ~L100): `productHeightCm?`,
   `productWidthCm?`.
3. `loadCampaignContext` (orchestrator, ~L221): leídos desde `product_brief`.
4. `directorContextFor` (orchestrator, ~L345): mapeados a `ProductInventory`.

## UI de captura

Dos inputs numéricos opcionales **"Tamaño del producto (opcional) — alto / ancho
cm"** + un server action que hace patch a `product_brief.heightCm/widthCm`
(validado con el schema extendido, ownership por workspace, guard
`.not('product_brief','is',null)` como las otras ediciones de campaña studio).

Para poder probar de inmediato, se prioriza un editor en la **página de la campaña**
que parchea `product_brief`. (Alternativa: el paso de revisión del brief al crear la
campaña; se decide en el plan.)

## Tests (sin red)

- `describeProductScale`: cada bucket (incl. 150 → shoulder/head), solo-alto,
  alto+ancho, vacío sin dims, "constant in every shot" presente.
- `chainedProductFidelity` (o el ensamblado encadenado) con dims: incluye la
  cláusula de tamaño.
- `ProductBriefSchema`: acepta dims opcionales, rechaza ≤0 y > 2000, tolera
  ausencia (cero cambio).

## Fuera de alcance

- Inferencia de dimensiones por IA.
- Video (Seedance) y el `scale_map` P15 de locación.
- La opción visual (tarjeta de escala como referencia `scale_map` de producto).
- Estatura por personaje (se asume adulto 170 cm; los personajes son age-blind y
  sin estatura en el modelo).

## Riesgos / notas

- El texto no clava centímetros exactos; la proporción verbal es el ancla práctica.
- Si un cuadro es claramente landscape (ancho ≫ alto) y se muestra acostado, la
  proporción vertical desde `heightCm` podría leerse distinto; se asume display
  vertical. Aceptable para la línea de producto (cuadros).
