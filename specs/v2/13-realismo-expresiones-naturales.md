# Fase M — Realismo y expresiones naturales (cerrar el lazo sobre la calidad percibida)

> **~2–3 días la Fase 0 · roadmap de 3 fases**
>
> El frente de calidad #1 del jefe (2026-07-04): las expresiones se ven **poco naturales y
> exageradas** (sonrisa de anuncio), en story y en video, y el look "se siente IA". La primera
> ronda de fixes fue capa de TEXTO (cláusulas de contención) y ya está en prod; el jefe lo sigue
> percibiendo. Este spec ataca la causa sistémica: **el texto pierde contra el prior del generador
> y el lazo está abierto** (nada inspecciona la salida). La palanca real es **cerrar el lazo** en
> el gate de Muestra que ya existe, más anclaje por imagen. Origen: idea del usuario 2026-07-04.

## Contexto y decisión de diseño central

Ya existe una capa determinista de contención de expresión, y está en prod:

- `NATURAL_EXPRESSION_CLAUSE` — panel fresco, expresión contenida (`lib/prompt-director/acting.ts:26`).
- `ACTING_RESTRAINT_DIRECTION` / `ACTING_ENERGETIC_DIRECTION` — actuación en video (`acting.ts:12,17`).
- `PLANNER_ACTING_BLOCK` — el matcher/refinado escribe emociones como gestos pequeños (`acting.ts:33`).
- `humanRealismDirective` / `expressionDirective` / `sceneStyleDirective` — realismo del panel
  (`lib/campaigns/storyboard.ts:91,104,120`), con guarda `declaresHighEmotion` (`acting.ts:55`).
- Balance neutro anti-amarillo en todos los perfiles (`style-profiles.ts`).

**Por qué el jefe lo sigue viendo pese a todo eso** (diagnóstico honesto):

1. **El texto pierde contra el prior del modelo.** "No wide advertising smiles" es una negación que
   el generador honra débilmente: su data de "persona + producto + feliz" ES publicidad stock. Las
   palabras empujan, no dominan. Más adjetivos = rendimiento decreciente.
2. **El lazo está abierto.** Nada inspecciona la salida. Si un panel vuelve con sonrisa de anuncio,
   se publica. Las cláusulas son esperanza, no control.
3. **La expresión se re-autora por beat.** El master ancla la IDENTIDAD, pero la expresión de cada
   panel nace fresca del verbo emocional del `scene_prompt` ("smiles warmly", "excited") — el modelo
   renderiza la versión máxima.
4. **El guion a veces declara la emoción grande.** Aun con `PLANNER_ACTING_BLOCK`, el matcher (LLM
   estocástico, PD-13) escribe "beams with joy"; y `declaresHighEmotion` deliberadamente la deja
   pasar. El compiler no contiene lo que el guion ya declaró.
5. **El video amplifica el panel.** El panel es el first-frame; una sonrisa stock ahí se amplifica
   en la actuación del clip.

### Invariante arquitectónico (no negociable)

- **El compilador sigue determinista.** Todo lo nuevo vive río arriba (autoría) o como capa de
  VERIFICACIÓN sobre la salida — nunca dentro del compile.
- **Verificar y re-rodar, no reescribir el compilado.** El crítico juzga la IMAGEN/VIDEO y decide
  regenerar (con parámetros más contenidos o seed distinto); no reescribe el prompt máquina.
- **Cost-bounded.** El lazo se cierra en la MUESTRA (2 creativos), no en el lote completo ni en
  cada generación. El usuario ya revisa la muestra ahí; es el punto natural.
- **Fail-open.** Sin `GEMINI_API_KEY` o si el crítico falla/tarda, la muestra pasa sin nota
  (filtro de calidad, no punto único de fallo). No añade dependencia dura.

## Alcance de impacto (honesto)

- **Palanca real:** cerrar el lazo en el gate de Muestra es el **primer control real** sobre la
  calidad de salida. No hace mejor al generador; **evita que una muestra con sonrisa stock se
  vuelva el lote completo** y le da al usuario un botón "regenerar más natural" respaldado por un
  juicio, no por fe. Valor moderado-alto, costo acotado.
- **Verdad incómoda:** parte de "se ve IA" es el **techo del generador** (piel plástica). Ni prompt
  ni crítico arreglan un modelo que renderiza plástico; el crítico + reroll **sube el piso** y da
  control, no sube el techo. El techo se mueve con **elección de modelo** (que el motor de
  preferencias, Fase K, puede aprender) y **anclaje por referencia**.
- **Expectativa calibrada:** sube el piso y da control; no convierte el generador en cámara real.

## Palancas (de mayor a menor apalancamiento)

### Palanca 1 — Crítico de naturalidad en el gate de Muestra (el núcleo)

