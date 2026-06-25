# P05 — Estado del personaje en ideas de un solo clip

**Fecha:** 2026-06-25
**Tipo:** Extension de P05 (variantes de estado del personaje) al camino de idea normal + override manual por item
**Esfuerzo:** S-M
**Estado:** diseño aprobado, pendiente de plan de implementacion

## Origen

P05 (variantes de estado fisico del personaje: seco/mojado/sudado, horneadas como referencias) quedo IMPLEMENTADO pero con un limite confirmado por la auditoria operacional (2026-06-25): el estado **solo fluye en ideas multi-escena (secuencia)**. En una idea de **un solo clip** (rama normal) el hint nunca se declara, aunque el personaje tenga variantes horneadas.

El usuario aprobo cerrar ese limite con **ambos** mecanismos: (1) que el matcher **infiera** el estado para el clip unico igual que ya lo hace por escena en secuencias, y (2) un **override manual** por item para que el usuario elija/cambie el estado antes de generar.

## Problema

Dos huecos concretos, ambos en el "borde de entrada" del feature (el downstream ya esta cableado):

1. **Inferencia ausente en clip unico.** El matcher solo emite `characterStateHint` dentro de cada `scene` de una secuencia (`SceneSchema`, `format-matcher.ts:112`). El `MatchSchema` de nivel idea (clip unico) **no tiene** ese campo, y `buildDirectedPlan` en su rama normal hardcodea `characterStateHint: null` (`planner.ts:463`). Resultado: una idea de un clip nunca declara estado.
2. **Sin control manual.** Hoy `character_state_hint` no lo lee ni edita ningun componente; el unico modo de fijarlo es la inferencia del matcher. No hay forma de que el usuario lo corrija si el matcher eligio mal (o no eligio).

Todo lo de **aguas abajo ya existe y es agnostico de secuencia**: `directorContextFor` resuelve `item.character_state_hint` por match EXACTO contra los estados horneados del personaje y sustituye `masterImagePath` por la variante (cae al master neutro si no matchea, degradacion limpia); el compiler de Seedance hace cita condicional por `stateLabel`; y la columna `campaign_items.character_state_hint` ya existe (migracion 045, aplicada). **Sin migracion, sin cambio de orchestrator ni de compiler.**

## Decision de alcance (aprobada): Ambos

Se implementan dos componentes que comparten todo el downstream:

- **A. Inferencia (capa IDEA):** el matcher emite `characterStateHint` a nivel idea para el clip unico, en paridad con el camino de secuencia. Stochastico (sugiere); elige de la lista CERRADA de estados horneados del Cast (no inventa).
- **B. Override (UI por item):** un selector "Estado" en el `EditItemDialog` existente, que escribe `character_state_hint` del item via la action existente. Explicito del usuario; gana sobre la inferencia por last-write-wins (el matcher rellena en plan-time, el usuario edita despues).

Ambos respetan el modelo **single-state-per-item** de P05 (un label por item, no varios estados simultaneos).

## Diseño

### A. Inferencia (matcher -> clip unico)

1. **`MatchSchema` (nivel idea), `lib/prompt-director/format-matcher.ts`:** anadir un campo `characterStateHint` de nivel idea con el MISMO patron zod que `SceneSchema:112`:
   ```ts
   characterStateHint: z.string().trim().nullable().catch(null).default(null),
   ```
   Hoy `MatchSchema` (~`:122-185`) tiene `scenePrompt`, `durationS`, `sceneSummary`, `scenes[]`, `characterIds`, etc., pero ningun `characterStateHint` de nivel idea. Se anade junto a los campos de nivel idea (p. ej. tras `sceneSummary`/`durationS`).

2. **Directiva SYSTEM, `format-matcher.ts`:** anadir una instruccion para el caso de clip unico que ESPEJA la per-escena (`:365-368`). El matcher ya recibe los estados disponibles por personaje en el pool del Cast (`(estados: sudado, mojado…)`, `:439`, via `MatcherCharacter.states`, `:25`). La directiva dice, en resumen: *"Para una idea de un solo clip (sin `scenes`), si la accion describe a un personaje del Cast en uno de sus estados listados, pon ese label EXACTO en `characterStateHint` de nivel idea; si no aplica o no hay estados, null."* Misma semantica de match EXACTO que el camino de secuencia.

3. **`DirectedIdea` + mapeo, `lib/campaigns/planner.ts` y `server-actions/campaigns.ts`:**
   - `DirectedIdea` (`planner.ts:279`) gana un campo de nivel idea `characterStateHint: string | null`.
   - El mapeo del match a `DirectedIdea` en `server-actions/campaigns.ts` (donde se arma `directed[]` propagando `scenes: m.scenes`) propaga tambien `characterStateHint: m.characterStateHint ?? null`.

4. **`buildDirectedPlan` rama normal, `planner.ts:463`:** sustituir el `characterStateHint: null` hardcodeado por `idea.characterStateHint ?? null`.
   - **count>1:** los N creativos de una idea normal comparten el mismo estado inferido (son variaciones del mismo concepto). El usuario los diferencia con el override (B).
   - **NO se toca `buildPlan` (`:549`):** el planner generico de mezcla no parte de texto de idea, asi que no hay nada que inferir; sus items siguen en `null` (correcto).

### B. Override (UI por item)

1. **`StudioCharacterOption`, `components/campaigns/CampaignStudioView.tsx:74`:** pasa de `{ id, name }` a `{ id, name, states: string[] }` (los labels de estados horneados del personaje).

2. **Carga de datos, `app/app/campaigns/[id]/page.tsx:81`:** el `characterOptions` se arma desde `characterRows`; se extiende para cargar los estados por personaje (de `character_states`) y mapear `states`.

