# Zyra Studio V2 — Arquitectura y Capacidades

> Resultado del análisis de toda la investigación contenida en `ZyraStudioV2/` (ver `OBJETIVO.md`).
> Fuentes analizadas: análisis funcional de Higgsfield (`SPECS DE EJEMPLO/VIDEO SPECS.md`), flujo
> completo de marca→campaña (`EJEMPLO DE FLUJO.md`), skills `higgsfield-content-factory` y
> `marketing-studio-director`, paper técnico de Seedance 2.0 (ByteDance, arXiv:2604.14148) con su
> presentación, y las guías de prompting de Seedance 2.0 (Morphic, RunDiffusion) y Uni-1 (Luma).
>
> **Higgsfield es caso de estudio, no blueprint.** De su análisis se extraen los principios que
> explican por qué funciona; sus artefactos concretos (presets, picklists, formatos, modelos,
> rate cards) NO se copian. V2 es un sistema propio, diseñado para superar las limitaciones que
> el propio análisis revela. La V1 (spec en `docs/zyra-studio-spec.md`) es la base técnica.

---

## 1. Tesis central

**V1 es un generador de activos. V2 es una fábrica de campañas.**

Lo que el caso de estudio demuestra es estructural, no de producto: el valor de una plataforma
generativa no está en los modelos (capa intercambiable, que cualquiera puede licenciar) sino en
lo que se construye encima — la capa que **encapsula el oficio** de un equipo creativo senior y
la capa que **empaqueta flujos completos** de producción. Zyra V1 ya tiene la fundación técnica
resuelta (adapters + cola QStash + créditos atómicos + storage propio). V2 construye encima sus
propias capas de oficio y de flujo:

```
CAPA 3 — FLUJO            Campaign Studio: brief → dirección creativa → producción
                          en lote → entrega → aprendizaje
CAPA 2 — OFICIO           Prompt Director (dirección creativa razonada) ·
                          Brand Kit + Cast (consistencia) · Plantillas vivas ·
                          Formatos creativos propios · Economía de iteración
CAPA 1 — FUNDACIÓN (V1 ✔) Adapters + cola QStash + créditos + storage + RLS
                          V2 suma Seedance 2.0 como modelo de video principal;
                          imagen: FLUX (generación) + Nano Banana (edición)
```

La meta de productividad de `OBJETIVO.md` (más creativos, menos iteraciones, calidad senior) se
ataca por tres vías:

1. **Encapsular conocimiento experto** → el Prompt Director convierte conceptos planos en
   dirección de producción de nivel senior, razonando por modelo y por formato.
2. **Reducir iteraciones por diseño** → dirigir con referencias en vez de describir con palabras
   (la lección central de Seedance 2.0); validación de producibilidad antes de gastar créditos;
   draft barato antes de render final.
3. **Producir en lote, no por unidad** → campañas como cadenas de jobs con compuertas de
   aprobación, y plantillas vivas que convierten un creativo ganador en una serie completa.

---

## 2. Qué se extrae de cada fuente (principio) y qué se descarta (artefacto)

