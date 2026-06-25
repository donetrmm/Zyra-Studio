# merge_sequence preserva el estado del personaje

**Fecha:** 2026-06-25
**Tipo:** Fix de bug pre-existente (RPC de BD)
**Esfuerzo:** XS
**Estado:** diseño aprobado, pendiente de plan

## Origen

Descubierto durante la auditoría/implementación de P05 clip único (2026-06-25). El RPC `merge_sequence` (migración `036_merge_sequence_rpc.sql`) fusiona una secuencia multi-escena en un solo clip dentro de una transacción. Su `INSERT` hereda casi todos los campos de `v_first` (la escena de menor `scene_index`), pero **omite `character_state_hint`** porque esa columna nació después (migración 045, P05). Resultado: **fusionar una secuencia descarta el estado del personaje** — el clip fusionado nace neutral aunque las escenas tuvieran una variante horneada, también en generación.

Es un bug pre-existente (036 predata 045), no introducido por P05 clip único. Diferido en su momento; ahora se corrige.

## Problema

`036:55-64` — la lista de columnas del `INSERT` y sus `values` no incluyen `character_state_hint`. `RETURNING *` devuelve la fila insertada, así que `v_merged.character_state_hint` es siempre `NULL`. La server action proyecta esa fila vía `toStudioItem` y la generación lee `campaign_items.character_state_hint` (null → master neutro).

## Diseño

**Migración nueva `046_merge_sequence_state.sql`:** un `CREATE OR REPLACE FUNCTION public.merge_sequence(p_campaign_id uuid, p_sequence_id uuid, p_joined_prompt text, p_merged_duration integer)` que **reproduce el cuerpo completo** de 036 con una sola adición:

- añadir `character_state_hint` al final de la lista de columnas del `INSERT`,
- añadir `v_first.character_state_hint` en la posición correspondiente de `values`.

El clip fusionado hereda el estado de **`v_first` (la primera escena)** — consistente con cómo ya hereda `format_id`, `model_slug`, `aspect_ratio`, `scene`, `audio`, `character_id`, `character_ids`, `caption`, `scheduled_date`. Si las escenas tenían estados distintos, el clip fusionado (uno solo) toma el de la primera.

**No se toca 036** (aplicada, inmutable). El `CREATE OR REPLACE` con la MISMA firma reemplaza la definición; los `grant`/`revoke` se repiten en 046 para mantenerla self-contained (mismo patrón que 036). La server action de merge y `mergeScenes` (JS) NO cambian.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/046_merge_sequence_state.sql` | NUEVO — `CREATE OR REPLACE merge_sequence` con `character_state_hint => v_first.character_state_hint` añadido al INSERT |

**Sin cambio de TypeScript.** El downstream (`toStudioItem`, orchestrator, compiler) ya consume la columna.

## Tests

- No hay unit test del RPC (es SQL/Postgres; `feedback_no_real_api_in_tests`). El JS de `mergeScenes` (concatenación de prompts) ya está testeado y no cambia.
- **Verificación = aplicar + smoke:** se aplica la migración 046 al proyecto Supabase (MCP `apply_migration`, tras OK del usuario, va directo al DB remoto/prod) y el usuario hace el smoke: secuencia con un estado horneado en la 1ª escena → fusionar → confirmar que el item fusionado lleva ese `character_state_hint` (y que al generar usa la variante, no el master neutro).

## Decisiones inmutables — verificación

- **Migración aditiva, no destructiva:** `CREATE OR REPLACE` de una función; no altera datos ni esquema de tablas. Reversible re-aplicando la definición de 036.
- **No modifica una migración aplicada** (036 intacta; el cambio va en 046).
- **`security definer` + `set search_path = ''` + `is_campaign_member`** se conservan verbatim (seguridad del RPC sin cambios).
- **Créditos/QStash/Storage/UI** intactos.

## Fuera de alcance

- Elegir el estado del merge por heurística (estado "dominante" / última escena): se hereda de la primera, consistente con el resto de campos.
- Cualquier cambio a la lógica de `mergeScenes` (concatenación de prompts/duración).

## Verificación posterior

- La migración aplica limpio (`apply_migration` sin error); `list_migrations` muestra 046.
- Smoke del usuario (arriba).
