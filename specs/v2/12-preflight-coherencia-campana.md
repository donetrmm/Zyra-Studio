# Fase L — Preflight de coherencia de campaña (revisión de inputs antes de generar)

> **~1–2 días la Fase 0 · roadmap de 3 fases**
>
> Al generar el plan de una campaña, un chequeo con Gemini Flash revisa los **inputs**
> (estilo elegido, brief del producto, masters de personajes/locaciones, ideas del usuario)
> y devuelve **notas + sugerencias** de coherencia que el usuario acepta o descarta —
> antes de que el matcher autore escenas y antes de que se compile o genere nada.
> Nunca reescribe: sugiere. Origen: idea del usuario 2026-07-04, tras la auditoría de
> directivas y el bug del prompt casero contradictorio.

## Contexto y decisión de diseño central

La pregunta original fue si convenía mandar el prompt **ya compilado** a un LLM para que lo
"mejorara". Se descartó esa forma: el prompt compilado de video es un contrato máquina
(`@image1…`, `@audio1…`, diálogo `Dialogue:"..."` que alimenta lip-sync y normalización
es-MX), y un LLM que lo reescribe mangle esos tokens, re-mete slop que `antislop` ya quitó,
re-describe el producto (el bug del "framed canvas") y rompe la reproducibilidad de la que
depende el encadenado. Es decir: pelea de frente con el pilar del Prompt Director
(determinismo) y con el principio del proyecto "arreglar el generador, no la salida".

La forma correcta es **subir el chequeo al punto más temprano y barato: la creación de la
campaña**, sobre los *inputs* estructurados, no sobre el texto compilado. Ahí:

1. Corre **una vez por campaña**, no por item ni por generación.
2. **Nunca toca la gramática de referencias** ni el compilado determinista.
3. Ataca **causas raíz** antes de gastar un crédito: un input malo caza N generaciones malas.
4. Va en línea con "arreglar el generador": corrige el input antes de que el generador arranque.

### Invariante arquitectónico (no negociable)

- **El compilador sigue siendo determinista.** Mismo input → mismo output (decisión inmutable
  del CLAUDE.md). El preflight vive **río arriba** del planner/matcher y del compile; no cambia
  ninguna cláusula determinista.
- **Sugiere, no reescribe.** El veredicto es informativo. El usuario acepta o descarta cada
  nota. En el momento en que el sistema modifica el input del usuario en silencio, vuelve a ser
  "parchar la salida" y puede introducir sus propias contradicciones.
- **Es aditivo, no reemplaza a las verificaciones deterministas.** `validators.ts` + `antislop`
  + las cláusulas de fidelidad siguen corriendo en el compile: atrapan lo *estructural* (cámara,
  claims, edad, acciones sin desglosar, slop). El preflight atrapa lo *semántico/visual* que
  esas no pueden ver. Los dos conviven.
- **Es una puerta de entrada, no la solución completa.** En la creación los `scenePrompt` aún
  no existen (los escribe el matcher después). El preflight ve inputs + imágenes, no escenas
  autoradas: lo que el matcher redacte mal (objeto flotando, emoción exagerada, re-descripción
  del producto) sigue cubierto por la capa determinista y los bloques `PLANNER_*`.

## Alcance de impacto (honesto — para que la decisión quede documentada)

Es una **red de seguridad de alto apalancamiento sobre una clase estrecha pero cara**, no un
subidor del techo de calidad.

- **Donde pega fuerte:** es lo único que caza el "master de estudio pulido en campaña casero"
  — un input incoherente que se propaga a *toda* la campaña. Cada catch previene N generaciones
  pagadas. También el estudio-vs-smartphone (el bug que originó este hilo) y el premium-vs-casero
  de la auditoría de la BD.
- **Donde NO mueve la aguja:** realismo y expresiones exageradas (lo que el jefe percibe como
  calidad) viven en la autoría del matcher y en el generador, no en la coherencia de inputs. El
  preflight no los toca. De las 5 observaciones del jefe (2026-07-04) habría ayudado en ~1.
- **Su valor escala con cuán seguido los inputs son incoherentes:** alto durante el rollout de
  casero y con usuarios nuevos; bajo para quien ya elige estilos que combinan.
- **Previene campañas malas; no eleva las buenas.**

## Qué chequea (atado a bugs reales)

1. **Master de activo vs estilo de campaña** (detectable **visualmente**): un retrato de estudio
   pulido en una campaña `casero` → el video heredaría el look de estudio. Ninguna verificación
   determinista lo ve.
2. **Descripción de personaje/producto vs estilo** (raíz del estudio-vs-smartphone).
3. **Producto "premium editorial" con estilo casero** (el choque marcado en la auditoría de la BD).
4. **Ideas cuyo tono pelea con el estilo** ("cinematográfica dramática" en casero) o que declaran
   **emoción exagerada** que luego peleará con el freno de actuación.
5. **Dimensiones/uso del producto faltantes o contradictorios** que romperían el staging aguas abajo.

## Dónde se engancha

Punto exacto: dentro de `generatePlanAction` (`server-actions/campaigns.ts:650`), **justo antes
de `matchIdeas`**. En ese punto ya están reunidos todos los ingredientes: brief del producto
(`campaigns.ts:517`), personajes del pool con sus masters (`:556-580`), estilo y guidelines
(`:525-527`, `:663-673`), e ideas del usuario (`:606`).

