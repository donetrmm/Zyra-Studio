# Fase K — Motor de Preferencias (feedback de calidad que mejora las recetas)

> **~3–4 días la Fase 1 · roadmap de 3 fases**
>
> El usuario califica los resultados (👍/👎 + razón) y el sistema aprende qué **recetas de
> producción** (formato + modelo + voz) funcionan **y en qué contexto**, para sesgar lo que el
> Prompt Director y el planner proponen — subiendo las buenas y descartando las malas.
> Origen: idea del usuario 2026-06-18. NO es un modelo entrenado: es un motor de scoring sobre
> señales reales, con trayectoria hacia recomendación semántica y aprendizaje en fases posteriores.

## Contexto y decisión de diseño central

La pregunta original fue "meter un grafo o modelo que aprenda a generar con la mejor calidad y
mejore con lo que les gusta a los usuarios". Tras desglosarla, lo que se construye es un **motor
de preferencias con feedback explícito**, no un modelo ML. Razones:

1. **El "saber generar bien" ya existe** como conocimiento codificado en `lib/prompt-director/`
   (reglas deterministas, tier-lists de referencias, antislop, dirección por formato anclada a
   `docs/modelos/`). No se reentrena; se *complementa* con una capa que aprende de resultados.
2. **No se puede hacer ML sin datos.** El feedback explícito es el recolector que habilita
   cualquier fase futura (semántica, personalización, scoring aprendido). Por eso la Fase 1 es
   el rollup, pase lo que pase.

### Invariante arquitectónico (no negociable)

El aprendizaje vive en la **capa de selección** (qué receta se le entrega al compilador), **NO
dentro del compilador**. El Prompt Director sigue siendo **determinista** (mismo input → mismo
output, decisión inmutable del CLAUDE.md). Lo aprendido cambia *qué formato/modelo/parámetros se
eligen*, computado río arriba en el planner y en `directorContextFor`. El compilador compila
determinísticamente lo que recibe.

Además se preservan intactas: créditos vía RPC atómicos, URLs de proveedor nunca al cliente,
service-role solo server-side. El feedback se aplica con un RPC atómico (`apply_feedback`),
mismo patrón que `reserve_credits` — nunca UPDATE directo a la tabla de rollup.

### Oficio vs idea (clave para no volver repetitivas las campañas)

El sistema aprende la **capa de oficio** (cómo se produce bien: lip-sync limpio, identidad de
producto intacta, cámara que no se rompe), **no la capa de idea** (la escena, el concepto, el
guion — eso sigue viniendo del brief + `CONCEPT_SEEDS` + el matcher LLM, diversos por diseño).
Aprender recetas **sube el piso de calidad de todas las ideas sin uniformarlas**. Es el mismo
principio de los competidores ya documentado: extraer el porqué, descartar el artefacto.

## Objetivo (Fase 1)

Al cerrar la Fase 1:

- El usuario puede calificar cualquier generación (👍/👎 + razón opcional) desde la biblioteca y
  desde la revisión de campaña.
- Cada voto actualiza atómicamente un rollup `recipe_stats` con un score de calidad por
  `(scope, categoría, formato, modelo, voz)`.
- `buildPlan()` lee ese score y sesga el mix de formatos de campañas nuevas, con guardarraíles
  de diversidad y exploración.
- Hay una vista de recomendaciones legible ("qué rinde dónde") que hace el aprendizaje tangible.
- El sistema se siembra (cold-start) desde `is_winner`, favoritos y el saber de `docs/modelos/`,
  para no arrancar tonto.

## Roadmap de 3 fases

Como ya **no es demo sino producto con visión de mercado** (pivote 2026-06-18), la spec se
diseña como roadmap. Solo la Fase 1 se detalla a nivel tarea; 2 y 3 fijan dirección y los hooks
que la Fase 1 deja puestos para no migrar con dolor después.

| Fase | Qué | Estado |
|---|---|---|
| **1 — Rollup de preferencias** | Feedback explícito + `recipe_stats` (Wilson score) + consumo en planner/params/recomendaciones + grafo como vista + cold-start | Esta spec, detallada |
| **2 — Recomendación semántica** | `pgvector` sobre el snapshot de prompt/params → "más como esto que funcionó" en briefs parecidos | Roadmap; la Fase 1 ya guarda el snapshot |
| **3 — Aprendido / personalizado** | Scoring por workspace (override del prior global), decaimiento temporal, posible modelo aprendido | Roadmap; la Fase 1 ya pone columna `scope` y auto-medición |

**Hooks baratos que la Fase 1 pone HOY para habilitar 2 y 3** (caros de retro-encajar):
columna `scope` (global / workspace), **snapshot obligatorio** del prompt+params en cada voto, y
**auto-medición del lift** del loop.

