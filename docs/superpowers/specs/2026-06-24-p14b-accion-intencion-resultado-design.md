# P14b — Acción como intención + resultado (anti-biomecánica)

**Fecha:** 2026-06-24
**Tanda:** P1 (primera entrega; sucede a P0 = P14/P20/P21)
**Esfuerzo:** S
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Principio P14b del análisis Higgsfield (`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md`, ficha P14b). Regla del marketing-studio-director: la acción se describe por su **intención + resultado** ("destapa la botella, la deja en la mesa"), **no** por su biomecánica articular ("la mano derecha rota la tapa en sentido antihorario mientras la izquierda estabiliza").

## Por qué

Hay un punto óptimo de especificidad al dirigir una acción:

- **Demasiado abstracto** pierde control → lo cubre **P14** (ya implementado): descompone verbos abstractos ("baila", "se ve triste") en micro-acciones observables.
- **Demasiado mecánico** genera artefactos → lo cubre **P14b** (este spec): el modelo tiene un prior físico aprendido; sobre-especificar la mecánica articulación-por-articulación lo confunde y produce manos/movimientos rotos.

P14 y P14b son las dos caras del mismo eje. Juntos definen el sweet spot: dirige el **qué-se-ve** (gesto observable, resultado), deja que el modelo resuelva el **cómo** (la mecánica).

## Estado actual (la brecha)

El SYSTEM del matcher ya **modela por ejemplo** el punto óptimo (`format-matcher.ts:256-311`, ej. "she lifts the can to camera… she takes a sip and nods… the can rests, label forward"), pero **no existe una regla explícita anti-biomecánica** ni una red determinista que detecte sobre-mecánica si el brief del usuario la introduce o el LLM la genera. El `antislop` ataca adjetivos vacíos y keyword-soup, no over-specification física. Si un brief trae biomecánica detallada, hoy pasa intacta al compiler y puede producir artefactos.

## Diseño

Dos capas, fiel a la arquitectura del Prompt Director (IDEA estocástica + OFICIO determinista), espejando exactamente cómo se implementó P14.

### Capa IDEA — directiva en el matcher (estocástica)

Extender la regla **ACCIÓN Y EMOCIÓN** del SYSTEM (`format-matcher.ts:290-296`) con una segunda mitad anti-mecánica, **contigua** a la de descomposición de P14, para que el LLM vea las dos caras del mismo eje en el mismo lugar.

Contenido (redacción final se afina en implementación; intención exacta):

> "…pero no te pases al otro extremo: describe cada acción por su INTENCIÓN y RESULTADO visible ('destapa la botella y la deja en la mesa'), nunca por su biomecánica articular ('la mano derecha rota la tapa en sentido antihorario mientras la izquierda estabiliza'). El modelo resuelve el CÓMO con su prior físico; sobre-detallar la mecánica (qué músculo, qué ángulo, qué articulación) genera artefactos."

**Reconciliación con P14:** los gestos observables que P14 pide ("dos asentimientos de cabeza, un chasquido de dedos") son **resultados visibles**, no mecánica. La directiva distingue explícitamente *gesto observable* (correcto) de *mecánica articular/muscular con sentido/ángulo/músculo nombrado* (incorrecto). No se contradicen.

### Capa OFICIO — red determinista (pura)

Nueva función exportada en `lib/prompt-director/acting.ts` (módulo de actuación, junto a `findUnexpandedActions`):

```ts
export function findOvermechanicalActions(text: string): string[]
```

- **Entrada:** el `scenePrompt` compilado (siempre en inglés — salida del matcher).
- **Salida:** las frases ofensivas detectadas (para citarlas en el warning).
- **Determinista y pura:** sin DB, sin API, sin estado. Mismo input → mismo output.

**Marcadores objetivo** (señal de sobre-mecánica), elegidos para ser **disjuntos** de los gestos buenos que P14 lista en `CONCRETE_ACTION_RE` (nod/snap/lean/knee/hand/etc.) — el detector **no** debe tocar verbos de gesto simples:

