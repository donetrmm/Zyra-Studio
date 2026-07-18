-- 069: los miembros de un mismo workspace pueden leerse el perfil.
--
-- profiles era self-read + admin: la página de equipo (specs/v2/20) no podía
-- mostrar nombre/email/avatar de los compañeros con el cliente del usuario.
-- Alternativa descartada: admin client en la página (rompe la defensa en
-- profundidad — el service role queda para worker/admin/cleanup).
--
-- Sin recursión: la subquery sobre workspace_members pasa por SU policy
-- (ws_members_read), que usa is_workspace_member security definer — no vuelve
-- a evaluar policies de profiles.

drop policy if exists "profiles_peer_read" on profiles;
create policy "profiles_peer_read" on profiles
  for select using (
    exists (
      select 1
      from workspace_members me
      join workspace_members them on them.workspace_id = me.workspace_id
      where me.user_id = auth.uid()
        and them.user_id = profiles.id
    )
  );