| Fuente | Principio que se adopta | Artefacto que NO se copia |
|---|---|---|
| **VIDEO SPECS.md** (Higgsfield) | El valor está en las capas de abstracción y flujo; plantillas serializadas reducen la curva de aprendizaje; identidad consistente es requisito de campaña; reserva/reembolso de créditos genera confianza (ya en V1). | Sus 9 presets, sus picklists de hooks/settings con UUID, su catálogo de 100+ modelos, su API pública. |
| **EJEMPLO DE FLUJO.md** | El insumo real de una campaña es un *kit de marca* (logo, producto, avatares, empaque) que se reutiliza en cada generación. El flujo del usuario es marca → productos → activos → anuncios. | Las herramientas concretas del video (Soul Cinema, etc.). |
| **higgsfield-content-factory.skill** | Pipeline por etapas con compuertas de aprobación; muestra pequeña antes del lote; defaults inteligentes que minimizan decisiones; reporte de valor al cierre. | Sus 5 formatos UGC fijos, el reparto `floor(N/5)`, su rate card 2026, la publicación vía Meta MCP, GPT Image. |
| **marketing-studio-director.skill** | Cómo se estructura un motor de prompts publicitario: extracción de inventario, fidelidad absoluta de producto/marca, reglas físicas del medio (acción=intención+resultado, nada off-screen), lista antislop. | Su router de 9 presets y su formato de salida atado a Higgsfield. |
| **Paper + presentación Seedance 2.0** | El modelo flagship de video elegido por investigación propia: multimodal nativo (texto+imagen+video+audio), 4–15 s, audio estéreo nativo, multi-toma, edición y extensión, #1 en Arena.AI. Sus límites (identidad, manos, texto en pantalla, física, sin rostros reales) definen las validaciones del Prompt Director. | — (fuente primaria, no competidor) |
| **Guías Morphic / RunDiffusion** | Sistema de referencias @ con propósito explícito; framework CRAFT; técnicas de extensión, escena puente, reemplazo de personaje y **plantilla replicable para lotes**; pipeline profesional (storyboard → identidad → escenas → post). | — |
| **Guía Uni-1 (Luma)** | Solo referencia de técnica de prompting de imagen: roles de referencia, crear-vs-modificar (un cambio por iteración), texto exacto entre comillas, JSON estructurado para variaciones en lote. Estos principios aplican a los modelos de imagen en uso (FLUX, Nano Banana). | Uni-1 como modelo — **no se adopta**. |

---

## 3. Dónde V2 es distinto (y mejor) que el caso de estudio

Las limitaciones que el propio análisis de Higgsfield revela son las oportunidades de V2:

| Limitación observada en Higgsfield | Respuesta de Zyra V2 |
|---|---|
| **Presets estáticos**: prompt-plantilla fijo + modelo fijo. El usuario está limitado al catálogo; si su producto no encaja, el resultado es genérico. | **Dirección creativa razonada**: el Prompt Director genera la dirección desde el brief, la marca y el formato — no rellena slots de una plantilla muerta. Los formatos son punto de partida editable, no jaula. |
| **Vocabulario cerrado** (picklists con UUID): garantiza producibilidad pero mata la creatividad fuera del catálogo. | **Validación en vez de restricción**: biblioteca de escenas y ganchos *sugerida* (seed propio de Zyra), pero el usuario puede pedir cualquier escena; el validador de producibilidad decide si es generable o propone el ajuste. |
| **El catálogo es de la plataforma, no del usuario**: un preset viral de Higgsfield es igual para todos sus clientes. | **Plantillas vivas**: cualquier creativo aprobado se destila en una plantilla propia del usuario (estructura, cámara, ritmo, estilo fijos; producto/variante rotables — técnica de plantilla replicable de Seedance). El catálogo crece con cada campaña ganadora y es un activo del usuario. |
| **Sin ciclo de aprendizaje**: generas, publicas, y la plataforma no aprende nada de qué funcionó. | **Etapa de aprendizaje** al cierre de campaña: marcar ganadores, destilarlos en plantillas, y alimentar el mix recomendado de la siguiente campaña. |
| **Identidad por fine-tuning (Soul ID)**: requiere entrenamiento por usuario, caro e inviable en alcance demo. | **Identidad por referencias persistentes**: hoja maestra de personaje + multi-ángulo inyectadas en cada generación — capacidad nativa de Seedance 2.0, sin entrenamiento. |
| **Costo opaco**: el usuario descubre el gasto al final. | **Economía visible**: estimador por campaña antes de generar, draft/final explícito, y reporte de valor al cierre. |

---

## 4. Capacidades de V2

### 4.1 Campaign Studio (capa 3 — el flujo)

Pipeline propio de cinco etapas. Cada etapa termina en una compuerta de aprobación con defaults
inteligentes (principio: minimizar decisiones, no eliminarlas).