La pipeline ya genera una MUESTRA de `SAMPLE_SIZE=2` creativos sueltos (`batch-selection.ts:15`)
que quedan `draft_ready` y el usuario aprueba antes del lote (`summary.ts:34`, "Aprueba los
borradores"). Ahí se engancha un chequeo automático de visión (Gemini) sobre el panel/video de la
muestra:

- Devuelve un score estructurado: `{ expressionNaturalness, photoRealism, flags: ['advertising_smile'|'plastic_skin'|'yellow_cast'|'over_saturated'] }`.
- Si la muestra puntúa mal:
  - **Auto-reroll una vez** con contención más fuerte / emoción más baja / seed distinto, **o**
  - **Surface al usuario en el gate:** "esta muestra salió con expresión de anuncio —
    [Regenerar más natural] [Aceptar igual]".
- Corre sobre ~2 muestras, no el lote → costo acotado. UX natural (el usuario ya está en ese gate).
- Es el patrón "verify/critic" aplicado a CALIDAD DE SALIDA — el lazo cerrado que falta.

### Palanca 2 — Anclaje de expresión al baseline calmo del master (estructural)

Mostrarle al modelo una cara natural gana a describirla. El master ya es un retrato neutro y calmo
(`portraitSetting`), y el storyboard lo pasa como referencia — pero la expresión se re-autora por
beat. Opciones:

- Reforzar la instrucción del panel para **mantener la expresión cerca del baseline calmo del
  master** salvo que el beat pida explícitamente otra cosa (barato, texto pero anclado a imagen).
- Curar un set pequeño de **exemplars de expresión natural** (sonrisa leve, pensativo, enfocado) y
  pasar el relevante como nudge de referencia (más esfuerzo, más apalancamiento).

### Palanca 3 — Damper de emoción en autoría (barato, techo bajo)

Extender los validators (`findUnexpandedActions` ya avisa de emoción abstracta) para **marcar
lenguaje de intensidad emocional** ("beams with joy", "grins widely", "laughs excitedly"). Warn-only
o dampear solo los ADVERBIOS ("widely", "excitedly"), nunca reescribir el beat completo. Alimenta
al crítico de la Palanca 1.

### Palanca 4 — Tie-in con el motor de preferencias (juego largo, Fase K)

Los scores del crítico (Palanca 1) alimentan `recipe_stats`: aprender qué formato/modelo/seed rinde
natural y sesgar hacia ahí. Cierra el lazo a nivel de RECETA, no solo por muestra.

## Fases

**Fase 0 (~2–3 días):** Palanca 1 en modo **advisory** — crítico de visión sobre las muestras
`draft_ready`, guarda el score en el item (columna `quality_flags` jsonb) y lo surface en el gate
de aprobación con el botón "Regenerar más natural" (regen manual, sin auto-reroll todavía). Sin
infra nueva más allá de la columna. Captura el grueso del valor.

**Fase 1:** **auto-reroll** una vez cuando el score cae bajo un umbral, con parámetros más
contenidos (emoción baja + seed distinto), antes de mostrar la muestra. Más la Palanca 3 (damper
en validators).

**Fase 2:** Palanca 2 (exemplars de expresión) y tie-in con Fase K (los scores alimentan el motor
de preferencias).

## Costo, riesgo y guardarraíles

- **Costo:** una llamada de visión Gemini por muestra (~2 por campaña), no por item. Barata; el
  auto-reroll de Fase 1 suma como máximo 1 regen por muestra fallida.
- **Riesgo:** el crítico es estocástico — un umbral muy agresivo re-rueda de más (costo + latencia)
  o molesta. Guardarraíles: advisory primero (Fase 0), umbral conservador, auto-reroll capado a 1,
  siempre con "Aceptar igual".
- **Fail-open:** sin API key o si falla, la muestra pasa sin nota.

## Preguntas abiertas (decisión del usuario)

1. **Fase 0 advisory vs auto-reroll de una:** ¿arrancamos solo mostrando la nota + botón manual, o
   ya con auto-reroll? Propuesto: advisory primero (ver falsos positivos reales antes de gastar
   regens automáticos).
2. **¿El crítico juzga el PANEL, el VIDEO, o ambos?** El panel es más barato y es el origen (el
   video lo hereda). Propuesto Fase 0: panel; video en Fase 1 si hace falta.
3. **Umbral y flags:** ¿qué flags accionan reroll vs solo warn? (`advertising_smile` y
   `plastic_skin` accionan; `yellow_cast` ya lo cubre el balance neutro determinista → solo warn).
4. **¿Aplica a estilos no foto-reales?** Animado/fantasía no deben juzgarse por "realismo". El
   crítico se gatea por `profile.photoreal` (solo ultra_realista y casero), igual que
   `humanRealismDirective`.
