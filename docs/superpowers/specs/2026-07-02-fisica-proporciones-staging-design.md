# Física de interacción, staging proporcional e integración de escena — Diseño

Fecha: 2026-07-02 · Estado: aprobado por el usuario (conversación 2026-07-02)

## Problema

1. **Staging desproporcionado**: el planner (matcher Gemini) no conoce el tamaño físico del producto. Para un cuadro de 150cm puede escribir "lo sostiene en la mano"; el ancla de escala del compiler (`describeProductScale`) hace realista ese staging equivocado, pero no puede corregirlo. El resultado: piezas grandes que se ven chicas respecto al personaje o fuera del safe crop.
2. **Peso ignorado**: no existe el dato de peso. Un producto de 25kg se anima/describe como si no pesara (lo mueven "súper fácil").
3. **Personaje pegado**: al componer personaje + locación no hay cláusula de integración; la hoja maestra (luz de estudio, fondo liso) se "pega" en la locación con luz y sombras incoherentes — efecto photoshop.

## Decisiones de producto (del usuario)

- **Staging = preferencia con excepción**, no regla dura: por default las piezas grandes NO van en manos, pero si la idea/formato pide cargarla o entregarla explícitamente, se permite (y el ancla de escala/peso lo hace realista).
- **Sin lista fija de soportes**: cada objeto reposa donde ese tipo de objeto vive naturalmente (un cuadro cuelga o va en soporte; una lámpara de pie va al suelo; un mueble se asienta). El planner decide por tipo (category/medium); los ejemplos son ilustrativos.
- **Peso declarado por el usuario** (`weightKg`), opcional, junto al tamaño físico. No se auto-detecta de la imagen.

## Diseño

Enfoque planner-first (arreglar el generador, no la salida) + complemento determinista en compilers. Cero migraciones: `weightKg` vive en `campaigns.product_brief` (jsonb), mismo riel que `heightCm`.

### 1. Dato nuevo: `weightKg`

- `product_brief.weightKg` (número positivo, opcional), editable en `ProductSizeEditor` junto a alto/ancho/grosor (`setProductDimensionsAction` + su schema, patrón read-modify-write existente).
- Fluye: brief → `loadCampaignContext` (`CampaignContext.productWeightKg`) → `directorContextFor` → `ProductInventory.weightKg`.

### 2. Planner conoce el producto físico (`stagingPlannerBlock`)

Función determinista en `lib/prompt-director/inventory.ts` (comparte `ADULT_REF_CM` y bandas con `describeProductScale`). Genera un bloque EN ESPAÑOL para el SYSTEM del matcher, compuesto por:

- **Staging proporcional** (solo si hay tamaño y ratio ≥ 0.45 = banda "waist-high"+): por default el producto no va en manos; se coloca donde ese tipo de objeto reposa naturalmente (decidir por lo que ES el producto — ejemplos ilustrativos por tipo), personas al lado, plano suficientemente abierto para que la pieza completa se vea proporcional junto a ellas. Excepción explícita: cargar/entregar cuando la idea lo pide.
- **Física de peso** (solo si hay `weightKg` ≥ 2): bandas deterministas — 2-10kg agarre firme a dos manos; 10-30kg esfuerzo visible, postura, movimiento lento; >30kg no se carga casual (dos personas / arrastrar / no moverlo). El personaje interactúa acorde; nunca lo maneja como si no pesara, salvo que la idea pida explícitamente romper la física (escape para formatos como `mundo-imposible`).

Consumidores: `buildMatcherSystemPrompt` (vía `matchIdeas` input `product?`) y el asistente de refinado (`server-actions/refine.ts`, paridad — también autora scenePrompts).

### 3. Compilers

- **`describeProductScale`** gana, para ratio ≥ 0.45, la regla de encuadre/staging (EN): salvo que la escena muestre explícitamente cargar/mover/entregar, o el beat sea un close-up/detail shot deliberado (carve-out), la pieza aparece apoyada/colocada como ese tipo de objeto reposa naturalmente, y el encuadre se abre (cámara atrás) para que quepa completa a escala real junto a las personas — nunca encoger la pieza. Esto reconcilia el safe crop: "grande" se logra alejando cámara, no rompiendo proporción. La dimensión DOMINANTE (max de alto/ancho, no solo heightCm) decide si la pieza es "grande" y qué escalera de proporción usar — una pieza ancha-y-baja (100×20cm) es grande por su ancho aunque su alto sea chico; en ese caso la escalera describe el lado más largo ("its longest side…") en vez del alto. La cláusula de staging acepta `opts.staging === false` para omitirse entera: el refinado sandwich (`compileRefinePrompt` en `lib/campaigns/storyboard.ts`) la desactiva porque preserva composición y una directiva activa de re-encuadre ahí causa drift — solo escala (proporción/tamaño) y peso entran a esa rama. La rama ENCADENADA (`server-actions/storyboard.ts`) sí mantiene el staging completo, porque re-encuadrar es su propósito.
- **`describeProductWeight`** (nueva, EN): cláusula de interacción por bandas de peso. Se inyecta donde ya viaja `describeProductScale` (panel fresco, encadenado, refinado sandwich) y en `compileSeedance` (video: donde el "lo mueve fácil" más se nota) junto a `describeProduct`.
- **Integración personaje↔locación** (nueva cláusula en `compileFlux`, espejo en `compileSeedance`), cuando hay personajes Y locación (imagen o descripción): las personas las ilumina la luz existente de la escena (dirección, temperatura, suavidad), proyectan sombras de contacto sobre lo que tocan, comparten perspectiva/profundidad de campo/color grade con el entorno; nada se ve recortado ni pegado. **Neutral al estilo** (aplica igual a animado). Solo generación fresca — NUNCA en ramas de edición (disciplina anti-drift documentada).

## Fuera de alcance

- V1 suelto (ImageGenerator), Veo/Kling (Seedance es el path activo).
- Auto-detección de peso desde imagen.
- Migraciones (jsonb existente).
- Reescritura del formato `mundo-imposible` (sus reglas de física propia se conservan).

## Criterios de éxito

- Un cuadro de 150cm en un plan nuevo aparece montado donde corresponde por tipo, proporcional al personaje y completo dentro del safe crop; solo va cargado si la idea lo pide.
- Con `weightKg: 25`, los scenePrompts y el video describen esfuerzo visible al moverlo.
- Panel con personaje + locación: luz/sombras/perspectiva coherentes con el entorno (sin efecto photoshop), en cualquier perfil de estilo.
- Comportamiento idéntico al actual cuando no hay tamaño ni peso declarados (opt-in por dato).
