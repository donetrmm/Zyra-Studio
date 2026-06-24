# P05 — Variantes de estado físico del personaje

**Fecha:** 2026-06-24
**Cluster:** Pre-producción de assets (sub-proyecto 3 de 3; cierra el cluster tras P01 y AM)
**Esfuerzo:** M-L (el más grande del cluster)
**Estado:** diseño aprobado, pendiente de plan de implementación

## Origen

Principio P05 del análisis Higgsfield (`docs/Generación de videos con IA/hallazgos-higgsfield-completo.md`, ficha P05): los estados físicos previsibles (mojado, sudado, sucio, despeinado) se **pre-generan como variantes de referencia distintas**, no se piden por texto en tiempo de animación. Un salto de estado grande pedido verbalmente deforma al sujeto; la variante pre-horneada mantiene la identidad estable.

## Problema

Hoy un personaje tiene UN estado (la hoja maestra neutra) + ángulos del mismo estado. Un cambio físico solo cabe por TEXTO en el `scene_prompt` — justo lo deformante. Y la cita del compiler ordena "use only the face, hair and build (**not its clothing**)" (`seedance.ts:209`), así que el vestuario/piel del estado se ignoraría aunque existiera la variante.

## Decisiones de alcance (aprobadas)

- **Character-only** (no estados de producto: el modelo de producto no lo soporta y la ficha no lo propone).
- **El matcher elige de los labels CONOCIDos** del personaje (sin fuzzy-match): recibe los labels de estado en el pool y emite el label exacto o null. Resolución determinista.
- **Diferido (cola cara):** relajar `humanRealismDirective` del panel fresco de storyboard (otro path); estado variando ENTRE escenas de una misma cadena (hoy `characterImagePaths` se hornea en el clip 1); estados de producto.

## Diseño

### A. Migración `045_character_states.sql`

Tabla nueva (NO columnas sueltas en `characters`, para no romper el contrato master) **+ una columna en `campaign_items`** para que el hint del matcher llegue al orchestrator en tiempo de generación:

```sql
create table character_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  label text not null,
  state_image_id uuid references media_references(id) on delete set null,
  description text,
  created_at timestamptz not null default now()
);
create index character_states_character_id_idx on character_states(character_id);

-- El hint de estado por escena que sugiere el matcher (label exacto o null).
-- Vive en el item porque el orchestrator lo consume en GENERACIÓN (directorContextFor),
-- no en plan (a diferencia de beatRole, que el planner consume y no persiste).
alter table campaign_items add column character_state_hint text;
```

RLS de `character_states` **member-scoped espejando `characters`** (las policies de `characters` son la plantilla exacta: select/insert/update/delete por membresía del workspace). `campaign_items` ya tiene sus policies; la columna las hereda.

### B. CRUD — `server-actions/character-states.ts`

Espeja `server-actions/cast.ts`. Acciones: `createCharacterStateAction`, `listCharacterStatesAction(characterId)`, `deleteCharacterStateAction(id)`. Cada una valida ownership (`requireWorkspace`) y que `state_image_id` sea una `media_reference` `type='image'` del workspace (reusa el helper `validateImageOwnership` de `cast.ts`). Schema zod: `characterId` uuid, `label` (trim, máx 40), `stateImageId` uuid, `description?` (máx 300).

### C. Hornear la variante

`generateCharacterState(masterRef: { id: string; storagePath: string }, statePrompt: string)` en `components/creation/generate.ts`, vía **`editUploaded`** (ref-based; funciona con master subida o generada, igual que `generateProductAngle` de P01). El prompt preserva identidad y cambia SOLO el estado físico:

> "Same exact face, hairstyle, build and identity as the reference person, now with [STATE, e.g. wet hair and soaked clothing, sweat on the forehead]. Keep the person's identity perfectly consistent — only the physical state (wardrobe and skin) changes. Same plain background and even studio lighting."

(El `[STATE]` lo arma el caller desde la descripción/label que el usuario da.)

UI en `components/cast/CastPage.tsx`: por personaje, una sección "Estados" con un botón "Agregar estado" → label + descripción del estado → genera desde el `master_image_id` → el resultado se registra como `media_reference` y se crea la fila `character_states` (vía `createCharacterStateAction`). Lista los estados existentes con opción de borrar.

### D. Inyección per-escena (orchestrator) + cita condicional

1. **Cargar estados:** `loadCampaignContext` resuelve, por personaje, sus estados → `Map<label, state_image_path>` (un query a `character_states` + `resolvePaths` de los `state_image_id`). Se guarda en el `CampaignContext` (junto a los characters).

2. **Sustituir por escena:** en `directorContextFor`, para cada character del item, si `item.character_state_hint` existe en los estados del personaje (match exacto por label), **sustituir `masterImagePath` por el `state_image_path`** y setear `CharacterInventory.stateLabel = label`. Sin match → master neutro, `stateLabel` undefined (degradación limpia, nunca bloquea).

3. **Tipo:** `CharacterInventory.stateLabel?: string` (`lib/prompt-director/types.ts`).

4. **Cita condicional (compiler):** en `seedance.ts`, la cita del character cambia según `stateLabel`:
   - Sin estado (hoy): `@imageN is {name} — use only the face, hair and build from this reference (not its clothing or background), kept consistent`.
   - Con estado: `@imageN is {name} — keep the exact face, hair, build and identity, AND the {stateLabel} wardrobe and skin condition shown here; only the physical state may differ, never who they are`.

