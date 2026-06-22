# Prompt Director — Propuestas a evaluar

Backlog de seguimiento. Destila el documento "Prompt Director — Checklist de procesado"
en propuestas accionables, separando lo genuinamente nuevo de lo que ya está
implementado. Cada propuesta tiene ID estable, veredicto, prioridad y una **decisión**
pendiente. Fecha de corte: 2026-06-22.

> Reencuadre clave: el "Prompt Director LLM" que describe el §11 del documento **ya
> existe**, partido en dos capas que la propuesta no distingue:
> - **Capa de idea (LLM)** → `lib/prompt-director/format-matcher.ts` (Gemini). Parte el
>   brief en tomas, una acción + un movimiento de cámara, diálogo solo si se pide, sin
>   texto en pantalla, multimodal.
> - **Capa de oficio (determinista)** → `compileSeedance` (`compilers/seedance.ts`).
>   Ensambla CRAFT con `@refs` ordenadas, topes, lip-sync vs voiceover, respelling.
>
> El nombre "Prompt Director" está reservado por contrato al **ensamblaje determinista**
> (`types.ts:1-4`, `index.ts:3`, decisión inmutable en `specs/v2/11`). Cualquier
> propuesta que mueva lógica a un LLM con ese nombre debe flagearse, no resolverse sola.

Estado del análisis: ~70-80% de la checklist ya está implementada. Lo de abajo es solo
el delta a decidir.

## Leyenda

- **Decisión:** `[ ] pendiente` · `[x] aprobada` · `[~] diferida` · `[-] rechazada`
- **Prioridad:** P0 (hacer ya) · P1 · P2 · P3
- **Esfuerzo:** S (horas) · M (1 día) · L (varios días) · XL
- **Valor:** alto · medio · bajo

---

## A. Net-new que vale la pena

### PD-01 — Normalizador de texto es-MX para el diálogo
- **Decisión:** `[x] implementada (2026-06-22)`
- **Prioridad:** P0 · **Esfuerzo:** M · **Valor:** alto
- **Qué:** expandir tokens hablados en el diálogo: `$499` → "cuatrocientos noventa y
  nueve pesos", `2x1` → "dos por uno", `24/7`, `3km`, `Dr.` → "doctor". Un número crudo
  se masca en la voz de Seedance.
- **Implementación:** `lib/prompt-director/es-mx-normalize.ts` (función pura, sin
  dependencias):
  - `numberToWordsEsMx(n, { apocope })` — conversor número→palabras es-MX a mano,
    0..999,999,999, género masculino + apócope del "uno" final ("veintiún pesos").
  - `normalizeSpokenEsMx(text)` — expande moneda (con centavos), `%`, ratios `NxM`,
    `24/7`, unidades (km/cm/mm/kg/mg/g/ml/l/m) y abreviaturas (Dr./Dra./Sr./Sra./Srta.).
  - `normalizeSpokenInDialogue(text)` — aplica lo anterior **solo a los segmentos
    entrecomillados** (todos, para timelines multi-beat; soporta comillas curvas).
  - Integrado en `compilers/seedance.ts`: `applyRespellings(normalizeSpokenInDialogue(rawAction))`
    — orden normalización → respelling, ambos solo sobre el diálogo.
  - Tests: `es-mx-normalize.test.ts` (73 casos, incluye negativos `9:16`/`480p`/`@imageN`)
    + caso de integración en `prompt-director.test.ts`.
- **Riesgo mitigado:** se aplica **solo al diálogo entrecomillado**; el andamiaje del
  prompt (`9:16`, `480p`, `3-7s:`, `@imageN`) queda intacto (cubierto por tests).
- **Nota:** no expande enteros sueltos sin símbolo ("tengo 5 ideas" queda igual) para
  evitar corromper años/teléfonos; ampliable después si hace falta. `$` se asume **pesos**
  (es-MX). Smoke test con voz real lo corre el usuario.