## Estructura de archivos

```
supabase/migrations/
  04X_generation_feedback.sql   ← tabla de votos crudos + RLS
  04X_recipe_stats.sql          ← rollup agregado + RLS (lectura) 
  04X_apply_feedback.sql        ← RPC atómico (voto → rollup), security definer
  04X_seed_recipe_stats.sql     ← cold-start desde is_winner/favorites
lib/preferences/
  score.ts            ← Wilson lower bound + blend de señales implícitas (puro, testeable)
  recipe-key.ts       ← deriva (categoría, formato, modelo, voz) de una generación/item
  reasons.ts          ← taxonomía de razones ↔ palancas del director
  query.ts            ← lecturas de recipe_stats (ranking por categoría, celda, grafo)
server-actions/
  feedback.ts         ← rateGenerationAction (zod → RPC apply_feedback)
components/
  feedback/RatingControl.tsx     ← 👍/👎 + razón (biblioteca y revisión de campaña)
  preferences/RecipeGraph.tsx    ← vista grafo read-only sobre recipe_stats
lib/campaigns/
  planner.ts          ← buildPlan() consume score (reemplaza el peso booleano de ganador)
  orchestrator.ts     ← directorContextFor() ajusta params según razones dominantes
```

## Modelo de datos

### `generation_feedback` — señal cruda (un voto por usuario por resultado)

```sql
create table generation_feedback (
  id              uuid primary key default gen_random_uuid(),
  generation_id   uuid not null references generations(id) on delete cascade,
  user_id         uuid not null references profiles(id),
  rating          text not null check (rating in ('up','down')),
  reasons         text[] not null default '{}',   -- ver lib/preferences/reasons.ts

  -- snapshot denormalizado al momento del voto (NO depender de joins futuros):
  scope             text not null default 'global',   -- 'global' | workspace_id::text
  product_category  text,                              -- de campaigns.product_brief
  format_id         uuid,
  model_slug        text,
  has_voice         boolean,
  duration_s        integer,
  -- substrato para Fase 2 (pgvector / "más como esto") y post-mortem:
  prompt_snapshot   text,         -- el prompt compilado que produjo el output
  params_snapshot   jsonb,        -- los params con que se generó

  created_at      timestamptz not null default now(),
  unique (generation_id, user_id)        -- un voto por usuario, re-votable (upsert)
);
```

> El snapshot es deliberadamente redundante: aunque mañana se borre la campaña, se cambie un
> formato o se reescriba el compilador, la lección aprendida **persiste con su contexto**. Sin
> esto, la Fase 2 sería imposible sin re-generar histórico.

### `recipe_stats` — rollup agregado (la memoria del sistema)

```sql
create table recipe_stats (
  scope             text not null default 'global',
  product_category  text not null default 'unknown',
  format_id         uuid,
  model_slug        text not null,
  has_voice         boolean not null,

  up_count          real not null default 0,   -- pesos float (explícito=1.0, implícito<1)
  down_count        real not null default 0,
  reason_counts     jsonb not null default '{}',  -- {'lipsync_voice':7,'motion':2,...}
  score             real not null default 0,      -- Wilson lower bound, recalculado por voto
  votes_explicit    integer not null default 0,   -- nº de votos 👍/👎 reales (confianza UI)
  updated_at        timestamptz not null default now(),

  primary key (scope, product_category, format_id, model_slug, has_voice)
);
```

**Grano de la celda = `(scope, categoría, formato, modelo, voz)`.** La *receta* que se evalúa es
`(formato, modelo, voz)`; la *categoría* es el eje de contexto ("dónde funciona qué"). `duration`
NO entra al grano (explotaría el nº de celdas y diluiría la señal) — se guarda en el voto crudo y
se trata como ajuste guiado por razón, no como dimensión de agregación.

### RLS

- `generation_feedback`: INSERT/UPDATE solo el dueño del voto (`user_id = auth.uid()`), y solo
  sobre generaciones de su workspace. SELECT por workspace.
- `recipe_stats`: SELECT para usuarios autenticados (scope global + su workspace); escritura
  **solo** vía RPC `apply_feedback` (security definer, owner postgres). Sin INSERT/UPDATE directo.

## El score: Wilson lower bound (no promedio crudo)

Un promedio simple deja que una receta con 2/2 👍 le gane a una con 45/50. El **lower bound del
intervalo de Wilson** corrige por tamaño de muestra: una receta necesita *volumen consistente*
para subir. Es fórmula cerrada en SQL/TS, cero ML. En `lib/preferences/score.ts`:

