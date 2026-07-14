-- 066: contador de generaciones por campaña para la Biblioteca.
--
-- La página traía TODAS las filas de generations con campaign_id (sin limit)
-- solo para contarlas en memoria: crecía linealmente con el historial del
-- workspace. Un group by en SQL devuelve N filas (una por campaña).
--
-- security invoker: la cuenta respeta RLS (generations_member_read) — cada
-- usuario solo cuenta lo que puede ver.

create or replace function library_campaign_counts(p_workspace_id uuid)
returns table (campaign_id uuid, total bigint)
language sql
security invoker
stable
as $$
  select g.campaign_id, count(*)::bigint as total
  from generations g
  where g.workspace_id = p_workspace_id
    and g.campaign_id is not null
  group by g.campaign_id
$$;
