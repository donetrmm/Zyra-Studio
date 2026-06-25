# merge_sequence preserva el estado del personaje — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que fusionar una secuencia conserve el `character_state_hint` del personaje (heredado de la primera escena) en vez de descartarlo.

**Architecture:** Migración nueva `046` con un `CREATE OR REPLACE FUNCTION public.merge_sequence(...)` que reproduce el cuerpo de `036` y añade `character_state_hint` (heredado de `v_first`) al `INSERT`. Sin cambio de TypeScript; el downstream ya consume la columna.

**Tech Stack:** Postgres (PL/pgSQL), Supabase.

## Global Constraints

- **NUNCA modificar una migración aplicada:** `036` queda intacta; el cambio va en `046`.
- **Reproducción fiel:** el `CREATE OR REPLACE` debe reproducir el cuerpo de `036` VERBATIM salvo la adición de `character_state_hint`. Conserva `security definer`, `set search_path = ''`, la guardia `is_campaign_member`, los `raise exception` con sus `errcode`, y los `grant`/`revoke` finales.
- **Herencia consistente:** el estado se hereda de `v_first` (la escena de menor `scene_index`), igual que `format_id`/`model_slug`/etc.
- **Sin cambio de TypeScript** (la server action de merge y `mergeScenes` no cambian).
- **Aplicación a prod:** la migración se aplica al proyecto Supabase remoto vía MCP `apply_migration`, SOLO tras OK explícito del usuario (lo hace el controlador, no un subagente — los subagentes/tests no tocan APIs reales: `feedback_no_real_api_in_tests`).
- **Sin emojis.**

---

### Task 1: Migración 046 — merge_sequence hereda character_state_hint

**Files:**
- Create: `supabase/migrations/046_merge_sequence_state.sql`

**Interfaces:**
- Consumes: la firma existente `public.merge_sequence(uuid, uuid, text, integer) returns public.campaign_items` y la columna `campaign_items.character_state_hint` (migración 045).
- Produces: la función `merge_sequence` redefinida; su `INSERT` ahora escribe `character_state_hint = v_first.character_state_hint`. `RETURNING *` ya devuelve la columna.

- [ ] **Step 1: Crear el archivo de migración**

Crear `supabase/migrations/046_merge_sequence_state.sql` con EXACTAMENTE este contenido (es el cuerpo de `036` reproducido + la columna `character_state_hint` añadida al `INSERT`, marcada con comentario):

```sql
-- 046_merge_sequence_state.sql
-- Fix: merge_sequence (036) omitia character_state_hint en su INSERT porque la
-- columna nacio despues (045, P05). Fusionar una secuencia descartaba el estado
-- del personaje. Este CREATE OR REPLACE reproduce 036 y hereda el estado de la
-- primera escena (v_first), consistente con el resto de campos. NO modifica 036.

create or replace function public.merge_sequence(
  p_campaign_id uuid,
  p_sequence_id uuid,
  p_joined_prompt text,
  p_merged_duration integer
) returns public.campaign_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first public.campaign_items;
  v_total int;
  v_planned int;
  v_merged public.campaign_items;
begin
  -- Ownership: RLS no aplica en security definer, asi que se valida explicito
  -- con el mismo helper que las policies de campaign_items (usa auth.uid()).
  if not public.is_campaign_member(p_campaign_id) then
    raise exception 'merge_sequence: no autorizado' using errcode = '42501';
  end if;

  -- Cabecera de la secuencia (menor scene_index): aporta formato, modelo, etc.
  select * into v_first
  from public.campaign_items
  where campaign_id = p_campaign_id and sequence_id = p_sequence_id
  order by scene_index asc
  limit 1;
  if v_first.id is null then
    raise exception 'merge_sequence: secuencia sin escenas' using errcode = 'P0002';
  end if;

  -- Re-chequeo dentro de la transaccion (evita TOCTOU con la server action):
  -- todas las escenas deben seguir en 'planned' (sin generar).
  select count(*), count(*) filter (where status = 'planned')
  into v_total, v_planned
  from public.campaign_items
  where campaign_id = p_campaign_id and sequence_id = p_sequence_id;
  if v_planned <> v_total then
    raise exception 'merge_sequence: alguna escena ya se genero' using errcode = 'P0001';
  end if;

  -- El clip fusionado nace con sequence_id null, asi que el DELETE por
  -- sequence_id no lo toca. Ambas operaciones en la misma transaccion.
  -- P05: hereda character_state_hint de v_first (la primera escena), como el
  -- resto de campos; antes se perdia porque la columna no estaba en el INSERT.
  insert into public.campaign_items (
    campaign_id, format_id, model_slug, duration_s, aspect_ratio, scene, audio,
    character_id, character_ids, scene_prompt, scene_summary, caption,
    scheduled_date, status, sequence_id, scene_index, sequence_label,
    character_state_hint
  ) values (
    p_campaign_id, v_first.format_id, v_first.model_slug, p_merged_duration,
    v_first.aspect_ratio, v_first.scene, v_first.audio, v_first.character_id,
    v_first.character_ids, p_joined_prompt, null, v_first.caption,
    v_first.scheduled_date, 'planned', null, null, null,
    v_first.character_state_hint
  )
  returning * into v_merged;

  delete from public.campaign_items
  where campaign_id = p_campaign_id and sequence_id = p_sequence_id;

  return v_merged;
end;
$$;

-- Callable solo por usuarios autenticados (la funcion valida membership
-- internamente). Mismo minimo privilegio que 036.
revoke all on function public.merge_sequence(uuid, uuid, text, integer) from public;
revoke all on function public.merge_sequence(uuid, uuid, text, integer) from anon;
grant execute on function public.merge_sequence(uuid, uuid, text, integer) to authenticated;
```

