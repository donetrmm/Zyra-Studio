# P13 — Bloqueo geo-espacial (Lean)

**Fecha:** 2026-06-24
**Tipo:** Red determinista en el prompt-director (mismo patrón que P14/P20/P21)
**Esfuerzo:** S-M
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Principio P13 del análisis Higgsfield (`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md`, ficha P13): especificar la **posición relativa** de cada sujeto respecto al entorno y a los demás (con orientación y, si aplica, distancia) le da al modelo una "planta de escena" consistente. Sin ella, en escenas multi-sujeto el modelo **reubica/teletransporta** a los personajes, y entre cortes la continuidad espacial se rompe.

## Problema

Hoy NO existe ninguna estructura espacial en el prompt-director. La posición solo aparece como free-text incidental dentro del `scenePrompt` que emite el matcher. El SYSTEM dirige **dirección de desplazamiento** (forward/left-to-right) y **visibilidad en positivo**, pero nunca **posición estática relativa**. El compiler cita a cada personaje por identidad/vestuario pero **nunca dice dónde está** (`seedance.ts:203-227`); el multi-speaker fija quién habla, no dónde. Resultado: escenas con 2+ personajes sin planta → reubicación.

## Decisión de alcance (aprobada): Lean

P13 tiene tres piezas posibles: (a) validator que avisa, (b) campo `staging` de primera clase en el matcher, (c) directiva "Staging:" en el compiler, + continuidad entre escenas. **Se implementa el núcleo Lean = SYSTEM + validator**, que entrega el ~80% del valor al mismo peso que P14/P20/P21, sin migración ni schema ni compiler.

- **Implementado:** directiva SYSTEM (el matcher produce bloqueo explícito en el `scenePrompt` para escenas multi-sujeto) + validator rule 14 (avisa cuando falta).
- **Diferido (cola cara):** campo `staging` en el matcher + directiva "Staging:" en el compiler + columna dedicada; **continuidad** (re-inyectar el bloqueo entre escenas de una misma secuencia / encadenado) — la pieza más cara, depende de persistir el bloqueo como dato estructurado.

## Diseño

### 1. Directiva SYSTEM en el matcher (capa IDEA)

En `lib/prompt-director/format-matcher.ts`, añadir una instrucción al SYSTEM (en la sección que ya guía dirección/visibilidad, junto a las directivas de P21/P14): cuando una escena tiene **2+ sujetos** o relaciones espaciales claras entre sujeto y entorno, el `scenePrompt` debe declarar **bloqueo explícito**, tejido en la prosa:
- posición relativa de cada sujeto (left/right/foreground/background/between/behind…),
- orientación (facing camera-left / camera-right / each other),
- el ancla del entorno relevante (la puerta a camera-left, el producto en primer plano).

Corto, en inglés, dentro del mismo `scenePrompt` (donde el modelo ya lo lee). Esto guía a la capa estocástica a PRODUCIR el bloqueo; la regla 14 lo hace exigible. Aplica tanto a las escenas de secuencia como al clip único.

### 2. Detector puro — `lib/prompt-director/spatial.ts` (NUEVO)

Espeja `lib/prompt-director/acting.ts` (módulo puro, testeable, sin estado). Exporta:

```ts
// Detecta si un scenePrompt declara bloqueo espacial explícito.
export function hasSpatialBlocking(text: string): boolean;
```

`hasSpatialBlocking` devuelve `true` si el texto contiene ≥1 marcador espacial. Marcadores (regex case-insensitive, en inglés porque el `scenePrompt` siempre va en inglés):
- **Posición:** `left`, `right`, `foreground`, `background`, `midground`, `behind`, `in front of`, `next to`, `beside`, `between`, `opposite`, `across from`, `far side`, `near side`, `center`/`centre`.
- **Orientación:** `facing`, `faces`, `turned toward`, `camera-left`, `camera-right`.
- **Distancia:** `meter`/`metre`/`meters`/`metres`, `feet`, `apart`, `arm's length`.

Diseño deliberadamente **lenient** (cualquier marcador → tiene bloqueo): es un warning suave, preferimos no sobre-avisar. Los falsos negativos (no avisar aunque el bloqueo sea pobre) son aceptables; los falsos positivos (avisar cuando sí hay bloqueo) no.

### 3. Validator rule 14 (red determinista)

En `lib/prompt-director/validators.ts`, nueva **regla 14** tras la regla 13 (P01, `:202-209`), siguiendo la forma de las reglas existentes (`warnings.push`, prefijo de dominio):