| Etapa | Qué hace | Mecánica |
|---|---|---|
| **1. Brief** | El usuario aporta producto (imagen o URL) + objetivo. El sistema auto-detecta categoría, variantes, paleta y demográfico, y propone un mix de formatos adecuado al producto (un mix *propuesto y editable*, no un reparto fijo). | Análisis de imagen vía modelo multimodal ya integrado + Prompt Assistant de V1 ampliado. |
| **2. Dirección creativa** | El Prompt Director genera el plan: N creativos, cada uno con formato, concepto, modelo, duración, ratio, escena, persona del cast y caption (metadato de publicación — nunca texto generado en pantalla). El usuario edita el plan como documento, no como formulario. | Tabla `campaign_items` persistida; vista de plan editable antes de producir. |
| **3. Producción en lote** | Ejecuta lote por lote con compuerta: "genera 2-3 de muestra primero" antes del lote completo. Draft en resolución baja para validar dirección; render final solo de lo aprobado. | Cadenas de jobs sobre la cola QStash existente; reserva de créditos por lote. |
| **4. Entrega** | Librería agrupada por campaña + calendario de publicación + export CSV/XLSX (fecha, formato, archivo, caption, objetivo). **Sin publicación directa a plataformas** — fuera de alcance demo (CLAUDE.md: no nuevos servicios). | Generación de archivo, descarga desde la librería. |
| **5. Aprendizaje + reporte** | El usuario marca ganadores → se destilan en plantillas vivas. Reporte de valor: créditos/USD reales vs costo de producción tradicional (rate card propia, configurable) + tiempo ahorrado. | Suma de `credit_transactions` de la campaña × rate card editable en admin. |

### 4.2 Formatos creativos y plantillas vivas (capa 2)

Dos niveles, ambos propios:

- **Formatos Zyra** (seed del sistema, editable): taxonomía propia construida sobre el oficio
  publicitario. Cubre los formatos más usados del entorno de marketing con IA (UGC testimonial,
  entrevista de calle, unboxing, ASMR, antes/después, héroe de producto, spot cinematográfico,
  FOOH), validados por la investigación de cómo se producen hoy con IA. Cada formato define
  registro, cámara, ritmo y qué referencias del Brand Kit exige — no un prompt fijo:

  | Formato | Qué es | Cómo se produce con IA |
  |---|---|---|
  | **Voz Cercana** | Testimonio de creador (talking-head UGC) | Persona del Cast con producto en mano, selfie handheld a nivel de ojos, guion conversacional de una idea (≤25 palabras), luz natural imperfecta; voz con audio nativo de Seedance |
  | **A Pie de Calle** | Entrevista espontánea a desconocidos | Dos personas del Cast (entrevistador + entrevistado), setting urbano, registro documental con micrófono en mano; el producto aparece en la conversación |
  | **Manos a la Obra** | Demostración / tutorial | Manos + producto en plano cenital u over-the-shoulder, pasos encadenados con cortes; voz imperativa breve o solo acción |
  | **El Descubrimiento** | Unboxing / revelación | Empaque del Brand Kit como referencia, close-ups táctiles (sello, tapa, papel), sonido protagonista; arranca cerrado, termina revelado |
  | **Antes y Después** | Transformación | Par de estados generado con edición de imagen (Nano Banana) + transición de video entre ambos; uno de los formatos de mayor conversión en paid social según la investigación |
  | **Susurro** | ASMR sensorial | Primeros planos guiados por sonido (destapar, verter, crujir), audio estéreo nativo, sin diálogo, settings íntimos y silenciosos |
  | **El Ícono** | Héroe de producto kinético | Producto sin personas: órbitas, splash, speed ramps, match cuts; multi-referencia del producto (varios ángulos) para fidelidad absoluta |
  | **Gran Pantalla** | Narrativa de marca cinematográfica | Arco establecimiento → producto → beat emocional → cierre de marca; cámara compuesta (dolly, grúa), registro premium |
  | **Mundo Imposible** | Concepto surreal / FOOH | Escenas imposibles de rodar (escala gigante, física alterada, espacios oníricos) con el producto como ancla; lo que en producción real costaría seis cifras |

  Los nueve son seed del sistema (`is_system`), editables y ampliables por el usuario.