Detalle que lo hace barato: el código **ya descargó** las imágenes de producto y de los masters
para dárselas al matcher (`campaigns.ts:610-634`, `matcherImages` en base64). El preflight
**reusa esos mismos buffers** — el chequeo visual (master vs estilo) no cuesta descargas extra.

El wizard ya devuelve `blockers?: string[]` para ideas que el matcher no pudo convertir
(`campaigns.ts:502`). Se espeja ese patrón: se añade `coherenceNotes` al mismo retorno.

## Schema del veredicto (acotado, patrón de `clarify.ts`/`validators.ts`)

Gemini `gemini-2.5-flash`, `responseMimeType: application/json`, `thinkingConfig.thinkingBudget: 0`
(mismo perfil que brief/clarify). Zod defensivo: nota malformada se descarta sin tirar el resto.

```ts
const CoherenceNoteSchema = z.object({
  severity: z.enum(['block', 'warn']),          // block = recomienda fuerte arreglar; warn = FYI
  subject: z.enum(['style', 'character', 'product', 'location', 'idea']),
  ref: z.string().max(80).optional(),            // a quién/cuál idea aplica (nombre, no UUID)
  issue: z.string().min(1).max(300),             // "el master es un retrato de estudio pulido"
  conflictsWith: z.string().min(1).max(300),     // "el estilo casero de la campaña"
  suggestion: z.string().min(1).max(300),        // "regenera el master en casero, o cambia a ultra_realista"
});
const CoherenceResultSchema = z.object({
  notes: z.array(z.unknown()).catch([]).default([]).transform((arr) =>
    arr.flatMap((n) => {
      const p = CoherenceNoteSchema.safeParse(n);
      return p.success ? [p.data] : [];
    }).slice(0, 5),                               // techo duro: máx 5 notas
  ),
});
```

`block` NO es un hard stop: es una recomendación fuerte. El usuario siempre puede proceder (no
atrapamos a nadie por una heurística estocástica).

## UX del preflight

- El wizard pinta las notas antes de/junto con el plan, en un panel *"Revisamos tu campaña y
  notamos…"*: por nota, el problema (`issue`), contra qué choca (`conflictsWith`) y la sugerencia,
  con **Aceptar sugerencia / Descartar**.
- `block` invita a volver un paso (estilo, master, idea); `warn` es informativa.
- Nada se modifica en silencio.
- Descartar una nota la **recuerda** (no re-molesta al regenerar el plan) — Fase 1.

## Fronteras y limitaciones (repetir para no confiarse)

- Aditivo a `validators.ts` + `antislop`; no los reemplaza.
- Ve inputs + imágenes, **no** las escenas que el matcher escribirá después.
- Sugiere; el usuario confirma.
- Solo alta confianza: mejor callar una nota dudosa que erosionar la confianza con ruido.

## Fases

**Fase 0 (ligera, ~1–2 días):** el preflight dentro de `generatePlanAction`, reusando
`matcherImages`, devuelve `coherenceNotes` **no bloqueantes** que el wizard pinta. Una sola
llamada Flash extra, sin infra nueva, sin costo de generación. Sin memoria de descartes (stateless).
Captura ~80% del valor.

**Fase 1 (interactiva):** quick actions por nota ("regenerar master en casero", "cambiar estilo
a ultra_realista"), y **memoria de descartes** (columna `dismissed_coherence_notes` en `campaigns`,
hash de la nota, para no re-surfacear lo ya descartado al regenerar el plan).

**Fase 2 (opcional, empujar aún más arriba):** llevar el chequeo de estilo al `clarify` de
creación de personaje (`lib/creation/clarify.ts`) — que la contradicción se cace al **generar el
master**, no al armar la campaña. Es exactamente el hueco ya flagueado ("clarify consciente del
estilo": no escribir "premium clothing" en flujos caseros).

## Costo, riesgo y guardarraíles

- **Costo:** una llamada Gemini Flash por generación de plan (barata, sin thinking). **Ahorra**
  créditos al evitar generaciones malas. Se bundlea (sin cargo separado al usuario).
- **Riesgo principal:** falsos positivos que molesten. Guardarraíles: techo de 5 notas, umbral de
  confianza alto en el SYSTEM, todo descartable, `block` nunca bloquea de verdad.
- **Fail-open:** si falta `GEMINI_API_KEY` o el chequeo falla/tarda, el plan se genera igual sin
  notas (mismo criterio que los gates anti-texto del expand: filtro de calidad, no punto único de
  fallo). No añade una dependencia dura al flujo de creación.
- **Degradación a solo-texto:** si las imágenes no están disponibles (el try/catch de
  `matcherImages` ya lo contempla), el chequeo corre solo sobre inputs de texto — pierde el caso
  visual (master vs estilo) pero conserva los de descripción/idea.

## Preguntas abiertas (decisiones pendientes del usuario)

1. **¿`block` puede llegar a ser un hard stop opt-in?** (p. ej. una preferencia "no generar si
   hay contradicciones fuertes"). Default propuesto: nunca bloquea.
2. **¿Idioma del panel?** Las notas al usuario en el idioma de la campaña (es/en), como el resto.
3. **¿Se corre también al "Reprocesar idea"** (misma ruta `generatePlanAction`) o solo en la
   primera generación? Propuesto: en ambas, es la misma ruta.
4. **¿Umbral de severidad para mostrar el panel?** ¿Se muestra con cualquier `warn` o solo si hay
   al menos un `block`? Propuesto Fase 0: mostrar si hay ≥1 nota, colapsado si todas son `warn`.