```ts
// Regla 14 (P13): bloqueo geo-espacial. Una escena con 2+ sujetos sin
// marcadores de posición/orientación deja al modelo libre de reubicarlos.
const multiSubject = (ctx.characters?.length ?? 0) >= 2 || MULTI_SUBJECT_RE.test(scenePrompt);
if (multiSubject && !hasSpatialBlocking(scenePrompt)) {
  warnings.push(
    'espacial: escena con 2+ sujetos sin bloqueo (posición relativa/orientación); el modelo puede reubicarlos entre cortes',
  );
}
```

- `MULTI_SUBJECT_RE` ya existe (`validators.ts:37`); `ctx.characters` ya se lee en el archivo (`:123`).
- `scenePrompt` es el texto que la regla evalúa (igual que las reglas 10-13).
- Import de `hasSpatialBlocking` desde `./spatial` (igual que `acting.ts` se importa en `:7`).
- El warning se acumula en `ValidationResult.warnings` → `CompiledPrompt.warnings` → `campaign_items.warnings` (cadena existente; sin cambios).

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `lib/prompt-director/spatial.ts` | NUEVO — `hasSpatialBlocking(text): boolean` puro |
| `lib/prompt-director/spatial.test.ts` | NUEVO — tests del detector |
| `lib/prompt-director/validators.ts` | regla 14 (espacial) + import de `./spatial` |
| `lib/prompt-director/validators.test.ts` | casos de la regla 14 |
| `lib/prompt-director/format-matcher.ts` | directiva SYSTEM de bloqueo multi-sujeto |

**Sin migración, sin schema-column, sin cambio de compiler.**

## Tests

- **`spatial.test.ts`:** `hasSpatialBlocking` → `true` con "Marco on the left facing camera-right, Ana on the right"; `true` con "the product in the foreground, the model behind it"; `false` con "Marco and Ana talk excitedly"; `false` con "" .
- **`validators.test.ts` (regla 14):**
  - 2 personajes (`ctx.characters` con 2) + `scenePrompt` sin marcadores → emite el warning `espacial:`.
  - 2 personajes + `scenePrompt` con bloqueo ("on the left … on the right") → NO emite el warning.
  - 1 personaje + sin marcadores → NO emite el warning (no es multi-sujeto).
  - `scenePrompt` con prosa multi-sujeto ("two friends", según `MULTI_SUBJECT_RE`) sin personajes en `ctx` y sin marcadores → emite el warning.
- **Directiva SYSTEM:** validada por smoke (texto del prompt); las reglas existentes no regresan.
- Sin APIs reales (`feedback_no_real_api_in_tests`).

## Decisiones inmutables — verificación

- **Arquitectura intacta:** 100% texto en el prompt-director + una directiva en el SYSTEM ya existente. No toca QStash, créditos, RLS, Storage, UI.
- **Sin migración** (el núcleo Lean no persiste bloqueo estructurado; vive en el `scenePrompt`).
- **Determinismo del OFICIO:** la regla 14 es una función pura sobre `scenePrompt` + conteo de sujetos (mismo input → mismo warning). El SYSTEM solo SUGIERE (capa IDEA estocástica); la red determinista enforce. `feedback_fix_generator_not_output`: arreglamos el generador (matcher + validator), no hand-patcheamos la salida.
- **Sin emojis; sin `any`** (tipos explícitos en `spatial.ts`).

## Fuera de alcance

- Campo `staging` de primera clase en el matcher + directiva "Staging:" determinista en el compiler + columna dedicada.
- **Continuidad intra-secuencia / encadenado** (re-inyectar el bloqueo de la 1ª escena en las siguientes del mismo `sequence_id` / `buildContinuationPrompt`): la pieza más cara; requiere persistir el bloqueo como dato estructurado. Queda para una fase futura junto con el campo `staging`.
- Bloqueo derivado del panel/imagen base en modo Locación/storyboard.

## Verificación posterior

- `pnpm typecheck` limpio; suite verde (tests de `spatial` + regla 14; sin regresión en validators).
- Smoke del usuario: generar una idea multi-personaje (dos personas en una escena) y confirmar en el `scenePrompt` compilado que aparece bloqueo explícito (posición/orientación); y que una escena multi-sujeto sin bloqueo levanta el warning `espacial:` en `campaign_items.warnings`.