### PD-02 — Afinar la redacción del scene_prompt en el SYSTEM del matcher
- **Decisión:** `[x] implementada (2026-06-22)`
- **Prioridad:** P1 · **Esfuerzo:** M · **Valor:** medio
- **Qué:** tres directivas cortas en `format-matcher.ts` (`const SYSTEM`, líneas 217-303):
  1. **Visibilidad positiva** explícita ("solo vemos su cara") y reformular el `POV`
     suelto a primera persona escrita en positivo.
  2. **Una sola emoción dominante** por toma, no apilar señales (alineado con
     `errores-generacion-video §3.1`).
  3. **Supresión de texto por descripción positiva** de superficie limpia, como
     complemento (no reemplazo) de la cláusula negativa.
- **Implementación:** dos bloques nuevos en `SYSTEM`:
  - `VISIBILIDAD` + `EMOCIÓN` tras el ejemplo de cámara: declarar en positivo qué entra
    en cuadro, prohibir el `(POV)` débil (primera persona explícita), una emoción dominante.
  - Supresión de texto **positiva** (superficies limpias, encuadre fuera de letreros)
    como complemento de la prohibición negativa existente.
  - Solo es copy de prompt LLM: no se agregan campos de salida → riesgo de truncado del
    JSON (`maxOutputTokens: 4000`) mínimo. Sin test unitario (su efecto se valida con
    smoke test de voz/video, que corre el usuario). typecheck + 372 tests verdes.
- **Nota:** el bloque `scenes[]` (secuencias) NO se duplicó para no inflar el output por
  escena; las directivas globales del scenePrompt aplican igual al razonar las escenas.

### PD-03 — Endurecer beatNamesCast con characterIds
- **Decisión:** `[~] diferida (2026-06-22)` — premisa original inválida; aplicado solo el
  nudge B (origen) en vez del cambio determinista.
- **Prioridad:** P1 · **Esfuerzo:** S → en realidad L · **Valor:** medio (sin medir)
- **Caso que cierra:** "el beat describe al cast sin nombrarlo" → hoy cae a i2v y deja al
  sujeto estático.
- **HALLAZGO (flag):** los `characterIds` **NO son por-beat**: en `planner.ts:323,343` la
  rama secuencia calcula `fromIdea` **una vez** y lo copia **idéntico a todas las escenas**
  (el `scenes[]` del matcher ni siquiera lleva `characterIds` por escena). Por eso la
  recomendación original ("usa `itemCharacterIds` como señal de que el cast actúa → R2V")
  es inválida: sobre-dispararía R2V en **todos** los beats de una secuencia con cast,
  incluyendo los close-ups de producto donde el cast NO actúa — rompiendo justo la
  distinción que `beatNamesCast` existe para hacer (`orchestrator.ts:778-787`).
- **Aplicado (nudge B, origen):** `format-matcher.ts` SYSTEM — cuando un personaje del
  Cast actúa en cámara, el matcher debe **nombrarlo por su nombre propio** en el
  scenePrompt/escena (no "she"/"the woman"). Cierra el gap en el origen sin tocar la
  decisión determinista; cero riesgo de regresión. Copy de prompt (smoke test del usuario).
- **Pendiente (solo si un smoke test muestra el sujeto estático):** Opción C estructural —
  `characterIds` por escena en el matcher (`SceneSchema`) + planner, para que
  `itemCharacterIds` sea señal por-beat fiable. **No** la heurística de sujeto humano
  (Opción A: falsos positivos con personas impresas en cuadro). **No** mover el modo al LLM.

### PD-04 — Blockers estructurados por toma
- **Decisión:** `[ ] pendiente`
- **Prioridad:** P2 · **Esfuerzo:** M · **Valor:** medio
- **Qué:** campo `blockers` legible por toma para casos de **juicio semántico** (idea
  ambigua, sin acción concreta), surfaced en UI antes de reservar créditos.
- **Estado hoy:** una idea sin match válido se descarta **en silencio**
  (`campaigns.ts:577-583`).
- **Límite:** **no** mover los blockers duros de `validators.ts` (refs faltantes,
  verificables) al LLM. Mantener parse+direct en una sola llamada.