3. **`EditItemDialog`, `CampaignStudioView.tsx:1752`:** anadir un `<select>` "Estado" cuyas opciones son los estados del **personaje principal** del item (el `characterId` ya seleccionado en el dialog) + una opcion "Ninguno (neutral)". El valor inicial es el `character_state_hint` actual del item. Si el personaje principal no tiene estados horneados, el selector no se muestra (nada que elegir).

4. **Guardado, `lib/schemas/campaigns.ts` y `server-actions/campaigns.ts`:**
   - `UpdateCampaignItemSchema` gana `characterStateHint: z.string().trim().nullable().optional()` (o equivalente; null = limpiar a neutral).
   - `updateCampaignItemAction` (`:767`) escribe `character_state_hint` en `campaign_items` cuando el campo viene en el input. La action ya selecciona la columna (`:1011`); solo falta el UPDATE.
   - El dialog incluye `characterStateHint` en la llamada a `updateCampaignItemAction` y en el `patch` de `onSaved` para reflejarlo en el cliente.

5. **Precedencia:** trivial y sin logica nueva. El matcher rellena `character_state_hint` en plan-time; el usuario lo edita despues; ambos escriben la MISMA columna -> last-write-wins. El override "gana" simplemente por ser posterior.

### Decision menor (resuelta)

- El selector del override usa los estados del **personaje principal** del item (`characterId[0]`), consistente con el modelo single-state-per-item. (No se listan estados de todos los personajes del item.)

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `lib/prompt-director/format-matcher.ts` | `MatchSchema`: campo `characterStateHint` de nivel idea + directiva SYSTEM para clip unico |
| `lib/campaigns/planner.ts` | `DirectedIdea` gana `characterStateHint`; `buildDirectedPlan` rama normal (`:463`) lee `idea.characterStateHint` |
| `server-actions/campaigns.ts` | mapeo match->`DirectedIdea` propaga `characterStateHint`; `updateCampaignItemAction` escribe `character_state_hint` |
| `lib/schemas/campaigns.ts` | `UpdateCampaignItemSchema` acepta `characterStateHint` |
| `components/campaigns/CampaignStudioView.tsx` | `StudioCharacterOption` gana `states`; `EditItemDialog` selector "Estado" |
| `app/app/campaigns/[id]/page.tsx` | `characterOptions` carga `states` por personaje |

**Sin migracion. Sin cambio de `orchestrator.ts` ni de los compilers.**

## Tests

- **Matcher (`format-matcher.test.ts`):** un match de idea normal con `characterStateHint` en el JSON -> el campo se parsea y queda en el resultado de nivel idea; ausente/invalido -> `null` (patron `.catch(null)`).
- **Planner (`campaigns.test.ts` / `planner*.test.ts`):** una `DirectedIdea` normal con `characterStateHint` -> los items de `buildDirectedPlan` (rama normal) llevan ese hint; `buildPlan` (generico) sigue en `null`; count>1 -> los N items comparten el hint.
- **Schema (`campaigns` schema test si existe, o un test de la action):** `UpdateCampaignItemSchema` acepta `characterStateHint` (string y null) y lo rechaza si no es string|null.
- **Sin APIs reales** (`feedback_no_real_api_in_tests`): el matcher se prueba con respuesta mockeada; el render del selector y el bake/render real los valida el smoke del usuario.

## Decisiones inmutables — verificacion

- **Sin migracion:** la columna `campaign_items.character_state_hint` ya existe (045). El override y la inferencia solo la escriben.
- **Arquitectura IDEA/OFICIO:** la inferencia es capa IDEA (el matcher SUGIERE, stochastico); la resolucion determinista (`directorContextFor`, match exacto, fallback a master neutro) NO cambia. El override es input explicito del usuario, no toca el determinismo del OFICIO.
- **`feedback_fix_generator_not_output`:** la inferencia se arregla en el generador (matcher SYSTEM + planner), no hand-patcheando items; el override es una edicion de usuario legitima sobre el item, equivalente a editar el `scenePrompt` o el personaje (que ya se permite).
- **Sin servicios nuevos, sin creditos, sin QStash, sin RLS nueva:** la action `updateCampaignItemAction` ya existe con su validacion de ownership. Sin URLs de proveedor al cliente.
- **Sin `any`, sin emojis.** Dark mode / sistema visual intactos (un `<select>` shadcn como los ya presentes en el dialog).

## Fuera de alcance

- **Multi-estado por item** (dos personajes, cada uno en un estado distinto en el mismo clip): se conserva el modelo single-state-per-item de P05.
- **Inferencia en el planner generico `buildPlan`** (`:549`): no hay texto de idea que interpretar; queda `null`.
- **Veo/Kling:** la cita de estado es Seedance-only (limitacion existente de P05, no se amplia aqui).
- **Modo storyboard:** el estado en beats de storyboard queda fuera (ya estaba diferido en P05: `humanRealismDirective` del storyboard / estado intra-cadena).
- **Mostrar el estado en la tarjeta del item** (fuera del dialog de edicion): polish opcional, no requerido para que el feature sea operacional.

## Verificacion posterior

- `pnpm typecheck` limpio; suite verde (matcher + planner + schema; sin regresion en el camino de secuencia ni en `updateCampaignItemAction`).
- Smoke del usuario:
  1. Hornear un estado (p. ej. "sudado") para un personaje en el Cast.
  2. Idea de **un solo clip** que describa a ese personaje sudado -> confirmar que el item compilado usa la variante (no el master) y que el compiler cita el estado.
  3. En `EditItemDialog`, cambiar el "Estado" del item a "Ninguno" -> regenerar -> confirmar que vuelve al master neutro; y elegir otro estado -> confirmar que sustituye.
