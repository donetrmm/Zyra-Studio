# Diseño: producto como OBJETO vs su contenido IMPRESO

Fecha: 2026-06-30
Estado: aprobado (pendiente de plan de implementación)

## Problema

Para productos que son "un objeto físico que muestra una imagen impresa" (un
canvas, una taza, una playera, un póster), el generador de brief describe **lo
que está impreso**, no **el objeto**.

Caso real ("Anuncio #11.3"): el producto es un **canvas** (cuadro) con una **foto
familiar de fiesta**. El `product_brief` quedó como `productName: "Celebration
Party Decor"` y `visualDetails` describiendo "party decorations, string lights,
paper banners, pom-poms". El compilador entonces inyecta `Product: Celebration
Party Decor, ...party decorations...` y el modelo pinta decoración de fiesta. El
canvas (y su grosor delgado) **no puede aparecer porque en ningún lado del prompt
se dice que el producto es un canvas**. Los refinados del usuario ("canvas ultra
delgado 1cm") pelean contra esa descripción base.

### Causa raíz y su límite

El generador (`lib/campaigns/brief.ts → analyzeProductBrief`) recibe **solo la
imagen del producto** + un SYSTEM que pide "describe el producto/empaque". Cuando
la imagen es **solo el arte impreso** (la foto), el modelo describe la foto.

Límite fundamental: con una foto que es solo el arte plano, **la IA no puede
inferir que es un canvas** (no ve el objeto ni el canto). Igual que el tamaño
(`heightCm/widthCm`, que la IA NO infiere y provee el usuario), el **tipo de
objeto/soporte** y el **grosor** deben venir del usuario. Mejorar el prompt solo
ayuda cuando el objeto físico SÍ es visible en la foto.

## Decisión

Anclar el objeto por **dato declarado por el usuario** (no inferido), y que la
descripción del producto **separe el objeto de su contenido impreso**. Tres piezas:

1. **Campos declarados por el usuario** (`medium`, `thicknessMm`) — el ancla.
2. **`describeProduct` compone objeto-vs-impreso** (global: video y panel).
3. **SYSTEM del brief mejorado** (conservador) — complemento para el caso en que
   el objeto SÍ es visible.

## Modelo de datos — sin migración

`product_brief` es jsonb en `campaigns` (mig. 020). Se extiende
`ProductBriefSchema` (`lib/campaigns/brief.ts`) con campos **opcionales**:

- `medium: z.string().max(120).optional()` — tipo de objeto/soporte, texto libre
  (ej. "canvas print", "ceramic mug", "cotton t-shirt"). Texto libre, no enum:
  los productos son demasiado diversos.
- `thicknessMm: z.number().positive().max(500).optional()` — grosor del canto
  (ej. 10). Cap 500 mm para typos.

Conviven con `heightCm/widthCm`. Sin migración SQL, sin cambios de RLS. Ausentes =
comportamiento actual idéntico (cero regresión).

## `describeProduct` — composición objeto-vs-impreso (global: video Y panel)

`describeProduct` (`lib/prompt-director/inventory.ts`) se usa en el compilador de
**video** (vía `directorContextFor` → `ProductInventory`) y en los de **panel**.
Por eso la corrección vive aquí: llega a las dos etapas.

Cuando `product.medium` está presente, en vez de `Product: {name}, {visualDetails}`
emite (ASCII, una sola descripción):

> Product: a **{medium}** that displays this printed image: {visualDetails}.
> The product itself is the physical **{medium}**; the depicted content is only
> printed on its surface, not separate physical objects.
> [si thicknessMm: It is about {thicknessMm} mm thin at the edge; do not render a
> thick block frame or a deep gallery-wrap, keep the edge slim.]

Más la cláusula de fidelidad existente (referencia/atributos declarados).

Cuando `medium` está **ausente**: salida **idéntica** a hoy. La paleta sigue como
"brand colors" (o "printed colors" cuando hay medium — detalle a fijar en el plan,
sin cambiar el comportamiento sin medium).

El grosor va en `describeProduct` (no en `describeProductScale`, que es panel-only)
para que el "canvas delgado" llegue también al **video**.

## SYSTEM del brief — mejora conservadora (complemento)

En `lib/campaigns/brief.ts`, el SYSTEM (hoy un string inline) gana una instrucción:

> Si el producto es un OBJETO con una imagen impresa encima (canvas, taza,
> playera, póster, etc.), identifica el OBJETO y descríbelo aparte del contenido
> impreso: `productName` = el objeto (p.ej. "Canvas print"), no la escena impresa;
> en `visualDetails` describe primero el objeto (material, forma, acabado, borde)
> y luego lo que muestra impreso. NO declares el arte impreso como si fuera el
> producto.

**No** fuerza a adivinar un `medium` (si solo ve arte plano, no inventa "canvas").
Bajo riesgo para productos normales: una botella o un snack no tienen "contenido
impreso separado", así que se describen igual que hoy.

Para testear sin llamar al LLM, el SYSTEM se extrae a una constante/función pura
exportada y el test asserta que incluye la instrucción de separación.

## Plomería de tipos

`medium`/`thicknessMm` opcionales fluyen como `heightCm/widthCm`:

1. `ProductInventory` (`lib/prompt-director/types.ts`): `medium?`, `thicknessMm?`.
2. `CampaignContext` (`lib/campaigns/orchestrator.ts`): `productMedium?`,
   `productThicknessMm?`.
3. `loadCampaignContext`: leídos de `product_brief`.
4. `directorContextFor`: mapeados al `ProductInventory` del `DirectorContext`.

## UI de captura

Extender `ProductSizeEditor` (`components/campaigns/ProductSizeEditor.tsx`) y
renombrar la tarjeta a **"Producto físico"**: además de alto/ancho, agrega:

- Input de texto **"Tipo de producto / soporte"** → `medium`.
- Input numérico **"Grosor (mm)"** → `thicknessMm`.

`setProductDimensionsAction` (`server-actions/campaigns.ts`) se extiende para
guardar también `medium` (string, vacío = quitar) y `thicknessMm` (null = quitar).
Mismo patrón de read-modify-write del jsonb, ownership, schema local sin export.

La página (`page.tsx` / `CampaignStudioView`) pasa los valores iniciales (mismo
camino que `productHeightCm/productWidthCm`).

## Tests (sin red)

- `describeProduct`: con `medium` separa objeto/impreso ("displays this printed
  image", "the product itself is the physical {medium}"); con `thicknessMm` añade
  la cláusula de grosor; sin `medium`/`thickness`, salida **idéntica** (regresión).
- `ProductBriefSchema`: acepta `medium`/`thicknessMm` válidos, rechaza
  `thicknessMm <= 0` y `> 500`, tolera ausencia.
- SYSTEM del brief: el string del prompt incluye la instrucción de separación
  objeto/impreso (helper PURO, sin llamar a Gemini).

## Fuera de alcance

- Que la IA infiera `medium` o `thicknessMm` de forma confiable (lo provee el
  usuario; la IA solo mejora `visualDetails` cuando el objeto es visible).
- Rehacer la referencia visual del producto (subir una foto con el canto a la
  vista sigue siendo una mejora manual aparte; el texto ancla el grosor pero una
  referencia con el borde visible es lo que de verdad lo enseña).
- Detección/recorte consciente del sujeto.

## Riesgos / notas

- Sin `medium`, todo el comportamiento queda idéntico (los campos son opt-in).
- El grosor es un ancla de texto, no garantía: si la referencia es solo el arte
  plano, el modelo puede seguir engrosando; la referencia con el canto a la vista
  es el refuerzo físico (fuera de alcance).
- Campañas existentes (incl. el parche manual de "Anuncio #11.3") no se ven
  afectadas hasta que el usuario fije `medium`/`thickness` y regenere FRESCO.
- `describeProduct` es de uso global: el caso sin `medium` debe quedar
  byte-idéntico para no alterar videos/paneles existentes.