- **Plantillas vivas** (del usuario): un creativo aprobado se destila en plantilla — estructura,
  movimientos de cámara, ritmo de edición y estilo quedan fijos; producto, variante, escena y
  persona son slots rotables. Implementación directa de la técnica de "plantilla creativa
  replicable" de Seedance (referenciar un video ganador y sustituir el producto). Esto convierte
  el techo de Higgsfield (catálogo fijo de plataforma) en el diferenciador de Zyra (catálogo
  que crece y pertenece al usuario).

```
PLANTILLA = {
  origen: generación ganadora (referencia de estructura/cámara/ritmo),
  fijos:  estilo, paleta, registro, duración, ratio,
  slots:  producto, variante/SKU, escena, persona del cast,
  modelo + parámetros de la generación original
}
```

### 4.3 Prompt Director (capa 2 — el oficio encapsulado)

Módulo `lib/prompt-director/` que evoluciona el Prompt Assistant de V1. Convierte
`brief + formato + Brand Kit + referencias` en dirección de producción optimizada por modelo:

1. **Extracción de inventario**: producto, avatar, entorno, estilo/mood — nunca inventa
   atributos de producto o marca, nunca fabrica claims ("clínicamente probado") — solo lo
   visible y audible en escena.
2. **Dirección por formato**: registro, cámara y ritmo coherentes con el formato Zyra elegido
   (un testimonio no se dirige como una narrativa de marca, aunque sea el mismo producto).
3. **Compilador por modelo**:
   - **Seedance 2.0** (video principal) → estructura CRAFT + referencias @ con propósito
     explícito y acotado ("@Image 1 solo rostro y peinado, no la ropa"), marcadores de tiempo
     por segundos, audio dirigido, priorización de los 12 slots de referencia.
   - **Modelo(s) de imagen** (a definir) → compiler propio según el modelo elegido, aplicando
     los principios de las guías analizadas: roles de referencia explícitos, edición de un
     cambio por iteración, texto exacto entre comillas, estructura serializable para lotes.
   - **Modelos V1 (Veo, Kling, FLUX, Nano Banana)** → sus guías existentes en `docs/modelos/`.
4. **Validador de producibilidad** (de los límites documentados en el paper y las guías —
   cada regla evita una regeneración pagada):
   - una acción y un movimiento de cámara por toma; complejidad ∝ duración (1 idea ≈ 4 s);
   - identidad anclada con referencia, no con adjetivos;
   - sin 3+ sujetos;
   - sin prompts negativos ni keyword soup en modelos que no los soportan;
   - lista antislop aplicada a todo prompt generado.

### 4.4 Consistencia de marca y personajes (capa 2)

Eleva Brand Kit (V1 §11.2) y Cast (V1 §11.3) de "features de valor agregado" a **columna
vertebral de V2** — sin consistencia no hay campaña, hay clips sueltos:

- **Brand Kit**: logo, paleta, producto multi-ángulo (frontal/perfil/detalle/logo — la guía
  Morphic exige varios ángulos para fidelidad), empaque, tono. Inyectado automáticamente como
  referencias en cada generación de la campaña.
- **Cast**: hoja maestra de personaje (foto frontal, neutra, alta resolución) + paquete de
  2-3 ángulos. La misma imagen se incluye en *todas* las generaciones donde aparece, con la
  instrucción "apariencia exacta de @Image X". Las variaciones (ropa, expresión) van en texto.
- Identidad por referencias persistentes, sin fine-tuning: capacidad nativa de Seedance 2.0.

### 4.5 Generación dirigida por referencias (capa 1 ampliada)

Nuevas primitivas sobre el patrón upload-first existente (V1 §14, subida de referencias):

