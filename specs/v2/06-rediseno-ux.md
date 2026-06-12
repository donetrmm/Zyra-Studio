# V2 — Rediseño UX: curva de aprendizaje mínima

> Design brief producido con /shape (2026-06-11) a partir del critique de diseño
> (score 25/40), `ZyraStudioV2/OBJETIVO.md` y `.impeccable.md`. Gobierna las
> fases de implementación del rediseño; no escribe código.
> Decisiones del usuario: Brand Kit implícito en el wizard · consolidación
> fuerte del sidebar · dashboard acción-primero · creación rápida subordinada ·
> carpetas V1 absorbidas en Biblioteca · landing solo rebrand + 2 fixes.

## 1. Resumen

Rediseño de la capa de experiencia del app autenticado para que el Campaign
Studio sea **el** camino y todo lo demás se subordine a él. Una sola noción de
"campaña", navegación de ~7 ítems, dashboard orientado a la siguiente acción y
un camino a la primera campaña sin walls de conceptos previos. No toca la
maquinaria de generación (adapters, worker, créditos); toca navegación,
dashboard, lista de campañas, wizard, Biblioteca y microcopy.

## 2. Acción primaria

Desde cualquier punto del app, el usuario sabe cuál es su **siguiente
compuerta** y puede ejecutarla en un click. Para el usuario nuevo: crear su
primera campaña subiendo solo fotos de su producto — sin saber qué es un Brand
Kit, un Cast ni un formato.

## 3. Dirección de diseño

La de `.impeccable.md`: minimalista premium, dark zinc-950, acento `#009fff`
(`#0072e6` con texto blanco). El rediseño expresa "el sistema sabe lo que hace"
con tres reglas operativas:

1. **Una decisión por pantalla** — lo demás son defaults visibles y editables.
2. **Jerga cero** — vocabulario de marketing en español; los nombres de modelos
   y parámetros técnicos no aparecen en el camino principal.
3. **El estado enseña** — cada empty state y cada compuerta explican el sistema
   en una línea, en el punto de uso, nunca en un tour aparte.

## 4. Estrategia de layout

### 4.1 Sidebar (13 ítems → 7)

```
INICIO            /app                  dashboard de siguiente acción
CAMPAÑAS          /app/campaigns        el producto principal
CREACIÓN RÁPIDA   /app/create           un ítem; imagen/video/audio son tabs internos
BIBLIOTECA        /app/library          todo lo generado + Colecciones (ex-carpetas V1)
MARCA             /app/brand            Brand Kits · Cast · Voces · Referencias (tabs)
FORMATOS          /app/formats          los 9 formatos del sistema + plantillas vivas
CRÉDITOS          /app/billing          renombrado desde "Billing"
```

- Sin títulos de sección o con dos máximo ("Trabajo" / "Activos"); el orden ya
  comunica jerarquía: Campañas va antes que Creación rápida.
- "Presets" deja de ser ítem: vive dentro de Creación rápida (son
  configuraciones de generación, no activos de marca).
- "Voces" se vuelve tab de Marca (la voz clonada es un activo de marca).
- Plantillas vivas se exhiben en Formatos junto a los 9 del sistema — hoy están
  enterradas en un tab por campaña; son el activo acumulable del usuario y
  merecen un lugar global.
- Mobile bottom nav (5): Inicio · Campañas · Crear · Biblioteca · Créditos.

### 4.2 Dashboard: acción primero, métricas detrás

- **Hero**: la campaña activa con su pipeline visual
  (`Plan → Muestra → Lote → Entrega`) y un solo CTA contextual: "Aprueba la
  muestra de Voz Cercana", "Lanza el lote completo", "Marca tus ganadores".
  Con varias campañas activas, la más cercana a una compuerta gana el hero;
  las demás, lista compacta debajo.
- **Usuario nuevo**: el hero es el arranque de la primera campaña en 3 pasos
  ilustrados (1. Sube tu producto → 2. Revisa el plan → 3. Aprueba la muestra)
  con un solo botón. No es un tour: es el wizard mismo.
- **Banda secundaria**: actividad reciente (últimas generaciones, thumbnails) y
  créditos en una línea. Las 3 metric cards actuales desaparecen — el saldo ya
  vive en el topbar.

### 4.3 Campañas: una sola entidad

- La lista muestra **solo campañas studio**, cards con estado de pipeline y
  siguiente acción en la card misma (no hay que entrar para saber qué sigue).
- El botón "Carpeta" desaparece. Las carpetas V1 existentes se renombran
  **Colecciones** y viven como tab/filtro dentro de Biblioteca; siguen
  agrupando generaciones sueltas. "Campaña" queda reservado al pipeline.
- La vista de campaña conserva sus 4 tabs, pero "Plantillas" apunta al catálogo
  global de Formatos filtrado por campaña.

### 4.4 Wizard: Brand Kit implícito

- El paso "Brand Kit" se reemplaza por **"Tu producto"**: dropzone de 1-6
  imágenes (frontal, perfil, detalle…) + URL opcional. Al crear la campaña, el
  sistema crea o actualiza un Brand Kit tras bambalinas con el nombre del
  producto detectado.
- Si ya existen Brand Kits, el dropzone ofrece "usar uno existente" como
  alternativa secundaria — nunca como requisito previo.
- El aviso de Cast se vuelve accionable en el mismo wizard: "Sin presentador:
  el plan omite Voz Cercana y A Pie de Calle · [Crear presentador] [Continuar
  así]" — decisión inline, no navegación a otra sección.
