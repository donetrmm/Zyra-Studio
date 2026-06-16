-- 036_merge_sequence_rpc.sql
-- Fusión atómica de una secuencia en un solo clip. Antes la server action hacía
-- INSERT y DELETE como dos requests separados (cada uno su commit): si el proceso
-- moría entre ambos (timeout de Vercel, crash, red) quedaban el clip fusionado Y
-- las escenas originales duplicados. Esta función corre INSERT + DELETE en UNA
-- transacción: o pasan los dos o ninguno, así ninguna interrupción deja basura.
--
-- mergeScenes (concatenación de prompts + cap de 15s) sigue en JS (testeado); la
-- función recibe el prompt unido y la duración ya calculados.

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
  -- Ownership: RLS no aplica en security definer, así que se valida explícito
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

  -- Re-chequeo dentro de la transacción (evita TOCTOU con la server action):
  -- todas las escenas deben seguir en 'planned' (sin generar).
  select count(*), count(*) filter (where status = 'planned')
  into v_total, v_planned
  from public.campaign_items
  where campaign_id = p_campaign_id and sequence_id = p_sequence_id;
  if v_planned <> v_total then
    raise exception 'merge_sequence: alguna escena ya se genero' using errcode = 'P0001';
  end if;

  -- El clip fusionado nace con sequence_id null, así que el DELETE por
  -- sequence_id no lo toca. Ambas operaciones en la misma transacción.
  insert into public.campaign_items (
    campaign_id, format_id, model_slug, duration_s, aspect_ratio, scene, audio,
    character_id, character_ids, scene_prompt, scene_summary, caption,
    scheduled_date, status, sequence_id, scene_index, sequence_label
  ) values (
    p_campaign_id, v_first.format_id, v_first.model_slug, p_merged_duration,
    v_first.aspect_ratio, v_first.scene, v_first.audio, v_first.character_id,
    v_first.character_ids, p_joined_prompt, null, v_first.caption,
    v_first.scheduled_date, 'planned', null, null, null
  )
  returning * into v_merged;

  delete from public.campaign_items
  where campaign_id = p_campaign_id and sequence_id = p_sequence_id;

  return v_merged;
end;
$$;

-- Callable solo por usuarios autenticados (la función valida membership
-- internamente). Se revoca de public Y de anon: Supabase concede execute a anon
-- por default, y aunque la guardia interna lo rechazaría, mejor mínimo privilegio.
revoke all on function public.merge_sequence(uuid, uuid, text, integer) from public;
revoke all on function public.merge_sequence(uuid, uuid, text, integer) from anon;
grant execute on function public.merge_sequence(uuid, uuid, text, integer) to authenticated;