```
n   = up_count + down_count
p   = n > 0 ? up_count / n : 0
z   = 1.96                       // 95%
score = n === 0 ? 0
      : (p + z*z/(2n) - z*sqrt((p*(1-p) + z*z/(4n))/n)) / (1 + z*z/n)
```

**Señales implícitas** (Fase 1, opcional pero recomendado): además del voto explícito (peso 1.0),
se mezclan señales que ya capturas como pesos fraccionarios en `up_count`/`down_count`:

| Señal | Fuente | Peso |
|---|---|---|
| 👍 explícito | `generation_feedback` | +1.0 up |
| 👎 explícito | `generation_feedback` | +1.0 down |
| Marcó ganador | `campaign_items.is_winner` | +0.7 up |
| Favorito | `favorites` | +0.5 up |
| Aceptó (no regeneró) | flujo de campaña | +0.2 up |
| Descartó / regeneró | flujo de campaña | +0.3 down |

> El voto explícito siempre manda (peso 1.0 y cuenta en `votes_explicit`, que la UI usa para
> mostrar confianza). Las implícitas rellenan el arranque en frío; usar counts float sobre Wilson
> es una aproximación aceptada. Decisión abierta: mantener `implicit` en una columna separada y
> blendear, si la aproximación resulta ruidosa.

## Cómo se consume (los tres puntos elegidos)

### 1. Planner de campañas — `lib/campaigns/planner.ts buildPlan()`

Hoy un formato con creativo ganador pesa **×2** (booleano, ~líneas 447-460). Se reemplaza por:

```
peso(formato) = base × (1 + k · score(categoría, formato, …))     // k tunable, p.ej. 1.5
```

leído de `recipe_stats` para la categoría de la campaña. Guardarraíles obligatorios:

- **Piso de exploración (ε):** toda receta —nueva o poco probada— conserva probabilidad mínima de
  salir. El sistema sigue descubriendo en vez de congelarse en lo conocido (exploración vs
  explotación).
- **Tope de repetición:** máx. N ítems de la misma receta por campaña, para que una receta de
  score altísimo no acapare el mix. El planner ya propone *varios* formatos por categoría; esto
  lo protege.

`winningSlugs` (derivado en `server-actions/campaigns.ts` ~642-655) deja de ser una lista
booleana y pasa a ser el ranking por score de `lib/preferences/query.ts`.

### 2. Ajuste de parámetros — `lib/campaigns/orchestrator.ts directorContextFor()`

Si en una celda **domina una razón**, el plan ajusta la palanca correspondiente **antes** de
compilar (sigue siendo determinista: la *elección* del parámetro es lo aprendido):

| Razón dominante | Ajuste |
|---|---|
| `lipsync_voice` | elegir variante `voz=off` o duración más corta para esa receta |
| `motion` | bajar complejidad de cámara (registro más estático) |
| `product_identity` | forzar cláusula de fidelidad reforzada / más ángulos de referencia |
| `aesthetics` | revisar look base del formato |
| `adherence` | acortar/simplificar la escena |

### 3. Recomendaciones visibles + grafo — `components/preferences/RecipeGraph.tsx`

Lectura read-only de `recipe_stats`. Dos presentaciones del mismo dato:

- **Loop visible (el "wow"):** cuando el sistema sesga, lo dice. *"Aprendí que en unboxing largo
  el lip-sync falla → bajé la voz en esta receta."* Hace el aprendizaje legible, no caja negra.
- **Grafo:** nodos = categorías / formatos / modelos / razones; aristas = "este formato funciona
  en esta categoría", peso = score. `recipe_stats` **es** la lista de aristas. Render en cliente
  (React Flow o cytoscape) con un SELECT — cero infra nueva. El grafo es la vista, **no** el
  motor. Caveat: solo impresiona con volumen → depende del cold-start.

## Cold-start / bootstrap (obligatorio)

El sistema nace vacío; un producto de mercado no tolera un día uno tonto. `recipe_stats` se siembra
con pseudo-counts desde lo que ya existe:

- `campaign_items.is_winner = true` → +pseudo-up en su celda.
- `favorites` → +pseudo-up.
- Saber de `docs/modelos/` → un seed curado de recetas "conocidas buenas" por categoría/formato
  (priors suaves, bajo peso, para que el feedback real los supere rápido).

Migración `04X_seed_recipe_stats.sql` (idempotente, re-ejecutable).

## Auto-medición del loop (nuevo, para mercado)

Un producto que dice "aprende" debe **probarlo**. Se trackea si las recetas que el sistema sesgó
reciben **mejor feedback con el tiempo**: comparar el score promedio de los ítems generados con
sesgo activo vs el histórico. Es la métrica de **lift** — vendible y honesta. Implementación
ligera en Fase 1: una vista SQL o un job de reporte que ya existe (`lib/campaigns/report.ts`
agrega finales por formato; se extiende con la dimensión de score).