### PD-05 — Formalizar el mapa de routing §0
- **Decisión:** `[ ] pendiente`
- **Prioridad:** P2 · **Esfuerzo:** S · **Valor:** medio
- **Qué:** ampliar `docs/guia-problemas-comunes-video.md:7-13` a un mapa canónico
  síntoma → capa (matcher LLM / compiler determinista / orchestrator (mode) / provider
  Atlas / activo / UI). Documentar explícitamente que mode/params/blockers duros = capa
  determinista, no el matcher.

### PD-06 — Reglas léxicas mínimas en el validador + supresión positiva
- **Decisión:** `[ ] pendiente`
- **Prioridad:** P3 · **Esfuerzo:** S · **Valor:** bajo
- **Qué:** en `validators.ts`, solo contradicciones **léxicas** como red de seguridad:
  warning si el scene_prompt escribe la supresión de texto en negativo (`no text` /
  `sin texto`); endurecer la regla de cámara de `moves.length > 2` a `> 1` para alinear
  con el SYSTEM ("nunca dos").
- **Límite:** **no** intentar detectar contradicciones semánticas por regex (ver R-04).

### PD-07 — Hint de "un cambio por iteración" en refinado (UI)
- **Decisión:** `[ ] pendiente`
- **Prioridad:** P3 · **Esfuerzo:** S · **Valor:** bajo
- **Qué:** hint de atomicidad en el input de refinado (`StoryboardView.tsx`) y warning
  no-bloqueante opcional en `refinePanelAction` (`storyboard.ts:508`) si la instrucción
  tiene múltiples cláusulas. **No** validación dura.

### PD-08 — Warning blando de profundidad de cadena
- **Decisión:** `[ ] pendiente`
- **Prioridad:** P3 · **Esfuerzo:** S · **Valor:** bajo
- **Qué:** warning cuando una secuencia **encadenada** (no location/storyboard) supere
  ~4-5 escenas, sugiriendo modo-locación.
- **Límite:** **no** cap duro de 3-6 (cortaría narrativas legítimas; la causa raíz ya
  está mitigada por modo-locación).

---

## B. A rechazar o diferir (con razón)

### RJ-01 — §11: un único agente LLM "Prompt Director" con contrato JSON
- **Decisión:** `[ ] pendiente` (recomendado: rechazar / renombrar — ver Q-01)
- **Razón:** el matcher LLM **ya es** ese agente por-toma de una sola llamada. El aporte
  real serían 2-3 campos de schema, no la lógica. Unificarlo y darle el nombre "Prompt
  Director" colisiona con la decisión inmutable "ensamblaje determinista".

### RJ-02 — §11: mover `mode` (r2v/i2v) al LLM
- **Decisión:** `[ ] pendiente` (recomendado: rechazar)
- **Razón:** ya se decide deterministamente y bien (`seedance.ts:462` + `beatNamesCast`),
  atado a la restricción **dura de Atlas** ("no mezcla `first_frame` + referencias",
  `orchestrator.ts:788`). Un mode estocástico no-producible haría que Atlas ignore el
  panel o falle.

### RJ-03 — §11: mover params y blockers duros al LLM
- **Decisión:** `[ ] pendiente` (recomendado: rechazar)
- **Razón:** params ya en `CompiledPrompt.params`; blockers de producibilidad en
  `validators.ts:62-90` son verificables — un LLM sería menos fiable.

### RJ-04 — §6: predictor de acentuación G2P por reglas (aguda/llana/esdrújula)
- **Decisión:** `[ ] pendiente` (recomendado: rechazar)
- **Razón:** el código **ya lo consideró y rechazó** explícitamente (`pronunciation.ts:6-9`:
  "acentuar todas las paroxítonas sobre-aplica y rompe palabras que ya salen bien").
  Adoptarlo es revertir una decisión documentada. **Ojo:** la propuesta agrupa esto con
  PD-01 (normalizador es-MX) como si tuvieran el mismo riesgo — no lo tienen. PD-01 es
  seguro; el G2P general no.

