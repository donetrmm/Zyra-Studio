# Fase D — Consistencia y plantillas vivas

> **~2 días · ~15 horas**
>
> La columna vertebral de marca: Brand Kit y Cast inyectados como referencias en cada
> generación, y la destilación de creativos ganadores en plantillas reutilizables — el
> diferenciador de V2 (doc V2 §3 y §4.2/4.4).

## Pre-requisitos

- Fase C cerrada (campañas generando con Seedance).
- Buckets `brand-assets` y `references` operativos (V1).

## Objetivo

Al cerrar la fase:
1. Toda generación de campaña lleva automáticamente las referencias del Brand Kit y del Cast
   que su formato exige, con rol y alcance explícitos.
2. Un creativo aprobado puede destilarse en plantilla viva y regenerar una serie (mismo
   esqueleto, producto/escena/personaje rotados).

## Tareas en orden

### 1. Brand Kit V2 — UI y carga (3h)

Extender la pantalla existente de Brand Kit:

- Sección **Producto**: subir 2-4 ángulos (frontal, perfil, detalle de textura, detalle de
  logo) → `product_image_ids`. Guía inline: fondo simple, luz que muestre volumen (criterios
  de calidad de referencia de la guía Morphic §9 — validar resolución mínima al subir).
- Sección **Empaque**: `packaging_image_ids` (para El Descubrimiento).
- Estas imágenes viven en `brand-assets` y se registran en `media_references` (tabla V1).

### 2. Cast V2 — hoja maestra (2.5h)

Extender la pantalla de personajes (characters V1):

- Designar **hoja maestra** (`master_image_id`): frontal, expresión neutra, buena luz — con
  validación de que existe antes de usar el personaje en una campaña.
- **Paquete de ángulos** (`angle_image_ids`): perfil y 3/4 opcionales.
- Generador asistido: crear el personaje desde cero con FLUX (prompt del Prompt Director:
  retrato frontal neutro, luz pareja) y fijarlo como hoja maestra — así el Cast no depende
  de fotos reales (límite anti-deepfake de Seedance: no rostros de personas reales).

### 3. Inyección automática de referencias (3h)

En `promptDirector.compile()` (extensión de Fase B):

- Leer `formats.required_refs` del formato del item → resolver contra Brand Kit y Cast del
  workspace → adjuntar a `references[]` con rol y alcance:
  - producto: "fidelidad absoluta de @Image N: mismo empaque, color, logo, proporciones";
  - personaje: hoja maestra siempre + "apariencia exacta de @Image M" (las variaciones de
    ropa/expresión van en texto);
  - empaque: solo para formatos que lo exigen.
- Si falta una referencia obligatoria → el validador bloquea el item con mensaje accionable
  ("Este formato necesita la hoja maestra del personaje").
- Respetar el tope de 12 archivos: prioridad producto > personaje > entorno > cámara > audio;
  si se excede, recortar desde abajo y dejar warning.

### 4. Destilación de plantillas vivas (4h)

`lib/campaigns/distill.ts` + UI:

- En la librería, acción **"Convertir en plantilla"** sobre cualquier generación aprobada de
  campaña:
  1. Crea `creative_templates` row: `source_generation_id`, `fixed_params` (model_slug,
     duración, ratio, tier, seed, estilo extraído del prompt original), `slots` (producto,
     variante, escena, personaje detectados en el prompt original).
  2. El video ganador queda como **referencia de estructura**: en generaciones futuras se
     adjunta como `@Video 1` con rol `camera_motion` + instrucción "replica estructura,
     movimientos de cámara, ritmo y color grading de @Video 1; sustituye el producto por
     @Image 1" (técnica de plantilla replicable, guía Morphic §7.6).
- **Generar serie desde plantilla**: acción que crea N `campaign_items` nuevos rotando los
  slots (variantes del producto × escenas) con todo lo demás fijo. Pasa por el mismo flujo
  de lote/compuertas de Fase C.

### 5. Variantes y ediciones dirigidas (1.5h)

Sobre un item final aprobado, acciones rápidas (menú del card):

- **Cambiar personaje**: edición de video Seedance — "reemplaza al sujeto por la persona de
  @Image 1; acciones, escenario y cámara sin cambios" (variante regional / nuevo embajador).
- **Extender**: +5-8 s con la acción de continuación descrita (duración de salida = la
  extensión, no el total — regla de las guías).
- Ambas son generaciones normales (cola V1) ligadas al item original.

### 6. Tests (1h)

- Inyección: formato con required_refs completo / incompleto / excedido (recorte por
  prioridad).
- Destilación: snapshot de `fixed_params`/`slots` desde una generación fixture; serie de 4
  items con slots rotados sin repetición.

## Criterio de cierre

- Una campaña con Brand Kit y Cast completos genera items cuyas referencias llegan al adapter
  con rol y alcance correctos (verificable en el payload del job).
- Smoke test real (usuario): destilar un clip ganador y generar una serie de 3 con variante
  de producto rotada — la estructura visual se conserva.
- `pnpm typecheck` y tests verdes.