### E. Hint del matcher (sin fuzzy-match)

1. **El matcher recibe los labels de estado** de cada personaje: el pool del SYSTEM pasa de `- id=X name` a `- id=X name (estados: sudado, mojado)`. `server-actions/campaigns.ts` (donde se llama `matchIdeas`) carga los labels de `character_states` y los pasa en `MatcherCharacter`.

2. **`SceneSchema` gana `characterStateHint?: string`** (`format-matcher.ts:94`), patrón `beatRole`: `z.string().trim().nullable().catch(null).default(null)`. El SYSTEM instruye: "si en una escena un personaje está en un estado físico listado (sudado/mojado/…), pon su label EXACTO en `characterStateHint`; si no, null". Se propaga a `MatchedScene`.

3. **Persistencia:** el planner (`buildDirectedPlan`) escribe `character_state_hint = scene.characterStateHint` al materializar cada `campaign_item`. El orchestrator (`directorContextFor`) lo lee de `item.character_state_hint` (su `ItemRow`/select gana el campo).

> El matcher solo SUGIERE el label (idea estocástica); la persistencia, el match label→`state_image_id`, la sustitución y la cita condicional son deterministas (`feedback_fix_generator_not_output`).

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/045_character_states.sql` | tabla `character_states` + RLS + índice + columna `campaign_items.character_state_hint` |
| `server-actions/character-states.ts` | CRUD (NUEVO) |
| `components/creation/generate.ts` | `generateCharacterState` (vía `editUploaded`) |
| `components/cast/CastPage.tsx` | UI de estados por personaje |
| `lib/prompt-director/types.ts` | `CharacterInventory.stateLabel?` |
| `lib/prompt-director/format-matcher.ts` | `characterStateHint` en `SceneSchema`/`MatchedScene` + labels en el pool + instrucción SYSTEM |
| `server-actions/campaigns.ts` | cargar labels de estado → `MatcherCharacter` (en el llamado a `matchIdeas`) |
| `lib/campaigns/planner.ts` | escribir `character_state_hint` en el `campaign_item` desde `scene.characterStateHint` |
| `lib/campaigns/orchestrator.ts` | cargar estados por personaje; leer `item.character_state_hint`; sustituir `masterImagePath`; set `stateLabel` |
| `lib/prompt-director/compilers/seedance.ts` | cita condicional por `stateLabel` |

## Tests

- **CRUD schema:** `createCharacterStateAction` valida label/uuid; la lógica DB-bound (ownership) por smoke.
- **`characterStateHint`:** se parsea; valor ausente/inválido → null (`.catch`).
- **`generateCharacterState`:** llama `editUploaded` con el prompt de estado + el masterRef (mock de las actions, patrón P01).
- **Orchestrator (`directorContextFor`):** con un hint que matchea un estado, sustituye el path y setea `stateLabel`; sin match, master neutro y `stateLabel` undefined.
- **Compiler (`prompt-director.test.ts`):** con `stateLabel`, la cita usa el vestuario del estado; sin él, la cita actual ("not its clothing").
- Sin APIs reales (`feedback_no_real_api_in_tests`); la UI por smoke.

## Decisiones inmutables — verificación

- **>60s / QStash:** sin cambio; hornear un estado reusa el flujo de generación existente (`submitGenerationAction`).
- **URLs de proveedor al cliente:** `fixAsReference`/`addGenerationAsReference` bajan el output a Storage y devuelven una `media_reference` interna; sin cambio.
- **Créditos vía SQL atómicas:** hornear reusa el flujo de créditos existente; el CRUD de estados no cobra.
- **RLS última línea:** `character_states` con RLS member-scoped (espeja `characters`); las server actions validan ownership con zod + workspace.
- **Migración aditiva:** tabla nueva, no toca `characters`.
- **Identidad:** el prompt de estado y la cita condicional preservan cara/identidad EXACTA; solo cambian vestuario/piel. No se reactiva el bug de deriva de cara (la cita condicional fija "identity exact").
- **Presupuesto Seedance (9 imgs):** el estado SUSTITUYE el master neutro, no se suma; el presupuesto de ángulos (`seedance.ts:202`) no cambia.
- **Sin emojis; dark mode; estilo existente** en la UI de estados.

## Fuera de alcance

- **F-storyboard:** relajar `humanRealismDirective` del panel fresco (otro path; el flujo de video ya desacopla vestuario de identidad en seedance/nano/chain).
- **Estado intra-cadena** (variando entre escenas de una misma secuencia): hoy `characterImagePaths` se hornea en el clip 1; el estado se aplica por secuencia, no por clip encadenado. (Para el clip 1 / clips no encadenados funciona; el caso intra-cadena queda para una fase futura.)
- **Estados de producto.**
- Edición/renombrado de estados (solo create/list/delete en v1).

## Verificación posterior

- `pnpm typecheck` limpio; suite verde (tests de CRUD schema, matcher, orchestrator, compiler).
- Migración 045 aplicada (`list_migrations`).
- Smoke del usuario: crear un personaje, hornear un estado "sudado" desde su master (ver que preserva la cara), generar una campaña con una idea donde el personaje corre/suda, y confirmar en el prompt compilado que esa escena cita la variante sudada con la cita condicional (vestuario incluido), mientras las demás escenas usan el master neutro.