- [ ] **Step 2: Verificación estructural (no hay unit test para un RPC)**

Confirma a ojo, comparando contra `supabase/migrations/036_merge_sequence_rpc.sql`:
1. La firma, `language`, `security definer`, `set search_path = ''`, los `declare`, las dos guardias (`is_campaign_member` y el re-chequeo `v_planned <> v_total`), el `delete` y el `return` son IDÉNTICOS a 036.
2. La **única** diferencia funcional es: `character_state_hint` añadido al final de la lista de columnas del `INSERT` (línea de columnas) y `v_first.character_state_hint` añadido al final de los `values`.
3. **El número de columnas == número de values:** cuenta ambos. Deben ser **18** (los 17 de 036 + `character_state_hint`). Si no cuadran, el `INSERT` está mal alineado.
4. Los tres `grant`/`revoke` finales están presentes con la firma `(uuid, uuid, text, integer)`.

> No hay `pnpm` test: es PL/pgSQL. El JS de `mergeScenes` no cambia, así que la suite de Vitest no se toca. La validación real es aplicar la migración (paso del controlador) + el smoke del usuario.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/046_merge_sequence_state.sql
git commit -m "fix(merge): merge_sequence hereda character_state_hint de la primera escena (P05)"
```

---

## Aplicación y verificación (post-tarea — acción del controlador + smoke del usuario)

- [ ] **Aplicar a producción (controlador, tras OK del usuario):** vía MCP `apply_migration` (project `vpryxoxsiwkvzivkzzrw`), con el nombre `046_merge_sequence_state` (convención de los demás, p. ej. `045_character_states`) y el SQL de la 046. Confirmar con `list_migrations` que aparece.
- [ ] **Smoke del usuario:** crear una secuencia donde la **primera escena** tenga un estado horneado (p. ej. "sudado"); fusionarla; confirmar que el item fusionado lleva `character_state_hint = 'sudado'` (y que al generar usa la variante, no el master neutro).

## Notas para el implementador

- NO modifiques `036_merge_sequence_rpc.sql` — está aplicada (inmutable).
- `CREATE OR REPLACE` con la misma firma reemplaza la definición; los `grant`/`revoke` se repiten para que la migración sea self-contained (mismo patrón que 036; son idempotentes).
- Los comentarios pueden ir SIN acentos (no afectan la función); lo que debe coincidir verbatim con 036 es el CÓDIGO funcional: firma, `security definer`, `set search_path = ''`, las dos guardias con sus `errcode`, el `INSERT` (salvo la columna añadida), el `delete`, el `return` y los `grant`/`revoke`.