1. **Sentido de rotación:** `clockwise` / `counterclockwise` / `anticlockwise`
2. **Grados:** `90-degree`, `45 degrees`, `at a N-degree angle`
3. **Mano-estabiliza-mano:** `while the (left|right|other) hand stabilizes / steadies / holds / braces`
4. **Mecánica articular nombrada:** `flexes / extends the wrist|elbow|knee|shoulder`, `rotates the wrist`, `joint by joint`, `muscle by muscle`
5. **Respaldo ES** (por si se cuela en español): `sentido horario|antihorario`, `articulaci[óo]n` en contexto mecánico

Detector **inglés-primario** (el scenePrompt siempre es inglés) con unos pocos tokens ES de respaldo. Basta la **presencia** de un marcador para marcar el tramo: estos términos casi nunca son legítimos en una dirección de actuación.

### Validator — warning no bloqueante

Nueva regla en `lib/prompt-director/validators.ts`, siguiendo el patrón de la regla 10 de P14 (warning de producibilidad, no error, no reescribe):

- **Disparador:** `findOvermechanicalActions(scenePrompt)` devuelve ≥1 frase.
- **Mensaje** (prefijo propio para que sea testeable y se distinga del warning de P14):

  > `actuación: sobre-mecánica en "<frase>" — descríbela por intención y resultado, no por la mecánica articular`

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `lib/prompt-director/format-matcher.ts` | Extender la regla ACCIÓN Y EMOCIÓN del SYSTEM con la mitad anti-biomecánica |
| `lib/prompt-director/acting.ts` | Nueva función pura `findOvermechanicalActions(text)` + su regex de marcadores |
| `lib/prompt-director/validators.ts` | Nueva regla: warning con prefijo `actuación: sobre-mecánica…` |
| `lib/prompt-director/acting.test.ts` | Tests del detector (positivos por grupo + no-falso-positivo sobre ejemplos P14) |
| `lib/prompt-director/validators.test.ts` | Test de la regla (emite warning / ausente en prompt limpio) |

## Tests (TDD)

- **`acting.test.ts`** — `findOvermechanicalActions`:
  - Marca cada uno de los 5 grupos de marcadores.
  - **No** marca las descomposiciones buenas de P14 (ej. "two head nods, a shoulder turn, a knee bend, a finger snap"), ni acciones intención-resultado normales (ej. "she uncaps the bottle and sets it on the table").
- **`validators.test.ts`** — la regla emite el warning con su prefijo cuando hay sobre-mecánica; ausente cuando el prompt es limpio.
- Sin APIs reales (red determinista pura); cumple `feedback_no_real_api_in_tests`.

## Calibración / riesgo único

**Riesgo:** que el detector marque por error las micro-acciones buenas que P14 pide.

**Mitigación:** el marcador set es **disjunto** de `CONCRETE_ACTION_RE` — solo apunta a rotación-con-sentido, grados, mano-estabiliza-mano y articulación/músculo nombrados; nunca a verbos de gesto simples (nod, snap, lean, step). Test explícito de no-falso-positivo sobre los ejemplos canónicos de P14 cierra el riesgo.

## Decisiones inmutables — verificación

- **>60s / QStash:** no aplica; la compilación del prompt es síncrona y barata, sin nuevas llamadas (la directiva del matcher viaja en la única llamada a Gemini ya existente).
- **URLs de proveedor al cliente:** no toca generación ni Storage.
- **Créditos vía SQL:** no toca créditos.
- **RLS / service role:** no toca DB.
- **Capa OFICIO determinista:** el detector es puro, testeable, mismo input → mismo output, como `stripSlop` / `findUnexpandedActions`.
- **`feedback_fix_generator_not_output`:** el fix vive en el generador (directiva del matcher + red determinista), no en hand-patch de `campaign_items`.

## Fuera de alcance

- Reescritura/colapso automático de la sobre-mecánica (se decidió warning-only, consistente con todo P0).
- Cualquier cambio de UI, DB o proveedor.
- P16 (pista musical) — feature independiente, su propio spec.

## Verificación posterior

- `pnpm typecheck` limpio.
- Suite verde (incluye los nuevos tests).
- Smoke opcional del usuario: una idea con biomecánica explícita en el brief debe (a) salir limpia del matcher por la directiva, y (b) si se cuela, disparar el warning. Los smokes con API real los corre el usuario.