---

## C. Discrepancias de spec a decidir (CLAUDE.md: flagear, no resolver en silencio)

### Q-01 — Intención del §11 y el nombre "Prompt Director"
- **Decisión:** `[ ] pendiente`
- **Tensión:** el nombre está reservado al ensamblaje determinista (`types.ts`, `index.ts:3`,
  `specs/v2/11`).
  - Si la intención es **formalizar el matcher existente** → renombrar a `Shot Planner` /
    `Brief Director` para no pisar el contrato.
  - Si la intención es **reemplazar el determinista por un LLM** → contradice una decisión
    inmutable y requiere confirmación explícita.
- **Pregunta:** ¿cuál de las dos?

### Q-02 — describeProduct re-describe el producto siempre
- **Decisión:** `[ ] pendiente`
- **Tensión:** `inventory.ts:71-84` re-describe atributos del producto (name+visualDetails+
  palette) **incluso con imagen presente** — asimetría con personaje/locación, que sí
  cumplen "nombra, no re-describas" (§2). Contradice la regla transversal de la propuesta.
- **Pregunta:** ¿alinear el producto a "nombra, no re-describas" cuando hay imagen?

### Q-03 — speech-fit.ts posible músculo muerto en el flujo plan
- **Decisión:** `[ ] pendiente`
- **Tensión:** `speech-fit.ts` no aparece importado por `planner` / `orchestrator` /
  `campaigns.ts` (sí en refinado/UI). Antes de prometer `dialogue.fits` como dato del
  pipeline `brief→plan→jobs`, verificar si está vivo ahí o solo en refinado.
- **Pregunta:** ¿es músculo muerto en el plan o intencional?

### Q-04 — Locación solo-texto vs re-anclaje de imagen
- **Decisión:** `[ ] pendiente`
- **Tensión:** `locations` permite master opcional (solo texto), pero §2/§8 y la migración
  041 asumen "re-anclar la imagen de locación en cada clip". Una locación sin imagen no
  tiene referencia visual que re-anclar. (Nota: `onlyCharacterRefs` en `index.ts:63-77`
  además desancla la locación en storyboard a propósito, porque el panel FLUX ya la
  contiene.)
- **Pregunta:** ¿exigir imagen a la locación, o documentar el fallback a texto?

---

## D. Riesgos transversales a vigilar

- **R-01:** PD-01 debe limitarse al diálogo extraído; sobre toda la acción corrompe
  marcadores del prompt.
- **R-02:** PD-02 sube tokens de salida del matcher; medir truncado antes de cablear.
- **R-03:** numero→palabras es-MX no está resuelto por librería instalada; escribir a mano
  o evitar dependencia (Vercel Hobby).
- **R-04:** las contradicciones **semánticas** ("de espaldas" + "ve la foto") no son
  detectables por regex; la prevención fiable vive en el matcher LLM, no en un validador
  posterior. No prometer un detector general.

---

## E. Ya resuelto (referencia — no re-proponer)

| Sección | Dónde |
|---|---|
| §1 intake brief → tomas | `brief.ts` + `format-matcher.ts` SYSTEM |
| §2 "nombra, no re-describas" (personaje/locación) | `seedance.ts:186-194`, `:211-218` |
| §3 paneles encadenados / video desde base limpia | `storyboard.ts:267-292`, `orchestrator.ts:683-691` |
| §4 un movimiento de cámara + ritmo | `format-matcher.ts:247-251`, `validators.ts:94` |
| §5 modo r2v vs i2v por toma | `seedance.ts:462`, `orchestrator.ts:787-866` |
| §6 ajuste de duración del diálogo | `speech-fit.ts` (ver Q-03), editor de audio por beat |
| §7 supresión de texto (vía negativa) | `NEGATIVE_CLAUSE` + SYSTEM + `stripEmoji` |
| §8 anti-degradación del encadenado | modo-locación (migración 041), re-anclaje por clip |
| §9 params/costo | 480p si `/fast/` else 720p; topes en `buildReferences` |