| Capacidad | Soporte | Uso publicitario |
|---|---|---|
| Video multi-referencia | Seedance 2.0: hasta 9 imágenes + 3 videos (≤15 s) + 3 audios, tope 12 archivos | Producto fiel + personaje consistente + movimiento de cámara mostrado + ritmo musical |
| Extensión de video | "Extiende @video1 por X s" (duración de salida = extensión) | Superar el techo de 15 s encadenando |
| Escena puente | Segmento generado que conecta el final de un clip con el inicio de otro | Montar narrativas multi-clip |
| Edición de video | Reemplazo de personaje, cambio de acción/desenlace, acotando lo intocable | Variantes regionales / nuevo embajador sin re-rodar |
| Plantilla replicable | Misma estructura/cámara/ritmo de un video ganador, rotando solo el producto | **La base de las plantillas vivas** |

Para imagen, **roles definidos por capacidad** (comparativas 2026 consultadas):

| Rol | Modelo | Por qué |
|---|---|---|
| **Edición / cambios sobre imágenes generadas** | **Nano Banana (Pro)** | Su razonamiento multimodal (base Gemini) lo hace el mejor en edición referenciada, composición rígida e inserción de elementos (logo en producto, reemplazos localizados) — el rol que ya cumple en V1 |
| **Generación desde cero** | **FLUX** | Sigue siendo el mejor default general en las comparativas 2026: consistencia de color, iluminación y materiales (vidrio, telas) a través de muchas salidas, con costo competitivo. Nano Banana también genera desde cero, pero como default fotográfico FLUX rinde mejor |
| **Texto y layout en banners** (si el uso lo exige) | A evaluar: Ideogram v3 / GPT Image 2 | Lideran renderizado de tipografía exacta y colocación lógica de copy; se suma uno solo si los packs de imagen lo demandan |
| **Variantes masivas baratas** (si el uso lo exige) | A evaluar: Seedream Lite | Velocidad y costo para cientos de variantes; relevante solo a volúmenes que el alcance demo no contempla |

La base operativa de V2 es FLUX (generación) + Nano Banana (edición), ambos ya integrados en V1.
Los dos roles "a evaluar" se deciden con uso real, no por adelantado.

### 4.6 Economía de iteración

Del paper/presentación (costo ≈ cuadrático en tokens: duración × resolución). Pricing real de
Seedance 2.0 en fal.ai (consultado junio 2026, por segundo generado, audio incluido):

| Tier | Resolución | Precio/s | Clip de 10 s |
|---|---|---|---|
| Standard | 720p | $0.3034 | ≈ $3.03 |
| Standard | 1080p | $0.682 | ≈ $6.82 |
| Fast | 720p | $0.2419 | ≈ $2.42 |
| Fast | 480p | disponible, más barato (sin precio publicado en la página) | — |

- **Modo draft**: Fast 480p para explorar; **render final**: Standard 720p (1080p solo para
  hero pieces). El selector de modelo (V1 §7) decide según etapa del pipeline.
- **Seed fijado** para iterar manteniendo composición.
- **Muestra de 2-3 antes del lote** en cada batch.
- Estimador de créditos por campaña *antes* de generar (extiende `lib/credits/estimator`).

---

## 5. Arquitectura técnica

### 5.1 Lo que NO cambia (decisiones inmutables de CLAUDE.md)

- Todo >60 s pasa por QStash con polling re-encolado; sin webhooks.
- URLs de proveedores nunca llegan al cliente; el worker descarga y sube a Supabase Storage.
- Créditos solo vía funciones SQL atómicas.
- Server actions con zod + ownership; RLS como última línea.
- Service role solo server-side.

### 5.2 Nuevos componentes