- El wizard adopta componentes shadcn (hoy usa inputs crudos; el resto del app
  usa shadcn — un solo lenguaje de formulario).
- **Sin selector de volumen** (decisión 2026-06-12): el plan se construye de
  "Describe lo que imaginas" — el format matcher decide formato y cantidad por
  idea (detalle en specs/v2/07). Si el campo va vacío, un paso intermedio
  pregunta: describir ideas o aceptar un plan sugerido de 6 creativos.

### 4.5 Creación rápida subordinada

- `/app/create` único con switch interno imagen/video/audio.
- Presentada como herramienta secundaria ("Creación rápida") para explorar o
  generar un asset suelto; todo cae en Biblioteca y puede adjuntarse a una
  colección.
- La simplificación interna del panel (Auto único visible, "Avanzado"
  colapsado, intenciones en vez de megapíxeles) se ejecuta con /distill sobre
  este brief.

## 5. Estados clave

| Superficie | Estado | Qué ve / siente el usuario |
|---|---|---|
| Dashboard | nuevo (0 campañas) | Hero de primera campaña en 3 pasos; cero métricas vacías |
| Dashboard | campaña esperando compuerta | CTA contextual con el nombre del formato; sensación de control |
| Dashboard | todo entregado | Reporte de valor de la última campaña + CTA nueva campaña |
| Campañas | vacío | Igual que dashboard nuevo (mismo CTA, no texto muerto) |
| Campañas | lote generando | Card con progreso vivo (Realtime existente) |
| Wizard | analizando producto | Estados "Analizando producto… / Armando plan…" (existentes, se conservan) |
| Wizard | URL inválida / análisis falla | Error inline accionable, el formulario no se pierde |
| Biblioteca | colecciones (ex-carpetas) | Tab "Colecciones"; nota una sola vez: "Tus carpetas ahora viven aquí" |
| Global | sin créditos | Toast existente con CTA a Créditos (se conserva) |
| Item de campaña | falló | Estado + reembolso visible + reintentar (se conserva) |

## 6. Modelo de interacción

- **Compuertas como CTAs contextuales**: el mismo verbo en dashboard, card de
  campaña y vista de campaña ("Aprueba la muestra"). Un concepto, tres lugares.
- **Wizard single-scroll** con un solo submit; el Brand Kit implícito sube
  imágenes en el mismo flujo (upload-first existente).
- **Cards de campaña** clicables completas, con la siguiente acción como botón
  primario y el resto (CSV, reporte) detrás de la entrada a la campaña.
- Sin modales nuevos: las decisiones inline (Cast en el wizard) usan disclosure
  en el flujo, no diálogos. Excepción acordada (2026-06-12): el paso intermedio
  cuando "Describe lo que imaginas" va vacío es un diálogo — es una bifurcación
  explícita pedida por el usuario, no una decisión inline.

## 7. Contenido y microcopy

- **Glosario único en español** (aplicar en navegación, tablas, toasts,
  estados): Biblioteca (no Library), Créditos (no Billing), borrador (no
  draft), versión final (no render final), creativo (no item), Colección (no
  carpeta), Creación rápida.
- **Formatos**: micro-descripción de una línea para cada uno de los 9, visible
  en tooltip/subtítulo en el plan, el wizard y la página Formatos (fuente:
  columna "Qué es" de la tabla §4.2 del doc de arquitectura).
- **Compuertas**: verbos consistentes — "Revisa el plan", "Aprueba la muestra",
  "Lanza el lote", "Marca ganadores", "Descarga la entrega".
- Longitudes realistas: nombres de campaña ≤120 chars, hasta 30 creativos por
  campaña (los deriva el matcher de las ideas; plan sugerido de 6 sin ideas),
  0-20 campañas por workspace, 1-6 imágenes de producto.

## 8. Referencias de implementación

- `interaction-design.md` (impeccable) — formularios, disclosure, focus.
- `spatial-design.md` — jerarquía del dashboard y cards de campaña.
- `ux-writing.md` — glosario, empty states que enseñan, verbos de compuerta.

## 9. Preguntas abiertas (resolver al implementar)

1. Migración de datos de carpetas V1 → Colecciones: ¿solo renombrar en UI o
   columna `kind` en `campaigns`? (Las migraciones aplicadas no se tocan;
   probablemente columna nueva + backfill en migración nueva.)
2. Redirects de rutas viejas (`/app/create/image` → `/app/create?type=image`,
   `/app/voices` → `/app/brand?tab=voices`) — mantener URLs viejas funcionando.
3. ¿El Brand Kit implícito se muestra al usuario al final del wizard ("creamos
   tu Brand Kit, edítalo en Marca") o queda 100% invisible hasta que lo busque?
4. Hero del dashboard con 2+ campañas en compuerta simultánea: criterio de
   desempate (más antigua esperando vs mayor presupuesto).
5. El switch imagen/video/audio en Creación rápida: ¿tabs o segmented control?
   Decidir con el sistema de formularios unificado.

## Orden de ejecución sugerido

1. **IA + rutas**: sidebar 7 ítems, `/app/brand`, Colecciones en Biblioteca,
   redirects, glosario en navegación.
2. **Campañas unificadas**: lista solo-studio, cards con pipeline y CTA,
   absorción visual de carpetas.
3. **Wizard sin walls**: dropzone de producto + Brand Kit implícito + Cast
   inline + shadcn.
4. **Dashboard acción-primero**: hero de compuerta / primera campaña.
5. **/distill** del panel de creación + **/clarify** del microcopy global +
   **/polish** final (incluye landing: rebrand + gradient text + bounce).
