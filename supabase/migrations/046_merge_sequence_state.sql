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