```
[Campaign Studio UI]  →  server-actions/campaigns.ts
        │
        ▼
[Campaign Orchestrator]   lib/campaigns/orchestrator.ts
   plan → lotes → compuertas → progreso (Realtime)
        │
        ▼
[Job Chains]              lib/jobs/chains.ts
   un lote = N jobs encolados con metadata de campaña;
   cada job sigue el patrón V1 (QStash → worker → poll → storage)
        │
        ▼
[Prompt Director]         lib/prompt-director/
   inventory.ts · format-director.ts · compilers/{seedance,flux,nano-banana,veo,kling}.ts
   · validators.ts (producibilidad) · antislop.ts
        │
        ▼
[Adapters]                lib/providers/
   + seedance.ts (fal.ai)   (los de V1 se conservan; modelo de imagen
                             adicional solo si la evaluación lo justifica)
```

### 5.3 Modelo de datos — tablas nuevas

Sobre el esquema V1 (sin tocar tablas existentes; migraciones nuevas en orden):

```sql
campaigns        (id, user_id, name, product_ref, category, goal, market,
                  date_range, status, total_items, credits_estimated)
campaign_items   (id, campaign_id, format_id, template_id NULL, model_id,
                  duration_s, aspect_ratio, scene, audio, cast_member_id,
                  scene_prompt, caption, scheduled_date, status, job_id)
formats          (id, name, register, camera_style, pacing, required_refs,
                  is_system)                      -- seed Zyra, editable
templates        (id, user_id, name, source_generation_id, fixed_params,
                  slots, model_id)                -- plantillas vivas, del usuario
scene_library    (id, type[escena|gancho], name, prompt_fragment, is_system)
                                                  -- sugerencias, no restricción
brand_kits       (id, user_id, name, logo_path, palette, tone, product_images[],
                  packaging_images[])
cast_members     (id, user_id, name, master_image_path, angle_images[], description)
```

`generations` (V1) se relaciona con `campaign_items` vía `job_id` — un creativo de campaña
es una generación normal con contexto extra. Créditos: `reserve_credits` se invoca por item;
el orquestador maneja el agregado por lote (reservar lote completo al aprobar, reembolso
automático por item fallido — semántica ya existente).

### 5.4 Proveedores nuevos

Elegidos por la investigación propia de la carpeta (no por imitación):

| Modelo | Proveedor API | Rol en V2 | Nota |
|---|---|---|---|
| **Seedance 2.0** | fal.ai (proveedor oficial) | **Video principal**: multi-referencia, audio nativo, multi-toma, edición/extensión | Standard 720p $0.3034/s · 1080p $0.682/s (pricing §4.6) |
| **Seedance 2.0 Fast** | fal.ai | Modo draft / iteración barata | 720p $0.2419/s · 480p disponible más barato |
| FLUX | (V1) | **Imagen — generación desde cero** (mejor default 2026) | |
| Nano Banana | (V1) | **Imagen — edición y cambios sobre lo generado** | Inserción de logo, reemplazos, composición referenciada |
| Veo, Kling, ElevenLabs | (V1) | Se conservan; el router decide | Kling/Veo siguen útiles para personas reales (restricción anti-deepfake de Seedance) |
| Ideogram / GPT Image 2 / Seedream Lite | — | No integrados; candidatos por rol (texto en banners / lotes masivos) solo si el uso lo exige | Ver §4.5 |

Cada modelo nuevo = una fila en `model_pricing` + un adapter + un compiler en el Prompt
Director + un `.md` en `docs/modelos/` (convención V1).

### 5.5 Restricciones de plataforma (Vercel Hobby / Supabase free)

- Un lote de 20-100 videos no puede dispararse de golpe: el orquestador encola con
  **escalonamiento** (QStash delay incremental) para respetar rate limits del proveedor y
  los límites de invocaciones.
- Storage: campañas grandes presionan el free tier de Supabase → política de retención por
  campaña (drafts se purgan al aprobar finales; el cleanup diario existente se extiende).
- El plan demo dimensiona campañas de ~10-30 creativos, no 200; la arquitectura escala, el
  plan free no — esto se declara explícitamente en la UI del estimador.

---

## 6. Métricas (mapeo directo a OBJETIVO.md)