## Taxonomía de razones — `lib/preferences/reasons.ts`

Lista corta, mapeada 1:1 a palancas reales del Prompt Director (no razones genéricas):

```ts
export const FEEDBACK_REASONS = [
  { key: 'product_identity', label: 'El producto perdió identidad' },  // → inventory fidelity
  { key: 'motion',           label: 'Movimiento / cámara raro' },      // → format-director
  { key: 'lipsync_voice',    label: 'Lip-sync o voz falló' },          // → seedance dialogue
  { key: 'aesthetics',       label: 'Estética / look' },               // → look base + antislop
  { key: 'adherence',        label: 'No siguió el brief / escena' },   // → validators
] as const
```

## UI de feedback — `components/feedback/RatingControl.tsx`

- 👍/👎 en la card de generación (biblioteca) y en la revisión de campaña.
- Al votar 👎 (o siempre, opcional) aparece el selector de razón (multi-select corto). Fricción
  mínima: el voto se registra al primer clic; la razón es un paso opcional.
- Estado optimista + Realtime para reflejar el voto. Re-votable (upsert sobre el `unique`).
- Componente shadcn primero; dark mode; sin emojis en texto de UI (los pulgares son iconos, no
  emojis en strings). Acento `#009fff`.

## Tareas en orden (Fase 1)

### 1. Tipos + score puro (3h)

`lib/preferences/score.ts` (Wilson + blend), `recipe-key.ts`, `reasons.ts`. Todo puro y testeable
sin DB ni APIs. Tests unitarios de Wilson (n=0, n bajo vs alto, monotonía).

### 2. Migraciones (3h)

`generation_feedback`, `recipe_stats`, RLS, y `apply_feedback` (RPC security definer: upsert del
voto + recálculo atómico de la celda, incluyendo `reason_counts` y `score`). Patrón idéntico a
`reserve_credits`.

### 3. Cold-start seed (2h)

`04X_seed_recipe_stats.sql` idempotente desde `is_winner` + `favorites` + priors curados de
`docs/modelos/`.

### 4. Server action + UI de rating (4h)

`rateGenerationAction` (zod → RPC). `RatingControl` en biblioteca y revisión de campaña. Estado
optimista + Realtime.

### 5. Consumo en planner + params (4h)

`buildPlan()` lee score con ε y tope de repetición. `directorContextFor()` ajusta palanca por
razón dominante. `winningSlugs` → ranking por score.

### 6. Recomendaciones + grafo + loop visible (4h)

`lib/preferences/query.ts` (ranking, celda, aristas del grafo). `RecipeGraph.tsx`. Mensajes de
"qué aprendí / qué ajusté" en el flujo de campaña.

### 7. Auto-medición (2h)

Extender `lib/campaigns/report.ts` con la dimensión de score; vista de lift.

## Pruebas

- **Unitarias** (`lib/preferences/*.test.ts`): Wilson (casos límite, monotonía), blend de señales,
  `recipe-key` deriva la celda correcta, `reasons` mapea bien.
- **Integración:** `apply_feedback` actualiza counts/score/reason_counts atómicamente; upsert
  re-votable no duplica; cold-start es idempotente.
- **Planner:** con `recipe_stats` sembrado, `buildPlan()` sesga el mix pero respeta ε y el tope de
  repetición (no colapsa a una sola receta).
- Sin APIs reales en tests (Gemini/fal.ai/ElevenLabs/QStash): el motor de preferencias es puro
  SQL + TS, no llama proveedores. Smoke E2E lo corre el usuario.

## Decisiones abiertas

1. **Señales implícitas float sobre Wilson** vs columna `implicit` separada y blend explícito
   (empezar con la aproximación float; revisar si es ruidosa).
2. **k y ε del planner** — valores iniciales (k≈1.5, ε≈0.1) a calibrar con datos reales.
3. **`product_category`** cuando una generación es suelta (sin campaña) y no tiene categoría:
   ¿inferirla, o caer a `'unknown'` (no contamina el grano contextual)?
4. **Umbral de confianza** para mostrar una recomendación en la UI (`votes_explicit >= ?`).

## Lo que NO entra (y por qué)

- Modelo ML entrenado: Fase 3+, no por dogma sino por secuencia (necesita el volumen que las
  fases 1-2 generan).
- `pgvector` / recomendación semántica: Fase 2 (el snapshot ya queda guardado desde Fase 1).
- Scoring por usuario individual / decaimiento temporal: Fase 3 (la columna `scope` ya lo habilita
  a nivel workspace).