| Métrica del objetivo | Cómo la mueve V2 |
|---|---|
| Creativos por hora / campañas por día | Lotes + plantillas vivas (un ganador → una serie completa) |
| Tiempo idea→publicación | Pipeline 5 etapas con auto-detección de brief y plan generado |
| Calidad senior consistente | Prompt Director (oficio encapsulado) + Brand Kit/Cast en cada generación |
| Menos pasos manuales / carga cognitiva | Auto-detección, defaults inteligentes, compuertas simples |
| Menor costo por creativo | Draft→final, seed fijo, validador de producibilidad, estimador previo |
| % aprobación a la primera | Validación pre-encolado + muestra de 2-3 + referencias en vez de descripciones |
| Menor tasa de error humano | Plantillas vivas, validación zod de cada item, formatos con reglas |

El **reporte de valor** (etapa 5) materializa estas métricas por campaña: créditos/USD reales
vs rate card tradicional (propia, configurable) + horas vs semanas.

---

## 7. Decisiones (todas resueltas el 2026-06-10)

1. **Modelos de imagen — RESUELTO por roles**: Nano Banana = edición y cambios sobre imágenes
   ya generadas (también puede generar desde cero, pero no es su rol); FLUX = generación desde
   cero (mejor default según comparativas 2026). Un especialista de texto en banners
   (Ideogram v3 / GPT Image 2) o de lotes masivos (Seedream Lite) se evalúa solo si el uso
   real lo exige. Uni-1 descartado.
2. **Seedance 2.0 vía fal.ai — RESUELTO**: video principal. Pricing consultado y documentado
   en §4.6 (Standard 720p $0.3034/s; Fast 720p $0.2419/s; Fast 480p para drafts). Cargar
   `model_pricing` con margen sobre estos valores; confirmar el precio exacto de 480p al
   integrar el adapter (no está publicado en la página).
3. **Taxonomía de formatos Zyra — RESUELTO**: los nueve formatos de §4.2 (Voz Cercana,
   A Pie de Calle, Manos a la Obra, El Descubrimiento, Antes y Después, Susurro, El Ícono,
   Gran Pantalla, Mundo Imposible), nombres estéticos que representan su función, cubriendo
   los formatos más usados del marketing con IA. Editables y ampliables desde el sistema.
4. **Entrega — RESUELTO**: sin publicación a plataformas de ads por el momento. Solo
   calendario + export CSV/XLSX.
5. **Repo — RESUELTO**: se trabaja sobre este mismo repo con ramas por feature. Las ramas de
   V1 (todas mergeadas en main) fueron eliminadas el 2026-06-10, local y en origin; queda
   solo `main`.
6. **Rate card del reporte de valor — RESUELTO**: rate card propia, editable desde el panel
   admin, con valores iniciales razonables por tipo de activo (no se copia la de terceros).

---

## 8. Plan de fases sugerido

1. **Fase A — Fundación V2**: migraciones (campaigns, formats, templates, scene_library,
   brand_kits, cast_members), adapter Seedance 2.0 + doc en `docs/modelos/`, seed de formatos
   Zyra y biblioteca de escenas.
2. **Fase B — Prompt Director**: inventory + dirección por formato + compiler Seedance +
   validadores + antislop; integración con el Prompt Assistant existente.
3. **Fase C — Campaign Studio mínimo**: brief → plan → un lote con compuerta y muestra de 2-3 →
   librería agrupada por campaña (Realtime para progreso, como V1).
4. **Fase D — Consistencia y plantillas vivas**: Brand Kit y Cast inyectados como referencias
   automáticas; destilación de ganadores en plantillas; regeneración de serie desde plantilla.
5. **Fase E — Cierre de pipeline**: calendario + export, reporte de valor, pack de imágenes
   con los modelos de imagen disponibles (evaluar ahí si hace falta sumar uno), polish para
   la demo.

---

*Documento generado a partir del análisis completo de la carpeta `ZyraStudioV2/` según el
mandato de `OBJETIVO.md`. Higgsfield se usó exclusivamente como caso de estudio para extraer
principios; el diseño resultante es propio. Junio 2026.*
